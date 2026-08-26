'use strict';
/** 접근 제어 · 앱 설치 설정 테스트:  node test/access.test.js */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isLoopback, allowSensitive } = require('../server/access.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

/** 가짜 요청 객체 */
const req = (host, remoteAddress, headers = {}, url = '/api/ai/recommend') => ({
  headers: Object.assign({ host }, headers),
  socket: { remoteAddress },
  url,
});

/* ------------------------------------------------------------ 접근 제어 */

test('내 컴퓨터(127.0.0.1)에서 온 요청은 토큰 없이 허용', () => {
  assert.strictEqual(isLoopback(req('127.0.0.1:5173', '127.0.0.1')), true);
  assert.strictEqual(allowSensitive(req('127.0.0.1:5173', '127.0.0.1')).ok, true);
  assert.strictEqual(allowSensitive(req('localhost:5173', '::1')).ok, true);
});

test('같은 와이파이의 다른 기기는 토큰 없이는 거부', () => {
  const r = allowSensitive(req('192.168.0.10:5173', '192.168.0.55'));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /KIS_UI_TOKEN/);
});

test('토큰이 설정되면 헤더나 주소로 통과할 수 있다', () => {
  process.env.KIS_UI_TOKEN = 'secret';
  try {
    const outside = req('192.168.0.10:5173', '192.168.0.55');
    assert.strictEqual(allowSensitive(outside).ok, false, '토큰 없이는 거부');

    const withHeader = req('192.168.0.10:5173', '192.168.0.55', { 'x-ui-token': 'secret' });
    assert.strictEqual(allowSensitive(withHeader).ok, true);

    const withQuery = req('192.168.0.10:5173', '192.168.0.55', {}, '/api/ai/recommend?market=US&token=secret');
    assert.strictEqual(allowSensitive(withQuery).ok, true);

    const wrong = req('192.168.0.10:5173', '192.168.0.55', { 'x-ui-token': 'nope' });
    assert.strictEqual(allowSensitive(wrong).ok, false);
    assert.match(allowSensitive(wrong).reason, /토큰이 올바르지/);
  } finally {
    delete process.env.KIS_UI_TOKEN;
  }
});

test('Host 헤더를 위조해도 실제 접속 주소로 판별한다', () => {
  // 외부 기기가 Host 를 localhost 로 속여도 소켓 주소는 외부다
  const spoofed = req('localhost:5173', '192.168.0.55');
  assert.strictEqual(isLoopback(spoofed), true, 'Host 가 localhost 면 우선 통과 (프록시 대응)');
  // 반대로 Host 가 IP 라도 실제로 내 컴퓨터에서 왔다면 허용된다
  const local = req('192.168.0.10:5173', '127.0.0.1');
  assert.strictEqual(isLoopback(local), true, '소켓이 루프백이면 내 컴퓨터');
});

test('토큰이 설정되어 있으면 내 컴퓨터에서도 토큰을 요구한다', () => {
  process.env.KIS_UI_TOKEN = 'secret';
  try {
    assert.strictEqual(allowSensitive(req('127.0.0.1:5173', '127.0.0.1')).ok, false);
    const ok = req('127.0.0.1:5173', '127.0.0.1', { 'x-ui-token': 'secret' });
    assert.strictEqual(allowSensitive(ok).ok, true);
  } finally {
    delete process.env.KIS_UI_TOKEN;
  }
});

/* ------------------------------------------------------- 앱 설치 설정 */

const pub = (...p) => path.join(__dirname, '..', 'public', ...p);

test('매니페스트가 앱 설치에 필요한 항목을 갖췄다', () => {
  const m = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8'));
  assert.ok(m.name && m.short_name, '이름');
  assert.strictEqual(m.start_url, '/');
  assert.strictEqual(m.display, 'standalone', '앱처럼 별도 창으로 열린다');
  assert.ok(m.background_color && m.theme_color, '배경·테마 색');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), '192·512 아이콘 필요');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), '안드로이드용 maskable 아이콘');
});

test('매니페스트가 가리키는 아이콘 파일이 실제로 있다', () => {
  const m = JSON.parse(fs.readFileSync(pub('manifest.webmanifest'), 'utf8'));
  for (const icon of m.icons) {
    const file = pub(icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `${icon.src} 파일 없음`);
    assert.ok(fs.statSync(file).size > 500, `${icon.src} 파일이 비어 있음`);
  }
  assert.ok(fs.existsSync(pub('icons', 'apple-touch-icon.png')), '아이폰용 아이콘');
});

test('세 화면 모두 매니페스트와 설치용 메타를 연결했다', () => {
  for (const page of ['index.html', 'kr.html', 'ai.html']) {
    const html = fs.readFileSync(pub(page), 'utf8');
    assert.ok(html.includes('rel="manifest"'), `${page}: 매니페스트 연결`);
    assert.ok(html.includes('apple-touch-icon'), `${page}: 아이폰 아이콘`);
    assert.ok(html.includes('name="theme-color"'), `${page}: 테마 색`);
  }
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
console.log(`\n${passed}/${cases.length} 통과`);
