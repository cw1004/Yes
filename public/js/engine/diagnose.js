/**
 * 측정값 -> 진단/처방 변환.
 *
 * 무료: 총점 + 상위 3개 지표 + 한 줄 조언  (가치를 맛보게 하는 구간)
 * 유료: 전체 지표 + 원인 분석 + 아침/저녁 루틴 + 4주 플랜 + 성분 가이드
 * 두 계층은 여기서만 갈린다. 결제 검증은 서버가 하고, 이 모듈은 순수 함수다.
 */

const FREE_METRIC_KEYS = 3;

/** 언더톤 + 밝기 -> 퍼스널 컬러 시즌 */
export function personalColor(tone) {
  const light = tone.ita > 41;
  if (tone.undertone === 'warm') {
    return light
      ? { key: 'spring_warm', label: '봄 웜 라이트', palette: ['#F7C59F', '#FF9B71', '#F4E285', '#E8A87C'], desc: '맑고 화사한 코랄·피치 계열이 얼굴을 살립니다.' }
      : { key: 'autumn_warm', label: '가을 웜 딥', palette: ['#B85C38', '#8C5A3C', '#C89F6D', '#6E4B3A'], desc: '깊은 브릭·테라코타 계열에서 피부가 정돈되어 보입니다.' };
  }
  if (tone.undertone === 'cool') {
    return light
      ? { key: 'summer_cool', label: '여름 쿨 뮤트', palette: ['#E7B5C4', '#B8C4E0', '#D5CCE0', '#9FB8C9'], desc: '부드러운 로즈·라벤더 계열이 잘 어울립니다.' }
      : { key: 'winter_cool', label: '겨울 쿨 딥', palette: ['#8E2C4B', '#5B2C6F', '#1F3A5F', '#C2185B'], desc: '선명한 푸시아·와인 계열이 또렷함을 만듭니다.' };
  }
  return { key: 'neutral', label: '뉴트럴', palette: ['#D9A9A0', '#C9A227', '#B08D75', '#A9927D'], desc: '웜·쿨 양쪽을 쓸 수 있는 톤입니다. 채도만 맞추세요.' };
}

/** T존/U존 유분 차이와 수분 지표로 피부 타입 판정 */
export function skinTypeOf(a) {
  // 지표가 일부만 들어올 수 있다(구버전 클라이언트, 손상된 요청).
  // 없는 항목을 단정하면 요청 하나가 서버 오류가 된다 — 중립값으로 넘긴다.
  const score = (key, fallback = 70) => a.metrics.find((m) => m.key === key)?.score ?? fallback;
  const t = a.zoneBalance?.tZoneShine ?? 0;
  const u = a.zoneBalance?.uZoneShine ?? 0;
  const hydration = score('hydration');
  const redness = score('redness');

  if (redness < 45) return { key: 'sensitive', label: '민감성', desc: '장벽이 약해져 자극에 쉽게 붉어지는 상태입니다.' };
  if (t > 22 && u > 18) return { key: 'oily', label: '지성', desc: '전체적으로 피지 분비가 많아 번들거림과 모공이 두드러집니다.' };
  if (t > 16 && u <= 14) return { key: 'combination', label: '복합성', desc: 'T존은 번들거리고 볼은 건조한 전형적인 복합성입니다.' };
  if (hydration < 50) return { key: 'dry', label: '건성', desc: '수분·유분이 모두 부족해 결이 거칠어지기 쉬운 상태입니다.' };
  return { key: 'normal', label: '중성', desc: '유수분 밸런스가 안정적인 편입니다.' };
}

