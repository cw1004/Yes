import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skinlab-acct-')), 'db.json');
process.env.SKINLAB_DB = tmpDb;
process.env.NODE_ENV = 'test';
process.env.SKINLAB_SECRET = 'account-test-secret';
process.env.ADMIN_TOKEN = 'admin-acct';
process.env.SKINLAB_CATALOG = path.join(path.dirname(tmpDb), 'no-live.json');

const { server } = await import('../server/index.js');
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, url, { token, body, headers = {} } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const analysis = {
  totalScore: 70,
  tone: { L: 70, a: 10, b: 20, ita: 44, category: 'light', undertone: 'warm', hex: '#e0b898' },
  zoneBalance: { tZoneShine: 12, uZoneShine: 8 },
  metrics: ['redness', 'oiliness', 'texture', 'hydration'].map((key, i) => ({ key, score: 40 + i * 10, value: 3 })),
};

async function newUserWithHistory() {
  const s = await call('POST', '/api/session');
  const token = s.json.token;
  const a = await call('POST', '/api/analysis', { token, body: { analysis } });
  return { token, userId: s.json.userId, analysisId: a.json.analysisId };
}

test('복구 코드로 다른 기기에서 기록을 이어받는다', async () => {
  const user = await newUserWithHistory();

  const before = await call('GET', '/api/recovery/status', { token: user.token });
  assert.equal(before.json.hasCode, false);

  const made = await call('POST', '/api/recovery/create', { token: user.token });
  assert.equal(made.status, 200);
  assert.match(made.json.code, /^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$/, `코드 형식: ${made.json.code}`);

  const after = await call('GET', '/api/recovery/status', { token: user.token });
  assert.equal(after.json.hasCode, true);

  // 새 기기(토큰 없음)에서 코드로 이어받기
  const redeemed = await call('POST', '/api/recovery/redeem', { body: { code: made.json.code } });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.json.userId, user.userId);

  const history = await call('GET', '/api/history', { token: redeemed.json.token });
  assert.equal(history.status, 200);
  assert.equal(history.json.items.length, 1, '이어받은 토큰으로 기존 기록이 보여야 한다');
  assert.equal(history.json.items[0].id, user.analysisId);
});

test('하이픈·소문자로 입력해도 이어받아진다', async () => {
  const user = await newUserWithHistory();
  const { json } = await call('POST', '/api/recovery/create', { token: user.token });
  const messy = json.code.toLowerCase().replace(/-/g, ' ');
  const r = await call('POST', '/api/recovery/redeem', { body: { code: messy } });
  assert.equal(r.status, 200);
  assert.equal(r.json.userId, user.userId);
});

test('코드를 새로 만들면 이전 코드는 즉시 무효가 된다', async () => {
  const user = await newUserWithHistory();
  const first = (await call('POST', '/api/recovery/create', { token: user.token })).json.code;
  const second = (await call('POST', '/api/recovery/create', { token: user.token })).json.code;
  assert.notEqual(first, second);

  assert.equal((await call('POST', '/api/recovery/redeem', { body: { code: first } })).status, 404,
    '유출됐을 수 있는 옛 코드가 계속 살아 있으면 안 된다');
  assert.equal((await call('POST', '/api/recovery/redeem', { body: { code: second } })).status, 200);
});

test('복구 코드는 서버에 원문으로 저장되지 않는다', async () => {
  const user = await newUserWithHistory();
  const { json } = await call('POST', '/api/recovery/create', { token: user.token });
  const raw = json.code.replace(/-/g, '');
  // 저장 파일 어디에도 코드 원문이 없어야 한다 (DB 가 유출돼도 계정을 열 수 없어야 한다)
  const dump = fs.readFileSync(tmpDb, 'utf8');
  assert.ok(!dump.includes(raw), '코드 원문이 저장돼 있습니다');
  assert.ok(dump.includes('recovery'), '해시 항목 자체는 있어야 한다');
});

test('내 데이터 전체 삭제', async () => {
  const user = await newUserWithHistory();
  await call('POST', '/api/recovery/create', { token: user.token });
  await call('POST', '/api/click', { token: user.token, body: { productId: 'ser-001', merchant: 'coupang', analysisId: user.analysisId } });

  // 확인 문구가 틀리면 지우지 않는다
  const wrong = await call('POST', '/api/me/delete', { token: user.token, body: { confirm: '네' } });
  assert.equal(wrong.status, 400);

  const del = await call('POST', '/api/me/delete', { token: user.token, body: { confirm: '삭제' } });
  assert.equal(del.status, 200);
  assert.equal(del.json.removed.analyses, 1);

  // 지운 뒤에는 그 토큰이 통하지 않는다
  assert.equal((await call('GET', '/api/history', { token: user.token })).status, 401);
  // 리포트도 사라졌다 (자원이 없으니 404, 토큰이 죽었으니 401 — 둘 다 접근 불가)
  assert.ok([401, 404].includes((await call('GET', `/api/report?id=${user.analysisId}`, { token: user.token })).status));

  const dump = JSON.parse(fs.readFileSync(tmpDb, 'utf8'));
  assert.equal(dump.users[user.userId], undefined);
  assert.ok(!Object.values(dump.analyses).some((a) => a.userId === user.userId));
  assert.ok(!Object.values(dump.recovery || {}).some((r) => r.userId === user.userId));
  // 클릭 기록은 남지만 사람과의 연결이 끊겨야 한다 (정산은 되어야 하므로)
  assert.ok(!dump.clicks.some((c) => c.userId === user.userId));
});

test('삭제 뒤에는 그 사람의 복구 코드도 못 쓴다', async () => {
  const user = await newUserWithHistory();
  const { json } = await call('POST', '/api/recovery/create', { token: user.token });
  await call('POST', '/api/me/delete', { token: user.token, body: { confirm: '삭제' } });
  const r = await call('POST', '/api/recovery/redeem', { body: { code: json.code } });
  assert.equal(r.status, 404);
});

test('남의 데이터는 지울 수 없다', async () => {
  assert.equal((await call('POST', '/api/me/delete', { body: { confirm: '삭제' } })).status, 401);
  assert.equal((await call('POST', '/api/recovery/create')).status, 401);
});

// ── 아래 두 테스트는 복구 코드 호출 한도(시간당 8회)를 소모하므로 파일 맨 뒤에 둔다 ──

test('아무 코드나 넣어서 남의 계정을 열 수 없다', async () => {
  for (const bad of ['AAAA-AAA-AAA', '', { a: 1 }]) {
    const r = await call('POST', '/api/recovery/redeem', { body: { code: bad } });
    assert.equal(r.status, 404, `${JSON.stringify(bad)} → ${r.status}`);
  }
});

test('복구 코드 입력은 무차별 대입을 막도록 제한된다', async () => {
  // 10자 코드라도 무제한으로 넣을 수 있으면 언젠가는 뚫린다
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await call('POST', '/api/recovery/redeem', { body: { code: `ZZZZ-ZZZ-ZZ${i}` } });
    if (r.status === 429) limited = true;
  }
  assert.ok(limited, '복구 코드 입력에 횟수 제한이 걸려야 한다');
});
