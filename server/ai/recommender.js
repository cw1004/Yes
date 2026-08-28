'use strict';
/**
 * AI 추천 종목 3선 엔진 (다중 프로바이더 합의).
 *
 * 흐름:
 *   1) 지표 스크리닝  — 자체 신호 엔진이 유니버스를 전수 계산해 후보를 추린다 (측정된 사실)
 *   2) 정보 수집      — 글로벌 금융 RSS + 종목별 헤드라인을 모은다
 *   3) 모델 분석      — 사용 가능한 AI 엔진(Claude / Llama)에 같은 후보·같은 뉴스를 주고 각자 3종목을 받는다
 *                       Claude 는 여기에 더해 서버측 웹 검색으로 직접 조사한다
 *   4) 검증          — 후보에 없는 종목(환각)을 떨어뜨리고, 출처 URL이 실제 목록에 있었는지 표시한다
 *   5) 기대값 계산    — 비용을 넘지 못하는 계획을 걸러 내고, 필요 승률과 실측 승률을 비교한다
 *   6) 합의 계산      — 여러 엔진이 겹쳐 고른 종목을 우선한다. 한 곳만 고른 종목은 그렇게 표시한다
 *   7) 성과 기록      — 추천 시점 가격과 함께 저장해 나중에 실제로 맞았는지 채점한다
 *
 * 원칙: 종목은 후보 목록 안에서만, 숫자는 우리 엔진 계산값만, 근거에는 출처 URL을.
 *       그리고 **살 만한 게 없으면 없다고 말한다.** 억지로 3개를 채우지 않는다.
 */

const screener = require('./screener');
const news = require('./news');
const providers = require('./providers');
const tracker = require('./tracker');
const validate = require('./validate');
const reliability = require('./reliability');
const budget = require('./budget');
const scanner = require('./scanner');

const cache = new Map();
const CACHE_TTL = Number(process.env.AI_CACHE_TTL_MS || 600000); // 10분
const NEWS_ENABLED = process.env.NEWS_ENABLED !== '0';

/* ------------------------------------------------------------------ 본체 */

/**
 * @param {{market:'US'|'KR', horizon?:string, risk?:string, symbols?:string[], force?:boolean,
 *          providers?:string[], _providerImpls?:Array, _news?:object}} opts
 */
