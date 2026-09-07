import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 서버 모듈을 불러오기 전에 임시 DB / 시크릿을 잡아둔다
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skinlab-')), 'db.json');
process.env.SKINLAB_DB = tmpDb;
process.env.NODE_ENV = 'test';
process.env.SKINLAB_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'admin-test';
process.env.AFFILIATE_POSTBACK_TOKEN = 'pb-test';
process.env.COUPANG_PARTNER_ID = 'AF1234567';

const { server } = await import('../server/index.js');
const { computeMetrics } = await import('../public/js/engine/metrics.js');
const { faceZones } = await import('../public/js/engine/skinmask.js');
const { fallbackFaceBox } = await import('../public/js/engine/quality.js');

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function fakeFace(w = 200, h = 260) {
  const data = new Uint8ClampedArray(w * h * 4);
  const box = fallbackFaceBox(w, h);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const rx = box.width / 2, ry = box.height / 2;
  const zones = faceZones(box);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inFace = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    let [r, g, b] = inFace ? [224, 182, 152] : [26, 24, 30];
    if (inFace) {
      const n = (rnd() - 0.5) * 16; r += n; g += n; b += n;
      const inT = [zones.forehead, zones.nose].some((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
      if (inT && rnd() < 0.35) { r += 40; g += 40; b += 40; }
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return computeMetrics({ data, width: w, height: h }, box);
}

async function call(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

let token, analysisId;

test('세션 발급 -> 분석 제출 -> 무료 리포트', async () => {
  const s = await call('POST', '/api/session');
  assert.equal(s.status, 200);
  token = s.json.token;
  assert.ok(token);

  const r = await call('POST', '/api/analysis', { token, body: { analysis: fakeFace(), quality: { confidence: 88, issues: [] } } });
  assert.equal(r.status, 200);
  analysisId = r.json.analysisId;
  assert.equal(r.json.locked, true);
  assert.equal(r.json.pro, null, '결제 전에는 pro 본문이 응답에 없어야 한다');
  assert.equal(r.json.analysis.metrics.length, 0, '잠긴 지표는 서버가 아예 내려보내지 않는다');
  assert.equal(r.json.free.preview.length, 3);
  assert.ok(r.json.free.tone.ita);
});

test('다른 사용자는 남의 리포트를 볼 수 없다', async () => {
  const other = await call('POST', '/api/session');
  const r = await call('GET', `/api/report?id=${analysisId}`, { token: other.json.token });
  assert.equal(r.status, 403);
});

test('추천은 톤/고민 기반 랭킹과 판매처 비교를 함께 준다', async () => {
  const r = await call('GET', `/api/recommend?id=${analysisId}`, { token });
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length > 0);
  const top = r.json.items[0];
  assert.ok(top.offers.length >= 1);
  assert.ok(top.offers.some((o) => o.isLowest));
  assert.ok(top.scores.total > 0);
  assert.ok(r.json.disclosure.includes('제휴'));
  assert.ok(r.json.bundle.discounted < r.json.bundle.total);
});

test('결제하면 전체 리포트가 열린다 (쿠폰 할인 포함)', async () => {
  const c = await call('POST', '/api/checkout', { token, body: { planId: 'single', analysisId, couponCode: 'WELCOME30' } });
  assert.equal(c.status, 200);
  assert.equal(c.json.order.amount, 4900 - 1470, '30% 쿠폰이 적용되어야 한다');
  assert.equal(c.json.payment.type, 'mock');

  const done = await call('POST', '/api/checkout/confirm', { token, body: { orderId: c.json.order.orderId, paymentKey: 'mock', amount: c.json.order.amount } });
  assert.equal(done.status, 200);
  assert.equal(done.json.report.locked, false);
  assert.equal(done.json.report.analysis.metrics.length, 9);
  assert.equal(done.json.report.pro.routine.am.length, 5);
  assert.equal(done.json.report.pro.plan.length, 4);
  assert.ok(done.json.report.pro.concerns[0].cause);
});

test('1회 이용권은 결제한 리포트에만 적용된다', async () => {
  const r2 = await call('POST', '/api/analysis', { token, body: { analysis: fakeFace(180, 240) } });
  assert.equal(r2.json.locked, true, '다른 분석은 여전히 잠겨 있어야 한다');
});

let clickId;
test('제휴 클릭은 파트너 파라미터가 붙은 링크와 함께 기록된다', async () => {
  const r = await call('POST', '/api/click', { token, body: { productId: 'ser-001', merchant: 'coupang', analysisId, position: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.partnerLinked, true);
  assert.match(r.json.url, /lptag=AF1234567/);
  assert.match(r.json.url, /subId=clk_/);
  clickId = r.json.clickId;
});

test('전환 포스트백은 토큰이 있어야 수익으로 잡힌다', async () => {
  const bad = await call('POST', '/api/postback', { body: { clickId, revenue: 350 } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/postback', { body: { clickId, revenue: 350, orderAmount: 9900 }, headers: { 'x-postback-token': 'pb-test' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.click.converted, true);
});

test('관리자 지표에 구독 매출과 제휴 매출이 모두 집계된다', async () => {
  const bad = await call('GET', '/api/admin/metrics', { token });
  assert.equal(bad.status, 401);
  const r = await call('GET', '/api/admin/metrics', { headers: { 'x-admin-token': 'admin-test' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.revenue.subscription, 3430);
  assert.equal(r.json.revenue.affiliateConfirmed, 350);
  assert.equal(r.json.revenue.total, 3780);
  assert.equal(r.json.affiliate.conversions, 1);
  assert.ok(r.json.funnel.purchases >= 1);
  assert.ok(r.json.affiliate.byMerchant.coupang.clicks >= 1);
});

test('잘못된 요청은 400/401 로 막힌다', async () => {
  assert.equal((await call('POST', '/api/analysis', { body: { analysis: {} } })).status, 401);
  assert.equal((await call('POST', '/api/analysis', { token, body: { analysis: { tone: {} } } })).status, 400);
  assert.equal((await call('POST', '/api/checkout', { token, body: { planId: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/api/click', { token, body: { productId: 'zzz', merchant: 'coupang' } })).status, 404);
});

test('정적 파일과 헬스체크가 서빙된다', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /SkinLab/);
  const h = await call('GET', '/api/health');
  assert.equal(h.json.ok, true);
});
