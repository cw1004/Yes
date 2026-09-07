/**
 * 제휴 링크 생성 + 클릭 추적 + 전환 포스트백.
 *
 * 실제 파트너 승인 전에도 동작하도록 각 머천트의 검색 딥링크를 만들고,
 * 파트너 ID가 환경변수에 있으면 제휴 파라미터를 자동으로 붙인다.
 * 모든 아웃바운드는 /api/click 을 거치므로 클릭 -> 전환 -> 수수료를 한 줄로 추적할 수 있다.
 */
import crypto from 'node:crypto';
import { db, logEvent } from './store.js';

const PARTNER = {
  coupang: process.env.COUPANG_PARTNER_ID || '',
  naver: process.env.NAVER_PARTNER_ID || '',
  oliveyoung: process.env.OLIVEYOUNG_PARTNER_ID || '',
  eleven: process.env.ELEVEN_PARTNER_ID || '',
  amazon: process.env.AMAZON_ASSOC_TAG || '',
};

const BUILDERS = {
  coupang: (q, sub) => {
    const url = new URL('https://www.coupang.com/np/search');
    url.searchParams.set('q', q);
    if (PARTNER.coupang) { url.searchParams.set('lptag', PARTNER.coupang); url.searchParams.set('subId', sub); }
    return url.toString();
  },
  naver: (q, sub) => {
    const url = new URL('https://search.shopping.naver.com/search/all');
    url.searchParams.set('query', q);
    if (PARTNER.naver) { url.searchParams.set('nt_source', PARTNER.naver); url.searchParams.set('nt_detail', sub); }
    return url.toString();
  },
  oliveyoung: (q, sub) => {
    const url = new URL('https://www.oliveyoung.co.kr/store/search/getSearchMain.do');
    url.searchParams.set('query', q);
    if (PARTNER.oliveyoung) { url.searchParams.set('utm_source', PARTNER.oliveyoung); url.searchParams.set('utm_content', sub); }
    return url.toString();
  },
  eleven: (q, sub) => {
    const url = new URL('https://search.11st.co.kr/Search.tmall');
    url.searchParams.set('kwd', q);
    if (PARTNER.eleven) { url.searchParams.set('trTypeCd', PARTNER.eleven); url.searchParams.set('trCtgrNo', sub); }
    return url.toString();
  },
  amazon: (q, sub) => {
    const url = new URL('https://www.amazon.com/s');
    url.searchParams.set('k', q);
    if (PARTNER.amazon) { url.searchParams.set('tag', PARTNER.amazon); url.searchParams.set('ascsubtag', sub); }
    return url.toString();
  },
};

export function hasPartnerId(merchant) {
  return Boolean(PARTNER[merchant]);
}

/** 클릭 레코드를 만들고 최종 이동 URL을 돌려준다 */
export function trackClick({ userId, productId, merchant, query, price, commissionRate, analysisId, position }) {
  const build = BUILDERS[merchant];
  if (!build) throw Object.assign(new Error(`지원하지 않는 판매처: ${merchant}`), { status: 400 });
  const clickId = `clk_${crypto.randomBytes(8).toString('hex')}`;
  const sub = `${clickId}`;
  const url = build(query, sub);
  const click = {
    clickId, userId: userId || null, productId, merchant, analysisId: analysisId || null,
    position: position ?? null, price: price ?? null, commissionRate: commissionRate ?? null,
    expectedCommission: price && commissionRate ? Math.round(price * commissionRate) : null,
    at: new Date().toISOString(), converted: false, revenue: 0,
  };
  db.update((d) => {
    d.clicks.push(click);
    if (d.clicks.length > 50000) d.clicks.splice(0, d.clicks.length - 50000);
  });
  logEvent('affiliate_click', { userId, productId, merchant, clickId });
  return { clickId, url, partnerLinked: hasPartnerId(merchant) };
}

/** 머천트 S2S 포스트백 — 전환/수수료 확정 */
export function recordConversion({ clickId, revenue, orderAmount, status = 'confirmed' }) {
  let found = null;
  db.update((d) => {
    const c = d.clicks.find((x) => x.clickId === clickId);
    if (!c) return;
    c.converted = true;
    c.revenue = Number(revenue) || c.expectedCommission || 0;
    c.orderAmount = Number(orderAmount) || null;
    c.status = status;
    c.convertedAt = new Date().toISOString();
    found = c;
  });
  if (found) logEvent('affiliate_conversion', { clickId, revenue: found.revenue, merchant: found.merchant });
  return found;
}