async function recommend(opts = {}) {
  const market = opts.market === 'KR' ? 'KR' : 'US';
  const horizon = opts.horizon || '당일~2일 단타';
  const risk = opts.risk || '중립';

  const key = [market, horizon, risk, (opts.symbols || []).join('|'), (opts.providers || []).join('|')].join(':');
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expires) return { ...hit.value, cached: true };
  }

  // 1) 후보 스크리닝 — 실시간 스캐너가 돌고 있으면 그 결과(단타 적합도 포함)를 함께 쓴다
  const scan = await buildScan(market, opts);
  if (!scan.candidates.length) {
    throw new Error('후보 종목을 만들지 못했습니다. 시세 조회에 실패했을 수 있습니다.');
  }

  // 2) 어떤 엔진을 쓸 수 있는지
  let impls = opts._providerImpls || await providers.readyProviders();
  if (opts.providers && opts.providers.length) {
    impls = impls.filter((p) => opts.providers.includes(p.name));
  }
  if (!impls.length) {
    return finish(key, withTracking(withEdge(fallbackPicks(scan, market, horizon, risk))));
  }

  // 2-b) 비용 관문 — 오늘 쓸 예산이 남아 있는가 (모델 호출은 실제 요금이 나간다)
  const money = opts._skipBudget ? { ok: true } : budget.check();
  if (!money.ok) {
    const fb = fallbackPicks(scan, market, horizon, risk);
    fb.marketContext = `${money.reason}\n오늘은 AI 없이 지표만으로 정렬한 결과입니다.`;
    fb.budgetBlocked = money.reason;
    return finish(key, withTracking(withEdge(fb)));
  }

  // 3) 정보 수집
  let collected = opts._news;
  if (!collected && NEWS_ENABLED) {
    try {
      collected = await news.collect({ market, symbols: scan.candidates.map((c) => c.symbol) });
    } catch (err) {
      collected = { empty: true, error: err.message, marketNews: [], perSymbol: {}, feedsOk: 0, feedsTried: 0 };
    }
  }
  const newsText = collected && !collected.empty ? news.toPromptText(collected) : '';

  // 4) 각 엔진에 동시에 물어본다 (시간 제한·재시도·서킷 브레이커를 두르고)
  const ctx = {
    scan, news: collected, newsText, market, horizon, risk, client: opts.client,
    costs: costTable(scan, market),
    trackRecord: opts._trackRecord || safeCalibration(),
  };
  const settled = await Promise.allSettled(
    impls.map((p) => (opts._raw ? p.analyze(ctx) : reliability.guardedAnalyze(p, ctx)))
  );

  const outputs = [];
  const failures = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') outputs.push(r.value);
    else {
      failures.push({
        provider: impls[i].name,
        label: impls[i].label,
        error: String(r.reason && r.reason.message || r.reason),
        breakerOpen: Boolean(r.reason && r.reason.breakerOpen),
      });
    }
  });

  // 실제로 쓴 비용을 예산에 기록한다 (실패한 호출도 토큰은 나갔을 수 있다)
  const spentUsd = outputs.reduce((a, o) => a + ((o.usage && o.usage.estimatedCostUsd) || 0), 0);
  if (spentUsd > 0 && !opts._skipBudget) budget.spend(spentUsd);

  if (!outputs.length) {
    const why = failures.map((f) => `${f.label}: ${f.error}`).join(' / ');
    const fb = fallbackPicks(scan, market, horizon, risk);
    fb.marketContext = `모든 AI 엔진 호출이 실패해 지표만으로 정렬했습니다. (${why})`;
    fb.failures = failures;
    return finish(key, withTracking(withEdge(fb)));
  }

  // 5) 검증 → 6) 합의 → 7) 기대값
  const result = merge({ outputs, failures, scan, market, horizon, risk, news: collected });
  return finish(key, withTracking(withEdge(result)));
}

/* ----------------------------------------------------------- 후보 만들기 */

/**
 * 실시간 스캐너가 이미 돌고 있으면 그 결과를 쓴다.
 * 스캐너는 "지금 움직이는 종목"을 알고 있어서 정적인 스크리닝보다 단타에 맞는다.
 * 스캐너가 비어 있으면(=아직 안 켰거나 방금 시작) 기존 스크리너로 돌아간다.
 */
async function buildScan(market, opts) {
  if (!opts.symbols || !opts.symbols.length) {
    try {
      const live = scanner.get().marketView(market, 10);
      // 결과가 신선할 때만 (2분 이내)
      if (live && live.top && live.top.length >= 3 && Date.now() - live.asOf < 120000) {
        return {
          market,
          asOf: live.asOf,
          source: live.source,
          phase: live.phase,
          scanned: live.scanned,
          fromScanner: true,
          fitNote:
            'fit(단타 적합도 0~100)과 grade 는 유동성·변동성·비용·모멘텀을 종합한 값입니다. ' +
            'fit 이 낮은 종목은 방향이 맞아도 단타로는 비용을 넘기 어렵습니다.',
          candidates: live.top,
        };
      }
    } catch (_) { /* 스캐너가 없으면 그냥 스크리너로 */ }
  }
  const scan = await screener.screen(market, {
    symbols: market === 'US' ? opts.symbols : undefined,
    codes: market === 'KR' ? opts.symbols : undefined,
    limit: 10,
  });
  scan.fromScanner = false;
  return scan;
}

