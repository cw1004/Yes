'use strict';
/**
 * 한국 시장 실시간 허브.
 *
 * 종목별로 [체결틱 → 다중주기 봉 집계 + 호가 + 체결 테이프] 상태를 들고 있으면서,
 * 브라우저에는 SSE로 일정 주기(기본 300ms)마다 스냅샷을 밀어준다.
 * 틱 하나하나를 그대로 흘리면 브라우저가 못 버티므로 묶어서 보낸다.
 */

const { EventEmitter } = require('events');
const { TickAggregator, DEFAULT_TFS } = require('./aggregator');
const C = require('./config');

const PUSH_INTERVAL = 300;      // SSE 스냅샷 주기(ms)
const TAPE_SIZE = 60;           // 체결 테이프 보관 건수
const IDLE_UNWATCH_MS = 120e3;  // 보는 사람이 없으면 2분 뒤 구독 해지

class KrHub extends EventEmitter {
  constructor({ client, realtime }) {
    super();
    this.client = client;
    this.rt = realtime;
    /** @type {Map<string, object>} 종목코드 → 상태 */
    this.symbols = new Map();
    this.clients = new Set();
    this.started = false;

    this.rt.on('trade', (tick) => this._onTrade(tick));
    this.rt.on('orderbook', (ob) => this._onOrderbook(ob));
    this.rt.on('status', (s) => this.emit('status', s));
    this.rt.on('error', (e) => this.emit('rt-error', e));

    this.pushTimer = setInterval(() => this._push(), PUSH_INTERVAL);
    if (this.pushTimer.unref) this.pushTimer.unref();
    this.idleTimer = setInterval(() => this._reapIdle(), 30000);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  async ensureConnected() {
    if (this.started) return;
    await this.rt.connect();
    this.started = true;
  }

  /** 종목 구독 시작 (이미 보고 있으면 그대로 둔다) */
  async watch(code) {
    await this.ensureConnected();
    let st = this.symbols.get(code);
    if (st) {
      st.lastAccess = Date.now();
      return st;
    }
    st = {
      code,
      agg: new TickAggregator(code, { timeframes: DEFAULT_TFS }),
      quote: null,
      orderbook: null,
      tape: [],
      lastAccess: Date.now(),
      dirty: true,
      seeded: false,
    };
    this.symbols.set(code, st);

    // 1분 이상 주기는 REST 분봉으로 과거를 채우고, 초봉은 지금부터 쌓인다
    try {
      const [quote, minutes] = await Promise.all([
        this.client.price(code),
        this.client.minuteCandles(code, 200),
      ]);
      st.quote = quote;
      st.market = quote.market || 'KOSPI';
      st.agg.seedFromMinutes(minutes);
      st.agg.primeFromLastPrice(quote.price);
      st.seeded = true;
    } catch (err) {
      this.emit('rt-error', new Error(`${code} 초기 시세 조회 실패: ${err.message}`));
    }

    this.rt.watch(code);
    return st;
  }

  unwatch(code) {
    const st = this.symbols.get(code);
    if (!st) return;
    this.rt.unwatch(code);
    this.symbols.delete(code);
  }

  get(code) {
    return this.symbols.get(code);
  }

  /* -------------------------------------------------------------- 수신 */

  _onTrade(tick) {
    const st = this.symbols.get(tick.code);
    if (!st) return;
    const closed = st.agg.addTick(tick);
    st.tape.push({ t: tick.t, time: tick.time, price: tick.price, volume: tick.volume, side: tick.side });
    if (st.tape.length > TAPE_SIZE) st.tape.splice(0, st.tape.length - TAPE_SIZE);

    if (st.quote) {
      st.quote.price = tick.price;
      st.quote.change = tick.change;
      st.quote.changePercent = tick.changePct;
      st.quote.volume = tick.accVolume;
      st.quote.value = tick.accValue;
      st.quote.strength = tick.strength;
      st.quote.high = Math.max(st.quote.high || tick.price, tick.high || tick.price);
      st.quote.low = Math.min(st.quote.low || tick.price, tick.low || tick.price);
    }
    st.dirty = true;
    this.emit('tick', tick, st);
    for (const { tf, bar } of closed) this.emit('bar', tf, bar, st);
  }

  _onOrderbook(ob) {
    const st = this.symbols.get(ob.code);
    if (!st) return;
    st.orderbook = ob;
    st.dirty = true;
  }

  /* -------------------------------------------------------------- SSE */

  addClient(res, code, timeframe) {
    const client = { res, code, timeframe: timeframe || '10s', sentBars: 0 };
    this.clients.add(client);
    res.on('close', () => this.clients.delete(client));
    this._sendTo(client, 'snapshot', this.snapshot(code, client.timeframe, 400));
    return client;
  }

  /** 특정 종목의 현재 상태 스냅샷 */
  snapshot(code, timeframe = '10s', barLimit = 200) {
    const st = this.symbols.get(code);
    if (!st) return { code, ready: false };
    st.lastAccess = Date.now();
    return {
      code,
      ready: true,
      timeframe,
      market: st.market || 'KOSPI',
      quote: st.quote,
      orderbook: st.orderbook,
      tape: st.tape.slice(-30),
      flow: st.agg.recentStats('10s', 6),
      candles: st.agg.getCandles(timeframe, barLimit),
      phase: C.marketPhase(),
      serverTime: Date.now(),
    };
  }

  _push() {
    if (!this.clients.size) return;
    for (const client of this.clients) {
      const st = this.symbols.get(client.code);
      if (!st || !st.dirty) continue;
      this._sendTo(client, 'snapshot', this.snapshot(client.code, client.timeframe, 400));
    }
    for (const st of this.symbols.values()) st.dirty = false;
  }

  _sendTo(client, event, data) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      this.clients.delete(client);
    }
  }

  /** 서버발 알림(자동매매 이벤트 등)을 모든 클라이언트에 전달 */
  broadcast(event, data) {
    for (const client of this.clients) this._sendTo(client, event, data);
  }

  _reapIdle() {
    const now = Date.now();
    const watched = new Set(Array.from(this.clients).map((c) => c.code));
    for (const [code, st] of this.symbols) {
      if (st.pinned || watched.has(code)) continue;
      if (now - st.lastAccess > IDLE_UNWATCH_MS) this.unwatch(code);
    }
  }

  /** 자동매매가 보는 종목은 화면을 닫아도 구독을 유지한다 */
  pin(code, on = true) {
    const st = this.symbols.get(code);
    if (st) st.pinned = on;
  }

  close() {
    clearInterval(this.pushTimer);
    clearInterval(this.idleTimer);
    this.rt.close();
    this.symbols.clear();
    this.clients.clear();
  }
}

module.exports = { KrHub, PUSH_INTERVAL };
