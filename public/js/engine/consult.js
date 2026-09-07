/**
 * AI 스킨 컨설턴트 "닥터 세라" 상담문 생성기 (순수 함수).
 *
 * 실제 진료 흐름(문진 확인 → 시진 소견 → 종합 소견 → 처방 → 재진)을 그대로 따라간다.
 * 고객이 가장 크게 반응하는 지점은 **본인 생각과 측정값이 어긋나는 순간**이라
 * discordance(불일치) 단계를 별도로 둔다.
 *
 * 표현 규칙(중요): '진단·처방·치료' 대신 '소견·관리·제안'을 쓴다.
 * 이 앱은 의료기기가 아니고, 의료 표현을 쓰는 순간 규제 대상이 된다.
 */
import { WORRY_TO_METRIC, WORRY_LABEL, SELF_TYPE_LABEL, AGE_LABEL } from './intake.js';

export const DOCTOR = {
  id: 'sera',
  name: '닥터 세라',
  nameEn: 'Dr. Sera',
  title: 'AI 스킨 컨설턴트',
  disclaimerShort: 'AI 가상 캐릭터입니다 · 의료 행위가 아닙니다',
  intro: '피부 표면의 광학 데이터를 읽고, 무엇부터 손대야 하는지 순서를 잡아드립니다.',
};

/** 지표 -> 부위 표현 (의사가 "여기 보시면" 하고 짚는 느낌을 만든다) */
const ZONE_OF = {
  oiliness: { zone: 'nose', words: '이마와 코 라인' },
  texture: { zone: 'leftCheek', words: '코 옆과 볼' },
  pigmentation: { zone: 'rightCheek', words: '광대 위쪽' },
  darkCircle: { zone: 'underEyeLeft', words: '눈 아래' },
  wrinkle: { zone: 'eyeCornerLeft', words: '눈가와 이마' },
  redness: { zone: 'leftCheek', words: '양 볼 중앙' },
  hydration: { zone: 'chin', words: '볼과 턱선' },
  evenness: { zone: 'forehead', words: '얼굴 전체' },
  clarity: { zone: 'forehead', words: '얼굴 전체' },
};

/** 연령대별로 같은 점수도 다르게 읽는다 */
const AGE_NOTE = {
  teens: { wrinkle: '이 나이대에서는 거의 나타나지 않는 항목이라 크게 신경 쓰지 않으셔도 됩니다.', oiliness: '호르몬 영향으로 피지가 많은 시기입니다. 억제보다 세정 습관이 먼저입니다.' },
  '20s': { wrinkle: '지금 관리하면 예방 구간입니다. 이미 생긴 걸 지우는 것보다 훨씬 쉽습니다.', pigmentation: '자외선 누적이 시작되는 시기라 차단제가 가장 비용 대비 효과가 큽니다.' },
  '30s': { wrinkle: '표정 주름이 자리잡기 시작하는 구간입니다. 레티노이드 도입을 고려할 시점입니다.', hydration: '피지 분비가 줄기 시작해 20대와 같은 루틴을 유지하면 건조해집니다.' },
  '40s': { wrinkle: '탄력 저하가 함께 오는 시기라 보습과 항산화를 같이 가져가야 합니다.', pigmentation: '기존 색소가 짙어지는 구간이라 미백보다 차단 유지가 먼저입니다.' },
  '50s': { hydration: '장벽 기능이 떨어지는 시기입니다. 세정력을 낮추는 것만으로도 체감이 큽니다.', wrinkle: '주름을 없애기보다 깊어지지 않게 유지하는 목표가 현실적입니다.' },
};

const SLEEP_NOTE = {
  lt5: '수면이 5시간 미만이면 눈가 순환과 콜라겐 합성이 함께 떨어집니다. 어떤 제품을 써도 이 항목이 발목을 잡습니다.',
  '5to7': '수면은 조금 부족한 편입니다. 30분만 더 확보해도 눈가 항목이 먼저 반응합니다.',
  gte7: '수면은 충분합니다. 이 조건이면 제품 반응도 잘 나오는 편입니다.',
};

