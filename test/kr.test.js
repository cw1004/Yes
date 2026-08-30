'use strict';
/** 한국 시장(초단타) 로직 테스트:  node test/kr.test.js  */

process.env.KR_STATE_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/kr-test-');

const assert = require('assert');
const C = require('../server/kr/config.js');
const { TickAggregator, resample } = require('../server/kr/aggregator.js');
const KRSignal = require('../public/js/kr-signal.js');
const { Trader } = require('../server/kr/trader.js');
const { KisRealtime } = require('../server/providers/kis-ws.js');
const { MockKisClient } = require('../server/providers/kr-mock.js');
const { EventEmitter } = require('events');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/* ------------------------------------------------------------ 시장 상수 */

test('호가단위: 2023년 개정 구간표 (코스피)', () => {
  assert.strictEqual(C.tickSize(1500), 1);
  assert.strictEqual(C.tickSize(3000), 5);
  assert.strictEqual(C.tickSize(12000), 10);
  assert.strictEqual(C.tickSize(30000), 50);
  assert.strictEqual(C.tickSize(74800), 100);
  assert.strictEqual(C.tickSize(300000), 500);
  assert.strictEqual(C.tickSize(800000), 1000);
});

test('호가단위: 코스닥은 5만원 이상 100원 고정', () => {
  assert.strictEqual(C.tickSize(300000, 'KOSDAQ'), 100);
  assert.strictEqual(C.tickSize(800000, 'KOSDAQ'), 100);
  assert.strictEqual(C.tickSize(30000, 'KOSDAQ'), 50);
});

test('가격 정렬: 매수쪽 내림, 매도쪽 올림', () => {
  assert.strictEqual(C.alignPrice(74123, 'KOSPI', 'down'), 74100);
  assert.strictEqual(C.alignPrice(74123, 'KOSPI', 'up'), 74200);
  assert.strictEqual(C.alignPrice(74180, 'KOSPI', 'near'), 74200);
});

test('매매비용: 매수 수수료 + 매도 수수료·거래세', () => {
  const price = 74800;
  const qty = 10;
  const expected = price * qty * C.COST.commissionRate
    + price * qty * (C.COST.commissionRate + C.COST.taxSellRate);
  close(C.roundTripCost(price, qty), expected, 1e-6);
  const be = C.breakevenTicks(price);
  assert.ok(be >= 1 && be <= 5, '7만원대 코스피 본전은 1~5호가');
  assert.ok(be * C.tickSize(price) >= C.roundTripCost(price, 1) - 1e-9, '본전 호가는 비용 이상');
});

test('매매비용: 2026년 증권거래세는 0.20% (코스피 0.05%+농특세 0.15%, 코스닥 0.20%)', () => {
  assert.strictEqual(C.COST.taxSellRate, 0.0020);
  assert.strictEqual(C.sellTaxRate(false), 0.0020, '일반 주식');
  assert.strictEqual(C.sellTaxRate(true), 0, '국내 상장 ETF 는 거래세 면제');
});

test('ETF 판별: 운용사 브랜드로 국내 ETF 를 가려낸다', () => {
  ['KODEX 200', 'TIGER 미국나스닥100', 'KBSTAR 200', 'ACE 미국S&P500', 'HANARO 200']
    .forEach((n) => assert.strictEqual(C.isEtfName(n), true, n));
  ['삼성전자', 'SK하이닉스', 'NAVER', '카카오', 'POSCO홀딩스']
    .forEach((n) => assert.strictEqual(C.isEtfName(n), false, n));
  assert.strictEqual(C.isEtfName(''), false);
  assert.strictEqual(C.isEtfName(null), false);
});

test('브라우저 번들: process 가 없는 환경에서도 그대로 동작한다', () => {
  // public/js/kr-config.js 는 브라우저에서 로드된다. 서버 코드에 process.env 를 쓰면
  // 이 파일 전체가 던져서 KR 화면이 통째로 죽는다 — 실제로 한 번 그렇게 깨졌다.
  const vm = require('vm');
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'public', 'js', 'kr-config.js'), 'utf8');

  const win = {};
  const sandbox = { window: win };              // process 를 일부러 넣지 않는다
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);                // 던지면 여기서 실패한다

  const C = win.KRConfig;
  assert.ok(C, 'window.KRConfig 가 만들어져야 한다');
  // 서버와 같은 값을 내는지까지 확인
  assert.strictEqual(
    C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10025 }).netProfit,
    require('../server/kr/config.js').settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10025 }).netProfit);
  assert.strictEqual(C.breakevenPrice({ buyPrice: 10000, qty: 1000, market: 'KOSPI' }).price, 10030);
  assert.strictEqual(C.isEtfName('KODEX 200'), true);
});

/* ----------------------------------------------- 실제 결제 기준 손익 */

test('결제: 증권사와 같은 방식으로 계산한다 (매수·매도 각각 원 미만 절사)', () => {
  // 10,000원 × 1,000주 → 10,025원
  const r = C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10025 });
  assert.strictEqual(r.buyFee, 363, 'floor(10,000,000 × 0.000036396) = 363');
  assert.strictEqual(r.totalBuyCost, 10000363);
  assert.strictEqual(r.sellFee, 364, 'floor(10,025,000 × 0.000036396) = 364');
  assert.strictEqual(r.sellTax, 20050, 'floor(10,025,000 × 0.0020) = 20,050');
  assert.strictEqual(r.totalSellSettle, 10004586);
  assert.strictEqual(r.netProfit, 4223);
  close(r.netReturnRate, 0.04223, 1e-4);
  assert.strictEqual(r.isProfitable, true);
});

test('결제: ETF 는 거래세가 없어 같은 폭에서 순수익이 훨씬 크다', () => {
  const stock = C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10025, isEtf: false });
  const etf = C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10025, isEtf: true });
  assert.strictEqual(etf.sellTax, 0);
  assert.strictEqual(etf.netProfit - stock.netProfit, 20050, '차이는 딱 거래세만큼');
  assert.ok(etf.netProfit > stock.netProfit * 5);
});

