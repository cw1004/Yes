/**
 * SkinLab AI 서버 — 의존성 없는 Node HTTP 서버.
 * 역할: 정적 파일 서빙 + 리포트 권한 게이팅 + 결제 + 제휴 링크 추적 + 지표 집계.
 *
 * 중요한 설계 원칙 하나: 얼굴 이미지는 절대 서버로 올라오지 않는다.
 * 분석은 브라우저에서 끝나고, 서버는 숫자 지표만 받는다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db, logEvent } from './store.js';
import { createUser, userFromRequest } from './auth.js';
import { PLANS, provider, createOrder, startPayment, confirmPayment, hasProAccess, activeEntitlement, verifyStripeSignature } from './payments.js';
import { trackClick, recordConversion, hasPartnerId } from './links.js';
import { kpis } from './analytics.js';
import { loadCatalog } from './feeds/index.js';
import { diagnose, DISCLAIMER } from '../public/js/engine/diagnose.js';
import { sanitizeIntake } from '../public/js/engine/intake.js';
import { sanitizeAnalysis, sanitizeQuality } from './validate.js';
import { narrate } from './doctor.js';
import { rankProducts, buildBundle } from '../public/js/engine/ranking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

// 실데이터가 동기화돼 있으면 그것을, 없으면 샘플로 되돌아간다 (server/feeds/index.js)
const catalogSource = loadCatalog();
const catalog = catalogSource.catalog;
if (catalogSource.source !== 'live') console.warn(`[카탈로그] ${catalogSource.reason}`);

seedCoupons();

/** 토큰 비교는 상수 시간으로 — 문자열 비교는 일치하는 앞부분 길이만큼 시간이 달라진다 */
function tokenEquals(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 운영 환경에서 위험한 기본값으로 뜨는 걸 막는다.
 * 데모 설정 그대로 배포되면 토큰 위조와 무료 결제가 가능해진다.
 */
function assertProductionSafety() {
  if (process.env.NODE_ENV !== 'production') return;
  const fatal = [];
  if (!process.env.SKINLAB_SECRET) fatal.push('SKINLAB_SECRET 이 없습니다 — 기본 키로는 이용권 토큰을 누구나 위조할 수 있습니다.');
  if ((process.env.SKINLAB_PAYMENTS || 'mock') === 'mock') fatal.push('SKINLAB_PAYMENTS=mock 은 결제 없이 이용권을 내줍니다. toss 또는 stripe 로 설정하세요.');
  if (!process.env.ADMIN_TOKEN) fatal.push('ADMIN_TOKEN 이 없습니다 — 관리자 지표가 열려 있게 됩니다.');
  if (fatal.length) {
    console.error('\n서버를 시작할 수 없습니다 (운영 안전 점검):');
    for (const f of fatal) console.error(`  · ${f}`);
    console.error('');
    process.exit(1);
  }
}

/**
 * 아주 단순한 IP 단위 호출 제한.
 * 목적은 정교한 방어가 아니라 '한 명이 분석/클릭을 무한히 만들어 DB와 실적을 오염시키는 것'을 막는 것.
 * 인스턴스를 여러 대 띄우면 이 카운터는 공유되지 않는다 — 그때는 앞단(nginx/CDN)에서 걸어야 한다.
 */
const RATE_RULES = [
  { test: (p) => p === '/api/analysis', limit: 30, windowMs: 60 * 60e3, name: '분석' },
  { test: (p) => p === '/api/session', limit: 20, windowMs: 60 * 60e3, name: '세션' },
  { test: (p) => p === '/api/click', limit: 120, windowMs: 60 * 60e3, name: '클릭' },
  { test: (p) => p === '/api/checkout' || p === '/api/checkout/confirm', limit: 40, windowMs: 60 * 60e3, name: '결제' },
  { test: (p) => p.startsWith('/api/'), limit: 600, windowMs: 60 * 60e3, name: 'API' },
];
const buckets = new Map();

function rateLimit(req, pathname) {
  const rule = RATE_RULES.find((r) => r.test(pathname));
  if (!rule) return null;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const key = `${ip}|${rule.name}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 20000) for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    return null;
  }
  b.count++;
  if (b.count > rule.limit) {
    return { retryAfter: Math.ceil((b.resetAt - now) / 1000), rule: rule.name };
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
};

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = async (req) => {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('잘못된 JSON 입니다.'), { status: 400 }); }
};

function seedCoupons() {
  db.update((d) => {
    if (Object.keys(d.coupons).length) return;
    d.coupons = {
      WELCOME30: { type: 'percent', value: 30, label: '첫 진단 30% 할인' },
      FRIEND2000: { type: 'amount', value: 2000, label: '친구 추천 2,000원' },
    };
  });
}

/** 분석 결과 -> 추천 프로필 */
function profileOf(record) {
  const d = record.diagnosis;
  return {
    tone: record.analysis.tone,
    skinType: d.skinType.key,
    skinTypeLabel: d.skinType.label,
    concerns: d.concerns.map((c) => ({ key: c.key, label: c.label, score: c.score })),
  };
}

const routes = {
  'GET /api/config': async () => ({
    plans: Object.values(PLANS),
    provider: provider(),
    disclaimer: DISCLAIMER,
    catalogNote: catalog._meta?.note,
    catalogSource: {
      source: catalogSource.source,          // seed | live | live-stale
      syncedAt: catalog._meta?.syncedAt || null,
      ageHours: catalogSource.ageHours ?? null,
      note: catalogSource.reason || null,
    },
    merchants: catalog.merchants,
    partnerLinked: Object.fromEntries(Object.keys(catalog.merchants).map((m) => [m, hasPartnerId(m)])),
    coupons: Object.entries(db.read().coupons).map(([code, c]) => ({ code, label: c.label })),
  }),

  'POST /api/session': async (req) => {
    const existing = userFromRequest(req);
    if (existing) return { userId: existing.id, plan: existing.plan, entitlement: activeEntitlement(existing.id), reissued: false };
    const { userId, token } = createUser();
    return { userId, token, plan: 'free', entitlement: null, reissued: true };
  },

  'POST /api/analysis': async (req) => {
    const user = userFromRequest(req);
    if (!user) throw Object.assign(new Error('세션이 필요합니다.'), { status: 401 });
    const body = await json(req);
    // 분석은 브라우저에서 계산되므로 서버는 그 값을 믿지 않는다 (server/validate.js)
    const analysis = sanitizeAnalysis(body.analysis);

    const id = `an_${crypto.randomBytes(6).toString('hex')}`;
    const diagnosis = diagnose(analysis);

    // 체험 모드로 만든 기록. 실제 사용자 행동이 아니므로 매출·퍼널 지표에서 제외한다
    // (체험이 전환율에 섞이면 지표가 거짓말을 한다).
    const simulated = body.simulated === true;
    // 날짜 소급은 체험에서만 허용한다 — '4주 전 기준선'을 만들어 전후 비교를 보여주기 위해서다
    const backdateDays = simulated ? Math.min(365, Math.max(0, Number(body.backdateDays) || 0)) : 0;
    const createdAt = new Date(Date.now() - backdateDays * 864e5).toISOString();

    const record = {
      id, userId: user.id, createdAt,
      analysis: { ...analysis, createdAt },
      quality: sanitizeQuality(body.quality), diagnosis,
      intake: sanitizeIntake(body.intake),
      simulated,
    };
    db.update((d) => { d.analyses[id] = record; });
    logEvent('analysis_completed', {
      userId: user.id, analysisId: id, score: analysis.totalScore,
      intake: Object.keys(record.intake).length, simulated,
    });

    return await buildReport(record, user);
  },

  'GET /api/report': async (req, url) => {
    const user = userFromRequest(req);
    const record = db.read().analyses[url.searchParams.get('id')];
    if (!record) throw Object.assign(new Error('리포트를 찾을 수 없습니다.'), { status: 404 });
    if (!user || record.userId !== user.id) throw Object.assign(new Error('접근 권한이 없습니다.'), { status: 403 });
    return await buildReport(record, user);
  },

  'GET /api/history': async (req) => {
    const user = userFromRequest(req);
    if (!user) throw Object.assign(new Error('세션이 필요합니다.'), { status: 401 });
    const items = Object.values(db.read().analyses)
      .filter((a) => a.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map((a) => ({
        id: a.id, createdAt: a.createdAt, totalScore: a.analysis.totalScore, grade: a.analysis.grade,
        simulated: Boolean(a.simulated),
        tone: a.analysis.tone,
        metrics: a.analysis.metrics.map((m) => ({ key: m.key, label: m.label, score: m.score, level: m.level })),
      }));
    return { items };
  },

  'GET /api/recommend': async (req, url) => {
    const user = userFromRequest(req);
    const record = db.read().analyses[url.searchParams.get('id')];
    if (!record) throw Object.assign(new Error('분석 결과가 필요합니다.'), { status: 404 });
    if (!user || record.userId !== user.id) throw Object.assign(new Error('접근 권한이 없습니다.'), { status: 403 });

    const profile = profileOf(record);
    const category = url.searchParams.get('category') || null;
    const ranked = rankProducts(catalog, profile, { category, limit: Number(url.searchParams.get('limit')) || 12 });
    logEvent('recommend_view', { userId: user.id, analysisId: record.id, count: ranked.length });
    return {
      analysisId: record.id,
      profile: { tone: profile.tone, skinType: profile.skinTypeLabel, personalColor: record.diagnosis.personalColor },
      items: ranked,
      bundle: buildBundle(ranked, profile),
      disclosure: '랭킹은 피부 적합도(55%) · 사용자 평가와 배송(30%) · 제휴 수익(15%)을 합산해 계산되며, 구매 시 수수료를 받을 수 있습니다.',
    };
  },

  'POST /api/checkout': async (req) => {
    const user = userFromRequest(req);
    if (!user) throw Object.assign(new Error('세션이 필요합니다.'), { status: 401 });
    const { planId, analysisId, couponCode } = await json(req);
    const order = createOrder({ userId: user.id, planId, analysisId, couponCode });
    const payment = await startPayment(order);
    return { order, payment };
  },

  'POST /api/checkout/confirm': async (req) => {
    const user = userFromRequest(req);
    if (!user) throw Object.assign(new Error('세션이 필요합니다.'), { status: 401 });
    const { orderId, paymentKey, amount } = await json(req);
    const order = db.read().orders[orderId];
    if (!order || order.userId !== user.id) throw Object.assign(new Error('주문을 찾을 수 없습니다.'), { status: 404 });
    const result = await confirmPayment({ orderId, paymentKey, amount });
    const record = order.analysisId ? db.read().analyses[order.analysisId] : null;
    return { ...result, report: record ? await buildReport(record, db.read().users[user.id]) : null };
  },

  'POST /api/paywall-view': async (req) => {
    const user = userFromRequest(req);
    const { analysisId, source } = await json(req);
    logEvent('paywall_view', { userId: user?.id || null, analysisId, source });
    return { ok: true };
  },

  'POST /api/click': async (req) => {
    const user = userFromRequest(req);
    const { productId, merchant, analysisId, position } = await json(req);
    const product = catalog.products.find((p) => p.id === productId);
    if (!product) throw Object.assign(new Error('상품을 찾을 수 없습니다.'), { status: 404 });
    const offer = product.offers.find((o) => o.merchant === merchant);
    if (!offer) throw Object.assign(new Error('해당 판매처 오퍼가 없습니다.'), { status: 404 });
    const result = trackClick({
      userId: user?.id, productId, merchant, analysisId, position,
      query: `${product.brand} ${product.name}`,
      productUrl: offer.url || null,     // 동기화가 상품 URL 을 가져왔으면 그리로 보낸다
      price: Math.max(0, offer.price - (offer.coupon || 0)),
      commissionRate: offer.commissionRate,
    });
    return result;
  },

  'POST /api/postback': async (req) => {
    if (!tokenEquals(req.headers['x-postback-token'], process.env.AFFILIATE_POSTBACK_TOKEN)) {
      throw Object.assign(new Error('인증 실패'), { status: 401 });
    }
    const { clickId, revenue, orderAmount, status } = await json(req);
    const click = recordConversion({ clickId, revenue, orderAmount, status });
    if (!click) throw Object.assign(new Error('클릭 기록을 찾을 수 없습니다.'), { status: 404 });
    return { ok: true, click };
  },

  'POST /api/webhooks/stripe': async (req) => {
    const raw = await readBody(req);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secret && !verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
      throw Object.assign(new Error('서명 검증 실패'), { status: 400 });
    }
    const event = JSON.parse(raw || '{}');
    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      if (s.client_reference_id) {
        await confirmPayment({ orderId: s.client_reference_id, paymentKey: s.id, amount: s.amount_total });
      }
    }
    return { received: true };
  },

  'GET /api/admin/metrics': async (req) => {
    if (!tokenEquals(req.headers['x-admin-token'], process.env.ADMIN_TOKEN)) {
      throw Object.assign(new Error('ADMIN_TOKEN 이 필요합니다.'), { status: 401 });
    }
    return kpis();
  },

  'GET /api/health': async () => ({ ok: true, provider: provider(), products: catalog.products.length }),
};

/** 무료/유료 경계는 여기 한 곳에서만 정해진다 */
async function buildReport(record, user) {
  const pro = hasProAccess(user.id, record.id);
  const d = record.diagnosis;
  logEvent('report_view', { userId: user.id, analysisId: record.id, pro });

  // AI 닥터 상담문 — 결제 전에는 무료 구간 대사만 생성/전송한다
  const { consult, narrated } = await narrate(record.analysis, d, record.intake || {}, { tier: pro ? 'pro' : 'free' });
  const consultOut = pro
    ? { doctor: consult.doctor, script: consult.script, free: consult.free, discordance: consult.discordance, followUpAt: consult.followUpAt }
    : { doctor: consult.doctor, script: consult.free.script, free: consult.free, discordance: consult.discordance.filter((x) => x.tier === 'free'), followUpAt: null };

  return {
    simulated: Boolean(record.simulated),
    consult: consultOut,
    consultNarrated: narrated,
    intake: record.intake || {},
    analysisId: record.id,
    createdAt: record.createdAt,
    quality: record.quality,
    analysis: {
      totalScore: record.analysis.totalScore,
      grade: record.analysis.grade,
      tone: record.analysis.tone,
      zoneBalance: record.analysis.zoneBalance,
      // 무료 사용자에게는 상위 3개 지표만 값을 내려보낸다 (클라이언트 숨김이 아니라 서버 차단)
      metrics: pro ? record.analysis.metrics : record.analysis.metrics.slice(0, 0),
    },
    skinType: d.skinType,
    personalColor: d.personalColor,
    free: d.free,
    pro: pro ? d.pro : null,
    locked: !pro,
    lockedPreview: pro ? null : {
      concernCount: d.concerns.length,
      teaser: d.concerns.slice(0, 3).map((c) => ({ label: c.label, levelLabel: c.levelLabel })),
      unlocks: ['전체 9개 지표 점수', '지표별 원인 분석', '아침/저녁 5단계 루틴', '4주 개선 플랜', '추천/회피 성분 리스트'],
    },
    entitlement: activeEntitlement(user.id),
    disclaimer: DISCLAIMER,
  };
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);   // '/%' 같은 잘못된 인코딩은 여기서 던진다
  } catch {
    return send(res, 400, { error: 'bad path' });
  }
  // '..' 이 들어간 경로는 정규화 뒤 흔적이 사라져 SPA 폴백으로 200 을 받는다.
  // 의도가 분명한 요청이 아니므로 정규화 전에 막는다.
  if (rel.split('/').includes('..')) return send(res, 403, { error: 'forbidden' });
  if (rel === '/') rel = '/index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${path.posix.normalize(rel)}`);
  // startsWith(PUBLIC_DIR) 만으로는 'public-secret' 같은 형제 디렉터리가 통과한다
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, { error: 'forbidden' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 라우팅 대비: 확장자 없는 경로는 index.html 로
      if (!path.extname(rel)) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) =>
        e2 ? send(res, 404, { error: 'not found' }) : send(res, 200, html, { 'Content-Type': MIME['.html'] }));
      return send(res, 404, { error: 'not found' });
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    const cache = rel === '/index.html' ? 'no-cache' : 'public, max-age=300';
    send(res, 200, data, { 'Content-Type': type, 'Cache-Control': cache });
  });
}