const turn = (stage, text, extra = {}) => ({ stage, text, tier: 'pro', ...extra });

/**
 * @param {object} analysis computeMetrics 결과
 * @param {object} diagnosis diagnose 결과
 * @param {object} intake sanitizeIntake 결과
 */
export function buildConsult(analysis, diagnosis, intake = {}) {
  const byKey = Object.fromEntries(analysis.metrics.map((m) => [m.key, m]));
  // 하위 3개를 그냥 집는 게 아니라 '실제로 손댈 구간'만 고른다.
  // 90점짜리를 3순위 고민이라고 말하는 순간 상담 전체의 신뢰가 깨진다.
  const flagged = diagnosis.concerns.filter((c) => c.score < 70).slice(0, 3);
  const top = flagged.length ? flagged : diagnosis.concerns.slice(0, 1);
  const worst = top[0];
  const allClear = flagged.length === 0;
  const script = [];

  /* ── 1. 인사 ── */
  script.push(turn('greeting',
    `안녕하세요, ${DOCTOR.name}입니다. 촬영본 잘 받았습니다.`, { tier: 'free' }));
  script.push(turn('greeting',
    `조명 조건까지 반영해서 얼굴을 아홉 개 항목으로 나눠 봤습니다. 하나씩 짚어드릴게요.`, { tier: 'free' }));

  /* ── 2. 문진 확인 ── */
  const intakeBits = [];
  if (intake.ageBand) intakeBits.push(AGE_LABEL[intake.ageBand]);
  if (intake.selfType && intake.selfType !== 'unknown') intakeBits.push(`스스로 ${SELF_TYPE_LABEL[intake.selfType]}`);
  if (intake.mainWorry) intakeBits.push(`${WORRY_LABEL[intake.mainWorry]}이 가장 신경 쓰인다`);
  if (intakeBits.length) {
    script.push(turn('intake',
      `말씀해 주신 내용부터 정리하면 — ${intakeBits.join(', ')}고 하셨죠.`, { tier: 'free' }));
  }

  /* ── 3. 불일치: 상담의 핵심 ── */
  const discordance = findDiscordance(analysis, diagnosis, intake, byKey);
  for (const d of discordance) {
    script.push(turn('discordance', d.text, { tier: d.tier, highlight: true, metric: d.metric, zone: ZONE_OF[d.metric]?.zone }));
  }

  /* ── 4. 시진 소견 ── */
  script.push(turn('finding',
    `측정 결과로는 종합 ${analysis.totalScore}점, ${diagnosis.skinType.label} 피부로 보입니다.`, { tier: 'free' }));

  if (allClear) {
    script.push(turn('finding',
      `솔직히 말씀드리면 지금 급하게 손댈 항목이 없습니다. 아홉 개 항목이 모두 양호 구간이에요.`, { tier: 'free' }));
    script.push(turn('finding',
      `상대적으로 가장 낮은 게 ${worst.label}(${worst.score}점)인데, 이것도 관리 대상이라기보다 유지 대상입니다.`,
      { metric: worst.key, zone: ZONE_OF[worst.key]?.zone, score: worst.score }));
  } else {
    top.forEach((c, i) => {
      const z = ZONE_OF[c.key];
      const lead = i === 0 ? '가장 먼저 눈에 들어오는 건' : i === 1 ? '두 번째는' : '세 번째로';
      script.push(turn('finding',
        `${lead} ${c.label}입니다. ${z ? `${z.words} 쪽에서 ` : ''}${c.score}점으로 ${c.levelLabel} 구간이에요.`,
        { tier: i === 0 ? 'free' : 'pro', metric: c.key, zone: z?.zone, score: c.score }));
      if (i === 0) {
        script.push(turn('finding', `${c.cause}`, { tier: 'pro', metric: c.key }));
      }
    });
    // 나머지가 멀쩡하면 그렇다고 말해준다 — 문제만 나열하면 불안 마케팅이 된다
    const fine = diagnosis.concerns.filter((c) => c.score >= 70).slice(-3);
    if (fine.length >= 3) {
      const lo = Math.min(...fine.map((c) => c.score));
      script.push(turn('finding',
        `반대로 ${fine.map((c) => c.label).join(', ')} 항목은 ${lo >= 100 ? '만점에 가깝습니다' : `${lo}점 이상이라 양호합니다`}. 지금 여기에 돈 쓰지 마세요.`));
    }
  }

  /* ── 5. 종합 소견 ── */
  const ageNote = AGE_NOTE[intake.ageBand]?.[worst.key];
  script.push(turn('impression', allClear
    ? `정리하면, ${diagnosis.skinType.desc} 지금 루틴을 유지하는 게 최선입니다.`
    : `정리하면, ${diagnosis.skinType.desc} ${worst.label} 항목이 전체 인상을 가장 많이 끌어내리고 있습니다.`));
  if (ageNote) script.push(turn('impression', ageNote));
  if (intake.sleep) script.push(turn('impression', SLEEP_NOTE[intake.sleep]));

  /* ── 6. 처방(관리 제안) ── */
  script.push(turn('plan', allClear
    ? `그래서 새로 추가할 건 없습니다. 지금 쓰는 걸 그대로 쓰시고, 자외선 차단만 빠짐없이 하세요.`
    : `그래서 순서를 이렇게 잡겠습니다. 한 번에 다 바꾸지 마시고 위에서부터 하나씩만 하세요.`));
  script.push(turn('plan',
    `${allClear ? '유지 포인트' : '1순위'} — ${worst.label}. ${worst.action}`, { metric: worst.key }));
  if (top[1]) script.push(turn('plan', `2순위 — ${top[1].label}. ${top[1].action}`, { metric: top[1].key }));
  script.push(turn('plan',
    `제품에 들어가야 할 성분은 ${diagnosis.pro.ingredients.recommend.slice(0, 3).join(', ')} 입니다. 반대로 ${diagnosis.pro.ingredients.avoid.slice(0, 2).join(', ')}는 지금 피하세요.`));

  /* ── 7. 주의 ── */
  const caution = cautionFor(intake, diagnosis, byKey);
  if (caution) script.push(turn('caution', caution, { warn: true }));

  /* ── 8. 재진 ── */
  script.push(turn('followup',
    `4주 뒤에 같은 조명, 같은 시간대로 다시 촬영해 주세요. 그때 전후 사진과 점수를 나란히 놓고 무엇이 실제로 반응했는지 보겠습니다.`));
  script.push(turn('followup',
    `기준선(baseline)은 오늘 사진으로 잡아뒀습니다. 비교는 사람 눈보다 숫자가 정확합니다.`));

  /* ── 9. 마무리 ── */
  script.push(turn('closing',
    `${WORRY_LABEL[intake.mainWorry] || '피부'} 때문에 오래 고민하셨을 텐데, 오늘 순서는 잡혔습니다. 4주 뒤에 뵙겠습니다.`));

  const freeScript = script.filter((s) => s.tier === 'free');
  return {
    doctor: DOCTOR,
    script,
    free: {
      script: freeScript,
      lockedTurns: script.length - freeScript.length,
      teaser: `${worst.label} 원인 분석과 1·2순위 관리 순서, 4주 재진 계획이 정밀 상담에 담겨 있습니다.`,
    },
    discordance,
    followUpAt: new Date(Date.now() + 28 * 864e5).toISOString(),
  };
}

