'use strict';
/**
 * 추천 성과 추적기.
 *
 * "수익 최대화"는 측정 없이는 불가능하다. 추천이 나올 때마다 그 시점의 가격을 함께 저장해 두고,
 * 나중에 실제 가격으로 채점해 적중률·평균 수익률을 낸다.
 * 어떤 엔진(Claude / Llama / 지표전용)이 더 맞았는지도 이 기록으로만 알 수 있다.
 *
 * ⚠️ 이것은 과거 기록의 사후 채점이지 백테스트가 아니다. 표본이 쌓이기 전 수치는 의미가 없다.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.AI_LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const FILE = path.join(DIR, 'ai-picks.jsonl');

/** 기간별 판정 유효 시간 */
const HORIZON_HOURS = { '당일': 8, '2~3일': 72, '1~2주': 336 };

function readAll() {
  try {
    return fs.readFileSync(FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function append(rows) {
  if (!rows.length) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(FILE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** 추천 결과를 채점 대기 상태로 저장 */
function record(result) {
  const rows = (result.picks || [])
    .filter((p) => p.snapshot && p.snapshot.price)
    .map((p) => ({
      id: `${result.generatedAt}-${p.symbol}`,
      t: result.generatedAt,
      market: result.market,
      symbol: p.symbol,
      name: p.name,
      engine: result.engine,
      providers: (p.consensus && p.consensus.providers) || (result.model ? [result.model] : ['rules']),
      confidence: p.confidence,
      horizon: p.horizon,
      entry: p.snapshot.price,
      stop: p.snapshot.plan ? p.snapshot.plan.stop : null,
      target: p.snapshot.plan ? p.snapshot.plan.target : null,
      side: p.snapshot.plan ? p.snapshot.plan.side : 'LONG',
      score: p.snapshot.score,
    }));
  append(rows);
  return rows.length;
}

/**
 * 미채점 기록을 현재가로 채점한다.
 * @param {{getPrice:(market:string, symbol:string)=>Promise<number|null>}} deps 가격 조회 함수 주입
 */
async function scoreAll(deps) {
  const rows = readAll();
  const latest = new Map();
  // 같은 id 는 마지막 기록이 최신 상태다
  for (const r of rows) latest.set(r.id, r);

  const open = Array.from(latest.values()).filter((r) => !r.closed);
  const updates = [];

  for (const r of open) {
    let price = null;
    try {
      price = await deps.getPrice(r.market, r.symbol);
    } catch (_) { /* 조회 실패는 다음 기회에 */ }
    if (!price) continue;

    const long = r.side !== 'SHORT';
    const pnlPct = ((price - r.entry) / r.entry) * 100 * (long ? 1 : -1);
    const ageHours = (Date.now() - r.t) / 3600e3;
    const limit = HORIZON_HOURS[r.horizon] || 72;

    let outcome = null;
    if (r.target && (long ? price >= r.target : price <= r.target)) outcome = 'target';
    else if (r.stop && (long ? price <= r.stop : price >= r.stop)) outcome = 'stop';
    else if (ageHours >= limit) outcome = 'expired';

    updates.push({
      ...r,
      lastPrice: price,
      pnlPct: round2(pnlPct),
      ageHours: round2(ageHours),
      outcome: outcome || 'open',
      closed: Boolean(outcome),
      scoredAt: Date.now(),
    });
  }

  append(updates);
  return { checked: open.length, updated: updates.length };
}

/** 누적 성적표 */
function summary() {
  const latest = new Map();
  for (const r of readAll()) latest.set(r.id, r);
  const all = Array.from(latest.values());
  const closed = all.filter((r) => r.closed && typeof r.pnlPct === 'number');
  const open = all.filter((r) => !r.closed);

  const agg = (rows) => {
    if (!rows.length) return { n: 0, winRate: null, avgPnlPct: null, best: null, worst: null };
    const wins = rows.filter((r) => r.pnlPct > 0).length;
    const pnls = rows.map((r) => r.pnlPct);
    return {
      n: rows.length,
      winRate: round2((wins / rows.length) * 100),
      avgPnlPct: round2(pnls.reduce((a, b) => a + b, 0) / rows.length),
      best: round2(Math.max(...pnls)),
      worst: round2(Math.min(...pnls)),
    };
  };

  const byKey = (rows, keyFn) => {
    const map = new Map();
    for (const r of rows) {
      for (const k of [].concat(keyFn(r))) {
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      }
    }
    return Object.fromEntries(Array.from(map, ([k, v]) => [k, agg(v)]));
  };

  return {
    total: all.length,
    open: open.length,
    closed: closed.length,
    overall: agg(closed),
    byOutcome: {
      target: closed.filter((r) => r.outcome === 'target').length,
      stop: closed.filter((r) => r.outcome === 'stop').length,
      expired: closed.filter((r) => r.outcome === 'expired').length,
    },
    byEngine: byKey(closed, (r) => r.engine),
    byProvider: byKey(closed, (r) => r.providers),
    byConfidence: byKey(closed, (r) => r.confidence),
    byMarket: byKey(closed, (r) => r.market),
    recent: all.sort((a, b) => b.t - a.t).slice(0, 30).map((r) => ({
      t: r.t, market: r.market, symbol: r.symbol, name: r.name,
      confidence: r.confidence, horizon: r.horizon, providers: r.providers,
      entry: r.entry, lastPrice: r.lastPrice || null,
      pnlPct: typeof r.pnlPct === 'number' ? r.pnlPct : null,
      outcome: r.outcome || 'open',
    })),
    note: closed.length < 20
      ? `표본이 ${closed.length}건뿐이라 아직 통계적으로 의미 있는 수치가 아닙니다.`
      : null,
  };
}

/**
 * 보정(calibration) — "우리가 '높음'이라고 한 추천은 실제로 몇 % 맞았나".
 *
 * 기대값 계산과 AI 프롬프트 양쪽에서 쓴다. 표본이 적을 때 그대로 쓰면 3건 중 2건 맞았다고
 * 승률 67% 라고 우기게 되므로, 중립값(50%) 쪽으로 끌어당기는 축소추정(shrinkage)을 쓴다.
 *   p̂ = (맞은 수 + k·0.5) / (전체 + k),  k = 10
 * 표본이 쌓일수록 실측값에 가까워지고, 적을 때는 50%에 머문다.
 */
const SHRINK_K = 10;
/** 이 이상 쌓여야 "측정됐다"고 본다 */
const MIN_SAMPLE = 10;

function calibration() {
  const latest = new Map();
  for (const r of readAll()) latest.set(r.id, r);
  const closed = Array.from(latest.values()).filter((r) => r.closed && typeof r.pnlPct === 'number');

  const bucket = (rows) => {
    const n = rows.length;
    const hits = rows.filter((r) => r.outcome === 'target').length;
    const stops = rows.filter((r) => r.outcome === 'stop').length;
    const expired = rows.filter((r) => r.outcome === 'expired').length;
    const raw = n ? hits / n : null;
    return {
      n,
      targetRate: raw == null ? null : round2(raw * 100),
      stopRate: n ? round2((stops / n) * 100) : null,
      expiredRate: n ? round2((expired / n) * 100) : null,
      // 축소추정 승률 — 표본이 적으면 50%에 가깝게 눌린다
      hitProb: round4((hits + SHRINK_K * 0.5) / (n + SHRINK_K)),
      avgPnlPct: n ? round2(rows.reduce((a, r) => a + r.pnlPct, 0) / n) : null,
      measured: n >= MIN_SAMPLE,
    };
  };

  const group = (keyFn) => {
    const map = new Map();
    for (const r of closed) {
      const k = keyFn(r);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return Object.fromEntries(Array.from(map, ([k, v]) => [k, bucket(v)]));
  };

  return {
    overall: bucket(closed),
    byConfidence: group((r) => r.confidence),
    byMarket: group((r) => r.market),
    byEngine: group((r) => r.engine),
    minSample: MIN_SAMPLE,
  };
}

/**
 * 특정 조건에서 쓸 승률 추정치. 조건이 구체적일수록 우선하되,
 * 표본이 부족하면 더 넓은 집합으로 물러난다.
 * @returns {{prob:number, basis:string, n:number, measured:boolean}}
 */
function hitProbFor({ confidence, market } = {}) {
  const cal = calibration();
  const tries = [
    [cal.byConfidence[confidence], `신뢰도 '${confidence}' 실적`],
    [cal.byMarket[market], `${market} 시장 실적`],
    [cal.overall, '전체 실적'],
  ];
  for (const [b, basis] of tries) {
    if (b && b.measured) return { prob: b.hitProb, basis, n: b.n, measured: true };
  }
  const b = cal.overall;
  return {
    prob: b && b.n ? b.hitProb : 0.5,
    basis: `표본 부족(${(b && b.n) || 0}건) — 중립 50%로 가정`,
    n: (b && b.n) || 0,
    measured: false,
  };
}

const round2 = (v) => (isFinite(v) ? Math.round(v * 100) / 100 : null);
const round4 = (v) => (isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);

module.exports = {
  record, scoreAll, summary, readAll, calibration, hitProbFor,
  HORIZON_HOURS, MIN_SAMPLE, FILE,
};
