'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/sponsor.js');

// Canvas 2D 스텁
function fakeCtx() {
  const calls = { text: [], fills: 0, rects: 0, rotate: 0, clip: 0 };
  return {
    calls,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, translate() {}, rotate() { calls.rotate++; },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    rect() {}, clip() { calls.clip++; },
    fill() { calls.fills++; }, stroke() {},
    fillRect() { calls.rects++; },
    fillText(t) { calls.text.push(String(t)); }
  };
}

test('광고판 목록이 유효하다', () => {
  assert.ok(S.BOARDS.length >= 3);
  const ids = new Set();
  for (const b of S.BOARDS) {
    assert.ok(b.id && !ids.has(b.id), 'id 중복: ' + b.id);
    ids.add(b.id);
    assert.ok(['house', 'sponsor'].includes(b.kind), b.id + ' kind');
    assert.ok(b.text && b.text.length <= 26, b.id + ' 문구가 너무 길다');
    assert.ok(/^#[0-9a-f]{6}$/i.test(b.bg) && /^#[0-9a-f]{6}$/i.test(b.fg), b.id + ' 색상');
    assert.ok(/^#[0-9a-f]{6}$/i.test(b.accent));
  }
  assert.ok(S.BOARDS.some((b) => b.kind === 'sponsor'), '판매용 지면이 최소 하나는 있어야 한다');
});

test('탭 조작과 충돌하지 않도록 광고는 클릭 불가여야 한다', () => {
  // 이 값을 true 로 바꾸면 원버튼 조작과 충돌한다. 바꾸려면 반드시 재설계할 것.
  assert.strictEqual(S.CLICKABLE, false);
});

test('보드는 순서대로 순환한다', () => {
  const n = S.count();
  assert.strictEqual(S.pick(0).id, S.BOARDS[0].id);
  assert.strictEqual(S.pick(n).id, S.BOARDS[0].id);
  assert.strictEqual(S.pick(n + 1).id, S.BOARDS[1].id);
  assert.strictEqual(S.pick(-1).id, S.BOARDS[1].id, '음수도 안전하게 처리');
  assert.strictEqual(S.pick(2.7).id, S.BOARDS[2].id);
  assert.ok(S.pick(undefined));
});

test('한글 판별', () => {
  assert.strictEqual(S.hasHangul('새 공 만나기'), true);
  assert.strictEqual(S.hasHangul('INDIA 2030'), false);
  assert.strictEqual(S.hasHangul('हर सपना'), false);
  assert.strictEqual(S.hasHangul(''), false);
  assert.strictEqual(S.hasHangul(null), false);
});

test('기둥 배너는 자리가 좁으면 그리지 않는다', () => {
  const ctx = fakeCtx();
  assert.strictEqual(S.drawPostBanner(ctx, S.pick(0), 0, 0, 42, 40), false, '짧으면 생략');
  assert.strictEqual(ctx.calls.fills, 0);
  assert.strictEqual(S.drawPostBanner(ctx, null, 0, 0, 42, 200), false);
  assert.strictEqual(S.drawPostBanner(ctx, S.pick(0), 0, 0, 42, 150), true);
  assert.ok(ctx.calls.fills > 0 && ctx.calls.text.length > 0);
});

test('한글 배너는 눕히지 않고 세로로 쌓는다', () => {
  const korean = S.BOARDS.find((b) => S.hasHangul(b.text));
  assert.ok(korean, '한글 보드가 하나는 있어야 이 검사가 의미 있다');
  const ctx = fakeCtx();
  S.drawPostBanner(ctx, korean, 0, 0, 42, 150);
  const chars = korean.text.replace(/\s+/g, '').length;
  const drawn = ctx.calls.text.filter((t) => t.length === 1).length;
  assert.strictEqual(drawn, chars, '글자를 한 자씩 그린다');

  const latin = S.BOARDS.find((b) => !S.hasHangul(b.text));
  const ctx2 = fakeCtx();
  S.drawPostBanner(ctx2, latin, 0, 0, 42, 150);
  assert.ok(ctx2.calls.rotate > 0, '영문은 눕혀서 한 번에 그린다');
  assert.ok(ctx2.calls.text.includes(latin.text));
});

test('그라운드 보드는 화면을 채우도록 반복된다', () => {
  const ctx = fakeCtx();
  S.drawPerimeter(ctx, 0, 100, 420, 18, 0, 1);
  assert.ok(ctx.calls.clip > 0, '영역 밖으로 새지 않게 클립한다');
  assert.ok(ctx.calls.text.length >= 2, '패널이 여러 개 그려진다: ' + ctx.calls.text.length);
  const shifted = fakeCtx();
  S.drawPerimeter(shifted, 0, 100, 420, 18, 5000, 1);
  assert.ok(shifted.calls.text.length >= 2, '오프셋이 커도 정상 동작');
});
