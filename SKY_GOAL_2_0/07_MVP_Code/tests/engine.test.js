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

test('조작 설정은 하한(공 20 / 스피드 30) 아래로 내려가지 않는다', () => {
  assert.strictEqual(E.BALL_FINE_MIN, 20);
  assert.strictEqual(E.SPEED_MIN, 30);
  const low = E.tuningFactors({ ballFine: 0, speed: 0 });
  assert.strictEqual(low.ballFine, 20);
  assert.strictEqual(low.speed, 30);
  const high = E.tuningFactors({ ballFine: 999, speed: 999 });
  assert.strictEqual(high.ballFine, 100);
  assert.strictEqual(high.speed, 100);
  const bad = E.tuningFactors({ ballFine: 'x', speed: null });
  assert.strictEqual(bad.ballFine, 50);
  assert.strictEqual(bad.speed, 50);
  assert.deepStrictEqual(E.tuningFactors(), E.tuningFactors({}));

  const p = E.normalizeProfile({ settings: { ballFine: 5, speed: 1000 } });
  assert.strictEqual(p.settings.ballFine, 20);
  assert.strictEqual(p.settings.speed, 100);
  assert.strictEqual(E.createProfile().settings.ballFine, 50);
});

test('공 상하 미세 조정은 반응 속도만 바꾸고 점프 높이는 유지한다', () => {
  const stats = E.createProfile().stats;
  const stage = E.stageFor(0, 50);
  const height = (a) => (a.flap * a.flap) / (2 * a.gravity);
  const slow = E.arenaParams(50, stage, stats, { ballFine: 20, speed: 50 });
  const mid = E.arenaParams(50, stage, stats, { ballFine: 50, speed: 50 });
  const fast = E.arenaParams(50, stage, stats, { ballFine: 100, speed: 50 });

  assert.ok(Math.abs(height(slow) - height(fast)) < 0.001, '점프 높이가 같아야 한다');
  assert.ok(Math.abs(height(mid) - height(fast)) < 0.001);
  assert.ok(Math.abs(fast.flap) > Math.abs(slow.flap), '값이 클수록 상승·하강이 빠르다');
  assert.ok(fast.gravity > mid.gravity && mid.gravity > slow.gravity);
  assert.strictEqual(slow.speed, mid.speed, '공 설정은 스크롤 속도를 바꾸지 않는다');
});

test('스피드 설정은 스크롤 속도만 바꾼다', () => {
  const stats = E.createProfile().stats;
  const stage = E.stageFor(0, 50);
  const slow = E.arenaParams(50, stage, stats, { ballFine: 50, speed: 30 });
  const fast = E.arenaParams(50, stage, stats, { ballFine: 50, speed: 100 });
  assert.ok(fast.speed > slow.speed * 1.5, slow.speed + ' → ' + fast.speed);
  assert.strictEqual(slow.gravity, fast.gravity);
  assert.strictEqual(slow.gap, fast.gap);
  for (let d = 10; d <= 95; d += 5) {
    for (const sp of [30, 65, 100]) {
      const a = E.arenaParams(d, E.stageFor(0, d), stats, { speed: sp });
      assert.ok(a.speed >= 140 && a.speed <= 660, 'speed 범위: ' + a.speed);
    }
  }
});

test('골문은 난이도가 낮아도 항상 살짝 오르내린다', () => {
  const stats = E.createProfile().stats;
  for (let d = 10; d <= 95; d += 5) {
    const a = E.arenaParams(d, E.stageFor(0, d), stats);
    assert.ok(a.bob >= 14, '최소 흔들림: ' + a.bob);
    assert.ok(a.bob <= 42, '과도한 흔들림: ' + a.bob);
  }
  const easy = E.arenaParams(10, E.stageFor(0, 10), stats);
  const hard = E.arenaParams(95, E.stageFor(0, 95), stats);
  assert.ok(hard.bob > easy.bob, '난이도가 높을수록 더 흔들린다');
});

