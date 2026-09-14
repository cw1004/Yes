'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

function runOf(over) {
  return Object.assign({
    score: 100, distance: 1200, acorns: 60,
    obstacles: 10, cleared: 8,
    tikitakaTries: 10, tikitakaHits: 7, parades: 1,
    cleanStreak: 3, bestCleanStreak: 5,
    usage: { nubi: 3, wobi: 2, saro: 2 },
    clearedBy: { nubi: 3, wobi: 3, saro: 2 },
    missions: [], tikitakaCap: E.TIKITAKA_CAP
  }, over || {});
}

/* ---------------------------------------------------------------- 난이도 */

test('난이도가 올라가도 걷는 속도는 완만하게만 오른다', () => {
  const easy = E.params(10);
  const hard = E.params(95);
  // 저연령이 따라가지 못하면 그 순간 게임이 끝난다. 속도는 1.5배를 넘지 않는다.
  assert.ok(hard.walkSpeed / easy.walkSpeed < 1.5, hard.walkSpeed + '/' + easy.walkSpeed);
  // 대신 간격과 판정 폭으로 난이도를 만든다
  assert.ok(hard.obstacleGap < easy.obstacleGap);
  assert.ok(hard.tikitakaWindow < easy.tikitakaWindow);
  assert.ok(hard.reactWindow < easy.reactWindow);
});

test('판정 폭에는 하한이 있어 무한히 좁아지지 않는다', () => {
  const p = E.params(999);
  assert.ok(p.tikitakaWindow >= 0.6);
  assert.ok(p.reactWindow >= 0.6);
  assert.ok(p.obstacleGap >= 190);
});

/* ------------------------------------------------- 캐릭터 편중 보정 (핵심) */

test('한 캐릭터만 쓰면 그 캐릭터가 막는 장애물이 줄고 나머지가 늘어난다', () => {
  const mix = E.obstacleMix({ nubi: 30, wobi: 1, saro: 1 }, 50);
  assert.ok(mix.log < 0.7, 'NUBI 전용 장애물이 줄어야 한다: ' + mix.log);
  assert.ok(mix.gust > 1.3 && mix.gap > 1.3, JSON.stringify(mix));
});

test('고르게 쓰면 장애물도 고르게 나온다', () => {
  const mix = E.obstacleMix({ nubi: 10, wobi: 10, saro: 10 }, 50);
  const vals = Object.keys(mix).map((k) => mix[k]);
  const spread = Math.max.apply(null, vals) - Math.min.apply(null, vals);
  assert.ok(spread < 0.05, JSON.stringify(mix));
});

test('표본이 적으면 보정하지 않는다 (첫 판부터 편향되지 않게)', () => {
  const mix = E.obstacleMix({ nubi: 2, wobi: 0, saro: 0 }, 50);
  assert.deepStrictEqual(Object.keys(mix).map((k) => mix[k]), [1, 1, 1]);
});

test('보정은 상한 안에서만 걸린다 — 한 종류만 계속 나오지 않는다', () => {
  const mix = E.obstacleMix({ nubi: 1000, wobi: 0, saro: 0 }, 95);
  Object.keys(mix).forEach((k) => {
    assert.ok(mix[k] >= 0.4 && mix[k] <= 2.0, k + '=' + mix[k]);
  });
});

test('rollObstacle 이 실제로 편중 보정을 따른다', () => {
  let seed = 1;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const counts = { log: 0, gust: 0, gap: 0 };
  for (let i = 0; i < 3000; i++) counts[E.rollObstacle({ nubi: 40, wobi: 2, saro: 2 }, 50, rng).id]++;
  assert.ok(counts.log < counts.gust && counts.log < counts.gap, JSON.stringify(counts));
});

/* -------------------------------------------------------------- 티키타카 */

