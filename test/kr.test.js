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
  // 본전 호가: 비용률 × 가격 ÷ 호가단위 올림
  const be = C.breakevenTicks(price);
  assert.ok(be >= 1 && be <= 5, '7만원대 코스피 본전은 1~5호가');
  assert.ok(be * C.tickSize(price) >= C.roundTripCost(price, 1) - 1e-9, '본전 호가는 비용 이상');
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
  feed(agg, 300); // 5분치
  assert.strictEqual(agg.getCandles('10s').length, 30);
  assert.strictEqual(agg.getCandles('30s').length, 10);
  assert.strictEqual(agg.getCandles('1m').length, 5);
  assert.strictEqual(agg.getCandles('5m').length, 1);
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

function makeTrader(overrides = {}, clientOverrides = {}) {
  resetTraderState();
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
  trader.setConfig(Object.assign({ enabled: true, dryRun: false, symbols: ['005930'] }, overrides));
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
  const client = new MockKisClient();
  const trader = new Trader({ hub, client });
  trader.setConfig({ enabled: true, dryRun: true, symbols: ['005930'], timeframe: '10s', entryScore: 30, maxHoldSeconds: 3600, cooldownSeconds: 0 });

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

  const realPhase = C.marketPhase;
  C.marketPhase = () => 'closed';
  try {
    trader._onBar('10s', {}, st);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(trader.positions.size, 0, '장 마감에는 진입하지 않는다');
  } finally {
    C.marketPhase = realPhase;
  }
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
