'use strict';
/** 과거 장 재생 연습 테스트:  node test/replay.test.js */

const assert = require('assert');
const C = require('../server/kr/config.js');
const replay = require('../server/replay.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

function bars(n, start = 50000, step = 50) {
  const t0 = Date.UTC(2026, 7, 25, 0, 0, 0);
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = o + (i % 3 === 0 ? step : -step / 2);
    out.push({ t: t0 + i * 60000, o, h: Math.max(o, p) + step, l: Math.min(o, p) - step, c: p, v: 1000 });
  }
  return out;
}

const fresh = (n = 300, cash = 10000000) =>
  replay.start({ code: '005930', name: '삼성전자', market: 'KOSPI', bars: bars(n), cash });

/* ------------------------------------------------- 미래를 숨기는 것 (핵심) */

test('미래 차단: 시작할 때 준비 봉까지만 내보낸다', () => {
  const s = fresh(300);
  assert.strictEqual(s.visible.length, replay.PRIME_BARS);
  assert.strictEqual(s.totalBars, 300);
  assert.strictEqual(s.remaining, 300 - replay.PRIME_BARS);
  // 응답 어디에도 전체 봉이 들어 있으면 안 된다
  const json = JSON.stringify(s);
  assert.ok(json.length < 20000, '응답이 전체 봉을 담을 만큼 크면 안 된다: ' + json.length);
});

test('미래 차단: 진행한 만큼만 새 봉이 열린다', () => {
  const s = fresh(300);
  const r = replay.step(s.id, 5);
  assert.strictEqual(r.revealed.length, 5);
  assert.strictEqual(r.cursor, replay.PRIME_BARS - 1 + 5);
  // 열린 봉은 원본과 같은 순서여야 한다
  const src = bars(300);
  assert.strictEqual(r.revealed[0].t, src[replay.PRIME_BARS].t);
});

test('미래 차단: 끝까지 가면 atEnd 로 알려 주고 더 열리지 않는다', () => {
  const s = fresh(120);
  let r = replay.step(s.id, 200);
  assert.strictEqual(r.atEnd, true);
  assert.strictEqual(r.remaining, 0);
  const again = replay.step(s.id, 10);
  assert.strictEqual(again.revealed.length, 0, '더 열릴 봉이 없다');
});

/* ------------------------------------------------------------ 체결 규칙 */

test('체결: 지금 보는 봉이 아니라 다음 봉 시가에 체결된다', () => {
  const s = fresh(300);
  const src = bars(300);
  const nextBar = src[replay.PRIME_BARS];       // 커서 다음 봉
  const r = replay.order(s.id, { side: 'buy', qty: 10 });
  const tick = C.tickSize(nextBar.o, 'KOSPI');
  assert.strictEqual(r.fill, C.alignPrice(nextBar.o + tick, 'KOSPI', 'up'), '다음 봉 시가 + 1호가');
});

test('체결: 매수는 위로, 매도는 아래로 밀린다 (슬리피지)', () => {
  const s = fresh(300);
  const src = bars(300);
  const buy = replay.order(s.id, { side: 'buy', qty: 10 });
  assert.ok(buy.fill > src[replay.PRIME_BARS].o, '매수는 불리하게 위로');
  replay.step(s.id, 1);
  const sell = replay.order(s.id, { side: 'sell', qty: 10 });
  const bar = src[replay.PRIME_BARS + 2];
  assert.ok(sell.fill < bar.o, '매도는 불리하게 아래로');
});

test('체결: 순손익은 실제 결제(수수료·거래세 절사)와 같다', () => {
  const s = fresh(300);
  const buy = replay.order(s.id, { side: 'buy', qty: 100 });
  replay.step(s.id, 3);
  const sell = replay.order(s.id, { side: 'sell', qty: 100 });
  const bill = C.settlement({ buyPrice: buy.fill, qty: 100, sellPrice: sell.fill });
  assert.strictEqual(sell.trade.net, bill.netProfit);
  assert.ok(sell.trade.cost > 0);
});

test('체결: 현금보다 많이 살 수 없다', () => {
  const s = fresh(300, 1000000);   // 100만원
  assert.throws(() => replay.order(s.id, { side: 'buy', qty: 1000 }), /현금이 부족/);
});

