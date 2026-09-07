/**
 * 파일 기반 JSON 스토어.
 * 외부 DB 없이 단일 프로세스로 돌리기 위한 최소 구현.
 * 운영 전환 시 이 모듈의 인터페이스만 유지한 채 Postgres 어댑터로 갈아끼우면 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.SKINLAB_DB || path.join(ROOT, 'data', 'db.json');

const EMPTY = { users: {}, analyses: {}, entitlements: {}, orders: {}, clicks: [], events: [], coupons: {} };

let cache = null;
let writeTimer = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function flush() {
  if (!cache) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_PATH); // 원자적 교체 — 쓰기 중 크래시로 DB가 깨지지 않게
}

/** 쓰기가 몰릴 때 디스크 I/O를 묶는다 */
function scheduleFlush() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 120);
  writeTimer.unref?.();
}

export const db = {
  read: () => load(),
  update(fn) {
    const d = load();
    const r = fn(d);
    scheduleFlush();
    return r;
  },
  flushNow: flush,
  path: DB_PATH,
};

/** 이벤트 로그 — 퍼널 분석(뷰 -> 분석 -> 페이월 -> 결제 -> 클릭 -> 구매)의 원천 데이터 */
export function logEvent(type, payload = {}) {
  db.update((d) => {
    d.events.push({ type, at: new Date().toISOString(), ...payload });
    if (d.events.length > 20000) d.events.splice(0, d.events.length - 20000);
  });
}