/** 후보별 왕복 비용과 본전 변동폭 — 프롬프트에 넣어 비용을 못 넘는 아이디어를 막는다 */
function costTable(scan, market) {
  return scan.candidates
    .filter((c) => c.price > 0)
    .map((c) => {
      const cost = validate.roundTripCostPerShare(c.price, market);
      return {
        symbol: c.symbol,
        price: c.price,
        costPerShare: Math.round(cost * 1e4) / 1e4,
        breakevenMovePct: (cost / c.price) * 100,
      };
    });
}

function safeCalibration() {
  try { return tracker.calibration(); } catch (_) { return null; }
}

/* -------------------------------------------------------------- 기대값 */

/**
 * 각 추천에 기대값 판정을 붙이고, 전체 요약을 만든다.
 * 여기가 "억지로 사지 않게 하는" 마지막 관문이다.
 */
function withEdge(result) {
  const market = result.market;
  for (const p of result.picks || []) {
    const plan = p.snapshot && p.snapshot.plan;
    if (!plan) {
      p.edge = { ok: false, verdict: 'hold', reason: '매매 계획이 없어 기대값을 계산할 수 없습니다.' };
      continue;
    }
    const hit = tracker.hitProbFor({ confidence: p.confidence, market });
    p.edge = validate.edgeOf({
      entry: plan.entry, stop: plan.stop, target: plan.target,
      side: plan.side, market,
    }, hit);
  }

  const takes = (result.picks || []).filter((p) => p.edge && p.edge.verdict === 'take');
  const rejects = (result.picks || []).filter((p) => p.edge && p.edge.verdict === 'reject');
  result.edgeSummary = {
    take: takes.length,
    hold: (result.picks || []).length - takes.length - rejects.length,
    reject: rejects.length,
    // 기대값이 양수인 게 하나도 없으면 그렇게 말한다. 안 사는 것도 판단이다.
    verdict: takes.length ? 'act' : rejects.length === (result.picks || []).length && rejects.length
      ? 'avoid' : 'wait',
    note: takes.length
      ? `${takes.length}종목이 기대값 양수입니다.`
      : (result.picks || []).length
        ? '기대값이 확실히 양수인 종목이 없습니다. 관망하거나 소액으로만 접근하세요.'
        : '오늘은 기준을 넘는 종목이 없습니다.',
  };
  // 기대값이 좋은 순으로 다시 정렬 (같으면 원래 순서 유지)
  const rank = { take: 0, hold: 1, reject: 2 };
  (result.picks || []).sort((a, b) => {
    const ra = rank[(a.edge && a.edge.verdict) || 'hold'];
    const rb = rank[(b.edge && b.edge.verdict) || 'hold'];
    if (ra !== rb) return ra - rb;
    const ea = (a.edge && a.edge.evPct) ?? -Infinity;
    const eb = (b.edge && b.edge.evPct) ?? -Infinity;
    return eb - ea;
  });
  return result;
}

/* ------------------------------------------------------------------ 합의 */

/**
 * 여러 엔진의 추천을 합친다.
 * 겹쳐 고른 종목을 우선하고, 같은 표수면 각 엔진에서의 순위 평균이 높은 쪽을 앞에 둔다.
 */