test('결제: 오르고 팔아도 비용 때문에 손해일 수 있다', () => {
  // +0.20% 상승은 왕복 비용(약 0.207%)을 못 넘는다
  const r = C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10020 });
  assert.strictEqual(r.isProfitable, false, '올랐는데도 손실');
  assert.ok(r.netProfit < 0);
});

test('결제: 수량 0이면 0으로 떨어지고 나눗셈이 터지지 않는다', () => {
  const r = C.settlement({ buyPrice: 10000, qty: 0, sellPrice: 20000 });
  assert.strictEqual(r.netProfit, 0);
  assert.strictEqual(r.netReturnRate, 0);
});

/* ------------------------------------------------------- 본전 매도가 */

test('본전가: 호가 단위에 맞춘 "얼마에 팔아야 본전인가"를 낸다', () => {
  const be = C.breakevenPrice({ buyPrice: 10000, qty: 1000, market: 'KOSPI' });
  // 비율만 보면 10,020.x 이지만 1만원대 호가단위는 10원이라 10,020 은 아직 손실이다
  assert.strictEqual(C.tickSize(10000, 'KOSPI'), 10);
  assert.strictEqual(C.settlement({ buyPrice: 10000, qty: 1000, sellPrice: 10020 }).isProfitable, false);
  assert.strictEqual(be.price, 10030, '실제 본전가는 10,030원');
  assert.strictEqual(be.ticks, 3);
  close(be.movePct, 0.3, 1e-9);
  assert.ok(be.net >= 0, '본전가에서는 손해가 아니다');
});

test('본전가: 본전가보다 한 호가 아래는 반드시 손실이다', () => {
  for (const price of [3000, 10000, 74800, 240000]) {
    const be = C.breakevenPrice({ buyPrice: price, qty: 100, market: 'KOSPI' });
    const below = be.price - C.tickSize(be.price, 'KOSPI');
    assert.ok(C.settlement({ buyPrice: price, qty: 100, sellPrice: be.price }).netProfit >= 0,
      price + ': 본전가는 수익 이상');
    assert.ok(C.settlement({ buyPrice: price, qty: 100, sellPrice: below }).netProfit < 0,
      price + ': 한 호가 아래는 손실');
  }
});

test('본전가: ETF 는 거래세가 없어 본전가가 훨씬 낮다', () => {
  const stock = C.breakevenPrice({ buyPrice: 10000, qty: 1000, market: 'KOSPI', isEtf: false });
  const etf = C.breakevenPrice({ buyPrice: 10000, qty: 1000, market: 'KOSPI', isEtf: true });
  assert.ok(etf.price < stock.price, `ETF ${etf.price} < 일반 ${stock.price}`);
  assert.strictEqual(etf.ticks, 1, 'ETF 는 1호가만 올라도 본전을 넘는다');
});

test('본전가: 수수료율을 낮추면 본전가도 내려간다', () => {
  const cheap = { commissionRate: 0.000036396, taxSellRate: 0.0020, etfTaxSellRate: 0 };
  const pricey = { commissionRate: 0.0015, taxSellRate: 0.0020, etfTaxSellRate: 0 };
  const a = C.breakevenPrice({ buyPrice: 50000, qty: 100, market: 'KOSPI', cost: cheap });
  const b = C.breakevenPrice({ buyPrice: 50000, qty: 100, market: 'KOSPI', cost: pricey });
  assert.ok(a.price < b.price, `우대 ${a.price} < 일반 ${b.price}`);
});

test('장 운영 시간 판정 (KST)', () => {
  const kst = (h, m, day = 25) => new Date(Date.UTC(2026, 7, day, h - 9, m)); // 2026-08-25는 화요일
  assert.strictEqual(C.marketPhase(kst(8, 0)), 'closed');
  assert.strictEqual(C.marketPhase(kst(8, 45)), 'preopen');
  assert.strictEqual(C.marketPhase(kst(10, 0)), 'regular');
  assert.strictEqual(C.marketPhase(kst(15, 25)), 'closeauction');
  assert.strictEqual(C.marketPhase(kst(16, 0)), 'after');
  assert.strictEqual(C.marketPhase(kst(21, 0)), 'closed');
  assert.strictEqual(C.marketPhase(kst(10, 0, 23)), 'closed', '토요일은 휴장');
});

/* -------------------------------------------------------------- 집계기 */

const T0 = Date.UTC(2026, 7, 25, 0, 30, 0); // KST 09:30:00

function feed(agg, count, opts = {}) {
  const stepMs = opts.stepMs || 1000;
  let price = opts.price || 74800;
  for (let i = 0; i < count; i++) {
    price += (i % 3 === 0 ? 100 : -100);
    agg.addTick({
      t: T0 + i * stepMs, price,
      volume: opts.volume || 10,
      side: i % 2 === 0 ? 'buy' : 'sell',
      strength: 110,
    });
  }
  return price;
}

test('집계기: 10초봉 경계가 정확히 10초마다 끊긴다', () => {
  const agg = new TickAggregator('005930');
  feed(agg, 45);                         // 45초치
  const bars = agg.getCandles('10s');
  assert.strictEqual(bars.length, 5);    // 0-9, 10-19, 20-29, 30-39, 40-44
  for (let i = 1; i < bars.length; i++) {
    assert.strictEqual(bars[i].t - bars[i - 1].t, 10000, '봉 간격 10초');
  }
  assert.strictEqual(bars[0].t % 10000, 0, '경계는 10초 배수');
});

test('집계기: 여러 주기가 같은 틱에서 동시에 만들어진다', () => {
  const agg = new TickAggregator('005930');
  feed(agg, 600); // 10분치
  assert.strictEqual(agg.getCandles('10s').length, 60);
  assert.strictEqual(agg.getCandles('30s').length, 20);
  assert.strictEqual(agg.getCandles('1m').length, 10);
  assert.strictEqual(agg.getCandles('3m').length, 4);   // 09:30 경계 기준 3분 버킷
  assert.strictEqual(agg.getCandles('5m').length, 2);
  assert.strictEqual(agg.getCandles('10m').length, 1);
});