test('공 5종이 서로 다른 무게를 가진다', () => {
  assert.strictEqual(E.BALLS.length, 5);
  const ids = E.BALLS.map((b) => b.id);
  assert.strictEqual(new Set(ids).size, 5, 'id 가 중복되지 않는다');
  const weights = E.BALLS.map((b) => b.weight);
  assert.strictEqual(new Set(weights).size, 5, '무게가 모두 다르다');
  for (const b of E.BALLS) {
    assert.ok(b.weight >= 0.7 && b.weight <= 1.4, b.id + ' 무게 범위');
    assert.ok(b.price >= 0 && Number.isInteger(b.price));
    assert.ok(b.name && b.desc && b.skin && b.skin.base);
  }
  assert.strictEqual(E.BALLS[0].price, 0, '기본 공은 무료');
  assert.strictEqual(E.ballById('없는공').id, E.DEFAULT_BALL, '없는 id 는 기본 공');
});

test('무게에 따라 점프 높이와 체공 시간이 달라진다', () => {
  const stats = E.createProfile().stats;
  const stage = E.stageFor(0, 50);
  const of = (id) => {
    const a = E.arenaParams(50, stage, stats, {}, E.ballById(id));
    return { h: (a.flap * a.flap) / (2 * a.gravity), t: (2 * Math.abs(a.flap)) / a.gravity };
  };
  const rubber = of('rubber');      // 0.78 — 가벼움
  const street = of('street');      // 1.00 — 표준
  const training = of('training');  // 1.30 — 무거움

  assert.ok(rubber.h > street.h, '가벼운 공이 더 높이 뜬다');
  assert.ok(training.h < street.h, '무거운 공은 낮게 뜬다');
  assert.ok(rubber.t > street.t && street.t > training.t, '가벼울수록 체공이 길다');
  assert.ok(rubber.h / training.h > 1.15, '차이가 체감될 만큼 벌어진다');
});

test('공 구매와 선택', () => {
  const p = E.createProfile();
  assert.deepStrictEqual(p.balls.owned, ['street']);
  assert.strictEqual(p.balls.selected, 'street');

  let res = E.buyBall(p, 'rubber');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'coins');
  assert.strictEqual(res.short, 300);
  assert.strictEqual(p.coins, 0, '실패하면 코인이 줄지 않는다');

  p.coins = 1000;
  res = E.buyBall(p, 'rubber');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(p.coins, 700);
  assert.strictEqual(p.balls.selected, 'rubber', '사면 바로 장착된다');

  assert.strictEqual(E.buyBall(p, 'rubber').reason, 'owned');
  assert.strictEqual(E.selectBall(p, 'training'), false, '없는 공은 선택 못 한다');
  assert.strictEqual(E.selectBall(p, 'street'), true);
  assert.strictEqual(E.selectedBall(p).id, 'street');
  assert.strictEqual(E.ownsBall(p, 'rubber'), true);
  assert.strictEqual(E.ownsBall(p, 'gold2030'), false);
});

test('저장된 공 목록이 손상되어도 복구된다', () => {
  const p = E.normalizeProfile({ balls: { owned: ['없는공', 'gold2030', 'gold2030'], selected: '없는공' } });
  assert.deepStrictEqual(p.balls.owned, ['street', 'gold2030'], '기본 공 포함, 중복·미존재 제거');
  assert.strictEqual(p.balls.selected, 'street', '보유하지 않은 선택은 기본으로');
  const q = E.normalizeProfile({ balls: 'nonsense' });
  assert.deepStrictEqual(q.balls.owned, ['street']);
});

test('골든볼은 코인을 15% 더 준다', () => {
  const base = E.createProfile();
  const gold = E.createProfile();
  gold.balls = { owned: ['street', 'gold2030'], selected: 'gold2030' };
  const run = { score: 100, combo: 5, passCount: 5, perfectCount: 2, duration: 20,
                tapIntervals: [250, 250, 250], difficulty: 50 };
  const a = E.commitRun(base, Object.assign({}, run), () => 0.5);
  const b = E.commitRun(gold, Object.assign({}, run), () => 0.5);
  assert.strictEqual(b.ballId, 'gold2030');
  assert.strictEqual(b.coins, Math.round(a.coins * 1.15));
});

