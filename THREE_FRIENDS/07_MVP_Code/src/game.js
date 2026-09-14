/*
 * 세 친구의 여행 — 게임 셸 (렌더링 / 입력 / 화면 전환)
 * 로직은 전부 FriendsEngine 에 있고, 이 파일은 그것을 화면에 연결한다.
 */
(function () {
  'use strict';

  var E = window.FriendsEngine;
  if (!E) { console.error('FriendsEngine 을 찾을 수 없습니다.'); return; }

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c');
  var ctx = canvas.getContext('2d');
  var panel = $('panel');
  var hud = $('hud');
  var screenStart = $('screen-start');
  var screenResult = $('screen-result');
  var leaderBar = $('leaderbar');

  var storage = E.createStorage();
  var profile = storage.load();

  var W = 0, H = 0, groundY = 0;
  var state = 'idle';            // idle | playing | over
  var run = null;
  var party = null;              // 세 친구의 공통 상태
  var obstacles = [];
  var acorns = [];
  var puffs = [];
  var popups = [];
  var tiki = null;               // 진행 중인 티키타카
  var parade = 0;                // 남은 퍼레이드 시간(초)
  var arena = null;
  var elapsed = 0;
  var lastFrame = 0;
  var scroll = 0;
  var nextObstacleAt = 0;
  var nextTikiAt = 0;
  var nextAcornAt = 0;
  var shake = 0;

  var ACTION_TIME = 0.45;        // 탭 한 번이 유효한 시간
  var ACTION_TIME_ASSIST = 0.9;  // 보조 모드에서는 두 배로 넓힌다
  var HEARTS = 3;
  var PARTY_X_RATIO = 0.40;

  /* ------------------------------------------------------------- 캔버스 */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    groundY = H * 0.70;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ---------------------------------------------------------- 화면 전환 */

  function partyX() { return W * PARTY_X_RATIO; }

  function showStart() {
    state = 'idle';
    run = null;
    obstacles = [];
    acorns = [];
    puffs = [];
    popups = [];
    tiki = null;
    parade = 0;
    arena = E.params(profile.difficulty);
    party = makeParty();
    refreshStartScreen();
    screenResult.classList.add('hidden');
    screenStart.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
    leaderBar.classList.add('hidden');
  }

  function refreshStartScreen() {
    $('s-acorn').textContent = profile.acorns;
    $('s-best').textContent = profile.bestScore;
    $('s-diff').textContent = Math.round(profile.difficulty);
    $('s-games').textContent = profile.metrics.games;
    var u = profile.metrics.usage;
    $('s-usage').textContent = E.CHARACTERS.map(function (c) {
      return c.name + ' ' + (u[c.id] || 0);
    }).join(' · ');
    $('assist').checked = profile.settings.assist !== false;
  }

  /* -------------------------------------------------------------- 시작 */

  function makeParty() {
    return {
      leader: E.characterById(profile.leader).id,
      y: 0, vy: 0, jumping: false,
      glide: 0, spin: 0,
      actionUntil: -1, actionKind: null,
      hearts: HEARTS, stumble: 0, bob: 0
    };
  }

  function startRun() {
    arena = E.params(profile.difficulty);
    party = makeParty();
    run = {
      score: 0, distance: 0, acorns: 0,
      obstacles: 0, cleared: 0,
      tikitakaTries: 0, tikitakaHits: 0, tikitakaStreak: 0, parades: 0,
      cleanStreak: 0, bestCleanStreak: 0,
      usage: {}, clearedBy: { nubi: 0, wobi: 0, saro: 0 },
      missions: E.rollMissions(Math.random, 3),
      tikitakaCap: E.TIKITAKA_CAP
    };
    run.usage[party.leader] = 1;
    obstacles = [];
    acorns = [];
    puffs = [];
    popups = [];
    tiki = null;
    parade = 0;
    elapsed = 0;
    scroll = 0;
    shake = 0;
    nextObstacleAt = 1.8;
    nextTikiAt = 2.6;
    nextAcornAt = 0.8;
    state = 'playing';
    renderMissionList();
    renderLeaderBar();
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    leaderBar.classList.remove('hidden');
    updateHud();
  }

  /* ------------------------------------------------------------- 입력 */

  // 리더 교체. 티키타카 중에도 자유롭게 바꿀 수 있다.
  function setLeader(id) {
    if (!party) return false;
    var c = E.characterById(id);
    if (party.leader === c.id) return false;
    party.leader = c.id;
    profile.leader = c.id;
    if (run) run.usage[c.id] = (run.usage[c.id] || 0) + 1;
    renderLeaderBar();
    return true;
  }

  /**
   * 탭 하나로 두 가지를 한다.
   *   - 티키타카가 떠 있으면 그것에 답한다
   *   - 아니면 리더의 행동을 쓴다
   * 장애물이 코앞일 때는 티키타카를 띄우지 않으므로 둘이 겹치지 않는다.
   */
  function tap() {
    if (state === 'idle') { startRun(); return; }
    if (state !== 'playing') return;
    if (tiki && tiki.age <= tiki.window) { answerTikitaka(); return; }
    doAction();
  }

  // 보조 모드는 리더를 대신 바꿔 줄 뿐 아니라 탭 판정도 넓힌다.
  // 리더만 맞춰 주고 0.45초 안에 누르라고 하면 저연령에게는 여전히 어렵다.
  function actionTime() {
    return profile.settings.assist !== false ? ACTION_TIME_ASSIST : ACTION_TIME;
  }

  function doAction() {
    var c = E.characterById(party.leader);
    party.actionUntil = elapsed + actionTime();
    party.actionKind = c.action;
    if (c.action === 'jump' && !party.jumping) {
      party.jumping = true;
      party.vy = -430;
    } else if (c.action === 'glide') {
      party.glide = 0.55;
    } else if (c.action === 'spin') {
      party.spin = 0.5;
    }
    puff(partyX() - 14, groundY, 5, '255,255,255');
  }

  function actionActive() {
    return party && elapsed <= party.actionUntil;
  }

  /* ---------------------------------------------------------- 티키타카 */

  function spawnTikitaka() {
    var t = E.rollTikitaka(Math.random);
    tiki = { info: t, age: 0, window: arena.tikitakaWindow, done: false };
    run.tikitakaTries += 1;
  }

  function answerTikitaka() {
    if (!tiki || tiki.done) return;
    tiki.done = true;
    tiki.hit = true;
    run.tikitakaHits += 1;
    run.tikitakaStreak += 1;
    run.acorns += 5;
    run.score += 6;
    popup('+5 ' + tiki.info.text, H * 0.30);
    puff(partyX(), groundY - 70, 10, '255,215,90');
    if (run.tikitakaStreak >= E.PARADE_STREAK) {
      run.tikitakaStreak = 0;
      run.parades += 1;
      parade = E.PARADE_SECONDS;
      popup('HAPPY PARADE!', H * 0.22);
      puff(partyX(), groundY - 40, 26, '255,190,80');
    }
    updateHud();
  }

  // 실패해도 벌은 없다. 장난이 벌이 되면 저연령이 먼저 떠난다.
  function missTikitaka() {
    run.tikitakaStreak = 0;
    tiki = null;
  }

  /* ---------------------------------------------------------- 장애물 */

  function spawnObstacle() {
    var o = E.rollObstacle(profile.metrics.usage, arena.difficulty, Math.random);
    obstacles.push({ type: o, x: W + 60, resolved: false });
    run.obstacles += 1;
  }

  function resolveObstacle(ob) {
    ob.resolved = true;
    var need = ob.type.need;
    var ok = parade > 0 || (party.leader === need && actionActive());
    if (ok) {
      run.cleared += 1;
      run.clearedBy[need] = (run.clearedBy[need] || 0) + 1;
      run.cleanStreak += 1;
      run.bestCleanStreak = Math.max(run.bestCleanStreak, run.cleanStreak);
      run.score += 12 + Math.min(20, run.cleanStreak * 2);
      run.acorns += 6;
      popup('+' + (12 + Math.min(20, run.cleanStreak * 2)), H * 0.34);
      puff(partyX() + 30, groundY - 30, 10, '160,240,180');
    } else {
      run.cleanStreak = 0;
      party.hearts -= 1;
      party.stumble = 0.7;
      shake = 0.35;
      popup(E.characterById(need).name + ' 가 필요했어!', H * 0.34);
      puff(partyX() + 20, groundY - 20, 14, '255,140,120');
      if (party.hearts <= 0) return endRun();
    }
    updateHud();
  }

  /* -------------------------------------------------------------- 루프 */

  function update(dt) {
    if (state !== 'playing') return;
    elapsed += dt;

    var speed = arena.walkSpeed * (parade > 0 ? 1.25 : 1) * (party.stumble > 0 ? 0.55 : 1);
    run.distance += speed * dt;
    run.score += speed * dt * 0.02;
    scroll += speed * dt;
    party.bob += dt * (speed / 26);
    if (party.stumble > 0) party.stumble -= dt;
    if (parade > 0) parade -= dt;
    if (shake > 0) shake -= dt;

    // 리더 물리 (점프 / 활공 / 회전)
    if (party.jumping) {
      var g = party.glide > 0 ? 520 : 1250;
      party.vy += g * dt;
      party.y += party.vy * dt;
      if (party.y >= 0) { party.y = 0; party.vy = 0; party.jumping = false; }
    }
    if (party.glide > 0) party.glide -= dt;
    if (party.spin > 0) party.spin -= dt;

    // 장애물
    nextObstacleAt -= dt;
    if (nextObstacleAt <= 0) {
      spawnObstacle();
      nextObstacleAt = arena.obstacleGap / speed + Math.random() * 0.6;
    }
    for (var i = obstacles.length - 1; i >= 0; i--) {
      var ob = obstacles[i];
      ob.x -= speed * dt;
      if (!ob.resolved && ob.x <= partyX()) { resolveObstacle(ob); if (state !== 'playing') return; }
      if (ob.x < -90) obstacles.splice(i, 1);
    }

    // 도토리
    nextAcornAt -= dt;
    if (nextAcornAt <= 0) {
      // 점프 최고점은 약 74px 다. 그보다 높이 두면 영영 먹을 수 없는 도토리가 된다.
      acorns.push({ x: W + 30, y: groundY - 28 - Math.random() * 72, got: false });
      nextAcornAt = 0.5 + Math.random() * 0.7;
    }
    var leaderY = groundY + party.y;
    for (var a = acorns.length - 1; a >= 0; a--) {
      var ac = acorns[a];
      ac.x -= speed * dt;
      var reach = party.spin > 0 ? 110 : 58;       // 꼬리 회전이면 넓게 줍는다
      if (!ac.got && Math.abs(ac.x - partyX()) < reach &&
          Math.abs(ac.y - (leaderY - 34)) < reach) {
        ac.got = true;
        run.acorns += parade > 0 ? 2 : 1;
        run.score += 1;
      }
      if (ac.got || ac.x < -40) acorns.splice(a, 1);
    }

    // 티키타카 — 장애물이 코앞이면 띄우지 않는다 (탭이 겹치지 않게)
    var busy = obstacles.some(function (o) {
      return !o.resolved && o.x - partyX() < arena.reactWindow * speed + 60;
    });
    if (!tiki && !busy) {
      nextTikiAt -= dt;
      if (nextTikiAt <= 0) {
        spawnTikitaka();
        nextTikiAt = arena.tikitakaEvery + Math.random() * 2;
      }
    }
    if (tiki) {
      tiki.age += dt;
      if (!tiki.done && tiki.age > tiki.window) missTikitaka();
      else if (tiki.done && tiki.age > tiki.window + 0.5) tiki = null;
    }

    // 저연령 보조: 장애물이 다가오면 리더를 알아서 바꿔 준다
    if (profile.settings.assist !== false) {
      var next = null;
      obstacles.forEach(function (o) {
        if (o.resolved) return;
        if (!next || o.x < next.x) next = o;
      });
      if (next && next.x - partyX() < arena.reactWindow * speed * 0.8) {
        if (party.leader !== next.type.need) setLeader(next.type.need);
      }
    }

    updatePuffs(dt);
    updatePopups(dt);
    if (elapsed % 0.25 < dt) updateHud();
  }

  function endRun() {
    if (state !== 'playing') return;
    state = 'over';
    var sum = E.commitRun(profile, run);
    storage.save(profile);
    showResult(sum);
  }

  /* -------------------------------------------------------------- 연출 */

  function puff(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      puffs.push({ x: x, y: y, vx: (Math.random() - 0.5) * 180,
        vy: -40 - Math.random() * 160, life: 0.4 + Math.random() * 0.4, age: 0, c: color });
    }
  }
  function updatePuffs(dt) {
    for (var i = puffs.length - 1; i >= 0; i--) {
      var p = puffs[i];
      p.age += dt;
      if (p.age >= p.life) { puffs.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt;
    }
  }
  function popup(text, y) {
    popups.push({ x: W * 0.5, y: y === undefined ? H * 0.32 : y, text: text, age: 0, life: 1.2 });
  }
  function updatePopups(dt) {
    for (var i = popups.length - 1; i >= 0; i--) {
      popups[i].age += dt;
      popups[i].y -= 30 * dt;
      if (popups[i].age >= popups[i].life) popups.splice(i, 1);
    }
  }

  /* -------------------------------------------------------------- 렌더 */

  function drawBackground() {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    if (parade > 0) { sky.addColorStop(0, '#ffd9a0'); sky.addColorStop(1, '#ffeccd'); }
    else { sky.addColorStop(0, '#8fd4f5'); sky.addColorStop(1, '#dff3ff'); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 구름 — 하늘이 통째로 비어 보이지 않게
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    for (var cl = 0; cl < 4; cl++) {
      var cx = ((cl * 260 - scroll * 0.12) % (W + 320)) - 160;
      var cy = H * (0.10 + (cl % 3) * 0.07);
      var cs = 1 + (cl % 2) * 0.4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 34 * cs, 16 * cs, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 26 * cs, cy + 4 * cs, 24 * cs, 12 * cs, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 26 * cs, cy + 5 * cs, 20 * cs, 10 * cs, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 먼 언덕 (패럴랙스)
    for (var layer = 0; layer < 2; layer++) {
      var k = layer === 0 ? 0.18 : 0.38;
      var base = groundY - (layer === 0 ? 70 : 34);
      ctx.fillStyle = layer === 0 ? '#a8dcb4' : '#7fc98f';
      ctx.beginPath();
      ctx.moveTo(0, base + 60);
      for (var x = 0; x <= W + 80; x += 40) {
        var wx = x + ((-scroll * k) % 160);
        ctx.lineTo(x, base - Math.sin((wx + layer * 90) / 95) * 26);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
    }

    // 나무
    ctx.fillStyle = '#5aa86c';
    for (var t = 0; t < 6; t++) {
      var tx = ((t * 210 - scroll * 0.55) % (W + 260)) - 130;
      var ty = groundY - 26;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + 26, ty - 58);
      ctx.lineTo(tx + 52, ty);
      ctx.closePath();
      ctx.fill();
    }

    // 땅
    ctx.fillStyle = '#67b96f';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = '#4f9c57';
    ctx.fillRect(0, groundY, W, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (var g = 0; g < 20; g++) {
      var gx = ((g * 70 - scroll) % (W + 140)) - 70;
      ctx.beginPath();
      ctx.moveTo(gx, groundY + 16);
      ctx.lineTo(gx + 10, groundY + 8);
      ctx.stroke();
    }
  }

  // 캐릭터 하나. leader 면 크고 앞에 선다.
  function drawFriend(c, x, y, s, isLeader, phase) {
    var col = c.color;
    ctx.save();
    ctx.translate(x, y);
    var hop = Math.abs(Math.sin(phase)) * (isLeader ? 5 : 3);
    ctx.translate(0, -hop);
    if (isLeader && party.spin > 0) ctx.rotate(elapsed * 16);
    ctx.scale(s, s);

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 4 + hop, 20, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 몸
    ctx.beginPath();
    ctx.ellipse(0, -20, 19, 20, 0, 0, Math.PI * 2);
    ctx.fillStyle = col.body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2b2b33';
    ctx.stroke();

    if (c.id === 'nubi') {                       // 판다 — 귀와 눈 주변
      ctx.fillStyle = col.mark;
      [[-13, -36], [13, -36]].forEach(function (p) {
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
      });
      [[-7, -24], [7, -24]].forEach(function (p) {
        ctx.beginPath(); ctx.ellipse(p[0], p[1], 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      });
    } else if (c.id === 'wobi') {                // 퍼핀 — 흰 배, 주황 부리
      ctx.fillStyle = col.mark;
      ctx.beginPath();
      ctx.ellipse(0, -16, 12, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.moveTo(-6, -26); ctx.lineTo(8, -23); ctx.lineTo(-6, -19);
      ctx.closePath(); ctx.fill();
      if (party.glide > 0 && isLeader) {         // 활공 날개
        ctx.fillStyle = col.mark;
        ctx.beginPath();
        ctx.ellipse(-22, -22, 14, 5, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(22, -22, 14, 5, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {                                     // 다람쥐 — 큰 꼬리
      ctx.fillStyle = col.body;
      ctx.beginPath();
      ctx.ellipse(-22, -28, 9, 17, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2b2b33';
      ctx.stroke();
      ctx.fillStyle = col.mark;
      ctx.beginPath();
      ctx.ellipse(0, -16, 10, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 눈 + 볼
    ctx.fillStyle = '#1b1f28';
    ctx.beginPath(); ctx.arc(-6, -25, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -25, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.cheek;
    ctx.beginPath(); ctx.arc(-12, -18, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(12, -18, 3.2, 0, Math.PI * 2); ctx.fill();

    // 다리
    ctx.strokeStyle = '#2b2b33';
    ctx.lineWidth = 3;
    var swing = Math.sin(phase) * 6;
    ctx.beginPath();
    ctx.moveTo(-6, -2); ctx.lineTo(-6 + swing, 4);
    ctx.moveTo(6, -2); ctx.lineTo(6 - swing, 4);
    ctx.stroke();
    ctx.restore();
  }

  function drawParty() {
    var px = partyX();
    var order = E.CHARACTERS.slice().sort(function (a, b) {
      return (a.id === party.leader ? 1 : 0) - (b.id === party.leader ? 1 : 0);
    });
    var slot = 0;
    order.forEach(function (c) {
      var isLeader = c.id === party.leader;
      var x = isLeader ? px : px - 58 - slot * 50;
      var y = groundY + (isLeader ? party.y : 0);
      if (!isLeader) slot++;
      drawFriend(c, x, y, isLeader ? 1.75 : 1.3, isLeader, party.bob + (isLeader ? 0 : slot));
    });

    if (party.stumble > 0) {                    // 넘어진 표시
      ctx.fillStyle = 'rgba(255,90,90,0.25)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawObstacles() {
    obstacles.forEach(function (ob) {
      var x = ob.x;
      var t = ob.type.id;
      ctx.save();
      ctx.translate(x, groundY);
      ctx.scale(1.4, 1.4);
      ctx.translate(-x, -groundY);
      if (t === 'log') {
        ctx.fillStyle = '#8a5a33';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x - 26, groundY - 34, 52, 34, 8)
                      : ctx.rect(x - 26, groundY - 34, 52, 34);
        ctx.fill();
        ctx.strokeStyle = '#5c3a20'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#c08b57';
        ctx.beginPath(); ctx.ellipse(x - 26, groundY - 17, 7, 17, 0, 0, Math.PI * 2); ctx.fill();
      } else if (t === 'gust') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x, groundY - 70 - i * 26, 22 + i * 6,
                  0.4 + Math.sin(elapsed * 4 + i) * 0.3, Math.PI * 1.5);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(180,220,255,0.35)';
        ctx.fillRect(x - 26, groundY - 140, 52, 140);
      } else {
        ctx.fillStyle = '#6b7280';               // 좁은 틈 — 바위 두 덩이
        [[-1, 0], [1, 0]].forEach(function (s) {
          ctx.beginPath();
          ctx.ellipse(x + s[0] * 40, groundY - 26, 26, 30, 0, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = '#414651'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, groundY - 56); ctx.lineTo(x, groundY); ctx.stroke();
      }
      // 필요한 친구 표시 — 다가올 때만 뜬다
      var dist = ob.x - partyX();
      if (!ob.resolved && dist < arena.reactWindow * arena.walkSpeed + 120) {
        var need = E.characterById(ob.type.need);
        ctx.fillStyle = party.leader === need.id ? 'rgba(80,200,120,0.95)' : 'rgba(255,255,255,0.95)';
        var badgeY = groundY - (t === 'gust' ? 168 : 80);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x - 28, badgeY, 56, 26, 9)
                      : ctx.rect(x - 28, badgeY, 56, 26);
        ctx.fill();
        ctx.strokeStyle = '#16202c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();                       // 장애물을 가리키는 꼬리
        ctx.moveTo(x - 6, badgeY + 26);
        ctx.lineTo(x + 6, badgeY + 26);
        ctx.lineTo(x, badgeY + 34);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#16202c';
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(need.name, x, badgeY + 18);
      }
      ctx.restore();
    });
  }

  function drawAcorns() {
    acorns.forEach(function (a) {
      ctx.save();
      ctx.translate(a.x, a.y + Math.sin(elapsed * 3 + a.x / 40) * 4);
      ctx.scale(1.35, 1.35);
      ctx.fillStyle = '#c98a3c';
      ctx.beginPath(); ctx.ellipse(0, 2, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4a22';
      ctx.beginPath(); ctx.ellipse(0, -5, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4a3016';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(0, 2, 7, 8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    });
  }

  function drawTikitaka() {
    if (!tiki) return;
    var px = partyX();
    var y = groundY - 150 + Math.min(0, party.y);
    var left = Math.max(0, 1 - tiki.age / tiki.window);
    ctx.save();
    ctx.translate(px - 10, y);
    ctx.fillStyle = tiki.done ? 'rgba(120,220,150,0.96)' : 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-72, -26, 144, 44, 14) : ctx.rect(-72, -26, 144, 44);
    ctx.fill();
    ctx.fillStyle = '#16202c';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tiki.done ? '까르르!' : tiki.info.text, 0, -4);
    if (!tiki.done) {                              // 남은 시간 게이지
      ctx.fillStyle = '#e3e8ee';
      ctx.fillRect(-56, 6, 112, 6);
      ctx.fillStyle = '#ff9933';
      ctx.fillRect(-56, 6, 112 * left, 6);
    }
    ctx.restore();
  }

  function drawEffects() {
    puffs.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = 'rgb(' + p.c + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    popups.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = '#16202c';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
    if (parade > 0) {
      ctx.fillStyle = 'rgba(255,180,60,0.16)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#b5560f';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('HAPPY PARADE  ' + parade.toFixed(1) + 's', W / 2, 44);
    }
  }

  function frame(ts) {
    var dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;
    update(dt);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    drawBackground();
    drawAcorns();
    drawObstacles();
    if (party) drawParty();
    drawTikitaka();
    drawEffects();
    ctx.restore();
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- HUD */

  function updateHud() {
    if (!run) return;
    $('hud-acorn').textContent = run.acorns;
    $('hud-dist').textContent = Math.round(run.distance / 10);
    $('hud-tiki').textContent = run.tikitakaHits;
    $('hud-heart').textContent = '♥'.repeat(Math.max(0, party.hearts));
    $('hud-mul').textContent = '×' + E.tikitakaMultiplier(run.tikitakaHits, run.tikitakaCap).toFixed(2);
    renderMissionList();
  }

  function renderMissionList() {
    var box = $('hud-missions');
    if (!run) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    run.missions.forEach(function (m) {
      var done = E.missionDone(m, run);
      var el = document.createElement('div');
      el.className = 'mrow' + (done ? ' done' : '');
      el.textContent = (done ? '✓ ' : '') + m.text +
        ' (' + Math.min(E.missionProgress(m, run), m.target) + '/' + m.target + ')';
      box.appendChild(el);
    });
  }

  function renderLeaderBar() {
    leaderBar.innerHTML = '';
    E.CHARACTERS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'leaderbtn' + (party && party.leader === c.id ? ' on' : '');
      b.setAttribute('data-char', c.id);
      b.innerHTML = '<b>' + c.name + '</b><span>' + c.actionKo + ' · ' + (i + 1) + '</span>';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setLeader(c.id);
      });
      leaderBar.appendChild(b);
    });
  }

  /* ---------------------------------------------------------- 결과 화면 */

  function showResult(sum) {
    $('r-score').textContent = Math.round(sum.score);
    $('r-acorn').textContent = '+' + sum.acorns;
    $('r-tiki').textContent = sum.tikitakaHits + '/' + sum.tikitakaTries;
    $('r-mul').textContent = '×' + sum.multiplier.toFixed(2);
    $('r-clear').textContent = sum.cleared + '/' + sum.obstacles;
    $('r-diff').textContent = Math.round(sum.difficulty) +
      ' (' + (sum.difficultyDelta >= 0 ? '+' : '') + sum.difficultyDelta.toFixed(1) + ')';

    var list = $('r-missions');
    list.innerHTML = '';
    sum.missions.forEach(function (m) {
      var li = document.createElement('li');
      li.className = m.done ? 'done' : '';
      li.textContent = (m.done ? '✓ ' : '· ') + m.text +
        ' (' + Math.min(m.progress, m.target) + '/' + m.target + ')' +
        (m.done ? '  +' + m.reward : '');
      list.appendChild(li);
    });

    $('r-note').textContent = sum.charactersUsed < 3
      ? '이번 판에는 친구 ' + sum.charactersUsed + '명만 썼어요. 셋을 다 쓰면 더 멀리 갑니다.'
      : '세 친구를 모두 썼습니다!';

    refreshStartScreen();
    screenStart.classList.add('hidden');
    screenResult.classList.remove('hidden');
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
    leaderBar.classList.add('hidden');
  }

  /* -------------------------------------------------------------- 이벤트 */

  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); tap(); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); tap(); return; }
    if (e.key === '1') setLeader('nubi');
    if (e.key === '2') setLeader('wobi');
    if (e.key === '3') setLeader('saro');
  });
  $('btn-start').addEventListener('click', function (e) { e.stopPropagation(); startRun(); });
  $('btn-retry').addEventListener('click', function (e) { e.stopPropagation(); startRun(); });
  $('btn-home').addEventListener('click', function (e) { e.stopPropagation(); showStart(); });
  $('btn-reset').addEventListener('click', function (e) {
    e.stopPropagation();
    profile = storage.reset();
    showStart();
  });
  $('assist').addEventListener('change', function () {
    profile.settings.assist = $('assist').checked;
    storage.save(profile);
  });

  /* -------------------------------------------------------------- 시작 */

  resize();
  showStart();
  requestAnimationFrame(frame);

  // 자동화 테스트/디버깅용
  window.Friends = {
    engine: E,
    getProfile: function () { return profile; },
    getRun: function () { return run; },
    getState: function () { return state; },
    getParty: function () { return party; },
    getTiki: function () { return tiki; },
    start: startRun,
    home: showStart,
    tap: tap,
    setLeader: setLeader,
    forceEnd: endRun,
    debugSpawnObstacle: function (id) {
      var o = id ? E.obstacleById(id) : E.rollObstacle(profile.metrics.usage, arena.difficulty, Math.random);
      obstacles.push({ type: o, x: W + 60, resolved: false });
      run.obstacles += 1;
      return o.id;
    },
    debugSpawnTikitaka: function () { tiki = null; spawnTikitaka(); return tiki.info.id; },
    debugExpireAction: function () { if (party) party.actionUntil = -1; },
    debugReachObstacle: function () {            // 맨 앞 장애물을 즉시 판정 지점으로
      var next = null;
      obstacles.forEach(function (o) { if (!o.resolved && (!next || o.x < next.x)) next = o; });
      if (next) next.x = partyX() - 1;
      return !!next;
    },
    debug: function () {
      return { parade: parade, obstacles: obstacles.length, acorns: acorns.length,
               elapsed: elapsed, actionTime: actionTime(), arena: arena };
    }
  };
})();