test('단타 주기: 1분~10분봉이 모두 지원된다', () => {
  ['1m', '3m', '5m', '10m'].forEach((tf) => {
    assert.ok(C.TIMEFRAMES[tf] > 0, tf + ' 주기 정의');
  });
  assert.strictEqual(C.TIMEFRAMES['10m'], 600);
});

test('시딩: 1분봉으로 10분봉을 만들면 지표가 나올 만큼 쌓인다', () => {
  const agg = new TickAggregator('005930');
  // 정규장 하루치(390분)를 시딩하면 10분봉 39개 → 지표 계산에 충분(30봉 이상)
  const mins = Array.from({ length: 390 }, (_, i) => ({
    t: T0 + i * 60000, o: 74000, h: 74200, l: 73900, c: 74100, v: 5000,
  }));
  agg.seedFromMinutes(mins);
  assert.ok(agg.getCandles('10m').length >= 30, '10분봉 30개 이상: ' + agg.getCandles('10m').length);
  assert.ok(agg.getCandles('5m').length >= 30);
  assert.strictEqual(agg.getCandles('10s').length, 0, '초봉은 틱이 있어야 생긴다');
});

test('집계기: OHLC와 매수/매도 체결량 분리', () => {
  const agg = new TickAggregator('005930');
  agg.addTick({ t: T0, price: 74800, volume: 10, side: 'buy' });
  agg.addTick({ t: T0 + 1000, price: 75000, volume: 20, side: 'buy' });
  agg.addTick({ t: T0 + 2000, price: 74700, volume: 30, side: 'sell' });
  agg.addTick({ t: T0 + 3000, price: 74900, volume: 40, side: 'sell' });
  const bar = agg.getCandles('10s')[0];
  assert.strictEqual(bar.o, 74800);
  assert.strictEqual(bar.h, 75000);
  assert.strictEqual(bar.l, 74700);
  assert.strictEqual(bar.c, 74900);
  assert.strictEqual(bar.v, 100);
  assert.strictEqual(bar.buyVol, 30);
  assert.strictEqual(bar.sellVol, 70);
  assert.strictEqual(bar.ticks, 4);
});

test('집계기: 확정된 봉을 뒤늦게 도착한 틱이 바꾸지 않는다', () => {
  const agg = new TickAggregator('005930');
  feed(agg, 25);
  const before = JSON.stringify(agg.getCandles('10s')[0]);
  agg.addTick({ t: T0 + 1000, price: 99999, volume: 500, side: 'buy' });  // 지연 도착
  assert.strictEqual(JSON.stringify(agg.getCandles('10s')[0]), before);
});

test('집계기: 봉 확정 콜백은 봉이 닫힐 때만 호출된다', () => {
  const closed = [];
  const agg = new TickAggregator('005930', { onBar: (tf, bar) => closed.push(tf) });
  feed(agg, 35);
  assert.strictEqual(closed.filter((tf) => tf === '10s').length, 3, '10초봉 3개 확정');
  assert.strictEqual(closed.filter((tf) => tf === '30s').length, 1);
});

test('집계기: 1분봉 시딩은 초봉을 만들지 않는다', () => {
  const agg = new TickAggregator('005930');
  const mins = Array.from({ length: 30 }, (_, i) => ({
    t: T0 - (30 - i) * 60000, o: 74000, h: 74200, l: 73900, c: 74100, v: 5000,
  }));
  agg.seedFromMinutes(mins);
  assert.strictEqual(agg.getCandles('1m').length, 30);
  assert.strictEqual(agg.getCandles('5m').length, 6);
  assert.strictEqual(agg.getCandles('10s').length, 0, '초봉은 틱이 있어야만 생긴다');
});

test('재집계: 1분봉 5개 → 5분봉 1개의 OHLC', () => {
  const base = Date.UTC(2026, 7, 25, 0, 30, 0);
  const mins = [
    { t: base, o: 100, h: 110, l: 95, c: 105, v: 1 },
    { t: base + 60000, o: 105, h: 120, l: 100, c: 118, v: 2 },
    { t: base + 120000, o: 118, h: 119, l: 90, c: 92, v: 3 },
    { t: base + 180000, o: 92, h: 100, l: 91, c: 99, v: 4 },
    { t: base + 240000, o: 99, h: 101, l: 98, c: 100, v: 5 },
  ];
  const [bar] = resample(mins, 300);
  assert.strictEqual(bar.o, 100);
  assert.strictEqual(bar.h, 120);
  assert.strictEqual(bar.l, 90);
  assert.strictEqual(bar.c, 100);
  assert.strictEqual(bar.v, 15);
});

/* -------------------------------------------------------------- 신호 */

function syntheticCandles(n = 60, start = 74000) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p += (i % 5 < 3 ? 100 : -100);
    out.push({ t: T0 + i * 10000, o: p - 100, h: p + 100, l: p - 200, c: p, v: 1000, buyVol: 600, sellVol: 400, ticks: 12 });
  }
  return out;
}

test('신호: 플랜은 비용 차감 후 손익비 1.5 이상을 목표로 잡는다', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const plan = KRSignal.buildPlan(a, 50, { market: 'KOSPI' });
  assert.ok(plan.rr >= 1.4, `손익비 ${plan.rr}`);
  assert.ok(plan.netPerShare > 0, '순익이 양수');
  assert.ok(plan.targetTicks > plan.breakevenTicks, '목표는 본전 호가보다 크다');
});

test('신호: 목표 호가 상한이 봉 주기에 따라 달라진다', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const caps = {};
  for (const [tf, sec] of Object.entries(C.TIMEFRAMES)) {
    const plan = KRSignal.buildPlan(a, 50, { market: 'KOSPI', barSeconds: sec });
    caps[tf] = plan.maxTargetTicks;
    assert.strictEqual(plan.barSeconds, sec);
  }
  assert.ok(caps['10s'] < caps['1m'], '10초봉 상한 < 1분봉 상한');
  assert.ok(caps['1m'] < caps['5m'], '1분봉 상한 < 5분봉 상한');
  assert.ok(caps['5m'] < caps['10m'], '5분봉 상한 < 10분봉 상한');
  assert.ok(caps['10s'] >= 8, '초봉도 최소 8호가는 허용');
});

