/**
 * Amazon Product Advertising API 5.0 어댑터.
 *
 * ⚠ 가입 문턱이 있다: 어소시에이트 계정을 만든 뒤 **180일 안에 적격 판매 3건**이 있어야
 *    PA-API 키가 열린다. 그래서 처음에는 국내 판매처부터 붙이고, 나중에 여는 걸 권한다.
 *
 * 인증: AWS SigV4 (service = ProductAdvertisingAPI).
 */
import crypto from 'node:crypto';

const REGION = process.env.AMAZON_REGION || 'us-east-1';
const HOST = process.env.AMAZON_HOST || 'webservices.amazon.com';
const PATH = '/paapi5/searchitems';
const SERVICE = 'ProductAdvertisingAPI';

export const id = 'amazon';
export const name = 'Amazon';
export const limits = { callsPerSecond: 1, itemsPerCall: 10 };

export function isConfigured() {
  return Boolean(process.env.AMAZON_ACCESS_KEY && process.env.AMAZON_SECRET_KEY && process.env.AMAZON_ASSOC_TAG);
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s, 'utf8').digest();

/** AWS SigV4 서명 헤더 생성 */
function signedHeaders(payload, target) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `host:${HOST}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaderNames = 'content-encoding;host;x-amz-date;x-amz-target';
  const canonicalRequest = ['POST', PATH, '', canonicalHeaders, signedHeaderNames, sha256(payload)].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  let key = hmac(`AWS4${process.env.AMAZON_SECRET_KEY}`, dateStamp);
  key = hmac(key, REGION);
  key = hmac(key, SERVICE);
  key = hmac(key, 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  return {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.AMAZON_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

export async function search(keyword, { limit = 10 } = {}) {
  const payload = JSON.stringify({
    Keywords: keyword,
    SearchIndex: 'Beauty',
    ItemCount: Math.min(limit, limits.itemsPerCall),
    PartnerTag: process.env.AMAZON_ASSOC_TAG,
    PartnerType: 'Associates',
    Marketplace: process.env.AMAZON_MARKETPLACE || 'www.amazon.com',
    Resources: ['ItemInfo.Title', 'ItemInfo.ByLineInfo', 'Offers.Listings.Price', 'Images.Primary.Medium', 'CustomerReviews.StarRating'],
  });
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
  const res = await fetch(`https://${HOST}${PATH}`, { method: 'POST', headers: signedHeaders(payload, target), body: payload });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Amazon PA-API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  const json = JSON.parse(text);

  return (json?.SearchResult?.Items || []).map((it) => ({
    externalId: it.ASIN,
    name: it.ItemInfo?.Title?.DisplayValue || '',
    brand: it.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '',
    price: Math.round((it.Offers?.Listings?.[0]?.Price?.Amount || 0) * (Number(process.env.USD_KRW) || 1380)),
    url: it.DetailPageURL,
    image: it.Images?.Primary?.Medium?.URL,
    rating: it.CustomerReviews?.StarRating?.Value ?? null,
    reviews: 0,
    stock: Boolean(it.Offers?.Listings?.length),
    shippingDays: 7,
  }));
}

export async function ping() {
  const items = await search('vitamin c serum', { limit: 1 });
  return { ok: true, sample: items[0]?.name ?? null };
}
