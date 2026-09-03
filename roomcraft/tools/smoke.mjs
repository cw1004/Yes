// End-to-end check of a built HTML file. Needs Playwright:
//
//   npm i --no-save playwright && node tools/smoke.mjs dist/Roomcraft-Auto-Factory-V3.html
//
// CHROME_PATH  reuse a Chromium you already have
// SHOT_DIR     write a screenshot per step
// PROXY        route the browser through a proxy so the web fonts load
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const url = 'file://' + resolve(process.argv[2] ?? 'dist/Roomcraft-Auto-Factory-V3.html');
const shotDir = process.env.SHOT_DIR;
const errs = [];

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  ...(process.env.PROXY ? { proxy: { server: process.env.PROXY } } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !/fonts\.googleapis|gstatic|ERR_CONNECTION|ERR_PROXY/.test(m.text())) errs.push(m.text());
});

const shot = async (name, label) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
  console.log(`  ${name.padEnd(18)} ${label}`);
};
const ok = (label, pass) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) errs.push('assertion failed: ' + label);
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#product-link-input', { timeout: 20000 });
await page.waitForTimeout(1200); // let the web fonts settle before capturing
await shot('01-import', 'IMPORT — 샘플 제품이 이미 올라간 상태');

// The page opens in a working state, not an empty shell.
ok('첫 화면에 제품이 이미 있음', await page.getByText('Coupang · 감지됨').isVisible());

// Example link -> input
await page.getByRole('button', { name: 'amazon.com/dp/B0XXXX' }).click();
ok('예시 링크가 입력창에 들어감', (await page.locator('#product-link-input').inputValue()).includes('amazon'));

// Re-analyse: log animation
await page.getByRole('button', { name: '분석', exact: true }).click();
await page.waitForSelector('text=Engine log');
await page.waitForTimeout(900);
await shot('02-analyzing', '분석 중 — 엔진 로그');
await page.waitForSelector('text=Amazon · 감지됨', { timeout: 20000 });
const logs = await page.locator('ol li').first().innerText();
ok('로그 첫 줄이 플랫폼 감지', logs.includes('플랫폼 감지'));
await shot('03-product', '제품 시트 — 사진·치수·가격');

// Price edit propagates
await page.locator('#edit-price').fill('29000');
await page.waitForTimeout(250);
ok('할인율 재계산', (await page.getByText('−51%').first().innerText()).includes('51'));

// Room preview
await page.getByRole('button', { name: /룸 프리뷰/ }).click();
await page.waitForSelector('text=원룸 미니멀 구성');
await page.waitForTimeout(200);
await shot('04-room', '룸 프리뷰 모달');
await page.keyboard.press('Escape');

// Studio
await page.getByRole('button', { name: '스튜디오로 →' }).click();
await page.waitForSelector('text=영상 스튜디오');
ok('스크립트에 편집한 가격 반영', (await page.locator('textarea').first().inputValue()).includes('29,000'));
await shot('05-studio', 'STUDIO — 템플릿 A + 9:16 프리뷰');

await page.getByRole('button', { name: /스펙강조/ }).click();
await page.waitForTimeout(200);
await shot('06-template-c', '템플릿 C — 스크립트 자동 교체');

await page.getByRole('button', { name: '영상 생성', exact: true }).click();
await page.waitForTimeout(450);
await shot('07-rendering', '렌더링 진행 중');
const next = page.getByRole('button', { name: '발행 단계로 →' });
await next.waitFor({ state: 'visible' });
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('발행 단계로'));
  return b && !b.disabled;
}, null, { timeout: 25000 });
await shot('08-done', '렌더링 완료');

// Publish
await next.click();
await page.waitForSelector('text=SNS 발행');
await page.getByText('TikTok', { exact: true }).click();
await page.waitForTimeout(150);
await shot('09-publish', 'PUBLISH — 채널 3개 선택');

await page.locator('tr[role="button"]').first().click();
await page.waitForSelector('text=큐 항목 01');
await shot('10-queue', '큐 행 클릭 → 상세');
await page.keyboard.press('Escape');

await page.getByRole('button', { name: /채널에 발행/ }).click();
await page.waitForSelector('text=발행 완료');
await shot('11-success', '발행 완료');

// Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto(url, { waitUntil: 'domcontentloaded' });
await m.waitForSelector('#product-link-input', { timeout: 20000 });
await m.waitForTimeout(1200);
if (shotDir) await m.screenshot({ path: `${shotDir}/12-mobile.png`, fullPage: true });
console.log(`  ${'12-mobile'.padEnd(18)} 모바일 390px`);

console.log('\n  자바스크립트 오류:', errs.length ? errs : '없음');
if (errs.length) process.exitCode = 1;
await browser.close();
