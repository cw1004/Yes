'use strict';
/** 의존성 없는 간단 테스트 러너:  node test/indicators.test.js  */
const assert = require('assert');
const TA = require('../public/js/indicators.js');
const mock = require('../server/providers/mock.js');

let passed = 0;
const cases = [];
function test(name, fn) { cases.push([name, fn]); }
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('SMA: 워밍업 구간은 null, 이후 산술평균', () => {
  const r = TA.sma(seq, 3);
  assert.strictEqual(r[0], null);
  assert.strictEqual(r[1], null);
  close(r[2], 2);
  close(r[9], 9);
  assert.strictEqual(r.length, seq.length);
});

test('EMA: 첫 값은 SMA 시드, 이후 지수 가중', () => {
  const r = TA.ema(seq, 3);
  assert.strictEqual(r[1], null);
  close(r[2], 2);
  close(r[3], 3);
});

test('볼린저밴드: 중심선/표준편차/%B', () => {
  const bb = TA.bollinger(seq, 5, 2);
  close(bb.mid[9], 8);
  close(bb.upper[9], 8 + 2 * Math.sqrt(2));
  close(bb.lower[9], 8 - 2 * Math.sqrt(2));
  close(bb.percentB[9], (10 - bb.lower[9]) / (bb.upper[9] - bb.lower[9]));
  assert.ok(bb.percentB[9] > 0.8 && bb.percentB[9] <= 1.0);
});

test('RSI: 상승만 있으면 100, 하락만 있으면 0', () => {
  close(TA.rsi(seq, 3).at(-1), 100);
  close(TA.rsi([...seq].reverse(), 3).at(-1), 0);
});

test('MACD: line/signal/hist 길이 및 hist = line - signal', () => {
  const closes = mock.generate('TEST', '5m', '1d').candles.map((c) => c.c);
  const m = TA.macd(closes);
  assert.strictEqual(m.line.length, closes.length);
  const i = closes.length - 1;
  close(m.hist[i], m.line[i] - m.signal[i], 1e-9);
});

test('ATR: 양수이며 워밍업 이후 값 존재', () => {
  const c = mock.generate('ATRX', '5m', '1d').candles;
  const a = TA.atr(c.map((x) => x.h), c.map((x) => x.l), c.map((x) => x.c), 14);
  assert.ok(a.at(-1) > 0);
  assert.strictEqual(a[0], null);
});

test('VWAP: 거래량 가중 평균이 당일 가격 범위 안에 위치', () => {
  const c = mock.generate('VWPX', '5m', '1d').candles;
  const v = TA.vwap(c);
  const lo = Math.min(...c.map((x) => x.l));
  const hi = Math.max(...c.map((x) => x.h));
  assert.ok(v.at(-1) >= lo && v.at(-1) <= hi);
});

test('피봇/추세선: 스윙 탐지와 직선 방정식', () => {
  const c = mock.generate('PIVX', '5m', '5d').candles;
  const t = TA.autoTrendlines(c);
  assert.ok(t.highs.length > 0 && t.lows.length > 0);
  const line = TA.lineThrough({ i: 0, price: 10 }, { i: 10, price: 20 });
  close(line.slope, 1);
  close(line.intercept, 10);
});

test('지지/저항: 레벨은 가격 오름차순, 터치 수 1 이상', () => {
  const c = mock.generate('SRX', '5m', '5d').candles;
  const levels = TA.supportResistance(c);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i].price >= levels[i - 1].price);
  levels.forEach((l) => assert.ok(l.touches >= 1));
});

test('피보나치: 0%/100% 레벨이 구간 고·저와 일치', () => {
  const c = mock.generate('FIBX', '5m', '5d').candles;
  const f = TA.fibonacci(c, 120);
  const prices = f.levels.map((l) => l.price);
  assert.ok(Math.max(...prices) <= f.high + 1e-6);
  assert.ok(Math.min(...prices) >= f.low - 1e-6);
});

test('지지/저항: 현재가에서 먼 레벨은 제외', () => {
  const c = mock.generate('NEARX', '5m', '5d').candles;
  const price = c[c.length - 1].c;
  TA.supportResistance(c, 0.35, 5, 3).forEach((l) => {
    assert.ok((Math.abs(l.price - price) / price) * 100 <= 3 + 1e-9);
  });
});

test('포지션 계산: 매수 여력을 넘지 않도록 수량 제한', () => {
  const S = require('../public/js/signals.js');
  const capped = S.positionSize(10000, 1, 0.68, 266);
  assert.ok(capped.capped, '여력 제한 플래그');
  assert.ok(capped.notional <= 10000, '투입금액 <= 계좌');
  assert.strictEqual(capped.shares, Math.floor(10000 / 266));

  const byRisk = S.positionSize(100000, 1, 5, 266);
  assert.strictEqual(byRisk.capped, false);
  assert.strictEqual(byRisk.shares, 200);          // 1000달러 리스크 / 5달러
  close(byRisk.maxLoss, 1000, 1e-6);
});

test('신호 엔진: 점수 범위와 플랜 정합성', () => {
  const S = require('../public/js/signals.js');
  for (const sym of ['AAPL', 'TSLA', 'NVDA', 'SPY']) {
    const a = S.analyze(mock.generate(sym, '5m', '5d').candles);
    const e = S.evaluate(a);
    assert.ok(e.score >= -100 && e.score <= 100, '점수 범위');
    assert.ok(['적극 매수', '매수 우위', '관망', '매도 우위', '적극 매도'].includes(e.label));
    const p = e.plan;
    assert.ok(p && p.rr > 0);
    if (p.side === 'LONG') {
      assert.ok(p.stop < p.entry && p.target1 > p.entry, '롱: 손절<진입<목표');
    } else {
      assert.ok(p.stop > p.entry && p.target1 < p.entry, '숏: 목표<진입<손절');
    }
  }
});

test('mock 프로바이더: 캔들 정합성(h >= max(o,c), l <= min(o,c))', () => {
  const c = mock.generate('SANE', '5m', '1d').candles;
  assert.ok(c.length > 50);
  c.forEach((x) => {
    assert.ok(x.h >= Math.max(x.o, x.c) - 1e-9);
    assert.ok(x.l <= Math.min(x.o, x.c) + 1e-9);
    assert.ok(x.v >= 0);
  });
  for (let i = 1; i < c.length; i++) assert.ok(c[i].t > c[i - 1].t, '시간 오름차순');
});

test('mock 프로바이더: 기간·주기가 달라도 같은 시각 가격이 일치', () => {
  const a = mock.generate('CONS', '5m', '1d');
  const b = mock.generate('CONS', '5m', '5d');
  close(a.meta.price, b.meta.price, 1e-9);
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name + '\n    ' + err.message);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${cases.length} 통과`);
