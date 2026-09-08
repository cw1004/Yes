/**
 * 클라이언트가 보낸 분석 데이터 검증.
 *
 * 분석은 브라우저에서 계산하므로(그게 이 앱의 프라이버시 설계다) 서버는
 * 그 결과를 **믿을 수 없다**. 사용자가 임의의 값을 보낼 수 있고,
 * 그 값은 저장되어 나중에 화면과 통계에 다시 나온다.
 *
 * 그래서 여기서:
 *  - 아는 지표 키만 통과시키고
 *  - 이름표(label)는 클라이언트 것을 버리고 서버의 정본을 쓴다 (문자열 주입 차단)
 *  - 숫자는 범위 안으로 자른다 (통계 오염 방지)
 */

/** 지표 키 → 정본 이름표·단위. metrics.js 와 같아야 한다. */
export const METRIC_SPEC = Object.assign(Object.create(null), {
  evenness:     { label: '톤 균일도',      unit: 'ΔL' },
  redness:      { label: '홍조·민감도',     unit: 'Δa*' },
  oiliness:     { label: '유분 밸런스',     unit: '%' },
  texture:      { label: '모공·피부결',     unit: 'E' },
  pigmentation: { label: '색소침착·잡티',   unit: '%' },
  darkCircle:   { label: '다크서클',       unit: 'ΔL' },
  wrinkle:      { label: '주름·탄력',      unit: 'Δg' },
  hydration:    { label: '수분 지수(추정)', unit: 'idx' },
  clarity:      { label: '피부 투명도',    unit: 'idx' },
});

// 아래 표들도 프로토타입 없는 객체로 둔다.
// 일반 객체면 '__proto__'/'constructor' 같은 키가 조회에서 truthy 로 잡혀 검증을 통과한다.
const LEVELS = { excellent: '매우 좋음', good: '좋음', fair: '보통', weak: '주의', poor: '집중 관리' };
const UNDERTONES = Object.assign(Object.create(null), { warm: '웜톤', cool: '쿨톤', neutral: '뉴트럴' });
const CATEGORIES = Object.assign(Object.create(null), {
  very_light: { label: '베리 라이트', fitzpatrick: 'I' }, light: { label: '라이트', fitzpatrick: 'II' },
  intermediate: { label: '인터미디엇', fitzpatrick: 'III' }, tan: { label: '탠', fitzpatrick: 'IV' },
  brown: { label: '브라운', fitzpatrick: 'V' }, dark: { label: '다크', fitzpatrick: 'VI' },
});

const num = (v, lo, hi, dflt = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

const levelOf = (score) =>
  score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'weak' : 'poor';

/** 색상은 #rrggbb 만 허용 (스타일 속성에 그대로 들어간다) */
const FALLBACK_SKIN_HEX = '#c8a887';
const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : FALLBACK_SKIN_HEX);

/**
 * @throws 형태가 아예 아닐 때
 * @returns 서버가 신뢰할 수 있는 형태로 다시 만든 분석 객체
 */
export function sanitizeAnalysis(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('분석 데이터가 올바르지 않습니다.'), { status: 400 });
  }
  const rawMetrics = Array.isArray(input.metrics) ? input.metrics : [];
  const seen = new Set();
  const metrics = [];
  for (const m of rawMetrics) {
    const key = String(m?.key ?? '');
    const spec = METRIC_SPEC[key];
    if (!spec || seen.has(key)) continue; // 모르는 키·중복은 버린다
    seen.add(key);
    const score = Math.round(num(m.score, 0, 100));
    const level = levelOf(score);
    const metric = {
      key,
      label: spec.label,             // 클라이언트 이름표는 쓰지 않는다
      unit: spec.unit,
      value: Math.round(num(m.value, -1e6, 1e6) * 100) / 100,
      score,
      level,
      levelLabel: LEVELS[level],
    };
    if (key === 'oiliness') {
      metric.tZone = Math.round(num(m.tZone, 0, 100) * 10) / 10;
      metric.uZone = Math.round(num(m.uZone, 0, 100) * 10) / 10;
    }
    metrics.push(metric);
  }
  if (metrics.length < 3) {
    throw Object.assign(new Error('분석 지표가 부족합니다. 다시 촬영해 주세요.'), { status: 400 });
  }

  const t = input.tone || {};
  const categoryKey = CATEGORIES[t.category] ? t.category : 'intermediate';
  const undertone = UNDERTONES[t.undertone] ? t.undertone : 'neutral';
  const tone = {
    L: Math.round(num(t.L, 0, 100) * 10) / 10,
    a: Math.round(num(t.a, -128, 128) * 10) / 10,
    b: Math.round(num(t.b, -128, 128) * 10) / 10,
    ita: Math.round(num(t.ita, -90, 90) * 10) / 10,
    category: categoryKey,
    categoryLabel: CATEGORIES[categoryKey].label,
    fitzpatrick: CATEGORIES[categoryKey].fitzpatrick,
    undertone,
    undertoneLabel: UNDERTONES[undertone],
    hex: hex(t.hex),
  };

  const z = input.zoneBalance || {};
  const totalScore = Math.round(num(input.totalScore, 0, 100));
  return {
    version: 2,
    createdAt: new Date().toISOString(),   // 클라이언트 시각은 믿지 않는다
    totalScore,
    grade: totalScore >= 85 ? 'A+' : totalScore >= 75 ? 'A' : totalScore >= 65 ? 'B' : totalScore >= 55 ? 'C' : 'D',
    tone,
    zoneBalance: {
      tZoneShine: Math.round(num(z.tZoneShine, 0, 100) * 10) / 10,
      uZoneShine: Math.round(num(z.uZoneShine, 0, 100) * 10) / 10,
      delta: Math.round(num(z.delta, -100, 100) * 10) / 10,
    },
    coverage: {
      skinRatio: Math.round(num(input.coverage?.skinRatio, 0, 1) * 1000) / 1000,
      pixels: Math.round(num(input.coverage?.pixels, 0, 1e9)),
    },
    toneCorrection: Math.round(num(input.toneCorrection, 0.2, 5, 1) * 100) / 100,
    metrics,
  };
}

/** 촬영 품질 정보도 같은 이유로 다듬는다 */
export function sanitizeQuality(q) {
  if (!q || typeof q !== 'object') return null;
  const CODES = new Set(['dark', 'bright', 'blur', 'small']);
  return {
    brightness: Math.round(num(q.brightness, 0, 255)),
    sharpness: Math.round(num(q.sharpness, 0, 1e6)),
    faceRatio: Math.round(num(q.faceRatio, 0, 1) * 1000) / 1000,
    confidence: Math.round(num(q.confidence, 0, 100)),
    ok: q.ok === true,
    issues: (Array.isArray(q.issues) ? q.issues : [])
      .filter((i) => CODES.has(i?.code))
      .slice(0, 4)
      .map((i) => ({ code: i.code })),   // 메시지는 화면에서 다시 만든다
  };
}