/**
 * 자각 ↔ 측정 불일치 찾기.
 * "건성인 줄 알았는데 수분부족형 지성" 같은 경우, 잘못된 제품 선택이 원인인 경우가 많다.
 */
function findDiscordance(analysis, diagnosis, intake, byKey) {
  const out = [];
  const measured = diagnosis.skinType.key;
  const self = intake.selfType;

  if (self && self !== 'unknown' && self !== measured) {
    const t = analysis.zoneBalance.tZoneShine;
    if (self === 'dry' && (measured === 'oily' || measured === 'combination')) {
      out.push({
        tier: 'free', metric: 'oiliness',
        text: `그런데 여기서 짚고 갈 게 있습니다. 건성이라고 하셨는데, T존 광택이 ${t}%로 측정됐어요. 수분이 부족해서 피부가 유분으로 보상하는 상태에 가깝습니다. 이 경우 유분 잡는 제품을 쓰면 오히려 더 나빠집니다.`,
      });
    } else if (self === 'oily' && (measured === 'dry' || measured === 'sensitive')) {
      out.push({
        tier: 'free', metric: 'hydration',
        text: `짚고 갈 부분이 있습니다. 지성이라고 하셨는데 측정상 ${diagnosis.skinType.label}에 가깝습니다. 세정력이 강한 제품을 오래 쓰신 건 아닌지 한번 확인해 보세요.`,
      });
    } else {
      out.push({
        tier: 'pro', metric: 'oiliness',
        text: `본인은 ${SELF_TYPE_LABEL[self]}이라고 하셨는데 측정은 ${diagnosis.skinType.label} 쪽으로 나왔습니다. 계절이나 최근 제품 변경 영향일 수 있어 4주 뒤 재측정에서 확인하겠습니다.`,
      });
    }
  }

  // 자각 고민과 실제 최하위 지표가 다른 경우
  const worryMetric = WORRY_TO_METRIC[intake.mainWorry];
  const worst = diagnosis.concerns[0];
  if (worryMetric && worst && worryMetric !== worst.key) {
    const m = byKey[worryMetric];
    if (m && m.score >= 65) {
      out.push({
        tier: 'pro', metric: worst.key,
        text: `${WORRY_LABEL[intake.mainWorry]}을 가장 걱정하셨는데, 그 항목은 ${m.score}점으로 나쁘지 않습니다. 지금 인상을 더 크게 좌우하는 건 ${worst.label} 쪽이에요. 여기부터 손대면 체감이 빠릅니다.`,
      });
    }
  }
  return out;
}

