'use strict';
/**
 * 과거 봉 재생(백테스트) 엔진.
 *
 * ── 무엇을 위한 것인가 ─────────────────────────────────────────────────
 * "손절 -1% / 목표 +1.5%" 같은 설정이 **이 종목에서 실제로 돈이 됐는지**를
 * 과거 봉에 그대로 돌려 확인한다. 여기서 나온 결과로 수익 구간(profit envelope)을 찾는다.
 *
 * ── 정직하게 만들기 위한 규칙 ──────────────────────────────────────────
 * 백테스트는 마음만 먹으면 얼마든지 좋아 보이게 만들 수 있다. 그래서 다음을 강제한다.
 *
 * 1) **미래를 보지 않는다.** i번째 봉에서 신호를 계산할 때 candles[0..i] 만 쓴다.
 * 2) **본 가격에 못 산다.** 신호는 봉이 닫힌 뒤에 나오므로 진입은 **다음 봉 시가**다.
 * 3) **최악을 가정한다.** 한 봉 안에서 손절선과 목표선이 모두 닿았으면 **손절이 먼저**
 *    맞은 것으로 본다. 봉 데이터만으로는 순서를 알 수 없기 때문이다.
 * 4) **슬리피지를 뗀다.** 시장가·최유리 주문은 호가만큼 밀린다고 본다(기본 1호가).
 * 5) **실제 비용을 뗀다.** 수수료·증권거래세를 원 미만 절사까지 그대로 반영한다.
 * 6) **표본을 밝힌다.** 거래 수가 적으면 결과는 우연이다. 그 사실을 결과에 담는다.
 *
 * 그래도 백테스트는 과거일 뿐이다. 미래 수익을 보장하지 않는다.
 */

const C = require('./kr/config');
const KRSignal = require('../public/js/kr-signal.js');

const DEFAULTS = {
  entryScore: 45,        // 이 점수 이상이면 진입
  exitScore: -15,        // 보유 중 이 아래로 떨어지면 청산
  stopPct: 1.0,          // 손절 폭(%)
  targetPct: 1.5,        // 목표 폭(%)
  maxHoldBars: 30,       // 이 봉 수를 넘으면 무조건 청산
  slippageTicks: 1,      // 진입·청산 각각 밀리는 호가 수
  qty: 100,              // 1회 주식 수 (비용의 절사 효과 때문에 수량이 결과에 영향을 준다)
  warmup: 40,            // 지표가 자리 잡을 때까지 건너뛸 봉 수
  market: 'KOSPI',
  isEtf: false,
  allowShort: false,     // 국내는 개인 공매도가 사실상 막혀 있어 기본 꺼짐
};

/**
 * 봉 하나를 재생하며 전략을 돌린다.
 *
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} candles 시간 오름차순
 * @param {object} opts DEFAULTS 참고
 * @returns {{trades:Array, stats:object, equity:Array, config:object}}
 */
function run(candles, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  // 신호는 손절·목표 설정과 무관하다. 격자 탐색에서 수백 번 다시 계산하지 않도록
  // 미리 계산한 배열을 받을 수 있게 했다 (없으면 여기서 만든다).
  const signals = opts.signals || null;
  const bars = (candles || []).filter((b) => b && isFinite(b.c) && b.c > 0);
  if (bars.length < cfg.warmup + 5) {
    return { trades: [], equity: [], config: cfg, stats: emptyStats('봉이 부족합니다 (' + bars.length + '개)') };
  }

  const trades = [];
  const equity = [];
  let cash = 0;              // 누적 실현손익(원)
  let pos = null;

  for (let i = cfg.warmup; i < bars.length - 1; i++) {
    const bar = bars[i];
    const next = bars[i + 1];

    /* ── 보유 중이면 이번 봉 안에서 청산 조건부터 본다 ─────────────── */
    if (pos) {
      pos.heldBars++;
      const hitStop = bar.l <= pos.stop;
      const hitTarget = bar.h >= pos.target;

      let exitPrice = null;
      let reason = null;
      // 규칙 3: 둘 다 닿았으면 손절이 먼저 맞은 것으로 본다
      if (hitStop) { exitPrice = pos.stop; reason = '손절'; }
      else if (hitTarget) { exitPrice = pos.target; reason = '목표'; }
      else if (pos.heldBars >= cfg.maxHoldBars) { exitPrice = bar.c; reason = '보유시간 초과'; }

      if (exitPrice == null) {
        // 신호가 무너졌으면 다음 봉 시가에 나온다
        const sig = signals ? signals[i] : signalAt(bars, i, cfg);
        if (sig && sig.score <= cfg.exitScore) {
          exitPrice = slipped(next.o, cfg, 'sell');
          reason = '신호 이탈';
        }
      }

      if (exitPrice != null) {
        const fill = reason === '손절' || reason === '목표'
          ? exitPrice                        // 지정가로 걸어 둔 것이므로 그 가격에 체결
          : slipped(exitPrice, cfg, 'sell'); // 시장가 청산은 밀린다
        const bill = C.settlement({
          buyPrice: pos.entry, qty: pos.qty, sellPrice: fill, isEtf: cfg.isEtf,
        });
        cash += bill.netProfit;
        trades.push({
          entryT: pos.t, exitT: bar.t,
          entry: pos.entry, exit: fill, qty: pos.qty,
          bars: pos.heldBars, reason,
          gross: (fill - pos.entry) * pos.qty,
          cost: bill.totalCost,
          net: bill.netProfit,
          netPct: bill.netReturnRate,
          score: pos.score,
        });
        pos = null;
      }
    }

    /* ── 비어 있으면 진입을 본다 ────────────────────────────────────── */
    if (!pos) {
      const sig = signals ? signals[i] : signalAt(bars, i, cfg);
      if (sig && sig.score >= cfg.entryScore) {
        // 규칙 2: 봉이 닫힌 뒤 신호가 나오므로 다음 봉 시가에 산다
        const entry = slipped(next.o, cfg, 'buy');
        const stop = C.alignPrice(entry * (1 - cfg.stopPct / 100), cfg.market, 'down');
        const target = C.alignPrice(entry * (1 + cfg.targetPct / 100), cfg.market, 'up');
        const tick = C.tickSize(entry, cfg.market);
        pos = {
          t: next.t, entry, qty: cfg.qty, heldBars: 0, score: sig.score,
          stop: Math.min(stop, entry - tick),      // 최소 1호가는 벌어져야 한다
          target: Math.max(target, entry + tick),
        };
      }
    }

    equity.push({ t: bar.t, cash });
  }

  // 마지막까지 들고 있었으면 마지막 종가로 정리한다
  if (pos) {
    const last = bars[bars.length - 1];
    const fill = slipped(last.c, cfg, 'sell');
    const bill = C.settlement({ buyPrice: pos.entry, qty: pos.qty, sellPrice: fill, isEtf: cfg.isEtf });
    cash += bill.netProfit;
    trades.push({
      entryT: pos.t, exitT: last.t, entry: pos.entry, exit: fill, qty: pos.qty,
      bars: pos.heldBars, reason: '기간 종료',
      gross: (fill - pos.entry) * pos.qty, cost: bill.totalCost,
      net: bill.netProfit, netPct: bill.netReturnRate, score: pos.score,
    });
    equity.push({ t: last.t, cash });
  }

  return { trades, equity, config: cfg, stats: summarize(trades, equity, cfg, bars) };
}

