/**
 * 추천 · 랭킹 · 수익화 엔진 (클라이언트/서버 공용, 순수 함수).
 *
 * 랭킹 점수 = 적합도(relevance) x W1 + 전환기대(conversion) x W2 + 수익기여(revenue) x W3
 *
 * 수익 항을 넣되 W3 상한을 두고, 각 카드에 왜 이 순서인지(reasons)와
 * "제휴 링크" 고지를 함께 내보낸다. 수익만 좇아 적합도를 뒤집으면
 * 재방문·구독이 무너져 LTV가 오히려 줄기 때문이다.
 */

export const DEFAULT_WEIGHTS = { relevance: 0.55, conversion: 0.3, revenue: 0.15 };

/** 업종 평균 기준 전환율 추정 (머천트 신뢰도·배송·쿠폰으로 보정) */
export function estimateCvr(offer, merchant) {
  let cvr = 0.028 * (merchant?.trust ?? 0.85);
  cvr *= offer.shippingDays <= 1 ? 1.35 : offer.shippingDays <= 2 ? 1.15 : offer.shippingDays <= 3 ? 1.0 : 0.82;
  if (offer.coupon > 0) cvr *= 1.12;
  if (!offer.stock) cvr *= 0.05;
  return Math.min(0.12, cvr);
}

export function netPrice(offer) {
  return Math.max(0, offer.price - (offer.coupon || 0));
}

/** 클릭 1회당 기대 매출(EPC) — 수익 항의 근거 */
export function expectedValuePerClick(offer, merchant) {
  return netPrice(offer) * offer.commissionRate * estimateCvr(offer, merchant);
}

/** 톤 적합 셰이드 찾기 (ITA 거리 + 언더톤 일치) */
export function bestShade(product, tone) {
  if (!product.shades?.length) return null;
  let best = null;
  for (const s of product.shades) {
    const itaDist = Math.abs(s.ita - tone.ita) / 20;
    const undertonePenalty = s.undertone === tone.undertone ? 0 : s.undertone === 'neutral' || tone.undertone === 'neutral' ? 0.35 : 0.9;
    const d = itaDist + undertonePenalty;
    if (!best || d < best.distance) best = { ...s, distance: Math.round(d * 100) / 100 };
  }
  const fit = Math.max(0, Math.min(1, 1 - best.distance / 2.2));
  return { ...best, fit: Math.round(fit * 100) };
}

/**
 * 적합도 0~1.
 * @param {{tone,skinType,concerns:[{key,score}]}} profile
 */
export function relevanceOf(product, profile) {
  const m = product.match || {};
  let score = 0;

  // 1) 고민 지표 매칭 — 점수가 낮을수록(나쁠수록) 가중치가 커진다
  const concernWeight = {};
  profile.concerns.forEach((c, i) => {
    concernWeight[c.key] = Math.max(0, (100 - c.score) / 100) * (i < 3 ? 1 : 0.45);
  });
  const concernHit = (m.concerns || []).reduce((s, k) => s + (concernWeight[k] || 0), 0);
  score += Math.min(0.55, concernHit * 0.28);

  // 2) 피부 타입 매칭
  if ((m.skinType || []).includes(profile.skinType)) score += 0.2;

  // 3) 언더톤 매칭
  if ((m.undertone || []).includes(profile.tone.undertone)) score += 0.1;

  // 4) 베이스 메이크업은 셰이드 적합도가 곧 만족도
  const shade = bestShade(product, profile.tone);
  if (shade) score += (shade.fit / 100) * 0.15;
  else score += 0.06;

  return Math.min(1, score);
}

