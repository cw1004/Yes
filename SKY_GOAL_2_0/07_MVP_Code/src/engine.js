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

  var VERSION = '1.1.0';
  var STORAGE_KEY = 'sky_goal_2_0_profile_v1';

  // 플레이어가 직접 조절하는 값의 하한. 화면의 슬라이더도 이 값에서 시작한다.
  var BALL_FINE_MIN = 20;    // 공 상하 미세 조정
  var SPEED_MIN = 30;        // 스피드

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

  /* ------------------------------------------------------------------ 모드 */

  /**
   * 두 가지 모드. AI 난이도 엔진은 그대로 쓰고, 그 위에 모드 보정을 곱한다.
   * 학습된 난이도(D)는 모드별로 따로 보관해서 서로 오염되지 않는다.
   */
  var MODES = {
    amateur: {
      id: 'amateur', label: '아마추어', tag: 'AMATEUR',
      desc: '기본 모드. AI 가 당신에게 맞춰 난이도를 조절합니다.',
      dOffset: 0, dMin: 10, dMax: 95,
      gap: 1.00, speed: 1.00, movement: 1.00, perfect: 1.00,
      reward: 1.00, startDifficulty: 50
    },
    pro: {
      id: 'pro', label: '프로', tag: 'PRO',
      desc: '골문은 좁고 빠르고 더 흔들립니다. 보상은 1.6배.',
      dOffset: 22, dMin: 35, dMax: 99,
      gap: 0.88, speed: 1.15, movement: 1.30, perfect: 0.72,
      reward: 1.60, startDifficulty: 62
    }
  };

  var DEFAULT_MODE = 'amateur';
  // 프로 모드 해금 조건 — 아마추어에서 실력을 보여야 열린다
  var PRO_UNLOCK = { bestScore: 200, clears: 1 };

  function modeParams(mode) {
    return MODES[mode] || MODES[DEFAULT_MODE];
  }

  function isModeUnlocked(profile, mode) {
    if (mode !== 'pro') return true;
    if (!profile) return false;
    var am = profile.modes && profile.modes.amateur;
    var best = am ? am.bestScore : 0;
    return best >= PRO_UNLOCK.bestScore || (profile.metrics.clears || 0) >= PRO_UNLOCK.clears;
  }

  function makeModeState(mode) {
    var m = modeParams(mode);
    return {
      skill: 50,
      difficulty: m.startDifficulty,
      bestScore: 0,
      recentScores: [],
      recentSuccesses: [],
      winStreak: 0,
      loseStreak: 0
    };
  }

  // 현재 모드의 상태를 프로필 최상위 필드로 꺼내 둔다(엔진·UI 가 그대로 쓰도록).
  function loadModeState(profile) {
    var st = profile.modes[profile.mode] || (profile.modes[profile.mode] = makeModeState(profile.mode));
    profile.skill = st.skill;
    profile.difficulty = st.difficulty;
    profile.bestScore = st.bestScore;
    profile.metrics.recentScores = st.recentScores.slice();
    profile.metrics.recentSuccesses = st.recentSuccesses.slice();
    profile.metrics.winStreak = st.winStreak;
    profile.metrics.loseStreak = st.loseStreak;
    return st;
  }

  function saveModeState(profile) {
    var st = profile.modes[profile.mode] || (profile.modes[profile.mode] = makeModeState(profile.mode));
    st.skill = profile.skill;
    st.difficulty = profile.difficulty;
    // 최고 점수는 절대 내려가지 않는다 (미러링 실수로 기록이 사라지지 않게)
    st.bestScore = Math.max(profile.bestScore || 0, st.bestScore || 0);
    profile.bestScore = st.bestScore;
    st.recentScores = profile.metrics.recentScores.slice();
    st.recentSuccesses = profile.metrics.recentSuccesses.slice();
    st.winStreak = profile.metrics.winStreak;
    st.loseStreak = profile.metrics.loseStreak;
    return st;
  }

  /** 모드 전환. 현재 진행 상태를 저장하고 새 모드 상태를 불러온다. */
  function setMode(profile, mode) {
    if (!MODES[mode]) return false;
    if (!isModeUnlocked(profile, mode)) return false;
    if (profile.mode === mode) return true;
    saveModeState(profile);
    profile.mode = mode;
    loadModeState(profile);
    return true;
  }

  /* ---------------------------------------------------------------- 공 종류 */

  /**
   * 5종의 공. 무게가 상하 운동을 바꾼다.
   *   weight  중력 배율 — 가벼울수록 높이 뜨고 천천히 떨어진다(체공↑)
   *   kick    탭 상승력 배율
   *   점프 높이 = (flap*kick)^2 / (2*gravity*weight) 이므로 공마다 실제로 다르다.
   * 디자인은 전부 독자 디자인이며 실제 브랜드를 모방하지 않는다.
   */
  var BALLS = [
    {
      id: 'street', name: '거리의 낡은 공', tag: 'STREET',
      desc: '소년의 첫 공. 무겁지도 가볍지도 않은 기준.',
      price: 0, weight: 1.00, kick: 1.00, coinBonus: 1.00, perfectBonus: 0,
      skin: { base: '#e8ddc8', patch: '#5b4632', accent: '#8a6a44', style: 'worn' }
    },
    {
      id: 'rubber', name: '고무공', tag: 'RUBBER',
      desc: '아주 가볍다. 높이 뜨고 천천히 떨어져 체공이 길다.',
      price: 300, weight: 0.78, kick: 0.96, coinBonus: 1.00, perfectBonus: 0,
      skin: { base: '#d8f24a', patch: '#5aa02c', accent: '#ffffff', style: 'glossy' }
    },
    {
      id: 'training', name: '훈련용 중량구', tag: 'TRAINING',
      desc: '묵직하다. 낮게 뜨고 빠르게 떨어져 반응이 민첩하다.',
      price: 800, weight: 1.30, kick: 1.12, coinBonus: 1.00, perfectBonus: 0,
      skin: { base: '#3b444f', patch: '#ff7a2f', accent: '#9aa7b4', style: 'heavy' }
    },
    {
      id: 'match', name: '공식 경기구', tag: 'MATCH',
      desc: '가장 균형 잡힌 공. 퍼펙트 판정이 조금 넓다.',
      price: 1500, weight: 0.94, kick: 1.02, coinBonus: 1.00, perfectBonus: 0.02,
      skin: { base: '#ffffff', patch: '#1f6fd0', accent: '#0f2a4a', style: 'panel' }
    },
    {
      id: 'gold2030', name: '2030 골든볼', tag: 'GOLD',
      desc: '가볍고 단단하다. 획득 코인이 15% 늘어난다.',
      price: 3000, weight: 0.88, kick: 1.06, coinBonus: 1.15, perfectBonus: 0.01,
      skin: { base: '#ffd77a', patch: '#b8791a', accent: '#fff3c9', style: 'gold' }
    }
  ];

  var DEFAULT_BALL = 'street';

  function ballById(id) {
    for (var i = 0; i < BALLS.length; i++) if (BALLS[i].id === id) return BALLS[i];
    return BALLS[0];
  }

  function selectedBall(profile) {
    if (!profile || !profile.balls) return BALLS[0];
    return ballById(profile.balls.selected);
  }

  function ownsBall(profile, id) {
    return !!(profile && profile.balls && profile.balls.owned.indexOf(id) >= 0);
  }

  /** 코인을 지불하고 공을 해금한다. { ok, reason } 을 돌려준다. */
  function buyBall(profile, id) {
    var ball = ballById(id);
    if (!profile || !profile.balls) return { ok: false, reason: 'no-profile' };
    if (ownsBall(profile, ball.id)) return { ok: false, reason: 'owned' };
    if (profile.coins < ball.price) return { ok: false, reason: 'coins', short: ball.price - profile.coins };
    profile.coins -= ball.price;
    profile.balls.owned.push(ball.id);
    profile.balls.selected = ball.id;
    return { ok: true, ball: ball };
  }

  function selectBall(profile, id) {
    if (!ownsBall(profile, id)) return false;
    profile.balls.selected = ballById(id).id;
    return true;
  }

  /* -------------------------------------------------------- 조각 / 장비 */

  /**
   * 등급 조각 → 장비.
   *
   * 기존 inventory{common,rare,epic,legendary} 카운터를 그대로 "조각"으로 쓴다.
   * 저장 구조를 바꾸지 않으므로 지금까지 쌓인 수치가 손실 없이 이어진다.
   *
   * 슬롯은 3개(부츠·암밴드·부적)이고 슬롯마다 등급별로 1종씩 있다.
   * 랜덤 뽑기가 아니라 **조각을 모아 원하는 것을 지정 해금**한다.
   * 확률형 아이템 규제를 피하려는 목적도 있지만, 그보다
   * "모으면 반드시 받는다"가 더 강한 동기이기 때문이다.
   */
  var RARITIES = ['common', 'rare', 'epic', 'legendary'];
  var RARITY_LABEL = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };
  var CRAFT_COST = { common: 5, rare: 8, epic: 12, legendary: 15 };
  var DUST_VALUE = { common: 20, rare: 60, epic: 150, legendary: 400 };

  // 장비 보정의 상한. 스탯(±10~20%)·공 보정과 겹쳐도 게임이 무너지지 않게 잠근다.
  var GEAR_REWARD_CAP = 1.30;     // 코인·XP 는 최대 +30%
  var GEAR_PHYSICS_CAP = 0.15;    // 물리 보정은 ±15%
  var EARLY_GATES = 5;            // "초반"으로 보는 골문 수

  var GEAR_SLOTS = [
    { id: 'boots', tag: 'BOOTS', label: '부츠',   theme: '물리 · 조작' },
    { id: 'band',  tag: 'BAND',  label: '암밴드', theme: '보상 · 성장' },
    { id: 'charm', tag: 'CHARM', label: '부적',   theme: '확률 · 안전' }
  ];

  var GEAR = [
    /* 부츠 — 물리 · 조작 */
    { id: 'boots_practice', slot: 'boots', rarity: 'common', name: '연습장 부츠',
      desc: '닳았지만 발에 익었다.', spec: '탭 상승력 +3%',
      mod: { flap: 1.03 } },
    { id: 'boots_mid', slot: 'boots', rarity: 'rare', name: '미드필더 부츠',
      desc: '중앙을 넓게 보는 사람의 신발.', spec: '퍼펙트 판정 +6%',
      mod: { perfect: 1.06 } },
    { id: 'boots_striker', slot: 'boots', rarity: 'epic', name: '스트라이커 부츠',
      desc: '한 번의 정확함이 더 크게 돌아온다.', spec: '퍼펙트마다 점수 +3',
      mod: { perfectScore: 3 } },
    { id: 'boots_silver30', slot: 'boots', rarity: 'legendary', name: '2030 실버 부츠',
      desc: '연속된 정확함이 흐름이 된다.', spec: '퍼펙트 2연속마다 COMBO +1',
      mod: { comboPerTwoPerfect: true } },

    /* 암밴드 — 보상 · 성장 */
    { id: 'band_cloth', slot: 'band', rarity: 'common', name: '천 암밴드',
      desc: '땀을 닦던 낡은 천.', spec: '코인 +5%',
      mod: { coin: 1.05 } },
    { id: 'band_captain', slot: 'band', rarity: 'rare', name: '주장 완장',
      desc: '앞에서 뛰는 사람의 표식.', spec: 'XP +10%',
      mod: { xp: 1.10 } },
    { id: 'band_ribbon', slot: 'band', rarity: 'epic', name: '응원단 리본',
      desc: '관중이 뜨거울수록 힘이 난다.', spec: '응원 최고조에 통과하면 코인 +20%',
      mod: { hotCoin: 0.20 } },
    { id: 'band_captain30', slot: 'band', rarity: 'legendary', name: '2030 캡틴 완장',
      desc: '흐름을 오래 쥔 사람에게 주어진다.', spec: 'COMBO 10 이상이면 코인·XP +25%',
      mod: { comboCoin: 0.25, comboXp: 0.25 } },

    /* 부적 — 확률 · 안전 */
    { id: 'charm_clover', slot: 'charm', rarity: 'common', name: '잔디 클로버',
      desc: '경기장 구석에서 주웠다.', spec: 'LUCK +3',
      mod: { luckAdd: 3 } },
    { id: 'charm_whistle', slot: 'charm', rarity: 'rare', name: '낡은 호루라기',
      desc: '첫 휘슬은 언제나 느긋했다.', spec: '첫 ' + EARLY_GATES + '골문 동안 난이도 -3',
      mod: { earlyRelief: 3 } },
    { id: 'charm_gloves', slot: 'charm', rarity: 'epic', name: '골키퍼 장갑',
      desc: '한 번은 막아 준다.', spec: '기둥 충돌 1회 무효 (판당 1회)',
      mod: { blockHits: 1 } },
    { id: 'charm_golden30', slot: 'charm', rarity: 'legendary', name: '2030 골든 휘슬',
      desc: '경기는 아직 끝나지 않았다.', spec: '사망 시 1회 부활 · COMBO 절반 유지',
      mod: { save: 'whistle' } }
  ];

  /**
   * 소모품. 경기 전에 하나만 고르고, 조건이 되면 자동으로 발동한다.
   * 원버튼 게임에 "사용 버튼"을 만들지 않기 위한 설계다 —
   * 두 번째 버튼이 생기는 순간 이 게임의 조작이 무너진다.
   */
  var CONSUMABLES = [
    { id: 'cons_drink', rarity: 'common', price: 80, name: '워밍업 드링크',
      desc: '몸이 풀릴 때까지는 여유가 있다.', spec: '첫 ' + EARLY_GATES + '골문 간격 +12%',
      mod: { earlyGap: 1.12 } },
    { id: 'cons_taping', rarity: 'common', price: 150, name: '테이핑',
      desc: '한 번의 실수는 없던 일로.', spec: '첫 사망 시 되감기 1회 (COMBO 유지)',
      mod: { save: 'taping' } },
    { id: 'cons_scout', rarity: 'rare', price: 300, name: '스카우팅 리포트',
      desc: '골문이 어떻게 움직이는지 안다.', spec: '골문 흔들림 -30%',
      mod: { wobble: 0.70 } },
    { id: 'cons_home', rarity: 'epic', price: 600, name: '홈 어드밴티지',
      desc: '홈 관중 앞에서는 모든 게 커진다.', spec: '코인 · XP +40%',
      mod: { coin: 1.40, xp: 1.40 } }
  ];

  function gearById(id) {
    for (var i = 0; i < GEAR.length; i++) if (GEAR[i].id === id) return GEAR[i];
    return null;
  }

  function consumableById(id) {
    for (var i = 0; i < CONSUMABLES.length; i++) if (CONSUMABLES[i].id === id) return CONSUMABLES[i];
    return null;
  }

  function gearBySlot(slot) {
    var out = [];
    for (var i = 0; i < GEAR.length; i++) if (GEAR[i].slot === slot) out.push(GEAR[i]);
    return out;
  }

  function ownsGear(profile, id) {
    return !!(profile && profile.gear && profile.gear.owned.indexOf(id) >= 0);
  }

  function craftCost(id) {
    var g = gearById(id);
    return g ? CRAFT_COST[g.rarity] : 0;
  }

  /** 조각을 지불하고 장비를 만든다. 만들면 해당 슬롯에 바로 장착된다. */
  function craftGear(profile, id) {
    var g = gearById(id);
    if (!profile || !profile.gear) return { ok: false, reason: 'no-profile' };
    if (!g) return { ok: false, reason: 'unknown' };
    if (ownsGear(profile, id)) return { ok: false, reason: 'owned' };
    var cost = CRAFT_COST[g.rarity];
    var have = profile.inventory[g.rarity] || 0;
    if (have < cost) return { ok: false, reason: 'shards', short: cost - have, cost: cost };
    profile.inventory[g.rarity] = have - cost;
    profile.gear.owned.push(g.id);
    profile.gear.equipped[g.slot] = g.id;           // 만든 것은 바로 쓰게 한다
    return { ok: true, gear: g, cost: cost };
  }

  function equipGear(profile, id) {
    var g = gearById(id);
    if (!g || !ownsGear(profile, id)) return false;
    profile.gear.equipped[g.slot] = g.id;
    return true;
  }

  function unequipGear(profile, slot) {
    if (!profile || !profile.gear) return false;
    if (!Object.prototype.hasOwnProperty.call(profile.gear.equipped, slot)) return false;
    profile.gear.equipped[slot] = null;
    return true;
  }

  /** 남는 조각을 코인으로 바꾼다. 중복 등급의 출구가 없으면 조각이 죽은 자원이 된다. */
  function dustShards(profile, rarity, count) {
    if (!profile || RARITIES.indexOf(rarity) < 0) return { ok: false, reason: 'unknown' };
    var n = Math.max(1, Math.floor(count || 1));
    var have = profile.inventory[rarity] || 0;
    if (have < n) return { ok: false, reason: 'shards', short: n - have };
    profile.inventory[rarity] = have - n;
    var coins = DUST_VALUE[rarity] * n;
    profile.coins += coins;
    return { ok: true, coins: coins, count: n, rarity: rarity };
  }

  /* ------------------------------------------------------------- 소모품 */

  function consumableStock(profile, id) {
    if (!profile || !profile.consumables) return 0;
    return Math.max(0, profile.consumables.stock[id] || 0);
  }

  function buyConsumable(profile, id, count) {
    var c = consumableById(id);
    if (!profile || !profile.consumables) return { ok: false, reason: 'no-profile' };
    if (!c) return { ok: false, reason: 'unknown' };
    var n = Math.max(1, Math.floor(count || 1));
    var price = c.price * n;
    if (profile.coins < price) return { ok: false, reason: 'coins', short: price - profile.coins };
    profile.coins -= price;
    profile.consumables.stock[id] = consumableStock(profile, id) + n;
    if (!profile.consumables.selected) profile.consumables.selected = id;
    return { ok: true, consumable: c, count: n, price: price };
  }

  /** 경기 전 슬롯에 올린다. null 이면 아무것도 쓰지 않는다. */
  function selectConsumable(profile, id) {
    if (!profile || !profile.consumables) return false;
    if (id === null) { profile.consumables.selected = null; return true; }
    if (!consumableById(id) || consumableStock(profile, id) <= 0) return false;
    profile.consumables.selected = id;
    return true;
  }

  function selectedConsumable(profile) {
    if (!profile || !profile.consumables) return null;
    var id = profile.consumables.selected;
    if (!id || consumableStock(profile, id) <= 0) return null;
    return consumableById(id);
  }

  /**
   * 한 판을 시작하며 소모품을 실제로 소비한다.
   * 소비된 소모품 객체를 돌려주고, 재고가 떨어지면 슬롯을 비운다.
   */
  function consumeSelected(profile) {
    var c = selectedConsumable(profile);
    if (!c) return null;
    profile.consumables.stock[c.id] = consumableStock(profile, c.id) - 1;
    if (profile.consumables.stock[c.id] <= 0) {
      delete profile.consumables.stock[c.id];
      profile.consumables.selected = null;
    }
    return c;
  }

  /* ----------------------------------------------------------- 보정 집계 */

  function neutralMods() {
    return {
      flap: 1, perfect: 1, gap: 1, wobble: 1,
      perfectScore: 0, comboPerTwoPerfect: false,
      luckAdd: 0, blockHits: 0, save: null, earlyRelief: 0,
      gearCoin: 1, gearXp: 1, hotCoin: 0, comboCoin: 0, comboXp: 0,
      snackCoin: 1, snackXp: 1,
      equipped: [], snack: null, early: false
    };
  }

  function capPhysics(v) {
    return clamp(v, 1 - GEAR_PHYSICS_CAP, 1 + GEAR_PHYSICS_CAP);
  }

  /**
   * 장착 장비 + 소모품을 하나의 보정 객체로 집계한다.
   * **보정 계산은 전부 여기 한 곳에서만 한다.** 여러 곳에 흩어지면
   * 상한을 지키는지 아무도 확인할 수 없게 된다.
   *
   * opts = { early: 초반 골문 구간인가, snack: 이번 판에 소비된 소모품 }
   */
  function runMods(profile, opts) {
    var o = opts || {};
    var m = neutralMods();
    m.early = !!o.early;

    if (profile && profile.gear) {
      for (var i = 0; i < GEAR_SLOTS.length; i++) {
        var g = gearById(profile.gear.equipped[GEAR_SLOTS[i].id]);
        if (!g || !ownsGear(profile, g.id)) continue;
        var d = g.mod;
        m.equipped.push(g);
        if (d.flap) m.flap *= d.flap;
        if (d.perfect) m.perfect *= d.perfect;
        if (d.coin) m.gearCoin *= d.coin;
        if (d.xp) m.gearXp *= d.xp;
        if (d.perfectScore) m.perfectScore += d.perfectScore;
        if (d.comboPerTwoPerfect) m.comboPerTwoPerfect = true;
        if (d.luckAdd) m.luckAdd += d.luckAdd;
        if (d.blockHits) m.blockHits += d.blockHits;
        if (d.hotCoin) m.hotCoin += d.hotCoin;
        if (d.comboCoin) m.comboCoin += d.comboCoin;
        if (d.comboXp) m.comboXp += d.comboXp;
        if (d.earlyRelief) m.earlyRelief += d.earlyRelief;
        if (d.save) m.save = d.save;
      }
    }

    // 장비만의 물리 보정을 먼저 ±15% 안으로 잠근다.
    m.flap = capPhysics(m.flap);
    m.perfect = capPhysics(m.perfect);

    // 소모품은 그 위에 곱해진다. 한 판에 한 번 쓰고 사라지는 값이라
    // 장비와 같은 상한을 걸면 의미가 없어진다.
    var snack = o.snack || null;
    if (snack) {
      m.snack = snack;
      var s = snack.mod;
      if (s.wobble) m.wobble *= s.wobble;
      if (s.coin) m.snackCoin *= s.coin;
      if (s.xp) m.snackXp *= s.xp;
      if (s.earlyGap && m.early) m.gap *= s.earlyGap;
      // 부활류는 판당 1회. 골든 휘슬(장비)이 있으면 그쪽이 우선한다.
      if (s.save && !m.save) m.save = s.save;
    }

    m.blockHits = Math.min(1, m.blockHits);          // 충돌 무효도 판당 1회
    return m;
  }

  /** 부활 규칙. PRO 모드에서는 기록 공정성을 위해 전부 비활성이다. */
  function saveRule(mods, mode) {
    if (!mods || !mods.save) return null;
    if (mode === 'pro') return null;
    if (mods.save === 'whistle') return { kind: 'whistle', comboKeep: 0.5, label: '2030 골든 휘슬' };
    return { kind: 'taping', comboKeep: 1, label: '테이핑' };
  }

  /**
   * 골문 하나를 통과했을 때의 점수와 퍼펙트 여부.
   * 퍼펙트 판정을 엔진 안으로 들여와야 "퍼펙트마다 +3" 같은 보정을
   * 화면 코드가 아니라 엔진에서 일관되게 계산할 수 있다.
   */
  function passResult(combo, error, gap, perfectWindow, mods) {
    var perfect = Math.abs(error) <= gap * (perfectWindow || 0);
    var bonus = perfect && mods ? (mods.perfectScore || 0) : 0;
    return { score: passScore(combo, error, gap) + bonus, perfect: perfect };
  }

  /**
   * 이번 판의 코인·XP 배율.
   * 장비 몫을 먼저 +30% 안으로 잠그고, 그 위에 소모품을 곱한다.
   * run = { passCount, hotPasses, combo }
   */
  function rewardMultipliers(mods, run) {
    var m = mods || neutralMods();
    var r = run || {};
    var passes = Math.max(0, r.passCount || 0);
    var hot = clamp(passes > 0 ? (r.hotPasses || 0) / passes : 0, 0, 1);
    var combo = Math.max(0, r.combo || 0);

    var coin = m.gearCoin * (1 + m.hotCoin * hot);
    var xp = m.gearXp;
    if (combo >= 10) {
      coin *= 1 + m.comboCoin;
      xp *= 1 + m.comboXp;
    }
    return {
      coin: clamp(coin, 1, GEAR_REWARD_CAP) * m.snackCoin,
      xp: clamp(xp, 1, GEAR_REWARD_CAP) * m.snackXp,
      hotRatio: hot
    };
  }

  /* -------------------------------------------------------------- profile */

  function createProfile() {
    return {
      version: VERSION,
      playerId: 'local-player',
      mode: DEFAULT_MODE,
      modes: { amateur: makeModeState('amateur'), pro: makeModeState('pro') },
      skill: 50,
      difficulty: 50,
      level: 1,
      xp: 0,
      coins: 0,
      statPoints: 0,
      bestScore: 0,
      settings: { muted: false, ballFine: BALL_FINE_MIN, speed: SPEED_MIN },
      balls: { owned: [DEFAULT_BALL], selected: DEFAULT_BALL },
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
        loseStreak: 0,
        clears: 0
      },
      // inventory 는 등급별 "조각" 보유량이다 (장비 제작 재료).
      inventory: { common: 0, rare: 0, epic: 0, legendary: 0 },
      gear: { owned: [], equipped: { boots: null, band: null, charm: null } },
      consumables: { stock: {}, selected: null },
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
  // 보유 공 목록을 실제 존재하는 id 로만 정리한다 (기본 공은 항상 포함).
  function normalizeBalls(raw) {
    var owned = [DEFAULT_BALL];
    var list = raw && Array.isArray(raw.owned) ? raw.owned : [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      for (var b = 0; b < BALLS.length; b++) {
        if (BALLS[b].id === id && owned.indexOf(id) < 0) owned.push(id);
      }
    }
    var selected = raw && typeof raw.selected === 'string' ? raw.selected : DEFAULT_BALL;
    if (owned.indexOf(selected) < 0) selected = DEFAULT_BALL;
    return { owned: owned, selected: selected };
  }

  // 보유 장비를 실제 존재하는 id 로만 정리하고, 장착 칸은 보유한 것만 남긴다.
  function normalizeGear(raw) {
    var owned = [];
    var list = raw && Array.isArray(raw.owned) ? raw.owned : [];
    for (var i = 0; i < list.length; i++) {
      var g = gearById(list[i]);
      if (g && owned.indexOf(g.id) < 0) owned.push(g.id);
    }
    var eqRaw = raw && raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : {};
    var equipped = {};
    for (var k = 0; k < GEAR_SLOTS.length; k++) {
      var slot = GEAR_SLOTS[k].id;
      var item = gearById(eqRaw[slot]);
      equipped[slot] = (item && item.slot === slot && owned.indexOf(item.id) >= 0) ? item.id : null;
    }
    return { owned: owned, equipped: equipped };
  }

  function normalizeConsumables(raw) {
    var stockRaw = raw && raw.stock && typeof raw.stock === 'object' ? raw.stock : {};
    var stock = {};
    for (var i = 0; i < CONSUMABLES.length; i++) {
      var id = CONSUMABLES[i].id;
      var n = Math.max(0, Math.floor(num(stockRaw[id], 0, 0, 1e6)));
      if (n > 0) stock[id] = n;
    }
    var sel = raw && typeof raw.selected === 'string' ? raw.selected : null;
    if (!sel || !stock[sel]) sel = null;
    return { stock: stock, selected: sel };
  }

  function normalizeProfile(raw) {
    var base = createProfile();
    if (!raw || typeof raw !== 'object') return base;

    var stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    var m = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {};
    var inv = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
    var lr = raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : {};
    var settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var rawModes = raw.modes && typeof raw.modes === 'object' ? raw.modes : {};

    function numList(v, cap) {
      if (!Array.isArray(v)) return [];
      var out = [];
      for (var i = 0; i < v.length; i++) {
        var n = parseFloat(v[i]);
        if (isFinite(n)) out.push(n);
      }
      return out.slice(-cap);
    }
    var balls = raw.balls && typeof raw.balls === 'object' ? raw.balls : {};

    // 구버전 프로필(모드 개념이 없던 시절)은 최상위 값을 아마추어 모드로 이어받는다.
    // 이 처리가 없으면 기존 플레이어의 최고 점수와 학습된 난이도가 초기화된다.
    var legacy = !rawModes.amateur && !rawModes.pro;

    function modeState(key) {
      var src = rawModes[key] && typeof rawModes[key] === 'object' ? rawModes[key] : {};
      if (legacy && key === 'amateur') {
        src = {
          skill: raw.skill,
          difficulty: raw.difficulty,
          bestScore: raw.bestScore,
          recentScores: m.recentScores,
          recentSuccesses: m.recentSuccesses,
          winStreak: m.winStreak,
          loseStreak: m.loseStreak
        };
      }
      var def = makeModeState(key);
      return {
        skill: num(src.skill, def.skill, 0, 100),
        difficulty: num(src.difficulty, def.difficulty, 10, 99),
        bestScore: Math.max(0, Math.floor(num(src.bestScore, 0, 0, 1e9))),
        recentScores: numList(src.recentScores, 10),
        recentSuccesses: numList(src.recentSuccesses, 10),
        winStreak: Math.max(0, Math.floor(num(src.winStreak, 0, 0, 1e6))),
        loseStreak: Math.max(0, Math.floor(num(src.loseStreak, 0, 0, 1e6)))
      };
    }

    return {
      version: VERSION,
      playerId: typeof raw.playerId === 'string' ? raw.playerId : base.playerId,
      mode: MODES[raw.mode] ? raw.mode : DEFAULT_MODE,
      modes: { amateur: modeState('amateur'), pro: modeState('pro') },
      skill: num(raw.skill, 50, 0, 100),
      difficulty: num(raw.difficulty, 50, 10, 95),
      level: Math.max(1, Math.floor(num(raw.level, 1, 1, 9999))),
      xp: Math.max(0, num(raw.xp, 0, 0, 1e12)),
      coins: Math.max(0, Math.floor(num(raw.coins, 0, 0, 1e12))),
      statPoints: Math.max(0, Math.floor(num(raw.statPoints, 0, 0, 9999))),
      bestScore: Math.max(0, Math.floor(num(raw.bestScore, 0, 0, 1e9))),
      settings: {
        muted: settings.muted === true,
        ballFine: num(settings.ballFine, BALL_FINE_MIN, BALL_FINE_MIN, 100),
        speed: num(settings.speed, SPEED_MIN, SPEED_MIN, 100)
      },
      balls: normalizeBalls(balls),
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
        loseStreak: Math.max(0, Math.floor(num(m.loseStreak, 0, 0, 1e6))),
        clears: Math.max(0, Math.floor(num(m.clears, 0, 0, 1e9)))
      },
      inventory: {
        common: Math.max(0, Math.floor(num(inv.common, 0, 0, 1e9))),
        rare: Math.max(0, Math.floor(num(inv.rare, 0, 0, 1e9))),
        epic: Math.max(0, Math.floor(num(inv.epic, 0, 0, 1e9))),
        legendary: Math.max(0, Math.floor(num(inv.legendary, 0, 0, 1e9)))
      },
      gear: normalizeGear(raw.gear),
      consumables: normalizeConsumables(raw.consumables),
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

  /**
   * 설정 슬라이더 → 물리 배율.
   *   ballFine 20~100 → response 0.80~1.30
   *     중력을 response^2, 탭 상승력을 response 배 하므로 **점프 높이는 그대로**이고
   *     오르내리는 속도(반응성)만 바뀐다. 값이 클수록 민첩하고 촘촘하게 조작된다.
   *   speed 30~100 → 스크롤 속도 0.70~1.30 배
   */
  function tuningFactors(settings) {
    var t = settings || {};
    var fine = clamp(num(t.ballFine, BALL_FINE_MIN, BALL_FINE_MIN, 100), BALL_FINE_MIN, 100);
    var spd = clamp(num(t.speed, SPEED_MIN, SPEED_MIN, 100), SPEED_MIN, 100);
    return {
      ballFine: fine,
      speed: spd,
      response: 0.80 + ((fine - BALL_FINE_MIN) / (100 - BALL_FINE_MIN)) * 0.50,
      speedMul: 0.70 + ((spd - SPEED_MIN) / (100 - SPEED_MIN)) * 0.60
    };
  }

  // 문서 5장 + 성장 스탯 보정
  function arenaParams(difficulty, stage, stats, settings, ball, mode, mods) {
    var gm = mods || neutralMods();
    var d = clamp(difficulty, 10, 95);
    var s = stats || { control: 50, power: 50, speed: 50, luck: 50, stamina: 50 };
    var st = stage || STAGES[0];
    var tune = tuningFactors(settings);
    var b = ball && ball.weight ? ball : BALLS[0];
    var M = modeParams(mode);
    d = clamp(d + M.dOffset, M.dMin, M.dMax);         // 모드가 난이도 밴드를 올린다

    var gap = Math.max(145, 220 - 0.9 * d) * M.gap;
    var speed = (210 + 2.8 * d) * M.speed;
    var movement = 0.05 * d * st.movement * M.movement;
    var wind = Math.max(0, (d - 35) / 60) * st.wind;

    // 스탯 보정: 과도한 이지 모드가 되지 않도록 전부 소폭(±10~20%)으로 제한한다.
    gap = gap * (1 + (s.control - 50) / 1000);            // CONTROL: 통과 여유
    speed = speed * (1 - (s.speed - 50) / 1000);          // SPEED  : 체감 속도
    movement = movement * (1 - (s.control - 50) / 500);   // CONTROL: 골문 흔들림 억제

    // 플레이어 설정은 AI 가 정한 값 위에 곱해지는 개인 취향 보정이다.
    // 느리게 맞춰 두면 성적이 올라가고, 그만큼 AI 가 난이도를 올려 균형이 맞는다.
    speed = clamp(speed, 180, 560) * tune.speedMul;
    // 공의 무게가 상하 운동을 바꾼다. 가벼운 공은 높이 뜨고 천천히 떨어진다.
    var gravity = 950 * (1 - (s.stamina - 50) / 1200) * tune.response * tune.response * b.weight;
    var flap = -340 * (1 + (s.power - 50) / 800) * tune.response * b.kick * gm.flap;

    // 장비·소모품 보정 (집계는 runMods 한 곳에서만 한다)
    gap = gap * gm.gap;
    movement = movement * gm.wobble;

    // 골문은 난이도가 낮아도 항상 살짝 오르내린다 (14~42px).
    // 골문 하나가 화면을 가로지르는 2~3초 안에 눈에 띄어야 하므로
    // 하한을 여유 있게 잡는다.
    var bob = clamp(movement * 14, 14, 42);

    return {
      gap: clamp(gap, M.id === 'pro' ? 118 : 130, 260),
      speed: clamp(speed, 140, 660),
      movement: Math.max(0, movement),
      bob: bob,
      wind: clamp(wind, 0, 1.2),
      rain: st.rain,
      gravity: gravity,
      flap: flap,
      perfectWindow: (0.12 + (s.control - 50) / 1000 + (b.perfectBonus || 0)) * M.perfect * gm.perfect,
      tuning: tune,
      ball: b,
      mode: M.id,
      mods: gm
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

  /* ------------------------------------------------------------ 완주 보상 */

  // 마지막 스테이지(WORLD FINAL)에 도달하면 "완주"로 본다.
  var CLEAR_STAGE = 'WORLD_FINAL';
  var CLEAR_COINS = 1000;
  var CLEAR_GIFT_BALL = 'gold2030';

  /**
   * 완주 선물을 정하고 프로필에 반영한다.
   * 아직 골든볼이 없으면 그 공을 선물하고(가장 비싼 3000코인짜리),
   * 이미 있으면 코인 + 레전더리 아이템으로 준다.
   */
  function grantClearReward(profile, rng) {
    if (!profile) return null;
    profile.metrics.clears = (profile.metrics.clears || 0) + 1;

    var gift;
    if (!ownsBall(profile, CLEAR_GIFT_BALL)) {
      var ball = ballById(CLEAR_GIFT_BALL);
      profile.balls.owned.push(ball.id);
      profile.balls.selected = ball.id;
      gift = { type: 'ball', ballId: ball.id, label: ball.name + ' 획득!', coins: 0 };
    } else {
      profile.coins += CLEAR_COINS;
      profile.inventory.legendary += 1;
      gift = { type: 'coins', coins: CLEAR_COINS, label: '+' + CLEAR_COINS + ' 코인 · 레전더리 조각' };
    }
    gift.clears = profile.metrics.clears;
    return gift;
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

    var ballKind = selectedBall(profile);
    var modeM = modeParams(profile.mode);
    // 이번 판에 실제로 걸려 있던 장비·소모품 보정
    var mods = runMods(profile, { snack: run.snack || null });
    var mult = rewardMultipliers(mods, {
      passCount: passes, hotPasses: run.hotPasses || 0, combo: combo
    });
    var coins = Math.round(coinReward(score) * (ballKind.coinBonus || 1) * modeM.reward * mult.coin);
    var xp = xpReward(score, perfect, run.difficulty !== undefined ? run.difficulty : profile.difficulty)
      * modeM.reward * mult.xp;
    profile.coins += coins;
    profile.xp += xp;
    var levelsGained = applyLevelUps(profile);

    var loot = rollLoot(
      run.difficulty !== undefined ? run.difficulty : profile.difficulty,
      profile.stats.luck + mods.luckAdd,
      rng
    );
    profile.inventory[loot] += 1;

    var nextSkill = computeSkill(profile);
    profile.skill = nextSkill;
    var diff = computeDifficulty(profile, nextSkill, { combo: combo, earlyDeath: earlyDeath });
    var previousDifficulty = profile.difficulty;
    profile.difficulty = diff.difficulty;

    saveModeState(profile);                    // 모드별 난이도·최고점 보관

    profile.lastRun = {
      mode: profile.mode,
      score: score,
      combo: combo,
      difficulty: previousDifficulty,
      stage: run.stage || stageFor(passes, previousDifficulty).key
    };

    return {
      score: score,
      combo: combo,
      perfectCount: perfect,
      cleared: !!run.cleared,
      coins: coins,
      xp: xp,
      loot: loot,
      shardLabel: RARITY_LABEL[loot],
      coinMultiplier: mult.coin,
      xpMultiplier: mult.xp,
      gearUsed: mods.equipped.map(function (g) { return g.name; }),
      snackUsed: mods.snack ? mods.snack.name : null,
      ballId: ballKind.id,
      mode: profile.mode,
      modeLabel: modeM.label,
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
    MODES: MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    PRO_UNLOCK: PRO_UNLOCK,
    modeParams: modeParams,
    isModeUnlocked: isModeUnlocked,
    setMode: setMode,
    loadModeState: loadModeState,
    saveModeState: saveModeState,
    BALLS: BALLS,
    DEFAULT_BALL: DEFAULT_BALL,
    ballById: ballById,
    selectedBall: selectedBall,
    ownsBall: ownsBall,
    buyBall: buyBall,
    selectBall: selectBall,
    createProfile: createProfile,
    normalizeProfile: normalizeProfile,
    skillComponents: skillComponents,
    computeSkill: computeSkill,
    computeDifficulty: computeDifficulty,
    progressBand: progressBand,
    stageFor: stageFor,
    arenaParams: arenaParams,
    tuningFactors: tuningFactors,
    BALL_FINE_MIN: BALL_FINE_MIN,
    SPEED_MIN: SPEED_MIN,
    perfectBonus: perfectBonus,
    passScore: passScore,
    coinReward: coinReward,
    CLEAR_STAGE: CLEAR_STAGE,
    CLEAR_COINS: CLEAR_COINS,
    CLEAR_GIFT_BALL: CLEAR_GIFT_BALL,
    grantClearReward: grantClearReward,
    xpReward: xpReward,
    xpRequired: xpRequired,
    lootTable: lootTable,
    rollLoot: rollLoot,
    RARITIES: RARITIES,
    RARITY_LABEL: RARITY_LABEL,
    CRAFT_COST: CRAFT_COST,
    DUST_VALUE: DUST_VALUE,
    GEAR_REWARD_CAP: GEAR_REWARD_CAP,
    GEAR_PHYSICS_CAP: GEAR_PHYSICS_CAP,
    EARLY_GATES: EARLY_GATES,
    GEAR_SLOTS: GEAR_SLOTS,
    GEAR: GEAR,
    CONSUMABLES: CONSUMABLES,
    gearById: gearById,
    gearBySlot: gearBySlot,
    consumableById: consumableById,
    ownsGear: ownsGear,
    craftCost: craftCost,
    craftGear: craftGear,
    equipGear: equipGear,
    unequipGear: unequipGear,
    dustShards: dustShards,
    consumableStock: consumableStock,
    buyConsumable: buyConsumable,
    selectConsumable: selectConsumable,
    selectedConsumable: selectedConsumable,
    consumeSelected: consumeSelected,
    neutralMods: neutralMods,
    runMods: runMods,
    saveRule: saveRule,
    passResult: passResult,
    rewardMultipliers: rewardMultipliers,
    applyLevelUps: applyLevelUps,
    spendStatPoint: spendStatPoint,
    commitRun: commitRun,
    createStorage: createStorage
  };
});
