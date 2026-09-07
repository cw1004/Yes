/**
 * 실사용 리허설 시뮬레이터.
 *
 * 테스트가 함수 단위를 잠근다면, 이 스크립트는 "사람이 실제로 쓰는 경로"를 통째로 돈다.
 * 여러 페르소나(피부 타입·연령·톤)로 문진 → 촬영 → 상담 → 결제 → 추천 → 재측정 → 비교까지
 * 끝까지 밟고, 화면에 실제로 무엇이 나왔는지 검증한다.
 *
 *   npm run simulate            (헤드리스)
 *   SIM_SHOTS=1 npm run simulate  (단계별 스크린샷 저장)
 *
 * Playwright 가 필요하다: npm i -D playwright  또는 PLAYWRIGHT_PATH 로 경로 지정.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = Number(process.env.SIM_PORT || 8899);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SIM_SHOTS === '1';
const OUT = process.env.SIM_OUT || path.join(os.tmpdir(), 'skinlab-sim');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

if (SHOTS) fs.mkdirSync(OUT, { recursive: true });


/** 사람은 '보이는' 버튼을 누른다. 화면이 여러 개라 같은 셀렉터가 DOM에 여러 번 있으므로
 *  항상 보이는 요소만 집는다. */
const tap = (page, sel) => page.locator(`${sel}:visible`).first().click();
const txt = async (page, sel) => (await page.locator(`${sel}:visible`).first().textContent()) ?? '';
const count = (page, sel) => page.locator(`${sel}:visible`).count();

/* ───────── 페르소나 ───────── */
const PERSONAS = [
  {
    id: 'oily-20s', label: '20대 지성 · 번들거림',
    face: { base: '#e6bfa0', rough: 0.55, spots: 12, shine: 0.55, dark: 0.15 },
    intake: { ageBand: '20s', selfType: 'oily', mainWorry: 'acne', routine: 'basic', sleep: '5to7', reaction: 'never' },
    plan: 'single',
  },
  {
    id: 'dry-30s-mismatch', label: '30대 · 건성이라 믿지만 측정은 다름',
    face: { base: '#eccbb0', rough: 0.35, spots: 8, shine: 0.5, dark: 0.1 },
    intake: { ageBand: '30s', selfType: 'dry', mainWorry: 'dryness', routine: 'active', sleep: 'lt5', reaction: 'sometimes' },
    plan: 'monthly', coupon: 'WELCOME30',
    expect: { discordance: true },
  },
  {
    id: 'pigment-40s', label: '40대 · 색소·잡티 고민',
    face: { base: '#dcb493', rough: 0.4, spots: 90, shine: 0.1, dark: 0.3 },
    intake: { ageBand: '40s', selfType: 'combination', mainWorry: 'pigmentation', routine: 'active', sleep: '5to7', reaction: 'sometimes' },
    plan: 'yearly',
  },
  {
    id: 'teen-skip', label: '10대 · 문진 건너뜀',
    face: { base: '#f0d3b8', rough: 0.5, spots: 30, shine: 0.45, dark: 0.05 },
    intake: null, // 문진 스킵 경로
    plan: 'single',
  },
  {
    id: 'deep-tone', label: '딥 스킨톤 · ITA 음수 영역',
    face: { base: '#7a4f38', rough: 0.3, spots: 20, shine: 0.2, dark: 0.2 },
    intake: { ageBand: '30s', selfType: 'combination', mainWorry: 'pore', routine: 'basic', sleep: 'gte7', reaction: 'never' },
    plan: 'monthly',
  },
];

/* ───────── 결과 수집 ───────── */
const results = [];
const problems = [];
const note = (persona, step, ok, detail) => {
  results.push({ persona, step, ok, detail });
  if (!ok) problems.push(`[${persona}] ${step} — ${detail}`);
};

