'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

function profileWithShards(over) {
  const p = E.createProfile();
  Object.assign(p.inventory, { common: 20, rare: 20, epic: 20, legendary: 20 }, over || {});
  return p;
}

/* ------------------------------------------------------------- 조각 제작 */

test('조각이 모자라면 장비를 만들 수 없다', () => {
  const p = E.createProfile();                       // 조각 0개
  const res = E.craftGear(p, 'boots_practice');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'shards');
  assert.strictEqual(res.short, E.CRAFT_COST.common);
  assert.strictEqual(E.ownsGear(p, 'boots_practice'), false);
});

test('조각을 모으면 원하는 장비를 지정해서 만든다 (뽑기가 아니다)', () => {
  const p = profileWithShards({ common: 5 });
  const res = E.craftGear(p, 'boots_practice');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.cost, 5);
  assert.strictEqual(p.inventory.common, 0);         // 정확히 차감
  assert.strictEqual(E.ownsGear(p, 'boots_practice'), true);
  assert.strictEqual(p.gear.equipped.boots, 'boots_practice');   // 만들면 바로 장착
});

test('같은 장비를 두 번 만들 수 없다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'charm_clover');
  const again = E.craftGear(p, 'charm_clover');
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'owned');
});

test('같은 슬롯의 장비는 하나만 장착된다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'boots_practice');
  E.craftGear(p, 'boots_mid');
  assert.strictEqual(p.gear.equipped.boots, 'boots_mid');
  assert.strictEqual(E.runMods(p, {}).equipped.length, 1);
});

test('보유하지 않은 장비는 장착되지 않는다', () => {
  const p = E.createProfile();
  assert.strictEqual(E.equipGear(p, 'boots_silver30'), false);
  assert.strictEqual(p.gear.equipped.boots, null);
});

test('남는 조각은 코인으로 바꿀 수 있다', () => {
  const p = profileWithShards({ legendary: 3 });
  const before = p.coins;
  const res = E.dustShards(p, 'legendary', 2);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(p.inventory.legendary, 1);
  assert.strictEqual(p.coins - before, E.DUST_VALUE.legendary * 2);
  assert.strictEqual(E.dustShards(p, 'legendary', 5).ok, false);
});

/* ----------------------------------------------------------- 보정 집계 */

test('장비 물리 보정은 ±15% 를 넘지 않는다', () => {
  const m = E.neutralMods();
  m.flap = 9;
  const capped = E.runMods(E.createProfile(), {});
  assert.ok(capped.flap <= 1 + E.GEAR_PHYSICS_CAP);
  assert.ok(capped.flap >= 1 - E.GEAR_PHYSICS_CAP);

  const p = profileWithShards();
  E.craftGear(p, 'boots_practice');                  // flap 1.03
  const mods = E.runMods(p, {});
  assert.ok(Math.abs(mods.flap - 1.03) < 1e-9);
});

test('부츠가 실제 물리값을 바꾼다', () => {
  const p = profileWithShards();
  const base = E.arenaParams(50, E.STAGES[0], p.stats, p.settings, E.selectedBall(p), p.mode);
  E.craftGear(p, 'boots_practice');
  const geared = E.arenaParams(50, E.STAGES[0], p.stats, p.settings,
                               E.selectedBall(p), p.mode, E.runMods(p, {}));
  // flap 은 음수(위로 뜨는 힘)이므로 더 세지면 더 작아진다
  assert.ok(geared.flap < base.flap);
  assert.ok(Math.abs(geared.flap / base.flap - 1.03) < 1e-9);
});

test('미드필더 부츠는 퍼펙트 판정을 넓힌다', () => {
  const p = profileWithShards();
  const base = E.arenaParams(50, E.STAGES[0], p.stats, p.settings, E.selectedBall(p), p.mode);
  E.craftGear(p, 'boots_mid');
  const geared = E.arenaParams(50, E.STAGES[0], p.stats, p.settings,
                               E.selectedBall(p), p.mode, E.runMods(p, {}));
  assert.ok(Math.abs(geared.perfectWindow / base.perfectWindow - 1.06) < 1e-9);
});

test('스트라이커 부츠는 퍼펙트일 때만 점수를 더한다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'boots_striker');
  const mods = E.runMods(p, {});
  const perfect = E.passResult(0, 0, 200, 0.12, mods);          // 정중앙
  const missed = E.passResult(0, 90, 200, 0.12, mods);          // 가장자리
  assert.strictEqual(perfect.perfect, true);
  assert.strictEqual(missed.perfect, false);
  assert.strictEqual(perfect.score, E.passScore(0, 0, 200) + 3);
  assert.strictEqual(missed.score, E.passScore(0, 90, 200));
});

/* ------------------------------------------------------------ 보상 배율 */

