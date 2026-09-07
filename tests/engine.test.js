import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, labToHex, ita, itaToCategory } from '../public/js/engine/color.js';
import { isSkinPixel, faceZones, adaptiveFloors } from '../public/js/engine/skinmask.js';
import { computeMetrics } from '../public/js/engine/metrics.js';
import { assessQuality, fallbackFaceBox } from '../public/js/engine/quality.js';
import { diagnose, skinTypeOf, personalColor } from '../public/js/engine/diagnose.js';
import { bestShade, relevanceOf, rankOffers, rankProducts, expectedValuePerClick } from '../public/js/engine/ranking.js';
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));

/** 합성 얼굴 생성기 — 지표가 실제로 무엇을 재는지 검증하기 위한 대조군 */
function syntheticFace({ w = 240, h = 320, base = [222, 184, 155], shine = 0, spots = 0, noise = 0, darkEye = 0 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const box = fallbackFaceBox(w, h);
  const zones = faceZones(box);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rx = box.width / 2, ry = box.height / 2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inFace = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      let [r, g, b] = inFace ? base : [24, 22, 30];
      if (inFace) {
        const n = (rnd() - 0.5) * noise;
        r += n; g += n; b += n;
        const inT = [zones.forehead, zones.nose].some((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
        if (inT && shine && rnd() < shine) { r += 45; g += 45; b += 45; }
        if (spots && rnd() < spots) { r -= 34; g -= 30; b -= 22; }
        const inEye = [zones.underEyeLeft, zones.underEyeRight].some((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
        if (inEye && darkEye) { r -= darkEye; g -= darkEye * 0.9; b -= darkEye * 0.7; }
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { img: { data, width: w, height: h }, box };
}

test('Lab 변환은 왕복해도 색이 보존된다', () => {
  const lab = rgbToLab(222, 184, 155);
  assert.equal(labToHex(lab.L, lab.a, lab.b).toLowerCase(), '#deb89b');
});

test('ITA° 는 밝은 피부일수록 커지고 카테고리로 매핑된다', () => {
  const light = rgbToLab(245, 224, 205);
  const dark = rgbToLab(110, 78, 55);
  const itaLight = ita(light.L, light.b);
  const itaDark = ita(dark.L, dark.b);
  assert.ok(itaLight > itaDark, `${itaLight} > ${itaDark}`);
  assert.equal(itaToCategory(60).fitzpatrick, 'I');
  assert.equal(itaToCategory(-40).fitzpatrick, 'VI');
});

test('피부색 판정은 피부/비피부를 구분한다', () => {
  assert.equal(isSkinPixel(222, 184, 155), true);
  assert.equal(isSkinPixel(30, 90, 220), false);   // 파란 배경
  assert.equal(isSkinPixel(20, 18, 16), false);    // 머리카락
});

test('모든 피부톤이 조명 조건과 무관하게 검출된다', () => {
  // Fitzpatrick I~VI. 밝기 하한을 절대값으로 박아두면 짙은 톤이 실내 조명에서
  // 통째로 '피부 아님'이 되어 진단 자체가 불가능해진다.
  const tones = [[246, 226, 208], [237, 205, 180], [222, 184, 155], [198, 150, 116], [150, 102, 72], [104, 66, 46], [72, 45, 33]];
  const floorsOf = (rgb) => adaptiveFloors({ data: new Uint8ClampedArray([...rgb, 255]), width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 });
  for (const tone of tones) {
    for (const dim of [1, 0.8, 0.6, 0.45]) {
      const c = tone.map((v) => Math.round(v * dim));
      assert.equal(isSkinPixel(c[0], c[1], c[2], floorsOf(c)), true, `톤 ${tone} × ${dim} 미검출`);
    }
  }
  // 배경·머리카락은 여전히 배제되어야 한다
  for (const bad of [[30, 25, 22], [30, 90, 220], [130, 130, 132], [240, 240, 245], [60, 140, 70]]) {
    assert.equal(isSkinPixel(bad[0], bad[1], bad[2], floorsOf(bad)), false, `${bad} 오검출`);
  }
});

test('짙은 피부톤 얼굴도 마스크와 지표가 정상 산출된다', () => {
  const deep = syntheticFace({ base: [104, 66, 46], noise: 8 });
  const a = computeMetrics(deep.img, deep.box);
  assert.ok(a.coverage.skinRatio > 0.5, `짙은 톤 skinRatio ${a.coverage.skinRatio}`);
  assert.ok(a.tone.ita < 0, `짙은 톤은 ITA 음수여야 한다 (${a.tone.ita})`);
  assert.ok(['V', 'VI'].includes(a.tone.fitzpatrick), `Fitzpatrick ${a.tone.fitzpatrick}`);
  assert.equal(a.metrics.length, 9);
  assert.ok(a.totalScore > 0);
});

test('깨끗한 합성 얼굴이 문제 있는 얼굴보다 총점이 높다', () => {
  const clean = syntheticFace({ noise: 4 });
  const bad = syntheticFace({ noise: 30, shine: 0.5, spots: 0.12, darkEye: 34 });
  const a = computeMetrics(clean.img, clean.box);
  const b = computeMetrics(bad.img, bad.box);
  assert.ok(a.totalScore > b.totalScore, `clean ${a.totalScore} > bad ${b.totalScore}`);
  assert.equal(a.metrics.length, 9);
  assert.ok(a.coverage.skinRatio > 0.5, `skinRatio ${a.coverage.skinRatio}`);
});

test('T존 광택은 유분 지표를 실제로 떨어뜨린다', () => {
  const dry = syntheticFace({ noise: 4 });
  const oily = syntheticFace({ noise: 4, shine: 0.55 });
  const oilDry = computeMetrics(dry.img, dry.box).metrics.find((m) => m.key === 'oiliness');
  const oilOily = computeMetrics(oily.img, oily.box).metrics.find((m) => m.key === 'oiliness');
  assert.ok(oilOily.score < oilDry.score, `${oilOily.score} < ${oilDry.score}`);
  assert.ok(oilOily.tZone > oilDry.tZone);
});

test('눈밑을 어둡게 하면 다크서클 점수가 떨어진다', () => {
  const flat = syntheticFace({ noise: 4 });
  const circles = syntheticFace({ noise: 4, darkEye: 40 });
  const a = computeMetrics(flat.img, flat.box).metrics.find((m) => m.key === 'darkCircle');
  const b = computeMetrics(circles.img, circles.box).metrics.find((m) => m.key === 'darkCircle');
  assert.ok(b.score < a.score, `${b.score} < ${a.score}`);
});

test('같은 정도의 피부 상태는 톤이 달라도 비슷하게 채점된다', () => {
  // 결·주름은 ΔL 로 재므로, 보정 없이는 짙은 톤일수록 점수가 부풀어
  // "손댈 게 없습니다"라는 잘못된 결론이 나온다.
  const relFace = (base, rel) => {
    const { img, box } = syntheticFace({ base, noise: rel * base[0] });
    return computeMetrics(img, box);
  };
  for (const rel of [0.08, 0.16]) {
    const scores = [[237, 205, 180], [198, 150, 116], [104, 66, 46]].map((b) => relFace(b, rel).totalScore);
    const spread = Math.max(...scores) - Math.min(...scores);
    assert.ok(spread <= 16, `상대 거칠기 ${rel}에서 톤별 총점 편차가 ${spread}점 (${scores.join('/')})`);
  }
  // 보정 계수가 실제로 톤에 반응하는지
  const light = relFace([237, 205, 180], 0.1);
  const deep = relFace([104, 66, 46], 0.1);
  assert.ok(deep.toneCorrection > light.toneCorrection * 1.5,
    `짙은 톤 보정이 더 커야 한다 (${deep.toneCorrection} vs ${light.toneCorrection})`);
});

test('흐리거나 어두운 사진은 품질 게이트에 걸린다', () => {
  const { img, box } = syntheticFace({ base: [40, 32, 28], noise: 1 });
  const q = assessQuality(img, box);
  assert.ok(q.issues.some((i) => i.code === 'dark' || i.code === 'blur'));
  assert.ok(q.confidence < 100);
});

test('진단은 무료 3개 / 유료 전체로 나뉜다', () => {
  const { img, box } = syntheticFace({ noise: 18, shine: 0.3, spots: 0.06 });
  const d = diagnose(computeMetrics(img, box));
  assert.equal(d.free.preview.length, 3);
  assert.equal(d.free.lockedCount, 6);
  assert.equal(d.concerns.length, 9);
  assert.ok(d.pro.routine.am.length === 5 && d.pro.plan.length === 4);
  assert.ok(d.pro.ingredients.recommend.length > 0);
  // 무료 구간에는 원인/처방 본문이 들어가지 않는다
  assert.ok(!JSON.stringify(d.free).includes('원인'));
});

test('피부 타입과 퍼스널컬러가 규칙대로 나온다', () => {
  const base = { zoneBalance: { tZoneShine: 30, uZoneShine: 25 }, metrics: [{ key: 'hydration', score: 70 }, { key: 'redness', score: 80 }] };
  assert.equal(skinTypeOf(base).key, 'oily');
  assert.equal(skinTypeOf({ ...base, zoneBalance: { tZoneShine: 20, uZoneShine: 8 } }).key, 'combination');
  assert.equal(skinTypeOf({ ...base, metrics: [{ key: 'hydration', score: 70 }, { key: 'redness', score: 30 }] }).key, 'sensitive');
  assert.equal(personalColor({ ita: 50, undertone: 'warm' }).key, 'spring_warm');
  assert.equal(personalColor({ ita: 20, undertone: 'cool' }).key, 'winter_cool');
});

test('셰이드 매칭은 ITA와 언더톤이 가까운 호수를 고른다', () => {
  const cushion = catalog.products.find((p) => p.id === 'cus-001');
  const light = bestShade(cushion, { ita: 57, undertone: 'neutral' });
  const deep = bestShade(cushion, { ita: 24, undertone: 'warm' });
  assert.equal(light.code, '01');
  assert.equal(deep.code, '04');
  assert.ok(deep.fit > 70);
  assert.equal(deep.matched, true);
});

test('커버되지 않는 톤에는 매칭을 표시하지 않는다', () => {
  // 0% 매칭을 '추천 호수'로 내미는 건 추천이 아니라 오안내다
  const cushion = catalog.products.find((p) => p.id === 'cus-001'); // ITA 12~58 커버
  const outOfRange = bestShade(cushion, { ita: -40, undertone: 'cool' });
  assert.equal(outOfRange.matched, false);

  const foundation = catalog.products.find((p) => p.id === 'fnd-001'); // 딥까지 커버
  const deep = bestShade(foundation, { ita: -32, undertone: 'cool' });
  assert.equal(deep.matched, true, `딥 톤도 커버되어야 한다 (매칭 ${deep.fit}%)`);

  // 커버 못 하는 제품은 랭킹에서 밀려야 한다
  const profile = {
    tone: { ita: -32, undertone: 'cool' }, skinType: 'combination', skinTypeLabel: '복합성',
    concerns: [{ key: 'texture', label: '결', score: 30 }, { key: 'oiliness', label: '유분', score: 45 }, { key: 'redness', label: '홍조', score: 60 }],
  };
  const ranked = rankProducts(catalog, profile, { limit: 20 });
  const matched = ranked.find((r) => r.shade?.matched);
  const unmatched = ranked.find((r) => r.shade && !r.shade.matched);
  if (matched && unmatched) {
    assert.ok(matched.scores.total > unmatched.scores.total,
      '내 톤을 커버하는 제품이 커버 못 하는 제품보다 위에 있어야 한다');
    assert.ok(unmatched.reasons.some((x) => /커버하는 호수가 없습니다/.test(x)));
  }
});

test('적합도는 내 고민을 겨냥한 제품을 더 높게 준다', () => {
  const profile = {
    tone: { ita: 45, undertone: 'warm' }, skinType: 'oily', skinTypeLabel: '지성',
    concerns: [{ key: 'oiliness', label: '유분', score: 20 }, { key: 'texture', label: '결', score: 30 }, { key: 'wrinkle', label: '주름', score: 90 }],
  };
  const sebum = catalog.products.find((p) => p.id === 'ser-001'); // 나이아신아마이드(유분/결)
  const wrinkleCare = catalog.products.find((p) => p.id === 'ser-004'); // 레티놀(주름)
  assert.ok(relevanceOf(sebum, profile) > relevanceOf(wrinkleCare, profile));
});

test('오퍼 랭킹은 최저가를 표시하고 품절을 밀어낸다', () => {
  const p = catalog.products.find((x) => x.id === 'cus-002'); // 11번가 오퍼가 품절
  const offers = rankOffers(p, catalog.merchants);
  assert.equal(offers.filter((o) => o.isLowest).length, 1);
  assert.equal(offers[offers.length - 1].stock, false, '품절 오퍼는 최하위');
  assert.ok(offers[0].epc >= 0);
});

test('클릭당 기대매출은 수수료율·전환율을 함께 반영한다', () => {
  const m = catalog.merchants.coupang;
  const cheap = expectedValuePerClick({ price: 10000, coupon: 0, commissionRate: 0.03, shippingDays: 1, stock: true }, m);
  const rich = expectedValuePerClick({ price: 50000, coupon: 0, commissionRate: 0.08, shippingDays: 1, stock: true }, m);
  assert.ok(rich > cheap * 5);
});

test('상품 랭킹은 수익 가중치를 올려도 적합도 상위권을 유지한다', () => {
  const profile = {
    tone: { ita: 45, undertone: 'warm' }, skinType: 'oily', skinTypeLabel: '지성',
    concerns: [{ key: 'oiliness', label: '유분', score: 18 }, { key: 'texture', label: '결', score: 25 }, { key: 'redness', label: '홍조', score: 40 }],
  };
  const balanced = rankProducts(catalog, profile, { limit: 5 });
  const greedy = rankProducts(catalog, profile, { limit: 5, weights: { relevance: 0.4, conversion: 0.25, revenue: 0.35 } });
  assert.ok(balanced[0].scores.relevance >= 55, '1위 제품은 적합도가 충분히 높아야 한다');
  const overlap = greedy.filter((g) => balanced.some((b) => b.id === g.id)).length;
  assert.ok(overlap >= 3, `수익 가중치를 올려도 상위권이 유지되어야 한다 (겹침 ${overlap}/5)`);
  assert.ok(balanced[0].reasons.length > 0);
  assert.ok(balanced.every((b) => b.disclosure.includes('제휴')));
});
