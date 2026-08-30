'use strict';
/**
 * AI 출력 검증과 기대값 계산.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 * 1) 모델은 후보에 없는 종목을 지어낼 수 있다. 예전에는 그 종목이 화면까지 그대로 올라왔다.
 *    여기서 **떨어뜨리고**, 무엇을 왜 떨어뜨렸는지 남긴다.
 * 2) "수익 최대화"는 좋은 종목을 고르는 것만이 아니라 **나쁜 거래를 안 하는 것**이다.
 *    비용을 넘지 못하는 목표가, 필요 승률이 비현실적인 계획은 확률과 무관하게 손해다.
 *    그건 계산으로 확실히 알 수 있으므로 여기서 걸러 낸다.
 *
 * ── 판정 ───────────────────────────────────────────────────────────────
 *   reject : 계산상 손해가 확실하다 (목표가 비용도 못 넘음, 손절이 진입 반대편 등)
 *   hold   : 기대값이 0 이하이거나 근거가 부족하다 → 보류
 *   take   : 측정된 승률이 필요 승률을 넘는다
 */

const KRC = require('../kr/config');

/** 미국은 대부분 수수료가 없지만 스프레드·슬리피지가 든다. 왕복 기준 bp. */
const US_COST_BPS = Number(process.env.US_COST_BPS ?? 5);

const CONFIDENCE = ['높음', '중간', '낮음'];
const HORIZON = ['당일', '2~3일', '1~2주'];

/* --------------------------------------------------------------- 비용 */

/** 주당 왕복 매매비용. 국내 ETF 는 증권거래세가 면제되어 훨씬 싸다. */
function roundTripCostPerShare(price, market, isEtf = false) {
  if (!price || !isFinite(price)) return 0;
  if (market === 'KR') return KRC.roundTripCost(price, 1, KRC.COST, isEtf);
  return price * (US_COST_BPS / 10000);
}

/* ------------------------------------------------------------- 기대값 */

/**
 * 하나의 매매 계획이 돈이 되는 구조인지 계산한다.
 * 확률 없이도 확실히 아는 것(비용, 필요 승률)과, 실적이 있어야 아는 것(기대값)을 나눈다.
 *
 * @param {{entry:number, stop:number, target:number, side?:string, market:string}} plan
 * @param {{prob:number, basis:string, measured:boolean, n:number}} [hit] 실측 승률 추정치
 */
function edgeOf(plan, hit) {
  if (!plan || !isFinite(plan.entry) || !isFinite(plan.stop) || !isFinite(plan.target)) {
    return { ok: false, verdict: 'hold', reason: '매매 계획(진입·손절·목표)이 없어 기대값을 계산할 수 없습니다.' };
  }
  const long = String(plan.side || 'LONG').toUpperCase() !== 'SHORT';
  const { entry, stop, target, market } = plan;

  // 방향이 앞뒤가 맞는지 — 매수인데 손절이 진입보다 위면 계획 자체가 잘못된 것이다
  const riskRaw = long ? entry - stop : stop - entry;
  const rewardRaw = long ? target - entry : entry - target;
  if (riskRaw <= 0 || rewardRaw <= 0) {
    return {
      ok: false, verdict: 'reject',
      reason: `계획이 방향과 맞지 않습니다 (${long ? '매수' : '매도'}인데 ` +
        `손절 ${fmt(stop)} · 목표 ${fmt(target)} · 진입 ${fmt(entry)}).`,
    };
  }

  const cost = roundTripCostPerShare(entry, market, plan.isEtf === true);
  const rewardNet = rewardRaw - cost;

  // ① 확실한 관문 — 목표를 맞혀도 비용을 못 넘으면 100% 맞혀도 손해다
  if (rewardNet <= 0) {
    return {
      ok: true, verdict: 'reject',
      entry, stop, target, side: long ? 'LONG' : 'SHORT',
      riskPerShare: round4(riskRaw), rewardPerShare: round4(rewardRaw),
      costPerShare: round4(cost), rewardNetPerShare: round4(rewardNet),
      rrNet: null, breakevenWinRate: null, hitProb: null, evPerShare: null, evPct: null,
      reason: `목표까지 가도 매매비용(주당 ${fmt(cost)})을 넘지 못합니다. 맞혀도 손해입니다.`,
    };
  }

  // ② 확실한 관문 — "본전이 되려면 최소 몇 %를 맞혀야 하는가". 확률 추정 없이 계산된다.
  const breakeven = riskRaw / (riskRaw + rewardNet);
  const rrNet = rewardNet / riskRaw;

  // ③ 실적이 있을 때만 — 실제로 그만큼 맞히고 있는가
  const p = hit && isFinite(hit.prob) ? hit.prob : null;
  const ev = p == null ? null : p * rewardNet - (1 - p) * riskRaw;
  const evPct = ev == null ? null : (ev / entry) * 100;

  let verdict = 'hold';
  let reason;
  if (p == null) {
    reason = `필요 승률 ${pctOf(breakeven)} — 아직 실적이 없어 기대값을 낼 수 없습니다.`;
  } else if (!hit.measured) {
    reason = `필요 승률 ${pctOf(breakeven)}. ${hit.basis} → 근거가 약해 보류합니다.`;
  } else if (ev > 0) {
    verdict = 'take';
    reason = `필요 승률 ${pctOf(breakeven)}, 실측 ${pctOf(p)} (${hit.basis}, ${hit.n}건) → 기대값 +${fmt(ev)}/주.`;
  } else {
    reason = `필요 승률 ${pctOf(breakeven)}인데 실측은 ${pctOf(p)}뿐입니다 (${hit.basis}, ${hit.n}건). 기대값이 음수입니다.`;
  }

  return {
    ok: true, verdict,
    entry, stop, target, side: long ? 'LONG' : 'SHORT',
    riskPerShare: round4(riskRaw),
    rewardPerShare: round4(rewardRaw),
    costPerShare: round4(cost),
    rewardNetPerShare: round4(rewardNet),
    rrNet: round2(rrNet),
    breakevenWinRate: round4(breakeven),
    hitProb: p,
    hitBasis: hit ? hit.basis : null,
    hitMeasured: Boolean(hit && hit.measured),
    evPerShare: round4(ev),
    evPct: round4(evPct),
    reason,
  };
}