test('신호: 같은 목표라도 짧은 주기에서는 보류, 긴 주기에서는 실행 가능', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const short = KRSignal.buildPlan(a, 50, { market: 'KOSPI', barSeconds: 10, maxTargetTicks: 3 });
  const long = KRSignal.buildPlan(a, 50, { market: 'KOSPI', barSeconds: 600 });
  assert.strictEqual(short.viable, false, '10초봉에서 3호가 상한이면 보류');
  assert.match(short.note, /10초봉 기준으로는 무리/);
  assert.strictEqual(long.viable, true, '10분봉에서는 같은 목표가 실행 가능');
  assert.match(long.note, /비용 차감 후/);
});

test('신호: 롱/숏 방향에 따라 손절·목표 위치가 뒤집힌다', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const long = KRSignal.buildPlan(a, 60, { market: 'KOSPI' });
  const short = KRSignal.buildPlan(a, -60, { market: 'KOSPI' });
  assert.ok(long.stop < long.entry && long.target > long.entry);
  assert.ok(short.stop > short.entry && short.target < short.entry);
});

test('신호: 진입가·손절가는 호가단위에 맞는다', () => {
  const a = KRSignal.analyze(syntheticCandles(60, 74000));
  const plan = KRSignal.buildPlan(a, 50, { market: 'KOSPI' });
  const tick = C.tickSize(plan.entry, 'KOSPI');
  assert.strictEqual(plan.entry % tick, 0);
  assert.strictEqual(plan.stop % tick, 0);
  assert.strictEqual(plan.target % tick, 0);
});

test('신호: 호가 불균형과 스프레드가 점수에 반영된다', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const thick = (side) => ({
    asks: Array.from({ length: 10 }, (_, i) => ({ price: 74900 + i * 100, qty: side === 'ask' ? 5000 : 100 })),
    bids: Array.from({ length: 10 }, (_, i) => ({ price: 74800 - i * 100, qty: side === 'bid' ? 5000 : 100 })),
    totalAsk: side === 'ask' ? 50000 : 1000,
    totalBid: side === 'bid' ? 50000 : 1000,
  });
  const bull = KRSignal.evaluate(a, { orderbook: thick('bid'), market: 'KOSPI', phase: 'regular' });
  const bear = KRSignal.evaluate(a, { orderbook: thick('ask'), market: 'KOSPI', phase: 'regular' });
  assert.ok(bull.score > bear.score, '매수잔량이 두꺼우면 점수가 높다');
  assert.ok(bull.reasons.some((r) => r.title.includes('호가 매수우위')));
  assert.ok(bear.reasons.some((r) => r.title.includes('호가 매도우위')));
});

test('신호: 정규장이 아니면 점수를 크게 낮춘다', () => {
  const a = KRSignal.analyze(syntheticCandles());
  const on = KRSignal.evaluate(a, { market: 'KOSPI', phase: 'regular' });
  const off = KRSignal.evaluate(a, { market: 'KOSPI', phase: 'closed' });
  assert.ok(Math.abs(off.score) <= Math.abs(on.score), '장외에서는 점수가 축소된다');
  assert.ok(off.reasons.some((r) => r.title === '정규장 아님'));
});

test('신호: 수량은 투입 한도와 매수 여력을 모두 넘지 않는다', () => {
  const sized = KRSignal.positionSize({ cash: 10000000, riskPct: 1, riskPerShare: 500, entry: 74800, maxAmount: 1000000 });
  assert.ok(sized.notional <= 1000000, '1회 투입 한도 이내');
  assert.strictEqual(sized.qty, Math.min(Math.floor(100000 / 500), Math.floor(1000000 / 74800)));
});

/* ------------------------------------------------------- 실시간 프레임 */

test('실시간 파싱: H0STCNT0 체결 프레임', () => {
  const rt = new KisRealtime({ env: {}, getApprovalKey: async () => 'x' });
  const ticks = [];
  rt.on('trade', (t) => ticks.push(t));
  const f = ['005930', '093015', '70500', '2', '500', '0.71', '70320', '70000', '70800', '69900',
    '70600', '70500', '13', '1234567', '86000000000', '120', '160', '40', '118.5', '500000',
    '600000', '1', '55', '102', '090000', '2', '100', '093000', '2', '800', '091500', '5',
    '-100', '20260825', '20', 'N'];
  rt._handle('0|H0STCNT0|001|' + f.join('^'));
  assert.strictEqual(ticks.length, 1);
  assert.strictEqual(ticks[0].price, 70500);
  assert.strictEqual(ticks[0].volume, 13);
  assert.strictEqual(ticks[0].side, 'buy');
  close(ticks[0].strength, 118.5);
});

test('실시간 파싱: 여러 건이 한 프레임에 묶여 와도 모두 처리한다', () => {
  const rt = new KisRealtime({ env: {}, getApprovalKey: async () => 'x' });
  const ticks = [];
  rt.on('trade', (t) => ticks.push(t));
  const one = (price) => ['005930', '093015', String(price), '2', '0', '0', '0', '0', '0', '0',
    '0', '0', '5', '100', '0', '0', '0', '0', '100', '0', '0', '5', '0', '0', '0', '0', '0',
    '0', '0', '0', '0', '0', '0', '20260825', '20', 'N'];
  rt._handle('0|H0STCNT0|002|' + one(70500).concat(one(70600)).join('^'));
  assert.strictEqual(ticks.length, 2);
  assert.deepStrictEqual(ticks.map((t) => t.price), [70500, 70600]);
});

test('실시간 파싱: H0STASP0 호가 10단계', () => {
  const rt = new KisRealtime({ env: {}, getApprovalKey: async () => 'x' });
  let ob = null;
  rt.on('orderbook', (o) => { ob = o; });
  const head = ['005930', '093015', '0'];
  const askPrices = Array.from({ length: 10 }, (_, i) => String(70600 + i * 100));
  const bidPrices = Array.from({ length: 10 }, (_, i) => String(70500 - i * 100));
  const askQty = Array.from({ length: 10 }, (_, i) => String(100 + i));
  const bidQty = Array.from({ length: 10 }, (_, i) => String(200 + i));
  rt._handle('0|H0STASP0|001|' + head.concat(askPrices, bidPrices, askQty, bidQty, ['5000', '6000']).join('^'));
  assert.ok(ob, '호가 이벤트 발생');
  assert.strictEqual(ob.asks[0].price, 70600);
  assert.strictEqual(ob.asks[0].qty, 100);
  assert.strictEqual(ob.bids[0].price, 70500);
  assert.strictEqual(ob.bids[0].qty, 200);
  assert.strictEqual(ob.totalAsk, 5000);
  assert.strictEqual(ob.totalBid, 6000);
});

