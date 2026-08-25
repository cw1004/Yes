'use strict';
/**
 * KIS 자격증명이 없거나 외부망이 막힌 환경에서 쓰는 모의 시세 엔진.
 * KisClient / KisRealtime 과 같은 인터페이스를 갖춰 상위 코드가 그대로 동작한다.
 *
 * 실제 한국 주식처럼 호가단위에 맞춘 가격만 나오고, 호가창·체결강도·매수/매도 체결틱을
 * 함께 만들어 주므로 초단타 신호와 자동매매 로직을 그대로 검증할 수 있다.
 */

const { EventEmitter } = require('events');
const C = require('../kr/config');

/** 데모 종목 (실제 시세 아님) */
const UNIVERSE = {
  '005930': { name: '삼성전자', base: 74800, market: 'KOSPI' },
  '000660': { name: 'SK하이닉스', base: 198500, market: 'KOSPI' },
  '373220': { name: 'LG에너지솔루션', base: 402000, market: 'KOSPI' },
  '005380': { name: '현대차', base: 243000, market: 'KOSPI' },
  '035420': { name: 'NAVER', base: 187600, market: 'KOSPI' },
  '035720': { name: '카카오', base: 42150, market: 'KOSPI' },
  '247540': { name: '에코프로비엠', base: 128900, market: 'KOSDAQ' },
  '086520': { name: '에코프로', base: 74300, market: 'KOSDAQ' },
  '196170': { name: '알테오젠', base: 331500, market: 'KOSDAQ' },
  '042700': { name: '한미반도체', base: 92800, market: 'KOSDAQ' },
  '005490': { name: 'POSCO홀딩스', base: 288000, market: 'KOSPI' },
  '068270': { name: '셀트리온', base: 176300, market: 'KOSPI' },
};

function meta(code) {
  return UNIVERSE[code] || { name: `종목${code}`, base: 30000 + (Number(code) % 50000), market: 'KOSPI' };
}

/** 종목별 가격 상태를 한 곳에서 관리해 REST/실시간이 같은 가격을 보게 한다 */
const stateByCode = new Map();

function stateOf(code) {
  if (!stateByCode.has(code)) {
    const m = meta(code);
    const prevClose = C.alignPrice(m.base, m.market);
    stateByCode.set(code, {
      code,
      ...m,
      prevClose,
      price: prevClose,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      accVolume: 0,
      accValue: 0,
      buyVol: 0,
      sellVol: 0,
      drift: (Math.random() - 0.5) * 0.00004,
      phase: Math.random() * Math.PI * 2,
      step: 0,
    });
  }
  return stateByCode.get(code);
}

/**
 * 한 틱 전진.
 * 연속값인 '적정가(fair)'를 아주 작게 움직이고, 실제 체결가는 그 주변에서
 * 호가단위로 튀게(bid-ask bounce) 만든다. 이래야 틱 단위 노이즈와
 * 분 단위 추세가 동시에 현실적으로 나온다.
 */
function advance(code) {
  const s = stateOf(code);
  s.step++;
  if (s.fair == null) s.fair = s.prevClose;

  const tick = C.tickSize(s.price, s.market);
  // 틱당 표준편차 약 0.012% → 1분(수백 틱)에 0.1~0.3% 수준으로 움직인다
  const sigma = 0.00009;
  // 사이클은 방향성(추세)을 주되, 상수 편향이 되지 않도록 진폭을 작게 둔다
  const cycle = Math.sin(s.step / 2500 + s.phase) * sigma * 0.2;
  const anchor = s.prevClose * (1 + Math.sin(s.step / 9000 + s.phase) * 0.01);
  const revert = ((anchor - s.fair) / s.fair) * 0.0006;
  s.fair *= 1 + gauss() * sigma + cycle + revert + s.drift;

  const upper = s.prevClose * (1 + C.LIMIT_PCT / 100);
  const lower = s.prevClose * (1 - C.LIMIT_PCT / 100);
  s.fair = Math.min(upper, Math.max(lower, s.fair));

  // 체결은 적정가 근처의 매수호가/매도호가에서 번갈아 일어난다
  const half = Math.random() < 0.5 ? -0.5 : 0.5;
  const next = C.alignPrice(s.fair + half * tick, s.market, half < 0 ? 'down' : 'up');
  const side = half > 0 ? 'buy' : 'sell';   // 매도호가 체결 = 매수세
  const qty = 1 + Math.floor(Math.random() * (s.price > 200000 ? 12 : 120));

  s.price = next;
  s.high = Math.max(s.high, next);
  s.low = Math.min(s.low, next);
  s.accVolume += qty;
  s.accValue += qty * next;
  if (side === 'buy') s.buyVol += qty; else s.sellVol += qty;

  return {
    code,
    t: Date.now(),
    time: kstHms(),
    price: next,
    change: next - s.prevClose,
    changePct: ((next - s.prevClose) / s.prevClose) * 100,
    open: s.open, high: s.high, low: s.low,
    ask1: C.alignPrice(s.fair + tick, s.market, 'up'),
    bid1: C.alignPrice(s.fair - tick, s.market, 'down'),
    volume: qty,
    accVolume: s.accVolume,
    accValue: s.accValue,
    strength: s.sellVol > 0 ? (s.buyVol / s.sellVol) * 100 : 100,
    side,
    halt: false,
  };
}

