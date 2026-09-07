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
import { diagnose, DISCLAIMER } from '../public/js/engine/diagnose.js';
import { rankProducts, buildBundle } from '../public/js/engine/ranking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));

seedCoupons();

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
    catalogNote: catalog._meta.note,
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
    const { analysis, quality } = await json(req);
    if (!analysis?.metrics?.length || !analysis?.tone) throw Object.assign(new Error('분석 데이터가 올바르지 않습니다.'), { status: 400 });

    const id = `an_${crypto.randomBytes(6).toString('hex')}`;
    const diagnosis = diagnose(analysis);
    const record = { id, userId: user.id, createdAt: new Date().toISOString(), analysis, quality: quality || null, diagnosis };
    db.update((d) => { d.analyses[id] = record; });
    logEvent('analysis_completed', { userId: user.id, analysisId: id, score: analysis.totalScore });

    return buildReport(record, user);
  },

  'GET /api/report': async (req, url) => {
    const user = userFromRequest(req);
    const record = db.read().analyses[url.searchParams.get('id')];
    if (!record) throw Object.assign(new Error('리포트를 찾을 수 없습니다.'), { status: 404 });
    if (!user || record.userId !== user.id) throw Object.assign(new Error('접근 권한이 없습니다.'), { status: 403 });
    return buildReport(record, user);
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
        tone: a.analysis.tone, metrics: a.analysis.metrics.map((m) => ({ key: m.key, label: m.label, score: m.score })),
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
    return { ...result, report: record ? buildReport(record, db.read().users[user.id]) : null };
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
      price: Math.max(0, offer.price - (offer.coupon || 0)),
      commissionRate: offer.commissionRate,
    });
    return result;
  },

  'POST /api/postback': async (req) => {
    const token = req.headers['x-postback-token'];
    if (!process.env.AFFILIATE_POSTBACK_TOKEN || token !== process.env.AFFILIATE_POSTBACK_TOKEN) {
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
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || req.headers['x-admin-token'] !== expected) {
      throw Object.assign(new Error('ADMIN_TOKEN 이 필요합니다.'), { status: 401 });
    }
    return kpis();
  },

  'GET /api/health': async () => ({ ok: true, provider: provider(), products: catalog.products.length }),
};

/** 무료/유료 경계는 여기 한 곳에서만 정해진다 */
function buildReport(record, user) {
  const pro = hasProAccess(user.id, record.id);
  const d = record.diagnosis;
  logEvent('report_view', { userId: user.id, analysisId: record.id, pro });
  return {
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
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
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
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Postback-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
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
});

process.on('SIGINT', () => { db.flushNow(); process.exit(0); });
process.on('SIGTERM', () => { db.flushNow(); process.exit(0); });

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`SkinLab AI  →  http://localhost:${PORT}  (결제: ${provider()}, 상품 ${catalog.products.length}종)`);
  });
}

export { server, routes, buildReport };