function cautionFor(intake, diagnosis, byKey) {
  if (intake.reaction === 'often') {
    return '화장품 반응이 잦다고 하셨으니, 새 제품은 반드시 귀 뒤나 턱선에 2일 테스트 후 얼굴에 올리세요. 기능성은 주 1회부터 시작합니다.';
  }
  if (byKey.redness?.score < 50) {
    return '지금은 장벽이 예민한 구간이라 각질 제거와 고농도 기능성을 동시에 넣으면 역효과가 납니다. 2주는 진정만 하세요.';
  }
  if (intake.routine === 'none') {
    return '지금 단계에서 제품을 여러 개 늘리면 십중팔구 중간에 포기합니다. 세안·보습·자외선 차단 세 가지만 4주 지켜보세요.';
  }
  return null;
}

/** LLM 내레이션에 넘길 컨텍스트 (개인 식별 정보 없음 — 숫자와 선택지뿐) */
export function consultContext(analysis, diagnosis, intake) {
  return {
    totalScore: analysis.totalScore,
    skinType: diagnosis.skinType.label,
    tone: { ita: analysis.tone.ita, undertone: analysis.tone.undertoneLabel, category: analysis.tone.categoryLabel },
    zoneBalance: analysis.zoneBalance,
    metrics: analysis.metrics.map((m) => ({ key: m.key, label: m.label, score: m.score, level: m.levelLabel })),
    topConcerns: diagnosis.concerns.slice(0, 3).map((c) => ({ label: c.label, score: c.score, cause: c.cause, action: c.action })),
    intake,
  };
}