/** 박스-뮬러 정규난수 */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildOrderbook(code) {
  const s = stateOf(code);
  const t = C.tickSize(s.price, s.market);
  const asks = [];
  const bids = [];
  for (let i = 0; i < 10; i++) {
    asks.push({ price: s.price + t * (i + 1), qty: Math.round((80 + Math.random() * 900) * (1 + i * 0.25)) });
    bids.push({ price: s.price - t * i, qty: Math.round((80 + Math.random() * 900) * (1 + i * 0.25)) });
  }
  return {
    code,
    time: kstHms(),
    asks,
    bids,
    totalAsk: asks.reduce((a, b) => a + b.qty, 0),
    totalBid: bids.reduce((a, b) => a + b.qty, 0),
  };
}

const kstHms = () => {
  const d = new Date(Date.now() + 9 * 3600e3);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + String(d.getUTCSeconds()).padStart(2, '0');
};

/* ------------------------------------------------------- 모의 실시간 엔진 */

class MockRealtime extends EventEmitter {
  constructor() {
    super();
    this.subs = new Map();
    this.status = 'idle';
    this.timers = new Map();
  }
  get subscriptionCount() { return this.subs.size; }

  async connect() {
    this.status = 'open';
    this.emit('status', 'open');
  }
  close() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.subs.clear();
    this.status = 'idle';
    this.emit('status', 'idle');
  }
  subscribe() { return true; }
  unsubscribe() {}

  watch(code) {
    if (this.timers.has(code)) return;
    this.subs.set(code, true);
    // 초당 3~8건의 체결이 들어오는 상황을 흉내낸다
    const timer = setInterval(() => {
      const bursts = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < bursts; i++) this.emit('trade', advance(code));
      if (Math.random() < 0.5) this.emit('orderbook', buildOrderbook(code));
    }, 300);
    if (timer.unref) timer.unref();
    this.timers.set(code, timer);
  }

  unwatch(code) {
    const timer = this.timers.get(code);
    if (timer) clearInterval(timer);
    this.timers.delete(code);
    this.subs.delete(code);
  }
  watchNotice() {}
}

/* ------------------------------------------------------- 모의 REST 클라이언트 */

class MockKisClient {
  constructor(opts = {}) {
    this.paper = true;
    this.mock = true;
    this.env = { name: '데모', rest: 'mock://', ws: 'mock://', restPerSecond: 100 };
    this.cano = opts.cano || '00000000';
    this.acntPrdtCd = '01';
    this._cash = 10000000;      // 데모 예수금 1,000만원
    this._positions = new Map();
    this._orderSeq = 1000;
  }
  get configured() { return true; }
  get tradable() { return true; }
  tr(entry) { return typeof entry === 'string' ? entry : entry.paper; }
  async getToken() { return 'mock-token'; }
  async getApprovalKey() { return 'mock-approval'; }

