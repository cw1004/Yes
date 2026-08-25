'use strict';
/**
 * AI 추천 종목 3선 엔진 (다중 프로바이더 합의).
 *
 * 흐름:
 *   1) 지표 스크리닝  — 자체 신호 엔진이 유니버스를 전수 계산해 후보를 추린다 (측정된 사실)
 *   2) 정보 수집      — 글로벌 금융 RSS + 종목별 헤드라인을 모은다
 *   3) 모델 분석      — 사용 가능한 AI 엔진(Claude / Llama)에 같은 후보·같은 뉴스를 주고 각자 3종목을 받는다
 *                       Claude 는 여기에 더해 서버측 웹 검색으로 직접 조사한다
 *   4) 합의 계산      — 여러 엔진이 겹쳐 고른 종목을 우선한다. 한 곳만 고른 종목은 그렇게 표시한다
 *   5) 성과 기록      — 추천 시점 가격과 함께 저장해 나중에 실제로 맞았는지 채점한다
 *
 * 원칙: 종목은 후보 목록 안에서만, 숫자는 우리 엔진 계산값만, 근거에는 출처 URL을.
 */

const screener = require('./screener');
const news = require('./news');
const providers = require('./providers');
const tracker = require('./tracker');

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

  // 1) 후보 스크리닝
  const scan = await screener.screen(market, {
    symbols: market === 'US' ? opts.symbols : undefined,
    codes: market === 'KR' ? opts.symbols : undefined,
    limit: 10,
  });
  if (!scan.candidates.length) {
    throw new Error('후보 종목을 만들지 못했습니다. 시세 조회에 실패했을 수 있습니다.');
  }

  // 2) 어떤 엔진을 쓸 수 있는지
  let impls = opts._providerImpls || await providers.readyProviders();
  if (opts.providers && opts.providers.length) {
    impls = impls.filter((p) => opts.providers.includes(p.name));
  }
  if (!impls.length) {
    return finish(key, withTracking(fallbackPicks(scan, market, horizon, risk)));
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

  // 4) 각 엔진에 동시에 물어본다
  const ctx = { scan, news: collected, newsText, market, horizon, risk, client: opts.client };
  const settled = await Promise.allSettled(impls.map((p) => p.analyze(ctx)));

  const outputs = [];
  const failures = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') outputs.push(r.value);
    else failures.push({ provider: impls[i].name, label: impls[i].label, error: String(r.reason && r.reason.message || r.reason) });
  });

  if (!outputs.length) {
    const why = failures.map((f) => `${f.label}: ${f.error}`).join(' / ');
    const fb = fallbackPicks(scan, market, horizon, risk);
    fb.marketContext = `모든 AI 엔진 호출이 실패해 지표만으로 정렬했습니다. (${why})`;
    fb.failures = failures;
    return finish(key, withTracking(fb));
  }

  // 5) 합의 계산 + 결과 조립
  const result = merge({ outputs, failures, scan, market, horizon, risk, news: collected });
  return finish(key, withTracking(result));
}

/* ------------------------------------------------------------------ 합의 */

/**
 * 여러 엔진의 추천을 합친다.
 * 겹쳐 고른 종목을 우선하고, 같은 표수면 각 엔진에서의 순위 평균이 높은 쪽을 앞에 둔다.
 */
function merge({ outputs, failures, scan, market, horizon, risk, news: collected }) {
  const bySymbol = new Map(scan.candidates.map((c) => [String(c.symbol).toUpperCase(), c]));
  const votes = new Map();

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
