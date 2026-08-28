'use strict';
/**
 * 시간대별 실측 프로파일.
 *
 * "개장 직후에 거래대금의 40%가 터진다" 같은 숫자는 종목·시기마다 다르다.
 * 그래서 **가정을 믿는 대신 직접 재서** 보여 준다.
 *
 * 스캐너가 돌 때마다 그 순간의 거래량 배율·변동성을 10분 단위 칸에 쌓아 두고,
 * 하루 평균 대비 몇 배인지를 낸다. 며칠 쌓이면 사용자의 관심종목 기준으로
 * 진짜 골든타임이 언제인지가 그림으로 드러난다.
 *
 * 측정값이 sessions.js 의 가정과 다르면 **측정값이 맞다.**
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.AI_LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const FILE = path.join(DIR, 'daypart.json');

const BUCKET_MIN = 10;                       // 10분 단위
const BUCKETS = (24 * 60) / BUCKET_MIN;      // 144칸
/** 이만큼 표본이 쌓여야 그 칸을 신뢰한다 */
const MIN_SAMPLES = 12;

let state = null;
let dirty = 0;

function fresh() {
  return { version: 1, markets: {} };
}

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = raw && raw.version === 1 ? raw : fresh();
  } catch (_) {
    state = fresh();
  }
  return state;
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
    dirty = 0;
  } catch (_) { /* 기록 실패가 스캔을 막지 않는다 */ }
}

/** KST 기준 10분 칸 번호 */
function bucketOf(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return Math.floor(mins / BUCKET_MIN);
}

const labelOf = (b) => {
  const m = b * BUCKET_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * 스캔 한 번의 결과를 기록한다.
 * @param {'US'|'KR'} market
 * @param {Array<{technicals?:object}>} rows 스캐너가 낸 종목 행
 */
function record(market, rows, date = new Date()) {
  if (!rows || !rows.length) return;
  const st = load();
  if (!st.markets[market]) st.markets[market] = {};
  const m = st.markets[market];
  const b = String(bucketOf(date));
  if (!m[b]) m[b] = { n: 0, vol: 0, atr: 0, fit: 0 };

  let n = 0, vol = 0, atr = 0, fit = 0;
  for (const r of rows) {
    const t = r.technicals || {};
    if (typeof t.volumeRatio !== 'number' && typeof t.atrPct !== 'number') continue;
    n++;
    vol += t.volumeRatio || 0;
    atr += t.atrPct || 0;
    fit += typeof r.fit === 'number' ? r.fit : 0;
  }
  if (!n) return;

  // 한 스캔은 한 표본으로 센다 (종목 수가 달라도 공평하게)
  m[b].n += 1;
  m[b].vol += vol / n;
  m[b].atr += atr / n;
  m[b].fit += fit / n;

  if (++dirty >= 5) save();
}

/**
 * 측정된 시간대 프로파일.
 * @returns {{market:string, samples:number, buckets:Array, peak:object|null, trough:object|null}}
 */
function profile(market) {
  const st = load();
  const m = (st.markets && st.markets[market]) || {};
  const entries = Object.entries(m).filter(([, v]) => v.n > 0);
  const samples = entries.reduce((a, [, v]) => a + v.n, 0);

  // 하루 전체 평균 (기준선)
  const meanVol = samples ? entries.reduce((a, [, v]) => a + v.vol, 0) / samples : 0;
  const meanAtr = samples ? entries.reduce((a, [, v]) => a + v.atr, 0) / samples : 0;

  const buckets = entries
    .map(([b, v]) => {
      const avgVol = v.vol / v.n;
      const avgAtr = v.atr / v.n;
      return {
        bucket: Number(b),
        kst: labelOf(Number(b)),
        n: v.n,
        avgVolumeRatio: round3(avgVol),
        avgAtrPct: round3(avgAtr),
        avgFit: round1(v.fit / v.n),
        // 하루 평균 대비 배수 — "이 시간대는 평균의 1.8배"
        volumeIndex: meanVol ? round2(avgVol / meanVol) : null,
        volatilityIndex: meanAtr ? round2(avgAtr / meanAtr) : null,
        reliable: v.n >= MIN_SAMPLES,
      };
    })
    .sort((a, b) => a.bucket - b.bucket);

  const usable = buckets.filter((b) => b.reliable);
  const byVol = [...usable].sort((a, b) => (b.volumeIndex || 0) - (a.volumeIndex || 0));

  return {
    market,
    samples,
    bucketMinutes: BUCKET_MIN,
    minSamples: MIN_SAMPLES,
    buckets,
    reliableBuckets: usable.length,
    peak: byVol[0] || null,
    trough: byVol[byVol.length - 1] || null,
    note: usable.length < 6
      ? `아직 ${usable.length}개 구간만 표본이 찼습니다. 스캐너를 며칠 켜 두면 실제 골든타임이 드러납니다.`
      : null,
  };
}

const round1 = (v) => (isFinite(v) ? Math.round(v * 10) / 10 : null);
const round2 = (v) => (isFinite(v) ? Math.round(v * 100) / 100 : null);
const round3 = (v) => (isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** 테스트·초기화용 */
function reset() { state = fresh(); dirty = 0; }
function flush() { if (state) save(); }

module.exports = { record, profile, bucketOf, labelOf, reset, flush, BUCKET_MIN, MIN_SAMPLES, FILE };
