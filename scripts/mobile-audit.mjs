/**
 * 모바일 화면 감사.
 *
 * "모바일 우선"은 max-width 를 걸었다는 뜻이 아니다. 실제 기기 폭에서
 * 가로 스크롤이 생기는지, 손가락으로 누를 수 있는 크기인지, 노치에 가리는지,
 * iOS 가 입력창에서 화면을 확대해버리는지를 화면마다 확인해야 안다.
 *
 *   node scripts/mobile-audit.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { chromium, devices } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.SIM_PORT || 8907);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SIM_OUT || path.join(os.tmpdir(), 'skinlab-mobile');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { name: 'iPhone SE (가장 작은 현역)', viewport: { width: 375, height: 667 }, dsf: 2, touch: true },
  { name: 'iPhone 14 Pro (노치)', viewport: { width: 393, height: 852 }, dsf: 3, touch: true },
  { name: 'iPhone 14 Pro Max', viewport: { width: 430, height: 932 }, dsf: 3, touch: true },
  { name: 'Galaxy S8 (좁은 폭)', viewport: { width: 360, height: 740 }, dsf: 3, touch: true },
  { name: '구형 소형 (320px)', viewport: { width: 320, height: 568 }, dsf: 2, touch: true },
];

const findings = [];
const add = (device, screen, severity, issue, detail) => findings.push({ device, screen, severity, issue, detail });

const dbPath = path.join(OUT, 'mobile-db.json');
fs.rmSync(dbPath, { force: true });
const server = spawn('node', ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), SKINLAB_DB: dbPath, ADMIN_TOKEN: 'm' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('서버 기동 실패')), 12000);
  server.stdout.on('data', (b) => { if (String(b).includes('SkinLab')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch();

/** 화면 하나를 훑어 모바일 문제를 찾는다 */
async function auditScreen(page, device, screen) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = { vw, overflowX: document.documentElement.scrollWidth - vw, small: [], wide: [], tinyInput: [], clipped: [] };

    // 1) 탭 타깃 44x44 미만 (애플 HIG / 머티리얼 최소 권장)
    for (const el of document.querySelectorAll('button, a, input, select, label.upload, .opt, .chip')) {
      if (!el.offsetParent && el.offsetHeight === 0) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.height < 40 || b.width < 32) {
        out.small.push({ sel: el.className || el.id || el.tagName, w: Math.round(b.width), h: Math.round(b.height), text: (el.textContent || '').trim().slice(0, 18) });
      }
    }
    // 2) 뷰포트를 넘는 요소
    const inScroller = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('#app *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (inScroller(el)) continue; // 가로 스크롤 영역(칩 줄 등)은 넘치는 게 정상
      if (b.right > vw + 1 || b.left < -1) {
        out.wide.push({ sel: el.className || el.tagName, left: Math.round(b.left), right: Math.round(b.right) });
      }
    }
    // 3) iOS 는 16px 미만 입력창에 포커스하면 화면을 확대한다
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'file' || el.type === 'hidden') continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) out.tinyInput.push({ sel: el.id || el.className, fontSize: fs });
    }
    // 4) 내용이 상자 밖으로 넘친 곳
    for (const el of document.querySelectorAll('.pill, .tag, .opt, .chip, .offer .p, .bubble, .hist-row, .q-head b')) {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
        out.clipped.push({ sel: el.className, scroll: el.scrollWidth, client: el.clientWidth, text: (el.textContent || '').trim().slice(0, 20) });
      }
    }
    return out;
  });

  if (r.overflowX > 1) add(device, screen, 'high', '가로 스크롤 발생', `${r.overflowX}px 초과`);
  const uniqWide = [...new Map(r.wide.map((w) => [w.sel, w])).values()].slice(0, 3);
  for (const w of uniqWide) add(device, screen, 'high', '요소가 화면 밖으로', `${w.sel} (left ${w.left}, right ${w.right} / 폭 ${r.vw})`);
  const uniqSmall = [...new Map(r.small.map((s) => [s.sel + s.text, s])).values()].slice(0, 4);
  for (const s of uniqSmall) add(device, screen, 'med', '탭 영역이 작음', `${s.text || s.sel} ${s.w}×${s.h}px`);
  for (const t of [...new Map(r.tinyInput.map((t) => [t.sel, t])).values()]) add(device, screen, 'med', 'iOS 입력 확대 유발', `${t.sel} ${t.fontSize}px (<16px)`);
  for (const c of r.clipped.slice(0, 3)) add(device, screen, 'low', '내용 잘림', `${c.sel} "${c.text}" ${c.client}→${c.scroll}px`);
}

