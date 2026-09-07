/*
 * 스토어 등록용 이미지 생성기 (Chromium 렌더링)
 *   node tools/make_assets.mjs
 * 산출물: 앱 아이콘(각 해상도), 적응형 아이콘 전경, 피처 그래픽, 스크린샷
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..');
const GAME = path.join(HERE, '..', '..', '..', '07_MVP_Code', 'sky_goal_2_0.html');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const globalRoot = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
  for (const spec of ['playwright', path.join(globalRoot, 'playwright')]) {
    try { return require(spec); } catch { /* 다음 후보 */ }
  }
  return null;
}
const pw = loadPlaywright();
if (!pw) { console.log('[skip] playwright 가 없어 이미지 생성을 건너뜁니다.'); process.exit(0); }

const browser = await pw.chromium.launch();

async function shot(file, html, w, h, transparent) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('file://' + html);
  await page.waitForTimeout(150);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: !!transparent });
  await page.close();
  console.log('  ✓', path.relative(OUT, file), `${w}x${h}`);
}

// 1) 앱 아이콘
console.log('앱 아이콘');
const iconHtml = path.join(HERE, 'icon.html');
for (const size of [1024, 512, 192, 144, 96, 72, 48]) {
  await shot(path.join(OUT, 'icons', `icon-${size}.png`), iconHtml, size, size);
}
// 적응형 아이콘 전경: 안전영역(66%) 안에 들어가도록 축소 렌더
{
  const page = await browser.newPage({ viewport: { width: 432, height: 432 } });
  await page.goto('file://' + iconHtml);
  await page.addStyleTag({ content: '.wrap{transform:scale(.68)} .plate{fill:transparent!important}' });
  await page.waitForTimeout(120);
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'icons', 'adaptive-foreground-432.png'), omitBackground: true });
  await page.close();
  console.log('  ✓ icons/adaptive-foreground-432.png 432x432 (안전영역 적용)');
}

// 2) 피처 그래픽
console.log('피처 그래픽');
await shot(path.join(OUT, 'feature-graphic-1024x500.png'), path.join(HERE, 'feature.html'), 1024, 500);

// 3) 스크린샷 (실제 게임 화면, 1080x1920)
console.log('스토어 스크린샷');
const server = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(GAME));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForFunction(() => !!window.SkyGoal);

await shot0('01-start');
async function shot0(name) {
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'screenshots', `${name}.png`) });
  console.log('  ✓ screenshots/' + name + '.png 1080x1920');
}

// 자동 조종으로 실제 플레이 장면을 만든다
await page.click('#btn-start');
await page.evaluate(() => {
  const step = () => {
    const s = window.SkyGoal.getState();
    if (s === 'ready') window.SkyGoal.flap();
    else if (s === 'playing') {
      const d = window.SkyGoal.debug();
      const g = d.gates.filter((x) => x.x + d.gateWidth > d.ball.x - 6).sort((a, c) => a.x - c.x)[0];
      const aim = g ? g.mid + g.gap * 0.28 : d.size.groundY * 0.5;
      if (d.ball.y + d.ball.vy * 0.08 > aim) window.SkyGoal.flap();
    } else return;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
const scenes = [['DAY', '02-day'], ['SUNSET', '03-sunset'], ['NIGHT', '04-night'],
                ['STORM', '05-storm'], ['WORLD_FINAL', '06-world-final']];
for (const [stage, name] of scenes) {
  await page.evaluate((k) => {
    if (window.SkyGoal.getState() === 'idle' || window.SkyGoal.getState() === 'over') {
      window.SkyGoal.home(); window.SkyGoal.start();
    }
    window.SkyGoal.previewStage(k);
  }, stage);
  await page.waitForTimeout(500);
  await shot0(name);
}
// 결과 화면
await page.evaluate(() => { if (window.SkyGoal.getState() !== 'over') window.SkyGoal.forceEnd(); });
await page.waitForTimeout(300);
await shot0('07-result');

await browser.close();
server.close();
console.log('\n완료: ' + OUT);
