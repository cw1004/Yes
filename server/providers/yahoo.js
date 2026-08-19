'use strict';
/**
 * Yahoo Finance 공개 차트 엔드포인트 래퍼 (API 키 불필요).
 * - /v8/finance/chart/{symbol} : 캔들 + 메타(현재가/전일종가 등)
 * - /v1/finance/search         : 심볼 검색
 * 네트워크가 차단된 환경에서는 호출부(server.js)가 mock 데이터로 대체한다.
 */

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getJSON(path, timeoutMs = 9000) {
  let lastErr;
  for (const host of HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('upstream unavailable');
}

/** 야후 응답을 앱 내부 캔들 포맷으로 변환 */
function normalizeChart(json) {
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) {
    const msg = json && json.chart && json.chart.error && json.chart.error.description;
    throw new Error(msg || 'no chart data');
  }
  const ts = result.timestamp || [];
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const adj =
    (result.indicators && result.indicators.adjclose && result.indicators.adjclose[0]) || null;

  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open ? q.open[i] : null;
    const h = q.high ? q.high[i] : null;
    const l = q.low ? q.low[i] : null;
    const c = q.close ? q.close[i] : null;
    if (o == null || h == null || l == null || c == null) continue; // 결측 봉 제거
    candles.push({
      t: ts[i] * 1000,
      o: +o,
      h: +h,
      l: +l,
      c: +c,
      v: q.volume && q.volume[i] != null ? +q.volume[i] : 0,
      a: adj && adj.adjclose && adj.adjclose[i] != null ? +adj.adjclose[i] : undefined,
    });
  }

  const m = result.meta || {};
  const last = candles[candles.length - 1];
  return {
    symbol: m.symbol || '',
    interval: m.dataGranularity || '',
    source: 'yahoo',
    meta: {
      symbol: m.symbol || '',
      name: m.longName || m.shortName || m.symbol || '',
      currency: m.currency || 'USD',
      exchange: m.fullExchangeName || m.exchangeName || '',
      timezone: m.exchangeTimezoneName || 'America/New_York',
      price: m.regularMarketPrice != null ? m.regularMarketPrice : last ? last.c : null,
      previousClose:
        m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose != null ? m.previousClose : null,
      dayHigh: m.regularMarketDayHigh != null ? m.regularMarketDayHigh : null,
      dayLow: m.regularMarketDayLow != null ? m.regularMarketDayLow : null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh != null ? m.fiftyTwoWeekHigh : null,
      fiftyTwoWeekLow: m.fiftyTwoWeekLow != null ? m.fiftyTwoWeekLow : null,
      marketState: m.marketState || '',
      regularMarketVolume: m.regularMarketVolume != null ? m.regularMarketVolume : null,
    },
    candles,
  };
}

async function chart(symbol, interval, range) {
  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}` +
    `&includePrePost=false&events=div%2Csplit`;
  const out = normalizeChart(await getJSON(path));
  out.interval = interval;
  out.range = range;
  return out;
}

/** 관심종목 시세: quote API는 crumb를 요구하므로 chart meta로 대체 */
async function quote(symbol) {
  const data = await chart(symbol, '5m', '1d');
  const m = data.meta;
  const prev = m.previousClose;
  const price = m.price;
  return {
    symbol: m.symbol || symbol.toUpperCase(),
    name: m.name,
    price,
    previousClose: prev,
    change: price != null && prev != null ? price - prev : null,
    changePercent: price != null && prev ? ((price - prev) / prev) * 100 : null,
    source: data.source,
    spark: data.candles.slice(-60).map((c) => c.c),
  };
}

async function search(q) {
  const json = await getJSON(
    `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`
  );
  const quotes = (json && json.quotes) || [];
  return quotes
    .filter((x) => x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || '',
      exchange: x.exchDisp || x.exchange || '',
      type: x.quoteType || '',
    }));
}

module.exports = { chart, quote, search };