/** 오퍼(판매처) 랭킹 — 최저가와 추천가를 모두 노출한다 */
export function rankOffers(product, merchants, weights = DEFAULT_WEIGHTS) {
  const scored = product.offers.map((o) => {
    const merchant = merchants[o.merchant];
    const ev = expectedValuePerClick(o, merchant);
    return {
      ...o,
      merchantName: merchant?.name ?? o.merchant,
      merchantLogo: merchant?.logo ?? '·',
      netPrice: netPrice(o),
      cvr: Math.round(estimateCvr(o, merchant) * 10000) / 100,
      epc: Math.round(ev),
      trust: merchant?.trust ?? 0.8,
    };
  });
  const minPrice = Math.min(...scored.map((o) => o.netPrice));
  const maxEpc = Math.max(...scored.map((o) => o.epc), 1);

  return scored
    .map((o) => {
      const priceScore = minPrice / (o.netPrice || 1);            // 싼 쪽이 1
      const convScore = o.trust * (o.shippingDays <= 1 ? 1 : o.shippingDays <= 2 ? 0.9 : 0.75) * (o.stock ? 1 : 0.1);
      const revScore = o.epc / maxEpc;
      const score = priceScore * 0.45 + convScore * 0.35 + revScore * weights.revenue * 1.33;
      return { ...o, isLowest: o.netPrice === minPrice, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score);
}

/** 상품 랭킹 */
export function rankProducts(catalog, profile, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const merchants = catalog.merchants;
  const items = catalog.products
    .filter((p) => (opts.category ? p.category === opts.category : true))
    .map((p) => {
      const relevance = relevanceOf(p, profile);
      const offers = rankOffers(p, merchants, weights);
      const topOffer = offers[0];
      const conversion = Math.min(1, (p.rating / 5) * 0.6 + Math.min(1, p.reviews / 40000) * 0.4);
      const revenueRaw = topOffer ? topOffer.epc : 0;
      const shade = bestShade(p, profile.tone);
      return { product: p, relevance, conversion, revenueRaw, offers, topOffer, shade };
    });

  const maxRev = Math.max(...items.map((i) => i.revenueRaw), 1);

  return items
    .map((i) => {
      const revenue = i.revenueRaw / maxRev;
      // 상업 점수(전환·수익)는 적합도로 감쇠시킨다.
      // 이렇게 하지 않으면 수수료율만 높은 비관련 상품이 1위로 올라와
      // 추천의 신뢰가 깨지고 결국 재방문/구독이 줄어든다.
      const damp = 0.3 + 0.7 * i.relevance;
      const total =
        i.relevance * weights.relevance +
        (i.conversion * weights.conversion + revenue * weights.revenue) * damp;
      return {
        id: i.product.id,
        brand: i.product.brand,
        name: i.product.name,
        category: i.product.category,
        keyIngredients: i.product.keyIngredients || [],
        rating: i.product.rating,
        reviews: i.product.reviews,
        basePrice: i.product.basePrice,
        shade: i.shade,
        offers: i.offers,
        bestOffer: i.topOffer,
        lowestOffer: i.offers.find((o) => o.isLowest) || i.topOffer,
        scores: {
          relevance: Math.round(i.relevance * 100),
          conversion: Math.round(i.conversion * 100),
          revenue: Math.round(revenue * 100),
          total: Math.round(total * 1000) / 10,
        },
        reasons: buildReasons(i, profile),
        sponsored: false,
        disclosure: '제휴 링크 · 구매 시 수수료를 받을 수 있습니다',
      };
    })
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, opts.limit || 12);
}

function buildReasons(item, profile) {
  const r = [];
  const m = item.product.match || {};
  const hit = profile.concerns.slice(0, 3).filter((c) => (m.concerns || []).includes(c.key));
  if (hit.length) r.push(`${hit.map((h) => h.label).join('·')} 개선 성분 포함`);
  if ((m.skinType || []).includes(profile.skinType)) r.push(`${profile.skinTypeLabel ?? profile.skinType} 피부 타입에 적합`);
  if (item.shade) r.push(`ITA ${profile.tone.ita}° 기준 ${item.shade.code} ${item.shade.name} 매칭도 ${item.shade.fit}%`);
  if (item.topOffer?.isLowest) r.push(`현재 최저가 ${item.topOffer.netPrice.toLocaleString()}원`);
  if (item.topOffer?.shippingDays <= 1) r.push('내일 도착 가능');
  return r;
}

/**
 * 루틴 번들 = 객단가(AOV) 상승 장치.
 * 단품 합계 대비 묶음 할인율을 노출해 장바구니 전환을 만든다.
 */
export function buildBundle(ranked, profile) {
  const pick = (cats) => ranked.find((r) => cats.includes(r.category));
  const parts = [
    pick(['cleanser']),
    pick(['toner']),
    pick(['serum']),
    pick(['cream', 'mask']),
    pick(['suncare']),
  ].filter(Boolean);
  const total = parts.reduce((s, p) => s + (p.bestOffer?.netPrice || p.basePrice), 0);
  const discounted = Math.round((total * 0.92) / 100) * 100;
  return {
    title: `${profile.skinTypeLabel ?? ''} 4주 루틴 풀세트`.trim(),
    items: parts,
    total,
    discounted,
    saving: total - discounted,
    note: '동일 판매처 묶음 구매 시 배송비 절감 + 앱 전용 쿠폰 적용가',
  };
}
