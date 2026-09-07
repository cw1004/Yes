/**
 * 피부 지표 계산기.
 * 모든 지표는 { value(원시값), score(0~100, 높을수록 좋음), level } 형태로 통일한다.
 * 원시값은 재분석 비교(전/후)에 쓰고, score 는 UI/진단 규칙에 쓴다.
 */
import { rgbToLab, ita, itaToCategory, labToHex, clamp } from './color.js';
import { buildSkinMask, faceZones, forEachZonePixel, T_ZONE, U_ZONE } from './skinmask.js';

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** 원시값 -> 0~100 점수. lowerIsBetter 인 지표는 반전. */
function toScore(value, { good, bad }) {
  const t = (value - bad) / (good - bad);
  return clamp(Math.round(t * 100));
}

const levelOf = (score) =>
  score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'weak' : 'poor';

const LEVEL_LABEL = { excellent: '매우 좋음', good: '좋음', fair: '보통', weak: '주의', poor: '집중 관리' };

function metric(key, label, unit, value, band, extra = {}) {
  const score = toScore(value, band);
  return {
    key,
    label,
    unit,
    value: Math.round(value * 100) / 100,
    score,
    level: levelOf(score),
    levelLabel: LEVEL_LABEL[levelOf(score)],
    ...extra,
  };
}

/** 이미지 전체의 Lab 채널 맵을 한 번만 만든다 (지표들이 공유) */
function labPlanes(img) {
  const n = img.width * img.height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const lab = rgbToLab(img.data[i], img.data[i + 1], img.data[i + 2]);
    L[p] = lab.L;
    A[p] = lab.a;
    B[p] = lab.b;
  }
  return { L, A, B };
}

function zoneSamples(img, maskObj, planes, zone) {
  const L = [], A = [], B = [];
  forEachZonePixel(img, maskObj, zone, (_, __, ___, p) => {
    L.push(planes.L[p]);
    A.push(planes.A[p]);
    B.push(planes.B[p]);
  });
  return { L, A, B };
}

/** 3x3 라플라시안 에너지 = 결(texture)/모공 거칠기의 대용 지표 */
function laplacianEnergy(img, maskObj, planes, zone) {
  const { width } = img;
  const vals = [];
  forEachZonePixel(img, maskObj, zone, (_, x, y, p) => {
    if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) return;
    const c = planes.L[p];
    const lap =
      4 * c - planes.L[p - 1] - planes.L[p + 1] - planes.L[p - width] - planes.L[p + width];
    vals.push(Math.abs(lap));
  });
  return { energy: pct(vals, 0.9), n: vals.length };
}

/** 수평 에지가 수직보다 강한 정도 = 주름(가로 방향 골) 대용 지표 */
function directionalWrinkle(img, maskObj, planes, zone) {
  const { width } = img;
  let gx = 0, gy = 0, n = 0;
  forEachZonePixel(img, maskObj, zone, (_, x, y, p) => {
    if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) return;
    gx += Math.abs(planes.L[p + 1] - planes.L[p - 1]);
    gy += Math.abs(planes.L[p + width] - planes.L[p - width]);
    n++;
  });
  if (!n) return 0;
  gx /= n; gy /= n;
  return Math.max(0, gy - gx); // 세로 방향 밝기 변화가 클수록 가로 주름
}

/**
 * 메인 진입점.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} img
 * @param {{x,y,width,height}} box 얼굴 박스
 */