function merge({ outputs, failures, scan, market, horizon, risk, news: collected }) {
  const bySymbol = new Map(scan.candidates.map((c) => [String(c.symbol).toUpperCase(), c]));
  const votes = new Map();

  // 우리가 실제로 건네준 URL 목록 — 출처가 이 안에 있으면 '확인됨'으로 표시한다
  const allowedUrls = collectUrls(collected);

  // ① 검증: 후보에 없는 종목(환각)·중복·잘못된 열거값을 여기서 떨어뜨린다
  const dropped = [];
  outputs.forEach((out) => {
    const v = validate.validatePicks(out.picks, { candidates: scan.candidates, allowedUrls, market });
    out.picks = v.picks;
    for (const d of v.dropped) dropped.push({ ...d, provider: out.provider, label: out.label });
  });

  outputs.forEach((out) => {
    (out.picks || []).slice(0, 3).forEach((pick, rank) => {
      const sym = String(pick.symbol || '').toUpperCase();
      if (!sym) return;
      if (!votes.has(sym)) votes.set(sym, { symbol: sym, entries: [] });
      votes.get(sym).entries.push({ provider: out.provider, label: out.label, model: out.model, rank, pick });
    });
  });

  const ranked = Array.from(votes.values()).sort((a, b) => {
    if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length;
    const avg = (x) => x.entries.reduce((s, e) => s + e.rank, 0) / x.entries.length;
    if (avg(a) !== avg(b)) return avg(a) - avg(b);
    const score = (x) => (bySymbol.get(x.symbol) ? bySymbol.get(x.symbol).score : -999);
    return score(b) - score(a);
  });

  const picks = ranked.slice(0, 3).map((v) => {
    // 대표 서술은 먼저 성공한 엔진(우선순위상 Claude) 것을 쓰고, 나머지는 비교용으로 남긴다
    const primary = v.entries[0];
    const matched = bySymbol.get(v.symbol);
    const p = primary.pick;
    return {
      symbol: p.symbol,
      name: p.name || (matched && matched.name) || p.symbol,
      thesis: p.thesis,
      catalysts: p.catalysts || [],
      risks: p.risks || [],
      confidence: p.confidence,
      horizon: p.horizon,
      expectedMovePct: typeof p.expectedMovePct === 'number' ? p.expectedMovePct : null,
      invalidation: p.invalidation || null,
      sources: dedupeSources(v.entries.flatMap((e) => e.pick.sources || [])),
      consensus: {
        votes: v.entries.length,
        total: outputs.length,
        agreed: v.entries.length === outputs.length && outputs.length > 1,
        providers: v.entries.map((e) => e.provider),
        labels: v.entries.map((e) => e.label),
      },
      // 엔진별 서술을 나란히 보관 (의견이 갈리는 지점을 사용자가 직접 볼 수 있게)
      perProvider: v.entries.map((e) => ({
        provider: e.provider, label: e.label, model: e.model, rank: e.rank + 1,
        thesis: e.pick.thesis, confidence: e.pick.confidence, horizon: e.pick.horizon,
      })),
      inCandidates: Boolean(matched),
      snapshot: matched ? {
        price: matched.price,
        changePercent: matched.changePercent,
        score: matched.score,
        label: matched.label,
        technicals: matched.technicals,
        plan: matched.plan,
        topReasons: matched.topReasons,
      } : null,
    };
  });

  const usage = outputs.reduce((acc, o) => ({
    input_tokens: acc.input_tokens + (o.usage.input_tokens || 0),
    output_tokens: acc.output_tokens + (o.usage.output_tokens || 0),
    estimatedCostUsd: round6((acc.estimatedCostUsd || 0) + (o.usage.estimatedCostUsd || 0)),
  }), { input_tokens: 0, output_tokens: 0, estimatedCostUsd: 0 });

  return {
    market, horizon, risk,
    generatedAt: Date.now(),
    engine: 'ai',
    model: outputs.map((o) => o.model).join(' + '),
    engines: outputs.map((o) => ({
      provider: o.provider, label: o.label, model: o.model,
      marketContext: o.marketContext,
      picks: (o.picks || []).map((p) => p.symbol),
      webSearches: o.webSearches || 0,
      usage: o.usage,
    })),
    failures,
    // 모델이 지어냈거나 규격에 안 맞아 버려진 항목 — 숨기지 않고 그대로 보여 준다
    dropped,
    // 3개를 채우지 않았다면 그 이유 (엔진별)
    passReasons: outputs
      .filter((o) => o.passReason)
      .map((o) => ({ provider: o.provider, label: o.label, reason: o.passReason })),
    reliability: reliability.status(),
    marketContext: outputs[0].marketContext || '',
    picks,
    dataSource: scan.source,
    scanned: scan.scanned,
    candidates: scan.candidates,
    news: collected ? {
      feedsOk: collected.feedsOk, feedsTried: collected.feedsTried,
      articles: collected.marketNews.length,
      symbolsWithNews: Object.keys(collected.perSymbol || {}).length,
      error: collected.error || null,
      top: collected.marketNews.slice(0, 12),
    } : null,
    webSearches: outputs.reduce((a, o) => a + (o.webSearches || 0), 0),
    usage,
    disclaimer: '이 결과는 공개 정보와 기술적 지표를 AI가 정리한 참고 자료이며 투자 권유가 아닙니다. 최종 판단과 책임은 투자자 본인에게 있습니다.',
  };
}

