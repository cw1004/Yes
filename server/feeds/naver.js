/**
 * 네이버 쇼핑 검색 API 어댑터.
 *
 * 발급: developers.naver.com → 애플리케이션 등록 → 사용 API '검색' 선택 → Client ID/Secret.
 * 한도: 하루 25,000회(무료). 쿠팡보다 훨씬 여유로워 가격 비교의 기준선으로 쓰기 좋다.
 *
 * 주의: 이 API 는 '검색 결과'를 줄 뿐 제휴 수수료를 붙여주지 않는다.
 *      네이버에서 수익을 내려면 별도로 제휴 프로그램(네이버 애드포스트/제휴 네트워크)을
 *      거쳐야 하고, 그건 링크에 파라미터를 붙이는 방식이다 (server/links.js).
 */
const ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';

export const id = 'naver';
export const name = '네이버쇼핑';
export const limits = { callsPerDay: 25000, itemsPerCall: 100 };

export function isConfigured() {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

export async function search(keyword, { limit = 10, sort = 'sim' } = {}) {
  const url = `${ENDPOINT}?${new URLSearchParams({
    query: keyword,
    display: String(Math.min(limit, limits.itemsPerCall)),
    sort, // sim(정확도) date asc dsc
    exclude: 'used:rental', // 중고·렌탈 제외 — 화장품 가격 비교에는 노이즈다
  })}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`네이버 API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  const json = JSON.parse(text);

  return (json.items || []).map((it) => ({
    externalId: String(it.productId ?? ''),
    // 네이버는 상품명에 <b> 태그를 넣어 돌려준다
    name: String(it.title || '').replace(/<[^>]+>/g, ''),
    brand: it.brand || it.maker || '',
    price: Number(it.lprice) || 0,
    url: it.link,
    image: it.image,
    category: it.category3 || it.category2 || null,
    rating: null,
    reviews: 0,
    stock: true,
    shippingDays: 2,
  }));
}

export async function ping() {
  const items = await search('수분 세럼', { limit: 1 });
  return { ok: true, sample: items[0]?.name ?? null };
}