/* ------------------------------------------------------------- 검증 */

/**
 * 모델이 낸 추천을 걸러 낸다.
 *
 * @param {Array} picks              모델 출력
 * @param {{candidates:Array, allowedUrls:Set<string>|Array<string>, market:string}} ctx
 * @returns {{picks:Array, dropped:Array}}
 */
function validatePicks(picks, ctx) {
  const bySymbol = new Map((ctx.candidates || []).map((c) => [String(c.symbol).toUpperCase(), c]));
  const allowed = ctx.allowedUrls instanceof Set ? ctx.allowedUrls : new Set(ctx.allowedUrls || []);
  const seen = new Set();
  const out = [];
  const dropped = [];

  for (const raw of picks || []) {
    const symbol = String(raw && raw.symbol || '').trim().toUpperCase();
    if (!symbol) {
      dropped.push({ symbol: '(빈 값)', why: '심볼이 비어 있습니다.' });
      continue;
    }
    // ① 지어낸 종목 차단 — 우리가 준 후보 목록 밖은 받지 않는다
    const matched = bySymbol.get(symbol);
    if (!matched) {
      dropped.push({ symbol, why: '후보 목록에 없는 종목입니다 (모델이 지어냈을 가능성).' });
      continue;
    }
    // ② 같은 종목 중복
    if (seen.has(symbol)) {
      dropped.push({ symbol, why: '같은 종목이 중복 추천됐습니다.' });
      continue;
    }
    seen.add(symbol);

    // ③ 열거형 값 정리 — 범위 밖이면 가장 보수적인 값으로
    const confidence = CONFIDENCE.includes(raw.confidence) ? raw.confidence : '낮음';
    const horizon = HORIZON.includes(raw.horizon) ? raw.horizon : '당일';

    // ④ 출처 — 우리가 준 뉴스 목록에 있던 URL 인지 표시한다.
    //    웹 검색으로 찾은 URL 은 우리가 확인할 수 없으므로 '미확인'으로 남기고 지우지는 않는다.
    const sources = (raw.sources || [])
      .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
      .map((s) => ({ ...s, verified: allowed.has(s.url) }));

    out.push({
      ...raw,
      symbol: matched.symbol,          // 대소문자·표기는 우리 값으로 통일
      name: raw.name || matched.name,
      confidence,
      horizon,
      sources,
      sourcesVerified: sources.filter((s) => s.verified).length,
    });
  }

  return { picks: out, dropped };
}

const round2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const round4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
const pctOf = (v) => `${(v * 100).toFixed(1)}%`;
const fmt = (v) => (v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2));

module.exports = { validatePicks, edgeOf, roundTripCostPerShare, CONFIDENCE, HORIZON, US_COST_BPS };