/* ───────── 서버 ───────── */
const dbPath = path.join(OUT, 'sim-db.json');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(dbPath, { force: true });
const server = spawn('node', ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), SKINLAB_DB: dbPath, ADMIN_TOKEN: 'sim', COUPANG_PARTNER_ID: 'SIMTEST01' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('서버가 뜨지 않았습니다.')), 12000);
  server.stdout.on('data', (b) => { if (String(b).includes('SkinLab')) { clearTimeout(timer); resolve(); } });
});

const browser = await chromium.launch();

/** 페이지 안에서 얼굴 비슷한 이미지를 만들어 파일로 저장 */
async function paintFace(page, spec, name) {
  const b64 = await page.evaluate((s) => {
    const w = 320, h = 420;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#12101a'; x.fillRect(0, 0, w, h);
    const g = x.createRadialGradient(160, 200, 20, 160, 200, 180);
    g.addColorStop(0, s.base); g.addColorStop(1, s.base);
    x.fillStyle = g;
    x.beginPath(); x.ellipse(160, 205, 100, 145, 0, 0, 7); x.fill();
    // 결 거칠기
    const rgb = s.base.match(/\w\w/g).map((v) => parseInt(v, 16));
    for (let i = 0; i < 3400; i++) {
      const a = s.rough * (0.15 + Math.random() * 0.7);
      x.fillStyle = `rgba(${rgb[0] + (Math.random() * 40 - 20) | 0},${rgb[1] + (Math.random() * 34 - 17) | 0},${rgb[2] + (Math.random() * 30 - 15) | 0},${a})`;
      x.fillRect(65 + Math.random() * 190, 75 + Math.random() * 265, 2 + s.rough * 3, 2 + s.rough * 3);
    }
    // 잡티
    for (let i = 0; i < s.spots; i++) {
      x.fillStyle = `rgba(${(rgb[0] * 0.6) | 0},${(rgb[1] * 0.55) | 0},${(rgb[2] * 0.5) | 0},.5)`;
      x.beginPath(); x.arc(80 + Math.random() * 160, 115 + Math.random() * 200, 3 + Math.random() * 5, 0, 7); x.fill();
    }
    // T존 광택
    if (s.shine) {
      const sh = x.createLinearGradient(0, 90, 0, 260);
      sh.addColorStop(0, `rgba(255,255,255,${s.shine * 0.5})`);
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sh;
      x.fillRect(130, 90, 60, 170);
    }
    // 눈밑 그늘
    x.fillStyle = `rgba(${(rgb[0] * 0.5) | 0},${(rgb[1] * 0.45) | 0},${(rgb[2] * 0.45) | 0},${0.25 + s.dark})`;
    x.beginPath(); x.ellipse(120, 176, 26, 10, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(200, 176, 26, 10, 0, 0, 7); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, spec);
  const p = path.join(OUT, `${name}.png`);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

/* ───────── 한 사람의 전체 여정 ───────── */
async function runPersona(p) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const before = await paintFace(page, p.face, `${p.id}-before`);

  // ── 문진
  await tap(page, '#btn-start');
  await page.waitForSelector('#screen-intake.active');
  if (p.intake) {
    for (const [key, value] of Object.entries(p.intake)) {
      await tap(page, `[data-intake="${key}"][data-value="${value}"]`);
    }
    const done = await count(page, '.question.done');
    note(p.id, '문진 6문항 저장', done === 6, `저장된 문항 ${done}/6`);
  } else {
    note(p.id, '문진 건너뛰기 허용', true, '문진 없이 진행');
  }
  await tap(page, '[data-action="intake-done"]');
  await page.waitForTimeout(600);

  // ── 촬영(업로드) → 상담
  await page.setInputFiles('#file-input', before);
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  // 타이핑이 끝날 때까지 기다린다 (중간에 세면 실제와 다른 수를 본다)
  await page.waitForSelector('#chat-stream[data-playing="0"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(250);
  const freeBubbles = await page.locator('#chat-stream .bubble.in').count();
  note(p.id, '무료 상담 노출', freeBubbles >= 3, `말풍선 ${freeBubbles}개`);
  const hasPlan = await txt(page, '#chat-stream');
  note(p.id, '결제 전 처방 비노출', !/1순위 —/.test(hasPlan), '무료 구간에 관리 순서 없음');
  const freeHighlights = await count(page, '.bubble.highlight');
  await shot(page, `${p.id}-1-consult-free`);

  // ── 리포트(무료) 확인
  await tap(page, '[data-goto="result"]');
  await page.waitForSelector('#screen-result.active');
  await page.waitForTimeout(200);
  const score = Number(await txt(page, '.ring .val b'));
  const tone = (await txt(page, '.tone-meta')).replace(/\s+/g, ' ').trim();
  note(p.id, '점수 산출', score > 0 && score <= 100, `총점 ${score}`);
  const itaMatch = tone.match(/ITA ([-\d.]+)°/);
  note(p.id, '톤 좌표 산출', !!itaMatch, tone.slice(0, 70));

  // 측정 결과가 자각과 실제로 다른지 여기서 판정하고, 지적 여부는 결제 후 전체 상담에서 확인한다
  const gradeLine = await txt(page, '.grade').catch(() => '');
  const measuredType = (gradeLine.match(/·\s*(\S+)\s*피부/) || [])[1] || '';
  const SELF_LABEL = { dry: '건성', oily: '지성', combination: '복합성', sensitive: '민감성' };
  const selfLabel = SELF_LABEL[p.intake?.selfType];
  const mismatch = Boolean(selfLabel && measuredType && selfLabel !== measuredType);

  // ── 결제
  await tap(page, '[data-action="paywall"]');
  await page.waitForSelector('#screen-paywall.active');
  if (p.coupon) {
    await page.fill('#coupon-input', p.coupon);
    await tap(page, '[data-action="apply-coupon"]');
    const msg = await txt(page, '#coupon-msg');
    note(p.id, '쿠폰 적용', msg.includes('✓'), msg.trim());
  }
  await tap(page, `[data-plan="${p.plan}"]`);
  await page.waitForTimeout(200);
  await tap(page, '[data-action="pay"]');
  await page.waitForSelector('#screen-consult.active .bubble', { timeout: 25000 });
  await tap(page, '#btn-skip-typing');
  await page.waitForTimeout(400);
  const allText = await txt(page, '#chat-stream');
  note(p.id, '결제 후 전체 상담 해제', /1순위|유지 포인트/.test(allText) && /4주 뒤에 같은 조명/.test(allText), `대사 ${await page.locator('#chat-stream .bubble').count()}개`);
  if (selfLabel) {
    const proHighlights = await count(page, '.bubble.highlight');
    if (mismatch) {
      note(p.id, '자각·측정 불일치 지적', proHighlights >= 1,
        `자각 ${selfLabel} vs 측정 ${measuredType} → 지적 ${proHighlights}개 (무료 구간 ${freeHighlights}개)`);
    } else {
      note(p.id, '자각·측정 일치', true, `자각 ${selfLabel} = 측정 ${measuredType}`);
    }
  }
  await shot(page, `${p.id}-2-consult-pro`);

  // ── 추천 & 구매 클릭
  await tap(page, '.tabbar [data-goto="shop"]');
  await page.waitForSelector('.product', { timeout: 20000 });
  const products = await count(page, '.product');
  const shadeText = await txt(page, '.shade-chip').catch(() => '');
  note(p.id, '맞춤 추천 랭킹', products >= 5, `${products}개 상품`);
  note(p.id, '셰이드 매칭', /매칭 \d+%/.test(shadeText), shadeText.trim().slice(0, 50));
  const lowest = await count(page, '.offer .pill.gold');
  note(p.id, '최저가 배지 표시', lowest >= 1, `${lowest}개`);

  // 실제 판매처로 나가는 건 이 컨테이너에서 로드되지 않으므로,
  // 앱이 브라우저에 '건넨 URL'을 가로채 확인한다 (파트너 파라미터 포함 여부가 핵심).
  await page.evaluate(() => {
    window.__openedUrls = [];
    window.open = (u) => { window.__openedUrls.push(u); return null; };
  });
  await page.locator('.offer .buy:visible').first().click();
  await page.waitForTimeout(900);
  const opened = await page.evaluate(() => window.__openedUrls || []);
  const url = opened[0] || '';
  const okLink = /^https:\/\//.test(url) && /coupang|naver|oliveyoung|11st|amazon/.test(url)
    && (!/coupang/.test(url) || /lptag=SIMTEST01/.test(url));
  note(p.id, '제휴 링크 생성', okLink, url ? `${new URL(url).host}${/lptag=/.test(url) ? ' (파트너ID 부착)' : ''}` : '링크 없음');
  await shot(page, `${p.id}-3-shop`);

  // ── 4주 뒤 재측정 (개선된 얼굴)
  const improved = { ...p.face, rough: p.face.rough * 0.35, spots: Math.round(p.face.spots * 0.3), shine: p.face.shine * 0.4, dark: p.face.dark * 0.4 };
  const after = await paintFace(page, improved, `${p.id}-after`);
  await tap(page, '.tabbar [data-goto="intake"]');
  await page.waitForTimeout(300);
  if (p.intake) {
    const remembered = await count(page, '.question.done');
    note(p.id, '문진 답변 기억', remembered === 6, `재방문 시 ${remembered}/6 유지`);
  }
  await tap(page, '[data-action="intake-done"]');
  await page.waitForTimeout(600);
  await page.setInputFiles('#file-input', after);
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  await page.waitForTimeout(1200);

  // ── 전/후 비교
  await tap(page, '.tabbar [data-goto="compare"]');
  await page.waitForSelector('#compare-body', { timeout: 20000 });
  await page.waitForTimeout(700);
  const hasWidget = await count(page, '#compare-widget');
  note(p.id, '전/후 사진 비교 표시', hasWidget === 1, hasWidget ? '슬라이더 렌더' : '위젯 없음');
  if (hasWidget) {
    const rows = await count(page, '#compare-body .metric');
    const noteText = (await txt(page, '.doctor-note')).replace(/\s+/g, ' ').trim();
    note(p.id, '항목별 변화 9개', rows === 9, `${rows}행`);
    note(p.id, '재진 소견 생성', noteText.length > 40, noteText.slice(0, 60) + '…');
    const box = await page.locator('#compare-widget').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const clip = await page.locator('#compare-clip').evaluate((el) => el.style.clipPath);
    note(p.id, '슬라이더 드래그', /inset\(0px \d/.test(clip), clip);
  }
  await shot(page, `${p.id}-4-compare`);

  note(p.id, '콘솔 에러 없음', errors.length === 0, errors.slice(0, 2).join(' | ') || '없음');
  await ctx.close();
  return { score };
}

/* ───────── 엣지 케이스 ───────── */
async function runEdgeCases() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1) 너무 어두운 사진 → 품질 경고
  const dark = await paintFace(page, { base: '#2a1f18', rough: 0.2, spots: 0, shine: 0, dark: 0 }, 'edge-dark');
  await tap(page, '#btn-start');
  await tap(page, '[data-action="intake-done"]');
  await page.waitForTimeout(500);
  await page.setInputFiles('#file-input', dark);
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  const toastText = await txt(page, '#toast').catch(() => '');
  await tap(page, '[data-goto="result"]');
  const conf = await page.locator('.screen.active .pill').filter({ hasText: '촬영 신뢰도' }).first().textContent().catch(() => '');
  note('edge', '어두운 사진 신뢰도 하향', /촬영 신뢰도 \d+%/.test(conf), `${conf.trim()} / 안내: ${toastText.trim().slice(0, 30) || '없음'}`);

  // 2) 1회 이용권은 다른 리포트를 열지 않는다
  await tap(page, '[data-action="paywall"]');
  await tap(page, '[data-plan="single"]');
  await tap(page, '[data-action="pay"]');
  await page.waitForSelector('#screen-consult.active .bubble', { timeout: 20000 });
  const light = await paintFace(page, { base: '#e9c6a8', rough: 0.4, spots: 15, shine: 0.3, dark: 0.1 }, 'edge-second');
  await tap(page, '.tabbar [data-goto="intake"]');
  await tap(page, '[data-action="intake-done"]');
  await page.waitForTimeout(500);
  await page.setInputFiles('#file-input', light);
  await page.waitForSelector('#screen-consult.active', { timeout: 25000 });
  await page.waitForTimeout(1500);
  const lockVisible = await count(page, '.lock-cta');
  note('edge', '1회권은 새 리포트를 열지 않음', lockVisible === 1, lockVisible ? '두 번째 측정은 잠김' : '잘못 열림');

  // 3) 잘못된 쿠폰
  await tap(page, '[data-action="paywall"]');
  await page.fill('#coupon-input', 'NOPE999');
  await tap(page, '[data-action="apply-coupon"]');
  const msg = await txt(page, '#coupon-msg');
  note('edge', '잘못된 쿠폰 안내', msg.includes('찾을 수 없습니다'), msg.trim());

  // 4) 측정 없이 추천/비교 진입
  const fresh = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const p2 = await fresh.newPage();
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await tap(p2, '.tabbar [data-goto="shop"]');
  await p2.waitForTimeout(600);
  const shopEmpty = await count(p2, '#shop-body .empty');
  await tap(p2, '.tabbar [data-goto="compare"]');
  await p2.waitForTimeout(900);
  const cmpEmpty = await count(p2, '#compare-body .empty');
  note('edge', '측정 전 빈 화면 안내', shopEmpty === 1 && cmpEmpty === 1, `추천 ${shopEmpty} / 비교 ${cmpEmpty}`);
  await fresh.close();

  note('edge', '콘솔 에러 없음', errors.length === 0, errors.slice(0, 2).join(' | ') || '없음');
  await ctx.close();
}

/* ───────── 실행 ───────── */
console.log('\n▶ SkinLab AI 실사용 시뮬레이션\n' + '─'.repeat(64));
const scores = {};
for (const p of PERSONAS) {
  process.stdout.write(`  · ${p.label} … `);
  try {
    const r = await runPersona(p);
    scores[p.id] = r.score;
    console.log('완료');
  } catch (err) {
    note(p.id, '여정 완주', false, err.message);
    console.log(`중단 (${err.message})`);
  }
}
process.stdout.write('  · 엣지 케이스 … ');
try { await runEdgeCases(); console.log('완료'); }
catch (err) { note('edge', '엣지 케이스 완주', false, err.message); console.log(`중단 (${err.message})`); }

// 서버 지표 검증
const kpi = await fetch(`${BASE}/api/admin/metrics`, { headers: { 'x-admin-token': 'sim' } }).then((r) => r.json());
note('server', '매출 집계', kpi.revenue.total > 0, `구독 ${kpi.revenue.subscription.toLocaleString()}원 · 클릭 ${kpi.affiliate.clicks}회`);
note('server', '퍼널 전환율 정상범위', kpi.funnel.overallCvr > 0 && kpi.funnel.overallCvr <= 100, `${kpi.funnel.overallCvr}%`);

await browser.close();
server.kill();

/* ───────── 리포트 ───────── */
console.log('─'.repeat(64));
const byPersona = {};
for (const r of results) (byPersona[r.persona] ||= []).push(r);
for (const [id, rows] of Object.entries(byPersona)) {
  const bad = rows.filter((r) => !r.ok);
  console.log(`\n${bad.length ? '✗' : '✓'} ${id}  (${rows.length - bad.length}/${rows.length})`);
  for (const r of rows) console.log(`   ${r.ok ? '✓' : '✗'} ${r.step.padEnd(22)} ${r.detail}`);
}
console.log('\n' + '─'.repeat(64));
console.log('페르소나별 총점:', Object.entries(scores).map(([k, v]) => `${k}=${v}`).join('  '));
console.log(`검사 ${results.length}건 · 실패 ${problems.length}건`);
if (problems.length) {
  console.log('\n문제:');
  problems.forEach((p) => console.log('  ! ' + p));
}
if (SHOTS) console.log(`\n스크린샷: ${OUT}`);
process.exit(problems.length ? 1 : 0);
