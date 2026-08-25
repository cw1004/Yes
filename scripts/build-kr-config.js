#!/usr/bin/env node
'use strict';
/**
 * server/kr/config.js → public/js/kr-config.js 생성.
 * 한국 시장 상수(호가단위·비용·장 시간)를 서버와 브라우저가 한 벌만 쓰도록 만든다.
 *   node scripts/build-kr-config.js         # 생성
 *   node scripts/build-kr-config.js --check # 최신인지 확인만 (테스트용)
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'kr', 'config.js');
const OUT = path.join(__dirname, '..', 'public', 'js', 'kr-config.js');

function build() {
  const src = fs.readFileSync(SRC, 'utf8');
  const body = src
    .replace(/^'use strict';\n/, '')
    .replace(/module\.exports = \{[\s\S]*\};\s*$/, '');
  return `/**
 * 브라우저용 KR 설정 — server/kr/config.js 에서 생성된 파일입니다.
 * 직접 고치지 말고 server/kr/config.js 를 수정한 뒤 \`npm run build:krconfig\` 을 실행하세요.
 */
(function (root) {
  'use strict';
${body}
  root.KRConfig = {
    REAL, PAPER, TR, PATH, ORD_DVSN,
    tickSize, alignPrice, tickDistance,
    COST, roundTripCost, breakevenTicks,
    SESSION, LIMIT_PCT, STATIC_VI_PCT, marketPhase, TIMEFRAMES,
  };
})(window);
`;
}

const next = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== next) {
    console.error('✗ public/js/kr-config.js 가 최신이 아닙니다. `npm run build:krconfig` 를 실행하세요.');
    process.exit(1);
  }
  console.log('✓ kr-config.js 최신 상태');
} else {
  fs.writeFileSync(OUT, next);
  console.log('✓ public/js/kr-config.js 생성됨');
}