test('실시간: PINGPONG은 받은 그대로 되돌려준다', () => {
  const rt = new KisRealtime({ env: {}, getApprovalKey: async () => 'x' });
  const sent = [];
  rt.ws = { send: (m) => sent.push(m) };
  const ping = JSON.stringify({ header: { tr_id: 'PINGPONG', datetime: '20260825093015' } });
  rt._handle(ping);
  assert.deepStrictEqual(sent, [ping]);
});

/* ------------------------------------------------------- 자동매매 안전장치 */

/** 트레이더 상태 파일은 재기동 시 복원되므로, 테스트끼리 영향을 주지 않도록 지운다 */
function resetTraderState() {
  try { require('fs').unlinkSync(require('path').join(process.env.KR_STATE_DIR, '.kr-trader.json')); } catch (_) {}
}

/**
 * 자동매매 테스트는 "정규장에 돌아가는 상황"을 검증한다.
 * 실제 시각에 좌우되면 아침에만 통과하는 테스트가 되므로 장 상태와 강제청산 시각을 고정한다.
 * (시간 의존 로직 자체는 아래 '장 운영 시간 판정' / '강제청산 시각' 테스트에서 따로 검증한다)
 */
const REAL_MARKET_PHASE = C.marketPhase;
function withRegularSession() {
  C.marketPhase = () => 'regular';
}
function restoreSession() {
  C.marketPhase = REAL_MARKET_PHASE;
}

function makeTrader(overrides = {}, clientOverrides = {}) {
  resetTraderState();
  withRegularSession();
  const hub = new EventEmitter();
  hub.get = () => ({ code: '005930', quote: { price: 74800, name: '삼성전자' }, market: 'KOSPI' });
  hub.watch = async () => {};
  hub.pin = () => {};
  hub.broadcast = () => {};
  const client = Object.assign(new MockKisClient(), clientOverrides);
  const trader = new Trader({ hub, client });
  trader.orders = [];
  const realOrder = client.order.bind(client);
  client.order = async (req) => { trader.orders.push(req); return realOrder(req); };
  trader.setConfig(Object.assign(
    // '30:00' 은 하루 중 절대 도달하지 않는 시각 — 강제청산 로직을 테스트마다 비활성화한다
    { enabled: true, dryRun: false, symbols: ['005930'], forceExitAt: '30:00' },
    overrides
  ));
  return trader;
}

test('자동매매: 기본 설정은 dryRun=true, allowLive=false (주문 안 나감)', () => {
  const { DEFAULT_CONFIG } = require('../server/kr/trader.js');
  assert.strictEqual(DEFAULT_CONFIG.dryRun, true);
  assert.strictEqual(DEFAULT_CONFIG.allowLive, false);
  assert.strictEqual(DEFAULT_CONFIG.enabled, false);
});

test('자동매매: dryRun이면 실제 주문 대신 시뮬레이션', async () => {
  const trader = makeTrader({ dryRun: true });
  const r = await trader._placeOrder({ code: '005930', side: 'buy', qty: 1, price: 74800, why: 'test' });
  assert.ok(r.ok && r.simulated, '시뮬레이션 결과');
  assert.strictEqual(trader.orders.length, 0, '실제 주문 호출 없음');
  trader.close();
});

test('자동매매: 실전 계좌인데 allowLive=false면 차단', async () => {
  const trader = makeTrader({ dryRun: false, allowLive: false }, { paper: false, mock: false });
  const r = await trader._placeOrder({ code: '005930', side: 'buy', qty: 1, price: 74800, why: 'test' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'allowLive=false');
  assert.strictEqual(trader.orders.length, 0);
  trader.close();
});

test('자동매매: 엔진이 꺼져 있으면 진입 관문에서 막힌다', () => {
  const trader = makeTrader({ enabled: false });
  const gate = trader._gate('005930');
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /꺼짐/);
  trader.close();
});

test('자동매매: 킬스위치가 눌리면 모든 진입이 막힌다', async () => {
  const trader = makeTrader({ dryRun: true });
  await trader.kill('테스트', false);
  assert.strictEqual(trader._gate('005930').ok, false);
  const r = await trader._placeOrder({ code: '005930', side: 'buy', qty: 1, price: 74800, why: 'test' });
  assert.strictEqual(r.ok, false);
  trader.resume();
  trader.close();
});

test('자동매매: 동시 보유·일일 주문·쿨다운 한도', () => {
  const trader = makeTrader({ maxPositions: 1, maxOrdersPerDay: 2 });
  trader.positions.set('000660', { status: 'open' });
  assert.match(trader._gate('005930').reason, /동시 보유 한도/);
  trader.positions.clear();

  trader.daily.orders = 2;
  assert.match(trader._gate('005930').reason, /일일 주문 한도/);
  trader.daily.orders = 0;

  trader.cooldowns.set('005930', Date.now() + 10000);
  assert.match(trader._gate('005930').reason, /쿨다운/);
  trader.close();
});

test('자동매매: 1회 투입 한도를 넘는 주문은 거부된다', async () => {
  const trader = makeTrader({ dryRun: true, orderAmount: 100000 });
  const r = await trader._placeOrder({ code: '005930', side: 'buy', qty: 100, price: 74800, why: 'test' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /투입 한도/);
  trader.close();
});

test('자동매매: 일일 손실한도에 닿으면 킬스위치가 자동 발동', async () => {
  const trader = makeTrader({ dryRun: true, dailyLossLimit: 10000, cooldownSeconds: 0 });
  // 청산가는 허브의 현재가를 쓴다 — 크게 밀린 상황을 만든다
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 73000, name: '삼성전자' } });
  trader.positions.set('005930', {
    code: '005930', qty: 10, entry: 75000, stop: 74000, target: 76000,
    entryTime: Date.now(), high: 75000, low: 73000, last: 73000, status: 'open', tick: 100,
  });
  await trader._exit('005930', '테스트 손절');
  assert.ok(trader.daily.realizedPnl < -10000, '실현손실 발생');
  assert.strictEqual(trader.killed, true, '킬스위치 자동 발동');
  assert.strictEqual(trader.config.enabled, false);
  trader.close();
});

