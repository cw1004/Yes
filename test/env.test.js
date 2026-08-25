'use strict';
/** .env 파일 읽기 테스트:  node test/env.test.js */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile } = require('../server/load-env.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
let seq = 0;
function writeEnv(content) {
  const file = path.join(tmpDir, `.env${seq++}`);
  fs.writeFileSync(file, content);
  return file;
}
/** 테스트마다 깨끗한 상태에서 읽는다 */
function loadClean(content, keys) {
  keys.forEach((k) => delete process.env[k]);
  const r = loadEnvFile(writeEnv(content));
  const values = {};
  keys.forEach((k) => { values[k] = process.env[k]; delete process.env[k]; });
  return { result: r, values };
}

test('기본: KEY=값 을 읽어 환경변수로 넣는다', () => {
  const { result, values } = loadClean(
    'ANTHROPIC_API_KEY=sk-ant-abc123\nKIS_ACCOUNT=12345678-01\n',
    ['ANTHROPIC_API_KEY', 'KIS_ACCOUNT']
  );
  assert.deepStrictEqual(result.loaded, ['ANTHROPIC_API_KEY', 'KIS_ACCOUNT']);
  assert.strictEqual(values.ANTHROPIC_API_KEY, 'sk-ant-abc123');
  assert.strictEqual(values.KIS_ACCOUNT, '12345678-01');
});

test('주석과 빈 줄은 무시한다', () => {
  const { result, values } = loadClean(
    '# 이건 주석\n\n   \n#ANTHROPIC_API_KEY=주석처리됨\nKIS_PAPER=1\n',
    ['ANTHROPIC_API_KEY', 'KIS_PAPER']
  );
  assert.deepStrictEqual(result.loaded, ['KIS_PAPER']);
  assert.strictEqual(values.ANTHROPIC_API_KEY, undefined, '주석 처리된 줄은 읽지 않는다');
  assert.strictEqual(values.KIS_PAPER, '1');
});

test('따옴표와 앞뒤 공백을 정리한다', () => {
  const { values } = loadClean(
    'A_KEY = "sk-ant-quoted"   \nB_KEY=\'작은따옴표\'\n',
    ['A_KEY', 'B_KEY']
  );
  assert.strictEqual(values.A_KEY, 'sk-ant-quoted');
  assert.strictEqual(values.B_KEY, '작은따옴표');
});

test('export 접두어가 붙어 있어도 읽는다 (맥에서 복사해 온 경우)', () => {
  const { values } = loadClean('export LLAMA_MODEL=llama3.1\n', ['LLAMA_MODEL']);
  assert.strictEqual(values.LLAMA_MODEL, 'llama3.1');
});

test('값에 = 가 들어 있어도 첫 번째 = 만 구분자로 쓴다', () => {
  const { values } = loadClean('TOKEN_KEY=abc=def==ghi\n', ['TOKEN_KEY']);
  assert.strictEqual(values.TOKEN_KEY, 'abc=def==ghi');
});

test('터미널에 이미 지정된 값이 .env 보다 우선한다', () => {
  process.env.PRIORITY_KEY = '터미널값';
  const r = loadEnvFile(writeEnv('PRIORITY_KEY=파일값\n'));
  assert.strictEqual(process.env.PRIORITY_KEY, '터미널값');
  assert.deepStrictEqual(r.skipped, ['PRIORITY_KEY']);
  assert.deepStrictEqual(r.loaded, []);
  delete process.env.PRIORITY_KEY;
});

test('형식이 깨진 줄이 있어도 나머지를 읽는다', () => {
  const { result, values } = loadClean(
    '이상한줄\n=값만있음\n123INVALID=x\nGOOD_KEY=정상\n',
    ['GOOD_KEY', '123INVALID']
  );
  assert.deepStrictEqual(result.loaded, ['GOOD_KEY'], '유효한 줄만 채택');
  assert.strictEqual(values.GOOD_KEY, '정상');
});

test('.env 파일이 없으면 조용히 넘어간다 (오류 없음)', () => {
  const r = loadEnvFile(path.join(tmpDir, '없는파일.env'));
  assert.deepStrictEqual(r.loaded, []);
  assert.strictEqual(r.path, null);
});

test('.env 는 저장소에 올라가지 않도록 제외되어 있다', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(/^\.env$/m.test(ignore), '.gitignore 에 .env 항목이 있어야 한다');
});

test('.env.example 은 실제 키가 아닌 주석 처리된 예시만 담는다', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const active = example.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.deepStrictEqual(active, [], '예시 파일에는 활성화된 설정 줄이 없어야 한다');
  assert.ok(example.includes('ANTHROPIC_API_KEY'), '필요한 항목은 안내되어야 한다');
  assert.ok(example.includes('KIS_APP_KEY'));
  assert.ok(!/sk-ant-[A-Za-z0-9_-]{20,}/.test(example), '진짜 키처럼 보이는 값이 없어야 한다');
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name + '\n    ' + err.message);
    process.exitCode = 1;
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${passed}/${cases.length} 통과`);
