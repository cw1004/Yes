/**
 * 한국 주식 초단타 신호 엔진.
 *
 * 미국 화면에서 쓰던 지표·신호 엔진(signals.js)을 그대로 재사용하되,
 * 초단타에서만 의미가 있는 요소를 얹어 최종 점수를 만든다.
 *   · 호가 불균형(매수잔량 vs 매도잔량)
 *   · 체결강도와 최근 체결 수급(매수틱/매도틱 수량)
 *   · 스프레드와 유동성 (넓으면 슬리피지로 다 까먹는다)
 *   · 수수료+거래세를 덮는 최소 목표 호가
 *   · 상·하한가 및 VI 근접 경고
 *
 * 서버(자동매매)와 브라우저(화면)가 같은 파일을 쓰므로 판단이 어긋나지 않는다.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module === 'object';
  const api = factory(
    isNode ? require('./signals.js') : root.Signals,
    isNode ? require('../../server/kr/config.js') : root.KRConfig
  );
  if (isNode) module.exports = api;
  else root.KRSignal = api;
})(typeof self !== 'undefined' ? self : this, function (Signals, C) {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * @param {Array} candles 집계된 봉 (o/h/l/c/v + buyVol/sellVol/ticks)
   * @param {object} cfg    지표 설정
   */
  function analyze(candles, cfg = {}) {
    return Signals.analyze(candles, Object.assign({
      maConfig: [
        { period: 5, type: 'ema' },
        { period: 20, type: 'ema' },
        { period: 60, type: 'sma' },
        { period: 120, type: 'sma' },
      ],
      intraday: true,
      barsPerYear: 0, // 초봉에서는 연율화 변동성이 무의미해 계산을 건너뛴다
    }, cfg));
  }

  /**
   * @param {object} a analyze() 결과
   * @param {object} ctx {orderbook, flow, quote, market, cost, tickSeconds}
   */
  function evaluate(a, ctx = {}) {
    const base = Signals.evaluate(a);
    if (!a.candles || a.candles.length < 10) return base;

    const price = a.candles[a.candles.length - 1].c;
    const market = ctx.market || 'KOSPI';
    const tick = C.tickSize(price, market);
    const reasons = base.reasons.slice();
    let score = base.score;
    const add = (dir, weight, title, detail) => {
      score += dir * weight;
      reasons.push({ dir, weight, title, detail });
    };
    const note = (title, detail) => reasons.push({ dir: 0, weight: 0, title, detail });

    /* 1) 호가 불균형 --------------------------------------------------- */
    const ob = ctx.orderbook;
    let obImbalance = null;
    let spreadTicks = null;
    if (ob && ob.asks && ob.bids && ob.asks[0] && ob.bids[0]) {
      const totalAsk = ob.totalAsk || ob.asks.reduce((s, x) => s + x.qty, 0);
      const totalBid = ob.totalBid || ob.bids.reduce((s, x) => s + x.qty, 0);
      if (totalAsk + totalBid > 0) {
        obImbalance = (totalBid - totalAsk) / (totalBid + totalAsk);
        if (obImbalance > 0.25) add(1, 14, '호가 매수우위', `매수잔량이 매도잔량보다 ${(obImbalance * 100).toFixed(0)}% 두껍다`);
        else if (obImbalance < -0.25) add(-1, 14, '호가 매도우위', `매도잔량이 ${(-obImbalance * 100).toFixed(0)}% 두껍다 — 위가 막혀 있다`);
      }
      // 1호가 잔량비: 즉시 체결 압력
      const bid1 = ob.bids[0].qty;
      const ask1 = ob.asks[0].qty;
      if (ask1 > 0 && bid1 > 0) {
        const ratio = bid1 / ask1;
        if (ratio >= 2.5) add(1, 8, '매수 1호가 두터움', `매수1 ${fmtQty(bid1)} vs 매도1 ${fmtQty(ask1)}`);
        else if (ratio <= 0.4) add(-1, 8, '매도 1호가 두터움', `매도1 ${fmtQty(ask1)} vs 매수1 ${fmtQty(bid1)}`);
      }
      if (ob.asks[0].price && ob.bids[0].price) {
        spreadTicks = Math.max(0, Math.round((ob.asks[0].price - ob.bids[0].price) / tick));
        if (spreadTicks >= 3) {
          add(-1, 10, '스프레드 과다', `${spreadTicks}호가 벌어짐 — 진입만 해도 ${spreadTicks}틱 손실`);
        }
      }
    }

    /* 2) 최근 체결 수급 ------------------------------------------------ */
    const flow = ctx.flow;
    if (flow && flow.volume > 0) {
      if (flow.imbalance > 0.2) add(1, 12, '매수 체결 우위', `최근 ${flow.bars}봉 매수체결 ${(flow.imbalance * 100).toFixed(0)}% 우위`);
      else if (flow.imbalance < -0.2) add(-1, 12, '매도 체결 우위', `최근 ${flow.bars}봉 매도체결 ${(-flow.imbalance * 100).toFixed(0)}% 우위`);
      if (flow.ticksPerBar < 2) note('체결 한산', `봉당 체결 ${flow.ticksPerBar.toFixed(1)}건 — 유동성 부족, 초단타 부적합`);
    }

    /* 3) 체결강도 ------------------------------------------------------ */
    const strength = ctx.quote && ctx.quote.strength ? ctx.quote.strength : flow && flow.strength;
    if (strength) {
      if (strength >= 130) add(1, 10, '체결강도 강함', `${strength.toFixed(0)}% — 매수 체결이 압도`);
      else if (strength <= 75) add(-1, 10, '체결강도 약함', `${strength.toFixed(0)}% — 매도 체결이 압도`);
    }

    /* 4) 순간 거래량 급증 ---------------------------------------------- */
    const vols = a.candles.slice(-21, -1).map((c) => c.v);
    const avgVol = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : 0;
    const curVol = a.candles[a.candles.length - 1].v;
    if (avgVol > 0) {
      const ratio = curVol / avgVol;
      if (ratio >= 3) {
        const up = a.candles[a.candles.length - 1].c >= a.candles[a.candles.length - 1].o;
        add(up ? 1 : -1, 12, '순간 거래량 폭증', `직전 20봉 평균의 ${ratio.toFixed(1)}배`);
      }
    }

    /* 5) 상·하한가 / VI 근접 ------------------------------------------- */
    const q = ctx.quote;
    if (q && q.previousClose) {
      const pct = ((price - q.previousClose) / q.previousClose) * 100;
      if (q.upperLimit && (q.upperLimit - price) / price < 0.01) {
        note('상한가 근접', '거래 정지·품절주 위험. 매수 체결이 어려울 수 있다');
      }
      if (q.lowerLimit && (price - q.lowerLimit) / price < 0.01) {
        note('하한가 근접', '반대매매 물량 주의');
      }
      if (Math.abs(pct) >= C.STATIC_VI_PCT - 1) {
        note('VI 발동권 근접', `전일 대비 ${pct.toFixed(1)}% — 정적VI(±${C.STATIC_VI_PCT}%) 발동 시 2분간 단일가`);
      }
    }

    /* 6) 장 운영 시간 --------------------------------------------------- */
    const phase = ctx.phase || C.marketPhase();
    if (phase !== 'regular') {
      const label = { preopen: '장전 동시호가', closeauction: '장 마감 동시호가', after: '시간외', closed: '장 마감' }[phase] || phase;
      note('정규장 아님', `${label} — 초단타 진입 부적합`);
      score = Math.round(score * 0.3);
    }

    score = clamp(Math.round(score), -100, 100);

    let label = '관망';
    let tone = 'flat';
    if (score >= 45) { label = '적극 매수'; tone = 'strong-buy'; }
    else if (score >= 20) { label = '매수 우위'; tone = 'buy'; }
    else if (score <= -45) { label = '적극 매도'; tone = 'strong-sell'; }
    else if (score <= -20) { label = '매도 우위'; tone = 'sell'; }

    reasons.sort((x, y) => y.weight - x.weight);

    return {
      score, label, tone, reasons,
      plan: buildPlan(a, score, ctx),
      stats: Object.assign({}, base.stats, {
        tick,
        market,
        spreadTicks,
        obImbalance,
        flowImbalance: flow ? flow.imbalance : null,
        strength: strength || null,
        breakevenTicks: C.breakevenTicks(price, market, ctx.cost),
        phase,
      }),
    };
  }

  /**
   * 초단타 매매 플랜 — 전부 호가(틱) 단위로 계산한다.
   * 손절은 최근 변동성(ATR)을 틱으로 환산해 최소 2틱 이상,
   * 목표는 "수수료+세금을 덮고도 남는" 최소 틱수를 보장한다.
   */
  function buildPlan(a, score, ctx = {}) {
    const candles = a.candles;
    const i = candles.length - 1;
    if (i < 5) return null;
    const price = candles[i].c;
    const market = ctx.market || 'KOSPI';
    const cost = ctx.cost || C.COST;
    const tick = C.tickSize(price, market);
    const atr = a.atr && a.atr[i] ? a.atr[i] : null;
    const long = score >= 0;

    const beTicks = C.breakevenTicks(price, market, cost);
    const atrTicks = atr ? Math.max(1, Math.round(atr / tick)) : 2;
    const stopTicks = Math.max(2, Math.min(20, atrTicks));
    const targetRR = ctx.targetRR || 1.5;
    // 목표 호가 상한은 봉 주기에 따라 달라진다.
    // 10초봉에서 40호가를 노리는 건 비현실적이지만, 10분봉이라면 정상 범위다.
    const barSeconds = ctx.barSeconds || 10;
    const maxTargetTicks = ctx.maxTargetTicks || Math.max(8, Math.round(Math.sqrt(barSeconds) * 2));
    // 목표는 "왕복비용을 덮고도 손익비 1.5가 되는" 호가수로 역산한다.
    //   순익 = 목표틱*틱 - 비용,  리스크 = 손절틱*틱 + 비용
    //   순익 / 리스크 >= targetRR  →  목표틱 = (targetRR*리스크 + 비용) / 틱
    const costEst = C.roundTripCost(price, 1, cost);
    const riskEst = stopTicks * tick + costEst;
    const targetTicks = Math.max(beTicks + 1, Math.ceil((targetRR * riskEst + costEst) / tick));

    const ob = ctx.orderbook;
    // 진입가: 롱이면 매도1호가(최유리)로 즉시 체결을 가정
    const entry = long
      ? (ob && ob.asks && ob.asks[0] && ob.asks[0].price) || C.alignPrice(price + tick, market, 'up')
      : (ob && ob.bids && ob.bids[0] && ob.bids[0].price) || C.alignPrice(price - tick, market, 'down');

    const stop = long ? entry - stopTicks * tick : entry + stopTicks * tick;
    const target = long ? entry + targetTicks * tick : entry - targetTicks * tick;

    // 1주 기준 비용 차감 순손익
    const grossPerShare = Math.abs(target - entry);
    const costPerShare = C.roundTripCost(entry, 1, cost);
    const netPerShare = grossPerShare - costPerShare;
    const riskPerShare = Math.abs(entry - stop) + costPerShare;

    return {
      side: long ? 'LONG' : 'SHORT',
      entry, stop, target,
      tick,
      stopTicks, targetTicks, breakevenTicks: beTicks,
      grossPerShare, costPerShare, netPerShare, riskPerShare,
      rr: riskPerShare > 0 ? netPerShare / riskPerShare : null,
      barSeconds,
      maxTargetTicks,
      // 해당 주기에서 현실적으로 잡을 수 있는 폭인지 확인한다
      viable: netPerShare > 0 && targetTicks <= maxTargetTicks,
      note: netPerShare <= 0
        ? `목표 ${targetTicks}호가로는 비용(${Math.round(costPerShare)}원/주)을 못 덮는다`
        : targetTicks > maxTargetTicks
          ? `손익비 ${targetRR}을 맞추려면 ${targetTicks}호가가 필요해 ${labelFor(barSeconds)} 기준으로는 무리`
          : `비용 차감 후 주당 약 ${Math.round(netPerShare)}원`,
    };
  }

  /** 계좌·리스크로 수량 산출 (매수 여력과 1회 최대 투입액 모두 반영) */
  function positionSize(opts) {
    const { cash, riskPct, riskPerShare, entry, maxAmount } = opts;
    if (!cash || !riskPerShare || !entry) return null;
    const riskAmount = (cash * (riskPct || 1)) / 100;
    const byRisk = Math.floor(riskAmount / riskPerShare);
    const byCash = Math.floor(cash / entry);
    const byCap = maxAmount ? Math.floor(maxAmount / entry) : Infinity;
    const qty = Math.max(0, Math.min(byRisk, byCash, byCap));
    return {
      qty,
      byRisk, byCash, byCap: isFinite(byCap) ? byCap : null,
      limitedBy: qty === byRisk ? 'risk' : qty === byCap ? 'cap' : 'cash',
      notional: qty * entry,
      maxLoss: qty * riskPerShare,
    };
  }

  /** 봉 주기를 사람이 읽는 말로 */
  function labelFor(seconds) {
    if (seconds < 60) return `${seconds}초봉`;
    return `${Math.round(seconds / 60)}분봉`;
  }

  function fmtQty(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + '만';
    return String(Math.round(v));
  }

  return { analyze, evaluate, buildPlan, positionSize };
});
