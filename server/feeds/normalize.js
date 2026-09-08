/**
 * 판매처 응답 → 이 앱의 카탈로그 형태로 변환.
 *
 * 각 판매처의 응답 모양은 제각각이고 앞으로도 바뀐다.
 * 그래서 '바뀌는 부분'은 어댑터에, '앱이 의존하는 모양'은 여기 한 곳에 둔다.
 * 어댑터가 늘어나도 앱 코드(랭킹·화면)는 손댈 일이 없다.
 */

/** 카탈로그가 반드시 가져야 하는 필드 */
const REQUIRED_PRODUCT = ['id', 'brand', 'name', 'category', 'basePrice', 'offers'];
const REQUIRED_OFFER = ['merchant', 'price', 'commissionRate'];

export function normalizeOffer(raw, { merchant, commissionRate, shippingDays }) {
  const price = Math.round(Number(raw.price) || 0);
  return {
    merchant,
    price,
    shippingDays: raw.shippingDays ?? shippingDays ?? 2,
    coupon: Math.round(Number(raw.coupon) || 0),
    commissionRate: Number(commissionRate) || 0,
    stock: raw.stock !== false,
    // 판매처가 직접 준 상품 URL. 없으면 링크는 검색 딥링크로 만든다.
    url: raw.url || null,
    externalId: raw.externalId ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export function normalizeProduct(raw, { merchant, commissionRate, shippingDays, category }) {
  const brand = (raw.brand || guessBrand(raw.name)).trim();
  const name = cleanName(raw.name, brand);
  return {
    id: raw.id || `${merchant}-${slug(brand)}-${slug(name)}`.slice(0, 60),
    brand,
    name,
    category: raw.category || category || 'etc',
    basePrice: Math.round(Number(raw.basePrice ?? raw.price) || 0),
    rating: Number(raw.rating) || null,
    reviews: Number(raw.reviews) || 0,
    keyIngredients: raw.keyIngredients || [],
    // 셰이드와 매칭 태그는 API 가 주지 않는다 — 사람이 채우는 자리 (아래 mergeCurated 참고)
    match: raw.match || null,
    shades: raw.shades || null,
    offers: [normalizeOffer(raw, { merchant, commissionRate, shippingDays })],
    source: { merchant, fetchedAt: new Date().toISOString(), externalId: raw.externalId ?? null },
  };
}

/** 상품명 앞에 붙은 브랜드를 떼어내 중복 표기를 막는다 */
function cleanName(name = '', brand = '') {
  let n = String(name).replace(/\s+/g, ' ').trim();
  if (brand && n.toLowerCase().startsWith(brand.toLowerCase())) n = n.slice(brand.length).trim();
  return n.replace(/^[-·,]\s*/, '') || String(name).trim();
}

/** "[브랜드] 상품명" 또는 "브랜드 상품명" 패턴에서 브랜드 추정 */
function guessBrand(name = '') {
  const bracket = String(name).match(/^\[([^\]]{2,20})\]/);
  if (bracket) return bracket[1];
  return String(name).split(/\s+/)[0] || '미상';
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');

/**
 * 같은 상품을 여러 판매처에서 받아오면 하나로 합쳐 오퍼만 늘린다.
 * 브랜드+정규화된 상품명으로 묶는다 (완벽하진 않지만 사람이 검수할 수 있는 수준).
 */
export function mergeByProduct(products) {
  const byKey = new Map();
  for (const p of products) {
    const key = `${slug(p.brand)}::${slug(p.name).slice(0, 40)}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...p }); continue; }
    // 이미 있는 판매처면 최신 가격으로 교체, 아니면 추가
    for (const offer of p.offers) {
      const idx = prev.offers.findIndex((o) => o.merchant === offer.merchant);
      if (idx >= 0) prev.offers[idx] = offer;
      else prev.offers.push(offer);
    }
    prev.rating = prev.rating ?? p.rating;
    prev.reviews = Math.max(prev.reviews || 0, p.reviews || 0);
    prev.basePrice = Math.max(prev.basePrice || 0, p.basePrice || 0);
  }
  return [...byKey.values()];
}

/**
 * 사람이 채워야 하는 정보(피부 타입·고민 태그·셰이드)를 API 데이터에 얹는다.
 *
 * 이건 자동화할 수 없다. "이 제품이 지성 피부의 모공에 맞는가", "이 호수의 ITA 는 몇도인가"는
 * 판매처 API 어디에도 없다. data/curation.json 에 사람이 적고, 여기서 합친다.
 * 큐레이션이 없는 상품은 추천 근거가 약하므로 랭킹에서 뒤로 밀린다.
 */
export function mergeCurated(products, curation = {}) {
  return products.map((p) => {
    const c = curation[p.id] || matchCuration(p, curation);
    if (!c) return { ...p, match: p.match || { skinType: [], concerns: [], undertone: [] }, curated: false };
    return {
      ...p,
      brand: c.brand || p.brand,
      name: c.name || p.name,
      category: c.category || p.category,
      match: c.match || p.match || { skinType: [], concerns: [], undertone: [] },
      shades: c.shades || p.shades || null,
      keyIngredients: c.keyIngredients || p.keyIngredients || [],
      curated: true,
    };
  });
}

/** 큐레이션 키가 정확히 안 맞을 때 브랜드+이름 일부로 찾아본다 */
function matchCuration(p, curation) {
  const target = `${slug(p.brand)}::${slug(p.name)}`;
  for (const [key, value] of Object.entries(curation)) {
    if (!value.aliases) continue;
    if (value.aliases.some((a) => target.includes(slug(a)))) return value;
  }
  return null;
}

/** 앱이 깨지지 않을 최소 조건을 확인한다 (여기서 걸러야 화면에서 안 깨진다) */
export function validateCatalog(catalog) {
  const problems = [];
  if (!catalog?.merchants || !Object.keys(catalog.merchants).length) problems.push('merchants 가 비어 있습니다.');
  if (!Array.isArray(catalog?.products) || !catalog.products.length) problems.push('products 가 비어 있습니다.');

  for (const p of catalog.products || []) {
    for (const f of REQUIRED_PRODUCT) {
      if (p[f] === undefined || p[f] === null) problems.push(`${p.id || '(id없음)'}: ${f} 누락`);
    }
    if (!Array.isArray(p.offers) || !p.offers.length) { problems.push(`${p.id}: 판매처 오퍼가 없습니다.`); continue; }
    for (const o of p.offers) {
      for (const f of REQUIRED_OFFER) {
        if (o[f] === undefined || o[f] === null) problems.push(`${p.id}/${o.merchant}: ${f} 누락`);
      }
      if (!(o.price > 0)) problems.push(`${p.id}/${o.merchant}: 가격이 0 이하입니다.`);
      if (o.commissionRate > 0.5) problems.push(`${p.id}/${o.merchant}: 수수료율 ${o.commissionRate} 가 비정상입니다.`);
      if (!catalog.merchants[o.merchant]) problems.push(`${p.id}: 알 수 없는 판매처 '${o.merchant}'`);
    }
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 40), count: problems.length };
}
