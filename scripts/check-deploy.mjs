#!/usr/bin/env node
/**
 * 배포 전 점검.
 *
 * 처음 배포하는 사람이 가장 많이 겪는 사고는 '설정을 깜빡한 채 올리는 것'이다.
 * 서버는 운영 모드에서 위험한 기본값이면 기동을 거부하지만, 그건 이미 올린 뒤다.
 * 올리기 전에 무엇이 비었는지, 그래서 무슨 일이 생기는지 미리 알려준다.
 *
 *   npm run check:deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// .env 를 읽어 준다 (배포 플랫폼에서는 대시보드에 넣지만, 로컬 점검용)
const envPath = path.join(ROOT, '.env');
const env = { ...process.env };
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const rows = [];
const ok = (what, detail) => rows.push({ level: 'ok', what, detail });
const warn = (what, detail, todo) => rows.push({ level: 'warn', what, detail, todo });
const bad = (what, detail, todo) => rows.push({ level: 'bad', what, detail, todo });

/* ── 1. 실행 환경 ── */
const major = Number(process.versions.node.split('.')[0]);
major >= 20
  ? ok('Node 버전', `v${process.versions.node}`)
  : bad('Node 버전', `v${process.versions.node}`, 'Node 20 이상이 필요합니다 (nodejs.org 에서 LTS 설치)');

/* ── 2. 비밀값 ── */
const secret = env.SKINLAB_SECRET || '';
if (!secret) bad('서명 키 (SKINLAB_SECRET)', '없음', '길고 무작위인 값을 넣으세요. 없으면 이용권 토큰을 누구나 위조할 수 있습니다.');
else if (secret.length < 24) warn('서명 키 (SKINLAB_SECRET)', `${secret.length}자로 짧음`, '32자 이상을 권합니다: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
else ok('서명 키 (SKINLAB_SECRET)', `${secret.length}자`);

env.ADMIN_TOKEN
  ? ok('관리자 비밀번호 (ADMIN_TOKEN)', '설정됨')
  : bad('관리자 비밀번호 (ADMIN_TOKEN)', '없음', '없으면 /admin.html 매출 지표가 열립니다.');

/* ── 3. 결제 ── */
const pay = env.SKINLAB_PAYMENTS || 'mock';
if (pay === 'mock') {
  bad('결제 방식', 'mock (데모용)',
    '결제를 받으려면 toss/stripe, 결제 없이 무료로 공개하려면 none 으로 설정하세요.\n     운영 모드에서 mock 이면 서버가 기동을 거부합니다.');
} else if (pay === 'none') {
  ok('결제 방식', 'none — 리포트를 무료로 공개하고 제휴 수익만 받습니다');
} else if (pay === 'toss') {
  (env.TOSS_CLIENT_KEY && env.TOSS_SECRET_KEY)
    ? ok('결제 방식', 'toss (키 설정됨)')
    : bad('결제 방식', 'toss 인데 키가 없음', 'TOSS_CLIENT_KEY / TOSS_SECRET_KEY 를 넣으세요. 토스 계약에는 사업자등록이 필요합니다.');
} else if (pay === 'stripe') {
  env.STRIPE_SECRET_KEY ? ok('결제 방식', 'stripe (키 설정됨)') : bad('결제 방식', 'stripe 인데 키가 없음', 'STRIPE_SECRET_KEY 를 넣으세요.');
} else {
  bad('결제 방식', `알 수 없는 값 '${pay}'`, 'mock / none / toss / stripe 중 하나여야 합니다.');
}

/* ── 4. 데이터 저장 위치 ── */
const dbPath = env.SKINLAB_DB || path.join(ROOT, 'data', 'db.json');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  warn('데이터 저장 위치', `${dbDir} (아직 없음)`, '서버가 처음 뜰 때 만듭니다. 배포 시 이 경로에 디스크를 붙였는지 확인하세요.');
} else {
  try {
    fs.accessSync(dbDir, fs.constants.W_OK);
    ok('데이터 저장 위치', dbPath);
  } catch {
    bad('데이터 저장 위치', `${dbDir} 에 쓸 수 없음`, '권한을 확인하세요.');
  }
}
if (!env.SKINLAB_DB) {
  warn('디스크 설정', '기본 경로(프로젝트 안)를 씁니다',
    '배포 플랫폼에서는 재배포할 때 프로젝트 폴더가 초기화됩니다.\n     디스크를 /data 에 붙이고 SKINLAB_DB=/data/db.json 으로 지정하세요. 안 하면 회원 기록이 매번 사라집니다.');
}