test('프로 모드는 좁고 빠르고 보상이 크다', () => {
  const p = E.createProfile();
  const stage = E.stageFor(0, 50);
  const am = E.arenaParams(50, stage, p.stats, {}, null, 'amateur');
  const pro = E.arenaParams(50, stage, p.stats, {}, null, 'pro');

  assert.ok(pro.gap < am.gap * 0.85, '골문이 확실히 좁다: ' + pro.gap + ' vs ' + am.gap);
  assert.ok(pro.speed > am.speed * 1.2, '더 빠르다: ' + pro.speed + ' vs ' + am.speed);
  assert.ok(pro.movement > am.movement * 1.5, '더 흔들린다');
  assert.ok(pro.perfectWindow < am.perfectWindow, '퍼펙트 판정이 좁다');
  assert.strictEqual(pro.mode, 'pro');
  assert.strictEqual(E.modeParams('없는모드').id, 'amateur', '모르는 모드는 아마추어로');

  // 난이도 하한도 올라간다
  const amLow = E.arenaParams(10, stage, p.stats, {}, null, 'amateur');
  const proLow = E.arenaParams(10, stage, p.stats, {}, null, 'pro');
  assert.ok(proLow.gap < amLow.gap, '가장 쉬운 설정에서도 프로가 어렵다');
});

test('프로 모드는 조건을 만족해야 열린다', () => {
  const p = E.createProfile();
  assert.strictEqual(E.isModeUnlocked(p, 'amateur'), true);
  assert.strictEqual(E.isModeUnlocked(p, 'pro'), false);
  assert.strictEqual(E.setMode(p, 'pro'), false, '잠겨 있으면 전환 실패');
  assert.strictEqual(p.mode, 'amateur');

  p.modes.amateur.bestScore = E.PRO_UNLOCK.bestScore;
  assert.strictEqual(E.isModeUnlocked(p, 'pro'), true, '최고 점수로 해금');

  const q = E.createProfile();
  q.metrics.clears = 1;
  assert.strictEqual(E.isModeUnlocked(q, 'pro'), true, '완주로도 해금');
});

test('최고 점수는 모드 전환으로 내려가지 않는다', () => {
  const p = E.createProfile();
  p.modes.amateur.bestScore = 777;          // 저장된 기록만 있고 미러는 아직 0
  p.modes.amateur.difficulty = 60;
  E.saveModeState(p);
  assert.strictEqual(p.modes.amateur.bestScore, 777, '미러가 0이어도 기록을 덮지 않는다');
  assert.strictEqual(p.bestScore, 777, '미러도 기록에 맞춰 올라온다');
});

test('모드별로 난이도와 최고 점수를 따로 보관한다', () => {
  const p = E.createProfile();
  p.modes.amateur.bestScore = 300;
  E.loadModeState(p);
  p.difficulty = 71;
  p.bestScore = 300;

  assert.strictEqual(E.setMode(p, 'pro'), true);
  assert.strictEqual(p.modes.amateur.difficulty, 71, '아마추어 난이도가 보관된다');
  assert.strictEqual(p.difficulty, E.MODES.pro.startDifficulty, '프로는 자기 난이도로 시작');
  assert.strictEqual(p.bestScore, 0, '프로 최고 점수는 따로 센다');

  p.difficulty = 88;
  E.setMode(p, 'amateur');
  assert.strictEqual(p.difficulty, 71, '아마추어로 돌아오면 원래 난이도');
  assert.strictEqual(p.bestScore, 300);
  assert.strictEqual(p.modes.pro.difficulty, 88, '프로 난이도도 보관된다');
});

