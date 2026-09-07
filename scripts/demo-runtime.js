/**
 * 데모 런타임 — 서버 없이 브라우저 안에서 도는 api 구현체.
 *
 * 실제 앱은 무료/유료 경계와 결제 검증을 서버에서 강제한다(그게 맞다).
 * 이 파일은 링크 하나로 체험할 수 있게 그 역할을 브라우저로 옮긴 것이고,
 * 결제는 실제로 청구되지 않는 모의 결제다. 운영 빌드에 쓰면 안 된다.
 */
const CATALOG = __CATALOG__;

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 시크릿 모드 */ } },
};

const store = {
  get analyses() { return LS.get('demo.analyses', {}); },
  set analyses(v) { LS.set('demo.analyses', v); },
  get ent() { return LS.get('demo.entitlement', null); },
  set ent(v) { LS.set('demo.entitlement', v); },
};

const PLANS = [
  { id: 'single', name: '리포트 1회 해제', price: 4900, period: 'once',
    features: ['전체 9개 지표 해제', '원인 분석 + 아침/저녁 루틴', '4주 개선 플랜', '성분 추천/회피 리스트'] },
  { id: 'monthly', name: '월간 멤버십', price: 9900, period: 'month', badge: '가장 인기',
    features: ['무제한 진단 + 전체 리포트', '주간 변화 추적 그래프', '루틴 리마인더', '멤버 전용 쿠폰', '광고 제거'] },
  { id: 'yearly', name: '연간 멤버십', price: 79000, period: 'year', badge: '33% 절약',
    features: ['월간 혜택 전체', '2개월분 무료', '피부 연간 리포트', '신제품 우선 체험단'] },
];
const COUPONS = { WELCOME30: { type: 'percent', value: 30, label: '첫 진단 30% 할인' },
                  FRIEND2000: { type: 'amount', value: 2000, label: '친구 추천 2,000원' } };

const hasPro = (analysisId) => {
  const e = store.ent;
  if (!e || new Date(e.expiresAt) < new Date()) return false;
  if (e.plan === 'single') return !!e.reports?.[analysisId];
  return true;
};

