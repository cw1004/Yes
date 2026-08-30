'use strict';
/**
 * 수익 구간 탐색 (parameter sweep).
 *
 * "이 종목에서 손절·목표를 얼마로 잡아야 돈이 되는가"를 과거 봉으로 전수 조사한다.
 * 결과는 **격자(heatmap)** 로 나온다 — 어느 조합이 되고 어느 조합이 안 되는지 한눈에 보인다.
 *
 * ── 과최적화(overfitting)를 막는 장치 ─────────────────────────────────
 * 파라미터를 수백 개 돌려 제일 좋은 걸 고르면, 그건 **과거에 우연히 맞은 조합**이기 쉽다.
 * 그래서:
 *   1) 데이터를 앞 70%(학습) / 뒤 30%(검증)로 나눈다.
 *   2) 학습 구간에서 1등을 고른 뒤, **검증 구간에서 다시 돌려** 살아남는지 본다.
 *   3) 검증에서 무너지면 그렇게 말한다. "이 설정은 과거에만 맞았습니다."
 *   4) 거래 수가 적은 조합은 애초에 순위에서 뺀다.
 *
 * 검증까지 통과한 조합만 "수익 구간"으로 부른다.
 */

const backtest = require('./backtest');

/** 기본 탐색 범위 — 초단타에서 현실적인 폭 */
const GRID = {
  stopPct: [0.3, 0.5, 0.7, 1.0, 1.5, 2.0],
  targetPct: [0.3, 0.5, 0.8, 1.2, 1.8, 2.5],
  entryScore: [35, 45, 55],
};

/** 학습/검증 분할 비율 */
const TRAIN_RATIO = 0.7;
/** 이보다 거래가 적은 조합은 순위에 넣지 않는다 */
const MIN_TRADES = 10;

/**
 * @param {Array} candles 시간 오름차순 봉
 * @param {{grid?:object, base?:object, minTrades?:number}} opts
 */
function sweep(candles, opts = {}) {
  const grid = Object.assign({}, GRID, opts.grid || {});
  const base = Object.assign({}, opts.base || {});
  const minTrades = opts.minTrades || MIN_TRADES;

  const bars = candles || [];
  const cut = Math.floor(bars.length * TRAIN_RATIO);
  const train = bars.slice(0, cut);
  const test = bars.slice(cut);

  const enoughData = train.length > (base.warmup || backtest.DEFAULTS.warmup) + 20
    && test.length > (base.warmup || backtest.DEFAULTS.warmup) + 10;

  // 신호는 설정과 무관하므로 학습·검증 각각 한 번만 계산해 모든 조합이 나눠 쓴다
  const trainSignals = backtest.signalSeries(enoughData ? train : bars, base);
  const testSignals = enoughData ? backtest.signalSeries(test, base) : null;

  const cells = [];
  for (const entryScore of grid.entryScore) {
    for (const stopPct of grid.stopPct) {
      for (const targetPct of grid.targetPct) {
        const cfg = Object.assign({}, base, { entryScore, stopPct, targetPct });
        const tr = backtest.run(enoughData ? train : bars,
          Object.assign({}, cfg, { signals: trainSignals })).stats;
        const te = enoughData
          ? backtest.run(test, Object.assign({}, cfg, { signals: testSignals })).stats
          : null;
        cells.push({
          entryScore, stopPct, targetPct,
          train: pick(tr),
          test: te ? pick(te) : null,
          // 학습과 검증 **둘 다** 기대값이 양수여야 살아남았다고 본다
          survives: Boolean(
            tr.trades >= minTrades && tr.expectancy > 0
            && te && te.trades > 0 && te.expectancy > 0
          ),
        });
      }
    }
  }

  // 순위: 거래 수가 충분하고 기대값이 큰 순서. 검증까지 통과한 것을 앞으로.
  const ranked = cells
    .filter((c) => c.train.trades >= minTrades)
    .sort((a, b) => {
      if (a.survives !== b.survives) return a.survives ? -1 : 1;
      return b.train.expectancy - a.train.expectancy;
    });

  const best = ranked[0] || null;
  const survivors = cells.filter((c) => c.survives);

  return {
    cells,
    ranked: ranked.slice(0, 10),
    best,
    survivors: survivors.length,
    tested: cells.length,
    split: enoughData
      ? { trainBars: train.length, testBars: test.length, ratio: TRAIN_RATIO }
      : null,
    minTrades,
    verdict: verdictOf({ best, survivors: survivors.length, enoughData, cells, minTrades }),
  };
}

/** 결과를 사람이 읽는 한 문장으로 — 좋게 포장하지 않는다 */
function verdictOf({ best, survivors, enoughData, cells, minTrades }) {
  if (!enoughData) {
    return {
      level: 'insufficient',
      text: '봉이 부족해 학습/검증을 나눌 수 없습니다. 결과를 신뢰하지 마세요.',
    };
  }
  const tradable = cells.filter((c) => c.train.trades >= minTrades).length;
  if (!tradable) {
    return {
      level: 'no-trades',
      text: `어떤 조합도 거래 ${minTrades}건을 넘기지 못했습니다. 이 기간에는 신호가 거의 없었습니다.`,
    };
  }
  if (!survivors) {
    return {
      level: 'none',
      text: '검증 구간까지 살아남은 조합이 없습니다. '
        + '이 종목·이 기간에서는 **어떤 설정으로도 안정적인 수익 구간이 확인되지 않았습니다.**',
    };
  }
  if (survivors <= 2) {
    return {
      level: 'fragile',
      text: `살아남은 조합이 ${survivors}개뿐입니다. 우연일 수 있으니 소액으로만 확인하세요.`,
    };
  }
  return {
    level: 'ok',
    text: `${survivors}개 조합이 학습·검증 양쪽에서 기대값 양수였습니다. `
      + `가장 좋은 값은 손절 -${best.stopPct}% / 목표 +${best.targetPct}% 입니다. `
      + '그래도 과거 기록일 뿐 미래를 보장하지 않습니다.',
  };
}

/**
 * 수익이 나는 구간의 경계 — "손절을 x로 잡으면 목표는 최소 얼마여야 하는가".
 * 격자에서 살아남은 칸만 모아 손절별 최소·최대 목표를 낸다.
 */
function envelope(result) {
  const byStop = new Map();
  for (const c of result.cells) {
    if (!c.survives) continue;
    if (!byStop.has(c.stopPct)) byStop.set(c.stopPct, []);
    byStop.get(c.stopPct).push(c.targetPct);
  }
  return Array.from(byStop, ([stopPct, targets]) => ({
    stopPct,
    minTarget: Math.min(...targets),
    maxTarget: Math.max(...targets),
    count: targets.length,
  })).sort((a, b) => a.stopPct - b.stopPct);
}

const pick = (s) => ({
  trades: s.trades,
  netProfit: s.netProfit,
  expectancy: s.expectancy,
  winRate: s.winRate,
  profitFactor: s.profitFactor === Infinity ? null : s.profitFactor,
  maxDrawdown: s.maxDrawdown,
});

module.exports = { sweep, envelope, GRID, TRAIN_RATIO, MIN_TRADES };