test('티키타카 배율은 상한에서 잠긴다', () => {
  assert.strictEqual(E.tikitakaMultiplier(0), 1);
  assert.ok(Math.abs(E.tikitakaMultiplier(4) - 1.2) < 1e-9);
  assert.strictEqual(E.tikitakaMultiplier(999), E.TIKITAKA_CAP);
  assert.strictEqual(E.tikitakaMultiplier(999, 2.0), 2.0);   // 황금 도토리 상한 확장
});

test('티키타카는 다섯 종류가 모두 나온다', () => {
  let seed = 7;
  const rng = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const seen = {};
  for (let i = 0; i < 400; i++) seen[E.rollTikitaka(rng).id] = true;
  assert.strictEqual(Object.keys(seen).length, E.TIKITAKA.length);
});

/* ---------------------------------------------------------------- 미션 */

test('판 미션 3개에는 항상 "세 명 다 쓰기"가 들어간다', () => {
  for (let i = 0; i < 40; i++) {
    const ms = E.rollMissions(Math.random, 3);
    assert.strictEqual(ms.length, 3);
    assert.ok(ms.some((m) => m.id === E.TEAM_MISSION.id), '팀 미션이 빠졌다');
    const ids = ms.map((m) => m.id);
    assert.strictEqual(new Set(ids).size, 3, '미션이 중복됐다: ' + ids);
  }
});

test('미션 진행도가 런 상태를 정확히 읽는다', () => {
  const run = runOf();
  assert.strictEqual(E.missionProgress({ metric: 'acorns' }, run), 60);
  assert.strictEqual(E.missionProgress({ metric: 'tikitaka' }, run), 7);
  assert.strictEqual(E.missionProgress({ metric: 'parades' }, run), 1);
  assert.strictEqual(E.missionProgress({ metric: 'cleanStreak' }, run), 5);
  assert.strictEqual(E.missionProgress({ metric: 'cleared_nubi' }, run), 3);
  assert.strictEqual(E.missionProgress({ metric: 'charactersUsed' }, run), 3);
});

test('한 명만 쓴 판은 팀 미션을 달성하지 못한다', () => {
  const run = runOf({ usage: { nubi: 5 } });
  assert.strictEqual(E.missionProgress(E.TEAM_MISSION, run), 1);
  assert.strictEqual(E.missionDone(E.TEAM_MISSION, run), false);
});

/* ---------------------------------------------------------------- 보상 */

test('0점이어도 도토리를 준다 — 실패한 판이 완전한 손실이 되면 다시 안 한다', () => {
  assert.ok(E.acornReward(0) >= 8);
  assert.ok(E.acornReward(500) > E.acornReward(100));
});

test('미션 보너스가 배율까지 함께 탄다', () => {
  const mission = { id: 'x', metric: 'acorns', target: 10, reward: 100, text: 't' };
  const run = runOf({ acorns: 50, tikitakaHits: 4, missions: [mission] });
  const r = E.runAcorns(run);
  assert.strictEqual(r.missionBonus, 100);
  assert.ok(Math.abs(r.multiplier - 1.2) < 1e-9);
  assert.strictEqual(r.total, Math.round((r.base + 100) * 1.2));
});

test('달성하지 못한 미션은 보너스를 주지 않는다', () => {
  const mission = { id: 'x', metric: 'acorns', target: 9999, reward: 100, text: 't' };
  assert.strictEqual(E.runAcorns(runOf({ missions: [mission] })).missionBonus, 0);
});

/* ------------------------------------------------------------ commitRun */

test('commitRun 이 누적 지표와 도토리를 갱신한다', () => {
  const p = E.createProfile();
  const before = p.acorns;
  const sum = E.commitRun(p, runOf());
  assert.ok(sum.acorns > 0);
  assert.strictEqual(p.acorns - before, sum.acorns);
  assert.strictEqual(p.metrics.games, 1);
  assert.strictEqual(p.metrics.obstacles, 10);
  assert.strictEqual(p.metrics.cleared, 8);
  assert.deepStrictEqual(p.metrics.usage, { nubi: 3, wobi: 2, saro: 2 });
  assert.strictEqual(sum.charactersUsed, 3);
});

