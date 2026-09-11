/*
 * SKY GOAL 2.0 — 브라우저 스모크 테스트
 * 빌드된 단일 HTML 을 실제 Chromium 에서 띄워 콘솔 에러 없이 한 판이 돌아가는지 확인한다.
 *
 *   node tests/browser.smoke.mjs [--screenshot <dir>]
 *
 * playwright 가 없으면 (설치 선택 사항) 테스트를 건너뛴다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(HERE, '..', 'sky_goal_2_0.html');

const args = process.argv.slice(2);
const shotDir = args.includes('--screenshot') ? args[args.indexOf('--screenshot') + 1] : null;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  const globalRoot = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
  for (const name of candidates) {
    for (const spec of [name, path.join(globalRoot, name)]) {
      try { return require(spec); } catch { /* 다음 후보 */ }
    }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) {
  // 개발자 노트북에는 playwright 가 없을 수 있으니 건너뛴다.
  // 그러나 CI 에서 건너뛰면 초록불인데 아무것도 검증하지 않은 상태가 되므로,
  // REQUIRE_BROWSER=1 이면 건너뛰지 않고 실패시킨다.
  if (process.env.REQUIRE_BROWSER === '1') {
    console.error('[fail] playwright 를 찾을 수 없어 브라우저 스모크 테스트를 돌리지 못했습니다.\n        NODE_PATH 를 `npm root -g` 값으로 맞추세요.');
    process.exit(1);
  }
  console.log('[skip] playwright 가 설치되어 있지 않아 브라우저 스모크 테스트를 건너뜁니다.');
  process.exit(0);
}
if (!fs.existsSync(HTML)) {
  console.error('[fail] 빌드 산출물이 없습니다. 먼저 `python3 build.py` 를 실행하세요.');
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

// 정적 서버 (file:// 은 localStorage 가 막히는 브라우저가 있어 http 로 띄운다)
const server = http.createServer((req, res) => {
  const body = fs.readFileSync(HTML);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await pw.chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 820 } });
