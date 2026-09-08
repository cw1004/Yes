import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skinlab-sec-')), 'db.json');
process.env.SKINLAB_DB = tmpDb;
process.env.NODE_ENV = 'test';
process.env.SKINLAB_SECRET = 'security-test-secret';
process.env.ADMIN_TOKEN = 'admin-secret-token';
process.env.AFFILIATE_POSTBACK_TOKEN = 'postback-secret';
process.env.SKINLAB_CATALOG = path.join(path.dirname(tmpDb), 'no-live.json');

const { server } = await import('../server/index.js');
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const raw = (p, opts = {}) => fetch(base + p, opts);
const call = async (method, url, { token, body, headers = {} } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const goodAnalysis = {
  totalScore: 70,
  tone: { L: 70, a: 10, b: 20, ita: 44, category: 'light', undertone: 'warm', hex: '#e0b898' },
  zoneBalance: { tZoneShine: 12, uZoneShine: 8, delta: 4 },
  metrics: ['redness', 'oiliness', 'texture', 'hydration'].map((key, i) => ({ key, score: 40 + i * 10, value: 5 })),
};

test('잘못된 URL 인코딩으로 서버가 죽지 않는다', async () => {
  // '/%' 한 번으로 프로세스가 통째로 종료된 적이 있다 — 인증 없는 서비스 중단
  for (const bad of ['/%', '/%zz', '/%E0%A4%A', '/..%2f..%2fetc/passwd']) {
    const res = await raw(bad);
    assert.ok([400, 403, 404].includes(res.status), `${bad} → ${res.status}`);
  }
  const alive = await raw('/api/health');
  assert.equal(alive.status, 200, '악성 요청 뒤에도 서버는 살아 있어야 한다');
});

test('정적 파일 경로를 벗어날 수 없다', async () => {
  const attempts = [
    '/../server/payments.js',
    '/../../etc/passwd',
    '/..%2Fserver%2Fpayments.js',
    '/./../../package.json',
    '/%2e%2e/%2e%2e/package.json',
  ];
  for (const a of attempts) {
    const res = await raw(a);
    const text = await res.text();
    assert.ok(!/STRIPE_SECRET_KEY|grantEntitlement|"dependencies"/.test(text), `${a} 로 파일이 새어나감`);
  }
  // 정상 파일은 계속 서빙된다
  assert.equal((await raw('/styles.css')).status, 200);
});

test('클라이언트가 보낸 분석값을 그대로 믿지 않는다', async () => {
  const { json: session } = await call('POST', '/api/session');
  const token = session.token;

  const hostile = {
    totalScore: 100000,
    tone: { L: 'x', ita: 'NaN', category: '<img src=x onerror=alert(1)>', undertone: 'evil', hex: 'red;background:url(x)' },
    zoneBalance: { tZoneShine: 9e9 },
    metrics: [
      { key: 'redness', label: '<script>alert(1)</script>', score: 9999, value: 'zz' },
      { key: '__proto__', label: 'poison', score: 50 },
      { key: 'constructor', label: 'poison', score: 50 },
      { key: 'redness', label: '중복', score: 1 },
      { key: 'oiliness', score: -50, tZone: 'abc' },
      { key: 'texture', score: 40, value: 3 },
    ],
  };
  const r = await call('POST', '/api/analysis', { token, body: { analysis: hostile } });
  assert.equal(r.status, 200);

  // 결제해서 전체 지표를 받아온 뒤 확인한다
  const c = await call('POST', '/api/checkout', { token, body: { planId: 'single', analysisId: r.json.analysisId } });
  const done = await call('POST', '/api/checkout/confirm', { token, body: { orderId: c.json.order.orderId, paymentKey: 'm', amount: c.json.order.amount } });
  const metrics = done.json.report.analysis.metrics;

  assert.deepEqual(metrics.map((m) => m.key).sort(), ['oiliness', 'redness', 'texture'], '모르는 키와 중복은 버려야 한다');
  assert.ok(!metrics.some((m) => /<|script/.test(m.label)), '이름표는 서버 정본으로 교체돼야 한다');
  assert.equal(metrics.find((m) => m.key === 'redness').label, '홍조·민감도');
  assert.ok(metrics.every((m) => m.score >= 0 && m.score <= 100), '점수는 0~100 으로 잘려야 한다');
  assert.ok(done.json.report.analysis.totalScore <= 100);
  assert.match(done.json.report.analysis.tone.hex, /^#[0-9a-f]{6}$/i, '색상은 형식 검사를 통과해야 한다');
  assert.equal(done.json.report.analysis.tone.undertone, 'neutral', '모르는 언더톤은 기본값으로');
  assert.ok(!/<img|onerror/.test(JSON.stringify(done.json.report.analysis.tone)));
  // 프로토타입이 오염되지 않았는지
  assert.equal({}.poison, undefined);
});

test('지표가 부족하거나 형태가 아니면 거부한다', async () => {
  const { json: s } = await call('POST', '/api/session');
  assert.equal((await call('POST', '/api/analysis', { token: s.token, body: { analysis: null } })).status, 400);
  assert.equal((await call('POST', '/api/analysis', { token: s.token, body: { analysis: { metrics: [{ key: 'redness', score: 1 }] } } })).status, 400);
  assert.equal((await call('POST', '/api/analysis', { token: s.token, body: { analysis: { metrics: 'not-an-array' } } })).status, 400);
});

test('위조한 토큰으로는 접근할 수 없다', async () => {
  const forged = Buffer.from(JSON.stringify({ sub: 'u_someone', exp: Date.now() + 1e6 })).toString('base64url') + '.fakesignature';
  assert.equal((await call('GET', '/api/history', { token: forged })).status, 401);
  assert.equal((await call('GET', '/api/history', { token: 'garbage' })).status, 401);
  assert.equal((await call('GET', '/api/history', { token: '' })).status, 401);
});

test('관리자·포스트백 토큰은 정확히 일치해야 한다', async () => {
  assert.equal((await call('GET', '/api/admin/metrics')).status, 401);
  assert.equal((await call('GET', '/api/admin/metrics', { headers: { 'x-admin-token': 'admin-secret-toke' } })).status, 401, '접두사만 맞아도 통과하면 안 된다');
  assert.equal((await call('GET', '/api/admin/metrics', { headers: { 'x-admin-token': 'admin-secret-tokenX' } })).status, 401);
  assert.equal((await call('GET', '/api/admin/metrics', { headers: { 'x-admin-token': 'admin-secret-token' } })).status, 200);

  assert.equal((await call('POST', '/api/postback', { body: { clickId: 'x' } })).status, 401);
  assert.equal((await call('POST', '/api/postback', { body: { clickId: 'x' }, headers: { 'x-postback-token': 'wrong' } })).status, 401);
});

test('CORS 는 기본적으로 열려 있지 않다', async () => {
  const res = await raw('/api/config', { method: 'OPTIONS' });
  assert.equal(res.headers.get('access-control-allow-origin'), null, '기본값이 * 이면 다른 사이트가 API 를 부를 수 있다');
});

test('과도한 호출은 429 로 막힌다', async () => {
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const r = await call('POST', '/api/session');
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, '세션 발급이 무제한이면 DB 를 무한히 부풀릴 수 있다');
  assert.match(limited.json.error, /요청이 너무 잦습니다/);
});

test('큰 본문은 413 으로 끊는다', async () => {
  const { json: s } = await call('POST', '/api/session');
  const res = await fetch(`${base}/api/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token || 'x'}` },
    body: JSON.stringify({ analysis: { metrics: [], padding: 'A'.repeat(600 * 1024) } }),
  }).catch(() => ({ status: 413 }));
  assert.ok([413, 400, 401, 429].includes(res.status), `상태 ${res.status}`);
});
