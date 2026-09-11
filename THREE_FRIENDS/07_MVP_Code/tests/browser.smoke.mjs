/*
 * 세 친구의 여행 — 브라우저 스모크 테스트
 * 빌드된 단일 HTML 을 Chromium 에서 띄워 핵심 두 가지가 실제로 도는지 본다.
 *   1) 리더 교체가 장애물 판정을 바꾼다
 *   2) 티키타카가 뜨고, 탭하면 성공한다
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(HERE, '..', 'three_friends.html');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const globalRoot = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
  for (const name of ['playwright', 'playwright-core']) {
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
  console.log('[skip] playwright 가 없어 브라우저 스모크 테스트를 건너뜁니다.');
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

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(HTML));
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
  await page.waitForFunction(() => !!window.Friends, null, { timeout: 5000 });
  check('게임이 뜬다', await page.isVisible('#screen-start'));

  // 보조 모드는 리더를 자동으로 바꿔 버리므로, 조작 테스트에서는 끈다
  await page.evaluate(() => {
    const p = window.Friends.getProfile();
    p.settings.assist = false;
    p.difficulty = 40;
    window.Friends.home();
  });

  await page.click('#btn-start');
  check('여행이 시작되고 리더 바가 뜬다',
    (await page.evaluate(() => window.Friends.getState())) === 'playing' &&
    await page.isVisible('#leaderbar'));

  const bar = await page.evaluate(() => document.querySelectorAll('.leaderbtn').length);
  check('리더 버튼이 3개다', bar === 3, '버튼 ' + bar + '개');

  // --- 리더 교체 ---
  await page.evaluate(() => window.Friends.setLeader('wobi'));
  check('버튼으로 리더를 바꾼다',
    (await page.evaluate(() => window.Friends.getParty().leader)) === 'wobi');
  await page.keyboard.press('3');
  check('숫자 키로도 리더를 바꾼다',
    (await page.evaluate(() => window.Friends.getParty().leader)) === 'saro');
  const swapped = await page.evaluate(() => window.Friends.getRun().usage);
  check('리더로 쓴 캐릭터가 기록된다', Object.keys(swapped).length >= 3, JSON.stringify(swapped));

  // --- 장애물: 맞는 리더 + 탭 ---
  const good = await page.evaluate(() => {
    const F = window.Friends;
    F.debugSpawnObstacle('log');      // NUBI 가 필요한 통나무
    F.setLeader('nubi');
    F.tap();                          // 점프
    F.debugReachObstacle();
    const before = F.getRun().cleared;
    return new Promise((res) => requestAnimationFrame(() => {
      const r = F.getRun();
      res({ before, cleared: r.cleared, hearts: F.getParty().hearts, by: r.clearedBy.nubi });
    }));
  });
  check('맞는 리더로 탭하면 장애물을 넘는다',
    good.cleared === good.before + 1 && good.hearts === 3 && good.by >= 1,
    JSON.stringify(good));

  // --- 장애물: 틀린 리더 ---
  const bad = await page.evaluate(() => {
    const F = window.Friends;
    F.debugSpawnObstacle('log');
    F.setLeader('wobi');              // 통나무에 WOBI — 틀렸다
    F.debugExpireAction();
    F.tap();
    F.debugReachObstacle();
    return new Promise((res) => requestAnimationFrame(() => {
      res({ hearts: F.getParty().hearts, cleared: F.getRun().cleared });
    }));
  });
  check('틀린 리더면 하트를 하나 잃는다', bad.hearts === 2, JSON.stringify(bad));

  // --- 장애물: 맞는 리더인데 탭을 안 하면 ---
  const noTap = await page.evaluate(() => {
    const F = window.Friends;
    F.debugSpawnObstacle('gap');
    F.setLeader('saro');              // 리더는 맞지만 탭하지 않는다
    F.debugExpireAction();            // 앞 단계의 탭이 아직 살아 있지 않게
    F.debugReachObstacle();
    return new Promise((res) => requestAnimationFrame(() => {
      res({ hearts: F.getParty().hearts });
    }));
  });
  check('리더가 맞아도 탭하지 않으면 통과하지 못한다', noTap.hearts === 1,
    JSON.stringify(noTap));

  // --- 하트를 다 쓰면 결과 화면 ---
  const over = await page.evaluate(() => {
    const F = window.Friends;
    F.debugSpawnObstacle('log');
    F.setLeader('wobi');
    F.debugExpireAction();
    F.debugReachObstacle();
    return new Promise((res) => requestAnimationFrame(() => {
      res({ state: F.getState(), visible: !document.getElementById('screen-result').classList.contains('hidden') });
    }));
  });
  check('하트를 다 쓰면 결과 화면이 뜬다', over.state === 'over' && over.visible,
    JSON.stringify(over));

  const missionRows = await page.evaluate(() => document.querySelectorAll('#r-missions li').length);
  check('결과 화면에 판 미션 3개가 표시된다', missionRows === 3, '행 ' + missionRows + '개');

  // --- 티키타카 ---
  const tiki = await page.evaluate(() => {
    const F = window.Friends;
    F.start();
    F.debugSpawnTikitaka();
    const t = F.getTiki();
    const before = F.getRun().tikitakaHits;
    F.tap();                          // 말풍선이 떠 있으면 탭은 티키타카에 답한다
    const r = F.getRun();
    return { prompt: !!t, before, hits: r.tikitakaHits, acorns: r.acorns,
             hearts: F.getParty().hearts };
  });
  check('티키타카 말풍선이 뜨고 탭하면 성공한다',
    tiki.prompt && tiki.hits === tiki.before + 1 && tiki.acorns > 0, JSON.stringify(tiki));

  const streak = await page.evaluate(() => {
    const F = window.Friends;
    F.start();
    for (let i = 0; i < 5; i++) { F.debugSpawnTikitaka(); F.tap(); }
    return { parades: F.getRun().parades, parade: F.debug().parade,
             mul: F.engine.tikitakaMultiplier(F.getRun().tikitakaHits) };
  });
  check('5연속 성공하면 HAPPY PARADE 가 발동한다',
    streak.parades === 1 && streak.parade > 0, JSON.stringify(streak));

  const miss = await page.evaluate(() => {
    const F = window.Friends;
    F.start();
    F.debugSpawnTikitaka();
    const hearts0 = F.getParty().hearts;
    // 판정 시간이 지나도록 놔둔다
    return new Promise((res) => setTimeout(() => {
      res({ hearts0, hearts: F.getParty().hearts, state: F.getState(),
            hits: F.getRun().tikitakaHits });
    }, 1500));
  });
  check('티키타카를 놓쳐도 벌은 없다 (하트가 줄지 않는다)',
    miss.hearts === miss.hearts0 && miss.state === 'playing', JSON.stringify(miss));

  // --- 저연령 보조 ---
  const assist = await page.evaluate(() => {
    const F = window.Friends;
    const p = F.getProfile();
    p.settings.assist = true;
    F.start();
    F.setLeader('nubi');
    F.debugSpawnObstacle('gust');     // WOBI 가 필요하다
    // 장애물이 대응 거리 안으로 들어올 때까지 걸어야 한다
    return new Promise((res) => setTimeout(() => {
      res({ leader: F.getParty().leader, actionTime: F.debug().actionTime });
    }, 3200));
  });
  check('보조 모드가 켜지면 리더를 알아서 바꿔 준다', assist.leader === 'wobi',
    JSON.stringify(assist));

  const windows = await page.evaluate(() => {
    const F = window.Friends;
    const p = F.getProfile();
    p.settings.assist = true;
    F.start(); F.tap();
    const wide = F.getParty().actionUntil - F.debug().elapsed;
    p.settings.assist = false;
    F.start(); F.tap();
    const narrow = F.getParty().actionUntil - F.debug().elapsed;
    return { wide: +wide.toFixed(2), narrow: +narrow.toFixed(2) };
  });
  check('보조 모드는 탭 판정 시간도 넓혀 준다 (리더만 바꿔 주면 여전히 어렵다)',
    windows.wide > windows.narrow * 1.8, JSON.stringify(windows));

  // --- 저장 ---
  await page.evaluate(() => { window.Friends.forceEnd(); });
  const saved = await page.evaluate(() => window.Friends.getProfile().metrics.games);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.Friends, null, { timeout: 5000 });
  const reloaded = await page.evaluate(() => window.Friends.getProfile().metrics.games);
  check('기록이 새로고침 후에도 남는다', reloaded === saved && reloaded > 0,
    saved + ' → ' + reloaded);

  check('콘솔 에러가 없다', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
