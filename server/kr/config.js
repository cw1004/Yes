'use strict';
/**
 * 한국투자증권(KIS) OpenAPI 설정과 한국 시장 상수 — 전부 이 파일 한 곳에 모았다.
 *
 * ⚠️ TR_ID와 엔드포인트는 KIS가 개정할 때마다 바뀐다.
 *    주문이 `EGW00xxx` 류 오류로 거절되면 KIS 개발자포털의 최신 문서와 아래 값을 대조하고
 *    이 파일만 고치면 된다 (다른 코드는 전부 이 상수를 참조한다).
 */

const REAL = {
  name: '실전',
  rest: 'https://openapi.koreainvestment.com:9443',
  ws: 'ws://ops.koreainvestment.com:21000',
  // 실전 유량: REST 초당 20건
  restPerSecond: 20,
};

const PAPER = {
  name: '모의',
  rest: 'https://openapivts.koreainvestment.com:29443',
  ws: 'ws://ops.koreainvestment.com:31000',
  // 모의 유량: REST 초당 2건
  restPerSecond: 2,
};

/** 실전/모의에 따라 앞글자가 T(실전) / V(모의) 로 갈리는 TR_ID */
const TR = {
  // 시세 (실전·모의 공통)
  price: 'FHKST01010100',            // 주식현재가 시세
  orderbook: 'FHKST01010200',        // 주식현재가 호가/예상체결
  minuteChart: 'FHKST03010200',      // 주식당일분봉조회 (1분 단위, 30건씩)
  dailyChart: 'FHKST03010100',       // 국내주식기간별시세(일/주/월)

  // 실시간 (WebSocket)
  wsTrade: 'H0STCNT0',               // 실시간 체결가
  wsOrderbook: 'H0STASP0',           // 실시간 호가
  wsNoticeReal: 'H0STCNI0',          // 실시간 체결통보 (실전)
  wsNoticePaper: 'H0STCNI9',         // 실시간 체결통보 (모의)

  // 주문/계좌 — 실전 T…, 모의 V…
  //   2025년 개정으로 국내주식 현금주문이 TTTC0012U(매수)/TTTC0011U(매도) 로 바뀌었다는
  //   안내가 있다. 아래 기본값으로 주문이 거절되면 alt 값으로 바꿔 시도할 것.
  orderBuy: { real: 'TTTC0802U', paper: 'VTTC0802U', alt: { real: 'TTTC0012U', paper: 'VTTC0012U' } },
  orderSell: { real: 'TTTC0801U', paper: 'VTTC0801U', alt: { real: 'TTTC0011U', paper: 'VTTC0011U' } },
  orderCancel: { real: 'TTTC0803U', paper: 'VTTC0803U' },
  balance: { real: 'TTTC8434R', paper: 'VTTC8434R' },
  orderable: { real: 'TTTC8908R', paper: 'VTTC8908R' },
  dailyCcld: { real: 'TTTC8001R', paper: 'VTTC8001R' },
};

const PATH = {
  token: '/oauth2/tokenP',
  revoke: '/oauth2/revokeP',
  approval: '/oauth2/Approval',
  hashkey: '/uapi/hashkey',
  price: '/uapi/domestic-stock/v1/quotations/inquire-price',
  orderbook: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
  minuteChart: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
  dailyChart: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
  orderCash: '/uapi/domestic-stock/v1/trading/order-cash',
  orderCancel: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
  balance: '/uapi/domestic-stock/v1/trading/inquire-balance',
  orderable: '/uapi/domestic-stock/v1/trading/inquire-psbl-order',
  dailyCcld: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
};

/** 주문구분(ORD_DVSN) */
const ORD_DVSN = {
  지정가: '00',
  시장가: '01',
  조건부지정가: '02',
  최유리지정가: '03',   // 초단타 진입에 유용 (상대 최우선호가로 즉시 체결)
  최우선지정가: '04',
  장전시간외: '05',
  장후시간외: '06',
  시간외단일가: '07',
};

/* ------------------------------------------------------------------ 시장 상수 */

/**
 * 호가단위(틱). 2023-01-25 개정 기준.
 * 코스닥은 5만원 이상 구간이 100원으로 고정된다.
 */
