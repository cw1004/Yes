'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/sponsor.js');

// Canvas 2D 스텁
function fakeCtx() {
  const calls = { text: [], fills: 0, rects: 0, rotate: 0, clip: 0, arcs: 0, gradients: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    createLinearGradient() { calls.gradients++; return grad; },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, translate() {}, rotate() { calls.rotate++; },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    rect() {}, clip() { calls.clip++; },
    arc() { calls.arcs = (calls.arcs || 0) + 1; },
    ellipse() { calls.arcs = (calls.arcs || 0) + 1; },
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
    assert.ok(['house', 'sponsor', 'campaign'].includes(b.kind), b.id + ' kind');
    assert.ok(b.text && b.text.length <= 26, b.id + ' 문구가 너무 길다');
    assert.ok(/^#[0-9a-f]{6}$/i.test(b.bg) && /^#[0-9a-f]{6}$/i.test(b.fg), b.id + ' 색상');
    assert.ok(/^#[0-9a-f]{6}$/i.test(b.accent));
  }
  assert.ok(S.BOARDS.some((b) => b.kind === 'sponsor'), '판매용 지면이 최소 하나는 있어야 한다');
  assert.ok(S.boardsOfKind('campaign').length >= 3, '공익 캠페인이 충분히 있어야 한다');
});

test('광고 브랜드는 전부 가상이며 실존 상표를 쓰지 않는다', () => {
  const sponsors = S.boardsOfKind('sponsor');
  const named = sponsors.filter((b) => b.id !== 'slot');
  assert.ok(named.length >= 3, '가상 브랜드가 여러 개 있어야 광고판이 자연스럽다');
  for (const b of named) {
    assert.strictEqual(b.fictional, true, b.id + ' 는 가상 브랜드로 표시되어야 한다');
  }
  // 비어 있는 판매 지면은 가상 브랜드가 아니라 안내 문구다
  const slot = sponsors.find((b) => b.id === 'slot');
  assert.ok(slot && !slot.fictional);
});

test('로고 마크는 정의된 종류만 쓰고 그리기가 실패하지 않는다', () => {
  const types = ['ball', 'boot', 'leaf', 'drop', 'star', 'shield', 'cup'];
  for (const b of S.BOARDS) {
    if (b.mark) assert.ok(types.includes(b.mark), b.id + ' 마크: ' + b.mark);
  }
  for (const t of types.concat(['알수없는종류'])) {
    const ctx = fakeCtx();
    S.drawMark(ctx, t, 20, 20, 10, '#fff', '#000');
    assert.ok(ctx.calls.fills > 0 || ctx.calls.arcs > 0, t + ' 마크가 그려진다');
  }
});

test('광고만 연달아 나오지 않도록 종류를 섞는다', () => {
  assert.strictEqual(S.ORDER.length, S.BOARDS.length, '모든 보드가 순서에 들어간다');
  for (const b of S.BOARDS) {
    assert.strictEqual(S.ORDER.filter((o) => o.id === b.id).length, 1, b.id + ' 중복/누락');
  }
  // 광고가 3연속으로 나오지 않는다 (순환이므로 끝에서 처음으로 넘어가는 구간도 검사)
  const n = S.ORDER.length;
  for (let i = 0; i < n; i++) {
    const three = [0, 1, 2].map((k) => S.ORDER[(i + k) % n].kind);
    assert.ok(!three.every((k) => k === 'sponsor'),
      i + '번째부터 광고가 3연속: ' + three.join(','));
  }
  // 캠페인이 골고루 퍼져 있는지 — 최대 간격이 전체의 절반을 넘지 않아야 한다
  const gaps = [];
  let last = -1;
  S.ORDER.forEach((b, i) => {
    if (b.kind === 'campaign') { if (last >= 0) gaps.push(i - last); last = i; }
  });
  assert.ok(Math.max.apply(null, gaps) <= Math.ceil(n / 2),
    '캠페인 간격이 너무 벌어짐: ' + gaps.join(','));
});

test('탭 조작과 충돌하지 않도록 광고는 클릭 불가여야 한다', () => {
  // 이 값을 true 로 바꾸면 원버튼 조작과 충돌한다. 바꾸려면 반드시 재설계할 것.
  assert.strictEqual(S.CLICKABLE, false);
});

test('보드는 섞인 순서대로 순환한다', () => {
  const n = S.count();
  assert.strictEqual(S.pick(0).id, S.ORDER[0].id);
  assert.strictEqual(S.pick(n).id, S.ORDER[0].id, '한 바퀴 돌면 처음으로');
  assert.strictEqual(S.pick(n + 1).id, S.ORDER[1].id);
  assert.strictEqual(S.pick(-1).id, S.ORDER[1].id, '음수도 안전하게 처리');
  assert.strictEqual(S.pick(2.7).id, S.ORDER[2].id);
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

test('대형 세로 광고판', () => {
  const small = fakeCtx();
  assert.strictEqual(S.drawTowerBillboard(small, S.pick(0), 0, 300, 60, 80), false, '낮으면 생략');
  assert.strictEqual(S.drawTowerBillboard(small, null, 0, 300, 60, 200), false);

  const latin = S.BOARDS.find((b) => !S.hasHangul(b.text));
  const ctxL = fakeCtx();
  assert.strictEqual(S.drawTowerBillboard(ctxL, latin, 0, 400, 70, 220), true);
  assert.ok(ctxL.calls.rotate > 0, '영문은 눕혀서 그린다');
  assert.ok(ctxL.calls.text.includes(latin.text));

  const korean = S.BOARDS.find((b) => S.hasHangul(b.text));
  const ctxK = fakeCtx();
  S.drawTowerBillboard(ctxK, korean, 0, 400, 70, 220);
  const chars = korean.text.replace(/\s+/g, '').length;
  assert.strictEqual(ctxK.calls.text.filter((t) => t.length === 1).length, chars,
    '한글은 세로쓰기로 한 자씩');
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
