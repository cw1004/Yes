import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsult, DOCTOR } from '../public/js/engine/consult.js';
import { sanitizeIntake, INTAKE } from '../public/js/engine/intake.js';
import { diagnose } from '../public/js/engine/diagnose.js';
import { computeMetrics } from '../public/js/engine/metrics.js';
import { fallbackFaceBox } from '../public/js/engine/quality.js';
import { faceZones } from '../public/js/engine/skinmask.js';
import { narrate } from '../server/doctor.js';

function face({ w = 200, h = 260, noise = 6, shine = 0, darkEye = 0, spots = 0 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const box = fallbackFaceBox(w, h);
  const zones = faceZones(box);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rx = box.width / 2, ry = box.height / 2;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const inRect = (x, y, z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inFace = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    let [r, g, b] = inFace ? [224, 182, 152] : [26, 24, 30];
    if (inFace) {
      const n = (rnd() - 0.5) * noise; r += n; g += n; b += n;
      if (shine && [zones.forehead, zones.nose].some((z) => inRect(x, y, z)) && rnd() < shine) { r += 46; g += 46; b += 46; }
      if (spots && rnd() < spots) { r -= 34; g -= 30; b -= 22; }
      if (darkEye && [zones.underEyeLeft, zones.underEyeRight].some((z) => inRect(x, y, z))) { r -= darkEye; g -= darkEye * .9; b -= darkEye * .7; }
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  const analysis = computeMetrics({ data, width: w, height: h }, box);
  return { analysis, diagnosis: diagnose(analysis) };
}

const FULL_INTAKE = { ageBand: '30s', selfType: 'dry', mainWorry: 'dryness', routine: 'basic', sleep: 'lt5', reaction: 'sometimes' };

test('문진 답변은 정의된 선택지만 통과한다', () => {
  const clean = sanitizeIntake({ ageBand: '30s', selfType: '<script>alert(1)</script>', bogus: 'x', sleep: 'lt5' });
  assert.deepEqual(clean, { ageBand: '30s', sleep: 'lt5' });
  assert.equal(INTAKE.length, 6);
});

test('상담은 무료 구간과 유료 구간으로 갈린다', () => {
  const { analysis, diagnosis } = face({ noise: 26, shine: 0.4, darkEye: 34 });
  const c = buildConsult(analysis, diagnosis, FULL_INTAKE);
  assert.equal(c.doctor.name, DOCTOR.name);
  assert.ok(c.free.script.length >= 3);
  assert.ok(c.script.length > c.free.script.length);
  assert.equal(c.free.lockedTurns, c.script.length - c.free.script.length);
  assert.ok(c.free.script.every((t) => t.tier === 'free'));

  // 처방(plan)과 재진(followup)은 결제 전에 나오면 안 된다
  const freeStages = new Set(c.free.script.map((t) => t.stage));
  assert.ok(!freeStages.has('plan'));
  assert.ok(!freeStages.has('followup'));
  assert.ok(c.script.some((t) => t.stage === 'plan'));
});

test('자각과 측정이 다르면 상담 초반에 짚어준다', () => {
  const { analysis, diagnosis } = face({ noise: 8, shine: 0.6 }); // 번들거리는 피부
  const c = buildConsult(analysis, diagnosis, { ...FULL_INTAKE, selfType: 'dry' });
  assert.ok(c.discordance.length >= 1, '건성 자각 + 지성/복합성 측정이면 불일치가 잡혀야 한다');
  const d = c.discordance[0];
  assert.match(d.text, /건성/);
  // 불일치는 무료 구간에 넣어 결제 동기를 만든다
  assert.ok(c.free.script.some((t) => t.stage === 'discordance'));
});

test('점수가 좋은 항목을 고민으로 말하지 않는다', () => {
  const { analysis, diagnosis } = face({ noise: 2 }); // 아주 깨끗한 합성 얼굴
  const c = buildConsult(analysis, diagnosis, FULL_INTAKE);
  const findings = c.script.filter((t) => t.stage === 'finding' && t.score !== undefined);
  for (const f of findings) {
    if (f.score >= 70) {
      assert.doesNotMatch(f.text, /집중 관리|주의 구간/, `${f.score}점을 문제처럼 말하면 안 된다: ${f.text}`);
    }
  }
  // 모든 항목이 양호하면 "손댈 게 없다"고 말해야 한다
  const worstScore = diagnosis.concerns[0].score;
  if (worstScore >= 70) {
    assert.ok(c.script.some((t) => /손댈 항목이 없습니다|유지 대상/.test(t.text)));
  }
});

test('연령·수면·반응 이력이 상담 내용을 바꾼다', () => {
  const { analysis, diagnosis } = face({ noise: 24, darkEye: 30 });
  const young = buildConsult(analysis, diagnosis, { ...FULL_INTAKE, ageBand: 'teens', sleep: 'gte7', reaction: 'never' });
  const older = buildConsult(analysis, diagnosis, { ...FULL_INTAKE, ageBand: '50s', sleep: 'lt5', reaction: 'often' });
  assert.notEqual(JSON.stringify(young.script), JSON.stringify(older.script));
  assert.ok(older.script.some((t) => t.stage === 'caution' && /테스트/.test(t.text)), '반응 이력이 잦으면 패치 테스트를 안내해야 한다');
  assert.ok(older.script.some((t) => /수면이 5시간 미만/.test(t.text)));
});

test('상담문에 의료 표현을 쓰지 않는다', () => {
  const { analysis, diagnosis } = face({ noise: 24, shine: 0.4, spots: 0.1, darkEye: 30 });
  const c = buildConsult(analysis, diagnosis, FULL_INTAKE);
  const all = c.script.map((t) => t.text).join(' ');
  for (const banned of ['진단합니다', '처방전', '치료합니다', '완치']) {
    assert.ok(!all.includes(banned), `금지 표현 포함: ${banned}`);
  }
  assert.match(c.doctor.disclaimerShort, /의료 행위가 아닙니다/);
});

test('재진 예정일은 4주 뒤로 잡힌다', () => {
  const { analysis, diagnosis } = face({ noise: 20 });
  const c = buildConsult(analysis, diagnosis, FULL_INTAKE);
  const days = Math.round((new Date(c.followUpAt) - Date.now()) / 864e5);
  assert.equal(days, 28);
});

test('API 키가 없으면 규칙 엔진 대본을 그대로 쓴다', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { analysis, diagnosis } = face({ noise: 20 });
  const r = await narrate(analysis, diagnosis, FULL_INTAKE, { tier: 'pro' });
  assert.equal(r.narrated, false);
  assert.equal(r.reason, 'no_api_key');
  assert.ok(r.consult.script.length > 0);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});