const TICK_TABLE_KOSPI = [
  [2000, 1], [5000, 5], [20000, 10], [50000, 50],
  [200000, 100], [500000, 500], [Infinity, 1000],
];
const TICK_TABLE_KOSDAQ = [
  [2000, 1], [5000, 5], [20000, 10], [50000, 50], [Infinity, 100],
];

/** 가격에 해당하는 호가단위 */
function tickSize(price, market = 'KOSPI') {
  const table = market === 'KOSDAQ' ? TICK_TABLE_KOSDAQ : TICK_TABLE_KOSPI;
  for (const [limit, tick] of table) if (price < limit) return tick;
  return table[table.length - 1][1];
}

/** 호가단위에 맞춰 가격 정렬 (dir: 'down' 매수쪽, 'up' 매도쪽, 'near' 반올림) */
function alignPrice(price, market = 'KOSPI', dir = 'near') {
  const t = tickSize(price, market);
  const q = price / t;
  const n = dir === 'down' ? Math.floor(q) : dir === 'up' ? Math.ceil(q) : Math.round(q);
  return n * t;
}

/** 두 가격 사이가 몇 호가인지 */
function tickDistance(from, to, market = 'KOSPI') {
  const t = tickSize(Math.min(from, to), market);
  return Math.round((to - from) / t);
}

/**
 * 매매비용(왕복). 기본값은 KIS 온라인 수수료와 2025년 세율 기준이며,
 * 실제 요율은 계좌·이벤트에 따라 다르므로 UI에서 수정할 수 있다.
 */
const COST = {
  commissionRate: 0.00014527,  // 매수·매도 각각 (KIS 영업점/온라인 요율 확인 필요)
  taxSellRate: 0.0015,         // 매도 시 증권거래세+농특세 (코스피/코스닥 0.15%)
  // 유관기관 제비용은 수수료에 포함된 것으로 본다
};

/** 왕복 매매비용(원). 초단타는 이 비용이 수익의 대부분을 갉아먹는다. */
function roundTripCost(price, qty, cost = COST) {
  const buy = price * qty * cost.commissionRate;
  const sell = price * qty * (cost.commissionRate + cost.taxSellRate);
  return buy + sell;
}

/** 비용을 덮으려면 최소 몇 호가가 필요한지 */
function breakevenTicks(price, market = 'KOSPI', cost = COST) {
  const rate = cost.commissionRate * 2 + cost.taxSellRate;
  return Math.ceil((price * rate) / tickSize(price, market));
}

/** 한국 정규장 시간 (KST) */
const SESSION = {
  preOpenStart: '08:30',
  open: '09:00',
  closeAuctionStart: '15:20',
  close: '15:30',
  afterHoursEnd: '18:00',
};

const LIMIT_PCT = 30;      // 상·하한가 ±30%
const STATIC_VI_PCT = 10;  // 정적 VI 발동 기준 ±10%

/** 지금이 정규장인지 (KST 기준) */
function marketPhase(date = new Date()) {
  const kst = new Date(date.getTime() + (9 * 60 + date.getTimezoneOffset()) * 60000);
  const dow = kst.getDay();
  if (dow === 0 || dow === 6) return 'closed';
  const mins = kst.getHours() * 60 + kst.getMinutes();
  const at = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  if (mins < at(SESSION.preOpenStart)) return 'closed';
  if (mins < at(SESSION.open)) return 'preopen';        // 장 시작 동시호가
  if (mins < at(SESSION.closeAuctionStart)) return 'regular';
  if (mins < at(SESSION.close)) return 'closeauction';  // 장 마감 동시호가
  if (mins < at(SESSION.afterHoursEnd)) return 'after';
  return 'closed';
}

/** 초단타에서 쓰는 봉 주기 (초 단위) */
const TIMEFRAMES = {
  '10s': 10, '20s': 20, '30s': 30,
  '1m': 60, '3m': 180, '5m': 300, '10m': 600,
};

module.exports = {
  REAL, PAPER, TR, PATH, ORD_DVSN,
  tickSize, alignPrice, tickDistance,
  COST, roundTripCost, breakevenTicks,
  SESSION, LIMIT_PCT, STATIC_VI_PCT, marketPhase, TIMEFRAMES,
};