  async price(code) {
    const s = stateOf(code);
    return {
      code, name: s.name, market: s.market,
      price: s.price, open: s.open, high: s.high, low: s.low,
      previousClose: s.prevClose,
      change: s.price - s.prevClose,
      changePercent: ((s.price - s.prevClose) / s.prevClose) * 100,
      volume: s.accVolume, value: s.accValue,
      upperLimit: C.alignPrice(s.prevClose * 1.3, s.market, 'down'),
      lowerLimit: C.alignPrice(s.prevClose * 0.7, s.market, 'up'),
      strength: s.sellVol > 0 ? (s.buyVol / s.sellVol) * 100 : 100,
      vi: '',
    };
  }

  async orderbook(code) { return buildOrderbook(code); }

  /** 과거 1분봉: 현재가에서 거슬러 올라가며 만든다 */
  async minuteCandles(code, count = 120) {
    const s = stateOf(code);
    const t = C.tickSize(s.price, s.market);
    const out = [];
    const now = Math.floor(Date.now() / 60000) * 60000;
    let price = s.price;
    for (let i = 0; i < count; i++) {
      // 과거로 거슬러 올라가되 기준가에서 너무 멀어지지 않도록 되돌린다
      const revert = ((s.prevClose - price) / t) * 0.02;
      const move = ((Math.random() - 0.5) * 5 - revert) * t;
      const open = price - move;
      const high = Math.max(open, price) + Math.random() * 2 * t;
      const low = Math.min(open, price) - Math.random() * 2 * t;
      out.push({
        t: now - i * 60000,
        o: C.alignPrice(open, s.market), h: C.alignPrice(high, s.market),
        l: C.alignPrice(low, s.market), c: C.alignPrice(price, s.market),
        v: 1000 + Math.floor(Math.random() * 40000),
      });
      price = open;
    }
    return out.reverse();
  }

  async order(req) {
    const s = stateOf(req.code);
    const price = req.price || s.price;
    const qty = Math.floor(req.qty);
    if (req.side === 'buy') {
      const cost = price * qty * (1 + C.COST.commissionRate);
      if (cost > this._cash) throw new Error('모의 예수금 부족');
      this._cash -= cost;
      const pos = this._positions.get(req.code) || { qty: 0, avg: 0 };
      pos.avg = (pos.avg * pos.qty + price * qty) / (pos.qty + qty);
      pos.qty += qty;
      this._positions.set(req.code, pos);
    } else {
      const pos = this._positions.get(req.code);
      if (!pos || pos.qty < qty) throw new Error('모의 보유수량 부족');
      pos.qty -= qty;
      this._cash += price * qty * (1 - C.COST.commissionRate - C.COST.taxSellRate);
      if (pos.qty === 0) this._positions.delete(req.code);
    }
    return {
      ok: true,
      orderNo: 'M' + this._orderSeq++,
      orgNo: '00000',
      time: kstHms(),
      message: '모의 주문 체결',
      mock: true,
      filledPrice: price,
      request: { ...req },
    };
  }

  async cancel() { return { ok: true, message: '모의 취소', output: {} }; }

  async balance() {
    const positions = [];
    for (const [code, pos] of this._positions) {
      const s = stateOf(code);
      positions.push({
        code, name: s.name, qty: pos.qty, available: pos.qty,
        avgPrice: Math.round(pos.avg), price: s.price,
        pnl: Math.round((s.price - pos.avg) * pos.qty),
        pnlPct: ((s.price - pos.avg) / pos.avg) * 100,
      });
    }
    const evalAmt = positions.reduce((a, p) => a + p.price * p.qty, 0);
    return {
      positions,
      cash: Math.round(this._cash),
      orderableCash: Math.round(this._cash),
      totalEval: Math.round(this._cash + evalAmt),
      totalPnl: positions.reduce((a, p) => a + p.pnl, 0),
    };
  }

  async orderable(code, price) {
    const s = stateOf(code);
    const p = price || s.price;
    return { cash: Math.round(this._cash), maxQty: Math.floor(this._cash / p), maxAmount: Math.round(this._cash) };
  }
}

/** 종목 검색 (데모 유니버스) */
function searchUniverse(q) {
  const query = String(q || '').trim().toLowerCase();
  return Object.entries(UNIVERSE)
    .filter(([code, m]) => code.includes(query) || m.name.toLowerCase().includes(query))
    .map(([code, m]) => ({ code, name: m.name, market: m.market }));
}

module.exports = { MockKisClient, MockRealtime, UNIVERSE, searchUniverse, stateOf, meta };