/** 지표별 원인/처방 지식 베이스 */
const KB = {
  evenness: {
    cause: '자외선 누적과 각질 turnover 저하로 부위별 멜라닌 분포가 불균일해진 상태입니다.',
    action: '주 2회 저농도 각질 관리(PHA/락토바이오닉)와 매일 SPF 50+ 재도포로 새 색소 유입을 먼저 차단하세요.',
    ingredients: { recommend: ['나이아신아마이드 5%', '트라넥사믹애씨드', 'PHA', '비타민C 유도체'], avoid: ['고농도 스크럽', '알코올 과다 토너'] },
  },
  redness: {
    cause: '피부 장벽 손상 + 모세혈관 확장으로 자극 물질이 쉽게 침투하는 상태입니다.',
    action: '성분 수를 줄이고(7개 이하) 세라마이드·판테놀 중심으로 2주간 장벽 회복 기간을 두세요. 미온수 세안 필수.',
    ingredients: { recommend: ['세라마이드', '판테놀', '마데카소사이드', '알란토인'], avoid: ['고농도 AHA', '멘톨', '에센셜 오일', '변성 알코올'] },
  },
  oiliness: {
    cause: '수분 부족을 유분으로 보상하는 수분부족형 지성일 가능성이 높습니다.',
    action: '유분만 걷어내는 대신 수분층을 채우세요. 아침 가벼운 젤 + 저녁 나이아신아마이드로 피지 분비 자체를 조절합니다.',
    ingredients: { recommend: ['나이아신아마이드 10%', '아연 PCA', '살리실산 0.5~2%', '히알루론산'], avoid: ['미네랄 오일 과다', '실리콘 헤비 크림'] },
  },
  texture: {
    cause: '각질 축적과 모공 내 피지 산화로 표면 요철이 커진 상태입니다.',
    action: 'BHA를 주 2~3회 저녁에 시작해 4주에 걸쳐 빈도를 올리고, 사용일에는 보습을 두 배로 하세요.',
    ingredients: { recommend: ['살리실산 2%', '레티날 저농도', '아다팔렌 0.1%', '아줄렌'], avoid: ['물리적 스크럽 매일 사용'] },
  },
  pigmentation: {
    cause: '멜라닌 과생성 + 염증 후 색소침착(PIH)이 섞여 있는 패턴입니다.',
    action: '아침 항산화(비타민C) → 저녁 미백(알부틴/트라넥사믹) → 자외선 차단의 3축을 8주 이상 유지해야 눈에 보입니다.',
    ingredients: { recommend: ['비타민C 10~15%', '알파-알부틴', '트라넥사믹애씨드', '나이아신아마이드'], avoid: ['자극성 필링 반복', '무차단 야외활동'] },
  },
  darkCircle: {
    cause: '혈관 비침형/색소형/구조형이 섞인 복합 다크서클로 보입니다.',
    action: '저녁 카페인·비타민K 아이크림 + 수면 7시간 확보. 눈가는 문지르지 말고 두드려 흡수시키세요.',
    ingredients: { recommend: ['카페인', '비타민K', '펩타이드', '레티닐팔미테이트'], avoid: ['눈가 마찰', '고농도 레티놀 초기 적용'] },
  },
  wrinkle: {
    cause: '진피 콜라겐 감소와 반복 표정근 사용으로 잔주름이 자리잡는 초기 단계입니다.',
    action: '레티놀 0.1%를 주 2회 → 6주에 걸쳐 격일로 늘리고, 아침에는 항산화 + 차단제를 고정하세요.',
    ingredients: { recommend: ['레티놀 0.1~0.3%', '펩타이드 콤플렉스', '아데노신', '비타민E'], avoid: ['레티놀 매일 즉시 적용', '과도한 각질 제거'] },
  },
  hydration: {
    cause: '각질층 수분 보유력(NMF) 저하로 수분이 빠르게 증발하는 상태입니다.',
    action: '토너 -> 히알루론산 세럼 -> 오클루시브(크림) 순서로 물을 넣고 덮어 가두세요. 세안 후 3분 안에 마무리합니다.',
    ingredients: { recommend: ['히알루론산 다중분자', '글리세린', '스쿠알란', '세라마이드 NP'], avoid: ['뜨거운 물 세안', '고발포 세안제 2회 이상'] },
  },
  clarity: {
    cause: '각질 + 미세 색소 + 건조가 겹쳐 빛 반사가 고르지 않은 상태입니다.',
    action: '주 1회 저자극 필링 + 매일 항산화로 표면 반사를 정리하면 2~3주 안에 체감됩니다.',
    ingredients: { recommend: ['비타민C', '나이아신아마이드', 'PHA', '페룰산'], avoid: ['두꺼운 메이크업 잔여', '클렌징 부족'] },
  },
};

const CATEGORY_BY_METRIC = {
  evenness: 'tone', clarity: 'tone', pigmentation: 'tone',
  redness: 'barrier', hydration: 'barrier',
  oiliness: 'sebum', texture: 'sebum',
  wrinkle: 'aging', darkCircle: 'aging',
};

export function diagnose(analysis) {
  const ranked = [...analysis.metrics].sort((a, b) => a.score - b.score);
  const skinType = skinTypeOf(analysis);
  const pc = personalColor(analysis.tone);

  const concerns = ranked.map((m, idx) => ({
    rank: idx + 1,
    key: m.key,
    label: m.label,
    score: m.score,
    level: m.level,
    levelLabel: m.levelLabel,
    value: m.value,
    unit: m.unit,
    category: CATEGORY_BY_METRIC[m.key],
    priority: idx < 3 ? 'high' : idx < 6 ? 'medium' : 'low',
    ...KB[m.key],
  }));

  const top = concerns.slice(0, 3);

  return {
    skinType,
    personalColor: pc,
    concerns,
    /** 결제 없이 보여주는 부분 */
    free: {
      totalScore: analysis.totalScore,
      grade: analysis.grade,
      tone: analysis.tone,
      skinTypeLabel: skinType.label,
      preview: top.slice(0, FREE_METRIC_KEYS).map((c) => ({
        key: c.key, label: c.label, score: c.score, levelLabel: c.levelLabel,
        tip: c.action.split('.')[0] + '.',
      })),
      lockedCount: analysis.metrics.length - FREE_METRIC_KEYS,
    },
    /** 결제 후 해제되는 부분 */
    pro: {
      concerns,
      routine: buildRoutine(skinType, top),
      plan: buildPlan(top),
      ingredients: mergeIngredients(top),
      lifestyle: lifestyleAdvice(top, skinType),
    },
  };
}