// 실제 배포본은 engine/getProfile()/getRun()/forceEnd() 같은 보상-조작 API 를
// 공개하지 않는다(콘솔 한 줄로 무한 보상을 받는 구멍이었다 — game.js 참고).
// 이 테스트는 상태를 직접 만들어 검증해야 하므로, 페이지가 실행되기 전에
// 이 플래그를 심어 테스트 전용으로만 열어준다. addInitScript 는 이 컨텍스트의
// 이후 모든 goto/reload 에 그대로 적용된다.
await context.addInitScript(() => { window.__SKYGOAL_TEST__ = true; });
const page = await context.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });

  check('시작 화면이 보인다', await page.isVisible('#screen-start'));
  check('경기 시작 전에는 지구 살리기 캠페인이 걸린다',
    (await page.evaluate(() => window.SkyGoal.debug().introBoard)) === 'earth',
    await page.evaluate(() => window.SkyGoal.debug().introBoard));
  check('엔진이 로드되었다', await page.evaluate(() => !!window.SkyGoalEngine));
  check('사운드·배경 모듈이 로드되었다',
    await page.evaluate(() => !!window.SkyGoalAudio && !!window.SkyGoalScenery));
  check('배경 레이어가 산 → 강 → 잔디 순으로 구성된다', await page.evaluate(() => {
    const L = window.SkyGoal.scenery().layout();
    return !!L && L.horizon < L.riverTop && L.riverTop < L.riverBottom;
  }));
  if (shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, '01-start.png') });
  }

  await page.click('#btn-start');
  check('경기 시작 → 킥오프 연출', (await page.evaluate(() => window.SkyGoal.getState())) === 'kickoff');
  check('HUD 가 표시된다', await page.isVisible('#hud'));

  // 킥오프: 공이 잔디에서 출발해 차인 뒤 플레이 위치로 올라온다
  const atRest = await page.evaluate(() => {
    const d = window.SkyGoal.debug();
    return { y: d.ball.y, ground: d.size.groundY };
  });
  check('킥오프 시작 시 공은 잔디 위에 있다', atRest.ground - atRest.y < 40,
    '공 ' + atRest.y.toFixed(0) + ' / 잔디 ' + atRest.ground.toFixed(0));
  await page.waitForFunction(() => window.SkyGoal.getState() === 'playing', null, { timeout: 5000 });
  const afterKick = await page.evaluate(() => {
    const d = window.SkyGoal.debug();
    return { y: d.ball.y, x: d.ball.x, ground: d.size.groundY, w: d.size.w };
  });
  check('킥이 끝나면 공이 떠오른 채 플레이가 시작된다',
    afterKick.y < afterKick.ground * 0.7 && Math.abs(afterKick.x - afterKick.w * 0.26) < 2,
    JSON.stringify(afterKick));

  // 실제 클릭(사용자 제스처)으로 오디오가 열리고 BGM 이 도는지
  await page.mouse.click(210, 500);
  const sound = await page.evaluate(() => {
    const a = window.SkyGoal.audio();
    return { available: !!a && a.available(), playing: !!a && a.isPlaying(), muted: !!a && a.isMuted() };
  });
  check('오디오 컨텍스트가 열린다', sound.available, JSON.stringify(sound));
  check('BGM 이 재생된다', sound.playing);

  // 자동 조종: 매 프레임 다음 골문을 겨냥해 탭하는 간단한 봇.
  // 봇이 완벽하지는 않으므로 최대 3판까지 시도해 "사람이 칠 수 있는 게임인지"만 확인한다.
  async function autoplay(msLimit) {
    await page.evaluate((limit) => {
      window.__best = 0;
      window.__done = false;
      const t0 = performance.now();
      const step = () => {
        const s = window.SkyGoal.getState();
        if (s === 'kickoff') {
          /* 킥오프 연출이 끝날 때까지 기다린다 */
        } else if (s === 'ready') {
          window.SkyGoal.flap();
        } else if (s === 'playing') {
          const d = window.SkyGoal.debug();
          const run = window.SkyGoal.getRun();
          if (run) window.__best = Math.max(window.__best, run.score);
          const b = d.ball;
          if (b) {
            const gate = d.gates
              .filter((g) => g.x + d.gateWidth > b.x - 6)
              .sort((g1, g2) => g1.x - g2.x)[0];
            const aim = gate ? gate.mid + gate.gap * 0.28 : d.size.groundY * 0.5;
            if (b.y + b.vy * 0.08 > aim) window.SkyGoal.flap();
          }
        } else {
          window.__done = true;
          return;
        }
        if (performance.now() - t0 > limit) { window.__done = true; return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, msLimit);
    await page.waitForFunction(() => window.__done, null, { timeout: msLimit + 15000 });
    return page.evaluate(() => window.__best);
  }

  let attempts = 1;
  const firstRun = autoplay(20000);
  if (shotDir) {
    await page.waitForTimeout(4000);                     // 플레이 중 화면 캡처
    await page.screenshot({ path: path.join(shotDir, '02-play.png') });
  }
  let midScore = await firstRun;
  while (midScore < 40 && attempts < 3) {
    await page.evaluate(() => { if (window.SkyGoal.getState() !== 'over') window.SkyGoal.forceEnd(); });
    await page.waitForSelector('#screen-result:not(.hidden)', { timeout: 5000 });
    await page.click('#btn-retry');
    attempts += 1;
    midScore = Math.max(midScore, await autoplay(20000));
  }
  check('자동 조종으로 골문을 여러 개 통과한다', midScore >= 40, 'score=' + midScore + ' (' + attempts + '판)');

  await page.evaluate(() => {
    if (window.SkyGoal.getState() !== 'over') window.SkyGoal.forceEnd();
  });
  await page.waitForSelector('#screen-result:not(.hidden)', { timeout: 5000 });
  check('결과 화면이 뜬다', await page.isVisible('#screen-result'));
  check('보상 코인이 표시된다', /^\+\d+$/.test((await page.textContent('#r-coin')).trim()));
  if (shotDir) await page.screenshot({ path: path.join(shotDir, '03-result.png') });

  const saved = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    return { games: p.metrics.games, coins: p.coins, difficulty: p.difficulty, stored: !!localStorage.getItem(window.SkyGoalEngine.STORAGE_KEY) };
  });
  check('플레이한 판수가 프로필에 기록된다', saved.games === attempts, JSON.stringify(saved));
  check('localStorage 에 저장된다', saved.stored);
  check('난이도가 유효 범위 안에 있다', saved.difficulty >= 10 && saved.difficulty <= 95, 'D=' + saved.difficulty.toFixed(1));

  // 새로고침 후에도 프로필이 유지되는지
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
  const reloaded = await page.evaluate(() => window.SkyGoal.getProfile().metrics.games);
  check('새로고침 후 저장된 프로필을 복구한다', reloaded === attempts, 'games=' + reloaded);

  // 다시 시작 → 재시작 경로 확인
  await page.click('#btn-start');
  await page.evaluate(() => window.SkyGoal.forceEnd());
  await page.waitForSelector('#screen-result:not(.hidden)', { timeout: 5000 });
  await page.click('#btn-retry');
  check('결과 화면에서 재시작된다',
    (await page.evaluate(() => window.SkyGoal.getState())) === 'kickoff');

  // 회전/리사이즈
  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(300);
  // 음소거 설정
  await page.click('#btn-mute');
  const mutedNow = await page.evaluate(() => ({
    flag: window.SkyGoal.getProfile().settings.muted,
    icon: document.getElementById('btn-mute').textContent
  }));
  check('음소거 버튼이 상태를 바꾼다', mutedNow.flag === true, 'icon=' + mutedNow.icon);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
  check('음소거 설정이 새로고침 후에도 유지된다',
    await page.evaluate(() => window.SkyGoal.getProfile().settings.muted === true));
  await page.click('#btn-mute');
  check('음소거를 다시 해제할 수 있다',
    await page.evaluate(() => window.SkyGoal.getProfile().settings.muted === false));

  check('리사이즈 후에도 렌더가 살아있다', (await page.evaluate(() => window.SkyGoal.debug().size.w)) > 800);
  check('리사이즈 후 배경도 다시 계산된다',
    await page.evaluate(() => window.SkyGoal.scenery().layout().span >= 640));
  check('가로 스크롤이 생기지 않는다',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // 모드 (아마추어 / 프로)
  // 앞 단계(완주·고득점)에서 이미 해금됐을 수 있으므로 잠긴 상태로 되돌리고 시작한다
  await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.metrics.clears = 0;
    p.bestScore = 0;
    p.modes.amateur.bestScore = 0;
    p.modes.pro.bestScore = 0;
    p.mode = 'amateur';
    window.SkyGoal.engine.loadModeState(p);
    window.SkyGoal.home();
  });
  const locked = await page.evaluate(() => ({
    mode: window.SkyGoal.getProfile().mode,
    proLocked: document.getElementById('mode-pro').classList.contains('locked')
  }));
  check('처음에는 아마추어이고 프로는 잠겨 있다',
    locked.mode === 'amateur' && locked.proLocked, JSON.stringify(locked));
  // 시작 화면이 길어지면(장비 버튼처럼 항목이 늘어나면) 작은 화면에서
  // 위쪽 버튼이 잘려 손이 닿지 않는 일이 생긴다. 회귀로 막는다.
  const reach = await page.evaluate(async () => {
    document.getElementById('panel').scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(r));
    const card = document.querySelector('#screen-start');
    const top = document.getElementById('mode-pro').getBoundingClientRect().top;
    const bottom = document.getElementById('btn-reset').getBoundingClientRect().bottom;
    document.getElementById('panel').scrollTop = 99999;
    await new Promise((r) => requestAnimationFrame(r));
    const bottomAfter = document.getElementById('btn-reset').getBoundingClientRect().bottom;
    return { top: Math.round(top), cardH: Math.round(card.getBoundingClientRect().height),
             viewH: window.innerHeight, bottom: Math.round(bottom),
             bottomAfter: Math.round(bottomAfter) };
  });
  check('시작 화면이 길어져도 맨 위 버튼이 화면 안에 들어온다',
    reach.top >= 0, JSON.stringify(reach));
  check('맨 아래 버튼까지 스크롤로 닿는다',
    reach.bottomAfter <= reach.viewH + 1, JSON.stringify(reach));

  await page.click('#mode-pro');
  check('잠긴 모드는 눌러도 바뀌지 않는다',
    (await page.evaluate(() => window.SkyGoal.getProfile().mode)) === 'amateur');

  // 조건을 채우면 열린다
  await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.bestScore = 260;
    p.modes.amateur.bestScore = 260;
    window.SkyGoal.home();
  });
  const amateurArena = await page.evaluate(() => window.SkyGoal.getArena().gap);
  await page.click('#mode-pro');
  const proState = await page.evaluate(() => ({
    mode: window.SkyGoal.getProfile().mode,
    gap: window.SkyGoal.getArena().gap,
    diff: Math.round(window.SkyGoal.getProfile().difficulty),
    on: document.getElementById('mode-pro').classList.contains('on')
  }));
  check('조건을 채우면 프로 모드로 전환된다',
    proState.mode === 'pro' && proState.on, JSON.stringify(proState));
  check('프로 모드는 골문이 더 좁다', proState.gap < amateurArena * 0.9,
    amateurArena.toFixed(0) + ' → ' + proState.gap.toFixed(0));
  check('프로 모드는 난이도 하한이 높다', proState.diff >= 60, 'D=' + proState.diff);
  check('아마추어 기록은 그대로 남는다',
    (await page.evaluate(() => window.SkyGoal.getProfile().modes.amateur.bestScore)) === 260);
  await page.click('#mode-amateur');
  check('아마추어로 되돌릴 수 있다',
    (await page.evaluate(() => window.SkyGoal.getProfile().mode)) === 'amateur');

  // 공 선택 · 상점
  // 앞 단계(완주 선물 등)의 영향을 받지 않도록 알려진 상태에서 시작한다
  await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.coins = 0;
    p.balls = { owned: ['street'], selected: 'street' };
    window.SkyGoal.home();
  });
  await page.click('#btn-balls');
  check('공 선택 화면이 열린다', await page.isVisible('#screen-balls'));
  const rows = await page.evaluate(() => document.querySelectorAll('#ball-list .ballrow').length);
  check('공 5종이 표시된다', rows === 5, '행 ' + rows + '개');

  const lockedFirst = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#ball-list .ballrow button')];
    return { buyDisabled: btns.slice(1).every((b) => b.disabled), first: btns[0].textContent };
  });
  check('코인이 부족하면 구매 버튼이 잠긴다', lockedFirst.buyDisabled, JSON.stringify(lockedFirst));

  await page.evaluate(() => {
    window.SkyGoal.getProfile().coins = 5000;
    window.SkyGoal.balls();
  });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ball-list .ballrow')];
    rows[1].querySelector('button').click();          // 고무공 구매
  });
  const bought = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    return { coins: p.coins, owned: p.balls.owned, selected: p.balls.selected,
             gravity: Math.round(window.SkyGoal.getArena().gravity) };
  });
  check('코인으로 공을 사면 바로 장착된다',
    bought.selected === 'rubber' && bought.coins === 4700 && bought.owned.includes('rubber'),
    JSON.stringify(bought));

  const heavier = await page.evaluate(() => {
    window.SkyGoal.engine.selectBall(window.SkyGoal.getProfile(), 'street');
    window.SkyGoal.balls();
    return Math.round(window.SkyGoal.getArena().gravity);
  });
  check('가벼운 공이 실제로 중력을 낮춘다', bought.gravity < heavier,
    '고무 ' + bought.gravity + ' < 기본 ' + heavier);

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ball-list .ballrow')];
    rows[1].querySelector('button').click();          // 다시 고무공 선택
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
  check('선택한 공이 새로고침 후에도 유지된다',
    await page.evaluate(() => window.SkyGoal.getProfile().balls.selected === 'rubber'));
  await page.evaluate(() => window.SkyGoal.home());

  // 장비 · 조각
  await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.coins = 0;
    p.inventory = { common: 0, rare: 0, epic: 0, legendary: 0 };
    p.gear = { owned: [], equipped: { boots: null, band: null, charm: null } };
    p.consumables = { stock: {}, selected: null };
    window.SkyGoal.home();
  });
  await page.click('#btn-gear');
  check('장비 화면이 열린다', await page.isVisible('#screen-gear'));

  const gearCounts = await page.evaluate(() => ({
    shards: document.querySelectorAll('#shard-row .shard').length,
    gear: document.querySelectorAll('#gear-list .ballrow').length,
    slots: document.querySelectorAll('#gear-list .slotname').length,
    cons: document.querySelectorAll('#cons-list .ballrow').length
  }));
  check('조각 4등급 · 장비 12종(3슬롯) · 소모품 4종이 표시된다',
    gearCounts.shards === 4 && gearCounts.gear === 12 &&
    gearCounts.slots === 3 && gearCounts.cons === 4,
    JSON.stringify(gearCounts));

  const icons = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('#gear-list .icon canvas')];
    const consCanvases = document.querySelectorAll('#cons-list .icon canvas').length;
    // 캔버스가 실제로 칠해졌는지 — 전부 투명하면 그리기가 실패한 것이다
    const painted = canvases.filter((cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    }).length;
    return { gear: canvases.length, cons: consCanvases, painted };
  });
  check('장비 12종 · 소모품 4종이 캔버스 아이콘으로 그려진다',
    icons.gear === 12 && icons.cons === 4 && icons.painted === 12,
    JSON.stringify(icons));

  const lockedCraft = await page.evaluate(() =>
    [...document.querySelectorAll('#gear-list .ballrow button')].every((b) => b.disabled));
  check('조각이 없으면 제작 버튼이 전부 잠긴다', lockedCraft);

  const crafted = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.inventory.common = 5;
    window.SkyGoal.gear();
    const row = [...document.querySelectorAll('#gear-list .ballrow')]
      .find((r) => r.textContent.includes('연습장 부츠'));
    row.querySelector('button').click();
    return {
      owned: p.gear.owned.slice(),
      equipped: p.gear.equipped.boots,
      shards: p.inventory.common,
      flap: Math.round(window.SkyGoal.getArena().flap)
    };
  });
  check('조각을 모으면 원하는 장비를 만들고 바로 장착된다',
    crafted.owned.includes('boots_practice') && crafted.equipped === 'boots_practice' &&
    crafted.shards === 0, JSON.stringify(crafted));

  const plainFlap = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    window.SkyGoal.engine.unequipGear(p, 'boots');
    window.SkyGoal.gear();
    return Math.round(window.SkyGoal.getArena().flap);
  });
  check('장비가 실제 물리값을 바꾼다 (flap 은 음수라 셀수록 작아진다)',
    crafted.flap < plainFlap, '장착 ' + crafted.flap + ' < 해제 ' + plainFlap);

  const snack = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.coins = 1000;
    window.SkyGoal.gear();
    const row = [...document.querySelectorAll('#cons-list .ballrow')]
      .find((r) => r.textContent.includes('스카우팅 리포트'));
    row.querySelector('button.buy').click();
    return { coins: p.coins, stock: p.consumables.stock.cons_scout, selected: p.consumables.selected };
  });
  check('소모품을 코인으로 사면 경기 전 슬롯에 올라간다',
    snack.coins === 700 && snack.stock === 1 && snack.selected === 'cons_scout',
    JSON.stringify(snack));

  const consumed = await page.evaluate(() => {
    window.SkyGoal.start();
    const p = window.SkyGoal.getProfile();
    const run = window.SkyGoal.getRun();
    return {
      snack: run.snack ? run.snack.id : null,
      stock: p.consumables.stock.cons_scout || 0,
      selected: p.consumables.selected
    };
  });
  check('소모품은 경기를 시작하는 순간 소비된다',
    consumed.snack === 'cons_scout' && consumed.stock === 0 && consumed.selected === null,
    JSON.stringify(consumed));

  const blocked = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.inventory.epic = 99;
    window.SkyGoal.engine.craftGear(p, 'charm_gloves');
    window.SkyGoal.start();
    window.SkyGoal.flap();                       // 킥오프 건너뛰고 플레이
    const before = window.SkyGoal.getRun().blockHits;
    const absorbed = window.SkyGoal.debugAbsorbHit();
    return { before, absorbed, after: window.SkyGoal.getRun().blockHits,
             state: window.SkyGoal.getState() };
  });
  check('골키퍼 장갑이 충돌 1회를 흡수하고 경기가 계속된다',
    blocked.before === 1 && blocked.absorbed === true && blocked.after === 0 &&
    blocked.state === 'playing', JSON.stringify(blocked));

  const revived = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.inventory.legendary = 99;
    window.SkyGoal.engine.craftGear(p, 'charm_golden30');
    window.SkyGoal.start();
    window.SkyGoal.flap();
    const run = window.SkyGoal.getRun();
    run.combo = 10;
    window.SkyGoal.forceEnd();                   // 첫 사망 — 골든 휘슬이 살린다
    const afterSave = { state: window.SkyGoal.getState(), combo: run.combo, used: run.saveUsed };
    window.SkyGoal.forceEnd();                   // 두 번째 사망 — 이제 끝난다
    return { afterSave, finalState: window.SkyGoal.getState() };
  });
  check('2030 골든 휘슬이 한 번 살리고 COMBO 를 절반만 남긴다',
    revived.afterSave.state === 'ready' && revived.afterSave.combo === 5 &&
    revived.afterSave.used === true, JSON.stringify(revived.afterSave));
  check('부활은 판당 한 번뿐 — 두 번째 사망은 그대로 끝난다',
    revived.finalState === 'over', revived.finalState);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
  const gearPersisted = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    return { owned: p.gear.owned.length, charm: p.gear.equipped.charm };
  });
  check('만든 장비는 새로고침 후에도 남는다',
    gearPersisted.owned >= 2 && gearPersisted.charm === 'charm_golden30',
    JSON.stringify(gearPersisted));

  const dusted = await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    // COMMON 장비를 전부 만들어 두면 그때부터 COMMON 조각은 "남는 조각"이 된다
    p.inventory.common = 99;
    ['boots_practice', 'band_cloth', 'charm_clover'].forEach(
      (id) => window.SkyGoal.engine.craftGear(p, id));
    p.inventory.common = 4;
    p.coins = 0;
    window.SkyGoal.gear();
    const btn = document.querySelector('#shard-row .shard.common .dust');
    const rareBtn = document.querySelector('#shard-row .shard.rare .dust');
    if (btn) btn.click();
    return { hadCommon: !!btn, hadRare: !!rareBtn,
             shards: p.inventory.common, coins: p.coins };
  });
  check('더 만들 것이 없는 등급만 분해할 수 있다',
    dusted.hadCommon === true && dusted.hadRare === false &&
    dusted.shards === 3 && dusted.coins === 20, JSON.stringify(dusted));

  // 뒤 테스트에 영향을 주지 않도록 장비를 내려 둔다.
  // 골든 휘슬이 걸려 있으면 사망이 먼저 "부활"로 흡수되어
  // 이어하기(보상형 광고) 화면까지 도달하지 않는다 — 의도한 우선순위지만
  // 테스트는 알려진 상태에서 시작해야 한다.
  await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    p.gear.equipped = { boots: null, band: null, charm: null };
    p.consumables = { stock: {}, selected: null };
    localStorage.setItem(window.SkyGoal.engine.STORAGE_KEY, JSON.stringify(p));
    window.SkyGoal.home();
  });

  // 조작 설정 슬라이더
  await page.evaluate(() => window.SkyGoal.home());
  await page.click('#btn-settings');
  check('조작 설정 화면이 열린다', await page.isVisible('#screen-settings'));
  const bounds = await page.evaluate(() => ({
    fineMin: document.getElementById('set-fine').min,
    speedMin: document.getElementById('set-speed').min
  }));
  check('슬라이더 하한이 공 20 / 스피드 30 이다',
    bounds.fineMin === '20' && bounds.speedMin === '30', JSON.stringify(bounds));

  const before = await page.evaluate(() => window.SkyGoal.getArena().speed);
  await page.evaluate(() => {
    const el = document.getElementById('set-speed');
    el.value = '100';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const after = await page.evaluate(() => ({
    speed: window.SkyGoal.getArena().speed,
    saved: window.SkyGoal.getProfile().settings.speed,
    label: document.getElementById('set-speed-val').textContent
  }));
  check('스피드 슬라이더가 즉시 반영된다', after.speed > before,
    before.toFixed(0) + ' → ' + after.speed.toFixed(0));
  check('슬라이더 값이 화면에 표시된다', after.label === '100');

  await page.evaluate(() => {
    const el = document.getElementById('set-fine');
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
  const persisted = await page.evaluate(() => window.SkyGoal.getProfile().settings);
  check('조작 설정이 새로고침 후에도 유지된다',
    persisted.speed === 100 && persisted.ballFine === 20, JSON.stringify(persisted));
  await page.evaluate(() => {
    window.SkyGoal.settings();
    document.getElementById('btn-settings-reset').click();
  });
  check('기본값으로 되돌릴 수 있다 (공 20 · 스피드 30)',
    await page.evaluate(() => {
      const s = window.SkyGoal.getProfile().settings;
      return s.speed === 30 && s.ballFine === 20;
    }));
  await page.evaluate(() => window.SkyGoal.home());

  // 완주 헹가래 세리머니
  await page.evaluate(() => {
    window.SkyGoal.home();
    window.SkyGoal.start();
    window.SkyGoal.flap();                       // 킥오프 통과
    // 마지막 스테이지 조건을 만들고 다음 통과 판정에서 완주가 걸리게 한다
    const r = window.SkyGoal.getRun();
    r.passCount = 90;
    r.score = 500;
    window.SkyGoal.debugClearGates();
    window.SkyGoal.debugRefreshStage();          // 통과 시점에 도는 실제 경로
  });
  const clearInfo = await page.waitForFunction(() => {
    const d = window.SkyGoal.debug();
    if (window.SkyGoal.getState() === 'ceremony' && d.ceremony) {
      return { gift: d.ceremony.gift, stage: d.stage };
    }
    return false;
  }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
  check('마지막 스테이지에 닿으면 세리머니가 시작된다',
    !!clearInfo && clearInfo.stage === 'WORLD_FINAL', JSON.stringify(clearInfo && clearInfo.stage));
  check('완주 선물로 골든볼을 준다',
    !!clearInfo && clearInfo.gift.type === 'ball' && clearInfo.gift.ballId === 'gold2030',
    clearInfo ? clearInfo.gift.label : 'none');
  check('선물이 프로필에 실제로 반영된다', await page.evaluate(() => {
    const p = window.SkyGoal.getProfile();
    return p.balls.owned.includes('gold2030') && p.metrics.clears === 1;
  }));
  const tossed = await page.waitForFunction(() => window.SkyGoal.debug().ceremony &&
    window.SkyGoal.debug().ceremony.lift > 40, null, { timeout: 4000 })
    .then(() => true).catch(() => false);
  check('선수를 헹가래로 띄운다', tossed);
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.SkyGoal.flap());     // 세리머니 건너뛰기
  const afterCeremony = await page.evaluate(() => ({
    state: window.SkyGoal.getState(),
    score: window.SkyGoal.getRun().score
  }));
  check('세리머니 뒤 경기가 이어진다',
    afterCeremony.state === 'ready' && afterCeremony.score === 500,
    JSON.stringify(afterCeremony));
  await page.evaluate(() => window.SkyGoal.forceEnd());
  check('결과 화면에 완주 표시가 남는다',
    (await page.textContent('#r-line')).includes('완주'), (await page.textContent('#r-line')).trim());

  // 경기장 광고판 — 그려지되 조작을 훔치지 않아야 한다
  await page.evaluate(() => {
    window.SkyGoal.home();
    window.SkyGoal.start();
    window.SkyGoal.flap();                 // 킥오프 통과
  });
  const boards = await page.evaluate(() => window.SkyGoal.debug().boards);
  check('광고판 목록이 로드된다', boards >= 3, boards + '종');
  check('경기 중에는 인트로 캠페인이 걸리지 않는다',
    (await page.evaluate(() => window.SkyGoal.debug().introBoard)) === null);
  // 기둥 광고판 위를 실제로 탭했을 때 광고가 아니라 공이 반응해야 한다
  await page.waitForFunction(() => {
    const d = window.SkyGoal.debug();
    return d.gates.some((g) => g.x > 30 && g.x < d.size.w - 70);
  }, null, { timeout: 5000 });
  const tapTest = await page.evaluate(() => {
    const d = window.SkyGoal.debug();
    const g = d.gates.filter((x) => x.x > 30 && x.x < d.size.w - 70)[0];
    // 게임이 기둥 광고판을 거는 위치와 같은 식으로 배너 중심을 구한다
    const top = g.mid - g.gap / 2;
    const bottom = g.mid + g.gap / 2;
    const upper = top - 46;
    const lower = d.size.groundY - (bottom + 46);
    let y;
    if (lower >= upper && lower > 90) y = bottom + 46 + Math.min(150, lower - 12) / 2;
    else y = top - 46 - Math.min(150, upper - 12) / 2;
    y = Math.max(20, Math.min(y, d.size.groundY - 20));
    return { x: g.x + 27, y: y, before: window.SkyGoal.getRun().tapIntervals.length };
  });
  await page.mouse.click(tapTest.x, tapTest.y);
  await page.waitForTimeout(60);
  const afterTap = await page.evaluate(() => window.SkyGoal.getRun().tapIntervals.length);
  check('광고판을 탭해도 광고가 아니라 공이 반응한다 (클릭 영역 없음)',
    afterTap === tapTest.before + 1,
    '탭 기록 ' + tapTest.before + ' → ' + afterTap + ' @ (' +
      tapTest.x.toFixed(0) + ',' + tapTest.y.toFixed(0) + ')');
  check('광고는 클릭 불가로 고정되어 있다',
    await page.evaluate(() => window.SkyGoalSponsor.CLICKABLE === false));
  await page.evaluate(() => window.SkyGoal.forceEnd());

  // 사이드라인 응원단 (배경 연출 — 플레이에 관여하지 않는다)
  await page.evaluate(() => {
    window.SkyGoal.home();
    window.SkyGoal.start();
    window.SkyGoal.flap();                 // 킥오프 통과
  });
  const squad = await page.evaluate(() => {
    const d = window.SkyGoal.debug();
    return { cheer: d.cheer, ground: d.size.groundY, h: d.size.h };
  });
  check('응원단이 배치된다', !!squad.cheer && squad.cheer.count >= 3,
    squad.cheer ? squad.cheer.count + '명' : 'none');
  check('응원단은 플레이 영역 밖(잔디)에 선다',
    !!squad.cheer && squad.cheer.baseY > squad.ground && squad.cheer.baseY <= squad.h,
    squad.cheer ? '기준선 ' + squad.cheer.baseY.toFixed(0) + ' / 잔디선 ' + squad.ground.toFixed(0) : 'none');

  // 킥오프 임팩트에서 실제로 응원이 터지는지 (게임 내 실제 경로)
  await page.evaluate(() => { window.SkyGoal.home(); window.SkyGoal.start(); });
  const quiet = await page.evaluate(() => window.SkyGoal.debug().cheer.excite);
  await page.waitForFunction(() => window.SkyGoal.getState() === 'playing', null, { timeout: 5000 });
  const loud = await page.evaluate(() => {
    const r = window.SkyGoal.getRun();
    const d = window.SkyGoal.debug();
    return { excite: d.cheer.excite, bits: d.cheer.bits, score: r.score };
  });
  check('킥오프 순간 응원이 터진다', loud.excite > quiet && loud.bits > 0,
    quiet + ' → ' + loud.excite + ' (색종이 ' + loud.bits + '개)');
  check('응원해도 점수는 오르지 않는다', loud.score === 0, 'score=' + loud.score);

  await page.evaluate(() => window.SkyGoal.forceEnd());

  // 킥오프 건너뛰기
  await page.evaluate(() => { window.SkyGoal.home(); window.SkyGoal.start(); });
  check('킥오프 상태로 시작한다', (await page.evaluate(() => window.SkyGoal.getState())) === 'kickoff');
  await page.evaluate(() => window.SkyGoal.flap());
  check('탭하면 킥오프를 건너뛰고 바로 플레이한다',
    (await page.evaluate(() => window.SkyGoal.getState())) === 'playing');
  await page.evaluate(() => window.SkyGoal.forceEnd());

  // 보상형 광고 이어하기 흐름
  await page.evaluate(() => {
    window.SkyGoal.home();
    window.SkyGoal.setRewardProvider((cb) => cb(true));
    window.SkyGoal.start();
    window.SkyGoal.flap();                              // 킥오프 건너뛰기
    const r = window.SkyGoal.getRun();
    r.score = 50; r.passCount = 4; r.combo = 4;      // 이어하기 조건(30점) 충족
    window.SkyGoal.forceEnd();
  });
  check('사망 시 이어하기 화면이 뜬다', await page.isVisible('#screen-continue'));
  const gamesBefore = await page.evaluate(() => window.SkyGoal.getProfile().metrics.games);
  await page.click('#btn-continue');
  const resumed = await page.evaluate(() => ({
    state: window.SkyGoal.getState(),
    score: window.SkyGoal.getRun().score,
    combo: window.SkyGoal.getRun().combo,
    games: window.SkyGoal.getProfile().metrics.games
  }));
  check('광고 시청 후 같은 점수로 이어진다',
    resumed.state === 'ready' && resumed.score === 50 && resumed.games === gamesBefore,
    JSON.stringify(resumed));
  check('이어하기 시 콤보는 초기화된다', resumed.combo === 0);
  await page.evaluate(() => window.SkyGoal.forceEnd());
  check('이어하기는 한 판에 한 번뿐 — 두 번째 사망은 바로 결과 화면',
    await page.isVisible('#screen-result'));
  check('이어한 판이 한 판으로 집계된다',
    (await page.evaluate(() => window.SkyGoal.getProfile().metrics.games)) === gamesBefore + 1);

  // 광고를 거부하면 그대로 결과로 넘어간다
  await page.evaluate(() => {
    window.SkyGoal.home();
    window.SkyGoal.setRewardProvider((cb) => cb(false));
    window.SkyGoal.start();
    window.SkyGoal.flap();
    const r = window.SkyGoal.getRun();
    r.score = 40; r.passCount = 3;
    window.SkyGoal.forceEnd();
  });
  await page.click('#btn-continue');
  check('광고 실패 시 결과 화면으로 넘어간다', await page.isVisible('#screen-result'));

  check('콘솔 에러가 없다', errors.length === 0, errors.join(' | ').slice(0, 300));

  // ── 설치형 웹앱(PWA) 검증 ─────────────────────────────────────────
  const pwaDir = path.join(HERE, '..', 'pwa');
  if (fs.existsSync(path.join(pwaDir, 'index.html'))) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                    '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
    const pwaServer = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(pwaDir, rel);
      if (!file.startsWith(pwaDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    await new Promise((r) => pwaServer.listen(0, '127.0.0.1', r));
    const pwaUrl = `http://127.0.0.1:${pwaServer.address().port}/`;
    const pwaPage = await context.newPage();
    const pwaErrors = [];
    pwaPage.on('pageerror', (e) => pwaErrors.push(String(e)));
    pwaPage.on('console', (m) => { if (m.type() === 'error') pwaErrors.push(m.text()); });
    try {
      await pwaPage.goto(pwaUrl, { waitUntil: 'load' });
      await pwaPage.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });
      const manifest = await pwaPage.evaluate(async () => {
        const link = document.querySelector('link[rel=manifest]');
        if (!link) return null;
        const res = await fetch(link.href);
        return res.ok ? await res.json() : null;
      });
      check('PWA 매니페스트가 로드된다',
        !!manifest && manifest.display === 'fullscreen' && manifest.icons.length >= 2,
        manifest ? manifest.name : 'none');
      const swReady = await pwaPage.evaluate(() =>
        navigator.serviceWorker.ready.then(() => true).catch(() => false));
      check('서비스 워커가 등록된다 (오프라인 실행)', swReady === true);
      check('PWA 에서도 게임이 뜬다', await pwaPage.isVisible('#screen-start'));
      check('PWA 콘솔 에러가 없다', pwaErrors.length === 0, pwaErrors.join(' | ').slice(0, 200));
    } finally {
      await pwaPage.close();
      pwaServer.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
