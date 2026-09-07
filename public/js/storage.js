/**
 * 얼굴 사진 로컬 보관소 (IndexedDB).
 *
 * 전/후 비교를 하려면 사진이 남아야 하지만, 얼굴 사진을 서버에 올리는 순간
 * 이 앱의 가장 큰 장점(기기 안에서 끝난다)이 사라진다.
 * 그래서 사진은 브라우저에만 저장하고, 서버는 끝까지 숫자만 본다.
 */
const DB_NAME = 'skinlab';
const STORE = 'photos';
const MAX_PHOTOS = 24;

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('이 브라우저는 사진 보관을 지원하지 않습니다.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'analysisId' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  }));
}

/** ImageData 를 JPEG dataURL 로 (원본 해상도 그대로 두면 용량이 금방 찬다) */
export function toDataUrl(imageData, maxW = 480, quality = 0.82) {
  const scale = Math.min(1, maxW / imageData.width);
  const w = Math.round(imageData.width * scale);
  const h = Math.round(imageData.height * scale);
  const src = document.createElement('canvas');
  src.width = imageData.width; src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  return { dataUrl: out.toDataURL('image/jpeg', quality), width: w, height: h, scale };
}

export async function savePhoto({ analysisId, imageData, box, totalScore, tone }) {
  const { dataUrl, width, height, scale } = toDataUrl(imageData);
  const record = {
    analysisId,
    createdAt: new Date().toISOString(),
    dataUrl,
    width, height,
    // 존 마커를 사진 위에 정확히 얹으려면 리사이즈된 좌표계의 박스가 필요하다
    box: { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale },
    totalScore, tone,
  };
  await tx('readwrite', (s) => s.put(record));
  await prune();
  return record;
}

export const getPhoto = (analysisId) => tx('readonly', (s) => s.get(analysisId)).catch(() => null);

export const allPhotos = () =>
  tx('readonly', (s) => s.getAll())
    .then((rows) => (rows || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    .catch(() => []);

/** 오래된 사진부터 정리 — 용량 초과로 저장이 실패하는 걸 막는다 */
async function prune() {
  const rows = await allPhotos();
  if (rows.length <= MAX_PHOTOS) return;
  const drop = rows.slice(0, rows.length - MAX_PHOTOS);
  await tx('readwrite', (s) => { drop.forEach((r) => s.delete(r.analysisId)); });
}

export const deleteAllPhotos = () => tx('readwrite', (s) => s.clear());
