#!/usr/bin/env node
/**
 * 카탈로그 동기화 CLI.
 *
 *   node scripts/sync-catalog.mjs --check        키가 유효한지만 확인 (데이터 저장 안 함)
 *   node scripts/sync-catalog.mjs --dry          전 과정을 돌리되 저장하지 않음
 *   node scripts/sync-catalog.mjs                실제 동기화
 *   node scripts/sync-catalog.mjs --only=naver   특정 판매처만
 *   node scripts/sync-catalog.mjs --status       지금 서버가 무엇을 쓰고 있는지
 */
import { sync, checkKeys, loadCatalog, ADAPTERS, LIVE_PATH } from '../server/feeds/index.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1]?.split(',').filter(Boolean);

const line = () => console.log('─'.repeat(58));

if (has('--status')) {
  const { catalog, source, reason, ageHours } = loadCatalog();
  line();
  console.log('현재 카탈로그');
  line();
  console.log(`  출처   : ${source === 'seed' ? '샘플 데이터 (data/products.json)' : `실데이터 (${LIVE_PATH})`}`);
  if (ageHours !== undefined) console.log(`  나이   : ${ageHours}시간 전 동기화`);
  if (reason) console.log(`  참고   : ${reason}`);
  console.log(`  상품수 : ${catalog?.products?.length ?? 0}개`);
  const configured = Object.entries(ADAPTERS).filter(([, a]) => a.isConfigured()).map(([k]) => k);
  console.log(`  연결됨 : ${configured.length ? configured.join(', ') : '없음 — .env 에 키를 넣으세요'}`);
  process.exit(0);
}

if (has('--check')) {
  line();
  console.log('판매처 키 확인');
  line();
  const result = await checkKeys();
  const bad = Object.values(result).filter((r) => r.configured && !r.ok).length;
  const none = Object.values(result).filter((r) => !r.configured).length;
  line();
  console.log(`연결 ${Object.values(result).filter((r) => r.ok).length}곳 · 실패 ${bad}곳 · 미설정 ${none}곳`);
  if (none) console.log('키를 넣는 방법은 docs/파트너-API-연동.md 를 보세요.');
  process.exit(bad ? 1 : 0);
}

line();
console.log(has('--dry') ? '동기화 (연습 — 저장하지 않음)' : '동기화');
line();
const result = await sync({ dryRun: has('--dry'), only, log: console.log });
line();
if (!result.ok) {
  console.error(`실패: ${result.error}`);
  for (const p of result.problems || []) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`${result.dryRun ? '연습 완료' : '저장 완료'} — 상품 ${result.products}개`);
if (!result.dryRun) console.log(`  ${result.path}`);
console.log('\n서버를 다시 시작하면 새 카탈로그가 반영됩니다.');
