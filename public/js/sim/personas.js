/**
 * 체험용 페르소나.
 *
 * 실제로 자주 오는 조합을 골랐다. 특히 '자각과 측정이 어긋나는' 경우를 넣었는데,
 * 그게 이 앱이 다른 진단 앱과 갈라지는 지점이라 체험에서 먼저 보여야 한다.
 */
export const PERSONAS = [
  {
    id: 'oily-20s',
    expectConcern: 'oiliness',
    title: '20대 · 번들거리는 지성',
    hint: 'T존 광택과 모공이 두드러지는 전형',
    face: { base: '#e6bfa0', rough: 0.62, spots: 16, shine: 0.95, dark: 0.15, redness: 0.15 },
    intake: { ageBand: '20s', selfType: 'oily', mainWorry: 'acne', routine: 'basic', sleep: '5to7', reaction: 'never' },
  },
  {
    id: 'dry-30s',
    expectConcern: 'oiliness',
    expectDiscordance: true,
    title: '30대 · 건성이라 믿는 복합성',
    hint: '자각과 측정이 어긋나는 경우 — 닥터가 짚어줍니다',
    badge: '추천',
    face: { base: '#eccbb0', rough: 0.45, spots: 12, shine: 0.7, dark: 0.3 },
    intake: { ageBand: '30s', selfType: 'dry', mainWorry: 'dryness', routine: 'active', sleep: 'lt5', reaction: 'sometimes' },
  },
  {
    id: 'pigment-40s',
    expectConcern: 'pigmentation',
    title: '40대 · 잡티와 색소',
    hint: '누적 자외선으로 톤이 고르지 않은 상태',
    face: { base: '#dcb493', rough: 0.42, spots: 150, shine: 0.2, dark: 0.16 },
    intake: { ageBand: '40s', selfType: 'combination', mainWorry: 'pigmentation', routine: 'active', sleep: '5to7', reaction: 'sometimes' },
  },
  {
    id: 'sensitive',
    expectConcern: 'redness',
    title: '민감성 · 자주 붉어짐',
    hint: '장벽이 약해 기능성 제품에 반응하는 편',
    face: { base: '#eec3b4', rough: 0.5, spots: 18, shine: 0.2, dark: 0.2, redness: 0.95 },
    intake: { ageBand: '30s', selfType: 'sensitive', mainWorry: 'dryness', routine: 'basic', sleep: 'lt5', reaction: 'often' },
  },
  {
    id: 'deep-tone',
    expectTone: { itaBelow: -10 },
    title: '딥 스킨톤',
    hint: 'ITA 음수 영역 — 톤 보정과 셰이드 매칭 확인용',
    face: { base: '#7a4f38', rough: 0.45, spots: 30, shine: 0.35, dark: 0.25 },
    intake: { ageBand: '30s', selfType: 'combination', mainWorry: 'pore', routine: 'basic', sleep: 'gte7', reaction: 'never' },
  },
];

/** 체험이 '보여주기로 한 것'을 실제로 보여주는지 테스트가 검증한다 (tests/sim.test.js) */
export const personaById = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[1];
