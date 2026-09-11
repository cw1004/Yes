/*
 * SKY GOAL 2.0 — 보상 API 노출 회귀 테스트
 *
 * 배경: window.SkyGoal 이 engine/getProfile()/getRun()/forceEnd() 를 항상
 * 공개하던 시절에는, 실제 플레이어가 브라우저 콘솔에 한 줄만 쳐도 플레이 없이
 * 보상을 무한 지급받을 수 있었다.
 *   for (let i=0;i<50;i++) SkyGoal.engine.grantClearReward(SkyGoal.getProfile());
 *   SkyGoal.getRun().score = 999999; SkyGoal.forceEnd();
 *
 * 지금은 이 멤버들이 window.__SKYGOAL_TEST__ === true 일 때만(테스트 하네스가
 * 페이지 로드 전에 심어줄 때만) 붙는다. 이 테스트는 그 플래그를 절대 심지 않은
 * 상태 — 즉 실제 플레이어가 그냥 페이지를 여는 상황 — 에서 그 API 들이
 * 정말로 없는지, 그리고 예전 원라이너가 정말로 더 이상 동작하지 않는지 확인한다.
 * (통과는 "지금 안전하다"는 뜻이고, 나중에 이 파일 손질 없이 실패하기 시작하면
 * 그 구멍이 다시 열렸다는 뜻이다.)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(HERE, '..', 'sky_goal_2_0.html');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const globalRoot = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
  for (const spec of ['playwright', path.join(globalRoot, 'playwright')]) {
    try { return require(spec); } catch { /* 다음 후보 */ }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) {
  console.log('[skip] playwright 가 없어 보안 회귀 테스트를 건너뜁니다.');
  process.exit(0);
}
if (!fs.existsSync(HTML)) {
  console.error('[fail] 빌드 산출물이 없습니다. 먼저 `python3 build.py` 를 실행하세요.');
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(HTML));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await pw.chromium.launch();
// 의도적으로 __SKYGOAL_TEST__ 를 설정하지 않는다 — 실제 플레이어가 그냥
// 링크를 여는 상황을 그대로 재현한다.
const page = await (await browser.newContext({ viewport: { width: 420, height: 820 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.SkyGoal, null, { timeout: 5000 });

  const surface = await page.evaluate(() => Object.keys(window.SkyGoal).sort());
  const forbidden = ['engine', 'getProfile', 'getRun', 'forceEnd', 'previewStage',
    'debugClearGates', 'debugRefreshStage', 'setRewardProvider', 'continueRun',
    'finalizeRun', 'canContinue', 'paintBall'];
  const leaked = forbidden.filter((k) => surface.includes(k));
  check('보상/상태 조작 API 가 기본 페이지 로드에는 존재하지 않는다',
    leaked.length === 0, leaked.length ? '노출됨: ' + leaked.join(', ') : surface.join(', '));

  const exploit = await page.evaluate(() => {
    try {
      window.SkyGoal.engine.grantClearReward(window.SkyGoal.getProfile());
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: e.message };
    }
  });
  check('예전 원라이너(grantClearReward 무한 호출)가 더 이상 동작하지 않는다',
    exploit.blocked, exploit.message || '차단되지 않음');

  const scoreHack = await page.evaluate(() => {
    try {
      window.SkyGoal.getRun().score = 999999;
      window.SkyGoal.forceEnd();
      return { blocked: false };
    } catch (e) {
      return { blocked: true };
    }
  });
  check('점수 조작 후 forceEnd 로 보상을 흘려보내는 경로도 막혀 있다', scoreHack.blocked);

  // 잠금이 정상 플레이까지 막지는 않는지 함께 확인한다
  await page.click('#btn-start');
  await page.evaluate(() => window.SkyGoal.flap());
  const playing = await page.waitForFunction(
    () => window.SkyGoal.getState() === 'playing', null, { timeout: 5000 }
  ).then(() => true).catch(() => false);
  check('잠근 뒤에도 정상 플레이는 그대로 된다', playing);

  check('콘솔 에러가 없다', errors.length === 0, errors.join(' | ').slice(0, 200));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
