// One-shot bundle build from the command line.
//
//   node server/cli.mjs                      fixture catalogue
//   node server/cli.mjs my-candidates.json   your own
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, hasAnthropicKey, ASSUMPTIONS } from './config.mjs';
import { buildBundle } from './index.mjs';

const file = process.argv[2] ?? resolve(ROOT, 'server/fixtures/catalog.json');
const candidates = JSON.parse(readFileSync(file, 'utf8'));
const won = n => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const b = await buildBundle(candidates);

console.log(`\n  세트  ${b.landingTitle}   (${b.source})`);
console.log(`  컨셉  ${b.concept}`);
console.log(`  후크  "${b.hook}"`);
console.log(`  적합도 ${(b.contentFit * 100).toFixed(0)}%  — ${b.fitReason}\n`);

console.log('  슬롯  역할     제품                              가격        건당수수료  클릭배분  EPC');
console.log('  ' + '─'.repeat(94));
for (const s of b.slots) {
  console.log(
    `  ${String(s.slot + 1).padStart(2)}    ${s.role.padEnd(7)} ${s.title.slice(0, 26).padEnd(28)}` +
      `${won(s.price).padStart(10)}  ${won(s.perSale).padStart(9)}  ${(s.clickShare * 100).toFixed(0).padStart(6)}%  ${won(s.epc).padStart(7)}`,
  );
}
console.log('  ' + '─'.repeat(94));
console.log(`\n  영상 클릭 1회당 기대수익  ${won(b.epcPerVideoClick)}`);
for (const clicks of [1000, 10000, 50000]) {
  console.log(`    클릭 ${clicks.toLocaleString('ko-KR')}회 → ${won(b.epcPerVideoClick * clicks)}`);
}
console.log(`\n  가격 사다리  진입 ${won(b.ladder.entry)} · 기준 ${won(b.ladder.anchor)} · 폭 ${b.ladder.spread.toFixed(1)}배  ${b.ladder.ok ? '적정' : ''}`);
b.ladder.problems.forEach(p => console.log(`    ! ${p}`));
console.log(`  어트리뷰션 창  ${b.attributionHours}시간 — 이 창 안의 다른 구매도 실적에 잡힙니다 (약관 확인 필요)`);
b.warnings.forEach(w => console.log(`    ! ${w}`));
if (!hasAnthropicKey()) console.log('    ! ANTHROPIC_API_KEY 없음 — 세트 구성은 휴리스틱, 수익 계산은 동일');
console.log(`\n  링크 페이지  ${b.landing}`);
b.slots.forEach(s => console.log(`    ${String(s.slot + 1).padStart(2)}  ${s.go}`));
console.log();
