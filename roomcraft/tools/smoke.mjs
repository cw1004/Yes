// End-to-end check of a built HTML file. Needs Playwright:
//
//   npm i --no-save playwright && node tools/smoke.mjs dist/Roomcraft-Auto-Factory-V3.html
//
// Set CHROME_PATH to reuse a Chromium you already have.
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const url = 'file://' + resolve(process.argv[2] ?? 'dist/Roomcraft-Auto-Factory-V3.html');
const shotDir = process.env.SHOT_DIR ?? '';
const shot = name => (shotDir ? { path: `${shotDir}/${name}.png` } : { path: `/dev/null` });
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#product-link-input', { timeout: 15000 });

// IMPORT flow
await p.getByRole('button', { name: /coupang\.com/ }).click();
console.log('input after example:', await p.locator('#product-link-input').inputValue());
await p.getByRole('button', { name: '분석하기' }).click();
await p.waitForSelector('text=Coupang 감지됨', { timeout: 15000 });
// edit price -> discount + script must follow
await p.locator('#edit-price').fill('29000');
await p.waitForTimeout(200);
console.log('discount badge:', await p.locator('text=/% OFF/').first().innerText());
await p.screenshot({ path: '/tmp/claude-0/-home-user-Yes/b01b01d0-18ca-59d8-9e1b-9bce60435fe4/scratchpad/shot-import.png', fullPage: true });

// Room modal
await p.getByRole('button', { name: /ROOM PREVIEW/ }).click();
await p.waitForSelector('text=items placed');
await p.screenshot(shot('room'));
await p.keyboard.press('Escape');

// STUDIO
await p.getByRole('button', { name: '스튜디오로 이동 →' }).click();
const script = await p.locator('textarea').first().inputValue();
console.log('script has edited price:', script.includes('29,000'));
await p.getByRole('button', { name: /영상 생성하기/ }).click();
await p.waitForSelector('text=생성 완료', { timeout: 20000 });
await p.screenshot(shot('studio'));

// PUBLISH
await p.getByRole('button', { name: '발행 단계로 →' }).click();
await p.waitForSelector('text=CHANNELS');
await p.locator('tr[role="button"]').first().click();
await p.waitForSelector('text=QUEUE ITEM #1');
console.log('queue modal opened OK');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: /채널에 발행하기/ }).click();
await p.waitForSelector('text=발행 완료!');
await p.screenshot(shot('publish'));
// A blocked Google Fonts request is fine — the fallback stack covers it.
const real = errs.filter(e => !/fonts\.googleapis|ERR_CONNECTION_RESET/.test(e));
console.log('console errors:', real.length ? real : 'none');
if (real.length) process.exitCode = 1;
await b.close();
