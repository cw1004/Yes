'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

function runOf(over) {
  return Object.assign({
    score: 40, combo: 4, passCount: 4, perfectCount: 1,
    duration: 20, tapIntervals: [250, 260, 240, 255], difficulty: 50
  }, over || {});
}

test('clamp / norm 은 항상 안전한 범위를 돌려준다', () => {
  assert.strictEqual(E.clamp(5, 0, 10), 5);
  assert.strictEqual(E.clamp(-5, 0, 10), 0);
  assert.strictEqual(E.clamp(50, 0, 10), 10);
  assert.strictEqual(E.clamp(NaN, 3, 10), 3);
  assert.strictEqual(E.norm(5, 0, 10), 50);
  assert.strictEqual(E.norm(-100, 0, 10), 0);
  assert.strictEqual(E.norm(1, 1, 1), 0);
});

test('normalizeProfile 은 손상된 저장 데이터를 복구한다', () => {
  const p = E.normalizeProfile({
    skill: 'abc', difficulty: 900, level: -3, coins: null,
    stats: { control: 'x' }, metrics: { recentScores: [1, 'x', 3], games: -5 }
  });
  assert.strictEqual(p.skill, 50);
  assert.strictEqual(p.difficulty, 95);
  assert.strictEqual(p.level, 1);
  assert.strictEqual(p.coins, 0);
  assert.strictEqual(p.stats.control, 50);
  assert.deepStrictEqual(p.metrics.recentScores, [1, 3]);
  assert.strictEqual(p.metrics.games, 0);
  assert.deepStrictEqual(E.normalizeProfile(null), E.createProfile());
  assert.deepStrictEqual(E.normalizeProfile('nonsense'), E.createProfile());
});

test('변동계수는 표본이 부족하면 기본값을 쓴다', () => {
  assert.strictEqual(E.coefficientOfVariation([]), 0.25);
  assert.strictEqual(E.coefficientOfVariation([100]), 0.25);
  assert.ok(E.coefficientOfVariation([100, 100, 100]) < 1e-9);
  assert.ok(E.coefficientOfVariation([50, 150]) > 0.4);
});

test('숙련도는 70/30 지수 평활로 천천히 움직인다', () => {
  const p = E.createProfile();
  p.metrics.games = 10;
  p.metrics.survivalTime = 400;
  p.metrics.passCount = 80;
  p.metrics.attemptCount = 10;
  p.metrics.maxCombo = 18;
  p.metrics.recentScores = [110, 120, 115];
  const s1 = E.computeSkill(p);
  assert.ok(s1 > p.skill, '잘하는 플레이어의 숙련도는 올라가야 한다');
  assert.ok(s1 - p.skill <= 30, '한 번에 30 이상 튀지 않는다');
  assert.ok(s1 >= 0 && s1 <= 100);
});

test('난이도는 한 판에 ±5 를 넘지 않고 10~95 를 벗어나지 않는다', () => {
  const p = E.createProfile();
  p.metrics.winStreak = 9;
  p.metrics.recentSuccesses = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const up = E.computeDifficulty(p, 100, { combo: 30, earlyDeath: false });
  assert.ok(up.delta <= 5 + 1e-9);
  assert.ok(up.difficulty <= 95);

  const q = E.createProfile();
  q.difficulty = 12;
  q.metrics.loseStreak = 5;
  q.metrics.recentSuccesses = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const down = E.computeDifficulty(q, 0, { combo: 0, earlyDeath: true });
  assert.ok(down.delta >= -5 - 1e-9);
  assert.ok(down.difficulty >= 10);
});

test('경기장 스테이지 매핑 (통과한 골문 수 기준)', () => {
  assert.strictEqual(E.stageFor(0, 10).key, 'DAY');
  assert.strictEqual(E.stageFor(6, 10).key, 'SUNSET');
  assert.strictEqual(E.stageFor(12, 10).key, 'NIGHT');
  assert.strictEqual(E.stageFor(0, 50).key, 'NIGHT');
  assert.strictEqual(E.stageFor(30, 10).key, 'WIND');
  assert.strictEqual(E.stageFor(30, 40).key, 'STORM', '난이도가 스테이지를 가속한다');
  assert.strictEqual(E.stageFor(55, 10).key, 'STORM');
  assert.strictEqual(E.stageFor(90, 10).key, 'WORLD_FINAL');
  assert.strictEqual(E.stageFor(999, 95).key, 'WORLD_FINAL');
});

