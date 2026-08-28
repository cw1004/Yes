'use strict';
/**
 * 실시간 단타 후보 스캐너.
 *
 * 기존 screener.js 는 "지금 이 종목이 오를 것 같은가"(방향 점수)를 재고,
 * 여기서는 한 걸음 더 나아가 **"지금 단타를 하기에 좋은 종목인가"**(단타 적합도)를 잰다.
 * 방향이 맞아도 거래가 얇거나 스프레드가 비싸면 단타로는 돈이 안 되기 때문이다.
 *
 * 적합도 = 유동성 · 변동성(적당해야 함) · 비용 대비 기대폭 · 지금 움직이는가 · 방향의 선명함
 *
 * 스캐너는 화면을 보는 사람이 있을 때만 돈다(구독자 0명이면 자동으로 멈춘다).
 * 미국·한국을 각각 자기 주기로 돌리고, 직전 결과와 비교해 "새로 올라온 종목"을 표시한다.
 */

const { EventEmitter } = require('events');
const screener = require('./screener');
const KRC = require('../kr/config');
const sessions = require('../sessions');
const daypart = require('./daypart');

/** 시장별 스캔 주기(ms) — 상방 API 유량을 지키면서 단타에 쓸 만큼은 자주 */
const INTERVAL = { US: 20000, KR: 15000 };
/** 구독자가 사라진 뒤 이만큼 지나면 스캔을 멈춘다 */
const IDLE_STOP_MS = 60000;
/** 종목별 점수 이력 보관 개수 (모멘텀 판정용) */
const HISTORY = 12;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * 단타 적합도 점수(0~100)와 그 근거를 만든다.
 *
 * @param {object} row      screener 가 낸 종목 행
 * @param {'US'|'KR'} market
 * @param {Array<{t:number,score:number,price:number}>} history 직전 스캔 이력(오래된 것부터)
 */
function fitness(row, market, history = []) {
  const t = row.technicals || {};
  const parts = [];
  const add = (points, label) => { parts.push({ points: Math.round(points), label }); };

  // ── 1. 유동성 (0~25) : 평소보다 거래가 실려야 체결이 된다
  const vr = t.volumeRatio;
  let liquidity = 0;
  if (vr != null) {
    if (vr >= 2.5) liquidity = 25;
    else if (vr >= 1.5) liquidity = 20;
    else if (vr >= 1.0) liquidity = 13;
    else if (vr >= 0.6) liquidity = 6;
    else liquidity = 0;
    add(liquidity, `거래량 평소의 ${vr.toFixed(1)}배`);
  }

  // ── 2. 변동성 (0~25) : 너무 낮으면 못 먹고, 너무 높으면 손절이 먼저 맞는다
  const atr = t.atrPct;
  let vola = 0;
  if (atr != null) {
    // 단타 스위트스팟: 미국 0.35~1.6%, 한국 0.5~2.2%
    const [lo, hi] = market === 'KR' ? [0.5, 2.2] : [0.35, 1.6];
    if (atr >= lo && atr <= hi) vola = 25;
    else if (atr > hi) vola = clamp(25 - (atr - hi) * 12, 5, 25);        // 과열은 감점
    else vola = clamp((atr / lo) * 18, 0, 18);                            // 잔잔하면 기회가 적다
    add(vola, `변동성 ATR ${atr.toFixed(2)}%${atr > hi ? ' (과열)' : atr < lo ? ' (잔잔)' : ' (적정)'}`);
  }

  // ── 3. 비용 대비 기대폭 (0~20) : 수수료·세금·스프레드를 넘고도 남는가
  let edge = 0;
  if (market === 'KR' && row.plan && t.breakevenTicks != null) {
    const net = (row.plan.targetTicks || 0) - t.breakevenTicks;
    edge = clamp(net * 4, 0, 20);
    add(edge, `본전 ${t.breakevenTicks}호가 대비 목표 ${row.plan.targetTicks || 0}호가`);
  } else if (row.plan && row.plan.rr != null) {
    edge = clamp((row.plan.rr - 1) * 13, 0, 20);
    add(edge, `손익비 ${row.plan.rr.toFixed(2)}:1`);
  }

  // ── 4. 지금 움직이는가 (0~20) : 직전 스캔 대비 점수·가격이 살아나는 중인지
  let motion = 0;
  if (history.length >= 2) {
    const prev = history[history.length - 1];
    const dScore = row.score - prev.score;
    const dPrice = prev.price ? ((row.price - prev.price) / prev.price) * 100 : 0;
    motion = clamp(Math.abs(dScore) * 0.5 + Math.abs(dPrice) * 8, 0, 20);
    if (motion >= 5) {
      add(motion, `직전 스캔 대비 점수 ${dScore > 0 ? '+' : ''}${dScore.toFixed(0)} · 가격 ${dPrice > 0 ? '+' : ''}${dPrice.toFixed(2)}%`);
    }
  }

  // ── 5. 방향의 선명함 (0~10) : 위든 아래든 한쪽으로 확실할수록 좋다
  const conviction = clamp(Math.abs(row.score) / 8, 0, 10);
  add(conviction, `신호 ${row.score > 0 ? '+' : ''}${row.score}점 (${row.label})`);

  const total = clamp(liquidity + vola + edge + motion + conviction, 0, 100);
  return {
    fit: Math.round(total),
    side: row.score >= 0 ? 'long' : 'short',
    parts: parts.filter((p) => p.points > 0).sort((a, b) => b.points - a.points),
    breakdown: {
      liquidity: Math.round(liquidity),
      volatility: Math.round(vola),
      edge: Math.round(edge),
      motion: Math.round(motion),
      conviction: Math.round(conviction),
    },
  };
}