/**
 * 봉마다의 신호를 한 번에 계산한다.
 * 격자 탐색은 같은 봉에 설정만 바꿔 가며 도는 것이라, 이걸 재사용하면 수백 배 빨라진다.
 * @returns {Array<{score:number}|null>} 인덱스가 봉 인덱스와 같다
 */
function signalSeries(candles, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const bars = (candles || []).filter((b) => b && isFinite(b.c) && b.c > 0);
  const out = new Array(bars.length).fill(null);
  for (let i = cfg.warmup; i < bars.length; i++) out[i] = signalAt(bars, i, cfg);
  return out;
}

/** 규칙 1: candles[0..i] 만 넘겨 미래를 못 보게 한다 */
function signalAt(bars, i, cfg) {
  const slice = bars.slice(0, i + 1);
  try {
    const a = KRSignal.analyze(slice);
    return KRSignal.evaluate(a, { market: cfg.market, phase: 'regular', barSeconds: cfg.barSeconds || 60 });
  } catch (_) {
    return null;
  }
}

/** 규칙 4: 살 때는 위로, 팔 때는 아래로 밀린다 */
function slipped(price, cfg, side) {
  const t = C.tickSize(price, cfg.market);
  const d = (cfg.slippageTicks || 0) * t;
  return C.alignPrice(side === 'buy' ? price + d : price - d, cfg.market, side === 'buy' ? 'up' : 'down');
}

/* ------------------------------------------------------------------ 통계 */

function emptyStats(note) {
  return {
    trades: 0, netProfit: 0, winRate: null, avgWin: null, avgLoss: null,
    profitFactor: null, expectancy: null, maxDrawdown: 0, totalCost: 0,
    reliable: false, note,
  };
}

function summarize(trades, equity, cfg, bars) {
  if (!trades.length) return emptyStats('거래가 한 건도 발생하지 않았습니다.');

  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const sum = (a) => a.reduce((s, t) => s + t.net, 0);
  const netProfit = sum(trades);
  const grossWin = sum(wins);
  const grossLoss = Math.abs(sum(losses));

  // 최대 낙폭 — 자산 곡선의 고점 대비 최대 하락폭
  let peak = 0, mdd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.cash);
    mdd = Math.max(mdd, peak - e.cash);
  }

  const invested = trades[0].entry * cfg.qty;   // 1회 투입 기준
  const byReason = {};
  for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

  return {
    trades: trades.length,
    netProfit: Math.round(netProfit),
    // 1회 투입액 대비 누적 수익률 (같은 돈을 계속 굴렸다고 볼 때)
    netPct: invested ? round3((netProfit / invested) * 100) : null,
    winRate: round2((wins.length / trades.length) * 100),
    avgWin: wins.length ? Math.round(grossWin / wins.length) : 0,
    avgLoss: losses.length ? -Math.round(grossLoss / losses.length) : 0,
    // 총이익 / 총손실. 1 이하면 손해 나는 전략이다
    profitFactor: grossLoss > 0 ? round3(grossWin / grossLoss) : (grossWin > 0 ? Infinity : 0),
    // 1회 거래당 기대 손익(원) — 이게 양수여야 의미가 있다
    expectancy: Math.round(netProfit / trades.length),
    maxDrawdown: Math.round(mdd),
    totalCost: Math.round(trades.reduce((s, t) => s + t.cost, 0)),
    avgBars: round2(trades.reduce((s, t) => s + t.bars, 0) / trades.length),
    byReason,
    barsTested: bars.length,
    // 표본이 적으면 우연이다. 30건은 최소선이고 그래도 충분하지 않다.
    reliable: trades.length >= 30,
    note: trades.length < 30
      ? `거래 ${trades.length}건뿐이라 우연일 가능성이 큽니다. 참고만 하세요.`
      : null,
  };
}

const round2 = (v) => (isFinite(v) ? Math.round(v * 100) / 100 : null);
const round3 = (v) => (isFinite(v) ? Math.round(v * 1000) / 1000 : null);

module.exports = { run, DEFAULTS, summarize, slipped, signalSeries, signalAt };