test('자동매매: 손절·목표·보유시간 초과가 청산을 부른다', async () => {
  const trader = makeTrader({ dryRun: true, maxHoldSeconds: 5, cooldownSeconds: 0 });
  const mkPos = () => ({
    code: '005930', qty: 1, entry: 75000, stop: 74800, target: 75400,
    entryTime: Date.now(), high: 75000, low: 75000, last: 75000, status: 'open', tick: 100,
  });
  const st = { code: '005930', market: 'KOSPI', quote: { price: 74700 } };

  trader.positions.set('005930', mkPos());
  trader._onTick({ price: 74700 }, st);           // 손절선 이탈
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(trader.positions.size, 0, '손절로 청산');

  trader.cooldowns.clear();
  trader.positions.set('005930', mkPos());
  trader._onTick({ price: 75500 }, { ...st, quote: { price: 75500 } });  // 목표 도달
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(trader.positions.size, 0, '목표 도달로 청산');

  trader.cooldowns.clear();
  const old = mkPos();
  old.entryTime = Date.now() - 10000;             // 보유 10초 (한도 5초)
  trader.positions.set('005930', old);
  trader._housekeeping();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(trader.positions.size, 0, '보유시간 초과로 청산');
  trader.close();
});

test('자동매매: 강한 상승 신호가 오면 봉 확정에서 진입까지 이어진다', async () => {
  const hub = new EventEmitter();
  hub.watch = async () => {};
  hub.pin = () => {};
  hub.broadcast = () => {};

  // 꾸준히 오르며 매수 체결이 우위인 10초봉을 만든다
  const agg = new TickAggregator('005930');
  let price = 70000;
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < 5; k++) {
      price += 20;
      agg.addTick({ t: T0 + i * 10000 + k * 1500, price: C.alignPrice(price, 'KOSPI'), volume: 50, side: 'buy', strength: 140 });
    }
  }
  const st = {
    code: '005930', market: 'KOSPI', agg,
    quote: { name: '삼성전자', price: agg.getCandles('10s').slice(-1)[0].c, previousClose: 70000, strength: 140 },
    orderbook: {
      asks: Array.from({ length: 10 }, (_, i) => ({ price: 71300 + i * 100, qty: 100 })),
      bids: Array.from({ length: 10 }, (_, i) => ({ price: 71200 - i * 100, qty: 4000 })),
      totalAsk: 1000, totalBid: 40000,
    },
  };
  hub.get = () => st;

  resetTraderState();
  withRegularSession();
  const client = new MockKisClient();
  const trader = new Trader({ hub, client });
  trader.setConfig({ enabled: true, dryRun: true, symbols: ['005930'], timeframe: '10s', entryScore: 30, maxHoldSeconds: 3600, cooldownSeconds: 0, forceExitAt: '30:00' });

  await trader._evaluate(st);
  const pos = trader.positions.get('005930');
  assert.ok(pos, '진입이 이루어져야 한다');
  assert.ok(pos.qty >= 1, '수량 1주 이상');
  assert.ok(pos.stop < pos.entry, '손절은 진입가 아래');
  assert.ok(pos.target > pos.entry, '목표는 진입가 위');
  assert.ok(trader.logs.some((l) => l.code === 'ENTRY'), '진입 로그 기록');

  // 목표가에 닿으면 청산되고 실현손익이 반영된다
  st.quote.price = pos.target;
  trader._onTick({ price: pos.target }, st);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(trader.positions.size, 0, '목표 도달로 청산');
  assert.ok(trader.daily.realizedPnl > 0, `실현손익 ${trader.daily.realizedPnl}`);
  assert.ok(trader.logs.some((l) => l.code === 'EXIT'), '청산 로그 기록');
  trader.close();
});

test('자동매매: 정규장이 아니면 봉이 확정돼도 진입하지 않는다', async () => {
  const trader = makeTrader({ dryRun: true, symbols: ['005930'], timeframe: '10s', entryScore: 0 });
  const agg = new TickAggregator('005930');
  for (let i = 0; i < 200; i++) agg.addTick({ t: T0 + i * 1000, price: 74800 + i, volume: 10, side: 'buy' });
  const st = { code: '005930', market: 'KOSPI', agg, quote: { price: 75000 } };

  C.marketPhase = () => 'closed';
  try {
    trader._onBar('10s', {}, st);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(trader.positions.size, 0, '장 마감에는 진입하지 않는다');
    assert.match(trader._gate('005930').reason, /정규장 아님/);
  } finally {
    withRegularSession();
  }
  trader.close();
});

test('자동매매: 강제청산 시각 이후에는 신규 진입이 막힌다', () => {
  const trader = makeTrader({ forceExitAt: '00:01' });   // 이미 지난 시각
  const gate = trader._gate('005930');
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /00:01 이후 신규 진입 금지/);
  trader.close();
});

test('청산 기준: 퍼센트로 지정하면 봉 주기와 무관하게 그 가격이 나온다', () => {
  const trader = makeTrader({ exitBasis: 'percent', stopLossPct: 1, takeProfitPct: 2 });
  const r = trader.resolveExitLevels({ entry: 75000, qty: 10, market: 'KOSPI' });
  assert.ok(Math.abs(r.stopPct - 1) < 0.15, `손절 약 -1% (실제 ${r.stopPct.toFixed(2)}%)`);
  assert.ok(Math.abs(r.targetPct - 2) < 0.15, `목표 약 +2% (실제 ${r.targetPct.toFixed(2)}%)`);
  const tick = C.tickSize(75000, 'KOSPI');
  assert.strictEqual(r.stop % tick, 0, '손절가는 호가단위에 맞는다');
  assert.strictEqual(r.target % tick, 0);
  assert.match(r.basis, /-1% \/ 목표 \+2%/);
  trader.close();
});

