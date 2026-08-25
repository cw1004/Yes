'use strict';
/**
 * 실시간 체결 틱 → 다중 주기 봉 집계.
 *
 * KIS가 주는 최소 봉은 1분봉이라, 10·20·30초봉은 여기서 틱을 모아 직접 만든다.
 * 그래서 초봉은 "접속한 시점부터" 쌓이고 과거는 소급되지 않는다(1분 이상은 REST로 시딩).
 *
 * 각 봉에는 OHLCV 외에 초단타 판단에 필요한 값을 함께 담는다.
 *   buyVol/sellVol  체결구분(매수틱/매도틱)별 수량 → 수급 불균형
 *   ticks           체결 건수 → 거래 활발도
 *   strength        마지막 체결강도
 */

const { TIMEFRAMES } = require('./config');

const DEFAULT_TFS = ['10s', '20s', '30s', '1m', '3m', '5m'];

class TickAggregator {
  /**
   * @param {string} code 종목코드
   * @param {{timeframes?:string[], maxBars?:number, onBar?:Function}} opts
   */
  constructor(code, opts = {}) {
    this.code = code;
    this.timeframes = opts.timeframes || DEFAULT_TFS;
    this.maxBars = opts.maxBars || 1500;
    this.onBar = opts.onBar || null;
    /** @type {Map<string, Array>} 주기 → 봉 배열 */
    this.bars = new Map(this.timeframes.map((tf) => [tf, []]));
    this.lastTick = null;
    this.seededAt = new Map();
  }

  static bucket(t, seconds) {
    const ms = seconds * 1000;
    return Math.floor(t / ms) * ms;
  }

  /** 틱 1건 반영. 새로 닫힌 봉이 있으면 콜백으로 알린다. */
  addTick(tick) {
    if (!tick || !tick.price) return [];
    this.lastTick = tick;
    const closed = [];
    for (const tf of this.timeframes) {
      const secs = TIMEFRAMES[tf];
      if (!secs) continue;
      const list = this.bars.get(tf);
      const bucket = TickAggregator.bucket(tick.t, secs);
      const cur = list[list.length - 1];

      if (!cur || cur.t < bucket) {
        // 이전 봉 확정
        if (cur && !cur.closed) {
          cur.closed = true;
          closed.push({ tf, bar: cur });
        }
        list.push(this._newBar(bucket, tick));
        if (list.length > this.maxBars) list.splice(0, list.length - this.maxBars);
      } else if (cur.t === bucket) {
        this._merge(cur, tick);
      }
      // bucket < cur.t (지연 도착 틱)은 버린다 — 확정된 봉을 뒤늦게 바꾸지 않는다
    }
    if (closed.length && this.onBar) closed.forEach((c) => this.onBar(c.tf, c.bar));
    return closed;
  }

  _newBar(t, tick) {
    const bar = {
      t,
      o: tick.price, h: tick.price, l: tick.price, c: tick.price,
      v: tick.volume || 0,
      buyVol: tick.side === 'buy' ? tick.volume || 0 : 0,
      sellVol: tick.side === 'sell' ? tick.volume || 0 : 0,
      ticks: 1,
      strength: tick.strength || 0,
      closed: false,
    };
    return bar;
  }

  _merge(bar, tick) {
    bar.h = Math.max(bar.h, tick.price);
    bar.l = Math.min(bar.l, tick.price);
    bar.c = tick.price;
    bar.v += tick.volume || 0;
    if (tick.side === 'buy') bar.buyVol += tick.volume || 0;
    else if (tick.side === 'sell') bar.sellVol += tick.volume || 0;
    bar.ticks++;
    if (tick.strength) bar.strength = tick.strength;
  }

  /**
   * REST 1분봉으로 1m 이상 주기를 시딩한다.
   * 초봉(10/20/30초)은 틱이 없으면 만들 수 없으므로 시딩하지 않는다.
   */
  seedFromMinutes(minuteCandles) {
    if (!minuteCandles || !minuteCandles.length) return;
    for (const tf of this.timeframes) {
      const secs = TIMEFRAMES[tf];
      if (!secs || secs < 60) continue;
      const resampled = resample(minuteCandles, secs);
      const list = this.bars.get(tf);
      // 이미 틱으로 만든 봉이 있으면 그보다 과거만 채운다
      const firstLive = list.length ? list[0].t : Infinity;
      const merged = resampled.filter((b) => b.t < firstLive).concat(list);
      this.bars.set(tf, merged.slice(-this.maxBars));
      this.seededAt.set(tf, Date.now());
    }
  }

  /** 초봉이 아직 비어 있을 때 1분봉 마지막 값으로 최소한의 기준선을 만든다 */
  primeFromLastPrice(price, t = Date.now()) {
    for (const tf of this.timeframes) {
      const secs = TIMEFRAMES[tf];
      const list = this.bars.get(tf);
      if (secs < 60 && !list.length && price) {
        list.push(this._newBar(TickAggregator.bucket(t, secs), { price, volume: 0, side: 'flat' }));
      }
    }
  }

  getCandles(tf, limit) {
    const list = this.bars.get(tf) || [];
    return limit ? list.slice(-limit) : list.slice();
  }

  /** 최근 N초간의 체결 통계 (초단타 신호용) */
  recentStats(tf = '10s', lookback = 6) {
    const list = this.getCandles(tf, lookback);
    if (!list.length) return null;
    const buy = list.reduce((a, b) => a + b.buyVol, 0);
    const sell = list.reduce((a, b) => a + b.sellVol, 0);
    const vol = list.reduce((a, b) => a + b.v, 0);
    const ticks = list.reduce((a, b) => a + b.ticks, 0);
    return {
      bars: list.length,
      volume: vol,
      buyVol: buy,
      sellVol: sell,
      // -1(매도 우위) ~ +1(매수 우위)
      imbalance: buy + sell > 0 ? (buy - sell) / (buy + sell) : 0,
      ticksPerBar: ticks / list.length,
      strength: list[list.length - 1].strength,
    };
  }

  get size() {
    return this.timeframes.reduce((a, tf) => a + (this.bars.get(tf) || []).length, 0);
  }
}

/** 1분봉 배열을 더 큰 주기로 재집계 */
function resample(minuteCandles, seconds) {
  const out = [];
  for (const c of minuteCandles) {
    const bucket = TickAggregator.bucket(c.t, seconds);
    const cur = out[out.length - 1];
    if (!cur || cur.t !== bucket) {
      out.push({
        t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0,
        buyVol: 0, sellVol: 0, ticks: 0, strength: 0, closed: true, seeded: true,
      });
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v || 0;
    }
  }
  return out;
}

module.exports = { TickAggregator, resample, DEFAULT_TFS };
