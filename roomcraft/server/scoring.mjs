// The revenue model. Deliberately arithmetic, not AI: every number here drives
// a money decision, so it has to be inspectable and reproducible. The model
// judges only what a model is good at — whether a set works as a room and how
// to open the video. It never invents a rate.
import { ASSUMPTIONS, BUNDLE_SIZE } from './config.mjs';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function commissionRate(platform, category) {
  const table = ASSUMPTIONS.commission[platform] ?? {};
  return table[category] ?? table.default ?? 0.02;
}

// Modifiers on the baseline conversion rate. Each returns a multiplier and says
// why, so a ranking can be explained to a human rather than just asserted.
export function conversionFactors(p) {
  const factors = [];

  const off = p.originalPrice > 0 ? 1 - p.price / p.originalPrice : 0;
  if (off >= 0.4) factors.push(['할인 40%+', 1.45]);
  else if (off >= 0.25) factors.push(['할인 25%+', 1.25]);
  else if (off >= 0.1) factors.push(['할인 10%+', 1.08]);
  else factors.push(['할인 없음', 0.9]);

  const reviews = p.reviewCount ?? 0;
  if (reviews >= 3000) factors.push(['리뷰 3000+', 1.35]);
  else if (reviews >= 500) factors.push(['리뷰 500+', 1.18]);
  else if (reviews >= 50) factors.push(['리뷰 50+', 1.0]);
  else factors.push(['리뷰 부족', 0.7]);

  const rating = p.rating ?? 0;
  if (rating >= 4.5) factors.push(['평점 4.5+', 1.15]);
  else if (rating >= 4.0) factors.push(['평점 4.0+', 1.0]);
  else if (rating > 0) factors.push(['평점 낮음', 0.65]);

  // Impulse range converts; a big-ticket item converts rarely but pays more.
  // The bundle wants both — that tension is handled at the ladder check.
  if (p.price <= 20000) factors.push(['충동구매가', 1.3]);
  else if (p.price <= 60000) factors.push(['중가', 1.0]);
  else if (p.price <= 150000) factors.push(['고가', 0.6]);
  else factors.push(['초고가', 0.35]);

  if (p.inStock === false) factors.push(['품절', 0]);

  return factors;
}

// Expected revenue per click that reaches this product's page.
export function productEpc(p) {
  const rate = commissionRate(p.platform, p.category);
  const factors = conversionFactors(p);
  const conversion = factors.reduce((acc, [, m]) => acc * m, ASSUMPTIONS.baseConversion);
  const epc = p.price * rate * conversion;
  return {
    epc,
    commissionRate: rate,
    conversion,
    perSale: p.price * rate,
    factors,
  };
}

// A bundle earns from every slot, weighted by how clicks actually distribute
// across positions. `contentFit` (0–1) is the model's contribution and scales
// the whole thing: a set nobody watches earns nothing regardless of margin.
export function bundleValue(products, contentFit = 1) {
  const shares = ASSUMPTIONS.slotClickShare;
  const slots = products.slice(0, BUNDLE_SIZE).map((p, i) => {
    const s = productEpc(p);
    const share = shares[i] ?? shares[shares.length - 1] ?? 0.05;
    return { ...p, ...s, slot: i, clickShare: share, weightedEpc: s.epc * share };
  });
  const epcPerVideoClick = slots.reduce((a, s) => a + s.weightedEpc, 0);
  return {
    slots,
    epcPerVideoClick,
    score: epcPerVideoClick * clamp(contentFit, 0, 1),
    contentFit,
  };
}

// A set of six near-identical prices wastes the ladder: nothing to enter on,
// nothing to anchor against. Reported, not silently corrected.
export function ladderCheck(products) {
  const prices = products.map(p => p.price).sort((a, b) => a - b);
  const entry = prices[0];
  const anchor = prices[prices.length - 1];
  const spread = entry > 0 ? anchor / entry : 0;
  const problems = [];
  if (entry > 30000) problems.push('진입 상품이 없습니다 (3만원 이하 1개 권장)');
  if (spread < 3) problems.push('가격 폭이 좁습니다 (최고가/최저가 3배 이상 권장)');
  return { entry, anchor, spread, ok: problems.length === 0, problems };
}

export function estimateMonthly(bundleEpc, videoClicksPerMonth) {
  return bundleEpc * videoClicksPerMonth;
}