test('난이도가 높을수록 골문은 좁아지고 속도는 빨라진다', () => {
  const stats = E.createProfile().stats;
  const easy = E.arenaParams(10, E.stageFor(0, 10), stats);
  const hard = E.arenaParams(95, E.stageFor(0, 95), stats);
  assert.ok(hard.gap < easy.gap);
  assert.ok(hard.speed > easy.speed);
  assert.ok(hard.gap >= 130, '골문이 공보다 좁아지지 않는다');
  assert.strictEqual(easy.wind, 0, '저난이도에서는 바람이 없다');
  for (let d = 10; d <= 95; d += 5) {
    const a = E.arenaParams(d, E.stageFor(0, d), stats);
    assert.ok(a.gap >= 130 && a.gap <= 260, 'gap 범위: ' + a.gap);
    assert.ok(a.speed >= 180 && a.speed <= 560, 'speed 범위: ' + a.speed);
    assert.ok(a.gravity > 0 && a.flap < 0);
  }
});

test('퍼펙트 보너스와 통과 점수', () => {
  assert.strictEqual(E.perfectBonus(0, 200), 10);
  assert.strictEqual(E.perfectBonus(100, 200), 0);
  assert.strictEqual(E.perfectBonus(500, 200), 0);
  assert.strictEqual(E.perfectBonus(0, 0), 0);
  assert.strictEqual(E.passScore(0, 100, 200), 10);
  assert.strictEqual(E.passScore(3, 0, 200), 26);
});

test('보상 공식', () => {
  assert.strictEqual(E.coinReward(0), 10);
  assert.ok(E.coinReward(100) > E.coinReward(10));
  assert.ok(E.xpReward(100, 5, 90) > E.xpReward(100, 5, 10));
  assert.strictEqual(E.xpRequired(1), 100);
  assert.ok(E.xpRequired(4) > E.xpRequired(3));
});

test('아이템 확률표 합은 100 이고 레전더리는 5~12% 이다', () => {
  for (let d = 10; d <= 95; d += 5) {
    const t = E.lootTable(d, 50);
    const sum = t.common + t.rare + t.epic + t.legendary;
    assert.ok(Math.abs(sum - 100) < 1e-9, 'sum=' + sum);
    assert.ok(t.legendary >= 5 && t.legendary <= 12);
    assert.ok(t.common > 0);
  }
  assert.strictEqual(E.rollLoot(50, 50, () => 0.0001), 'legendary');
  assert.strictEqual(E.rollLoot(50, 50, () => 0.99), 'common');
});

test('레벨업과 스탯 포인트', () => {
  const p = E.createProfile();
  p.xp = 100 + 100 * Math.pow(2, 1.5) + 5;
  const gained = E.applyLevelUps(p);
  assert.strictEqual(gained, 2);
  assert.strictEqual(p.level, 3);
  assert.strictEqual(p.statPoints, 2);
  assert.ok(p.xp >= 0 && p.xp < E.xpRequired(p.level));

  assert.strictEqual(E.spendStatPoint(p, 'control'), true);
  assert.strictEqual(p.stats.control, 52);
  assert.strictEqual(E.spendStatPoint(p, 'nope'), false);
  E.spendStatPoint(p, 'luck');
  assert.strictEqual(E.spendStatPoint(p, 'luck'), false, '포인트가 없으면 실패한다');
});