test('청산 기준: 금액으로 지정하면 수량으로 나눠 주당 가격이 된다', () => {
  const trader = makeTrader({ exitBasis: 'amount', stopLossWon: 50000, takeProfitWon: 100000 });
  const r = trader.resolveExitLevels({ entry: 75000, qty: 10, market: 'KOSPI' });
  // 10주로 5만원 손실 = 주당 5,000원 → 70,000
  assert.ok(Math.abs(r.stop - 70000) <= C.tickSize(75000, 'KOSPI'), `손절 ${r.stop}`);
  assert.ok(Math.abs(r.target - 85000) <= C.tickSize(85000, 'KOSPI'), `목표 ${r.target}`);
  trader.close();
});

test('청산 기준: 손절·목표는 최소 1호가 이상 벌어진다', () => {
  const trader = makeTrader({ exitBasis: 'percent', stopLossPct: 0.05, takeProfitPct: 0.05 });
  const r = trader.resolveExitLevels({ entry: 74800, qty: 1, market: 'KOSPI' });
  const tick = C.tickSize(74800, 'KOSPI');
  assert.ok(r.stop <= 74800 - tick, '손절은 최소 1호가 아래');
  assert.ok(r.target >= 74800 + tick, '목표는 최소 1호가 위');
  trader.close();
});

test('실시간 청산: 봉이 닫히지 않아도 틱 하나로 손절된다', async () => {
  const trader = makeTrader({ exitBasis: 'percent', stopLossPct: 1, takeProfitPct: 2, cooldownSeconds: 0 });
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 74000 } });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: true });
  const pos = trader.positions.get('005930');
  assert.ok(pos.stop < 75000 && pos.target > 75000);

  trader._onTick({ price: 74800 }, { code: '005930', market: 'KOSPI' });   // 아직 손절 위
  assert.strictEqual(trader.positions.size, 1, '손절선 위면 유지');

  trader._onTick({ price: pos.stop - 100 }, { code: '005930', market: 'KOSPI' });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(trader.positions.size, 0, '틱 하나로 즉시 청산');
  assert.ok(trader.logs.some((l) => /손절/.test(l.message)), '손절 사유 기록');
  trader.close();
});

test('실시간 청산: 목표 도달도 틱 단위로 잡는다', async () => {
  const trader = makeTrader({ exitBasis: 'percent', stopLossPct: 1, takeProfitPct: 2, cooldownSeconds: 0 });
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 76500 } });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: true });
  const target = trader.positions.get('005930').target;
  trader._onTick({ price: target }, { code: '005930', market: 'KOSPI' });
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(trader.positions.size, 0);
  assert.ok(trader.logs.some((l) => /목표 도달/.test(l.message)));
  trader.close();
});

test('실시간 청산: 트레일링(%)은 고점 대비 되돌림에서 걸린다', async () => {
  const trader = makeTrader({ exitBasis: 'percent', stopLossPct: 5, takeProfitPct: 10, trailingPct: 1, cooldownSeconds: 0 });
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 76000 } });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: true });
  const tick = (p) => trader._onTick({ price: p }, { code: '005930', market: 'KOSPI' });
  tick(77000);                       // 고점 갱신
  assert.strictEqual(trader.positions.size, 1);
  tick(76500);                       // 고점 대비 -0.65% → 아직
  assert.strictEqual(trader.positions.size, 1);
  tick(76100);                       // 고점 대비 -1.17% → 청산
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(trader.positions.size, 0);
  assert.ok(trader.logs.some((l) => /트레일링/.test(l.message)));
  trader.close();
});

test('수동 감시: 시간 제한 없이 유지되고, 해제해도 주식은 그대로', async () => {
  const trader = makeTrader({ maxHoldSeconds: 5 });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: true });
  const pos = trader.positions.get('005930');
  assert.strictEqual(pos.maxHoldSeconds, 0, '수동 포지션은 시간 제한 없음');
  pos.entryTime = Date.now() - 60000;      // 1분 경과
  trader._housekeeping();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(trader.positions.size, 1, '시간이 지나도 유지된다');

  assert.strictEqual(trader.detachManualPosition('005930'), true);
  assert.strictEqual(trader.positions.size, 0, '감시만 해제');
  assert.ok(trader.logs.some((l) => l.code === 'MANUAL_UNWATCH'));
  trader.close();
});

test('안전: 실제로 산 주식은 모의 실행 설정이어도 실제로 청산된다', async () => {
  const trader = makeTrader({ dryRun: true, exitBasis: 'percent', stopLossPct: 1, cooldownSeconds: 0 });
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 70000 } });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: false });
  trader.orders.length = 0;
  trader._onTick({ price: 70000 }, { code: '005930', market: 'KOSPI' });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(trader.orders.length, 1, 'dryRun 이어도 실제 매도 주문이 나간다');
  assert.strictEqual(trader.orders[0].side, 'sell');
  trader.close();
});

test('안전: 모의 진입은 모의로 청산된다 (실주문 없음)', async () => {
  const trader = makeTrader({ dryRun: true, exitBasis: 'percent', stopLossPct: 1, cooldownSeconds: 0 });
  trader.hub.get = () => ({ code: '005930', market: 'KOSPI', quote: { price: 70000 } });
  await trader.attachManualPosition({ code: '005930', qty: 10, entry: 75000, market: 'KOSPI', simulated: true });
  trader.orders.length = 0;
  trader._onTick({ price: 70000 }, { code: '005930', market: 'KOSPI' });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(trader.orders.length, 0, '모의 포지션은 실제 주문을 내지 않는다');
  trader.close();
});

test('자동매매: 킬스위치 상태는 재기동해도 유지된다', async () => {
  const trader = makeTrader({ dryRun: true });
  await trader.kill('한도 초과', false);
  const hub2 = new EventEmitter();
  hub2.get = () => null; hub2.watch = async () => {}; hub2.pin = () => {}; hub2.broadcast = () => {};
  const restored = new Trader({ hub: hub2, client: new MockKisClient() });
  assert.strictEqual(restored.killed, true, '정지 상태가 그대로 복원돼야 한다');
  assert.match(restored.killReason, /한도 초과/);
  trader.close();
  restored.close();
});

