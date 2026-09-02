/*
 * SKY GOAL 2.0 — 게임 셸 (렌더링 / 입력 / 화면 전환)
 * 로직은 전부 SkyGoalEngine 에 있고, 이 파일은 그것을 화면에 연결한다.
 */
(function () {
  'use strict';

  var E = window.SkyGoalEngine;
  if (!E) { console.error('SkyGoalEngine 을 찾을 수 없습니다.'); return; }

  /* ------------------------------------------------------------ DOM 참조 */

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c');
  var ctx = canvas.getContext('2d');
  var panel = $('panel');
  var hud = $('hud');
  var screenStart = $('screen-start');
  var screenResult = $('screen-result');

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
    if (ball) ball.x = Math.min(ball.x, W * 0.45);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ---------------------------------------------------------- 화면 전환 */

  function showStart() {
    state = 'idle';
    run = null;
    ball = null;
    gates = [];
    sparks = [];
    stage = E.stageFor(0, profile.difficulty);
    arena = E.arenaParams(profile.difficulty, stage, profile.stats);
    refreshStartScreen();
    screenResult.classList.add('hidden');
    screenStart.classList.remove('hidden');
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
      amp: arena.movement * 12,
      speed: 0.7 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      passed: false
    };
  }

  function startRun() {
    stage = E.stageFor(0, profile.difficulty);
    arena = E.arenaParams(profile.difficulty, stage, profile.stats);
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
    ball = { x: W * 0.26, y: groundY * 0.5, vy: 0, vx: 0, spin: 0 };
    lastMid = ball.y;                 // 첫 골문은 공 높이 근처에서 시작한다
    gates = [];
    sparks = [];
    for (var i = 0; i < 4; i++) gates.push(makeGate(W + 220 + i * GATE_SPACING));
    elapsed = 0;
    lastTapAt = 0;
    state = 'ready';                  // 첫 입력 전까지 공이 떠 있는 준비 상태
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    updateHud();
  }

  function flap() {
    if (state === 'ready') {
      state = 'playing';
      lastTapAt = performance.now();
      ball.vy = arena.flap;
      return;
    }
    if (state !== 'playing') return;
    var now = performance.now();
    if (lastTapAt) run.tapIntervals.push(now - lastTapAt);
    lastTapAt = now;
    ball.vy = arena.flap;
    ball.spin = -0.5;
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
      arena = E.arenaParams(run.difficulty, stage, profile.stats);
      run.stage = stage.key;
    }
  }

  function update(dt) {
    if (state === 'ready') {
      // 준비 상태: 공이 살짝 위아래로 떠 있고 게이트는 멈춰 있다.
      ball.y += Math.sin(performance.now() / 300) * 18 * dt;
      return;
    }
    if (state !== 'playing') return;

    elapsed += dt;
    run.duration = elapsed;

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
        } else {
          addSparks(g.x + GATE_W, g.mid, 6, '255,255,255');
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

    // 파티클
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
    var summary = E.commitRun(profile, run);
    storage.save(profile);
    showResult(summary);
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

  var SKY = {
    DAY: ['#53b9ff', '#d8f3ff'],
    SUNSET: ['#ff7e3f', '#ffd9a0'],
    NIGHT: ['#08152f', '#274b73'],
    RAIN: ['#2e4457', '#7d94a5'],
    WIND: ['#3d6f8e', '#cfe6f2'],
    STORM: ['#0b1622', '#3a4b5c'],
    WORLD_FINAL: ['#1a0b2e', '#ff9933']
  };

  function drawBackground() {
    var pair = SKY[stage.key] || SKY.DAY;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pair[0]);
    g.addColorStop(1, pair[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 원경 관중석
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, groundY - 60, W, 60);

    if (stage.rain > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + 0.22 * stage.rain) + ')';
      ctx.lineWidth = 1;
      var t = performance.now() / 5;
      for (var i = 0; i < 90; i++) {
        var x = (i * 97 + t) % (W + 40) - 20;
        var y = (i * 53 + t * 1.6) % H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 7, y + 20);
        ctx.stroke();
      }
    }

    if (stage.wind > 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      for (var w = 0; w < 5; w++) {
        var wy = (w * 137 + (performance.now() / 6) % H) % H;
        ctx.beginPath();
        ctx.moveTo((performance.now() / 3 + w * 200) % (W + 300) - 150, wy);
        ctx.lineTo((performance.now() / 3 + w * 200) % (W + 300) - 60, wy);
        ctx.stroke();
      }
    }

    // 잔디
    ctx.fillStyle = '#1d6b39';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (var s = 0; s < W; s += 60) ctx.fillRect(s, groundY, 30, H - groundY);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, groundY, W, 2);
  }

  function drawGate(g) {
    var top = g.mid - g.gap / 2;
    var bottom = g.mid + g.gap / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(g.x, 0, GATE_W, top);
    ctx.fillRect(g.x, bottom, GATE_W, groundY - bottom);
    ctx.fillStyle = '#ff9933';
    ctx.fillRect(g.x - 4, top - 10, GATE_W + 8, 10);
    ctx.fillStyle = '#138808';
    ctx.fillRect(g.x - 4, bottom, GATE_W + 8, 10);
    // 골문 네트 느낌
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    for (var y = 10; y < top; y += 14) {
      ctx.beginPath(); ctx.moveTo(g.x, y); ctx.lineTo(g.x + GATE_W, y); ctx.stroke();
    }
    for (var y2 = bottom + 14; y2 < groundY; y2 += 14) {
      ctx.beginPath(); ctx.moveTo(g.x, y2); ctx.lineTo(g.x + GATE_W, y2); ctx.stroke();
    }
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.spin);
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#16202c';
    ctx.stroke();
    ctx.fillStyle = '#16202c';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(6.5, -2); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.lineTo(-6.5, -2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
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
    drawSparks();
    if (ball) drawBall();
    if (state === 'ready') drawReadyHint();
  }

  /* ------------------------------------------------------------ 루프 */

  function frame(now) {
    var dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    dt = Math.min(dt, 1 / 30);             // 탭 전환 후 큰 점프 방지
    if (state === 'ready' || state === 'playing') update(dt);
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

  $('btn-start').addEventListener('click', startRun);
  $('btn-retry').addEventListener('click', startRun);
  $('btn-home').addEventListener('click', showStart);
  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('플레이어 데이터를 초기화할까요?')) return;
    profile = storage.reset();
    storage.save(profile);
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
  showStart();
  requestAnimationFrame(frame);

  // 자동화 테스트/디버깅용 훅
  window.SkyGoal = {
    engine: E,
    getProfile: function () { return profile; },
    getState: function () { return state; },
    getRun: function () { return run; },
    start: startRun,
    flap: flap,
    forceEnd: function () { if (state === 'ready') state = 'playing'; endRun(); },
    home: showStart,
    debug: function () {
      return {
        ball: ball ? { x: ball.x, y: ball.y, vy: ball.vy } : null,
        gates: gates.map(function (g) { return { x: g.x, mid: g.mid, gap: g.gap, passed: g.passed }; }),
        arena: arena,
        stage: stage.key,
        gateWidth: GATE_W,
        endReason: lastEndReason,
        size: { w: W, h: H, groundY: groundY }
      };
    }
  };
})();
