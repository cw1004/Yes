/**
 * 샘플 얼굴 생성기 (시뮬레이션 전용).
 *
 * 실제 인물 사진을 쓰지 않는다 — 초상권 문제도 있지만, 무엇보다
 * "이 조건에서 이 지표가 어떻게 나오는가"를 보려면 조건을 마음대로
 * 조절할 수 있어야 한다. 그래서 캔버스에 직접 그린다.
 *
 * 이 생성기는 앱의 체험 모드와 터미널 리허설(scripts/simulate.mjs)이 함께 쓴다.
 * 두 곳이 다른 얼굴을 쓰면 "리허설은 통과했는데 앱에서는 다르다"가 된다.
 */

/**
 * @typedef {object} FaceSpec
 * @property {string} base   기본 피부색 (#rrggbb)
 * @property {number} rough  결 거칠기 0~1
 * @property {number} spots  잡티 개수
 * @property {number} shine  T존 광택 0~1
 * @property {number} dark   눈밑 그늘 0~1
 * @property {number} [redness] 볼 홍조 0~1
 */

/** @returns {HTMLCanvasElement} */
export function drawFace(spec, { width = 320, height = 420 } = {}) {
  const { base = '#e0b592', rough = 0.4, spots = 20, shine = 0.3, dark = 0.2, redness = 0 } = spec;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d');
  const cx = width / 2, cy = height * 0.49;
  const rx = width * 0.31, ry = height * 0.345;

  // 배경 (얼굴 밖은 피부로 잡히지 않아야 한다)
  x.fillStyle = '#12101a';
  x.fillRect(0, 0, width, height);

  // 얼굴 바탕
  x.fillStyle = base;
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  x.fill();

  const rgb = base.match(/\w\w/g).map((v) => parseInt(v, 16));
  const inFace = (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 0.98;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  /** 얼굴 안쪽의 임의 지점 */
  const pick = () => {
    for (let i = 0; i < 12; i++) {
      const px = rand(cx - rx, cx + rx), py = rand(cy - ry, cy + ry);
      if (inFace(px, py)) return [px, py];
    }
    return [cx, cy];
  };

  // ── 피부 결 ──
  // 지표는 국소 밝기 변화(라플라시안)를 본다. 넓고 옅은 얼룩은 아무리 많이 그려도
  // 잡히지 않는다. 실제 모공·요철처럼 '작고 대비가 있는' 점이어야 측정에 걸린다.
  const grains = Math.round(1800 + 5200 * rough);
  for (let i = 0; i < grains; i++) {
    const [px, py] = pick();
    const dir = Math.random() < 0.5 ? -1 : 1;
    const amp = 26 * rough * rand(0.5, 1.4);
    x.fillStyle = `rgb(${Math.round(rgb[0] + dir * amp)},${Math.round(rgb[1] + dir * amp * 0.9)},${Math.round(rgb[2] + dir * amp * 0.8)})`;
    x.fillRect(px, py, 1 + Math.round(rough), 1 + Math.round(rough));
  }
  // 모공처럼 살짝 파인 점
  const pores = Math.round(900 * rough);
  for (let i = 0; i < pores; i++) {
    const [px, py] = pick();
    x.fillStyle = `rgba(${Math.round(rgb[0] * 0.72)},${Math.round(rgb[1] * 0.68)},${Math.round(rgb[2] * 0.66)},${rand(0.35, 0.8)})`;
    x.beginPath();
    x.arc(px, py, rand(0.8, 1.8), 0, Math.PI * 2);
    x.fill();
  }

  // ── 잡티 ──
  // 색소침착은 '어둡고 동시에 더 노란(b* 높은)' 영역이다.
  // 단순히 어둡게만 칠하면 지표가 그림자로 보고 색소로 세지 않는다.
  for (let i = 0; i < spots; i++) {
    const [px, py] = pick();
    const r = rand(3, 8);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const spotColor = (a) => `rgba(${Math.round(rgb[0] * 0.74)},${Math.round(rgb[1] * 0.58)},${Math.round(rgb[2] * 0.42)},${a})`;
    g.addColorStop(0, spotColor(0.72));
    g.addColorStop(0.6, spotColor(0.45));
    g.addColorStop(1, spotColor(0));
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, r, 0, Math.PI * 2);
    x.fill();
  }

  // ── T존 유분 ──
  // 번들거림은 고른 밝기가 아니라 '정반사 하이라이트 덩어리'다.
  // 부드러운 그라디언트로는 지표가 잡지 못한다.
  if (shine > 0) {
    // 지표는 T존 사각형 안에서 '정반사 픽셀 비율'을 본다. 점 몇 개로는 비율이 안 나온다.
    const blobs = Math.round(260 * shine);
    for (let i = 0; i < blobs; i++) {
      const zone = Math.random();
      const px = zone < 0.45
        ? rand(cx - rx * 0.42, cx + rx * 0.42)      // 이마
        : rand(cx - rx * 0.13, cx + rx * 0.13);      // 코
      const py = zone < 0.45
        ? rand(cy - ry * 0.78, cy - ry * 0.42)
        : rand(cy - ry * 0.16, cy + ry * 0.22);
      if (!inFace(px, py)) continue;
      const r = rand(2, 6.5);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,252,246,${rand(0.55, 0.95) * shine})`);
      g.addColorStop(1, 'rgba(255,252,246,0)');
      x.fillStyle = g;
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
    }
  }

  // ── 볼 홍조 ──
  // 지표는 a*(붉은 정도)의 상위 꼬리와 평균의 차이를 본다.
  // 얼굴 전체를 고르게 붉히면 평균도 같이 올라가 차이가 사라지므로 볼에 국소적으로 얹는다.
  if (redness > 0) {
    for (const side of [-1, 1]) {
      const bx = cx + side * rx * 0.5;
      const by = cy + ry * 0.16;
      const g = x.createRadialGradient(bx, by, 0, bx, by, rx * 0.4);
      g.addColorStop(0, `rgba(206,74,62,${0.42 * redness})`);
      g.addColorStop(0.7, `rgba(206,74,62,${0.18 * redness})`);
      g.addColorStop(1, 'rgba(206,74,62,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(bx, by, rx * 0.4, ry * 0.3, 0, 0, Math.PI * 2);
      x.fill();
    }
    // 실핏줄처럼 더 진한 작은 점들
    const flecks = Math.round(220 * redness);
    for (let i = 0; i < flecks; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = cx + side * rand(rx * 0.24, rx * 0.74);
      const py = cy + rand(-ry * 0.06, ry * 0.4);
      if (!inFace(px, py)) continue;
      x.fillStyle = `rgba(190,62,54,${rand(0.25, 0.6) * redness})`;
      x.beginPath();
      x.arc(px, py, rand(1, 2.8), 0, Math.PI * 2);
      x.fill();
    }
  }

  // 눈밑 그늘
  if (dark > 0) {
    x.fillStyle = `rgba(${Math.round(rgb[0] * 0.5)},${Math.round(rgb[1] * 0.45)},${Math.round(rgb[2] * 0.45)},${0.2 + dark * 0.5})`;
    for (const side of [-1, 1]) {
      x.beginPath();
      x.ellipse(cx + side * rx * 0.4, cy - ry * 0.22, rx * 0.26, ry * 0.07, 0, 0, Math.PI * 2);
      x.fill();
    }
  }
  return c;
}

/** 분석 엔진이 받는 형태로 (ImageData + 얼굴 박스) */
export function faceImageData(spec, opts) {
  const canvas = drawFace(spec, opts);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  img.canvas = canvas;
  return img;
}

/** 4주 관리 후를 가정한 스펙 — 좋아지는 정도를 조절할 수 있다 */
export function improved(spec, factor = 0.35) {
  return {
    ...spec,
    rough: spec.rough * factor,
    spots: Math.round(spec.spots * factor),
    shine: spec.shine * factor,          // 유분도 같은 비율로 줄어야 전후가 보인다
    dark: spec.dark * factor,
    redness: (spec.redness || 0) * factor,
  };
}
