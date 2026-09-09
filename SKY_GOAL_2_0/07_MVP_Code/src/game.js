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
  var usedContinue = false;          // 한 판에 이어하기는 1회
  var rewardProvider = null;         // 보상형 광고 제공자 (네이티브 앱에서 주입)
  var pendingReward = null;          // 광고 결과를 기다리는 콜백

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
    arena = E.arenaParams(profile.difficulty, stage, profile.stats, profile.settings, E.selectedBall(profile));
    refreshStartScreen();
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
                          profile.stats, profile.settings, E.selectedBall(profile));
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

  function refreshStartScreen() {
    $('s-skill').textContent = Math.round(profile.skill);
    $('s-diff').textContent = Math.round(profile.difficulty);
    $('s-best').textContent = profile.bestScore;
    $('s-level').textContent = profile.level;
    $('s-coin').textContent = profile.coins;
    $('s-games').textContent = profile.metrics.games;
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
    $('hud-stage').textContent = stage.label;
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
      passed: false
    };
  }

  function startRun() {
    stage = E.stageFor(0, profile.difficulty);
    arena = E.arenaParams(profile.difficulty, stage, profile.stats, profile.settings, E.selectedBall(profile));
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
    lastMid = kick.targetY;           // 첫 골문은 플레이 시작 높이 근처에서
    gates = [];
    sparks = [];
    for (var i = 0; i < 4; i++) gates.push(makeGate(W + 220 + i * GATE_SPACING));
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
      arena = E.arenaParams(run.difficulty, stage, profile.stats, profile.settings, E.selectedBall(profile));
      run.stage = stage.key;
      if (audio) { audio.stage(); audio.setIntensity(musicLevel()); }
    }
  }

  function update(dt) {
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
          if (audio) audio.perfect();
        } else {
          addSparks(g.x + GATE_W, g.mid, 6, '255,255,255');
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
    $('r-stage').textContent = stage.label;
    $('r-title').textContent = sum.score >= profile.bestScore && sum.score > 0 ? 'NEW BEST!' : 'GAME OVER';
    $('r-line').textContent = '점수 ' + sum.score + ' · 콤보 ' + sum.combo + ' · 퍼펙트 ' + sum.perfectCount;
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
    drawWeather();
    drawField();
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

  // 이름 없는 실루엣 선수. 실존 인물을 묘사하지 않는다.
  // 좌표는 "발이 땅에 닿은 지점"을 원점으로 두고 그린다 (위쪽이 음수).
  function drawKicker() {
    var t = kick.t;
    var scale = Math.max(1, Math.min(1.6, H / 700));
    var standX = ball.x - 58 * scale;
    var runT = 0.55;
    var px = t < runT ? lerp(kick.startX, standX, easeOut(t / runT)) : standX;
    var bob = t < runT ? Math.abs(Math.sin(t * 17)) * 4 : 0;

    var A, bend, lean, arm;
    if (t < runT) {                                   // 달려오기
      var r = Math.sin(t * 17);
      A = r * 40; bend = 26 + Math.max(0, -r) * 26; lean = 6; arm = -r * 34;
    } else if (t < kick.impactAt) {                   // 백스윙
      var k = (t - runT) / (kick.impactAt - runT);
      A = lerp(40, -66, easeOut(k)); bend = lerp(26, 56, k);
      lean = lerp(6, -10, k); arm = lerp(-32, 36, k);
    } else {                                          // 임팩트 → 팔로스루
      var f = Math.min(1, (t - kick.impactAt) / 0.30);
      A = lerp(-66, 78, easeOut(f)); bend = lerp(56, 4, easeOut(f));
      lean = lerp(-10, 12, f); arm = lerp(36, -28, f);
    }

    var fade = 1;
    if (kick.launched) fade = Math.max(0, 1 - (t - kick.impactAt - 0.25) / 0.45);
    if (fade <= 0) return;

    var rad = Math.PI / 180;
    ctx.save();
    ctx.globalAlpha = fade;

    // 발밑 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(px + 6, groundY + 2, 30 * scale, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(px, groundY + 2 - bob);
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0c1726';
    ctx.fillStyle = '#0c1726';

    var hipY = -62;
    var shoulderY = hipY - 36;
    var sx = lean * 0.6;

    // 지지 다리
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-5, -14);
    ctx.lineTo(3, -2);
    ctx.stroke();

    // 킥 다리 (허벅지 → 정강이 → 축구화)
    ctx.save();
    ctx.translate(0, hipY);
    ctx.rotate(A * rad);
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 32);
    ctx.stroke();
    ctx.translate(0, 32);
    ctx.rotate(-bend * rad);
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 30);
    ctx.stroke();
    ctx.translate(0, 30);
    ctx.fillStyle = '#ff9933';
    ctx.beginPath();
    ctx.ellipse(4, 2, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 몸통
    ctx.strokeStyle = '#0c1726';
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(sx, shoulderY);
    ctx.stroke();

    // 유니폼 띠 — 국기색, 팀·번호·이름 없음
    ctx.strokeStyle = '#ff9933';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-1, hipY - 12);
    ctx.lineTo(sx - 1, shoulderY + 11);
    ctx.stroke();

    // 팔
    ctx.strokeStyle = '#0c1726';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(sx, shoulderY + 5);
    ctx.lineTo(sx + arm * 0.5, shoulderY + 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, shoulderY + 5);
    ctx.lineTo(sx - arm * 0.42, shoulderY + 26);
    ctx.stroke();

    // 머리
    ctx.fillStyle = '#0c1726';
    ctx.beginPath();
    ctx.arc(sx + 2, shoulderY - 13, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
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
    drawSparks();
    if (ball) drawBall();
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
    if (state === 'kickoff' || state === 'ready' || state === 'playing') update(dt);
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
        size: { w: W, h: H, groundY: groundY }
      };
    },
    // 아트 확인용: 특정 스테이지 연출을 즉시 적용한다
    previewStage: function (key) {
      for (var i = 0; i < E.STAGES.length; i++) {
        if (E.STAGES[i].key === key) stage = E.STAGES[i];
      }
      arena = E.arenaParams(run ? run.difficulty : profile.difficulty, stage, profile.stats, profile.settings, E.selectedBall(profile));
      if (run) run.stage = stage.key;
      if (audio) audio.setIntensity(musicLevel());
      updateHud();
      return stage.key;
    }
  };
})();
