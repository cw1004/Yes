/**
 * 단타(스캘핑) 신호 엔진.
 * 여러 지표의 판정을 가중 합산해 -100 ~ +100 점수를 만들고,
 * ATR 기반 손절/목표가와 손익비(R:R)를 포함한 매매 플랜을 제시한다.
 *
 * ⚠️ 교육·참고용 계산 결과이며 투자 권유가 아니다.
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module === 'object' ? require('./indicators.js') : root.TA);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Signals = api;
})(typeof self !== 'undefined' ? self : this, function (TA) {
  'use strict';

  const last = (arr) => {
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && isFinite(arr[i])) return arr[i];
    return null;
  };
  const at = (arr, i) => (arr && arr[i] != null && isFinite(arr[i]) ? arr[i] : null);

  /**
   * 캔들 + 지표로부터 분석 묶음 생성. 차트/신호/정보패널이 공유하는 단일 소스.
   */
  function analyze(candles, cfg = {}) {
    const closes = candles.map((c) => c.c);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const vols = candles.map((c) => c.v || 0);

    const maConfig = cfg.maConfig || [
      { period: 5, type: 'ema' },
      { period: 20, type: 'sma' },
      { period: 60, type: 'sma' },
      { period: 120, type: 'sma' },
    ];
    const ma = maConfig.map((m) => (m.type === 'ema' ? TA.ema(closes, m.period) : TA.sma(closes, m.period)));

    const bbPeriod = cfg.bbPeriod || 20;
    const bbMult = cfg.bbMult || 2;
    const bb = TA.bollinger(closes, bbPeriod, bbMult);

    return {
      candles,
      closes, highs, lows, vols,
      maConfig,
      ma,
      bb,
      // 일봉은 봉 하나가 하루 전체라 VWAP이 대표가와 같아져 의미가 없다
      vwap: cfg.intraday === false ? null : TA.vwap(candles),
      rsi: TA.rsi(closes, cfg.rsiPeriod || 14),
      macd: TA.macd(closes, 12, 26, 9),
      stoch: TA.stochastic(highs, lows, closes, 14, 3, 3),
      atr: TA.atr(highs, lows, closes, 14),
      obv: TA.obv(candles),
      volMa: TA.sma(vols, 20),
      trend: TA.autoTrendlines(candles, cfg.pivotLeft || 3, cfg.pivotRight || 3),
      regression: TA.regressionLine(closes, cfg.regressionLookback || 60),
      srLevels: TA.supportResistance(candles),
      fib: TA.fibonacci(candles, cfg.fibLookback || 120),
      bbWidthRank: TA.percentileRank(bb.width, 120),
      volatility: TA.volatility(closes, 20, cfg.barsPerYear || 98280),
    };
  }

  /** 마지막 봉 기준 캔들 패턴 감지 */
  function candlePattern(candles) {
    const n = candles.length;
    if (n < 3) return null;
    const c = candles[n - 1];
    const p = candles[n - 2];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l || 1e-9;
    const upper = c.h - Math.max(c.o, c.c);
    const lower = Math.min(c.o, c.c) - c.l;

    if (body / range > 0.7 && c.c > c.o) return { name: '장대양봉', dir: 1, note: '몸통이 전체 범위의 70% 이상' };
    if (body / range > 0.7 && c.c < c.o) return { name: '장대음봉', dir: -1, note: '몸통이 전체 범위의 70% 이상' };
    if (lower > body * 2 && upper < body) return { name: '망치형', dir: 1, note: '아래꼬리가 길어 매수세 유입' };
    if (upper > body * 2 && lower < body) return { name: '유성형', dir: -1, note: '윗꼬리가 길어 매도세 출현' };
    if (c.c > c.o && p.c < p.o && c.c >= p.o && c.o <= p.c) return { name: '상승 장악형', dir: 1, note: '직전 음봉을 덮는 양봉' };
    if (c.c < c.o && p.c > p.o && c.c <= p.o && c.o >= p.c) return { name: '하락 장악형', dir: -1, note: '직전 양봉을 덮는 음봉' };
    if (body / range < 0.1) return { name: '도지', dir: 0, note: '매수·매도 균형, 방향 대기' };
    return null;
  }

  /**
   * 신호 산출.
   * @returns {{score:number, label:string, tone:string, reasons:Array, plan:object, stats:object}}
   */
  function evaluate(a) {
    const candles = a.candles;
    const n = candles.length;
    if (n < 30) {
      return { score: 0, label: '데이터 부족', tone: 'flat', reasons: [], plan: null, stats: {} };
    }
    const i = n - 1;
    const price = candles[i].c;
    const reasons = [];
    let score = 0;

    const add = (dir, weight, title, detail) => {
      score += dir * weight;
      reasons.push({ dir, weight, title, detail });
    };

    /* 1) 이동평균 배열 ------------------------------------------------- */
    const ma5 = at(a.ma[0], i);
    const ma20 = at(a.ma[1], i);
    const ma60 = at(a.ma[2], i);
    if (ma5 != null && ma20 != null) {
      const prev5 = at(a.ma[0], i - 1);
      const prev20 = at(a.ma[1], i - 1);
      if (ma60 != null && ma5 > ma20 && ma20 > ma60) {
        add(1, 18, '이동평균 정배열', `단기(${a.maConfig[0].period}) > 중기(${a.maConfig[1].period}) > 장기(${a.maConfig[2].period}) — 상승 추세`);
      } else if (ma60 != null && ma5 < ma20 && ma20 < ma60) {
        add(-1, 18, '이동평균 역배열', '단기 < 중기 < 장기 — 하락 추세');
      } else if (ma5 > ma20) {
        add(1, 8, '단기선 > 중기선', '단기 모멘텀 우위');
      } else {
        add(-1, 8, '단기선 < 중기선', '단기 모멘텀 열위');
      }
      if (prev5 != null && prev20 != null) {
        if (prev5 <= prev20 && ma5 > ma20) add(1, 14, '골든크로스 발생', '단기선이 중기선을 상향 돌파');
        if (prev5 >= prev20 && ma5 < ma20) add(-1, 14, '데드크로스 발생', '단기선이 중기선을 하향 이탈');
      }
    }

    /* 2) VWAP ---------------------------------------------------------- */
    const vwap = at(a.vwap, i);
    if (vwap != null) {
      const gap = ((price - vwap) / vwap) * 100;
      if (price > vwap) add(1, 12, 'VWAP 위', `당일 평단(${vwap.toFixed(2)}) 대비 +${gap.toFixed(2)}% — 매수 우위`);
      else add(-1, 12, 'VWAP 아래', `당일 평단(${vwap.toFixed(2)}) 대비 ${gap.toFixed(2)}% — 매도 우위`);
    }

    /* 3) 볼린저밴드 ----------------------------------------------------- */
    const pb = at(a.bb.percentB, i);
    const pbPrev = at(a.bb.percentB, i - 1);
    const width = at(a.bb.width, i);
    if (pb != null) {
      if (pb > 1) add(-1, 6, '상단 밴드 이탈', `%B ${pb.toFixed(2)} — 단기 과열, 눌림 주의`);
      else if (pb > 0.8) add(1, 10, '상단 밴드 근접', `%B ${pb.toFixed(2)} — 강세 구간`);
      else if (pb < 0) add(1, 6, '하단 밴드 이탈', `%B ${pb.toFixed(2)} — 과매도 반등 노림`);
      else if (pb < 0.2) add(-1, 10, '하단 밴드 근접', `%B ${pb.toFixed(2)} — 약세 구간`);
      if (pbPrev != null && pbPrev < 0 && pb >= 0) add(1, 12, '하단 밴드 회복', '밴드 밖에서 안으로 복귀 — 반등 신호');
      if (pbPrev != null && pbPrev > 1 && pb <= 1) add(-1, 12, '상단 밴드 회귀', '밴드 밖에서 안으로 복귀 — 조정 신호');
    }
    if (a.bbWidthRank != null) {
      if (a.bbWidthRank < 15) reasons.push({ dir: 0, weight: 0, title: '볼린저 스퀴즈', detail: `밴드폭 하위 ${a.bbWidthRank.toFixed(0)}% — 변동성 확장(방향 돌파) 임박 가능` });
      else if (a.bbWidthRank > 88) reasons.push({ dir: 0, weight: 0, title: '밴드 확장 국면', detail: `밴드폭 상위 ${(100 - a.bbWidthRank).toFixed(0)}% — 추세 진행 중, 추격 진입 주의` });
    }

    /* 4) RSI ------------------------------------------------------------ */
    const rsi = at(a.rsi, i);
    const rsiPrev = at(a.rsi, i - 1);
    if (rsi != null) {
      if (rsi >= 70) add(-1, 10, 'RSI 과매수', `RSI ${rsi.toFixed(1)} — 단기 차익 실현 구간`);
      else if (rsi <= 30) add(1, 10, 'RSI 과매도', `RSI ${rsi.toFixed(1)} — 기술적 반등 기대`);
      else if (rsi > 55) add(1, 6, 'RSI 강세', `RSI ${rsi.toFixed(1)}`);
      else if (rsi < 45) add(-1, 6, 'RSI 약세', `RSI ${rsi.toFixed(1)}`);
      if (rsiPrev != null && rsiPrev < 50 && rsi >= 50) add(1, 8, 'RSI 50 상향 돌파', '모멘텀 전환');
      if (rsiPrev != null && rsiPrev > 50 && rsi <= 50) add(-1, 8, 'RSI 50 하향 이탈', '모멘텀 둔화');
    }

    /* 5) MACD ----------------------------------------------------------- */
    const ml = at(a.macd.line, i);
    const ms = at(a.macd.signal, i);
    const mh = at(a.macd.hist, i);
    const mhPrev = at(a.macd.hist, i - 1);
    if (ml != null && ms != null) {
      if (mhPrev != null && mhPrev <= 0 && mh > 0) add(1, 14, 'MACD 골든크로스', '히스토그램이 0선을 상향 전환');
      else if (mhPrev != null && mhPrev >= 0 && mh < 0) add(-1, 14, 'MACD 데드크로스', '히스토그램이 0선을 하향 전환');
      else if (mh > 0) add(1, 7, 'MACD 양(+) 영역', `히스토그램 ${mh.toFixed(3)}`);
      else add(-1, 7, 'MACD 음(-) 영역', `히스토그램 ${mh != null ? mh.toFixed(3) : '-'}`);
    }

    /* 6) 스토캐스틱 ------------------------------------------------------ */
    const k = at(a.stoch.k, i);
    const d = at(a.stoch.d, i);
    const kPrev = at(a.stoch.k, i - 1);
    const dPrev = at(a.stoch.d, i - 1);
    if (k != null && d != null && kPrev != null && dPrev != null) {
      if (kPrev <= dPrev && k > d && k < 40) add(1, 10, '스토캐스틱 상향 교차', `과매도권(%K ${k.toFixed(1)})에서 반전`);
      if (kPrev >= dPrev && k < d && k > 60) add(-1, 10, '스토캐스틱 하향 교차', `과매수권(%K ${k.toFixed(1)})에서 반전`);
    }

    /* 7) 거래량 --------------------------------------------------------- */
    const vol = candles[i].v || 0;
    const volAvg = at(a.volMa, i);
    let volRatio = null;
    if (volAvg) {
      volRatio = vol / volAvg;
      const bullBar = candles[i].c >= candles[i].o;
      if (volRatio >= 2) add(bullBar ? 1 : -1, 14, '거래량 급증', `평균 대비 ${volRatio.toFixed(1)}배 — ${bullBar ? '매수' : '매도'} 에너지 유입`);
      else if (volRatio >= 1.3) add(bullBar ? 1 : -1, 7, '거래량 증가', `평균 대비 ${volRatio.toFixed(1)}배`);
      else if (volRatio < 0.6) reasons.push({ dir: 0, weight: 0, title: '거래량 부족', detail: `평균 대비 ${volRatio.toFixed(1)}배 — 단타 체결 불리, 관망 권장` });
    }

    /* 8) 추세선 돌파 ----------------------------------------------------- */
    const t = a.trend;
    if (t && t.resistance) {
      const lineNow = t.resistance.slope * i + t.resistance.intercept;
      const linePrev = t.resistance.slope * (i - 1) + t.resistance.intercept;
      if (candles[i - 1].c <= linePrev && price > lineNow) add(1, 16, '하락 추세선 상향 돌파', `저항 추세선 ${lineNow.toFixed(2)} 돌파`);
      else if (price < lineNow && (lineNow - price) / price < 0.004) add(0, 0, '저항 추세선 근접', `${lineNow.toFixed(2)} 부근 — 돌파 여부 확인`);
    }
    if (t && t.support) {
      const lineNow = t.support.slope * i + t.support.intercept;
      const linePrev = t.support.slope * (i - 1) + t.support.intercept;
      if (candles[i - 1].c >= linePrev && price < lineNow) add(-1, 16, '상승 추세선 하향 이탈', `지지 추세선 ${lineNow.toFixed(2)} 이탈`);
    }

    /* 9) 지지/저항 근접 --------------------------------------------------- */
    const nearest = nearestLevels(a.srLevels, price);
    if (nearest.support && (price - nearest.support.price) / price < 0.003) {
      add(1, 8, '지지선 근접', `${nearest.support.price.toFixed(2)} (터치 ${nearest.support.touches}회) — 반등 시 진입 유효`);
    }
    if (nearest.resistance && (nearest.resistance.price - price) / price < 0.003) {
      add(-1, 8, '저항선 근접', `${nearest.resistance.price.toFixed(2)} (터치 ${nearest.resistance.touches}회) — 돌파 확인 후 대응`);
    }

    /* 10) 캔들 패턴 ------------------------------------------------------ */
    const pat = candlePattern(candles);
    if (pat) {
      if (pat.dir === 0) reasons.push({ dir: 0, weight: 0, title: '캔들: ' + pat.name, detail: pat.note });
      else add(pat.dir, 9, '캔들: ' + pat.name, pat.note);
    }

    score = Math.max(-100, Math.min(100, Math.round(score)));

    let label = '관망';
    let tone = 'flat';
    if (score >= 45) { label = '적극 매수'; tone = 'strong-buy'; }
    else if (score >= 18) { label = '매수 우위'; tone = 'buy'; }
    else if (score <= -45) { label = '적극 매도'; tone = 'strong-sell'; }
    else if (score <= -18) { label = '매도 우위'; tone = 'sell'; }

    reasons.sort((x, y) => y.weight - x.weight);

    return {
      score,
      label,
      tone,
      reasons,
      plan: buildPlan(a, score),
      stats: {
        price,
        vwap,
        rsi,
        macdHist: mh,
        stochK: k,
        percentB: pb,
        bbWidth: width,
        bbWidthRank: a.bbWidthRank,
        atr: at(a.atr, i),
        atrPct: at(a.atr, i) != null ? (at(a.atr, i) / price) * 100 : null,
        volRatio,
        volatility: a.volatility,
        pattern: pat,
        nearest,
      },
    };
  }

  function nearestLevels(levels, price) {
    let support = null;
    let resistance = null;
    for (const l of levels || []) {
      if (l.price <= price && (!support || l.price > support.price)) support = l;
      if (l.price > price && (!resistance || l.price < resistance.price)) resistance = l;
    }
    return { support, resistance };
  }

  /**
   * ATR 기반 매매 플랜.
   * 손절 = 1.2 ATR, 1차 목표 = 1.5R, 2차 목표 = 2.5R (또는 근접 지지/저항으로 보정)
   */
  function buildPlan(a, score) {
    const i = a.candles.length - 1;
    const price = a.candles[i].c;
    const atr = at(a.atr, i);
    if (!atr) return null;
    const long = score >= 0;
    const stopDist = atr * 1.2;
    const entry = price;
    const stop = long ? entry - stopDist : entry + stopDist;
    const near = nearestLevels(a.srLevels, price);

    let target1 = long ? entry + stopDist * 1.5 : entry - stopDist * 1.5;
    const target2 = long ? entry + stopDist * 2.5 : entry - stopDist * 2.5;
    // 근접 지지/저항이 1차 목표보다 가까우면 그 레벨을 우선 목표로 삼는다
    if (long && near.resistance && near.resistance.price > entry && near.resistance.price < target1) {
      target1 = near.resistance.price;
    }
    if (!long && near.support && near.support.price < entry && near.support.price > target1) {
      target1 = near.support.price;
    }
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target1 - entry);
    return {
      side: long ? 'LONG' : 'SHORT',
      entry,
      stop,
      target1,
      target2,
      riskPerShare: risk,
      rewardPerShare: reward,
      rr: risk ? reward / risk : null,
      atr,
      stopPct: (risk / entry) * 100,
    };
  }

  /**
   * 계좌 규모·허용 리스크(%)로 수량 산출.
   * 리스크 기준 수량이 매수 여력(계좌/주가)을 넘으면 여력까지만 잡고 capped=true 로 알린다.
   */
  function positionSize(accountUSD, riskPct, riskPerShare, entryPrice) {
    if (!accountUSD || !riskPct || !riskPerShare) return null;
    const riskAmount = (accountUSD * riskPct) / 100;
    const byRisk = Math.floor(riskAmount / riskPerShare);
    const byCash = entryPrice ? Math.floor(accountUSD / entryPrice) : byRisk;
    const shares = Math.max(0, Math.min(byRisk, byCash));
    return {
      riskAmount,
      shares,
      sharesByRisk: Math.max(0, byRisk),
      capped: byRisk > byCash,
      notional: entryPrice ? shares * entryPrice : 0,
      maxLoss: shares * riskPerShare,
    };
  }

  return { analyze, evaluate, buildPlan, positionSize, candlePattern, nearestLevels };
});