function buildRoutine(skinType, top) {
  const keys = top.map((t) => t.key);
  const am = [
    { step: 1, name: '미온수 세안', note: skinType.key === 'oily' ? '약산성 젤 클렌저 사용' : '물 세안 또는 초저자극 클렌저' },
    { step: 2, name: '토너', note: '무알코올 수분 토너를 손으로 2회 레이어링' },
    { step: 3, name: '기능성 세럼', note: keys.includes('pigmentation') || keys.includes('clarity') ? '비타민C 10~15% (항산화)' : '나이아신아마이드 5%' },
    { step: 4, name: '보습', note: skinType.key === 'oily' ? '젤 타입 가볍게' : '세라마이드 크림' },
    { step: 5, name: '자외선 차단', note: 'SPF50+ PA++++ · 2시간마다 재도포 (모든 처방의 전제)' },
  ];
  const pm = [
    { step: 1, name: '1차 클렌징', note: '오일/밤으로 자외선 차단제·메이크업 용해' },
    { step: 2, name: '2차 클렌징', note: '약산성 폼, 30초 이내로 짧게' },
    { step: 3, name: '각질/기능 관리', note: keys.includes('texture') ? 'BHA 2% 주 2~3회' : keys.includes('wrinkle') ? '레티놀 0.1% 주 2회부터' : 'PHA 주 1~2회' },
    { step: 4, name: '집중 세럼', note: top[0] ? `${top[0].label} 집중 케어 (${top[0].ingredients.recommend[0]})` : '수분 세럼' },
    { step: 5, name: '보습 마무리', note: '수분 크림 + 건조 부위 국소 밤' },
  ];
  return { am, pm, caution: '새 기능성 제품은 한 번에 하나씩, 최소 2주 간격으로 추가하세요.' };
}

function buildPlan(top) {
  const t0 = top[0]?.label ?? '수분';
  const t1 = top[1]?.label ?? '장벽';
  return [
    { week: 1, title: '장벽 안정화', tasks: ['자극 성분 전부 중단', '세안 1일 2회 이하', '보습 2회 고정', '자외선 차단 매일'] },
    { week: 2, title: `${t0} 집중 도입`, tasks: [`${t0} 타깃 세럼 주 2회 저녁 도입`, '적용 다음 날 컨디션 기록', '홍조 발생 시 즉시 1회로 감량'] },
    { week: 3, title: '빈도 상향', tasks: ['기능성 사용을 격일로 상향', `${t1} 케어 추가`, '주 1회 진정 마스크'] },
    { week: 4, title: '재측정 & 조정', tasks: ['앱에서 동일 조명으로 재촬영', '점수 변화 비교', '개선 없는 항목만 제품 교체'] },
  ];
}

function mergeIngredients(top) {
  const recommend = [...new Set(top.flatMap((t) => t.ingredients.recommend))];
  const avoid = [...new Set(top.flatMap((t) => t.ingredients.avoid))];
  return { recommend, avoid };
}

function lifestyleAdvice(top, skinType) {
  const base = [
    '수면 7시간 이상 — 콜라겐 합성은 깊은 수면 구간에 집중됩니다.',
    '하루 물 1.5~2L, 카페인은 오후 2시 이전까지.',
    '베갯잇은 주 2회 교체 — 접촉성 트러블의 흔한 원인입니다.',
  ];
  if (skinType.key === 'oily' || skinType.key === 'combination') base.push('고당지수 식단(정제 탄수화물)은 피지 분비를 자극합니다. 저녁 탄수화물을 줄여보세요.');
  if (top.some((t) => t.key === 'redness')) base.push('사우나·매운 음식·급격한 온도 변화는 홍조를 악화시킵니다.');
  if (top.some((t) => t.key === 'darkCircle')) base.push('취침 2시간 전 화면 밝기를 낮추면 눈가 부종이 줄어듭니다.');
  return base;
}

export const DISCLAIMER =
  '본 분석은 카메라 영상의 광학적 특성을 계산한 참고용 정보이며 의료기기·의학적 진단이 아닙니다. 지속되는 피부 질환은 피부과 전문의 진료를 받으세요.';