export function computeMetrics(img, box) {
  const maskObj = buildSkinMask(img, box);
  const planes = labPlanes(img);
  const zones = faceZones(box);

  // ---- 전체 피부 샘플 ----
  const all = { L: [], A: [], B: [] };
  for (let p = 0; p < maskObj.mask.length; p++) {
    if (!maskObj.mask[p]) continue;
    all.L.push(planes.L[p]);
    all.A.push(planes.A[p]);
    all.B.push(planes.B[p]);
  }
  const skinRatio = maskObj.count / (box.width * box.height || 1);
  const meanL = mean(all.L), meanA = mean(all.A), meanB = mean(all.B);

  /**
   * 톤 보정 계수 (베버의 법칙).
   *
   * 결·주름·다크서클은 모두 밝기 차이(ΔL)로 잰다. 그런데 같은 정도의 요철이라도
   * 어두운 피부에서는 ΔL 자체가 작게 나온다. 절대값으로 채점하면 짙은 톤일수록
   * 점수가 부풀어 "손댈 게 없습니다"라는 잘못된 결론이 나온다.
   * 그래서 지각 대비(ΔL/L)를 기준 밝기(L*65)로 환산해 톤과 무관하게 채점한다.
   */
  const weber = 65 / Math.max(20, meanL);
  const norm = (v) => v * weber;

  // ---- 1. 피부톤 (ITA / 언더톤) ----
  const itaValue = ita(meanL, meanB);
  const category = itaToCategory(itaValue);
  const undertoneRatio = meanB === 0 ? 0 : meanA / meanB;
  const undertone =
    undertoneRatio > 0.62 ? 'cool' : undertoneRatio < 0.45 ? 'warm' : 'neutral';
  const undertoneLabel = { cool: '쿨톤', warm: '웜톤', neutral: '뉴트럴' }[undertone];

  // ---- 2. 톤 균일도 (밝기 편차가 작을수록 좋다) ----
  const stdL = std(all.L);
  const evenness = metric('evenness', '톤 균일도', 'ΔL', norm(stdL), { good: 3, bad: 14 });

  // ---- 3. 홍조 / 민감도 (a* 상위 꼬리) ----
  const rednessRaw = Math.max(0, pct(all.A, 0.95) - meanA);
  const redness = metric('redness', '홍조·민감도', 'Δa*', rednessRaw, { good: 2, bad: 12 });

  // ---- 4. 유분/번들거림 (T존 정반사 픽셀 비율) ----
  const shineOf = (zoneKeys) => {
    let hit = 0, tot = 0;
    const thr = pct(all.L, 0.92);
    for (const k of zoneKeys) {
      forEachZonePixel(img, maskObj, zones[k], (_, __, ___, p) => {
        tot++;
        if (planes.L[p] > thr && Math.abs(planes.A[p]) < 12) hit++;
      });
    }
    return tot ? (hit / tot) * 100 : 0;
  };
  const tShine = shineOf(T_ZONE);
  const uShine = shineOf(U_ZONE);
  const oiliness = metric('oiliness', '유분 밸런스', '%', tShine, { good: 6, bad: 34 }, {
    tZone: Math.round(tShine * 10) / 10,
    uZone: Math.round(uShine * 10) / 10,
  });

  // ---- 5. 모공·결 (라플라시안 에너지, 코/볼) ----
  const texRaw = mean(
    ['nose', 'leftCheek', 'rightCheek'].map((k) => laplacianEnergy(img, maskObj, planes, zones[k]).energy)
  );
  const texture = metric('texture', '모공·피부결', 'E', norm(texRaw), { good: 3, bad: 16 });

  // ---- 6. 색소침착 (국소 어두운 반점 면적비) ----
  const spotRatio = (() => {
    let dark = 0, tot = 0;
    const base = pct(all.L, 0.5);
    for (const k of [...T_ZONE, ...U_ZONE]) {
      forEachZonePixel(img, maskObj, zones[k], (_, __, ___, p) => {
        tot++;
        // 반점 판정 문턱도 톤에 맞춰 좁힌다 (짙은 톤에서 6은 너무 큰 낙차)
        if (planes.L[p] < base - 6 / weber && planes.B[p] > meanB) dark++;
      });
    }
    return tot ? (dark / tot) * 100 : 0;
  })();
  const pigmentation = metric('pigmentation', '색소침착·잡티', '%', spotRatio, { good: 3, bad: 26 });

  // ---- 7. 다크서클 (눈밑 vs 볼 밝기차) ----
  const cheekL = mean([
    ...zoneSamples(img, maskObj, planes, zones.leftCheek).L,
    ...zoneSamples(img, maskObj, planes, zones.rightCheek).L,
  ]);
  const underL = mean([
    ...zoneSamples(img, maskObj, planes, zones.underEyeLeft).L,
    ...zoneSamples(img, maskObj, planes, zones.underEyeRight).L,
  ]);
  const darkCircleRaw = Math.max(0, cheekL - underL);
  const darkCircle = metric('darkCircle', '다크서클', 'ΔL', norm(darkCircleRaw), { good: 1.5, bad: 12 });

  // ---- 8. 주름 (눈가 + 이마) ----
  const wrinkleRaw = mean(
    ['eyeCornerLeft', 'eyeCornerRight', 'forehead'].map((k) =>
      directionalWrinkle(img, maskObj, planes, zones[k])
    )
  );
  const wrinkle = metric('wrinkle', '주름·탄력', 'Δg', norm(wrinkleRaw), { good: 0.4, bad: 3.2 });

  // ---- 9. 수분 추정 (결 거칠기 + 유분 부족의 복합 추정치) ----
  const dryness = clamp(norm(texRaw) * 4 + Math.max(0, 10 - tShine) * 2.2, 0, 100);
  const hydration = metric('hydration', '수분 지수(추정)', 'idx', dryness, { good: 12, bad: 62 });

  // ---- 10. 투명도/광채 ----
  const clarityRaw = norm(stdL) * 0.6 + spotRatio * 0.25 + Math.max(0, 12 - tShine) * 0.3;
  const clarity = metric('clarity', '피부 투명도', 'idx', clarityRaw, { good: 4, bad: 22 });

  const metrics = [evenness, redness, oiliness, texture, pigmentation, darkCircle, wrinkle, hydration, clarity];

  // 가중 총점 — 사용자 체감에 큰 지표에 가중치를 더 준다
  const W = { evenness: 1.2, redness: 1.0, oiliness: 1.0, texture: 1.2, pigmentation: 1.3, darkCircle: 0.9, wrinkle: 1.1, hydration: 1.2, clarity: 1.1 };
  const totalScore = Math.round(
    metrics.reduce((s, m) => s + m.score * W[m.key], 0) / metrics.reduce((s, m) => s + W[m.key], 0)
  );

  return {
    version: 2,
    createdAt: new Date().toISOString(),
    totalScore,
    grade: totalScore >= 85 ? 'A+' : totalScore >= 75 ? 'A' : totalScore >= 65 ? 'B' : totalScore >= 55 ? 'C' : 'D',
    tone: {
      L: Math.round(meanL * 10) / 10,
      a: Math.round(meanA * 10) / 10,
      b: Math.round(meanB * 10) / 10,
      ita: Math.round(itaValue * 10) / 10,
      category: category.key,
      categoryLabel: category.label,
      fitzpatrick: category.fitzpatrick,
      undertone,
      undertoneLabel,
      hex: labToHex(meanL, meanA, meanB),
    },
    zoneBalance: {
      tZoneShine: Math.round(tShine * 10) / 10,
      uZoneShine: Math.round(uShine * 10) / 10,
      delta: Math.round((tShine - uShine) * 10) / 10,
    },
    coverage: { skinRatio: Math.round(skinRatio * 1000) / 1000, pixels: maskObj.count },
    toneCorrection: Math.round(weber * 100) / 100,
    metrics,
  };
}