test('계속 실패하면 난이도가 내려간다 (안티 프러스트레이션)', () => {
  const p = E.createProfile();
  for (let i = 0; i < 6; i++) {
    E.commitRun(p, runOf({ obstacles: 10, cleared: 1, tikitakaHits: 1, score: 5 }));
  }
  assert.ok(p.difficulty < 40, '난이도가 ' + p.difficulty);
  assert.ok(p.difficulty >= 10);
});

test('잘하면 난이도가 올라가되 한 판에 5를 넘지 않는다', () => {
  const p = E.createProfile();
  const before = p.difficulty;
  E.commitRun(p, runOf({ obstacles: 12, cleared: 12, tikitakaTries: 12, tikitakaHits: 12 }));
  assert.ok(Math.abs(p.difficulty - before) <= 5.0001);
});

test('캐릭터를 편중해 쓰면 숙련도가 덜 오른다', () => {
  const even = E.createProfile();
  const biased = E.createProfile();
  const base = { obstacles: 12, cleared: 12, tikitakaTries: 12, tikitakaHits: 12 };
  E.commitRun(even, runOf(Object.assign({}, base, { usage: { nubi: 4, wobi: 4, saro: 4 } })));
  E.commitRun(biased, runOf(Object.assign({}, base, { usage: { nubi: 12, wobi: 0, saro: 0 } })));
  assert.ok(even.skill > biased.skill, even.skill + ' vs ' + biased.skill);
});

/* --------------------------------------------------- 저장 데이터 안전성 */

test('손상된 저장 데이터에서도 안전한 프로필이 나온다', () => {
  const p = E.normalizeProfile({
    acorns: 'abc', difficulty: 900, leader: '없는캐릭터',
    metrics: { games: -5, usage: { nubi: 'x', 없는키: 9 }, recentSuccesses: [1, 'x', 5] }
  });
  assert.strictEqual(p.acorns, 0);
  assert.strictEqual(p.difficulty, 95);
  assert.strictEqual(p.leader, 'nubi');
  assert.strictEqual(p.metrics.games, 0);
  assert.deepStrictEqual(p.metrics.usage, { nubi: 0, wobi: 0, saro: 0 });
  assert.deepStrictEqual(p.metrics.recentSuccesses, [1, 1]);   // 범위 밖은 잘린다
});

test('빈 프로필도 그대로 열린다', () => {
  const p = E.normalizeProfile(null);
  assert.strictEqual(p.metrics.games, 0);
  assert.strictEqual(p.settings.assist, true);    // 저연령 보조는 기본 켜짐
});

test('저장소가 막혀도 게임이 죽지 않는다', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  const s = E.createStorage(broken);
  const p = s.load();
  assert.strictEqual(p.metrics.games, 0);
  s.save(p);                                       // 던지지 않아야 한다
  assert.strictEqual(typeof s.reset().acorns, 'number');
});

/* ------------------------------------------------------------ 데이터 정합 */

test('세 캐릭터가 서로 다른 장애물을 하나씩 맡는다', () => {
  const needs = E.OBSTACLES.map((o) => o.need).sort();
  const ids = E.CHARACTERS.map((c) => c.id).sort();
  assert.deepStrictEqual(needs, ids);
  E.CHARACTERS.forEach((c) => {
    assert.strictEqual(E.obstacleById(c.counters).need, c.id);
  });
});

test('모든 미션이 읽을 수 있는 지표를 가리킨다', () => {
  const run = runOf();
  E.MISSIONS.concat([E.TEAM_MISSION]).forEach((m) => {
    const v = E.missionProgress(m, run);
    assert.ok(Number.isFinite(v), m.id + ' 의 지표를 읽을 수 없다');
    assert.ok(m.text && m.target > 0 && m.reward > 0, m.id + ' 의 정의가 불완전하다');
  });
});
