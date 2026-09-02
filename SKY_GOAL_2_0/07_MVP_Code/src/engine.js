/*
 * SKY GOAL 2.0 — Adaptive Difficulty / Economy Engine
 * 순수 로직 모듈. DOM 의존성이 전혀 없으므로 브라우저와 Node 양쪽에서 동일하게 동작한다.
 * 브라우저: window.SkyGoalEngine
 * Node    : module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SkyGoalEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var STORAGE_KEY = 'sky_goal_2_0_profile_v1';

  /* ---------------------------------------------------------------- utils */

  function clamp(v, a, b) {
    if (!isFinite(v)) return a;
    return Math.max(a, Math.min(b, v));
  }

  // v를 [a,b] 구간에서 0~100으로 정규화한다.
  function norm(v, a, b) {
    if (b === a) return 0;
    return clamp(((v - a) / (b - a)) * 100, 0, 100);
  }

  function mean(list) {
    if (!list || !list.length) return 0;
    var s = 0;
    for (var i = 0; i < list.length; i++) s += list[i];
    return s / list.length;
  }

  // 변동계수(coefficient of variation) = 표준편차 / 평균
  function coefficientOfVariation(list) {
    if (!list || list.length < 2) return 0.25; // 표본 부족 시 기본값
    var m = mean(list);
    if (m <= 0) return 0.25;
    var acc = 0;
    for (var i = 0; i < list.length; i++) acc += Math.pow(list[i] - m, 2);
    return Math.sqrt(acc / list.length) / m;
  }

  function pushCapped(list, value, cap) {
    list.push(value);
    while (list.length > cap) list.shift();
    return list;
  }

  /* -------------------------------------------------------------- profile */

  function createProfile() {
    return {
      version: VERSION,
      playerId: 'local-player',
      skill: 50,
      difficulty: 50,
      level: 1,
      xp: 0,
      coins: 0,
      statPoints: 0,
      bestScore: 0,
      stats: { control: 50, power: 50, speed: 50, luck: 50, stamina: 50 },
      metrics: {
        games: 0,
        survivalTime: 0,
        passCount: 0,
        attemptCount: 0,
        maxCombo: 0,
        tapIntervalCV: 0.25,
        recentScores: [],
        recentSuccesses: [],
        perfectCount: 0,
        winStreak: 0,
        loseStreak: 0
      },
      inventory: { common: 0, rare: 0, epic: 0, legendary: 0 },
      lastRun: { score: 0, combo: 0, difficulty: 50, stage: 'DAY' }
    };
  }

  function num(v, fallback, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = fallback;
    if (min !== undefined) n = clamp(n, min, max);
    return n;
  }

  // 저장 데이터가 손상/구버전이어도 게임이 죽지 않도록 항상 안전한 프로필로 정규화한다.
  function normalizeProfile(raw) {
    var base = createProfile();
    if (!raw || typeof raw !== 'object') return base;

    var stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    var m = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};
    var inv = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
    var lr = raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : {};

    function numList(v, cap) {
      if (!Array.isArray(v)) return [];
      var out = [];
      for (var i = 0; i < v.length; i++) {
        var n = parseFloat(v[i]);
        if (isFinite(n)) out.push(n);
      }
      return out.slice(-cap);
    }

    return {
      version: VERSION,
      playerId: typeof raw.playerId === 'string' ? raw.playerId : base.playerId,
      skill: num(raw.skill, 50, 0, 100),
      difficulty: num(raw.difficulty, 50, 10, 95),
      level: Math.max(1, Math.floor(num(raw.level, 1, 1, 9999))),
      xp: Math.max(0, num(raw.xp, 0, 0, 1e12)),
      coins: Math.max(0, Math.floor(num(raw.coins, 0, 0, 1e12))),
      statPoints: Math.max(0, Math.floor(num(raw.statPoints, 0, 0, 9999))),
      bestScore: Math.max(0, Math.floor(num(raw.bestScore, 0, 0, 1e9))),
      stats: {
        control: num(stats.control, 50, 0, 100),
        power: num(stats.power, 50, 0, 100),
        speed: num(stats.speed, 50, 0, 100),
        luck: num(stats.luck, 50, 0, 100),
        stamina: num(stats.stamina, 50, 0, 100)
      },
      metrics: {
        games: Math.max(0, Math.floor(num(m.games, 0, 0, 1e9))),
        survivalTime: Math.max(0, num(m.survivalTime, 0, 0, 1e9)),
        passCount: Math.max(0, Math.floor(num(m.passCount, 0, 0, 1e9))),
        attemptCount: Math.max(0, Math.floor(num(m.attemptCount, 0, 0, 1e9))),
        maxCombo: Math.max(0, Math.floor(num(m.maxCombo, 0, 0, 1e9))),
        tapIntervalCV: num(m.tapIntervalCV, 0.25, 0, 5),
        recentScores: numList(m.recentScores, 10),
        recentSuccesses: numList(m.recentSuccesses, 10),
        perfectCount: Math.max(0, Math.floor(num(m.perfectCount, 0, 0, 1e9))),
        winStreak: Math.max(0, Math.floor(num(m.winStreak, 0, 0, 1e6))),
        loseStreak: Math.max(0, Math.floor(num(m.loseStreak, 0, 0, 1e6)))
      },
      inventory: {
        common: Math.max(0, Math.floor(num(inv.common, 0, 0, 1e9))),
        rare: Math.max(0, Math.floor(num(inv.rare, 0, 0, 1e9))),
        epic: Math.max(0, Math.floor(num(inv.epic, 0, 0, 1e9))),
        legendary: Math.max(0, Math.floor(num(inv.legendary, 0, 0, 1e9)))
      },
      lastRun: {
        score: Math.max(0, Math.floor(num(lr.score, 0, 0, 1e9))),
        combo: Math.max(0, Math.floor(num(lr.combo, 0, 0, 1e9))),
        difficulty: num(lr.difficulty, 50, 10, 95),
        stage: typeof lr.stage === 'string' ? lr.stage : 'DAY'
      }
    };
  }

  /* ------------------------------------------------------- skill / 난이도 */

  // 문서 2장: A(생존) / R(통과율) / C(콤보) / T(탭 안정성) / K(최근 점수)
  function skillComponents(profile) {
    var m = profile.metrics;
    var games = Math.max(1, m.games);
    var attempts = Math.max(1, m.attemptCount);
    return {
      A: norm(m.survivalTime / games, 2, 60),
      R: norm(m.passCount / attempts, 0.2, 9),          // 시도당 평균 통과 게이트 수
      C: norm(m.maxCombo, 1, 20),
      T: norm(1 / (1 + m.tapIntervalCV), 0.45, 0.9),
      K: norm(mean(m.recentScores), 0, 120)
    };
  }

  // S_t = 0.70*S_prev + 0.30*S_raw
  function computeSkill(profile) {
    var c = skillComponents(profile);
    var raw = 0.30 * c.A + 0.25 * c.R + 0.20 * c.C + 0.15 * c.T + 0.10 * c.K;
    return clamp(0.70 * profile.skill + 0.30 * raw, 0, 100);
  }

  // 문서 4장: D = clamp(0.85*S + 8 + F, 10, 95), 게임당 변화량 ±5 제한
  function computeDifficulty(profile, nextSkill, run) {
    var m = profile.metrics;
    var F = 0;
    var reasons = [];

    if (m.winStreak >= 3) { F += 5; reasons.push('3연속 성공 +5'); }
    if (m.loseStreak >= 3) { F -= 5; reasons.push('3연속 실패 -5'); }
    if (run && run.earlyDeath) { F -= 3; reasons.push('조기 사망 -3'); }
    if (run && run.combo >= 10) { F += 4; reasons.push('높은 콤보 +4'); }

    var recent = m.recentSuccesses.slice(-10);
    var rate = recent.length ? mean(recent) : 0.7;
    if (recent.length >= 3) {
      if (rate > 0.80) { F += 5; reasons.push('최근 성공률 > 80% +5'); }
      else if (rate < 0.65) { F -= 5; reasons.push('최근 성공률 < 65% -5'); }
      else { reasons.push('성공률 65~80% 유지'); }
    }

    var target = clamp(0.85 * nextSkill + 8 + F, 10, 95);
    var delta = clamp(target - profile.difficulty, -5, 5); // 급격한 난이도 점프 방지
    return {
      difficulty: clamp(profile.difficulty + delta, 10, 95),
      target: target,
      delta: delta,
      feedback: F,
      successRate: rate,
      reasons: reasons
    };
  }

  /* ---------------------------------------------------------------- stage */

  var STAGES = [
    { key: 'DAY',         label: 'DAY',         rain: 0,   wind: 0,   movement: 0.6 },
    { key: 'SUNSET',      label: 'SUNSET',      rain: 0,   wind: 0,   movement: 0.75 },
    { key: 'NIGHT',       label: 'NIGHT',       rain: 0,   wind: 0,   movement: 0.9 },
    { key: 'RAIN',        label: 'RAIN',        rain: 1,   wind: 0.2, movement: 1.0 },
    { key: 'WIND',        label: 'WIND',        rain: 0.3, wind: 1,   movement: 1.1 },
    { key: 'STORM',       label: 'STORM',       rain: 1,   wind: 1,   movement: 1.25 },
    { key: 'WORLD_FINAL', label: 'WORLD FINAL', rain: 0.6, wind: 0.8, movement: 1.35 }
  ];

  // 문서 3장: 진행도 구간이 기본 스테이지를 정하고, 난이도가 이를 가속한다.
  //   Stage = progressBand(통과한 골문 수) + floor(difficulty / 25)   (최대 WORLD FINAL)
  // 진행도 구간: 0~4 DAY / 5~9 SUNSET / 10~19 NIGHT / 20~29 RAIN / 30~49 WIND /
  //             50~79 STORM / 80+ WORLD FINAL
  // 점수가 아니라 "통과한 골문 수"를 쓰는 이유: 점수는 콤보·퍼펙트 보너스로
  // 골문 하나당 20점 이상 오르기 때문에 연출 단계가 몇 초 만에 끝나버린다.
  function progressBand(progress) {
    if (progress >= 80) return 6;
    if (progress >= 50) return 5;
    if (progress >= 30) return 4;
    if (progress >= 20) return 3;
    if (progress >= 10) return 2;
    if (progress >= 5) return 1;
    return 0;
  }

  function stageFor(progress, difficulty) {
    var v = Math.max(0, progress || 0);
    var idx = v >= 80
      ? STAGES.length - 1
      : progressBand(v) + Math.floor(clamp(difficulty, 0, 95) / 25);
    return STAGES[clamp(idx, 0, STAGES.length - 1)];
  }

  /* ------------------------------------------------------- arena / 물리값 */

  // 문서 5장 + 성장 스탯 보정
  function arenaParams(difficulty, stage, stats) {
    var d = clamp(difficulty, 10, 95);
    var s = stats || { control: 50, power: 50, speed: 50, luck: 50, stamina: 50 };
    var st = stage || STAGES[0];

    var gap = Math.max(145, 220 - 0.9 * d);
    var speed = 210 + 2.8 * d;
    var movement = 0.05 * d * st.movement;
    var wind = Math.max(0, (d - 35) / 60) * st.wind;

    // 스탯 보정: 과도한 이지 모드가 되지 않도록 전부 소폭(±10~20%)으로 제한한다.
    gap = gap * (1 + (s.control - 50) / 1000);            // CONTROL: 통과 여유
    speed = speed * (1 - (s.speed - 50) / 1000);          // SPEED  : 체감 속도
    movement = movement * (1 - (s.control - 50) / 500);   // CONTROL: 골문 흔들림 억제

    return {
      gap: clamp(gap, 130, 260),
      speed: clamp(speed, 180, 560),
      movement: Math.max(0, movement),
      wind: clamp(wind, 0, 1.2),
      rain: st.rain,
      gravity: 950 * (1 - (s.stamina - 50) / 1200),
      flap: -340 * (1 + (s.power - 50) / 800),
      perfectWindow: 0.12 + (s.control - 50) / 1000        // gap 대비 퍼펙트 판정 비율
    };
  }

  /* ------------------------------------------------------------- 점수/보상 */

  // PerfectBonus = 10 * (1 - error / (gap/2)), 0~10
  function perfectBonus(error, gap) {
    if (!(gap > 0)) return 0;
    return clamp(10 * (1 - Math.abs(error) / (gap / 2)), 0, 10);
  }

  // Score += 10 + 2*Combo + PerfectBonus
  function passScore(combo, error, gap) {
    return Math.round(10 + 2 * Math.max(0, combo) + perfectBonus(error, gap));
  }

  function coinReward(score) {
    return Math.round(10 + 25 * Math.log(Math.max(0, score) + 1));
  }

  function xpReward(score, perfectCount, difficulty) {
    var base = 20 + Math.max(0, score) * 1.5 + Math.max(0, perfectCount) * 5;
    return base * (1 + clamp(difficulty, 10, 95) / 200);
  }

  function xpRequired(level) {
    return 100 * Math.pow(Math.max(1, level), 1.5);
  }

  // Common 60 / Rare 25 / Epic 10 / Legendary 5, 고난도 시 Legendary 최대 12%
  function lootTable(difficulty, luck) {
    var d = clamp(difficulty, 10, 95);
    var l = clamp(luck === undefined ? 50 : luck, 0, 100);
    var legendary = clamp(5 + (d - 50) / 100 * 10 + (l - 50) / 50, 5, 12);
    var epic = 10;
    var rare = 25;
    var common = 100 - legendary - epic - rare;
    return { common: common, rare: rare, epic: epic, legendary: legendary };
  }

  function rollLoot(difficulty, luck, rng) {
    var t = lootTable(difficulty, luck);
    var r = (rng || Math.random)() * 100;
    if (r < t.legendary) return 'legendary';
    if (r < t.legendary + t.epic) return 'epic';
    if (r < t.legendary + t.epic + t.rare) return 'rare';
    return 'common';
  }

  function applyLevelUps(profile) {
    var gained = 0;
    var guard = 0;
    while (profile.xp >= xpRequired(profile.level) && guard++ < 10000) {
      profile.xp -= xpRequired(profile.level);
      profile.level += 1;
      profile.statPoints += 1;
      gained++;
    }
    return gained;
  }

  function spendStatPoint(profile, statName) {
    if (profile.statPoints <= 0) return false;
    if (!Object.prototype.hasOwnProperty.call(profile.stats, statName)) return false;
    if (profile.stats[statName] >= 100) return false;
    profile.stats[statName] = clamp(profile.stats[statName] + 2, 0, 100);
    profile.statPoints -= 1;
    return true;
  }

  /* ---------------------------------------------------------- 런 커밋 처리 */

  /**
   * 한 판이 끝났을 때 프로필을 갱신하고 결과 요약을 돌려준다.
   * run = { score, combo, passCount, perfectCount, duration, tapIntervals[], difficulty, stage }
   */
  function commitRun(profile, run, rng) {
    var m = profile.metrics;
    var score = Math.max(0, Math.round(run.score || 0));
    var combo = Math.max(0, Math.round(run.combo || 0));
    var duration = Math.max(0, run.duration || 0);
    var perfect = Math.max(0, Math.round(run.perfectCount || 0));
    var passes = Math.max(0, Math.round(run.passCount || 0));
    var success = score >= 10 ? 1 : 0;
    var earlyDeath = duration < 3 || passes === 0;

    m.games += 1;
    m.attemptCount += 1;
    m.survivalTime += duration;
    m.passCount += passes;
    m.perfectCount += perfect;
    m.maxCombo = Math.max(m.maxCombo, combo);
    if (run.tapIntervals && run.tapIntervals.length >= 2) {
      m.tapIntervalCV = coefficientOfVariation(run.tapIntervals);
    }
    pushCapped(m.recentScores, score, 10);
    pushCapped(m.recentSuccesses, success, 10);
    m.winStreak = success ? m.winStreak + 1 : 0;
    m.loseStreak = success ? 0 : m.loseStreak + 1;

    profile.bestScore = Math.max(profile.bestScore, score);

    var coins = coinReward(score);
    var xp = xpReward(score, perfect, run.difficulty !== undefined ? run.difficulty : profile.difficulty);
    profile.coins += coins;
    profile.xp += xp;
    var levelsGained = applyLevelUps(profile);

    var loot = rollLoot(
      run.difficulty !== undefined ? run.difficulty : profile.difficulty,
      profile.stats.luck,
      rng
    );
    profile.inventory[loot] += 1;

    var nextSkill = computeSkill(profile);
    profile.skill = nextSkill;
    var diff = computeDifficulty(profile, nextSkill, { combo: combo, earlyDeath: earlyDeath });
    var previousDifficulty = profile.difficulty;
    profile.difficulty = diff.difficulty;

    profile.lastRun = {
      score: score,
      combo: combo,
      difficulty: previousDifficulty,
      stage: run.stage || stageFor(passes, previousDifficulty).key
    };

    return {
      score: score,
      combo: combo,
      perfectCount: perfect,
      coins: coins,
      xp: xp,
      loot: loot,
      levelsGained: levelsGained,
      previousDifficulty: previousDifficulty,
      difficulty: profile.difficulty,
      difficultyDelta: profile.difficulty - previousDifficulty,
      skill: nextSkill,
      successRate: diff.successRate,
      reasons: diff.reasons,
      earlyDeath: earlyDeath
    };
  }

  /* -------------------------------------------------------------- storage */

  // localStorage 가 막힌 환경(file:// 시크릿 모드 등)에서도 게임이 죽지 않게 한다.
  function createStorage(backend) {
    var store = backend;
    if (store === undefined) {
      try {
        store = typeof localStorage !== 'undefined' ? localStorage : null;
        if (store) {
          store.setItem('__sg_probe__', '1');
          store.removeItem('__sg_probe__');
        }
      } catch (e) {
        store = null;
      }
    }
    var memory = {};
    return {
      persistent: !!store,
      load: function () {
        try {
          var raw = store ? store.getItem(STORAGE_KEY) : memory[STORAGE_KEY];
          return normalizeProfile(raw ? JSON.parse(raw) : null);
        } catch (e) {
          return createProfile();
        }
      },
      save: function (profile) {
        var payload = JSON.stringify(profile);
        try {
          if (store) store.setItem(STORAGE_KEY, payload);
          else memory[STORAGE_KEY] = payload;
          return true;
        } catch (e) {
          memory[STORAGE_KEY] = payload;
          return false;
        }
      },
      reset: function () {
        try {
          if (store) store.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }
        delete memory[STORAGE_KEY];
        return createProfile();
      }
    };
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    STAGES: STAGES,
    clamp: clamp,
    norm: norm,
    mean: mean,
    coefficientOfVariation: coefficientOfVariation,
    createProfile: createProfile,
    normalizeProfile: normalizeProfile,
    skillComponents: skillComponents,
    computeSkill: computeSkill,
    computeDifficulty: computeDifficulty,
    progressBand: progressBand,
    stageFor: stageFor,
    arenaParams: arenaParams,
    perfectBonus: perfectBonus,
    passScore: passScore,
    coinReward: coinReward,
    xpReward: xpReward,
    xpRequired: xpRequired,
    lootTable: lootTable,
    rollLoot: rollLoot,
    applyLevelUps: applyLevelUps,
    spendStatPoint: spendStatPoint,
    commitRun: commitRun,
    createStorage: createStorage
  };
});
