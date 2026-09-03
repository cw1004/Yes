// Coupang Partners deeplink conversion.
//
// VERIFY BEFORE PRODUCTION: the request shape below (HMAC message layout,
// datetime format, endpoint path) follows Coupang's published Open API
// contract, but partner API details change. Test against one real product and
// confirm the returned link tracks in your dashboard before running a batch.
import { createHmac } from 'node:crypto';
import { COUPANG } from '../config.mjs';

const HOST = 'https://api-gateway.coupang.com';
const PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

// Coupang signs with a compact UTC stamp: yyMMddTHHmmssZ
function signedDate(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2);
}

function authorization(method, path, query = '') {
  const date = signedDate();
  const message = date + method + path + query;
  const signature = createHmac('sha256', COUPANG.secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${COUPANG.accessKey}, signed-date=${date}, signature=${signature}`;
}

export const configured = () => Boolean(COUPANG.accessKey && COUPANG.secretKey);

export async function toAffiliate(urls, { subId = COUPANG.subId } = {}) {
  if (!configured()) throw new Error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 가 설정되지 않았습니다');

  const body = JSON.stringify({ coupangUrls: urls, ...(subId ? { subId } : {}) });
  const res = await fetch(HOST + PATH, {
    method: 'POST',
    headers: {
      Authorization: authorization('POST', PATH),
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`쿠팡 파트너스 API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  // Response carries one entry per input url, in order.
  return (json.data ?? []).map(d => d.shortenUrl || d.landingUrl);
}
