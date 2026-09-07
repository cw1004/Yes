'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/scenery.js');

// Canvas 2D 스텁 — 호출만 기록한다.
function fakeCtx() {
  const calls = { fill: 0, stroke: 0, rect: 0, gradients: 0, arcs: 0, ellipses: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    createLinearGradient() { calls.gradients++; return grad; },
    createRadialGradient() { calls.gradients++; return grad; },
    fillRect() { calls.rect++; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { calls.fill++; }, stroke() { calls.stroke++; },
    arc() { calls.arcs++; }, ellipse() { calls.ellipses++; }
  };
}

test('레이어는 하늘 → 산 → 강 → 잔디 순서로 배치된다', () => {
  const sc = S.create(42);
  sc.resize(420, 820, 738);
  const L = sc.layout();
  assert.ok(L.horizon < L.riverTop, '능선 기준선이 강보다 위');
  assert.ok(L.riverTop < L.riverBottom, '강에 두께가 있다');
  assert.ok(L.riverBottom < 738, '강이 잔디 위에 있다');
  assert.ok(L.far.length > 5 && L.near.length > 5 && L.forest.length > 5);
});

test('능선은 좌우로 이어 붙여도 끊기지 않는다', () => {
  const sc = S.create(7);
  sc.resize(420, 820, 738);
  const L = sc.layout();
  for (const key of ['far', 'near', 'forest']) {
    const pts = L[key];
    assert.strictEqual(pts[0].y, pts[pts.length - 1].y, key + ' 시작/끝 높이가 같아야 반복 시 이음매가 없다');
    assert.strictEqual(pts[0].x, 0);
    assert.strictEqual(pts[pts.length - 1].x, L.span);
  }
});

test('같은 시드는 같은 지형을 만든다', () => {
  const a = S.create(2030); a.resize(420, 820, 738);
  const b = S.create(2030); b.resize(420, 820, 738);
  assert.deepStrictEqual(a.layout().far, b.layout().far);
  const c = S.create(9999); c.resize(420, 820, 738);
  assert.notDeepStrictEqual(a.layout().far, c.layout().far);
});

test('리사이즈해도 지형 모양은 유지된다', () => {
  const sc = S.create(2030);
  sc.resize(420, 820, 738);
  const before = sc.layout().far.map((p) => Math.round(p.y));
  sc.resize(420, 820, 738);
  assert.deepStrictEqual(sc.layout().far.map((p) => Math.round(p.y)), before);
});

test('모든 스테이지가 팔레트를 가지고 렌더 호출을 낸다', () => {
  const sc = S.create(1);
  sc.resize(420, 820, 738);
  const keys = ['DAY', 'SUNSET', 'NIGHT', 'RAIN', 'WIND', 'STORM', 'WORLD_FINAL'];
  for (const key of keys) {
    const p = sc.paletteFor(key);
    assert.ok(Array.isArray(p.sky) && p.sky.length === 2, key + ' 하늘 그라디언트');
    assert.ok(p.far && p.near && p.river && p.forest, key + ' 지형 색');
    const ctx = fakeCtx();
    sc.draw(ctx, { stage: key, scroll: 1234, time: 3.5, flash: key === 'STORM' ? 1 : 0 });
    assert.ok(ctx.calls.fill > 0 && ctx.calls.rect > 0, key + ' 렌더 호출');
  }
  // 알 수 없는 스테이지도 기본 팔레트로 안전하게 그린다
  const ctx = fakeCtx();
  sc.draw(ctx, { stage: 'UNKNOWN', scroll: 0, time: 0, flash: 0 });
  assert.ok(ctx.calls.fill > 0);
});

test('resize 전에 draw 를 불러도 죽지 않는다', () => {
  const sc = S.create(5);
  const ctx = fakeCtx();
  sc.draw(ctx, { stage: 'DAY', scroll: 0, time: 0, flash: 0 });
  assert.strictEqual(ctx.calls.fill, 0);
});
