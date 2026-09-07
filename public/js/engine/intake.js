/**
 * 문진(問診) — 상담 전 6문항.
 *
 * 측정값만으로는 "왜 이렇게 됐는지"를 말할 수 없다.
 * 수면·루틴·자각 증상을 같이 받아야 원인을 짚고,
 * 무엇보다 **본인 생각과 측정값이 어긋나는 지점**을 발견할 수 있다.
 * 그 불일치가 상담에서 고객이 가장 크게 반응하는 부분이다.
 */
export const INTAKE = [
  {
    key: 'ageBand', question: '연령대를 알려주세요', why: '연령별 표준 대비로 해석이 달라집니다',
    options: [
      { value: 'teens', label: '10대' }, { value: '20s', label: '20대' },
      { value: '30s', label: '30대' }, { value: '40s', label: '40대' }, { value: '50s', label: '50대 이상' },
    ],
  },
  {
    key: 'selfType', question: '평소 본인 피부는 어떤 편인가요?', why: '자각과 측정의 차이를 확인합니다',
    options: [
      { value: 'dry', label: '건성 — 당기고 각질' }, { value: 'oily', label: '지성 — 번들거림' },
      { value: 'combination', label: '복합성 — T존만 번들' }, { value: 'sensitive', label: '민감성 — 자주 붉어짐' },
      { value: 'unknown', label: '잘 모르겠어요' },
    ],
  },
  {
    key: 'mainWorry', question: '가장 신경 쓰이는 고민은?', why: '처방 우선순위를 정합니다',
    options: [
      { value: 'acne', label: '트러블·여드름' }, { value: 'pigmentation', label: '잡티·색소' },
      { value: 'wrinkle', label: '주름·탄력' }, { value: 'pore', label: '모공·피부결' },
      { value: 'dryness', label: '건조함' }, { value: 'darkCircle', label: '다크서클' },
    ],
  },
  {
    key: 'routine', question: '현재 스킨케어 단계는?', why: '실행 가능한 처방을 설계합니다',
    options: [
      { value: 'none', label: '거의 안 함' }, { value: 'basic', label: '기본 (토너·크림)' },
      { value: 'active', label: '기능성 제품 사용 중' }, { value: 'clinic', label: '시술도 받는 편' },
    ],
  },
  {
    key: 'sleep', question: '평균 수면 시간은?', why: '콜라겐 합성과 눈가 상태에 직결됩니다',
    options: [
      { value: 'lt5', label: '5시간 미만' }, { value: '5to7', label: '5~7시간' }, { value: 'gte7', label: '7시간 이상' },
    ],
  },
  {
    key: 'reaction', question: '화장품 때문에 붉어지거나 따가웠던 적이 있나요?', why: '처방 강도를 조절합니다',
    options: [
      { value: 'often', label: '자주 있다' }, { value: 'sometimes', label: '가끔 있다' }, { value: 'never', label: '거의 없다' },
    ],
  },
];

export const INTAKE_KEYS = INTAKE.map((q) => q.key);

/** 답변 검증 — 알 수 없는 값은 버린다(신뢰할 수 없는 입력이 상담문에 섞이지 않게) */
export function sanitizeIntake(answers = {}) {
  const clean = {};
  for (const q of INTAKE) {
    const v = answers[q.key];
    if (q.options.some((o) => o.value === v)) clean[q.key] = v;
  }
  return clean;
}

export const AGE_LABEL = { teens: '10대', '20s': '20대', '30s': '30대', '40s': '40대', '50s': '50대 이상' };
export const SELF_TYPE_LABEL = { dry: '건성', oily: '지성', combination: '복합성', sensitive: '민감성', unknown: '모름' };
export const WORRY_LABEL = { acne: '트러블', pigmentation: '잡티·색소', wrinkle: '주름·탄력', pore: '모공·피부결', dryness: '건조함', darkCircle: '다크서클' };

/** 자각 고민 -> 측정 지표 매핑 (일치/불일치 판정에 쓴다) */
export const WORRY_TO_METRIC = {
  acne: 'texture', pigmentation: 'pigmentation', wrinkle: 'wrinkle',
  pore: 'texture', dryness: 'hydration', darkCircle: 'darkCircle',
};
