/**
 * 쿠팡 파트너스 오픈 API 어댑터.
 *
 * ⚠ 호출 한도가 매우 빡빡하다: **상품 검색은 1시간에 10회, 1회당 최대 10개**.
 *    그래서 사용자 요청마다 부르는 건 불가능하고, 미리 동기화해 두는 구조여야 한다.
 *    (이 프로젝트가 카탈로그를 파일로 들고 있는 이유다.)
 *
 * 인증: Authorization 헤더에 HMAC-SHA256 서명.
 * 발급: 쿠팡 파트너스 로그인 → 상단 Tools → 파트너스 API.
 *
 * 엔드포인트/서명 형식은 공식 문서(developers.coupang.com)와 한 번 대조하고 쓰세요.
 * 바뀌면 이 파일만 고치면 됩니다.
 */
import crypto from 'node:crypto';

const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';

export const id = 'coupang';
export const name = '쿠팡';
export const limits = { callsPerHour: 10, itemsPerCall: 10 };

export function isConfigured() {
  return Boolean(process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY);
}

/** 쿠팡 HMAC 서명 (datetime + method + path + query) */
function authorization(method, path, query = '') {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(2); // YYMMDDTHHMMSSZ
  const message = datetime + method + path + query;
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

async function call(method, path, query = '', body) {
  const url = `${HOST}${path}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authorization(method, path, query),
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Requested-By': process.env.COUPANG_PARTNER_ID || 'skinlab',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(`쿠팡 API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  }
  return JSON.parse(text);
}

/**
 * 키워드로 상품 검색.
 * @returns 정규화 전 원시 상품 배열
 */
export async function search(keyword, { limit = 10 } = {}) {
  const query = new URLSearchParams({ keyword, limit: String(Math.min(limit, limits.itemsPerCall)) }).toString();
  const json = await call('GET', `${BASE}/products/search`, query);
  const items = json?.data?.productData || json?.data || [];
  return items.map((it) => ({
    externalId: String(it.productId ?? it.productID ?? ''),
    name: it.productName,
    price: it.productPrice,
    url: it.productUrl,          // 이미 파트너 추적이 붙은 링크
    image: it.productImage,
    rating: null,                // 검색 API 는 평점을 주지 않는다
    reviews: 0,
    stock: true,
    isRocket: Boolean(it.isRocket),
    shippingDays: it.isRocket ? 1 : 2,
  }));
}

/** 일반 상품 URL → 파트너 추적 링크 */
export async function deeplink(urls) {
  const json = await call('POST', `${BASE}/deeplink`, '', { coupangUrls: urls });
  return (json?.data || []).map((d) => d.shortenUrl || d.landingUrl);
}

/** 연결 확인용 — 키가 유효한지 1회 호출로 확인 */
export async function ping() {
  const items = await search('세럼', { limit: 1 });
  return { ok: true, sample: items[0]?.name ?? null };
}
