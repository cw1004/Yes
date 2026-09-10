/*
 * SKY GOAL 2.0 — 게임 셸 (렌더링 / 입력 / 화면 전환)
 * 로직은 전부 SkyGoalEngine 에 있고, 이 파일은 그것을 화면에 연결한다.
 */
(function () {
  'use strict';

  var E = window.SkyGoalEngine;
  if (!E) { console.error('SkyGoalEngine 을 찾을 수 없습니다.'); return; }
  var Scenery = window.SkyGoalScenery;
  var AudioLib = window.SkyGoalAudio;
  var Sponsor = window.SkyGoalSponsor;

  /* ------------------------------------------------------------ DOM 참조 */

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c');
  var ctx = canvas.getContext('2d');
  var panel = $('panel');
  var hud = $('hud');
  var screenStart = $('screen-start');
  var screenResult = $('screen-result');
  var screenContinue = $('screen-continue');
  var screenSettings = $('screen-settings');
  var screenBalls = $('screen-balls');
  var bridge = window.SkyGoalNative || null;      // 안드로이드 앱이 주입하는 브리지

  /* ---------------------------------------------------------- 상태 변수 */

  var storage = E.createStorage();
  var profile = storage.load();

  var W = 0, H = 0, groundY = 0;
  var state = 'idle';          // idle | ready | playing | over
  var run = null;
  var ball = null;
  var gates = [];
  var sparks = [];
  var arena = null;
  var stage = E.STAGES[0];
  var lastFrame = 0;
  var lastTapAt = 0;
  var elapsed = 0;
  var lastEndReason = null;
  var lastMid = null;
  var scroll = 0;                    // 배경 패럴랙스용 누적 이동 거리
  var clock = 0;                     // 배경 애니메이션 시간(초)
  var flash = 0;                     // 번개 섬광 세기
  var flashAt = 3;                   // 다음 번개까지 남은 시간

  var scenery = Scenery ? Scenery.create(20300101) : null;
  var audio = AudioLib ? AudioLib.create({ muted: profile.settings.muted }) : null;

  var kick = null;                   // 킥오프 연출 상태
  var ceremony = null;               // 완주 헹가래 세리머니
  var cheer = null;                  // 사이드라인 응원단 (배경 연출)
  var popups = [];                   // 화면에 떠오르는 점수 문구
  var usedContinue = false;          // 한 판에 이어하기는 1회
  var rewardProvider = null;         // 보상형 광고 제공자 (네이티브 앱에서 주입)
  var pendingReward = null;          // 광고 결과를 기다리는 콜백

  var boardSeq = 0;                  // 골문 광고판 순환용
  var GATE_W = 54;
  var GATE_SPACING = 260;

  /* ------------------------------------------------------------- 캔버스 */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    groundY = H * 0.9;
    if (scenery) scenery.resize(W, H, groundY);
    createCheerSquad();
    if (ball) ball.x = Math.min(ball.x, W * 0.45);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ---------------------------------------------------------- 화면 전환 */

  function showStart() {
    if (audio) audio.stopMusic();
    hideContinuePrompt();
    state = 'idle';
    run = null;
    ball = null;
    gates = [];
    sparks = [];
    stage = E.stageFor(0, profile.difficulty);
    arena = E.arenaParams(profile.difficulty, stage, profile.stats, profile.settings,
                          E.selectedBall(profile), profile.mode);
    refreshStartScreen();
    refreshModes();
    screenBalls.classList.add('hidden');
    screenSettings.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenStart.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
  }

  /* ------------------------------------------------------- 공 선택 · 상점 */

  function ballSpecLabel(b) {
    var weight = b.weight < 0.9 ? '가벼움' : (b.weight > 1.1 ? '무거움' : '표준');
    var bits = ['무게 ' + weight + ' (' + b.weight.toFixed(2) + ')'];
    if (b.perfectBonus) bits.push('퍼펙트 판정 +');
    if (b.coinBonus > 1) bits.push('코인 +' + Math.round((b.coinBonus - 1) * 100) + '%');
    return bits.join(' · ');
  }

  function renderBallList() {
    var list = $('ball-list');
    list.innerHTML = '';
    $('ball-coins').textContent = profile.coins;

    E.BALLS.forEach(function (b) {
      var owned = E.ownsBall(profile, b.id);
      var picked = profile.balls.selected === b.id;

      var row = document.createElement('div');
      row.className = 'ballrow' + (picked ? ' on' : '') + (owned ? '' : ' locked');

      // 미리보기는 실제 게임과 같은 그리기 코드를 쓴다
      var orb = document.createElement('canvas');
      orb.className = 'orb';
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      orb.width = 46 * dpr;
      orb.height = 46 * dpr;
      var octx = orb.getContext('2d');
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.translate(23, 23);
      paintBall(octx, 20, b.skin, 0.35);

      var meta = document.createElement('div');
      meta.className = 'meta';
      var name = document.createElement('b');
      name.textContent = b.name + (picked ? ' ✓' : '');
      var desc = document.createElement('span');
      desc.textContent = b.desc;
      var spec = document.createElement('div');
      spec.className = 'spec';
      spec.textContent = ballSpecLabel(b);
      meta.appendChild(name);
      meta.appendChild(desc);
      meta.appendChild(spec);

      var btn = document.createElement('button');
      if (picked) {
        btn.textContent = '사용 중';
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = '선택';
        btn.addEventListener('click', function () {
          if (E.selectBall(profile, b.id)) {
            storage.save(profile);
            refreshArena();
            renderBallList();
            if (audio) audio.tap();
          }
        });
      } else {
        btn.className = 'buy';
        btn.textContent = b.price + '코인';
        btn.disabled = profile.coins < b.price;
        btn.addEventListener('click', function () {
          var res = E.buyBall(profile, b.id);
          if (res.ok) {
            storage.save(profile);
            refreshArena();
            renderBallList();
            refreshStartScreen();
            if (audio) audio.levelUp();
          }
        });
      }

      row.appendChild(orb);
      row.appendChild(meta);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function showBalls() {
    refreshArena();          // 다른 경로로 공이 바뀌었어도 화면과 물리를 맞춘다
    renderBallList();
    screenStart.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenSettings.classList.add('hidden');
    hideContinuePrompt();
    screenBalls.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
  }

  /* ---------------------------------------------------------- 조작 설정 */

  function refreshArena() {
    arena = E.arenaParams(run ? run.difficulty : profile.difficulty, stage,
                          profile.stats, profile.settings, E.selectedBall(profile), profile.mode);
  }

  function applySettings(save) {
    var t = E.tuningFactors(profile.settings);
    profile.settings.ballFine = t.ballFine;
    profile.settings.speed = t.speed;
    $('set-fine').value = t.ballFine;
    $('set-speed').value = t.speed;
    $('set-fine-val').textContent = t.ballFine;
    $('set-speed-val').textContent = t.speed;
    // 준비 상태에서 바꾸면 즉시 반영된다 (플레이 중에는 다음 판부터)
    refreshArena();
    if (save) storage.save(profile);
  }

  function showSettings() {
    applySettings(false);
    screenStart.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenBalls.classList.add('hidden');
    hideContinuePrompt();
    screenSettings.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
  }

  /* ------------------------------------------------------------ 모드 선택 */

  function refreshModes() {
    ['amateur', 'pro'].forEach(function (id) {
      var btn = $('mode-' + id);
      if (!btn) return;
      var unlocked = E.isModeUnlocked(profile, id);
      var st = profile.modes[id] || { bestScore: 0 };
      btn.classList.toggle('on', profile.mode === id);
      btn.classList.toggle('locked', !unlocked);
      $('mode-' + id + '-best').textContent = unlocked
        ? '최고 ' + st.bestScore
        : '최고 ' + E.PRO_UNLOCK.bestScore + '점 또는 완주 시 해금';
    });
    $('mode-desc').textContent = E.modeParams(profile.mode).desc;
  }

  function chooseMode(id) {
    if (!E.isModeUnlocked(profile, id)) {
      $('mode-desc').textContent =
        '프로 모드는 아마추어에서 ' + E.PRO_UNLOCK.bestScore + '점을 넘거나 한 번 완주하면 열립니다.';
      return;
    }
    if (!E.setMode(profile, id)) return;
    storage.save(profile);
    stage = E.stageFor(0, profile.difficulty);
    refreshArena();
    refreshModes();
    refreshStartScreen();
    if (audio) audio.tap();
  }

  function refreshStartScreen() {
    $('s-skill').textContent = Math.round(profile.skill);
    $('s-diff').textContent = Math.round(profile.difficulty);
    $('s-best').textContent = profile.bestScore;
    $('s-level').textContent = profile.level;
    $('s-coin').textContent = profile.coins;
    $('s-games').textContent = profile.metrics.games +
      (profile.metrics.clears ? ' (완주 ' + profile.metrics.clears + ')' : '');
    $('s-ball').textContent = E.selectedBall(profile).name;
    $('s-storage').textContent = storage.persistent
      ? '진행 상황은 이 브라우저에 저장됩니다.'
      : '이 환경에서는 저장이 차단되어 이번 세션에서만 기록이 유지됩니다.';
  }

  function updateHud() {
    $('hud-score').textContent = run ? run.score : 0;
    $('hud-coin').textContent = profile.coins;
    $('hud-level').textContent = profile.level;
    $('hud-diff').textContent = Math.round(run ? run.difficulty : profile.difficulty);
    $('hud-stage').textContent = E.modeParams(profile.mode).tag + ' · ' + stage.label;
    $('hud-combo').textContent = run ? run.combo : 0;
  }

  /* -------------------------------------------------------------- 게임 */

  // 다음 골문은 "직전 골문에서 실제로 도달 가능한 높이" 안에서만 생성한다.
  // (상승은 탭 연타로만 가능하므로 하강보다 여유를 좁게 잡는다)
  function makeGate(x) {
    var margin = arena.gap / 2 + 40;
    var lo = margin;
    var hi = Math.max(margin + 20, groundY - margin);
    var travel = GATE_SPACING / arena.speed;              // 골문 사이 이동 시간(초)
    var climb = Math.abs(arena.flap) * travel * 0.55;     // 그 시간에 오를 수 있는 높이
    if (lastMid !== null) {
      lo = Math.max(lo, lastMid - climb);
      hi = Math.min(hi, lastMid + climb * 1.6);           // 낙하는 더 쉬우므로 여유를 준다
    }
    if (hi <= lo) { lo = margin; hi = Math.max(margin + 20, groundY - margin); }
    var mid = lo + Math.random() * (hi - lo);
    lastMid = mid;
    return {
      x: x,
      baseMid: mid,
      mid: mid,
      gap: arena.gap,
      amp: arena.bob,                                   // 난이도가 낮아도 8px 이상 흔들린다
      speed: 0.55 + Math.random() * 0.5,                // 천천히 오르내리게
      phase: Math.random() * Math.PI * 2,
      flagPhase: Math.random() * Math.PI * 2,           // 깃발이 각자 다르게 나부낀다
      banner: Math.floor(Math.random() * 3),            // 상단 장식 종류
      board: (boardSeq += 2) - 2,                       // 위/아래 기둥에 서로 다른 보드
      passed: false
    };
  }

  function startRun() {
    stage = E.stageFor(0, profile.difficulty);
    arena = E.arenaParams(profile.difficulty, stage, profile.stats, profile.settings,
                          E.selectedBall(profile), profile.mode);
    run = {
      score: 0,
      combo: 0,
      passCount: 0,
      perfectCount: 0,
      duration: 0,
      tapIntervals: [],
      difficulty: profile.difficulty,
      stage: stage.key
    };
    // 킥오프: 공은 잔디 위에 놓여 있고, 선수가 달려와 차 올린다.
    ball = { x: W * 0.21, y: groundY - 15, vy: 0, vx: 0, spin: 0 };
    kick = {
      t: 0,
      impactAt: 0.85,                 // 달려오기 → 백스윙 → 임팩트
      flight: 0.62,                   // 차인 공이 플레이 위치까지 날아가는 시간
      launched: false,
      startX: -70,
      targetX: W * 0.26,
      targetY: groundY * 0.5
    };
    ceremony = null;
    boardSeq = Math.floor(Math.random() * 5);
    lastMid = kick.targetY;           // 첫 골문은 플레이 시작 높이 근처에서
    gates = [];
    sparks = [];
    for (var i = 0; i < 4; i++) gates.push(makeGate(W + 220 + i * GATE_SPACING));
    popups = [];
    usedContinue = false;
    elapsed = 0;
    scroll = 0;
    flash = 0;
    flashAt = 3;
    lastTapAt = 0;
    state = 'kickoff';
    if (audio) {
      audio.unlock();                 // 시작 버튼 클릭이 사용자 제스처라 여기서 열린다
      audio.whistle();
    }
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    updateHud();
  }

  // 킥오프 연출을 끝내고 실제 플레이로 넘긴다.
  function beginPlay() {
    ball.x = kick.targetX;
    ball.vx = 0;
    state = 'playing';
    elapsed = 0;
    lastTapAt = performance.now();
    if (audio && !audio.isPlaying()) audio.startMusic(musicLevel());
  }

  function updateKickoff(dt) {
    kick.t += dt;

    if (!kick.launched && kick.t >= kick.impactAt) {
      kick.launched = true;
      // 임팩트: 목표 지점에 flight 초 뒤 도착하도록 초기 속도를 역산한다
      var g = arena.gravity;
      var T = kick.flight;
      ball.vx = (kick.targetX - ball.x) / T;
      ball.vy = ((kick.targetY - ball.y) - 0.5 * g * T * T) / T;
      cheerUp(1.2);                                            // 킥오프 환호
      addSparks(ball.x - 6, groundY - 6, 16, '190,220,160');   // 잔디 파편
      addSparks(ball.x, ball.y, 10, '255,215,0');
      if (audio) { audio.kick(); audio.startMusic(musicLevel()); }
    }

    if (kick.launched) {
      ball.vy += arena.gravity * dt;
      ball.y += ball.vy * dt;
      ball.x += ball.vx * dt;
      ball.spin += 7 * dt;
      if (kick.t >= kick.impactAt + kick.flight) beginPlay();
    }
    updateSparks(dt);
  }

  function flap() {
    if (state === 'ceremony') {       // 1.4초 뒤부터 건너뛸 수 있다 (선물은 보고 넘어가게)
      if (ceremony.t > 1.4) endCeremony();
      return;
    }
    if (state === 'kickoff') {        // 연출 건너뛰기
      ball.y = kick.targetY;
      ball.vy = arena.flap;
      beginPlay();
      if (audio) audio.tap();
      return;
    }
    if (state === 'ready') {
      state = 'playing';
      lastTapAt = performance.now();
      ball.vy = arena.flap;
      if (audio) {
        audio.unlock();
        audio.tap();
        audio.startMusic(musicLevel());
      }
      return;
    }
    if (state !== 'playing') return;
    var now = performance.now();
    if (lastTapAt) run.tapIntervals.push(now - lastTapAt);
    lastTapAt = now;
    ball.vy = arena.flap;
    ball.spin = -0.5;
    if (audio) audio.tap();
  }

  // 스테이지가 올라갈수록 음악 파트를 쌓는다 (0~3)
  function musicLevel() {
    var idx = 0;
    for (var i = 0; i < E.STAGES.length; i++) if (E.STAGES[i].key === stage.key) idx = i;
    return Math.min(3, Math.floor(idx / 2));
  }

  function addSparks(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      sparks.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 220,
        vy: (Math.random() - 0.5) * 220,
        life: 0.45 + Math.random() * 0.35,
        age: 0,
        color: color
      });
    }
  }

  function refreshStage() {
    var next = E.stageFor(run.passCount, run.difficulty);
    if (next.key !== stage.key) {
      stage = next;
      arena = E.arenaParams(run.difficulty, stage, profile.stats, profile.settings,
                            E.selectedBall(profile), profile.mode);
      run.stage = stage.key;
      cheerUp(1.4);                        // 스테이지 전환 — 최고조
      if (audio) { audio.stage(); audio.setIntensity(musicLevel()); }
      if (stage.key === E.CLEAR_STAGE && !run.cleared) startCeremony();
    }
  }

  function update(dt) {
    if (state === 'ceremony') { updateCeremony(dt); return; }
    if (state === 'kickoff') { updateKickoff(dt); return; }
    if (state === 'ready') {
      // 준비 상태: 공이 살짝 위아래로 떠 있고 게이트는 멈춰 있다.
      ball.y += Math.sin(performance.now() / 300) * 18 * dt;
      return;
    }
    if (state !== 'playing') return;

    elapsed += dt;
    run.duration = elapsed;
    scroll += arena.speed * dt;

    // 공 물리
    ball.vy += arena.gravity * dt;
    ball.y += ball.vy * dt;
    ball.spin += (ball.vy / 900) * dt * 6;

    // 바람: 좌우로 밀리는 힘 (스테이지/난이도 기반)
    if (arena.wind > 0) {
      var gust = Math.sin(elapsed * 1.3) * 0.6 + Math.sin(elapsed * 0.37) * 0.4;
      ball.vx += gust * arena.wind * 90 * dt;
    }
    ball.vx *= Math.pow(0.15, dt);
    ball.x += ball.vx * dt;
    ball.x = E.clamp(ball.x, W * 0.14, W * 0.46);

    // 게이트 이동 / 판정
    for (var i = gates.length - 1; i >= 0; i--) {
      var g = gates[i];
      g.x -= arena.speed * dt;
      g.mid = g.baseMid + Math.sin(elapsed * g.speed + g.phase) * g.amp;
      g.mid = E.clamp(g.mid, g.gap / 2 + 24, groundY - g.gap / 2 - 24);

      var top = g.mid - g.gap / 2;
      var bottom = g.mid + g.gap / 2;

      // 통과 판정
      if (!g.passed && g.x + GATE_W < ball.x) {
        g.passed = true;
        var error = Math.abs(ball.y - g.mid);
        var gained = E.passScore(run.combo, error, g.gap);
        run.score += gained;
        run.combo += 1;
        run.passCount += 1;
        if (error <= g.gap * arena.perfectWindow) {
          run.perfectCount += 1;
          addSparks(ball.x, ball.y, 14, '255,215,0');
          cheerUp(1.0);                      // 퍼펙트 — 응원이 터진다
          if (audio) audio.perfect();
        } else {
          addSparks(g.x + GATE_W, g.mid, 6, '255,255,255');
          cheerUp(0.5);
          if (audio) audio.pass(run.combo);
        }
        refreshStage();
        updateHud();
      }

      // 충돌 판정
      if (ball.x + 15 > g.x && ball.x - 15 < g.x + GATE_W &&
          (ball.y - 15 < top || ball.y + 15 > bottom)) {
        return endRun('gate');
      }

      if (g.x < -GATE_W - 20) {
        gates.splice(i, 1);
        var rightMost = 0;
        for (var k = 0; k < gates.length; k++) rightMost = Math.max(rightMost, gates[k].x);
        gates.push(makeGate(Math.max(W + 120, rightMost + GATE_SPACING)));
      }
    }

    updateCheer(dt);
    updatePopups(dt);

    // 천장 / 바닥
    if (ball.y - 15 <= 0) return endRun('ceiling');
    if (ball.y + 15 >= groundY) return endRun('ground');

    updateSparks(dt);
  }

  function updateSparks(dt) {
    for (var s = sparks.length - 1; s >= 0; s--) {
      var p = sparks[s];
      p.age += dt;
      if (p.age >= p.life) { sparks.splice(s, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
    }
  }

  /* ------------------------------------------------------ 사이드라인 응원단 */

  // 경기장 앞쪽 잔디(플레이 영역 아래)에서 응원하는 치어리더들.
  // 충돌·점수·물리에 전혀 관여하지 않는 순수 배경 연출이다.
  var CHEER = {
    top: '#ffffff', topShade: '#e3e9f1',
    skirt: '#ff9933', skirtShade: '#e07d1f',
    skin: '#c98a5b', hair: '#1b2230',
    pom: '#ffd75a', pomAlt: '#ffffff', shoe: '#f4f7fb'
  };

  function createCheerSquad() {
    var span = Math.max(360, W);
    var count = Math.max(3, Math.min(6, Math.round(W / 130)));
    var girls = [];
    for (var i = 0; i < count; i++) {
      girls.push({
        x: (span / count) * i + 30 + Math.random() * 40,
        phase: Math.random() * Math.PI * 2,
        scale: 0.92 + Math.random() * 0.22,
        flip: Math.random() < 0.35
      });
    }
    cheer = { span: span, girls: girls, excite: 0, bits: [] };
  }

  // 통과·퍼펙트·스테이지 변경 때 응원이 뜨거워진다.
  function cheerUp(strength) {
    if (!cheer) return;
    cheer.excite = Math.min(1.6, cheer.excite + strength);
    if (strength >= 0.8) {
      for (var i = 0; i < 8; i++) {
        cheer.bits.push({
          x: Math.random() * W,
          y: groundY + 6 + Math.random() * 20,
          vx: (Math.random() - 0.5) * 40,
          vy: -60 - Math.random() * 70,
          life: 0.7 + Math.random() * 0.5,
          age: 0,
          c: Math.random() < 0.5 ? '255,215,90' : (Math.random() < 0.5 ? '255,255,255' : '90,200,120')
        });
      }
      if (cheer.bits.length > 60) cheer.bits.splice(0, cheer.bits.length - 60);
    }
  }

  function updateCheer(dt) {
    if (!cheer) return;
    cheer.excite = Math.max(0, cheer.excite - dt * 0.85);
    for (var i = cheer.bits.length - 1; i >= 0; i--) {
      var b = cheer.bits[i];
      b.age += dt;
      if (b.age >= b.life) { cheer.bits.splice(i, 1); continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 190 * dt;
    }
  }

  function drawPom(x, y, r, shake) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shake);
    for (var i = 0; i < 6; i++) {
      var a = (Math.PI * 2 * i) / 6;
      ctx.fillStyle = i % 2 ? CHEER.pom : CHEER.pomAlt;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = CHEER.pom;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 치어리더 한 명. 발끝이 원점, 위쪽이 음수.
  function drawCheerleader(px, baseY, scale, t, phase, excite, flip) {
    var rad = Math.PI / 180;
    var sway = Math.sin(t * 2.2 + phase) * 3;
    var beat = Math.sin(t * (7 + excite * 9) + phase);
    var lift = excite > 0 ? Math.max(0, beat) * 12 * Math.min(1, excite) : 0;
    var armA = -38 - excite * 34 + beat * 9;
    var armB = -30 - excite * 30 - beat * 9;

    ctx.save();
    ctx.translate(px, baseY - lift);
    ctx.scale(flip ? -scale : scale, scale);

    // 그림자
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, lift + 2, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 다리
    ctx.strokeStyle = CHEER.skin;
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, -26); ctx.lineTo(-5 + sway * 0.2, -3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -26); ctx.lineTo(6 + sway * 0.2, -3); ctx.stroke();
    ctx.fillStyle = CHEER.shoe;
    ctx.beginPath(); ctx.ellipse(-5, -2, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, -2, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();

    // 치마
    ctx.fillStyle = CHEER.skirt;
    ctx.beginPath();
    ctx.moveTo(-8, -42);
    ctx.lineTo(8, -42);
    ctx.lineTo(12 + sway * 0.3, -24);
    ctx.lineTo(-12 + sway * 0.3, -24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CHEER.skirtShade;
    ctx.fillRect(-2, -42, 3, 18);

    // 상의
    ctx.fillStyle = CHEER.top;
    ctx.beginPath();
    ctx.moveTo(-7, -41);
    ctx.lineTo(7, -41);
    ctx.lineTo(6 + sway * 0.2, -62);
    ctx.lineTo(-6 + sway * 0.2, -62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#138808';
    ctx.fillRect(-7 + sway * 0.2, -56, 14, 2.4);

    // 팔 + 폼폼
    var shx = sway * 0.2;
    ctx.strokeStyle = CHEER.skin;
    ctx.lineWidth = 4.6;
    var ax = Math.sin(armA * rad) * 17, ay = -Math.cos(armA * rad) * 17;
    var bx = Math.sin(armB * rad) * 17, by = -Math.cos(armB * rad) * 17;
    ctx.beginPath(); ctx.moveTo(shx - 4, -60); ctx.lineTo(shx - 4 - ax, -60 + ay); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shx + 4, -60); ctx.lineTo(shx + 4 + bx, -60 + by); ctx.stroke();
    drawPom(shx - 4 - ax, -60 + ay, 7, beat * 0.8);
    drawPom(shx + 4 + bx, -60 + by, 7, -beat * 0.8);

    // 머리 + 포니테일
    var hx = shx + 1, hy = -71;
    ctx.fillStyle = CHEER.hair;
    ctx.beginPath();
    ctx.ellipse(hx - 9, hy + 2 + beat * 1.5, 4.5, 8, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CHEER.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CHEER.hair;
    ctx.beginPath();
    ctx.arc(hx, hy - 1.5, 8.5, Math.PI * 1.02, Math.PI * 2.1);
    ctx.lineTo(hx - 7, hy + 2);
    ctx.quadraticCurveTo(hx - 10, hy - 5, hx - 3, hy - 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // 응원단이 서는 높이 — 반드시 잔디(플레이 영역 아래)여야 한다
  function cheerBaseY() {
    return groundY + (H - groundY) * 0.72;
  }

  function drawCheerSquad() {
    if (!cheer) return;
    var t = clock;
    var base = cheerBaseY();                        // 잔디 위, 플레이 영역 바깥
    var scale = Math.max(0.55, Math.min(1, (H - groundY) / 100));
    var off = (scroll * 0.9) % cheer.span;

    for (var i = 0; i < cheer.girls.length; i++) {
      var g = cheer.girls[i];
      var x = g.x - off;
      if (x < -60) x += cheer.span;
      if (x > W + 60 || x < -60) continue;
      drawCheerleader(x, base, scale * g.scale, t, g.phase, cheer.excite, g.flip);
    }

    // 색종이
    for (var b = 0; b < cheer.bits.length; b++) {
      var bit = cheer.bits[b];
      var a = 1 - bit.age / bit.life;
      ctx.fillStyle = 'rgba(' + bit.c + ',' + Math.max(0, a).toFixed(3) + ')';
      ctx.fillRect(bit.x - 2, bit.y - 2, 4, 4);
    }
  }

  /* ------------------------------------------------- 완주 헹가래 세리머니 */

  var TOSS_TIME = 0.62;              // 한 번 띄웠다 받는 데 걸리는 시간
  var TOSS_COUNT = 3;

  // 마지막 스테이지에 도달하면 동료들이 헹가래를 치고 선물을 준다.
  function startCeremony() {
    run.cleared = true;
    ceremony = { t: 0, lift: 0, tossed: 0, popped: false, gift: E.grantClearReward(profile) };
    storage.save(profile);
    state = 'ceremony';
    cheerUp(1.6);
    if (audio) { audio.stopMusic(); audio.fanfare(); }
    updateHud();
  }

  function updateCeremony(dt) {
    ceremony.t += dt;
    var phase = ceremony.t - 0.4;                    // 팡파르가 울린 뒤 헹가래 시작
    if (phase > 0) {
      var idx = Math.floor(phase / TOSS_TIME);
      var k = (phase % TOSS_TIME) / TOSS_TIME;
      ceremony.lift = idx < TOSS_COUNT ? Math.sin(Math.PI * k) * (110 + idx * 22) : 0;
      if (idx > ceremony.tossed && idx <= TOSS_COUNT) {
        ceremony.tossed = idx;
        cheerUp(1.2);
        if (audio) audio.hoist();
      }
    }
    if (!ceremony.popped && ceremony.t > 1.1) {
      ceremony.popped = true;
      popups.push({ x: W / 2, y: H * 0.46, text: ceremony.gift.label, age: 0, life: 2.4 });
    }
    updateCheer(dt);
    updatePopups(dt);
    if (ceremony.t >= 3.2) endCeremony();
  }

  // 세리머니가 끝나면 눈앞을 비우고 다시 플레이로 (경기는 계속된다)
  function endCeremony() {
    ceremony = null;
    ball.x = W * 0.26;
    ball.y = groundY * 0.5;
    ball.vy = 0;
    ball.vx = 0;
    lastMid = ball.y;
    for (var i = gates.length - 1; i >= 0; i--) {
      if (gates[i].x < ball.x + W * 0.8) gates.splice(i, 1);
    }
    var rightMost = ball.x + W * 0.8;
    for (var k = 0; k < gates.length; k++) rightMost = Math.max(rightMost, gates[k].x);
    while (gates.length < 4) {
      gates.push(makeGate(rightMost + GATE_SPACING * (gates.length + 1)));
    }
    state = 'ready';
    updateHud();
    if (audio) audio.startMusic(musicLevel());
  }

  function lifterPose(i) {
    var wob = Math.sin(clock * 6 + i) * 5;
    return {
      frontLeg: 8 + wob * 0.3, frontBend: 16, backLeg: -10, backBend: 18,
      lean: -4, armF: -158 + wob, armB: -152 - wob, crouch: Math.max(0, -wob * 0.4),
      headTilt: -10
    };
  }

  function tossedPose() {
    var spread = 1 + ceremony.lift / 160;
    return {
      frontLeg: -34 * spread, frontBend: 26, backLeg: 30 * spread, backBend: 20,
      lean: 0, armF: -126 * spread, armB: 128 * spread, crouch: 0, headTilt: 6
    };
  }

  function drawCeremony() {
    if (!ceremony) return;
    var sc = playerScale() * 0.92;
    var cx = W * 0.5;
    var spacing = 62 * sc;

    // 헹가래를 치는 동료 3명
    for (var i = -1; i <= 1; i++) {
      drawPlayer(cx + i * spacing, groundY + 2, sc, lifterPose(i + 1), 1);
    }

    // 헹가래로 떠오른 선수 — 살짝 기울며 회전한다
    var lift = ceremony.lift;
    var tilt = Math.sin(clock * 5) * 0.12 * (lift / 120 + 0.2);
    var baseY = groundY - 46 * sc - lift;
    ctx.save();
    ctx.translate(cx, baseY - 60 * sc);
    ctx.rotate(tilt);
    ctx.translate(-cx, -(baseY - 60 * sc));
    drawPlayer(cx, baseY, sc, tossedPose(), 1);
    ctx.restore();

    // 문구
    var fade = Math.min(1, ceremony.t / 0.25) * Math.min(1, (3.2 - ceremony.t) / 0.4);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.textAlign = 'center';
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(7,17,31,0.8)';
    ctx.strokeText('WORLD FINAL 완주!', W / 2, H * 0.3);
    ctx.fillStyle = '#ffd75a';
    ctx.fillText('WORLD FINAL 완주!', W / 2, H * 0.3);
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('완주 ' + ceremony.gift.clears + '회 · 탭하면 경기 재개', W / 2, H * 0.3 + 26);
    ctx.restore();
    ctx.textAlign = 'start';
  }

  /* -------------------------------------------------------- 점수 팝업 */

  function updatePopups(dt) {
    for (var i = popups.length - 1; i >= 0; i--) {
      popups[i].age += dt;
      popups[i].y -= 34 * dt;
      if (popups[i].age >= popups[i].life) popups.splice(i, 1);
    }
  }

  function drawPopups() {
    if (!popups.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < popups.length; i++) {
      var p = popups[i];
      var a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(7,17,31,0.8)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = '#ffd75a';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
    ctx.textAlign = 'start';
  }

  function endRun(reason) {
    if (state !== 'playing') return;
    state = 'over';
    lastEndReason = reason || 'manual';
    addSparks(ball.x, ball.y, 22, '255,120,60');
    if (audio) { audio.stopMusic(); audio.die(); }
    if (canContinue()) { showContinuePrompt(); return; }
    finalizeRun();
  }

  // 보상형 광고로 살아날 수 있는 상황인지
  function canContinue() {
    return !usedContinue && run && run.score >= 30 && !!rewardProvider;
  }

  // 이어하기: 점수와 통과 수는 유지하고 콤보만 초기화한다.
  function continueRun() {
    if (state !== 'over' || usedContinue) return false;
    usedContinue = true;
    hideContinuePrompt();
    ball.y = groundY * 0.5;
    ball.vy = 0;
    ball.vx = 0;
    run.combo = 0;
    lastMid = ball.y;
    for (var i = gates.length - 1; i >= 0; i--) {          // 눈앞의 골문은 치운다
      if (gates[i].x < ball.x + W * 0.75) gates.splice(i, 1);
    }
    var rightMost = ball.x + W * 0.75;
    for (var k = 0; k < gates.length; k++) rightMost = Math.max(rightMost, gates[k].x);
    while (gates.length < 4) {
      gates.push(makeGate(rightMost + GATE_SPACING * (gates.length + 1)));
    }
    state = 'ready';
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    updateHud();
    return true;
  }

  // 한 판을 확정한다 (프로필 반영 + 결과 화면)
  function finalizeRun() {
    hideContinuePrompt();
    var summary = E.commitRun(profile, run);
    storage.save(profile);
    if (audio && summary.levelsGained > 0) setTimeout(function () { audio.levelUp(); }, 420);
    if (bridge && bridge.gameOver) {
      try { bridge.gameOver(summary.score, profile.metrics.games); } catch (e) { /* 무시 */ }
    }
    showResult(summary);
  }

  function showContinuePrompt() {
    $('c-score').textContent = run.score;
    screenStart.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenContinue.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
  }

  function hideContinuePrompt() {
    screenContinue.classList.add('hidden');
  }

  /* ---------------------------------------------------------- 결과 화면 */

  function showResult(sum) {
    $('r-stage').textContent = E.modeParams(profile.mode).tag + ' · ' + stage.label;
    $('r-title').textContent = sum.score >= profile.bestScore && sum.score > 0 ? 'NEW BEST!' : 'GAME OVER';
    $('r-line').textContent = '점수 ' + sum.score + ' · 콤보 ' + sum.combo +
      ' · 퍼펙트 ' + sum.perfectCount + (sum.cleared ? ' · 🏆 완주' : '');
    $('r-coin').textContent = '+' + sum.coins;
    $('r-xp').textContent = '+' + Math.round(sum.xp);
    $('r-loot').textContent = sum.loot.toUpperCase();
    $('r-level').textContent = profile.level;
    $('r-diff').textContent = Math.round(sum.difficulty) +
      ' (' + (sum.difficultyDelta >= 0 ? '+' : '') + sum.difficultyDelta.toFixed(1) + ')';
    $('r-skill').textContent = Math.round(sum.skill);

    var list = $('r-reasons');
    list.innerHTML = '';
    var reasons = sum.reasons.slice();
    reasons.push('최근 성공률 ' + Math.round(sum.successRate * 100) + '%');
    for (var i = 0; i < reasons.length; i++) {
      var li = document.createElement('li');
      li.textContent = reasons[i];
      list.appendChild(li);
    }

    refreshStatBox();
    hideContinuePrompt();
    screenBalls.classList.add('hidden');
    screenSettings.classList.add('hidden');
    screenStart.classList.add('hidden');
    screenResult.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
  }

  function refreshStatBox() {
    var box = $('r-statbox');
    var buttons = box.querySelectorAll('button[data-stat]');
    $('r-points').textContent = profile.statPoints;
    for (var i = 0; i < buttons.length; i++) {
      var name = buttons[i].getAttribute('data-stat');
      buttons[i].disabled = profile.statPoints <= 0 || profile.stats[name] >= 100;
      buttons[i].textContent = name.toUpperCase() + ' ' + Math.round(profile.stats[name]);
    }
    box.classList.toggle('hidden', profile.statPoints <= 0);
  }

  /* -------------------------------------------------------------- 렌더 */

  function drawBackground() {
    if (scenery) {
      scenery.draw(ctx, { stage: stage.key, scroll: scroll, time: clock, flash: flash });
    } else {                                   // scenery.js 가 없을 때의 최소 폴백
      var g0 = ctx.createLinearGradient(0, 0, 0, H);
      g0.addColorStop(0, '#3aa5f0');
      g0.addColorStop(1, '#cdeeff');
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, W, H);
    }
    drawBillboards();
    drawWeather();
    drawField();
    drawCheerSquad();
  }

  // 대형 세로 광고판 — 강 건너 둑에 일정 간격으로 세워진다 (배경 레이어)
  function drawBillboards() {
    if (!Sponsor || !scenery || !Sponsor.drawTowerBillboard) return;
    var L = scenery.layout();
    if (!L) return;
    var par = 0.22;                       // 숲과 같은 속도로 흐른다
    // 간판 사이 간격(패럴랙스 좌표). 700 이면 실제 이동 거리로 약 3,200px,
    // 기본 속도에서 10초에 한 번꼴로 새 간판이 지나간다.
    var spacing = 700;
    var tw = Math.max(52, Math.min(84, W * 0.19));
    var th = tw * 3.1;
    var baseY = L.riverTop + 2;
    var travelled = scroll * par;
    var start = Math.floor((travelled - tw) / spacing);
    var end = Math.ceil((travelled + W) / spacing);
    // 자연보호 캠페인 표지판 — 타워와 타워 사이 중간에 작게 놓는다
    var sw = Math.max(96, Math.min(152, W * 0.35));
    var sh = sw * 0.30;

    for (var n = start; n <= end; n++) {
      var sx = n * spacing - travelled;
      if (sx <= W + 10 && sx + tw >= -10) {
        Sponsor.drawTowerBillboard(ctx, Sponsor.pick(n * 2 + 1), sx, baseY, tw, th, 0.94);
      }
      if (Sponsor.drawSignBoard) {
        var mx = (n + 0.5) * spacing - travelled;       // 두 타워의 한가운데
        if (mx <= W + 10 && mx + sw >= -10) {
          Sponsor.drawSignBoard(ctx, Sponsor.pickKind('campaign', n), mx, baseY, sw, sh, 0.92);
        }
      }
    }
  }

  function drawWeather() {
    if (stage.rain > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.16 + 0.24 * stage.rain) + ')';
      ctx.lineWidth = 1;
      var t = clock * 190;
      for (var i = 0; i < 90; i++) {
        var x = (i * 97 + t) % (W + 40) - 20;
        var y = (i * 53 + t * 1.7) % H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 7, y + 20);
        ctx.stroke();
      }
    }
    if (stage.wind > 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 2;
      for (var w = 0; w < 5; w++) {
        var wy = (w * 137 + clock * 26) % H;
        var wx = (clock * 240 + w * 200) % (W + 300) - 150;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + 90, wy);
        ctx.stroke();
      }
    }
  }

  // 잔디 경기장 — 줄무늬가 스크롤과 함께 흐른다
  function drawField() {
    ctx.fillStyle = '#1d6b39';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    var stripe = 60;
    var off = -(scroll % (stripe * 2));
    for (var x = off - stripe * 2; x < W + stripe * 2; x += stripe * 2) {
      ctx.fillRect(x, groundY, stripe, H - groundY);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, groundY, W, 2);
  }

  // 인도 국기색 골대. 기둥 그라디언트 + 네트 + 상단 배너 + 나부끼는 깃발.
  var GATE_TRIM = ['#ff9933', '#ffffff', '#138808'];

  function drawPost(x, y, w, h) {
    if (h <= 0) return;
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(226,236,247,0.98)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.98)');
    g.addColorStop(1, 'rgba(186,201,219,0.98)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // 네트 (마름모 격자)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(40,60,85,0.13)';
    ctx.lineWidth = 1;
    for (var d = -h; d < w + h; d += 13) {
      ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke();
    }
    ctx.restore();

    // 좌우 프레임
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(x, y, 3, h);
    ctx.fillRect(x + w - 3, y, 3, h);
  }

  function drawFlag(x, y, dir, phase, color) {
    var wave = Math.sin(clock * 3.4 + phase);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + dir * 22);            // 깃대
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + dir * 22);
    ctx.lineTo(x + 20, y + dir * 22 + wave * 4 + dir * 5);
    ctx.lineTo(x, y + dir * 22 + dir * 11);
    ctx.closePath();
    ctx.fill();
  }

  function drawGate(g) {
    var top = g.mid - g.gap / 2;
    var bottom = g.mid + g.gap / 2;

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(g.x + 5, 0, GATE_W, top);
    ctx.fillRect(g.x + 5, bottom, GATE_W, groundY - bottom);

    drawPost(g.x, 0, GATE_W, top);
    drawPost(g.x, bottom, GATE_W, groundY - bottom);

    // 크로스바 (위: 주황 / 아래: 초록) + 삼색 트림
    ctx.fillStyle = '#ff9933';
    ctx.fillRect(g.x - 5, top - 11, GATE_W + 10, 11);
    ctx.fillStyle = '#138808';
    ctx.fillRect(g.x - 5, bottom, GATE_W + 10, 11);
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = GATE_TRIM[i];
      ctx.fillRect(g.x - 5, top - 15 + i * 1.4, GATE_W + 10, 1.4);
      ctx.fillRect(g.x - 5, bottom + 11 + i * 1.4, GATE_W + 10, 1.4);
    }

    // 크로스바 끝 캡
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(g.x - 7, top - 13, 4, 15);
    ctx.fillRect(g.x + GATE_W + 3, top - 13, 4, 15);
    ctx.fillRect(g.x - 7, bottom - 2, 4, 15);
    ctx.fillRect(g.x + GATE_W + 3, bottom - 2, 4, 15);

    // 상단 배너 장식 (골문마다 다른 무늬)
    var by = top - 34;
    if (by > 6) {
      if (g.banner === 0) {                       // 삼색 리본
        for (var b = 0; b < 3; b++) {
          ctx.fillStyle = GATE_TRIM[b];
          ctx.fillRect(g.x + 6, by + b * 5, GATE_W - 12, 4);
        }
      } else if (g.banner === 1) {                // 원형 엠블럼
        ctx.strokeStyle = '#ff9933';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(g.x + GATE_W / 2, by + 7, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(g.x + GATE_W / 2, by + 7, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {                                    // 작은 삼각 깃발 줄
        for (var t = 0; t < 4; t++) {
          ctx.fillStyle = GATE_TRIM[t % 3];
          ctx.beginPath();
          ctx.moveTo(g.x + 4 + t * 12, by);
          ctx.lineTo(g.x + 14 + t * 12, by);
          ctx.lineTo(g.x + 9 + t * 12, by + 10);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 기둥 끝 깃발 (위/아래에서 서로 반대로 나부낀다)
    drawFlag(g.x + GATE_W / 2, top - 15, -1, g.flagPhase, '#ff9933');
    drawFlag(g.x + GATE_W / 2, bottom + 15, 1, g.flagPhase + 2, '#138808');

    // 기둥 광고판 — 위/아래 기둥 모두. 골문 틈에서 46px 이상 떨어뜨려 시야를 막지 않는다
    if (Sponsor) {
      var bw = GATE_W - 12;
      var bx = g.x + 6;
      var upper = top - 46;
      var lower = groundY - (bottom + 46);
      if (upper > 90) {
        var bhU = Math.min(150, upper - 12);
        Sponsor.drawPostBanner(ctx, Sponsor.pick(g.board), bx, top - 46 - bhU, bw, bhU, 0.92);
      }
      if (lower > 90) {
        var bhL = Math.min(150, lower - 12);
        Sponsor.drawPostBanner(ctx, Sponsor.pick(g.board + 1), bx, bottom + 46, bw, bhL, 0.92);
      }
    }

    // 바닥 받침
    if (groundY - bottom > 6) {
      ctx.fillStyle = 'rgba(20,30,45,0.35)';
      ctx.fillRect(g.x - 6, groundY - 6, GATE_W + 12, 6);
    }
  }

  // 공 5종. 무게가 다른 만큼 겉모습도 다르게 그린다.
  function paintBall(c, r, skin, spin) {
    c.save();
    c.rotate(spin);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);

    if (skin.style === 'gold') {
      var gg = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
      gg.addColorStop(0, skin.accent);
      gg.addColorStop(0.55, skin.base);
      gg.addColorStop(1, skin.patch);
      c.fillStyle = gg;
    } else if (skin.style === 'glossy') {
      var gl = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      gl.addColorStop(0, '#ffffff');
      gl.addColorStop(0.35, skin.base);
      gl.addColorStop(1, skin.patch);
      c.fillStyle = gl;
    } else {
      c.fillStyle = skin.base;
    }
    c.fill();
    c.lineWidth = skin.style === 'heavy' ? 3.5 : 2;
    c.strokeStyle = skin.style === 'heavy' ? skin.accent : '#16202c';
    c.stroke();

    c.save();
    c.beginPath();
    c.arc(0, 0, r - 1, 0, Math.PI * 2);
    c.clip();

    if (skin.style === 'worn') {                       // 낡은 가죽 — 오각형 + 조각들
      c.fillStyle = skin.patch;
      c.beginPath();
      c.moveTo(0, -r * 0.48); c.lineTo(r * 0.45, -r * 0.14);
      c.lineTo(r * 0.28, r * 0.4); c.lineTo(-r * 0.28, r * 0.4);
      c.lineTo(-r * 0.45, -r * 0.14);
      c.closePath(); c.fill();
      c.fillStyle = skin.accent;
      c.fillRect(-r, r * 0.55, r * 2, r * 0.22);
      c.globalAlpha = 0.35;
      c.fillRect(-r, -r * 0.9, r * 2, r * 0.16);
      c.globalAlpha = 1;
    } else if (skin.style === 'glossy') {              // 고무 — 굵은 띠 + 하이라이트
      c.strokeStyle = skin.patch;
      c.lineWidth = r * 0.28;
      c.beginPath();
      c.ellipse(0, 0, r * 0.98, r * 0.42, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath();
      c.ellipse(-r * 0.35, -r * 0.4, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
      c.fill();
    } else if (skin.style === 'heavy') {               // 중량구 — 주황 밴드 + 무게 표시
      c.fillStyle = skin.patch;
      c.fillRect(-r, -r * 0.22, r * 2, r * 0.44);
      c.fillStyle = skin.accent;
      c.beginPath();
      c.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = skin.base;
      c.beginPath();
      c.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      c.fill();
    } else if (skin.style === 'panel') {               // 경기구 — 곡선 패널 3장
      c.strokeStyle = skin.patch;
      c.lineWidth = r * 0.2;
      for (var k = 0; k < 3; k++) {
        c.save();
        c.rotate((k * Math.PI * 2) / 3);
        c.beginPath();
        c.arc(r * 1.05, 0, r * 0.85, Math.PI * 0.65, Math.PI * 1.35);
        c.stroke();
        c.restore();
      }
      c.fillStyle = skin.accent;
      c.beginPath();
      c.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      c.fill();
    } else if (skin.style === 'gold') {                // 골든볼 — 별 + 반짝임
      c.fillStyle = skin.patch;
      c.beginPath();
      for (var i = 0; i < 10; i++) {
        var ang = (Math.PI / 5) * i - Math.PI / 2;
        var rad = i % 2 === 0 ? r * 0.52 : r * 0.22;
        c.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      c.closePath();
      c.fill();
      c.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(clock * 3));
      c.fillStyle = '#ffffff';
      c.fillRect(-r * 0.75, -r * 0.62, r * 0.3, 2);
      c.fillRect(-r * 0.62, -r * 0.75, 2, r * 0.3);
      c.globalAlpha = 1;
    }
    c.restore();
    c.restore();
  }

  function drawBall() {
    var skin = E.selectedBall(profile).skin;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    // 그림자
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(2, 4, 15, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    paintBall(ctx, 15, skin, ball.spin);
    ctx.restore();
  }

  /* ------------------------------------------------------------ 킥오프 */

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* ---------------------------------------------------- 선수 (흰색 유니폼) */

  // 우리 게임의 자체 엠블럼. 실제 구단·연맹·스폰서 로고는 쓰지 않는다.
  var KIT = {
    jersey: '#ffffff', jerseyShade: '#dbe3ec',
    shorts: '#ffffff', shortsShade: '#cdd7e2',
    skin: '#c98a5b', skinShade: '#a06a41',
    hair: '#171d28', sock: '#f2f6fb', boot: '#ff9933',
    trimA: '#ff9933', trimB: '#138808', line: '#16202c'
  };

  // SKY GOAL 크레스트 — 인도 국기색 방패 + 공
  function drawCrest(x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.moveTo(-5, -6);
    ctx.lineTo(5, -6);
    ctx.lineTo(5, 2);
    ctx.quadraticCurveTo(5, 7, 0, 9);
    ctx.quadraticCurveTo(-5, 7, -5, 2);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = KIT.trimA; ctx.fillRect(-6, -7, 12, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-6, -2, 12, 4);
    ctx.fillStyle = KIT.trimB; ctx.fillRect(-6, 2, 12, 9);
    ctx.restore();
    ctx.strokeStyle = KIT.line;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = KIT.line;
    ctx.beginPath();
    ctx.arc(0, 0, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLeg(hipY, angle, bend, skin, rad) {
    ctx.save();
    ctx.translate(0, hipY);
    ctx.rotate(angle * rad);
    ctx.lineCap = 'round';
    ctx.strokeStyle = skin;                       // 허벅지
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 32); ctx.stroke();
    ctx.translate(0, 32);
    ctx.rotate(-bend * rad);
    ctx.strokeStyle = skin;                       // 정강이 위쪽(맨다리)
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 13); ctx.stroke();
    ctx.strokeStyle = KIT.sock;                   // 양말
    ctx.lineWidth = 10.5;
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, 30); ctx.stroke();
    ctx.strokeStyle = KIT.trimA;                  // 양말 띠
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, 19); ctx.stroke();
    ctx.translate(0, 30);
    ctx.fillStyle = KIT.boot;                     // 축구화
    ctx.beginPath(); ctx.ellipse(4, 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = KIT.line;
    ctx.beginPath(); ctx.ellipse(4, 5, 12, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawArm(sx, shoulderY, angle, skin, rad) {
    ctx.save();
    ctx.translate(sx, shoulderY + 4);
    ctx.rotate(angle * rad);
    ctx.strokeStyle = KIT.jersey;                 // 반팔 소매
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 12); ctx.stroke();
    ctx.strokeStyle = KIT.trimB;
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(4, 12); ctx.stroke();
    ctx.strokeStyle = skin;                       // 팔뚝
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(0, 30); ctx.stroke();
    ctx.restore();
  }

  // 화면 높이에 맞춘 선수 크기 배율
  function playerScale() {
    return Math.max(1, Math.min(1.6, H / 700));
  }

  /**
   * 흰색 유니폼 선수. 이름·얼굴 특징·등번호가 없는 가상의 선수다.
   * pose = { frontLeg, frontBend, backLeg, backBend, lean, armF, armB, crouch, headTilt }
   */
  function drawPlayer(px, baseY, scale, pose, alpha) {
    var rad = Math.PI / 180;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    // 발밑 그림자 (점프 높이에 따라 옅어진다)
    var lift = Math.max(0, pose.crouch || 0);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.30 * Math.max(0.25, 1 - lift / 140)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(px + 6, groundY + 2, 30 * scale, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(px, baseY);
    ctx.scale(scale, scale);

    var hipY = -62 - (pose.crouch || 0);
    var shoulderY = hipY - 40;
    var sx = (pose.lean || 0) * 0.6;

    drawLeg(hipY, pose.backLeg, pose.backBend, KIT.skinShade, rad);   // 뒷다리
    drawArm(sx - 3, shoulderY, pose.armB, KIT.skinShade, rad);        // 뒷팔

    // 반바지
    ctx.fillStyle = KIT.shorts;
    ctx.beginPath();
    ctx.moveTo(-11, hipY - 4);
    ctx.lineTo(11, hipY - 4);
    ctx.lineTo(12, hipY + 15);
    ctx.lineTo(-12, hipY + 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = KIT.trimB;
    ctx.fillRect(9, hipY - 4, 3, 19);

    // 상의
    ctx.fillStyle = KIT.jersey;
    ctx.beginPath();
    ctx.moveTo(-10, hipY - 2);
    ctx.lineTo(sx - 12, shoulderY + 2);
    ctx.quadraticCurveTo(sx, shoulderY - 8, sx + 12, shoulderY + 2);
    ctx.lineTo(10, hipY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = KIT.jerseyShade;                 // 옆면 음영
    ctx.beginPath();
    ctx.moveTo(6, hipY - 2);
    ctx.lineTo(sx + 8, shoulderY + 2);
    ctx.lineTo(sx + 12, shoulderY + 2);
    ctx.lineTo(10, hipY - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = KIT.trimA;                       // 어깨 라인
    ctx.fillRect(sx - 12, shoulderY + 1, 24, 2.6);

    drawCrest(sx - 5, shoulderY + 15, 0.95);         // 자체 엠블럼

    drawLeg(hipY, pose.frontLeg, pose.frontBend, KIT.skin, rad);      // 앞다리
    drawArm(sx + 3, shoulderY, pose.armF, KIT.skin, rad);             // 앞팔

    // 목
    ctx.strokeStyle = KIT.skinShade;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + 1, shoulderY + 2);
    ctx.lineTo(sx + 3, shoulderY - 6);
    ctx.stroke();

    // 머리
    var hx = sx + 3 + (pose.headTilt || 0) * 0.25;
    var hy = shoulderY - 15;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate((pose.headTilt || 0) * rad * 0.5);
    ctx.fillStyle = KIT.skin;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = KIT.hair;                        // 머리카락
    ctx.beginPath();
    ctx.arc(0, -1, 11, Math.PI * 1.02, Math.PI * 2.12);
    ctx.lineTo(-9, 4);
    ctx.quadraticCurveTo(-12, -6, -4, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = KIT.skinShade;                   // 귀
    ctx.beginPath();
    ctx.arc(-2, 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  /* ------------------------------------------------------------ 킥오프 */

  function kickerPose(t) {
    var runT = 0.55;
    var A, bend, lean, arm;
    if (t < runT) {
      var r = Math.sin(t * 17);
      A = r * 40; bend = 26 + Math.max(0, -r) * 26; lean = 6; arm = -r * 34;
    } else if (t < kick.impactAt) {
      var k = (t - runT) / (kick.impactAt - runT);
      A = lerp(40, -66, easeOut(k)); bend = lerp(26, 56, k);
      lean = lerp(6, -10, k); arm = lerp(-32, 36, k);
    } else {
      var f = Math.min(1, (t - kick.impactAt) / 0.30);
      A = lerp(-66, 78, easeOut(f)); bend = lerp(56, 4, easeOut(f));
      lean = lerp(-10, 12, f); arm = lerp(36, -28, f);
    }
    return {
      frontLeg: A, frontBend: bend,
      backLeg: -A * 0.35, backBend: 12 + Math.max(0, A) * 0.15,
      lean: lean, armF: arm, armB: -arm * 0.8, crouch: 0, headTilt: lean * 0.4
    };
  }

  function drawKicker() {
    var t = kick.t;
    var scale = playerScale();
    var standX = ball.x - 58 * scale;
    var runT = 0.55;
    var px = t < runT ? lerp(kick.startX, standX, easeOut(t / runT)) : standX;
    var bob = t < runT ? Math.abs(Math.sin(t * 17)) * 4 : 0;
    var fade = 1;
    if (kick.launched) fade = Math.max(0, 1 - (t - kick.impactAt - 0.25) / 0.45);
    if (fade <= 0) return;
    drawPlayer(px, groundY + 2 - bob, scale, kickerPose(t), fade);
  }

  function drawKickoffText() {
    var t = kick.t;
    var pop = kick.launched ? Math.max(0, 1 - (t - kick.impactAt) / 0.5) : 1;
    if (pop <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, pop * 1.4);
    ctx.textAlign = 'center';
    var scale = kick.launched ? 1 + (1 - pop) * 0.25 : 1;
    ctx.translate(W / 2, H * 0.22);
    ctx.scale(scale, scale);
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(7,17,31,0.75)';
    ctx.strokeText('KICK OFF!', 0, 0);
    ctx.fillStyle = '#ff9933';
    ctx.fillText('KICK OFF!', 0, 0);
    if (!kick.launched) {
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('탭하면 바로 시작', 0, 26);
    }
    ctx.restore();
    ctx.textAlign = 'start';
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      var a = 1 - p.age / p.life;
      ctx.fillStyle = 'rgba(' + p.color + ',' + a.toFixed(3) + ')';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }

  function drawReadyHint() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, H * 0.42, W, 74);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('TAP TO START', W / 2, H * 0.42 + 32);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('탭 · 클릭 · 스페이스로 공을 띄우세요', W / 2, H * 0.42 + 56);
    ctx.textAlign = 'start';
  }

  function render() {
    drawBackground();
    for (var i = 0; i < gates.length; i++) drawGate(gates[i]);
    if (state === 'kickoff') drawKicker();
    if (state === 'ceremony') drawCeremony();
    drawSparks();
    if (ball) drawBall();
    drawPopups();
    if (state === 'ready') drawReadyHint();
    if (state === 'kickoff') drawKickoffText();
  }

  /* ------------------------------------------------------------ 루프 */

  // STORM / WORLD FINAL 에서 간헐적으로 번개가 친다
  function tickLightning(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt * 3.5);
    if (stage.key !== 'STORM' && stage.key !== 'WORLD_FINAL') return;
    flashAt -= dt;
    if (flashAt <= 0) {
      flash = 1;
      flashAt = 2.5 + Math.random() * 4.5;
    }
  }

  function frame(now) {
    var dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    dt = Math.min(dt, 1 / 30);             // 탭 전환 후 큰 점프 방지
    clock += dt;
    tickLightning(dt);
    if (state !== 'playing') updateCheer(dt);
    if (state === 'kickoff' || state === 'ready' || state === 'playing' ||
        state === 'ceremony') update(dt);
    if (state !== 'idle') render();
    else drawBackground();
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', function () {
    lastFrame = 0;
    if (document.hidden && state === 'playing') state = 'ready';   // 자동 일시정지
  });

  /* ------------------------------------------------------------ 입력 */

  function onPointerDown(e) {
    if (state === 'ready' || state === 'playing') {
      e.preventDefault();
      flap();
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.key === ' ') {
      if (state === 'ready' || state === 'playing') { e.preventDefault(); flap(); }
      else if (state === 'idle' || state === 'over') { e.preventDefault(); startRun(); }
    }
  });

  var muteBtn = $('btn-mute');
  function refreshMute() {
    var muted = profile.settings.muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('off', muted);
    if (audio) audio.setMuted(muted);
  }
  muteBtn.addEventListener('click', function () {
    profile.settings.muted = !profile.settings.muted;
    storage.save(profile);
    refreshMute();
    if (audio && !profile.settings.muted) { audio.unlock(); audio.tap(); }
  });
  if (!AudioLib) muteBtn.classList.add('hidden');

  $('mode-amateur').addEventListener('click', function () { chooseMode('amateur'); });
  $('mode-pro').addEventListener('click', function () { chooseMode('pro'); });
  $('btn-balls').addEventListener('click', showBalls);
  $('btn-balls-close').addEventListener('click', showStart);
  $('btn-settings').addEventListener('click', showSettings);
  $('btn-settings-close').addEventListener('click', showStart);
  $('btn-settings-reset').addEventListener('click', function () {
    profile.settings.ballFine = 50;
    profile.settings.speed = 50;
    applySettings(true);
  });
  $('set-fine').addEventListener('input', function () {
    profile.settings.ballFine = parseInt(this.value, 10);
    applySettings(true);
    if (audio) audio.tap();
  });
  $('set-speed').addEventListener('input', function () {
    profile.settings.speed = parseInt(this.value, 10);
    applySettings(true);
  });

  $('btn-start').addEventListener('click', startRun);
  $('btn-retry').addEventListener('click', startRun);
  $('btn-home').addEventListener('click', showStart);
  $('btn-giveup').addEventListener('click', finalizeRun);
  $('btn-continue').addEventListener('click', function () {
    if (!rewardProvider) { finalizeRun(); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = '광고 불러오는 중...';
    rewardProvider(function (granted) {
      btn.disabled = false;
      btn.textContent = '광고 보고 이어하기';
      if (granted) {
        if (audio) { audio.unlock(); audio.startMusic(musicLevel()); }
        continueRun();
      } else {
        finalizeRun();
      }
    });
  });
  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('플레이어 데이터를 초기화할까요?')) return;
    profile = storage.reset();
    storage.save(profile);
    refreshMute();
    showStart();
  });
  var statButtons = screenResult.querySelectorAll('button[data-stat]');
  for (var b = 0; b < statButtons.length; b++) {
    statButtons[b].addEventListener('click', function () {
      if (E.spendStatPoint(profile, this.getAttribute('data-stat'))) {
        storage.save(profile);
        refreshStatBox();
      }
    });
  }

  /* ------------------------------------------------------------ 시작 */

  resize();
  refreshMute();
  E.loadModeState(profile);        // 저장된 모드 상태를 최상위 필드로 꺼낸다
  applySettings(false);
  showStart();
  requestAnimationFrame(frame);

  // 네이티브 앱(안드로이드 WebView)이 있으면 보상형 광고를 이어하기에 연결한다.
  if (bridge && typeof bridge.showRewarded === 'function') {
    rewardProvider = function (cb) {
      pendingReward = cb;
      try {
        bridge.showRewarded();
      } catch (e) {
        pendingReward = null;
        cb(false);
      }
    };
  }

  // 자동화 테스트/디버깅용 훅
  window.SkyGoal = {
    engine: E,
    audio: function () { return audio; },
    scenery: function () { return scenery; },
    getProfile: function () { return profile; },
    getState: function () { return state; },
    getRun: function () { return run; },
    start: startRun,
    flap: flap,
    forceEnd: function () {
      if (state === 'kickoff') beginPlay();
      if (state === 'ready') state = 'playing';
      endRun();
    },
    home: showStart,
    settings: showSettings,
    balls: showBalls,
    paintBall: paintBall,          // 아트 확인용
    getArena: function () { return arena; },
    // 보상형 광고 제공자 주입: fn(callback) → callback(성공 여부)
    setRewardProvider: function (fn) { rewardProvider = typeof fn === 'function' ? fn : null; },
    hasRewardProvider: function () { return !!rewardProvider; },
    // 안드로이드가 광고 시청 결과를 이 함수로 돌려준다
    onRewardResult: function (granted) {
      var cb = pendingReward;
      pendingReward = null;
      if (cb) cb(!!granted);
    },
    canContinue: canContinue,
    continueRun: continueRun,
    finalizeRun: finalizeRun,
    debug: function () {
      return {
        ball: ball ? { x: ball.x, y: ball.y, vy: ball.vy } : null,
        gates: gates.map(function (g) { return { x: g.x, mid: g.mid, baseMid: g.baseMid, gap: g.gap, passed: g.passed }; }),
        arena: arena,
        stage: stage.key,
        gateWidth: GATE_W,
        endReason: lastEndReason,
        kick: kick ? { t: kick.t, launched: kick.launched } : null,
        boards: Sponsor ? Sponsor.count() : 0,
        ceremony: ceremony ? { t: +ceremony.t.toFixed(2), lift: Math.round(ceremony.lift),
                               gift: ceremony.gift } : null,
        cheer: cheer ? {
          count: cheer.girls.length,
          excite: +cheer.excite.toFixed(2),
          baseY: cheerBaseY(),
          bits: cheer.bits.length
        } : null,
        size: { w: W, h: H, groundY: groundY }
      };
    },
    // 자동화 테스트용
    debugClearGates: function () { gates = []; },
    debugRefreshStage: function () { if (run) refreshStage(); },
    // 아트 확인용: 특정 스테이지 연출을 즉시 적용한다
    previewStage: function (key) {
      for (var i = 0; i < E.STAGES.length; i++) {
        if (E.STAGES[i].key === key) stage = E.STAGES[i];
      }
      arena = E.arenaParams(run ? run.difficulty : profile.difficulty, stage, profile.stats,
                            profile.settings, E.selectedBall(profile), profile.mode);
      if (run) run.stage = stage.key;
      if (audio) audio.setIntensity(musicLevel());
      updateHud();
      return stage.key;
    }
  };
})();