async function makeFace(page, name) {
  const b64 = await page.evaluate(() => {
    const w = 320, h = 420, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#12101a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e0b592'; x.beginPath(); x.ellipse(160, 205, 100, 145, 0, 0, 7); x.fill();
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = `rgba(${175 + Math.random() * 60 | 0},${135 + Math.random() * 50 | 0},${110 + Math.random() * 40 | 0},.4)`;
      x.fillRect(70 + Math.random() * 180, 80 + Math.random() * 250, 3, 3);
    }
    for (let i = 0; i < 45; i++) { x.fillStyle = 'rgba(120,80,60,.45)'; x.beginPath(); x.arc(85 + Math.random() * 150, 120 + Math.random() * 180, 4, 0, 7); x.fill(); }
    const g = x.createLinearGradient(0, 100, 0, 270); g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(135, 100, 55, 170);
    x.fillStyle = 'rgba(90,60,50,.4)';
    x.beginPath(); x.ellipse(122, 176, 25, 9, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(198, 176, 25, 9, 0, 0, 7); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  const p = path.join(OUT, `${name}.png`);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

let currentStep = '시작';
for (const prof of PROFILES) {
 currentStep = '시작';
 try {
  const ctx = await browser.newContext({
    viewport: prof.viewport, deviceScaleFactor: prof.dsf, hasTouch: prof.touch, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const tap = (sel) => page.locator(`${sel}:visible`).first().click();
  const shotName = prof.name.replace(/[^\w가-힣]+/g, '-');
  // 어디서 멈췄는지 알아야 고칠 수 있다
  const step = (label) => { currentStep = label; };

  step('홈 진입');
  await auditScreen(page, prof.name, '홈');
  await page.screenshot({ path: path.join(OUT, `${shotName}-홈.png`) });

  step('시작 버튼');
  await tap('#btn-start');
  await page.waitForSelector('#screen-intake.active');
  await auditScreen(page, prof.name, '문진');
  await page.screenshot({ path: path.join(OUT, `${shotName}-문진.png`) });

  for (const [k, v] of [['ageBand', '30s'], ['selfType', 'dry'], ['mainWorry', 'dryness'], ['routine', 'basic'], ['sleep', 'lt5'], ['reaction', 'sometimes']]) {
    await tap(`[data-intake="${k}"][data-value="${v}"]`);
  }
  step('문진 완료 → 촬영');
  await tap('[data-action="intake-done"]');
  await page.waitForTimeout(600);
  await auditScreen(page, prof.name, '촬영');
  await page.screenshot({ path: path.join(OUT, `${shotName}-촬영.png`) });

  const face = await makeFace(page, `face-${PROFILES.indexOf(prof)}`);
  step('1회차 분석 → 상담');
  await page.setInputFiles('#file-input', face);
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  await page.waitForSelector('#chat-stream[data-playing="0"]', { timeout: 20000 }).catch(() => {});
  await auditScreen(page, prof.name, '상담');
  await page.screenshot({ path: path.join(OUT, `${shotName}-상담.png`) });

  step('리포트 이동');
  await tap('[data-goto="result"]');
  await page.waitForTimeout(300);
  await auditScreen(page, prof.name, '리포트');
  await page.screenshot({ path: path.join(OUT, `${shotName}-리포트.png`) });

  step('페이월 이동');
  await tap('[data-action="paywall"]');
  await page.waitForSelector('#screen-paywall.active');
  await auditScreen(page, prof.name, '결제');
  await page.screenshot({ path: path.join(OUT, `${shotName}-결제.png`) });

  step('결제');
  await tap('[data-action="pay"]');
  await page.waitForSelector('#screen-consult.active .bubble', { timeout: 25000 });
  step('추천 이동');
  await tap('.tabbar [data-goto="shop"]');
  await page.waitForSelector('.product', { timeout: 25000 });
  await page.waitForTimeout(400);
  await auditScreen(page, prof.name, '추천');
  await page.screenshot({ path: path.join(OUT, `${shotName}-추천.png`), fullPage: false });

  // 재측정 후 비교 화면
  step('재측정 문진');
  await tap('.tabbar [data-goto="intake"]');
  await page.waitForTimeout(250);
  await tap('[data-action="intake-done"]');
  await page.waitForTimeout(500);
  await page.setInputFiles('#file-input', face); // 같은 파일 재선택도 동작해야 한다
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  await page.waitForTimeout(700);
  step('전후 비교 이동');
  await tap('.tabbar [data-goto="compare"]');
  await page.waitForSelector('#compare-body', { timeout: 20000 });
  await page.waitForTimeout(700);
  await auditScreen(page, prof.name, '전후비교');
  await page.screenshot({ path: path.join(OUT, `${shotName}-전후비교.png`) });

  if (errors.length) add(prof.name, '-', 'high', '콘솔 에러', errors[0].slice(0, 90));
  await ctx.close();
  process.stdout.write(`  · ${prof.name} 완료\n`);
 } catch (err) {
  add(prof.name, currentStep, 'high', '여정 중단', `[${currentStep}] ${err.message.split('\n')[0].slice(0, 90)}`);
  process.stdout.write(`  · ${prof.name} 중단 — [${currentStep}] ${err.message.split('\n')[0].slice(0, 60)}\n`);
 }
}

await browser.close();
server.kill();

const order = { high: 0, med: 1, low: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const grouped = new Map();
for (const f of findings) {
  const key = `${f.severity}|${f.issue}|${f.detail}`;
  if (!grouped.has(key)) grouped.set(key, { ...f, screens: new Set(), devices: new Set() });
  grouped.get(key).screens.add(f.screen);
  grouped.get(key).devices.add(f.device);
}
console.log('\n' + '─'.repeat(70));
console.log(`모바일 감사 — ${PROFILES.length}개 기기 × 8개 화면`);
console.log('─'.repeat(70));
const MARK = { high: '■ 높음', med: '▲ 중간', low: '· 낮음' };
for (const g of grouped.values()) {
  console.log(`${MARK[g.severity]}  ${g.issue}`);
  console.log(`        ${g.detail}`);
  console.log(`        화면: ${[...g.screens].join(', ')} / 기기: ${g.devices.size}개`);
}
if (!grouped.size) console.log('문제 없음');
console.log(`\n총 ${grouped.size}종 (높음 ${[...grouped.values()].filter((g) => g.severity === 'high').length}종)`);
console.log(`스크린샷: ${OUT}`);