test('응원단 리본은 뜨거울 때 통과한 비율만큼만 준다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'band_ribbon');
  const mods = E.runMods(p, {});
  const half = E.rewardMultipliers(mods, { passCount: 10, hotPasses: 5, combo: 0 });
  const none = E.rewardMultipliers(mods, { passCount: 10, hotPasses: 0, combo: 0 });
  assert.ok(Math.abs(half.coin - 1.10) < 1e-9);
  assert.ok(Math.abs(none.coin - 1.00) < 1e-9);
});

test('캡틴 완장은 COMBO 10 이상에서만 발동한다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'band_captain30');
  const mods = E.runMods(p, {});
  const low = E.rewardMultipliers(mods, { passCount: 5, hotPasses: 0, combo: 9 });
  const high = E.rewardMultipliers(mods, { passCount: 5, hotPasses: 0, combo: 10 });
  assert.ok(Math.abs(low.coin - 1) < 1e-9);
  assert.ok(Math.abs(high.coin - 1.25) < 1e-9);
  assert.ok(Math.abs(high.xp - 1.25) < 1e-9);
});

test('장비 보상 배율은 +30% 에서 잠긴다', () => {
  const m = E.neutralMods();
  m.gearCoin = 3;
  m.gearXp = 3;
  const mult = E.rewardMultipliers(m, { passCount: 1, hotPasses: 0, combo: 0 });
  assert.strictEqual(mult.coin, E.GEAR_REWARD_CAP);
  assert.strictEqual(mult.xp, E.GEAR_REWARD_CAP);
});

test('소모품 배율은 장비 상한 위에 곱해진다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'band_cloth');                       // 코인 +5%
  const mods = E.runMods(p, { snack: E.consumableById('cons_home') });   // 코인 +40%
  const mult = E.rewardMultipliers(mods, { passCount: 1, hotPasses: 0, combo: 0 });
  assert.ok(Math.abs(mult.coin - 1.05 * 1.40) < 1e-9);
});

/* -------------------------------------------------------------- 소모품 */

test('소모품은 코인으로 사고, 경기 시작 시 하나 소비된다', () => {
  const p = E.createProfile();
  p.coins = 500;
  assert.strictEqual(E.buyConsumable(p, 'cons_drink', 2).ok, true);
  assert.strictEqual(p.coins, 500 - 160);
  assert.strictEqual(E.consumableStock(p, 'cons_drink'), 2);
  assert.strictEqual(p.consumables.selected, 'cons_drink');   // 첫 구매는 자동 선택

  const used = E.consumeSelected(p);
  assert.strictEqual(used.id, 'cons_drink');
  assert.strictEqual(E.consumableStock(p, 'cons_drink'), 1);

  E.consumeSelected(p);
  assert.strictEqual(E.consumableStock(p, 'cons_drink'), 0);
  assert.strictEqual(p.consumables.selected, null);           // 떨어지면 슬롯이 비워진다
  assert.strictEqual(E.consumeSelected(p), null);
});

test('코인이 모자라면 소모품을 살 수 없다', () => {
  const p = E.createProfile();
  p.coins = 10;
  const res = E.buyConsumable(p, 'cons_home', 1);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'coins');
  assert.strictEqual(p.coins, 10);
});

test('워밍업 드링크는 초반 골문에서만 간격을 넓힌다', () => {
  const p = E.createProfile();
  const snack = E.consumableById('cons_drink');
  const early = E.runMods(p, { early: true, snack: snack });
  const later = E.runMods(p, { early: false, snack: snack });
  assert.ok(Math.abs(early.gap - 1.12) < 1e-9);
  assert.strictEqual(later.gap, 1);
});

test('스카우팅 리포트는 골문 흔들림을 줄인다', () => {
  const p = E.createProfile();
  const mods = E.runMods(p, { snack: E.consumableById('cons_scout') });
  const base = E.arenaParams(80, E.STAGES[5], p.stats, p.settings, E.selectedBall(p), p.mode);
  const calm = E.arenaParams(80, E.STAGES[5], p.stats, p.settings,
                             E.selectedBall(p), p.mode, mods);
  assert.ok(calm.movement < base.movement);
  assert.ok(Math.abs(calm.movement / base.movement - 0.70) < 1e-9);
});

/* ---------------------------------------------------------------- 부활 */

test('부활은 판당 1회이고 골든 휘슬이 테이핑보다 우선한다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'charm_golden30');
  const both = E.runMods(p, { snack: E.consumableById('cons_taping') });
  assert.strictEqual(both.save, 'whistle');
  const rule = E.saveRule(both, 'amateur');
  assert.strictEqual(rule.kind, 'whistle');
  assert.strictEqual(rule.comboKeep, 0.5);
});

test('테이핑만 있으면 COMBO 를 그대로 유지한다', () => {
  const p = E.createProfile();
  const mods = E.runMods(p, { snack: E.consumableById('cons_taping') });
  const rule = E.saveRule(mods, 'amateur');
  assert.strictEqual(rule.kind, 'taping');
  assert.strictEqual(rule.comboKeep, 1);
});

