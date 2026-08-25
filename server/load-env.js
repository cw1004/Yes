'use strict';
/**
 * 프로젝트 폴더의 .env 파일을 읽어 환경변수로 넣어 준다.
 *
 * API 키를 터미널에 매번 입력하는 대신 파일에 한 번만 적어 두기 위한 것이다.
 * (.env 는 .gitignore 에 있어 저장소에 올라가지 않는다)
 *
 * 규칙
 *   - `KEY=값` 형태, 한 줄에 하나
 *   - `#` 로 시작하는 줄과 빈 줄은 무시
 *   - 값 양쪽의 따옴표는 벗겨 낸다
 *   - 터미널에서 이미 지정한 값이 우선한다 (파일이 덮어쓰지 않는다)
 *
 * 이 파일은 다른 모듈보다 먼저 불러야 한다. 여러 모듈이 로드 시점에 process.env 를 읽기 때문이다.
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '..', '.env');

/** @returns {{loaded:string[], skipped:string[], path:string|null}} */
function loadEnvFile(file = ENV_PATH) {
  const result = { loaded: [], skipped: [], path: null };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return result;   // 파일이 없으면 조용히 넘어간다 (선택 사항이므로)
  }
  result.path = file;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    // 값 뒤의 주석은 따옴표로 감싸지 않은 경우에만 제거
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) value = value.slice(1, -1);

    if (process.env[key] !== undefined && process.env[key] !== '') {
      result.skipped.push(key);   // 터미널 값이 이미 있으면 그대로 둔다
      continue;
    }
    process.env[key] = value;
    result.loaded.push(key);
  }
  return result;
}

const summary = loadEnvFile();

// 키 "이름"만 알린다. 값은 절대 출력하지 않는다.
if (summary.loaded.length) {
  console.log(`  🔑 .env 에서 설정을 읽었습니다: ${summary.loaded.join(', ')}`);
}
if (summary.skipped.length) {
  console.log(`  ⓘ 터미널에 이미 지정된 값이 있어 .env 보다 우선합니다: ${summary.skipped.join(', ')}`);
}

module.exports = { loadEnvFile, ENV_PATH, summary };
