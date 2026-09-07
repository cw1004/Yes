/**
 * 결제 · 이용권(entitlement).
 *
 * 제공자(provider)는 환경변수로 갈아끼운다:
 *   SKINLAB_PAYMENTS=mock   (기본, 키 없이 데모 결제)
 *   SKINLAB_PAYMENTS=toss   TOSS_SECRET_KEY 필요 (국내 카드/간편결제)
 *   SKINLAB_PAYMENTS=stripe STRIPE_SECRET_KEY 필요 (해외 카드)
 * 어떤 제공자든 결제 승인 후 grantEntitlement() 한 곳으로 모인다.
 */
import crypto from 'node:crypto';
import { db, logEvent } from './store.js';

export const PLANS = {
  single: {
    id: 'single', name: '리포트 1회 해제', price: 4900, currency: 'KRW', period: 'once',
    durationDays: 7,
    features: ['전체 9개 지표 해제', '원인 분석 + 아침/저녁 루틴', '4주 개선 플랜', '성분 추천/회피 리스트'],
  },
  monthly: {
    id: 'monthly', name: '월간 멤버십', price: 9900, currency: 'KRW', period: 'month',
    durationDays: 31, badge: '가장 인기',
    features: ['무제한 진단 + 전체 리포트', '주간 변화 추적 그래프', '루틴 리마인더', '멤버 전용 쿠폰', '광고 제거'],
  },
  yearly: {
    id: 'yearly', name: '연간 멤버십', price: 79000, currency: 'KRW', period: 'year',
    durationDays: 366, badge: '33% 절약',
    features: ['월간 혜택 전체', '2개월분 무료', '피부 연간 리포트', '신제품 우선 체험단'],
  },
};

export const provider = () => process.env.SKINLAB_PAYMENTS || 'mock';

export function activeEntitlement(userId) {
  const ent = db.read().entitlements[userId];
  if (!ent) return null;
  if (ent.expiresAt && new Date(ent.expiresAt) < new Date()) return { ...ent, expired: true };
  return ent;
}

export function hasProAccess(userId, analysisId) {
  const ent = activeEntitlement(userId);
  if (!ent || ent.expired) return false;
  if (ent.plan === 'monthly' || ent.plan === 'yearly') return true;
  if (ent.plan === 'single') return !analysisId || !!ent.reports?.[analysisId];
  return false;
}

export function grantEntitlement(userId, planId, orderId, analysisId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  const expiresAt = new Date(Date.now() + plan.durationDays * 864e5).toISOString();
  db.update((d) => {
    const prev = d.entitlements[userId];
    const reports = { ...(prev?.reports || {}) };
    if (planId === 'single' && analysisId) reports[analysisId] = true;
    d.entitlements[userId] = { userId, plan: planId, orderId, grantedAt: new Date().toISOString(), expiresAt, reports };
    if (d.users[userId]) d.users[userId].plan = planId;
  });
  logEvent('entitlement_granted', { userId, plan: planId, orderId, analysisId });
  return activeEntitlement(userId);
}

export function createOrder({ userId, planId, analysisId, couponCode }) {
  const plan = PLANS[planId];
  if (!plan) throw Object.assign(new Error('알 수 없는 요금제입니다.'), { status: 400 });
  const discount = applyCoupon(couponCode, plan.price);
  const amount = plan.price - discount.amount;
  const orderId = `ord_${crypto.randomUUID()}`;
  const order = {
    orderId, userId, planId, analysisId: analysisId || null,
    amount, currency: plan.currency, discount,
    status: 'pending', provider: provider(), createdAt: new Date().toISOString(),
  };
  db.update((d) => { d.orders[orderId] = order; });
  logEvent('checkout_started', { userId, planId, amount, orderId });
  return order;
}

function applyCoupon(code, price) {
  if (!code) return { code: null, amount: 0 };
  const c = db.read().coupons[String(code).toUpperCase()];
  if (!c || (c.expiresAt && new Date(c.expiresAt) < new Date())) return { code, amount: 0, invalid: true };
  const amount = c.type === 'percent' ? Math.floor((price * c.value) / 100) : Math.min(price, c.value);
  return { code: String(code).toUpperCase(), amount, label: c.label };
}

/** 제공자별 결제창 정보. 클라이언트는 이 응답만 보고 분기한다. */
export async function startPayment(order) {
  switch (order.provider) {
    case 'stripe': {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw Object.assign(new Error('STRIPE_SECRET_KEY 가 설정되지 않았습니다.'), { status: 503 });
      const base = process.env.PUBLIC_BASE_URL || 'http://localhost:8787';
      const body = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price_data][currency]': order.currency.toLowerCase(),
        'line_items[0][price_data][product_data][name]': PLANS[order.planId].name,
        'line_items[0][price_data][unit_amount]': String(order.amount),
        'line_items[0][quantity]': '1',
        client_reference_id: order.orderId,
        success_url: `${base}/?paid=${order.orderId}`,
        cancel_url: `${base}/?canceled=${order.orderId}`,
      });
      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error?.message || 'stripe error'), { status: 502 });
      return { type: 'redirect', url: json.url, providerRef: json.id };
    }
    case 'toss': {
      // 토스는 클라이언트 SDK 가 결제창을 띄우고, 서버는 confirm 단계에서 검증한다.
      const clientKey = process.env.TOSS_CLIENT_KEY;
      if (!clientKey) throw Object.assign(new Error('TOSS_CLIENT_KEY 가 설정되지 않았습니다.'), { status: 503 });
      return { type: 'sdk', sdk: 'toss', clientKey, orderId: order.orderId, amount: order.amount, orderName: PLANS[order.planId].name };
    }
    default:
      return { type: 'mock', orderId: order.orderId, amount: order.amount, message: '데모 결제 모드입니다. 실제 청구되지 않습니다.' };
  }
}

/** 결제 승인 확인 후 이용권 지급 */
export async function confirmPayment({ orderId, paymentKey, amount }) {
  const order = db.read().orders[orderId];
  if (!order) throw Object.assign(new Error('주문을 찾을 수 없습니다.'), { status: 404 });
  if (order.status === 'paid') return { order, entitlement: activeEntitlement(order.userId), alreadyPaid: true };

  if (order.provider === 'toss') {
    const secret = process.env.TOSS_SECRET_KEY;
    if (!secret) throw Object.assign(new Error('TOSS_SECRET_KEY 미설정'), { status: 503 });
    if (Number(amount) !== order.amount) throw Object.assign(new Error('결제 금액이 주문 금액과 다릅니다.'), { status: 400 });
    const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: order.amount }),
    });
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error(json.message || '결제 승인 실패'), { status: 402 });
  } else if (order.provider === 'stripe') {
    const key = process.env.STRIPE_SECRET_KEY;
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${paymentKey}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok || json.payment_status !== 'paid' || json.client_reference_id !== orderId) {
      throw Object.assign(new Error('결제가 확인되지 않았습니다.'), { status: 402 });
    }
  }
  // mock 제공자는 별도 검증 없이 승인 (데모)

  db.update((d) => {
    d.orders[orderId] = { ...d.orders[orderId], status: 'paid', paidAt: new Date().toISOString(), paymentKey: paymentKey || null };
  });
  const entitlement = grantEntitlement(order.userId, order.planId, orderId, order.analysisId);
  logEvent('purchase', { userId: order.userId, planId: order.planId, amount: order.amount, orderId });
  return { order: db.read().orders[orderId], entitlement };
}

/** Stripe webhook 서명 검증 (t=,v1= 형식) */
export function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
