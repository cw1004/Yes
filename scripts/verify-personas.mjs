#!/usr/bin/env node
/**
 * 체험용 샘플 얼굴이 '보여주기로 한 것'을 실제로 보여주는지 검증한다.
 *
 * 샘플을 손보다 보면 조용히 어긋난다 — '지성' 샘플인데 유분이 90점으로 나오는 식으로.
 * 그러면 체험이 앱을 잘못 소개하게 되므로, 페르소나가 선언한 기대(expectConcern 등)를
 * 실제 측정으로 확인한다.
 *
 *   npm run sim:verify
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadPlaywright, startServer } from './lib/preflight.mjs';

const { chromium } = await loadPlaywright();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.SIM_PORT || 8961);
const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skinlab-persona-')), 'db.json');

const { stop } = await startServer(spawn, { cwd: ROOT, port: PORT, db });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const { PERSONAS } = await import('/js/sim/personas.js');
  const { faceImageData, improved } = await import('/js/sim/faces.js');
  const { computeMetrics } = await import('/js/engine/metrics.js');
  const { diagnose } = await import('/js/engine/diagnose.js');
  const { buildConsult } = await import('/js/engine/consult.js');
  const { fallbackFaceBox } = await import('/js/engine/quality.js');

  const measure = (spec) => {
    const img = faceImageData(spec);
    const a = computeMetrics(img, fallbackFaceBox(img.width, img.height));
    return { analysis: a, diagnosis: diagnose(a) };
  };
  return PERSONAS.map((p) => {
    const before = measure(p.face);
    const after = measure(improved(p.face));
    const consult = buildConsult(before.analysis, before.diagnosis, p.intake);
    return {
      id: p.id, title: p.title,
      expectConcern: p.expectConcern || null,
      expectDiscordance: Boolean(p.expectDiscordance),
      expectTone: p.expectTone || null,
      topConcern: before.diagnosis.concerns[0].key,
      topLabel: before.diagnosis.concerns[0].label,
      topScore: before.diagnosis.concerns[0].score,
      skinType: before.diagnosis.skinType.label,
      ita: before.analysis.tone.ita,
      beforeTotal: before.analysis.totalScore,
      afterTotal: after.analysis.totalScore,
      discordance: consult.discordance.length,
    };
  });
});

await browser.close();
stop();

const problems = [];
console.log('\n체험 샘플 검증');
console.log('─'.repeat(72));
for (const r of results) {
  const gain = r.afterTotal - r.beforeTotal;
  const checks = [];
  if (r.expectConcern) {
    const ok = r.topConcern === r.expectConcern;
    checks.push([ok, `1순위 고민 = ${r.expectConcern}`, `실제 ${r.topConcern}(${r.topLabel} ${r.topScore}점)`]);
    if (!ok) problems.push(`${r.id}: 1순위가 ${r.expectConcern} 가 아니라 ${r.topConcern}`);
  }
  if (r.expectDiscordance) {
    const ok = r.discordance >= 1;
    checks.push([ok, '자각·측정 불일치 지적', `${r.discordance}건`]);
    if (!ok) problems.push(`${r.id}: 불일치 지적이 나오지 않음`);
  }
  if (r.expectTone?.itaBelow !== undefined) {
    const ok = r.ita < r.expectTone.itaBelow;
    checks.push([ok, `ITA < ${r.expectTone.itaBelow}`, `${r.ita}°`]);
    if (!ok) problems.push(`${r.id}: ITA ${r.ita} 가 기대 범위 밖`);
  }
  const gainOk = gain >= 8;
  checks.push([gainOk, '4주 뒤 개선이 눈에 보임(+8점 이상)', `${r.beforeTotal} → ${r.afterTotal} (+${gain})`]);
  if (!gainOk) problems.push(`${r.id}: 개선 폭 +${gain} 로 전후 비교가 밋밋함`);

  console.log(`\n${checks.every((c) => c[0]) ? '✓' : '✗'} ${r.title}  [${r.skinType}]`);
  for (const [ok, what, detail] of checks) console.log(`   ${ok ? '✓' : '✗'} ${what.padEnd(30)} ${detail}`);
}
console.log('\n' + '─'.repeat(72));
console.log(problems.length ? `문제 ${problems.length}건:\n  ` + problems.join('\n  ') : `페르소나 ${results.length}종 모두 기대대로 동작합니다.`);
process.exit(problems.length ? 1 : 0);
