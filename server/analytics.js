/**
 * 수익 지표 집계.
 * "무엇을 바꾸면 매출이 오르는가"를 보려면 퍼널 단계별 전환율과
 * 사용자 1인당 매출(ARPU)을 같은 화면에서 봐야 한다.
 */
import { db } from './store.js';

const countEvents = (events, type) => events.filter((e) => e.type === type).length;
const uniq = (events, type) => new Set(events.filter((e) => e.type === type).map((e) => e.userId)).size;

export function kpis() {
  const d = db.read();
  // 체험(시뮬레이션) 기록은 실제 사용자 행동이 아니다. 섞으면 전환율이 거짓말을 한다.
  const simulatedIds = new Set(Object.values(d.analyses).filter((a) => a.simulated).map((a) => a.id));
  const e = d.events.filter((x) => x.simulated !== true && !(x.analysisId && simulatedIds.has(x.analysisId)));
  const users = Object.keys(d.users).length;
  const analyses = Object.values(d.analyses).filter((a) => !a.simulated).length;
  const simulatedCount = simulatedIds.size;
  // 같은 분석에 대해 결과 화면과 결제 화면에서 두 번 찍히므로 분석 단위로 유니크 집계한다
  const paywallViews = new Set(
    e.filter((x) => x.type === 'paywall_view').map((x) => x.analysisId || x.userId)
  ).size;
  const checkouts = countEvents(e, 'checkout_started');
  const purchases = e.filter((x) => x.type === 'purchase');
  const subRevenue = purchases.reduce((s, p) => s + (p.amount || 0), 0);
  const clicks = d.clicks;
  const convClicks = clicks.filter((c) => c.converted);
  const affiliateRevenue = convClicks.reduce((s, c) => s + (c.revenue || 0), 0);
  const pendingAffiliate = clicks.filter((c) => !c.converted).reduce((s, c) => s + (c.expectedCommission || 0), 0);

  const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  const byMerchant = {};
  for (const c of clicks) {
    const m = (byMerchant[c.merchant] ||= { clicks: 0, conversions: 0, revenue: 0 });
    m.clicks++;
    if (c.converted) { m.conversions++; m.revenue += c.revenue || 0; }
  }
  for (const m of Object.values(byMerchant)) {
    m.cvr = rate(m.conversions, m.clicks);
    m.epc = m.clicks ? Math.round(m.revenue / m.clicks) : 0;
  }

  const byProduct = {};
  for (const c of clicks) {
    const p = (byProduct[c.productId] ||= { clicks: 0, revenue: 0 });
    p.clicks++;
    p.revenue += c.revenue || 0;
  }
  const topProducts = Object.entries(byProduct)
    .sort((a, b) => b[1].clicks - a[1].clicks)
    .slice(0, 10)
    .map(([id, v]) => ({ productId: id, ...v }));

  const totalRevenue = subRevenue + affiliateRevenue;

  return {
    users,
    analyses,
    simulated: simulatedCount,   // 참고용 — 위 지표에는 포함되지 않는다
    funnel: {
      analysisCompleted: analyses,
      paywallViews,
      checkoutStarted: checkouts,
      purchases: purchases.length,
      analysisToPaywall: rate(paywallViews, analyses),
      paywallToCheckout: rate(checkouts, paywallViews),
      checkoutToPurchase: rate(purchases.length, checkouts),
      overallCvr: rate(purchases.length, analyses),
    },
    revenue: {
      subscription: subRevenue,
      affiliateConfirmed: affiliateRevenue,
      affiliatePending: pendingAffiliate,
      total: totalRevenue,
      arpu: users ? Math.round(totalRevenue / users) : 0,
      arppu: purchases.length ? Math.round(subRevenue / purchases.length) : 0,
    },
    affiliate: {
      clicks: clicks.length,
      conversions: convClicks.length,
      cvr: rate(convClicks.length, clicks.length),
      epc: clicks.length ? Math.round(affiliateRevenue / clicks.length) : 0,
      byMerchant,
      topProducts,
    },
    payingUsers: uniq(e, 'purchase'),
  };
}