test('PRO 모드에서는 부활이 발동하지 않는다 (기록 공정성)', () => {
  const p = profileWithShards();
  E.craftGear(p, 'charm_golden30');
  const mods = E.runMods(p, { snack: E.consumableById('cons_taping') });
  assert.strictEqual(E.saveRule(mods, 'pro'), null);
  assert.notStrictEqual(E.saveRule(mods, 'amateur'), null);
});

test('충돌 무효는 겹쳐도 판당 1회로 잠긴다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'charm_gloves');
  assert.strictEqual(E.runMods(p, {}).blockHits, 1);
});

/* ------------------------------------------------------------ commitRun */

test('commitRun 이 장비 배율을 코인과 XP 에 반영한다', () => {
  const base = E.createProfile();
  const geared = profileWithShards();
  E.craftGear(geared, 'band_captain30');             // COMBO 10+ 에서 코인·XP +25%
  const run = {
    score: 100, combo: 12, passCount: 8, perfectCount: 2,
    duration: 30, tapIntervals: [250, 250, 250], difficulty: 50
  };
  const a = E.commitRun(base, Object.assign({}, run));
  const b = E.commitRun(geared, Object.assign({}, run));
  assert.ok(b.coins > a.coins);
  assert.ok(Math.abs(b.coinMultiplier - 1.25) < 1e-9);
  assert.ok(Math.abs(b.xpMultiplier - 1.25) < 1e-9);
  assert.deepStrictEqual(b.gearUsed, ['2030 캡틴 완장']);
});

test('commitRun 이 조각을 하나 지급한다', () => {
  const p = E.createProfile();
  const before = E.RARITIES.reduce((s, r) => s + p.inventory[r], 0);
  const sum = E.commitRun(p, {
    score: 40, combo: 4, passCount: 4, perfectCount: 1,
    duration: 20, tapIntervals: [250, 250], difficulty: 50
  });
  const after = E.RARITIES.reduce((s, r) => s + p.inventory[r], 0);
  assert.strictEqual(after - before, 1);
  assert.ok(E.RARITIES.indexOf(sum.loot) >= 0);
  assert.strictEqual(sum.shardLabel, E.RARITY_LABEL[sum.loot]);
});

test('잔디 클로버가 LUCK 을 올려 레전더리 확률을 높인다', () => {
  const p = profileWithShards();
  E.craftGear(p, 'charm_clover');
  const mods = E.runMods(p, {});
  assert.strictEqual(mods.luckAdd, 3);
  const plain = E.lootTable(50, 50);
  const lucky = E.lootTable(50, 50 + mods.luckAdd);
  assert.ok(lucky.legendary > plain.legendary);
});

/* --------------------------------------------------- 저장 데이터 호환성 */

test('장비 개념이 없던 구버전 프로필도 그대로 열린다', () => {
  const p = E.normalizeProfile({
    coins: 700, inventory: { common: 9, rare: 3, epic: 1, legendary: 0 }
  });
  assert.strictEqual(p.inventory.common, 9);        // 쌓아 둔 조각이 살아난다
  assert.deepStrictEqual(p.gear.owned, []);
  assert.deepStrictEqual(p.gear.equipped, { boots: null, band: null, charm: null });
  assert.deepStrictEqual(p.consumables, { stock: {}, selected: null });
});

test('손상된 장비 데이터는 안전하게 정리된다', () => {
  const p = E.normalizeProfile({
    gear: {
      owned: ['boots_practice', 'boots_practice', '없는장비', 42],
      equipped: { boots: 'charm_gloves', band: '없는장비', charm: 'charm_clover' }
    },
    consumables: { stock: { cons_drink: -5, 없는것: 9 }, selected: 'cons_home' }
  });
  assert.deepStrictEqual(p.gear.owned, ['boots_practice']);     // 중복·허위 제거
  assert.strictEqual(p.gear.boots, undefined);
  assert.strictEqual(p.gear.equipped.boots, null);              // 슬롯이 안 맞으면 비움
  assert.strictEqual(p.gear.equipped.band, null);
  assert.strictEqual(p.gear.equipped.charm, null);              // 보유하지 않으면 비움
  assert.deepStrictEqual(p.consumables.stock, {});
  assert.strictEqual(p.consumables.selected, null);
});

test('모든 장비가 슬롯·등급·효과를 빠짐없이 갖는다', () => {
  const slots = E.GEAR_SLOTS.map((s) => s.id);
  const seen = {};
  E.GEAR.forEach((g) => {
    assert.ok(slots.indexOf(g.slot) >= 0, g.id + ' 의 슬롯이 잘못됐다');
    assert.ok(E.RARITIES.indexOf(g.rarity) >= 0, g.id + ' 의 등급이 잘못됐다');
    assert.ok(g.name && g.desc && g.spec, g.id + ' 에 설명이 없다');
    assert.ok(Object.keys(g.mod).length > 0, g.id + ' 에 효과가 없다');
    const key = g.slot + ':' + g.rarity;
    assert.strictEqual(seen[key], undefined, key + ' 가 중복된다');
    seen[key] = g.id;
  });
  assert.strictEqual(E.GEAR.length, slots.length * E.RARITIES.length);
});