/** 우리가 모델에게 실제로 건네준 기사 URL 전체 */
function collectUrls(collected) {
  const set = new Set();
  if (!collected) return set;
  for (const a of collected.marketNews || []) if (a && a.url) set.add(a.url);
  for (const list of Object.values(collected.perSymbol || {})) {
    for (const a of list || []) if (a && a.url) set.add(a.url);
  }
  return set;
}

function dedupeSources(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (!s || !s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

/* -------------------------------------------------------------- 대체 경로 */

/** 쓸 수 있는 AI 엔진이 없을 때: 지표 점수 상위 3종목 (AI 분석 없음을 명시) */
function fallbackPicks(scan, market, horizon, risk) {
  const picks = scan.candidates.slice(0, 3).map((c) => ({
    symbol: c.symbol,
    name: c.name,
    thesis: `자체 기술적 신호 ${c.score}점(${c.label}). 근거: ${c.topReasons.join(', ') || '지표 중립'}. ` +
      'AI 뉴스 분석이 적용되지 않은 순수 지표 기반 결과입니다.',
    catalysts: c.topReasons,
    risks: ['뉴스·실적 등 기본적 요인이 반영되지 않았습니다.', '기술적 신호는 시장 급변 시 빠르게 무효화될 수 있습니다.'],
    confidence: '낮음',
    horizon: '당일',
    expectedMovePct: null,
    invalidation: null,
    sources: [],
    consensus: { votes: 0, total: 0, agreed: false, providers: ['rules'], labels: ['지표 전용'] },
    perProvider: [],
    inCandidates: true,
    snapshot: {
      price: c.price, changePercent: c.changePercent, score: c.score, label: c.label,
      technicals: c.technicals, plan: c.plan, topReasons: c.topReasons,
    },
  }));

  return {
    market, horizon, risk,
    generatedAt: Date.now(),
    engine: 'rules',
    model: null,
    engines: [],
    failures: [],
    marketContext:
      '사용 가능한 AI 엔진이 없어 기술적 지표만으로 상위 3종목을 정렬했습니다. ' +
      'ANTHROPIC_API_KEY 를 넣거나 Llama 엔드포인트를 연결하면 뉴스 분석이 켜집니다.',
    dropped: [],
    passReasons: [],
    reliability: reliability.status(),
    picks,
    dataSource: scan.source,
    scanned: scan.scanned,
    candidates: scan.candidates,
    news: null,
    webSearches: 0,
    usage: null,
    disclaimer: '이 결과는 기술적 지표 계산 결과이며 투자 권유가 아닙니다. 최종 판단과 책임은 투자자 본인에게 있습니다.',
  };
}

/* ------------------------------------------------------------------ 공통 */

function withTracking(result) {
  try {
    result.tracked = tracker.record(result);
  } catch (_) { /* 기록 실패가 추천을 막지 않는다 */ }
  return result;
}

function finish(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

const round6 = (v) => (isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

/** 어떤 엔진이 준비됐는지 (라우트/화면용) */
const hasAnyProvider = async () => (await providers.readyProviders()).length > 0;

module.exports = { recommend, merge, fallbackPicks, hasAnyProvider, providers, tracker };
