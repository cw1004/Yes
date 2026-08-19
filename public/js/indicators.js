/**
 * 기술적 지표 계산 모듈 (순수 함수).
 * 브라우저에서는 window.TA, Node 테스트에서는 module.exports 로 노출된다.
 * 모든 함수는 입력과 동일한 길이의 배열을 돌려주며, 계산 불가 구간은 null 이다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TA = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  /** 단순이동평균 (Simple Moving Average) */
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0) return out;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const v = num(values[i]);
      if (v === null) {
        sum = 0;
        count = 0;
        continue;
      }
      sum += v;
      count++;
      if (count > period) {
        sum -= num(values[i - period]) || 0;
        count = period;
      }
      if (count === period) out[i] = sum / period;
    }
    return out;
  }

  /** 지수이동평균 (Exponential Moving Average) */
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0) return out;
    const k = 2 / (period + 1);
    let prev = null;
    let seed = 0;
    let seen = 0;
    for (let i = 0; i < values.length; i++) {
      const v = num(values[i]);
      if (v === null) continue;
      if (prev === null) {
        seed += v;
        seen++;
        if (seen === period) {
          prev = seed / period;
          out[i] = prev;
        }
        continue;
      }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  /** Wilder 평활 (RSI/ATR 등에서 사용) */
  function wilder(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    let seen = 0;
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = num(values[i]);
      if (v === null) continue;
      if (prev === null) {
        sum += v;
        seen++;
        if (seen === period) {
          prev = sum / period;
          out[i] = prev;
        }
        continue;
      }
      prev = (prev * (period - 1) + v) / period;
      out[i] = prev;
    }
    return out;
  }

  function stddev(values, period, means) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const mean = means[i];
      if (mean === null) continue;
      let acc = 0;
      let ok = true;
      for (let j = i - period + 1; j <= i; j++) {
        const v = num(values[j]);
        if (v === null) {
          ok = false;
          break;
        }
        acc += (v - mean) ** 2;
      }
      if (ok) out[i] = Math.sqrt(acc / period);
    }
    return out;
  }

  /**
   * 볼린저 밴드.
   * @returns {{mid:Array, upper:Array, lower:Array, width:Array, percentB:Array}}
   *  width  = (상단-하단)/중심선  → 스퀴즈(변동성 수축) 판정에 사용
   *  percentB = (종가-하단)/(상단-하단)
   */
  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const sd = stddev(values, period, mid);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    const width = new Array(values.length).fill(null);
    const percentB = new Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      if (mid[i] === null || sd[i] === null) continue;
      upper[i] = mid[i] + mult * sd[i];
      lower[i] = mid[i] - mult * sd[i];
      width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
      const span = upper[i] - lower[i];
      percentB[i] = span ? (values[i] - lower[i]) / span : 0.5;
    }
    return { mid, upper, lower, width, percentB };
  }

  /** RSI (Wilder) */
  function rsi(values, period = 14) {
    const gains = new Array(values.length).fill(null);
    const losses = new Array(values.length).fill(null);
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gains[i] = Math.max(0, d);
      losses[i] = Math.max(0, -d);
    }
    const ag = wilder(gains.slice(1), period);
    const al = wilder(losses.slice(1), period);
    const out = new Array(values.length).fill(null);
    for (let i = 0; i < ag.length; i++) {
      if (ag[i] === null || al[i] === null) continue;
      out[i + 1] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
    }
    return out;
  }

  /** MACD (기본 12, 26, 9) */
  function macd(values, fast = 12, slow = 26, signal = 9) {
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] === null || es[i] === null ? null : ef[i] - es[i]));
    const compact = line.filter((v) => v !== null);
    const sigCompact = ema(compact, signal);
    const sig = new Array(values.length).fill(null);
    let k = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === null) continue;
      sig[i] = sigCompact[k++];
    }
    const hist = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]));
    return { line, signal: sig, hist };
  }

  /** 스토캐스틱 (%K, %D) */
  function stochastic(high, low, close, kPeriod = 14, kSmooth = 3, dPeriod = 3) {
    const raw = new Array(close.length).fill(null);
    for (let i = kPeriod - 1; i < close.length; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - kPeriod + 1; j <= i; j++) {
        hh = Math.max(hh, high[j]);
        ll = Math.min(ll, low[j]);
      }
      raw[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
    }
    const k = smoothNullable(raw, kSmooth);
    const d = smoothNullable(k, dPeriod);
    return { k, d };
  }

  function smoothNullable(arr, period) {
    const compact = [];
    const idx = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null) {
        compact.push(arr[i]);
        idx.push(i);
      }
    }
    const sm = sma(compact, period);
    const out = new Array(arr.length).fill(null);
    for (let i = 0; i < idx.length; i++) out[idx[i]] = sm[i];
    return out;
  }

  /** True Range / ATR – 손절폭 산정에 사용 */
  function atr(high, low, close, period = 14) {
    const tr = new Array(close.length).fill(null);
    for (let i = 0; i < close.length; i++) {
      if (i === 0) {
        tr[i] = high[i] - low[i];
        continue;
      }
      tr[i] = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1])
      );
    }
    return wilder(tr, period);
  }

  /** 당일(세션) 기준 VWAP – 단타의 기준선 */
  function vwap(candles) {
    const out = new Array(candles.length).fill(null);
    let pv = 0;
    let vol = 0;
    let day = null;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const d = new Date(c.t).toISOString().slice(0, 10);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const typical = (c.h + c.l + c.c) / 3;
      const v = c.v || 0;
      pv += typical * v;
      vol += v;
      out[i] = vol > 0 ? pv / vol : typical;
    }
    return out;
  }

  /** OBV (누적 거래량) */
  function obv(candles) {
    const out = new Array(candles.length).fill(null);
    let acc = 0;
    for (let i = 0; i < candles.length; i++) {
      if (i > 0) {
        if (candles[i].c > candles[i - 1].c) acc += candles[i].v || 0;
        else if (candles[i].c < candles[i - 1].c) acc -= candles[i].v || 0;
      }
      out[i] = acc;
    }
    return out;
  }

  /**
   * 피봇(스윙) 고점/저점 탐지.
   * left/right 개의 봉보다 높은(낮은) 봉만 스윙으로 인정한다.
   */
  function pivots(candles, left = 3, right = 3) {
    const highs = [];
    const lows = [];
    for (let i = left; i < candles.length - right; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (candles[j].h >= candles[i].h) isHigh = false;
        if (candles[j].l <= candles[i].l) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) highs.push({ i, price: candles[i].h, t: candles[i].t });
      if (isLow) lows.push({ i, price: candles[i].l, t: candles[i].t });
    }
    return { highs, lows };
  }

  /** 두 점을 잇는 직선 (y = slope * x + intercept, x는 봉 인덱스) */
  function lineThrough(a, b) {
    if (!a || !b || a.i === b.i) return null;
    const slope = (b.price - a.price) / (b.i - a.i);
    return { slope, intercept: a.price - slope * a.i, from: a, to: b };
  }

  /**
   * 자동 추세선: 최근 스윙 고점 2개(저항), 스윙 저점 2개(지지)를 연결.
   * 이후 봉에서 선을 뚫는 경우(돌파)를 신호 엔진이 사용한다.
   */
  function autoTrendlines(candles, left = 3, right = 3) {
    const { highs, lows } = pivots(candles, left, right);
    const pickHighs = highs.slice(-4);
    const pickLows = lows.slice(-4);
    const resistance = lineThrough(pickHighs[pickHighs.length - 2], pickHighs[pickHighs.length - 1]);
    const support = lineThrough(pickLows[pickLows.length - 2], pickLows[pickLows.length - 1]);
    return { resistance, support, highs, lows };
  }

  /** 최소제곱 회귀 추세선 (최근 n봉) */
  function regressionLine(values, lookback) {
    const n = Math.min(lookback, values.length);
    const start = values.length - n;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    let cnt = 0;
    for (let i = start; i < values.length; i++) {
      const y = num(values[i]);
      if (y === null) continue;
      const x = i;
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
      cnt++;
    }
    if (cnt < 2) return null;
    const denom = cnt * sxx - sx * sx;
    if (!denom) return null;
    const slope = (cnt * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / cnt;
    return { slope, intercept, from: { i: start }, to: { i: values.length - 1 } };
  }

  /** 지지·저항 레벨: 스윙 가격대를 근접도 기준으로 군집화하고 터치 횟수로 정렬 */
  function supportResistance(candles, tolerancePct = 0.35, maxLevels = 5, nearPct = 8) {
    const { highs, lows } = pivots(candles, 3, 3);
    const points = [...highs.map((p) => ({ ...p, kind: 'R' })), ...lows.map((p) => ({ ...p, kind: 'S' }))];
    const clusters = [];
    points.sort((a, b) => a.price - b.price);
    for (const p of points) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(p.price - last.price) / last.price * 100 <= tolerancePct) {
        last.price = (last.price * last.touches + p.price) / (last.touches + 1);
        last.touches++;
        last.lastIndex = Math.max(last.lastIndex, p.i);
      } else {
        clusters.push({ price: p.price, touches: 1, lastIndex: p.i });
      }
    }
    // 현재가에서 너무 먼 레벨은 단타에 쓸모가 없으므로 제외
    const price = candles[candles.length - 1].c;
    const near = clusters
      .filter((c) => Math.abs(c.price - price) / price * 100 <= nearPct)
      .sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex);
    // 두 번 이상 눌린 자리를 우선하고, 부족하면 한 번짜리로 채운다
    const strong = near.filter((c) => c.touches >= 2);
    const picked = (strong.length >= 2 ? strong : near).slice(0, maxLevels);
    return picked.sort((a, b) => a.price - b.price);
  }

  /** 피보나치 되돌림 (최근 구간 고·저 기준) */
  function fibonacci(candles, lookback = 120) {
    const slice = candles.slice(-lookback);
    if (!slice.length) return null;
    let hi = -Infinity;
    let lo = Infinity;
    let hiIdx = 0;
    let loIdx = 0;
    slice.forEach((c, i) => {
      if (c.h > hi) {
        hi = c.h;
        hiIdx = i;
      }
      if (c.l < lo) {
        lo = c.l;
        loIdx = i;
      }
    });
    const up = loIdx < hiIdx; // 저점이 먼저면 상승 파동
    const diff = hi - lo;
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({
      ratio: r,
      price: up ? hi - diff * r : lo + diff * r,
    }));
    return { high: hi, low: lo, up, levels };
  }

  /** 백분위 순위(0~100): 현재 값이 과거 구간에서 어느 위치인지 */
  function percentileRank(values, lookback) {
    const arr = values.slice(-lookback).filter((v) => v !== null && isFinite(v));
    if (arr.length < 5) return null;
    const cur = arr[arr.length - 1];
    const below = arr.filter((v) => v <= cur).length;
    return (below / arr.length) * 100;
  }

  /** 실현 변동성(연율화 %) – 참고 정보용 */
  function volatility(closes, period = 20, barsPerYear = 98280) {
    if (closes.length < period + 1) return null;
    const rets = [];
    for (let i = closes.length - period; i < closes.length; i++) {
      if (i <= 0) continue;
      rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1 || 1);
    return Math.sqrt(varr) * Math.sqrt(barsPerYear) * 100;
  }

  return {
    sma, ema, wilder, bollinger, rsi, macd, stochastic, atr, vwap, obv,
    pivots, lineThrough, autoTrendlines, regressionLine, supportResistance,
    fibonacci, percentileRank, volatility,
  };
});
