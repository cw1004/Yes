'use strict';
/**
 * 오프라인/데모용 가상 시세 생성기.
 * 외부 네트워크가 막힌 환경에서도 앱 전체 기능(차트·지표·신호)을 확인할 수 있도록
 * 재현 가능한 가격 시계열을 만든다.
 *
 * 핵심: 가격을 "절대 시각의 함수" P(symbol, t) 로 정의한다.
 * 덕분에 조회 기간이나 봉 주기가 달라도 같은 시각의 가격이 항상 일치하고,
 * 관심종목 시세와 차트가 어긋나지 않는다.
 */

const INTERVAL_MS = {
  '1m': 60e3, '2m': 120e3, '5m': 300e3, '15m': 900e3,
  '30m': 1800e3, '60m': 3600e3, '1h': 3600e3, '1d': 86400e3,
};

const RANGE_MS = {
  '1d': 86400e3, '5d': 5 * 86400e3, '1mo': 30 * 86400e3,
  '3mo': 90 * 86400e3, '6mo': 180 * 86400e3, '1y': 365 * 86400e3,
};

/** 데모가 현실적으로 보이도록 주요 티커의 기준가를 지정 (실제 시세 아님) */
const BASE_PRICES = {
  AAPL: 232, MSFT: 428, NVDA: 132, TSLA: 248, AMD: 158, AMZN: 186, GOOGL: 178,
  META: 512, NFLX: 690, AVGO: 172, INTC: 24, MU: 104, PLTR: 42, COIN: 236,
  SMCI: 44, ARM: 128, MSTR: 342, SOFI: 9.4, F: 11.2, BAC: 42,
  SPY: 562, QQQ: 482, DIA: 424, IWM: 218, '^VIX': 15.4, '^GSPC': 5620, '^IXIC': 17800,
};

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 정수 격자 해시 → 0~1 난수 */
function hashN(seed, n) {
  let h = (seed ^ Math.imul(n | 0, 374761393)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/** 1차원 value noise: 정수 격자 사이를 부드럽게 보간 */
function valueNoise(seed, x) {
  const i = Math.floor(x);
  const f = x - i;
  return hashN(seed, i) * (1 - smoothstep(f)) + hashN(seed, i + 1) * smoothstep(f);
}

function basePrice(symbol) {
  const key = symbol.toUpperCase();
  if (BASE_PRICES[key]) return BASE_PRICES[key];
  return 18 + (hash32(key) % 42000) / 100; // 18 ~ 438 달러
}

/** 시각 t 에서의 이론 가격 (여러 주기의 노이즈를 합성) */
function priceAt(symbol, t) {
  const seed = hash32(symbol.toUpperCase());
  const base = basePrice(symbol);
  const hours = t / 3600e3;
  // [주기(시간), 진폭] — 장기 추세부터 초단기 흔들림까지
  const octaves = [
    [1800, 0.26], [420, 0.14], [96, 0.075],
    [22, 0.038], [5, 0.019], [1.1, 0.009], [0.28, 0.0045],
  ];
  let logRet = 0;
  octaves.forEach(([period, amp], k) => {
    logRet += (valueNoise(seed + k * 7919, hours / period) - 0.5) * 2 * amp;
  });
  return base * Math.exp(logRet);
}

/** 미국 정규장(09:30~16:00 ET ≒ 13:30~20:00 UTC, 서머타임 무시) */
function isRegularSession(ms) {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 13 * 60 + 30 && minutes < 20 * 60;
}

/** 하나의 봉 만들기: 시가·종가는 P(t), 고가·저가는 봉 고유 해시로 꼬리 생성 */
function makeCandle(symbol, t, step) {
  const seed = hash32(symbol.toUpperCase() + ':bar');
  const o = priceAt(symbol, t);
  const c = priceAt(symbol, t + step);
  const scale = Math.sqrt(step / 3600e3); // 봉이 길수록 변동폭 확대
  const r1 = hashN(seed, Math.floor(t / step));
  const r2 = hashN(seed + 101, Math.floor(t / step));
  const r3 = hashN(seed + 202, Math.floor(t / step));
  const spread = Math.abs(c - o) + o * 0.0016 * scale * (0.4 + r1);
  const h = Math.max(o, c) + spread * r2 * 0.9;
  const l = Math.min(o, c) - spread * r3 * 0.9;

  // 장 초반/후반 거래량이 많은 U자 패턴
  const d = new Date(t);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes() - (13 * 60 + 30);
  const frac = Math.min(1, Math.max(0, mins / 390));
  const uShape = 0.7 + 1.5 * ((frac - 0.5) ** 2) * 4;
  const baseVol = step >= 86400e3 ? 9e6 : 60000 * (step / 60e3);
  const volume = Math.round(baseVol * uShape * (0.55 + r1 * 1.1) * (1 + Math.abs(c - o) / (o * 0.002 * scale) / 8));

  const round = (v) => +v.toFixed(v >= 100 ? 2 : 3);
  return { t, o: round(o), h: round(h), l: round(l), c: round(c), v: Math.max(1, volume) };
}

/**
 * @returns {{symbol:string, interval:string, range:string, source:'mock', meta:object, candles:Array}}
 */
function generate(symbol, interval, range) {
  const step = INTERVAL_MS[interval] || INTERVAL_MS['5m'];
  const span = RANGE_MS[range] || RANGE_MS['5d'];
  const intraday = step < INTERVAL_MS['1d'];
  const wanted = Math.min(1200, Math.max(120, Math.round(span / step)));

  const stamps = [];
  let cursor = Math.floor(Date.now() / step) * step;
  let guard = 0;
  while (stamps.length < wanted && guard++ < wanted * 14) {
    if (!intraday) {
      const dow = new Date(cursor).getUTCDay();
      if (dow !== 0 && dow !== 6) stamps.push(cursor);
    } else if (isRegularSession(cursor)) {
      stamps.push(cursor);
    }
    cursor -= step;
  }
  stamps.reverse();

  const candles = stamps.map((t) => makeCandle(symbol, t, step));
  const last = candles[candles.length - 1];

  // 전일 종가: 마지막 봉과 UTC 날짜가 다른 직전 봉의 종가
  let previousClose = candles.length > 1 ? candles[candles.length - 2].c : last.c;
  if (intraday && last) {
    const lastDay = new Date(last.t).toISOString().slice(0, 10);
    for (let i = candles.length - 1; i >= 0; i--) {
      if (new Date(candles[i].t).toISOString().slice(0, 10) !== lastDay) {
        previousClose = candles[i].c;
        break;
      }
    }
  }

  const barsPerDay = intraday ? Math.max(1, Math.round(23400e3 / step)) : 1;
  const session = candles.slice(-barsPerDay);

  return {
    symbol: symbol.toUpperCase(),
    interval,
    range,
    source: 'mock',
    meta: {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase() + ' (데모 데이터)',
      currency: 'USD',
      exchange: 'DEMO',
      timezone: 'America/New_York',
      price: last ? last.c : 0,
      previousClose,
      dayHigh: Math.max(...session.map((c) => c.h)),
      dayLow: Math.min(...session.map((c) => c.l)),
      regularMarketVolume: session.reduce((a, c) => a + c.v, 0),
      marketState: 'DEMO',
    },
    candles,
  };
}

module.exports = { generate, priceAt, INTERVAL_MS, RANGE_MS };