/** 적합도를 사람이 읽는 등급으로 */
function grade(fit) {
  if (fit >= 75) return { grade: 'A', text: '지금 바로 볼 만함' };
  if (fit >= 60) return { grade: 'B', text: '괜찮음' };
  if (fit >= 45) return { grade: 'C', text: '지켜보기' };
  return { grade: 'D', text: '단타에는 부적합' };
}

class Scanner extends EventEmitter {
  constructor() {
    super();
    this.markets = {
      US: this._freshMarket('US'),
      KR: this._freshMarket('KR'),
    };
    this.clients = new Set();
    this._idleTimer = null;
  }

  _freshMarket(market) {
    return {
      market,
      running: false,
      timer: null,
      asOf: 0,
      source: null,
      error: null,
      scanning: false,
      scanned: 0,
      results: [],
      history: new Map(),    // symbol → [{t, score, price}]
      seen: new Set(),       // 이번 세션에서 이미 상위에 올라왔던 종목
    };
  }

  /* ------------------------------------------------------------ 구독 */

  addClient(res) {
    const client = { res };
    this.clients.add(client);
    clearTimeout(this._idleTimer);
    this.start();
    return client;
  }

  removeClient(client) {
    this.clients.delete(client);
    if (this.clients.size === 0) {
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        if (this.clients.size === 0) this.stop('구독자 없음');
      }, IDLE_STOP_MS);
      if (this._idleTimer.unref) this._idleTimer.unref();
    }
  }

  _broadcast(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of Array.from(this.clients)) {
      try { c.res.write(line); } catch (_) { this.clients.delete(c); }
    }
  }

  /* ------------------------------------------------------------ 구동 */

  start(only = null) {
    for (const market of ['US', 'KR']) {
      if (only && only !== market) continue;
      const m = this.markets[market];
      if (m.running) continue;
      m.running = true;
      this._tick(market);                                   // 즉시 1회
      m.timer = setInterval(() => this._tick(market), INTERVAL[market]);
      if (m.timer.unref) m.timer.unref();
    }
    return this.snapshot();
  }

  stop(reason = '수동 정지') {
    for (const market of ['US', 'KR']) {
      const m = this.markets[market];
      clearInterval(m.timer);
      m.timer = null;
      m.running = false;
    }
    this.stopReason = reason;
    this.emit('stopped', reason);
    return this.snapshot();
  }

  async _tick(market) {
    const m = this.markets[market];
    if (m.scanning) return;                                 // 앞 스캔이 아직 안 끝났으면 건너뛴다
    m.scanning = true;
    try {
      const raw = market === 'KR'
        ? await screener.screenKR({ limit: 20 })
        : await screener.screenUS({ interval: '5m', range: '5d', limit: 20 });

      const now = Date.now();
      const rows = raw.candidates.map((row) => {
        const hist = m.history.get(row.symbol) || [];
        const f = fitness(row, market, hist);
        hist.push({ t: now, score: row.score, price: row.price });
        if (hist.length > HISTORY) hist.shift();
        m.history.set(row.symbol, hist);

        return Object.assign({}, row, f, grade(f.fit), {
          market,
          // 첫 스캔에서는 전부 처음 보는 종목이라 NEW 가 의미 없다.
          // 두 번째 스캔부터, 없던 종목이 새로 올라온 경우에만 표시한다.
          isNew: hist.length >= 2 && f.fit >= 60 && !m.seen.has(row.symbol),
          samples: hist.length,
        });
      });

      rows.sort((a, b) => b.fit - a.fit);
      for (const r of rows) if (r.fit >= 60) m.seen.add(r.symbol);

      // 시간대별 실측 프로파일에 이번 스캔을 쌓는다 (가정이 아니라 측정으로 골든타임을 찾기 위해)
      try { daypart.record(market, rows); } catch (_) { /* 기록 실패가 스캔을 막지 않는다 */ }

      m.results = rows;
      m.asOf = now;
      m.source = raw.source;
      m.scanned = raw.scanned;
      m.phase = raw.phase || null;
      m.error = null;
    } catch (err) {
      m.error = err.message || String(err);
    } finally {
      m.scanning = false;
    }
    const view = this.marketView(market);
    this.emit('scan', view);
    this._broadcast({ type: 'scan', market, data: view });
  }

  /* ------------------------------------------------------------ 조회 */

  marketView(market, limit = 8) {
    const m = this.markets[market];
    return {
      market,
      running: m.running,
      asOf: m.asOf,
      source: m.source,
      phase: m.phase || (market === 'KR' ? KRC.marketPhase() : null),
      scanned: m.scanned,
      error: m.error,
      intervalMs: INTERVAL[market],
      // 지금이 거래하기 좋은 시간인가 (가정 기반 구간표)
      session: sessions.windowNow(market),
      top: m.results.slice(0, limit),
    };
  }

  snapshot(limit = 8) {
    return {
      running: this.markets.US.running || this.markets.KR.running,
      clients: this.clients.size,
      US: this.marketView('US', limit),
      KR: this.marketView('KR', limit),
    };
  }

  /** 두 시장을 한 줄로 섞어 "지금 가장 좋은 것"만 뽑아 준다 */
  best(limit = 5) {
    const all = [...this.markets.US.results, ...this.markets.KR.results];
    all.sort((a, b) => b.fit - a.fit);
    return all.slice(0, limit);
  }
}

let singleton = null;
const get = () => (singleton || (singleton = new Scanner()));

module.exports = { Scanner, get, fitness, grade, INTERVAL };