test('자동매매: 재기동하면 실전 발주 허용이 꺼진 채로 복원된다', () => {
  const trader = makeTrader({ dryRun: false, allowLive: true });
  trader._save();
  const hub2 = new EventEmitter();
  hub2.get = () => null; hub2.watch = async () => {}; hub2.pin = () => {}; hub2.broadcast = () => {};
  const restored = new Trader({ hub: hub2, client: new MockKisClient() });
  assert.strictEqual(restored.config.allowLive, false, '실전 허용은 재기동 시 항상 꺼짐');
  assert.strictEqual(restored.config.enabled, false, '엔진도 꺼진 채 시작');
  trader.close();
  restored.close();
});

test('테스트 정리: 장 상태 함수를 원래대로 되돌린다', () => {
  restoreSession();
  assert.strictEqual(C.marketPhase, REAL_MARKET_PHASE);
});

/* ---------------------------------------------------- 수량 직접 입력 */

test('수량: 직접 입력 모드는 신호와 상관없이 그 주식 수로 산다', () => {
  const trader = makeTrader({ sizingMode: 'qty', fixedQty: 7 });
  const r = trader.resolveQty({ cash: 100000000, entry: 74800, riskPerShare: 300 });
  assert.strictEqual(r.qty, 7, '입력한 7주 그대로');
  assert.match(r.reason, /직접 입력 7주/);
  trader.close();
});

test('수량: 직접 입력이어도 주문가능현금을 넘지는 못한다', () => {
  const trader = makeTrader({ sizingMode: 'qty', fixedQty: 100 });
  const r = trader.resolveQty({ cash: 300000, entry: 74800, riskPerShare: 300 });
  assert.strictEqual(r.qty, 4, '30만원이면 74,800원짜리는 4주');
  assert.strictEqual(r.limitedBy, 'cash');
  assert.match(r.reason, /현금 부족/);
  trader.close();
});

test('수량: 직접 입력 모드에서는 1회 투입액 한도로 주문이 막히지 않는다', async () => {
  const trader = makeTrader({ sizingMode: 'qty', fixedQty: 50, orderAmount: 100000 });
  const r = await trader._placeOrder({
    code: '005930', side: 'buy', qty: 50, price: 74800,
    ordDvsn: C.ORD_DVSN.지정가, why: '테스트', force: true,
  });
  assert.strictEqual(r.ok, true, '374만원이어도 직접 입력이면 나간다');
  trader.close();
});

test('수량: 자동 계산 모드는 1회 투입액 한도를 그대로 지킨다', async () => {
  const trader = makeTrader({ sizingMode: 'auto', orderAmount: 100000 });
  const r = await trader._placeOrder({
    code: '005930', side: 'buy', qty: 50, price: 74800,
    ordDvsn: C.ORD_DVSN.지정가, why: '테스트', force: true,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /1회 투입 한도 초과/);
  trader.close();
});

test('수량: 자동 계산 모드는 위험도·금액에서 역산한다', () => {
  const trader = makeTrader({ sizingMode: 'auto', riskPct: 1, orderAmount: 10000000 });
  const r = trader.resolveQty({ cash: 10000000, entry: 10000, riskPerShare: 100 });
  // 위험 허용액 10만원 / 주당 위험 100원 = 1000주, 현금으로는 1000주 → 1000주
  assert.strictEqual(r.qty, 1000);
  assert.match(r.reason, /자동 계산/);
  trader.close();
});

test('수량: fixedQty 는 1주 미만으로 내려가지 않는다', () => {
  const trader = makeTrader({ sizingMode: 'qty', fixedQty: 0 });
  assert.strictEqual(trader.config.fixedQty, 1);
  trader.close();
});

/* ------------------------------------------------- 거래 시간대 제한 */

test('시간대 제한: 기본값은 off — 정규장이면 언제든 진입 가능', () => {
  const trader = makeTrader();
  assert.strictEqual(trader.config.sessionFilter, 'off');
  assert.strictEqual(trader._gate('005930').ok, true);
  trader.close();
});

test('시간대 제한: golden 을 켜면 시초가 구간 밖에서는 진입이 막힌다', () => {
  const sessions = require('../server/sessions.js');
  const trader = makeTrader({ sessionFilter: 'golden' });
  const real = sessions.shouldTrade;
  try {
    sessions.shouldTrade = () => ({ ok: false, reason: '점심 공백 구간입니다 — 거래가 마릅니다.' });
    const gate = trader._gate('005930');
    assert.strictEqual(gate.ok, false);
    assert.match(gate.reason, /거래 시간대 아님/);
    assert.match(gate.reason, /점심 공백/);
  } finally {
    sessions.shouldTrade = real;
    trader.close();
  }
});

test('시간대 제한: 골든타임 안이면 그대로 통과한다', () => {
  const sessions = require('../server/sessions.js');
  const trader = makeTrader({ sessionFilter: 'golden' });
  const real = sessions.shouldTrade;
  try {
    sessions.shouldTrade = () => ({ ok: true, reason: '시초가 폭풍 · 25분 남음' });
    assert.strictEqual(trader._gate('005930').ok, true);
  } finally {
    sessions.shouldTrade = real;
    trader.close();
  }
});

test('시간대 제한: 모르는 값은 off 로 떨어진다', () => {
  const trader = makeTrader({ sessionFilter: '아무거나' });
  assert.strictEqual(trader.config.sessionFilter, 'off');
  trader.close();
});

test('시간대 제한: 상태에 지금 구간이 함께 실린다', () => {
  const trader = makeTrader();
  const st = trader.status();
  assert.ok(st.session, '상태에 session 포함');
  assert.strictEqual(st.session.market, 'KR');
  trader.close();
});

/* ------------------------------------------------------------------ 실행 */

(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log('  ✓ ' + name);
    } catch (err) {
      console.error('  ✗ ' + name + '\n    ' + err.message);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${cases.length} 통과`);
  process.exit(process.exitCode || 0);
})();
