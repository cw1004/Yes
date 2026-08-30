'use strict';
/**
 * 후보 종목 스크리너.
 *
 * AI에게 "아무 종목이나 골라줘"라고 맡기면 근거 없는 추천이 나오기 쉽다.
 * 그래서 먼저 우리 지표 엔진으로 유니버스를 훑어 **측정된 사실**(추세·모멘텀·거래량·변동성)로
 * 후보를 추리고, AI에게는 그 후보와 실제 수치를 넘긴다.
 * AI는 여기에 최신 뉴스·시장 맥락을 웹에서 확인해 3종목을 고르는 역할만 한다.
 */

const marketdata = require('../marketdata');
const Signals = require('../../public/js/signals.js');
const KRSignal = require('../../public/js/kr-signal.js');
const KRC = require('../kr/config');

/** 미국 기본 유니버스 — 거래가 활발해 단타가 가능한 대형주·ETF 중심 */
const US_UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO',
  'AMD', 'NFLX', 'CRM', 'ADBE', 'MU', 'INTC', 'QCOM', 'PLTR',
  'COIN', 'SMCI', 'ARM', 'UBER', 'DIS', 'JPM', 'XOM', 'LLY',
  'SPY', 'QQQ', 'IWM',
];

/** 한국 기본 유니버스 */
const KR_UNIVERSE = [
  '005930', '000660', '373220', '005380', '035420', '035720',
  '247540', '086520', '196170', '042700', '005490', '068270',
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 동시 실행 수를 제한해 상방 API 유량을 지킨다 */
async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]);
        if (value) out.push(value);
      } catch (_) { /* 개별 종목 실패는 건너뛴다 */ }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 미국 종목 스크리닝.
 * @returns {Promise<{market:'US', asOf:number, source:string, candidates:Array}>}
 */
async function screenUS(opts = {}) {
  const symbols = (opts.symbols && opts.symbols.length ? opts.symbols : US_UNIVERSE).slice(0, 40);
  const interval = opts.interval || '5m';
  const range = opts.range || '5d';
  const limit = clamp(opts.limit || 10, 3, 20);
  let source = 'yahoo';

  const rows = await mapLimit(symbols, 4, async (symbol) => {
    const data = await marketdata.getCandles(symbol, interval, range);
    if (data.source === 'mock') source = 'mock';
    if (!data.candles || data.candles.length < 60) return null;

    const analysis = Signals.analyze(data.candles, { intraday: interval !== '1d' });
    const signal = Signals.evaluate(analysis);
    const st = signal.stats;
    const m = data.meta;
    const price = st.price;
    const prev = m.previousClose;

    return {
      symbol: data.symbol || symbol,
      name: m.name || symbol,
      price,
      changePercent: prev ? ((price - prev) / prev) * 100 : null,
      score: signal.score,
      label: signal.label,
      // AI에게 넘길 "측정된 사실"만 담는다
      technicals: {
        rsi14: round(st.rsi, 1),
        macdHist: round(st.macdHist, 4),
        percentB: round(st.percentB, 3),
        bbWidthRank: round(st.bbWidthRank, 0),
        atrPct: round(st.atrPct, 2),
        volumeRatio: round(st.volRatio, 2),
        vwapGapPct: st.vwap ? round(((price - st.vwap) / st.vwap) * 100, 2) : null,
        pattern: st.pattern ? st.pattern.name : null,
        nearestSupport: st.nearest && st.nearest.support ? round(st.nearest.support.price, 2) : null,
        nearestResistance: st.nearest && st.nearest.resistance ? round(st.nearest.resistance.price, 2) : null,
        dayHigh: m.dayHigh, dayLow: m.dayLow,
        week52High: m.fiftyTwoWeekHigh, week52Low: m.fiftyTwoWeekLow,
      },
      topReasons: signal.reasons.filter((r) => r.weight > 0).slice(0, 4).map((r) => `${r.title}(${r.dir > 0 ? '+' : '-'}${r.weight})`),
      plan: signal.plan ? {
        side: signal.plan.side,
        entry: round(signal.plan.entry, 2),
        stop: round(signal.plan.stop, 2),
        target: round(signal.plan.target1, 2),
        rr: round(signal.plan.rr, 2),
      } : null,
    };
  });

  rows.sort((a, b) => b.score - a.score);
  return {
    market: 'US',
    asOf: Date.now(),
    source,
    interval,
    scanned: symbols.length,
    candidates: rows.slice(0, limit),
  };
}

/**
 * 한국 종목 스크리닝. KIS 클라이언트(실전/모의/데모)를 그대로 쓴다.
 */
async function screenKR(opts = {}) {
  const { init } = require('../kr/routes');
  const { client, mode } = init();
  const codes = (opts.codes && opts.codes.length ? opts.codes : KR_UNIVERSE).slice(0, 20);
  const limit = clamp(opts.limit || 10, 3, 20);

  const rows = await mapLimit(codes, 2, async (code) => {
    const [quote, minutes] = await Promise.all([
      client.price(code),
      client.minuteCandles(code, 200),
    ]);
    if (!minutes || minutes.length < 60) return null;

    const analysis = KRSignal.analyze(minutes);
    const signal = KRSignal.evaluate(analysis, {
      quote,
      market: quote.market || 'KOSPI',
      phase: KRC.marketPhase(),
      barSeconds: 60,   // 스크리닝은 1분봉 기준
    });
    const st = signal.stats;

    return {
      symbol: code,
      name: quote.name || code,
      price: quote.price,
      changePercent: round(quote.changePercent, 2),
      score: signal.score,
      label: signal.label,
      technicals: {
        rsi14: round(st.rsi, 1),
        macdHist: round(st.macdHist, 4),
        percentB: round(st.percentB, 3),
        atrPct: round(st.atrPct, 2),
        volumeRatio: round(st.volRatio, 2),
        vwapGapPct: st.vwap ? round(((st.price - st.vwap) / st.vwap) * 100, 2) : null,
        strength: round(quote.strength, 0),
        tickSize: KRC.tickSize(quote.price, quote.market || 'KOSPI'),
        breakevenTicks: st.breakevenTicks,
        isEtf: KRC.isEtfName(quote.name),
        // 거래세 면제 여부까지 반영한 실제 본전 매도가
        breakevenPrice: KRC.breakevenPrice({
          buyPrice: quote.price, qty: 1,
          market: quote.market || 'KOSPI', isEtf: KRC.isEtfName(quote.name),
        }).price,
        upperLimit: quote.upperLimit,
        lowerLimit: quote.lowerLimit,
        dayHigh: quote.high, dayLow: quote.low,
      },
      topReasons: signal.reasons.filter((r) => r.weight > 0).slice(0, 4).map((r) => `${r.title}(${r.dir > 0 ? '+' : '-'}${r.weight})`),
      plan: signal.plan ? {
        side: signal.plan.side,
        entry: signal.plan.entry,
        stop: signal.plan.stop,
        target: signal.plan.target,
        stopTicks: signal.plan.stopTicks,
        targetTicks: signal.plan.targetTicks,
        rr: round(signal.plan.rr, 2),
      } : null,
    };
  });

  rows.sort((a, b) => b.score - a.score);
  return {
    market: 'KR',
    asOf: Date.now(),
    source: mode,
    phase: KRC.marketPhase(),
    scanned: codes.length,
    candidates: rows.slice(0, limit),
  };
}

function round(v, digits) {
  if (v == null || !isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const screen = (market, opts) => (market === 'KR' ? screenKR(opts) : screenUS(opts));

module.exports = { screen, screenUS, screenKR, US_UNIVERSE, KR_UNIVERSE };