/* ── 5. 상품 데이터 ── */
const livePath = env.SKINLAB_CATALOG || path.join(ROOT, 'data', 'catalog.live.json');
if (fs.existsSync(livePath)) {
  const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  const ageH = (Date.now() - new Date(live._meta?.syncedAt || 0)) / 36e5;
  ageH < 48
    ? ok('상품 데이터', `실데이터 ${live.products.length}개 (${Math.round(ageH)}시간 전 동기화)`)
    : warn('상품 데이터', `${Math.round(ageH)}시간 전 동기화`, '동기화가 멈춘 것은 아닌지 확인하세요. 오래된 가격은 환불 사유가 됩니다.');
} else {
  warn('상품 데이터', '샘플 카탈로그', 'docs/파트너-API-연동.md 를 따라 실데이터로 바꾸세요. 가격이 실제와 다르면 신뢰를 잃습니다.');
}

/* ── 6. 제휴 수익 ── */
const partners = { COUPANG_PARTNER_ID: '쿠팡', NAVER_PARTNER_ID: '네이버', OLIVEYOUNG_PARTNER_ID: '올리브영', ELEVEN_PARTNER_ID: '11번가', AMAZON_ASSOC_TAG: 'Amazon' };
const linked = Object.entries(partners).filter(([k]) => env[k]).map(([, v]) => v);
linked.length
  ? ok('제휴 추적 ID', linked.join(', '))
  : warn('제휴 추적 ID', '하나도 없음', '없으면 구매 링크가 그냥 검색 결과로 나가고 수수료가 잡히지 않습니다. 즉 수익이 0입니다.');

/* ── 7. 약관·개인정보처리방침 ── */
const legalPath = path.join(ROOT, 'public', 'legal.html');
if (!fs.existsSync(legalPath)) {
  bad('약관·처리방침', '파일 없음', 'public/legal.html 이 있어야 합니다.');
} else {
  const legal = fs.readFileSync(legalPath, 'utf8');
  const blanks = [...legal.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
  blanks.length
    ? bad('약관·처리방침', `채워야 할 칸 ${blanks.length}개`,
        `public/legal.html 에서 [[…]] 를 실제 정보로 바꾸세요: ${[...new Set(blanks)].slice(0, 5).join(', ')}\n     연락처 없이 공개하면 개인정보 열람·삭제 요청을 받을 방법이 없습니다.`)
    : ok('약관·처리방침', '작성 완료');
}

/* ── 8. 백업 ── */
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((f) => f.startsWith('db-'))
  ? ok('백업', `${backupDir}`)
  : warn('백업', '아직 없음', 'npm run backup 을 하루 한 번 돌게 예약하세요. 회원 기록은 파일 하나뿐이라 잃으면 끝입니다.');

/* ── 9. 비밀이 저장소에 올라갔는지 ── */
try {
  const tracked = execSync('git ls-files .env', { cwd: ROOT, encoding: 'utf8' }).trim();
  tracked
    ? bad('.env 관리', '저장소에 올라가 있습니다', 'git rm --cached .env 로 즉시 제외하고, 이미 올라간 키는 모두 재발급하세요.')
    : ok('.env 관리', '저장소에 포함되지 않음');
} catch { /* git 저장소가 아니면 넘어간다 */ }

/* ── 출력 ── */
const MARK = { ok: '✓', warn: '△', bad: '✗' };
console.log('\n배포 전 점검');
console.log('─'.repeat(64));
for (const r of rows) {
  console.log(`${MARK[r.level]} ${r.what.padEnd(26)} ${r.detail}`);
  if (r.todo) console.log(`     → ${r.todo}`);
}
const bads = rows.filter((r) => r.level === 'bad').length;
const warns = rows.filter((r) => r.level === 'warn').length;
console.log('─'.repeat(64));
if (bads) {
  console.log(`✗ 먼저 고쳐야 할 것 ${bads}개 (이 상태로는 운영 모드에서 서버가 뜨지 않거나 위험합니다)`);
} else if (warns) {
  console.log(`△ 배포는 가능하지만 확인할 것 ${warns}개`);
} else {
  console.log('✓ 배포 준비가 끝났습니다.');
}
console.log('자세한 절차: docs/홈페이지-띄우기.md\n');
process.exit(bads ? 1 : 0);
