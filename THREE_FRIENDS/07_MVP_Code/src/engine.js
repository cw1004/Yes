/*
 * 세 친구의 여행 — 로직 엔진
 * DOM 의존성이 없다. 브라우저와 Node 에서 똑같이 동작한다.
 * 브라우저: window.FriendsEngine / Node: module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FriendsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '0.1.0';
  var STORAGE_KEY = 'three_friends_profile_v1';

  function clamp(v, a, b) {
    if (!isFinite(v)) return a;
    return Math.max(a, Math.min(b, v));
  }
  function mean(list) {
    if (!list || !list.length) return 0;
    var s = 0;
    for (var i = 0; i < list.length; i++) s += list[i];
    return s / list.length;
  }
  function pushCapped(list, v, cap) {
    list.push(v);
    while (list.length > cap) list.shift();
    return list;
  }
  function num(v, fallback, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = fallback;
    if (min !== undefined) n = clamp(n, min, max);
    return n;
  }

  /* ------------------------------------------------------------ 캐릭터 */

  /**
   * 세 명이 함께 걷고, 그중 한 명만 "리더"가 되어 행동한다.
   * 캐릭터마다 막을 수 있는 장애물이 다르기 때문에
   * 세 명을 다 쓰지 않으면 진행이 막힌다 — 3인조를 장식으로 두지 않기 위한 장치다.
   */
  var CHARACTERS = [
    { id: 'nubi', name: 'NUBI', ko: '누비', species: '아기 판다',
      action: 'jump', actionKo: '점프', counters: 'log',
      color: { body: '#f6f1e7', mark: '#2b2b33', cheek: '#ffb3ba', accent: '#3e8bff' } },
    { id: 'wobi', name: 'WOBI', ko: '워비', species: '아기 퍼핀',
      action: 'glide', actionKo: '활공', counters: 'gust',
      color: { body: '#2f3b52', mark: '#f6f7fb', cheek: '#ffb3ba', accent: '#ff8a3d' } },
    { id: 'saro', name: 'SARO', ko: '사로', species: '아기 다람쥐',
      action: 'spin', actionKo: '꼬리 회전', counters: 'gap',
      color: { body: '#d9813f', mark: '#f7e3c8', cheek: '#ffb3ba', accent: '#4fbf5a' } }
  ];

  function characterById(id) {
    for (var i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === id) return CHARACTERS[i];
    return CHARACTERS[0];
  }

  /* ---------------------------------------------------------- 장애물 */

  var OBSTACLES = [
    { id: 'log',  name: '쓰러진 통나무', need: 'nubi', hint: '뛰어넘어야 한다' },
    { id: 'gust', name: '돌풍',         need: 'wobi', hint: '바람을 타야 한다' },
    { id: 'gap',  name: '좁은 틈',      need: 'saro', hint: '꼬리로 빠져나가야 한다' }
  ];

  function obstacleById(id) {
    for (var i = 0; i < OBSTACLES.length; i++) if (OBSTACLES[i].id === id) return OBSTACLES[i];
    return OBSTACLES[0];
  }

  /* -------------------------------------------------------------- 난이도 */

  /**
   * 난이도 → 실제 수치.
   * 걷는 속도는 크게 올리지 않는다. 저연령이 따라가지 못하면 그 순간 게임이 끝난다.
   * 대신 장애물 간격과 티키타카 판정 폭을 좁혀 난이도를 만든다.
   */
  function params(difficulty) {
    var d = clamp(difficulty, 10, 95);
    return {
      difficulty: d,
      walkSpeed: 118 + 0.55 * d,            // px/s — 118 ~ 170
      obstacleGap: clamp(360 - 1.5 * d, 190, 360),
      reactWindow: clamp(1.25 - 0.006 * d, 0.60, 1.25),   // 장애물 대응 여유(초)
      tikitakaWindow: clamp(1.10 - 0.005 * d, 0.60, 1.10),
      tikitakaEvery: clamp(7.5 - 0.03 * d, 3.5, 7.5),     // 평균 몇 초마다 장난이 오는가
      acornRate: 1 + d / 200
    };
  }

  /**
   * 장애물 구성. **가장 적게 쓴 캐릭터가 막는 장애물의 비중을 올린다.**
   * 한 명만 쓰는 플레이어에게 "세 명을 다 써라"고 말로 가르치지 않고
   * 게임 구성으로 유도한다. 이 게임의 AI 파트 핵심이다.
   */
  function obstacleMix(usage, difficulty) {
    var u = usage || {};
    var counts = CHARACTERS.map(function (c) { return Math.max(0, u[c.id] || 0); });
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var weights = {};
    CHARACTERS.forEach(function (c, i) {
      if (total < 6) {                       // 표본이 적으면 고르게 낸다
        weights[c.counters] = 1;
        return;
      }
      var share = counts[i] / total;
      // 적게 쓸수록(share 가 1/3 보다 작을수록) 그 캐릭터의 장애물이 많이 나온다
      var w = 1 + (1 / 3 - share) * 2.4;
      weights[c.counters] = clamp(w, 0.45, 1.9);
    });
    // 난이도가 높을수록 편중 보정을 조금 더 세게 건다
    var k = 1 + clamp(difficulty, 10, 95) / 300;
    Object.keys(weights).forEach(function (key) {
      weights[key] = clamp(Math.pow(weights[key], k), 0.4, 2.0);
    });
    return weights;
  }

  function rollObstacle(usage, difficulty, rng) {
    var w = obstacleMix(usage, difficulty);
    var total = 0;
    OBSTACLES.forEach(function (o) { total += w[o.id]; });
    var r = (rng || Math.random)() * total;
    for (var i = 0; i < OBSTACLES.length; i++) {
      r -= w[OBSTACLES[i].id];
      if (r <= 0) return OBSTACLES[i];
    }
    return OBSTACLES[OBSTACLES.length - 1];
  }

  /* ------------------------------------------------------------ 티키타카 */

  var TIKITAKA = [
    { id: 'poke',   text: '콕 찌르기',   pair: ['nubi', 'saro'] },
    { id: 'tickle', text: '꼬리 간지럼', pair: ['saro', 'wobi'] },
    { id: 'mimic',  text: '흉내내기',   pair: ['wobi', 'nubi'] },
    { id: 'toss',   text: '도토리 던지기', pair: ['saro', 'nubi'] },
    { id: 'hold',   text: '손잡기',     pair: ['nubi', 'wobi'] }
  ];

  var TIKITAKA_BASE_MUL = 0.05;
  var TIKITAKA_CAP = 1.5;
  var PARADE_STREAK = 5;
  var PARADE_SECONDS = 6;

  function tikitakaMultiplier(successes, cap) {
    var limit = cap === undefined ? TIKITAKA_CAP : cap;
    return clamp(1 + TIKITAKA_BASE_MUL * Math.max(0, successes), 1, limit);
  }

  function rollTikitaka(rng) {
    var r = (rng || Math.random)();
    return TIKITAKA[Math.floor(r * TIKITAKA.length) % TIKITAKA.length];
  }

  /* -------------------------------------------------------------- 미션 */

  /**
   * 판 미션. 출발 전 3개를 뽑아 그 판에서 바로 달성한다.
   * 3개 중 최소 1개는 **세 캐릭터를 모두 써야 하는** 미션이 들어간다.
   * 튜토리얼 없이 리더 교체를 가르치는 가장 자연스러운 방법이다.
   */
  var MISSIONS = [
    { id: 'acorn120', metric: 'acorns',        target: 120, reward: 100, text: '도토리 120개 모으기' },
    { id: 'tiki5',    metric: 'tikitaka',      target: 5,   reward: 120, text: '티키타카 5회 성공' },
    { id: 'tiki12',   metric: 'tikitaka',      target: 12,  reward: 220, text: '티키타카 12회 성공' },
    { id: 'nubi3',    metric: 'cleared_nubi',  target: 3,   reward: 150, text: 'NUBI 로 통나무 3개 넘기' },
    { id: 'wobi3',    metric: 'cleared_wobi',  target: 3,   reward: 150, text: 'WOBI 로 돌풍 3번 타기' },
    { id: 'saro3',    metric: 'cleared_saro',  target: 3,   reward: 150, text: 'SARO 로 좁은 틈 3번 지나기' },
    { id: 'parade1',  metric: 'parades',       target: 1,   reward: 200, text: 'HAPPY PARADE 1회 발동' },
    { id: 'noMiss8',  metric: 'cleanStreak',   target: 8,   reward: 180, text: '실수 없이 장애물 8개 연속 통과' }
  ];

  // 세 명을 모두 써야 끝나는 미션 (반드시 한 개는 들어간다)
  var TEAM_MISSION = {
    id: 'allthree', metric: 'charactersUsed', target: 3, reward: 160,
    text: '세 친구를 모두 리더로 써 보기'
  };

  function missionById(id) {
    if (id === TEAM_MISSION.id) return TEAM_MISSION;
    for (var i = 0; i < MISSIONS.length; i++) if (MISSIONS[i].id === id) return MISSIONS[i];
    return null;
  }

  function rollMissions(rng, count) {
    var r = rng || Math.random;
    var n = Math.max(1, count || 3);
    var pool = MISSIONS.slice();
    var picked = [TEAM_MISSION];                 // 팀 미션은 고정으로 하나
    while (picked.length < n && pool.length) {
      var i = Math.floor(r() * pool.length) % pool.length;
      picked.push(pool.splice(i, 1)[0]);
    }
    return picked;
  }

  function missionProgress(mission, run) {
    if (!mission || !run) return 0;
    switch (mission.metric) {
      case 'acorns': return run.acorns || 0;
      case 'tikitaka': return run.tikitakaHits || 0;
      case 'parades': return run.parades || 0;
      case 'cleanStreak': return run.bestCleanStreak || 0;
      case 'charactersUsed': return Object.keys(run.usage || {}).filter(function (k) {
        return (run.usage[k] || 0) > 0;
      }).length;
      case 'cleared_nubi': return (run.clearedBy || {}).nubi || 0;
      case 'cleared_wobi': return (run.clearedBy || {}).wobi || 0;
      case 'cleared_saro': return (run.clearedBy || {}).saro || 0;
      default: return 0;
    }
  }

  function missionDone(mission, run) {
    return missionProgress(mission, run) >= mission.target;
  }

  /* -------------------------------------------------------------- 보상 */

  // 0점이어도 최소 8개는 준다. 실패한 판이 완전한 손실이 되면 다시 안 한다.
  function acornReward(score) {
    return Math.round(8 + 20 * Math.log(Math.max(0, score) + 1));
  }

  function runAcorns(run) {
    var base = acornReward(run.score || 0) + (run.acorns || 0);
    var bonus = 0;
    (run.missions || []).forEach(function (m) {
      if (missionDone(m, run)) bonus += m.reward;
    });
    var mul = tikitakaMultiplier(run.tikitakaHits || 0, run.tikitakaCap);
    return { base: base, missionBonus: bonus, multiplier: mul,
             total: Math.round((base + bonus) * mul) };
  }

  /* ------------------------------------------------------------ 프로필 */

  function createProfile() {
    return {
      version: VERSION,
      acorns: 0,
      starPieces: 0,
      bestScore: 0,
      difficulty: 40,                 // 첫 판은 조금 쉽게 연다
      skill: 45,
      leader: 'nubi',
      settings: { muted: false, assist: true },   // assist = 리더 자동 추천(저연령)
      metrics: {
        games: 0, distance: 0, obstacles: 0, cleared: 0,
        tikitakaTries: 0, tikitakaHits: 0, parades: 0,
        usage: { nubi: 0, wobi: 0, saro: 0 },
        recentSuccesses: []
      },
      lastRun: { score: 0, acorns: 0, tikitaka: 0 }
    };
  }

  function normalizeProfile(raw) {
    var base = createProfile();
    if (!raw || typeof raw !== 'object') return base;
    var m = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};
    var u = m.usage && typeof m.usage === 'object' ? m.usage : {};
    var st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var lr = raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : {};
    var usage = {};
    CHARACTERS.forEach(function (c) {
      usage[c.id] = Math.max(0, Math.floor(num(u[c.id], 0, 0, 1e9)));
    });
    var recent = [];
    if (Array.isArray(m.recentSuccesses)) {
      m.recentSuccesses.forEach(function (v) {
        var n = parseFloat(v);
        if (isFinite(n)) recent.push(clamp(n, 0, 1));
      });
    }
    var leader = characterById(raw.leader).id;
    return {
      version: VERSION,
      acorns: Math.max(0, Math.floor(num(raw.acorns, 0, 0, 1e12))),
      starPieces: Math.max(0, Math.floor(num(raw.starPieces, 0, 0, 1e9))),
      bestScore: Math.max(0, Math.floor(num(raw.bestScore, 0, 0, 1e9))),
      difficulty: num(raw.difficulty, 40, 10, 95),
      skill: num(raw.skill, 45, 0, 100),
      leader: leader,
      settings: { muted: st.muted === true, assist: st.assist !== false },
      metrics: {
        games: Math.max(0, Math.floor(num(m.games, 0, 0, 1e9))),
        distance: Math.max(0, num(m.distance, 0, 0, 1e12)),
        obstacles: Math.max(0, Math.floor(num(m.obstacles, 0, 0, 1e9))),
        cleared: Math.max(0, Math.floor(num(m.cleared, 0, 0, 1e9))),
        tikitakaTries: Math.max(0, Math.floor(num(m.tikitakaTries, 0, 0, 1e9))),
        tikitakaHits: Math.max(0, Math.floor(num(m.tikitakaHits, 0, 0, 1e9))),
        parades: Math.max(0, Math.floor(num(m.parades, 0, 0, 1e9))),
        usage: usage,
        recentSuccesses: recent.slice(-10)
      },
      lastRun: {
        score: Math.max(0, Math.floor(num(lr.score, 0, 0, 1e9))),
        acorns: Math.max(0, Math.floor(num(lr.acorns, 0, 0, 1e9))),
        tikitaka: Math.max(0, Math.floor(num(lr.tikitaka, 0, 0, 1e9)))
      }
    };
  }

  /* ------------------------------------------------------ 숙련도 / 난이도 */

  function computeSkill(profile) {
    var m = profile.metrics;
    var obstacleRate = m.obstacles > 0 ? m.cleared / m.obstacles : 0.6;
    var tikiRate = m.tikitakaTries > 0 ? m.tikitakaHits / m.tikitakaTries : 0.5;
    // 캐릭터를 고르게 쓰는가 — 편중되면 숙련도로 치지 않는다
    var counts = CHARACTERS.map(function (c) { return m.usage[c.id] || 0; });
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var balance = 0.5;
    if (total >= 6) {
      var ideal = total / 3;
      var dev = counts.reduce(function (a, n) { return a + Math.abs(n - ideal); }, 0) / (total * 2);
      balance = clamp(1 - dev, 0, 1);
    }
    var raw = 100 * (0.45 * obstacleRate + 0.35 * tikiRate + 0.20 * balance);
    return clamp(0.70 * profile.skill + 0.30 * raw, 0, 100);
  }

  // SKY GOAL 과 같은 안티 프러스트레이션 규칙을 쓴다.
  function computeDifficulty(profile, nextSkill) {
    var recent = profile.metrics.recentSuccesses.slice(-10);
    var rate = recent.length ? mean(recent) : 0.7;
    var F = 0;
    var reasons = [];
    if (recent.length >= 3) {
      if (rate > 0.80) { F += 5; reasons.push('최근 성공률 > 80% +5'); }
      else if (rate < 0.65) { F -= 5; reasons.push('최근 성공률 < 65% -5'); }
      else reasons.push('성공률 65~80% 유지');
    }
    var target = clamp(0.85 * nextSkill + 6 + F, 10, 95);
    var delta = clamp(target - profile.difficulty, -5, 5);
    return { difficulty: clamp(profile.difficulty + delta, 10, 95),
             delta: delta, successRate: rate, reasons: reasons };
  }

  /* ----------------------------------------------------------- 런 커밋 */

  function commitRun(profile, run) {
    var m = profile.metrics;
    var score = Math.max(0, Math.round(run.score || 0));
    var obstacles = Math.max(0, run.obstacles || 0);
    var cleared = Math.max(0, run.cleared || 0);

    m.games += 1;
    m.distance += Math.max(0, run.distance || 0);
    m.obstacles += obstacles;
    m.cleared += cleared;
    m.tikitakaTries += Math.max(0, run.tikitakaTries || 0);
    m.tikitakaHits += Math.max(0, run.tikitakaHits || 0);
    m.parades += Math.max(0, run.parades || 0);
    CHARACTERS.forEach(function (c) {
      m.usage[c.id] += Math.max(0, (run.usage || {})[c.id] || 0);
    });

    // "성공한 판"의 기준 — 장애물의 3분의 2 이상을 넘겼는가
    var success = obstacles === 0 ? 0 : (cleared / obstacles >= 0.66 ? 1 : 0);
    pushCapped(m.recentSuccesses, success, 10);

    var reward = runAcorns(run);
    profile.acorns += reward.total;
    profile.bestScore = Math.max(profile.bestScore, score);

    var nextSkill = computeSkill(profile);
    profile.skill = nextSkill;
    var diff = computeDifficulty(profile, nextSkill);
    var previous = profile.difficulty;
    profile.difficulty = diff.difficulty;

    var missions = (run.missions || []).map(function (mi) {
      return { id: mi.id, text: mi.text, target: mi.target,
               progress: missionProgress(mi, run), done: missionDone(mi, run),
               reward: mi.reward };
    });

    profile.lastRun = { score: score, acorns: reward.total, tikitaka: run.tikitakaHits || 0 };

    return {
      score: score,
      acorns: reward.total,
      acornBase: reward.base,
      missionBonus: reward.missionBonus,
      multiplier: reward.multiplier,
      tikitakaHits: run.tikitakaHits || 0,
      tikitakaTries: run.tikitakaTries || 0,
      parades: run.parades || 0,
      obstacles: obstacles,
      cleared: cleared,
      missions: missions,
      charactersUsed: missionProgress(TEAM_MISSION, run),
      previousDifficulty: previous,
      difficulty: profile.difficulty,
      difficultyDelta: profile.difficulty - previous,
      skill: nextSkill,
      successRate: diff.successRate,
      reasons: diff.reasons
    };
  }

  /* ------------------------------------------------------------ 저장소 */

  function createStorage(backend) {
    var store = backend;
    if (store === undefined) {
      try {
        store = typeof localStorage !== 'undefined' ? localStorage : null;
        if (store) { store.setItem('__tf__', '1'); store.removeItem('__tf__'); }
      } catch (e) { store = null; }
    }
    var memory = {};
    return {
      persistent: !!store,
      load: function () {
        try {
          var raw = store ? store.getItem(STORAGE_KEY) : memory[STORAGE_KEY];
          return normalizeProfile(raw ? JSON.parse(raw) : null);
        } catch (e) { return createProfile(); }
      },
      save: function (p) {
        var payload = JSON.stringify(p);
        try {
          if (store) store.setItem(STORAGE_KEY, payload);
          else memory[STORAGE_KEY] = payload;
          return true;
        } catch (e) { memory[STORAGE_KEY] = payload; return false; }
      },
      reset: function () {
        try { if (store) store.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        delete memory[STORAGE_KEY];
        return createProfile();
      }
    };
  }

  return {
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY,
    clamp: clamp, mean: mean,
    CHARACTERS: CHARACTERS, characterById: characterById,
    OBSTACLES: OBSTACLES, obstacleById: obstacleById,
    TIKITAKA: TIKITAKA, TIKITAKA_CAP: TIKITAKA_CAP,
    PARADE_STREAK: PARADE_STREAK, PARADE_SECONDS: PARADE_SECONDS,
    MISSIONS: MISSIONS, TEAM_MISSION: TEAM_MISSION, missionById: missionById,
    params: params, obstacleMix: obstacleMix, rollObstacle: rollObstacle,
    tikitakaMultiplier: tikitakaMultiplier, rollTikitaka: rollTikitaka,
    rollMissions: rollMissions, missionProgress: missionProgress, missionDone: missionDone,
    acornReward: acornReward, runAcorns: runAcorns,
    createProfile: createProfile, normalizeProfile: normalizeProfile,
    computeSkill: computeSkill, computeDifficulty: computeDifficulty,
    commitRun: commitRun, createStorage: createStorage
  };
});
