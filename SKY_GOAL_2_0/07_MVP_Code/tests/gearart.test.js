'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const Art = require('../src/gearart.js');

// 캔버스 없이 그리기 코드를 실행해 보는 최소 스텁.
// 좌표가 NaN 이면 브라우저에서는 조용히 아무것도 안 그려지므로 여기서 잡는다.
function stubCtx() {
  const calls = [];
  const nums = [];
  const rec = (name) => (...args) => {
    calls.push(name);
    args.forEach((a) => { if (typeof a === 'number') nums.push(a); });
  };
  return {
    calls, nums,
    save: rec('save'), restore: rec('restore'),
    translate: rec('translate'), rotate: rec('rotate'), scale: rec('scale'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    arc: rec('arc'), arcTo: rec('arcTo'), ellipse: rec('ellipse'),
    quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
    fill: rec('fill'), stroke: rec('stroke'),
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: ''
  };
}

test('장비 12종 + 소모품 4종 모두 아이콘을 가진다', () => {
  E.GEAR.forEach((g) => {
    assert.ok(Art.SKINS[g.id], g.id + ' 아이콘이 없다');
  });
  E.CONSUMABLES.forEach((c) => {
    assert.ok(Art.SKINS[c.id], c.id + ' 아이콘이 없다');
  });
  assert.strictEqual(Art.ids.length, E.GEAR.length + E.CONSUMABLES.length);
});

test('모든 아이콘이 유한한 좌표로 실제 도형을 그린다', () => {
  Art.ids.forEach((id) => {
    const c = stubCtx();
    assert.strictEqual(Art.paint(c, 40, id), true, id + ' 이 그려지지 않았다');
    assert.ok(c.calls.filter((n) => n === 'fill' || n === 'stroke').length >= 2,
      id + ' 이 거의 아무것도 그리지 않는다');
    assert.ok(c.nums.every(Number.isFinite), id + ' 에 NaN 좌표가 있다');
    // save/restore 짝이 맞아야 다음 아이콘의 변환이 오염되지 않는다
    const saves = c.calls.filter((n) => n === 'save').length;
    const restores = c.calls.filter((n) => n === 'restore').length;
    assert.strictEqual(saves, restores, id + ' 의 save/restore 짝이 맞지 않는다');
  });
});

test('아이콘은 지정한 크기 안에서만 그려진다', () => {
  const S = 40;
  Art.ids.forEach((id) => {
    const c = stubCtx();
    Art.paint(c, S, id);
    // 회전·이동이 섞이므로 대략적인 범위만 본다. 크게 벗어나면 잘려 보인다.
    assert.ok(c.nums.every((n) => n >= -S * 1.2 && n <= S * 1.2),
      id + ' 이 아이콘 박스를 크게 벗어난다');
  });
});

test('크기를 키우면 좌표도 같은 비율로 커진다', () => {
  const small = stubCtx();
  const big = stubCtx();
  Art.paint(small, 40, 'charm_gloves');
  Art.paint(big, 80, 'charm_gloves');
  assert.strictEqual(small.nums.length, big.nums.length);
  for (let i = 0; i < small.nums.length; i++) {
    // 각도(rotate)는 배율을 타지 않으므로 0 이 아닌 좌표만 확인한다
    if (Math.abs(small.nums[i]) > 0.001) {
      assert.ok(Math.abs(big.nums[i] / small.nums[i] - 2) < 1e-6 ||
                Math.abs(big.nums[i] - small.nums[i]) < 1e-6);
    }
  }
});

test('모르는 아이콘은 그리지 않고 false 를 돌려준다 (게임이 죽지 않게)', () => {
  assert.strictEqual(Art.paint(stubCtx(), 40, '없는아이템'), false);
  assert.strictEqual(Art.paint(null, 40, 'charm_clover'), false);
});

test('레전더리에만 별이 붙는다', () => {
  E.GEAR.forEach((g) => {
    assert.strictEqual(Art.SKINS[g.id].star, g.rarity === 'legendary',
      g.id + ' 의 별 표시가 등급과 맞지 않는다');
  });
});
