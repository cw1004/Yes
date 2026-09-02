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
const page = await context.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });

  check('시작 화면이 보인다', await page.isVisible('#screen-start'));
  check('엔진이 로드되었다', await page.evaluate(() => !!window.SkyGoalEngine));
  if (shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, '01-start.png') });
  }

  await page.click('#btn-start');
  check('경기 시작 → ready 상태', (await page.evaluate(() => window.SkyGoal.getState())) === 'ready');
  check('HUD 가 표시된다', await page.isVisible('#hud'));

  // 자동 조종: 매 프레임 다음 골문을 겨냥해 탭하는 간단한 봇.
  // 봇이 완벽하지는 않으므로 최대 3판까지 시도해 "사람이 칠 수 있는 게임인지"만 확인한다.
  async function autoplay(msLimit) {
    await page.evaluate((limit) => {
      window.__best = 0;
      window.__done = false;
      const t0 = performance.now();
      const step = () => {
        const s = window.SkyGoal.getState();
        if (s === 'ready') {
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
  check('결과 화면에서 재시작된다', (await page.evaluate(() => window.SkyGoal.getState())) === 'ready');

  // 회전/리사이즈
  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(300);
  check('리사이즈 후에도 렌더가 살아있다', (await page.evaluate(() => window.SkyGoal.debug().size.w)) > 800);
  check('가로 스크롤이 생기지 않는다',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  check('콘솔 에러가 없다', errors.length === 0, errors.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