const SEARCH_LINK = {
  coupang: (q) => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`,
  naver: (q) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`,
  oliveyoung: (q) => `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(q)}`,
  eleven: (q) => `https://search.11st.co.kr/Search.tmall?kwd=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
};

function buildReportLocal(rec) {
  const pro = hasPro(rec.id);
  const d = rec.diagnosis;
  const consult = buildConsult(rec.analysis, d, rec.intake || {});
  return {
    analysisId: rec.id,
    createdAt: rec.createdAt,
    quality: rec.quality,
    analysis: {
      totalScore: rec.analysis.totalScore, grade: rec.analysis.grade, tone: rec.analysis.tone,
      zoneBalance: rec.analysis.zoneBalance,
      metrics: pro ? rec.analysis.metrics : [],
    },
    skinType: d.skinType,
    personalColor: d.personalColor,
    free: d.free,
    pro: pro ? d.pro : null,
    locked: !pro,
    lockedPreview: pro ? null : {
      concernCount: d.concerns.length,
      teaser: d.concerns.slice(0, 3).map((c) => ({ label: c.label, levelLabel: c.levelLabel })),
      unlocks: ['전체 9개 지표 점수', '지표별 원인 분석', '아침/저녁 5단계 루틴', '4주 개선 플랜', '추천/회피 성분 리스트'],
    },
    consult: pro
      ? { doctor: consult.doctor, script: consult.script, free: consult.free, discordance: consult.discordance, followUpAt: consult.followUpAt }
      : { doctor: consult.doctor, script: consult.free.script, free: consult.free, discordance: consult.discordance.filter((x) => x.tier === 'free'), followUpAt: null },
    consultNarrated: false,
    intake: rec.intake || {},
    entitlement: store.ent,
    disclaimer: DISCLAIMER,
  };
}

let pendingOrder = null;

const api = {
  async ensureSession() { return { userId: 'demo', plan: 'free' }; },
  async config() {
    return {
      plans: PLANS, provider: 'mock', disclaimer: DISCLAIMER,
      merchants: CATALOG.merchants,
      coupons: Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label })),
    };
  },
  async submitAnalysis(analysis, quality, intake) {
    const id = `an_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rec = {
      id, createdAt: new Date().toISOString(), analysis, quality: quality || null,
      diagnosis: diagnose(analysis), intake: sanitizeIntake(intake),
    };
    const all = store.analyses; all[id] = rec; store.analyses = all;
    return buildReportLocal(rec);
  },
  async report(id) {
    const rec = store.analyses[id];
    if (!rec) throw new Error('리포트를 찾을 수 없습니다.');
    return buildReportLocal(rec);
  },
  async history() {
    const items = Object.values(store.analyses)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map((a) => ({
        id: a.id, createdAt: a.createdAt, totalScore: a.analysis.totalScore, grade: a.analysis.grade,
        tone: a.analysis.tone, metrics: a.analysis.metrics.map((m) => ({ key: m.key, label: m.label, score: m.score, level: m.level })),
      }));
    return { items };
  },
  async recommend(id, category) {
    const rec = store.analyses[id];
    if (!rec) throw new Error('분석 결과가 필요합니다.');
    const d = rec.diagnosis;
    const profile = {
      tone: rec.analysis.tone, skinType: d.skinType.key, skinTypeLabel: d.skinType.label,
      concerns: d.concerns.map((c) => ({ key: c.key, label: c.label, score: c.score })),
    };
    const items = rankProducts(CATALOG, profile, { category: category || null, limit: 12 });
    return {
      analysisId: id,
      profile: { tone: profile.tone, skinType: profile.skinTypeLabel, personalColor: d.personalColor },
      items, bundle: buildBundle(items, profile),
      disclosure: '데모 데이터입니다. 랭킹은 피부 적합도(55%) · 사용자 평가와 배송(30%) · 제휴 수익(15%)을 합산해 계산되며, 실제 서비스에서는 구매 시 수수료를 받을 수 있습니다.',
    };
  },
  async checkout(planId, analysisId, couponCode) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new Error('알 수 없는 요금제입니다.');
    const c = COUPONS[String(couponCode || '').toUpperCase()];
    const discount = c
      ? { code: couponCode.toUpperCase(), amount: c.type === 'percent' ? Math.floor(plan.price * c.value / 100) : Math.min(plan.price, c.value), label: c.label }
      : { code: couponCode || null, amount: 0, invalid: Boolean(couponCode) };
    pendingOrder = { orderId: `demo_${Date.now()}`, planId, analysisId, amount: plan.price - discount.amount, discount };
    return { order: pendingOrder, payment: { type: 'mock' } };
  },
  async confirm() {
    const o = pendingOrder;
    if (!o) throw new Error('진행 중인 주문이 없습니다.');
    const days = o.planId === 'single' ? 7 : o.planId === 'monthly' ? 31 : 366;
    const prev = store.ent;
    store.ent = {
      plan: o.planId, grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 864e5).toISOString(),
      reports: { ...(prev?.reports || {}), ...(o.planId === 'single' && o.analysisId ? { [o.analysisId]: true } : {}) },
    };
    pendingOrder = null;
    const rec = o.analysisId ? store.analyses[o.analysisId] : null;
    return { order: { ...o, status: 'paid' }, entitlement: store.ent, report: rec ? buildReportLocal(rec) : null };
  },
  async paywallView() { return { ok: true }; },
  async click(productId, merchant) {
    const p = CATALOG.products.find((x) => x.id === productId);
    if (!p) throw new Error('상품을 찾을 수 없습니다.');
    const build = SEARCH_LINK[merchant];
    if (!build) throw new Error('지원하지 않는 판매처입니다.');
    return { clickId: `demo_${Date.now()}`, url: build(`${p.brand} ${p.name}`), partnerLinked: false };
  },
};