test('체결: 없는 주식을 팔 수 없고, 두 번 살 수 없다', () => {
  const s = fresh(300);
  assert.throws(() => replay.order(s.id, { side: 'sell', qty: 10 }), /보유한 주식이 없/);
  replay.order(s.id, { side: 'buy', qty: 10 });
  assert.throws(() => replay.order(s.id, { side: 'buy', qty: 10 }), /이미 보유 중/);
});

/* -------------------------------------------------------------- 계좌 */

test('계좌: 매수하면 현금이 줄고 평가자산은 비용만큼만 준다', () => {
  const s = fresh(300);
  const before = s.account;
  const r = replay.order(s.id, { side: 'buy', qty: 100 });
  const a = r.account;
  assert.ok(a.cash < before.cash, '현금이 줄었다');
  assert.ok(a.position && a.position.qty === 100);
  assert.ok(a.position.breakeven && a.position.breakeven.price > a.position.entry, '본전가는 진입가 위');
});

test('계좌: 보유 평가손익은 지금 팔면 남는 돈(세후)이다', () => {
  const s = fresh(300);
  const buy = replay.order(s.id, { side: 'buy', qty: 100 });
  const st = replay.step(s.id, 1);
  const a = st.account;
  const expect = C.settlement({ buyPrice: buy.fill, qty: 100, sellPrice: a.price }).netProfit;
  assert.strictEqual(a.position.unrealized, Math.round(expect));
});

/* -------------------------------------------------------------- 채점 */

test('채점: 그냥 들고 있었을 때와 비교한다', () => {
  const s = fresh(300);
  replay.order(s.id, { side: 'buy', qty: 100 });
  replay.step(s.id, 20);
  replay.order(s.id, { side: 'sell', qty: 100 });
  replay.step(s.id, 50);
  const sc = replay.score(s.id);
  assert.strictEqual(sc.trades, 1);
  assert.ok(sc.buyAndHold.qty > 0, '비교 대상이 계산된다');
  assert.strictEqual(typeof sc.beatHold, 'boolean');
  assert.ok(sc.verdict.length > 0);
  assert.strictEqual(sc.tradeList.length, 1);
});

test('채점: 한 번도 거래하지 않았으면 그렇게 말한다', () => {
  const s = fresh(300);
  replay.step(s.id, 50);
  const sc = replay.score(s.id);
  assert.strictEqual(sc.trades, 0);
  assert.match(sc.verdict, /거래를 한 번도/);
});

test('채점: 잦은 거래로 비용이 수익을 먹으면 그 사실을 말한다', () => {
  const s = fresh(300);
  for (let i = 0; i < 5; i++) {
    replay.order(s.id, { side: 'buy', qty: 100 });
    replay.step(s.id, 1);
    replay.order(s.id, { side: 'sell', qty: 100 });
    replay.step(s.id, 1);
  }
  const sc = replay.score(s.id);
  assert.strictEqual(sc.trades, 5);
  assert.ok(sc.totalCost > 0);
  assert.ok(sc.costVsGross != null, '비용 비중이 계산된다');
});

/* -------------------------------------------------------------- 수명 */

test('세션: 없는 세션을 부르면 명확히 알려 준다', () => {
  assert.throws(() => replay.step('rp_nope', 1), /찾을 수 없습니다/);
});

test('세션: 끝내면 지워진다', () => {
  const s = fresh(300);
  replay.end(s.id);
  assert.throws(() => replay.step(s.id, 1), /찾을 수 없습니다/);
});

test('세션: 진행할 봉이 모자라면 시작하지 않는다', () => {
  // 30봉이면 준비 봉을 빼고 남는 게 거의 없어 연습이 되지 않는다
  assert.throws(() => replay.start({ code: '005930', bars: bars(30) }), /봉이 부족/);
  // 준비 봉은 데이터가 적으면 함께 줄어든다. 60봉이면 준비 20 + 진행 40 이라 여전히 부족하다
  assert.throws(() => replay.start({ code: '005930', bars: bars(60) }),
    new RegExp(`최소 ${replay.MIN_PLAYABLE}개`));
  // 90봉이면 준비 30 + 진행 60 이라 딱 통과한다
  const okSession = replay.start({ code: '005930', bars: bars(90) });
  assert.strictEqual(okSession.remaining, replay.MIN_PLAYABLE);
  replay.end(okSession.id);
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