test('commitRun 은 프로필과 지표를 갱신한다', () => {
  const p = E.createProfile();
  const sum = E.commitRun(p, runOf(), () => 0.5);
  assert.strictEqual(p.metrics.games, 1);
  assert.strictEqual(p.metrics.passCount, 4);
  assert.strictEqual(p.bestScore, 40);
  assert.strictEqual(p.coins, sum.coins);
  assert.strictEqual(p.metrics.winStreak, 1);
  assert.strictEqual(p.metrics.loseStreak, 0);
  assert.ok(sum.xp > 0);
  assert.ok(['common', 'rare', 'epic', 'legendary'].includes(sum.loot));
  assert.ok(Math.abs(sum.difficultyDelta) <= 5 + 1e-9);

  E.commitRun(p, runOf({ score: 0, combo: 0, passCount: 0, duration: 1 }), () => 0.5);
  assert.strictEqual(p.metrics.winStreak, 0);
  assert.strictEqual(p.metrics.loseStreak, 1);
  assert.strictEqual(p.metrics.recentSuccesses.slice(-1)[0], 0);
});

test('최근 기록은 10개로 제한된다', () => {
  const p = E.createProfile();
  for (let i = 0; i < 25; i++) E.commitRun(p, runOf({ score: i }), () => 0.5);
  assert.strictEqual(p.metrics.recentScores.length, 10);
  assert.strictEqual(p.metrics.recentSuccesses.length, 10);
  assert.strictEqual(p.metrics.games, 25);
});

// 시뮬레이션: 실력이 고정된 가상 플레이어가 반복 플레이할 때
// 난이도가 발산하지 않는지, 실력에 맞게 수렴하는지 확인한다.
function simulate(playerSkill, games) {
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const p = E.createProfile();
  const history = [];
  for (let i = 0; i < games; i++) {
    const a = E.arenaParams(p.difficulty, E.stageFor(0, p.difficulty), p.stats);
    // 통과 기대치: 실력이 높고 골문이 넓고 느릴수록 오래 버틴다.
    const capability = playerSkill * (a.gap / 220) * (300 / a.speed);
    const passes = Math.max(0, Math.round(capability * (0.6 + rng() * 0.8)));
    const score = passes * 12;
    E.commitRun(p, {
      score: score, combo: passes, passCount: passes,
      perfectCount: Math.floor(passes / 3), duration: 2 + passes * 1.6,
      tapIntervals: [250, 245, 255, 250], difficulty: p.difficulty
    }, rng);
    history.push({ difficulty: p.difficulty, success: score >= 10 ? 1 : 0 });
  }
  const tail = history.slice(-30);
  return {
    profile: p,
    finalDifficulty: p.difficulty,
    tailSuccessRate: tail.reduce((s, h) => s + h.success, 0) / tail.length,
    maxJump: history.reduce((mx, h, i) =>
      i === 0 ? mx : Math.max(mx, Math.abs(h.difficulty - history[i - 1].difficulty)), 0)
  };
}

test('숙련 플레이어는 난이도가 올라가고 초보는 내려간다', () => {
  const pro = simulate(14, 120);
  const rookie = simulate(1.2, 120);
  assert.ok(pro.finalDifficulty > rookie.finalDifficulty + 15,
    '숙련자 ' + pro.finalDifficulty.toFixed(1) + ' vs 초보자 ' + rookie.finalDifficulty.toFixed(1));
  assert.ok(pro.finalDifficulty <= 95 && rookie.finalDifficulty >= 10);
  assert.ok(pro.maxJump <= 5 + 1e-9, '한 판당 최대 변화: ' + pro.maxJump);
  assert.ok(rookie.maxJump <= 5 + 1e-9);
});

test('저장소는 localStorage 가 막혀도 동작한다', () => {
  const backing = {};
  const fake = {
    getItem: (k) => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; }
  };
  const s = E.createStorage(fake);
  assert.strictEqual(s.persistent, true);
  const p = s.load();
  p.coins = 777;
  assert.strictEqual(s.save(p), true);
  assert.strictEqual(s.load().coins, 777);
  assert.strictEqual(s.reset().coins, 0);
  assert.strictEqual(s.load().coins, 0);

  const blocked = E.createStorage(null);
  assert.strictEqual(blocked.persistent, false);
  const bp = blocked.load();
  bp.coins = 42;
  blocked.save(bp);
  assert.strictEqual(blocked.load().coins, 42, '세션 메모리로 폴백한다');

  backing[E.STORAGE_KEY] = '{{{ broken json';
  assert.strictEqual(E.createStorage(fake).load().coins, 0, '깨진 JSON 은 기본 프로필로 복구');
});
