'use strict';
/** 백테스트·수익구간 탐색 테스트:  node test/backtest.test.js */

const assert = require('assert');
const C = require('../server/kr/config.js');
const backtest = require('../server/backtest.js');
const optimize = require('../server/optimize.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

/* --------------------------------------------------------- 데이터 생성기 */

/** 재현 가능한 난수 (테스트가 실행마다 달라지면 안 된다) */
function rng(seed = 12345) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** drift 만큼 꾸준히 움직이는 봉 생성 */
function series(n, drift, noise, opts = {}) {
  const rand = opts.rand || rng();
  const out = [];
  let p = opts.start || 50000;
  const t0 = Date.UTC(2026, 7, 25, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const o = p;
    p = C.alignPrice(p * (1 + drift + (rand() - 0.5) * noise), 'KOSPI', 'near');
    out.push({
      t: t0 + i * 60000, o,
      h: C.alignPrice(Math.max(o, p) * (1 + rand() * noise * 0.4), 'KOSPI', 'up'),
      l: C.alignPrice(Math.min(o, p) * (1 - rand() * noise * 0.4), 'KOSPI', 'down'),
      c: p, v: 10000,
    });
  }
  return out;
}

/* ------------------------------------------------------------ 정직성 규칙 */

test('규칙: 신호를 계산할 때 미래 봉을 보지 않는다', () => {
  const bars = series(200, 0.0005, 0.004);
  const at100 = backtest.signalAt(bars, 100, backtest.DEFAULTS);
  // 101번째 이후를 완전히 바꿔도 100번째 신호는 같아야 한다
  const tampered = bars.slice();
  for (let i = 101; i < tampered.length; i++) {
    tampered[i] = { ...tampered[i], o: 99999, h: 99999, l: 99999, c: 99999 };
  }
  const after = backtest.signalAt(tampered, 100, backtest.DEFAULTS);
  assert.strictEqual(at100.score, after.score, '미래를 바꿔도 과거 신호는 그대로여야 한다');
});

test('규칙: 진입은 신호가 난 봉이 아니라 다음 봉 시가에 이뤄진다', () => {
  const bars = series(200, 0.001, 0.003);
  const r = backtest.run(bars, { qty: 10, entryScore: 30 });
  assert.ok(r.trades.length > 0, '검증할 거래가 있어야 한다');
  for (const t of r.trades) {
    const idx = bars.findIndex((b) => b.t === t.entryT);
    assert.ok(idx > 0, '진입 시각이 봉에 존재한다');
    // 진입가는 그 봉의 시가에서 슬리피지만큼 위 (한 봉 안의 종가가 아니다)
    assert.ok(t.entry >= bars[idx].o, '시가 이상 (매수는 위로 밀린다)');
  }
});

test('규칙: 한 봉에서 손절·목표가 모두 닿으면 손절로 친다 (최악 가정)', () => {
  // 진입 직후 위아래로 크게 흔드는 봉을 만든다
  const t0 = Date.UTC(2026, 7, 25, 0, 0, 0);
  const bars = [];
  for (let i = 0; i < 60; i++) {
    bars.push({ t: t0 + i * 60000, o: 50000, h: 50100, l: 49900, c: 50000, v: 1000 });
  }
  // 워밍업 이후 강한 신호를 만들 수 없으므로, 청산 로직만 직접 확인한다
  const wide = { t: t0, o: 50000, h: 52000, l: 48000, c: 50000, v: 1000 };
  const stop = 49500, target = 50750;
  assert.ok(wide.l <= stop && wide.h >= target, '한 봉에서 둘 다 닿는 상황');
  // 엔진의 판단 순서가 손절 우선인지 소스로 확인한다
  const src = require('fs').readFileSync(require.resolve('../server/backtest.js'), 'utf8');
  const stopIdx = src.indexOf("reason = '손절'");
  const targetIdx = src.indexOf("reason = '목표'");
  assert.ok(stopIdx > 0 && targetIdx > stopIdx, '손절 분기가 목표보다 먼저 온다');
});

test('규칙: 슬리피지는 매수는 위로, 매도는 아래로 민다', () => {
  const cfg = Object.assign({}, backtest.DEFAULTS, { market: 'KOSPI', slippageTicks: 1 });
  const buy = backtest.slipped(50000, cfg, 'buy');
  const sell = backtest.slipped(50000, cfg, 'sell');
  assert.ok(buy > 50000, '매수는 불리하게 위로');
  assert.ok(sell < 50000, '매도는 불리하게 아래로');
  assert.strictEqual(buy - 50000, C.tickSize(50000, 'KOSPI'));
});

test('규칙: 손익은 실제 결제 기준(수수료·거래세 절사 포함)으로 계산된다', () => {
  const bars = series(300, 0.001, 0.003);
  // 이 합성 데이터의 신호 상한이 44점이라 기본 임계값(45)으로는 거래가 안 난다
  const r = backtest.run(bars, { qty: 100, entryScore: 30 });
  assert.ok(r.trades.length > 0, '거래가 나와야 검증할 수 있다');
  for (const t of r.trades) {
    const bill = C.settlement({ buyPrice: t.entry, qty: t.qty, sellPrice: t.exit });
    assert.strictEqual(t.net, bill.netProfit, '순손익이 결제 계산과 일치');
    assert.ok(t.cost > 0, '비용이 0이 아니다');
    assert.ok(t.net < t.gross, '순손익은 항상 총손익보다 작다');
  }
});

/* -------------------------------------------------------------- 통계 */

test('통계: 거래가 없으면 그렇게 말한다', () => {
  const flat = Array.from({ length: 200 }, (_, i) => ({
    t: i * 60000, o: 50000, h: 50000, l: 50000, c: 50000, v: 0,
  }));
  const r = backtest.run(flat, { entryScore: 95 });
  assert.strictEqual(r.stats.trades, 0);
  assert.strictEqual(r.stats.reliable, false);
  assert.match(r.stats.note, /거래가 한 건도/);
});

test('통계: 봉이 모자라면 계산하지 않고 사유를 남긴다', () => {
  const r = backtest.run(series(10, 0, 0.003), {});
  assert.strictEqual(r.stats.trades, 0);
  assert.match(r.stats.note, /봉이 부족/);
});

test('통계: 표본이 30건 미만이면 신뢰하지 않는다고 표시한다', () => {
  const r = backtest.run(series(300, 0.001, 0.003), { qty: 10, entryScore: 30 });
  assert.ok(r.stats.trades > 0 && r.stats.trades < 30, '표본이 적은 상황: ' + r.stats.trades);
  assert.strictEqual(r.stats.reliable, false);
  assert.match(r.stats.note, /우연일 가능성/);
});

test('통계: 최대 낙폭은 자산 고점 대비 하락폭이다', () => {
  const r = backtest.run(series(400, -0.001, 0.004), { qty: 100 });
  assert.ok(r.stats.maxDrawdown >= 0);
  if (r.stats.netProfit < 0) assert.ok(r.stats.maxDrawdown > 0, '손실이 났으면 낙폭이 있다');
});

/* ------------------------------------------------ 수익 구간 탐색 (핵심) */

test('탐색: 진짜 추세가 있으면 수익 구간을 찾아낸다', () => {
  const bars = series(500, 0.0008, 0.004, { rand: rng(12345) });
  const r = optimize.sweep(bars, { base: { qty: 100, market: 'KOSPI' }, grid: { entryScore: [25, 30, 35] } });
  assert.ok(r.survivors > 0, '먹을 게 있으면 찾아야 한다: ' + r.survivors);
  assert.strictEqual(r.verdict.level, 'ok');
  assert.ok(r.best.train.expectancy > 0 && r.best.test.expectancy > 0);
  const env = optimize.envelope(r);
  assert.ok(env.length > 0, '수익 구간 경계가 나온다');
  for (const e of env) assert.ok(e.minTarget <= e.maxTarget);
});

test('탐색: 랜덤워크에서는 어떤 조합도 살아남지 못한다', () => {
  // 비용을 물면서 무작위로 사고팔면 반드시 잃는다. 엔진이 이걸 "없다"고 말해야 한다.
  const bars = series(500, 0, 0.004, { rand: rng(999) });
  const r = optimize.sweep(bars, { base: { qty: 100, market: 'KOSPI' }, grid: { entryScore: [25, 30, 35] } });
  assert.strictEqual(r.survivors, 0, '없는 엣지를 만들어 내면 안 된다');
  assert.strictEqual(r.verdict.level, 'none');
  assert.deepStrictEqual(optimize.envelope(r), []);
});

test('탐색: 학습에서만 좋고 검증에서 무너지면 생존으로 치지 않는다', () => {
  const bars = series(500, 0.0008, 0.004, { rand: rng(12345) });
  const r = optimize.sweep(bars, { base: { qty: 100, market: 'KOSPI' }, grid: { entryScore: [25, 30, 35] } });
  for (const c of r.cells) {
    if (c.survives) {
      assert.ok(c.train.expectancy > 0, '학습 기대값 양수');
      assert.ok(c.test && c.test.expectancy > 0, '검증 기대값도 양수여야 생존');
    }
  }
});

test('탐색: 거래가 너무 적은 조합은 순위에서 뺀다', () => {
  const bars = series(500, 0.0008, 0.004, { rand: rng(12345) });
  const r = optimize.sweep(bars, { base: { qty: 100, market: 'KOSPI' }, grid: { entryScore: [25, 30, 35] }, minTrades: 15 });
  for (const c of r.ranked) assert.ok(c.train.trades >= 15, '순위에는 표본이 찬 것만');
});

test('탐색: 학습/검증을 나눌 만큼 데이터가 없으면 신뢰하지 말라고 한다', () => {
  const r = optimize.sweep(series(60, 0.001, 0.003), { base: { qty: 10 }, grid: { entryScore: [30] } });
  assert.strictEqual(r.split, null);
  assert.strictEqual(r.verdict.level, 'insufficient');
});

test('탐색: 신호를 한 번만 계산해도 결과가 같다 (캐시 최적화 검증)', () => {
  const bars = series(300, 0.0008, 0.004, { rand: rng(777) });
  const cfg = { qty: 100, market: 'KOSPI', stopPct: 1, targetPct: 1.5, entryScore: 30 };
  const slow = backtest.run(bars, cfg);
  const signals = backtest.signalSeries(bars, cfg);
  const fast = backtest.run(bars, Object.assign({}, cfg, { signals }));
  assert.strictEqual(slow.trades.length, fast.trades.length);
  assert.deepStrictEqual(slow.stats, fast.stats, '캐시를 써도 결과가 같아야 한다');
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