test('구버전 프로필은 아마추어 모드로 이어받는다', () => {
  const legacy = E.normalizeProfile({
    skill: 71, difficulty: 78, bestScore: 540,
    metrics: { games: 40, recentScores: [100, 200], recentSuccesses: [1, 1], winStreak: 3 }
  });
  assert.strictEqual(legacy.mode, 'amateur');
  assert.strictEqual(legacy.modes.amateur.bestScore, 540, '최고 점수를 잃지 않는다');
  assert.strictEqual(legacy.modes.amateur.difficulty, 78, '학습된 난이도도 유지');
  assert.strictEqual(legacy.modes.amateur.skill, 71);
  assert.deepStrictEqual(legacy.modes.amateur.recentScores, [100, 200]);
  assert.strictEqual(legacy.modes.pro.bestScore, 0, '프로는 새로 시작');
});

test('프로 모드는 코인과 XP 를 1.6배 준다', () => {
  const run = { score: 100, combo: 5, passCount: 5, perfectCount: 2, duration: 20,
                tapIntervals: [250, 250, 250], difficulty: 50 };
  const a = E.createProfile();
  const b = E.createProfile();
  b.modes.amateur.bestScore = 999;
  E.setMode(b, 'pro');

  const ra = E.commitRun(a, Object.assign({}, run), () => 0.5);
  const rb = E.commitRun(b, Object.assign({}, run), () => 0.5);
  assert.strictEqual(ra.mode, 'amateur');
  assert.strictEqual(rb.mode, 'pro');
  assert.strictEqual(rb.coins, Math.round(ra.coins * E.MODES.pro.reward));
  assert.ok(Math.abs(rb.xp - ra.xp * E.MODES.pro.reward) < 0.001);
  assert.strictEqual(b.modes.pro.bestScore, 100, '프로 최고 점수에 기록된다');
  assert.strictEqual(b.modes.amateur.bestScore, 999, '아마추어 기록은 그대로');
  assert.strictEqual(E.setMode(b, 'amateur'), true);
  assert.strictEqual(b.bestScore, 999, '돌아오면 기록이 살아 있다');
});

test('완주 보상 — 처음엔 골든볼, 다음부터는 코인', () => {
  const p = E.createProfile();
  assert.strictEqual(p.metrics.clears, 0);
  assert.strictEqual(E.CLEAR_STAGE, 'WORLD_FINAL');

  const first = E.grantClearReward(p);
  assert.strictEqual(first.type, 'ball');
  assert.strictEqual(first.ballId, E.CLEAR_GIFT_BALL);
  assert.ok(E.ownsBall(p, E.CLEAR_GIFT_BALL), '골든볼을 선물로 받는다');
  assert.strictEqual(p.balls.selected, E.CLEAR_GIFT_BALL, '받은 공이 바로 장착된다');
  assert.strictEqual(p.coins, 0, '공을 받을 때는 코인을 주지 않는다');
  assert.strictEqual(p.metrics.clears, 1);

  const second = E.grantClearReward(p);
  assert.strictEqual(second.type, 'coins');
  assert.strictEqual(p.coins, E.CLEAR_COINS);
  assert.strictEqual(p.inventory.legendary, 1);
  assert.strictEqual(p.metrics.clears, 2);
  assert.strictEqual(second.clears, 2);

  // 이미 골든볼을 산 사람도 코인으로 받는다
  const rich = E.createProfile();
  rich.coins = 5000;
  E.buyBall(rich, E.CLEAR_GIFT_BALL);
  const g = E.grantClearReward(rich);
  assert.strictEqual(g.type, 'coins');
});

test('완주 횟수는 저장 데이터에서 복구된다', () => {
  assert.strictEqual(E.normalizeProfile({ metrics: { clears: 7 } }).metrics.clears, 7);
  assert.strictEqual(E.normalizeProfile({ metrics: { clears: -3 } }).metrics.clears, 0);
  assert.strictEqual(E.normalizeProfile({ metrics: { clears: 'x' } }).metrics.clears, 0);
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