const server = http.createServer(async (req, res) => {
 try {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, { error: 'bad request' });
  }
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') {
    // 기본은 동일 출처만. 다른 도메인에서 쓰려면 CORS_ORIGIN 을 명시적으로 지정한다.
    const origin = process.env.CORS_ORIGIN;
    if (!origin) return send(res, 204, '');
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    });
  }

  const limited = rateLimit(req, url.pathname);
  if (limited) {
    return send(res, 429,
      { error: `요청이 너무 잦습니다(${limited.rule}). ${limited.retryAfter}초 뒤에 다시 시도해 주세요.` },
      { 'Retry-After': String(limited.retryAfter) });
  }

  const handler = routes[key];
  if (handler) {
    try {
      const result = await handler(req, url, res);
      if (result !== undefined) send(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', key, err);
      send(res, status, { error: err.message || '서버 오류' });
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  serveStatic(req, res, url);
 } catch (err) {
  // 어떤 요청도 프로세스를 죽여선 안 된다 ('/%' 하나로 서비스가 내려간 적이 있다)
  console.error('[request]', req.method, req.url, err);
  if (!res.headersSent) send(res, 500, { error: '서버 오류' });
 }
});

// 마지막 방어선: 예기치 못한 예외로 프로세스가 통째로 죽지 않게 한다
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

process.on('SIGINT', () => { db.flushNow(); process.exit(0); });
process.on('SIGTERM', () => { db.flushNow(); process.exit(0); });

if (process.env.NODE_ENV !== 'test') {
  assertProductionSafety();
  server.listen(PORT, () => {
    const src = { seed: '샘플 카탈로그', live: '실데이터', 'live-stale': '실데이터(오래됨)' }[catalogSource.source];
    console.log(`SkinLab AI  →  http://localhost:${PORT}  (결제: ${provider()}, ${src} 상품 ${catalog.products.length}종)`);
  });
}

export { server, routes, buildReport };
