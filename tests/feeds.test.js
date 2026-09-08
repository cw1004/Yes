import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCsv, loadAll } from '../server/feeds/manual.js';
import { normalizeProduct, mergeByProduct, mergeCurated, validateCatalog } from '../server/feeds/normalize.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skinlab-feeds-'));

test('CSV 파서는 따옴표 안의 쉼표를 지킨다', () => {
  const rows = parseCsv('brand,name,price\n닥터지,"레드 블레미쉬, 수딩 세럼",25900\n아누아,어성초 토너,19900\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '레드 블레미쉬, 수딩 세럼');
  assert.equal(rows[1].price, '19900');
});

test('CSV 로더는 파일명을 판매처 코드로 쓰고 잘못된 행을 버린다', () => {
  const dir = path.join(tmp, 'manual');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'oliveyoung.csv'),
    'brand,name,category,price,stock\n' +
    '아누아,어성초 토너,toner,19900,true\n' +
    '빈상품,,toner,10000,true\n' +      // 이름 없음 → 버림
    '가격없음,토너,toner,0,true\n');    // 가격 0 → 버림
  const loaded = loadAll(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].merchant, 'oliveyoung');
  assert.equal(loaded[0].items.length, 1);
  assert.equal(loaded[0].items[0].name, '어성초 토너');
});

test('정규화는 상품명 앞의 브랜드 중복을 떼어낸다', () => {
  const p = normalizeProduct(
    { name: '아누아 어성초 77% 수딩 토너', brand: '아누아', price: 19900, url: 'https://x' },
    { merchant: 'naver', commissionRate: 0.025, shippingDays: 2, category: 'toner' });
  assert.equal(p.brand, '아누아');
  assert.equal(p.name, '어성초 77% 수딩 토너');
  assert.equal(p.offers[0].merchant, 'naver');
  assert.equal(p.offers[0].commissionRate, 0.025);
  assert.equal(p.category, 'toner');
});

test('브랜드가 없으면 대괄호나 첫 단어에서 추정한다', () => {
  const a = normalizeProduct({ name: '[라운드랩] 자작나무 선크림', price: 20900 }, { merchant: 'naver', commissionRate: 0.02 });
  assert.equal(a.brand, '라운드랩');
  const b = normalizeProduct({ name: '이니스프리 그린티 세럼', price: 15000 }, { merchant: 'naver', commissionRate: 0.02 });
  assert.equal(b.brand, '이니스프리');
});

test('같은 상품은 하나로 묶고 판매처만 늘어난다', () => {
  const opts = (m, rate) => ({ merchant: m, commissionRate: rate, category: 'toner' });
  const merged = mergeByProduct([
    normalizeProduct({ brand: '아누아', name: '어성초 77% 수딩 토너', price: 19900, reviews: 100 }, opts('naver', 0.025)),
    normalizeProduct({ brand: '아누아', name: '어성초 77% 수딩 토너', price: 17900, reviews: 300 }, opts('coupang', 0.03)),
    normalizeProduct({ brand: '이즈앤트리', name: '히아루로닉 토너', price: 15900 }, opts('coupang', 0.03)),
  ]);
  assert.equal(merged.length, 2);
  const anua = merged.find((p) => p.brand === '아누아');
  assert.equal(anua.offers.length, 2);
  assert.deepEqual(anua.offers.map((o) => o.merchant).sort(), ['coupang', 'naver']);
  assert.equal(anua.reviews, 300, '리뷰 수는 큰 쪽을 남긴다');
});

test('같은 판매처가 두 번 오면 최신 가격으로 교체한다', () => {
  const opts = { merchant: 'coupang', commissionRate: 0.03, category: 'toner' };
  const merged = mergeByProduct([
    normalizeProduct({ brand: '아누아', name: '어성초 토너', price: 19900 }, opts),
    normalizeProduct({ brand: '아누아', name: '어성초 토너', price: 17900 }, opts),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].offers.length, 1);
  assert.equal(merged[0].offers[0].price, 17900);
});

test('큐레이션이 매칭 태그와 셰이드를 붙이고, 없으면 표시된다', () => {
  const products = mergeByProduct([
    normalizeProduct({ brand: '아누아', name: '어성초 토너', price: 19900, id: 'ton-001' }, { merchant: 'naver', commissionRate: 0.025, category: 'toner' }),
    normalizeProduct({ brand: '모르는', name: '정체불명 크림', price: 9900, id: 'zzz' }, { merchant: 'naver', commissionRate: 0.025, category: 'cream' }),
  ]);
  const curated = mergeCurated(products, {
    'ton-001': { match: { skinType: ['sensitive'], concerns: ['redness'], undertone: ['warm'] }, keyIngredients: ['어성초'] },
  });
  const known = curated.find((p) => p.id === 'ton-001');
  const unknown = curated.find((p) => p.id === 'zzz');
  assert.equal(known.curated, true);
  assert.deepEqual(known.match.concerns, ['redness']);
  assert.equal(unknown.curated, false);
  assert.deepEqual(unknown.match, { skinType: [], concerns: [], undertone: [] });
});

test('검증은 앱을 깨뜨릴 데이터를 잡아낸다', () => {
  const merchants = { naver: { name: '네이버쇼핑' } };
  const good = validateCatalog({
    merchants,
    products: [normalizeProduct({ brand: 'A', name: 'B', price: 1000 }, { merchant: 'naver', commissionRate: 0.02, category: 'toner' })],
  });
  assert.equal(good.ok, true);

  const noOffer = validateCatalog({ merchants, products: [{ id: 'x', brand: 'A', name: 'B', category: 'toner', basePrice: 100, offers: [] }] });
  assert.equal(noOffer.ok, false);
  assert.match(noOffer.problems.join(' '), /오퍼가 없습니다/);

  const badPrice = validateCatalog({
    merchants,
    products: [{ id: 'x', brand: 'A', name: 'B', category: 'toner', basePrice: 100, offers: [{ merchant: 'naver', price: 0, commissionRate: 0.02 }] }],
  });
  assert.equal(badPrice.ok, false);
  assert.match(badPrice.problems.join(' '), /가격이 0 이하/);

  const wrongMerchant = validateCatalog({
    merchants,
    products: [{ id: 'x', brand: 'A', name: 'B', category: 'toner', basePrice: 100, offers: [{ merchant: 'nowhere', price: 100, commissionRate: 0.02 }] }],
  });
  assert.equal(wrongMerchant.ok, false);
  assert.match(wrongMerchant.problems.join(' '), /알 수 없는 판매처/);

  const crazyRate = validateCatalog({
    merchants,
    products: [{ id: 'x', brand: 'A', name: 'B', category: 'toner', basePrice: 100, offers: [{ merchant: 'naver', price: 100, commissionRate: 3.5 }] }],
  });
  assert.equal(crazyRate.ok, false, '수수료율 350% 같은 오입력은 걸러야 한다');
});

test('수수료율은 카테고리가 있으면 카테고리, 없으면 기본값', async () => {
  const { commissionFor } = await import('../server/feeds/index.js');
  const rates = { amazon: { default: 0.04, cushion: 0.08 } };
  assert.equal(commissionFor('amazon', 'cushion', rates), 0.08);
  assert.equal(commissionFor('amazon', 'toner', rates), 0.04);
  assert.equal(commissionFor('없는곳', 'toner', rates), 0);
});

test('실데이터가 없으면 샘플로, 있으면 실데이터로, 오래되면 알려준다', async () => {
  const livePath = path.join(tmp, 'catalog.live.json');
  process.env.SKINLAB_CATALOG = livePath;
  const { loadCatalog } = await import(`../server/feeds/index.js?t=${Date.now()}`);

  assert.equal(loadCatalog().source, 'seed', '실데이터 파일이 없으면 샘플');

  const product = { id: 'p1', brand: 'A', name: 'B', category: 'toner', basePrice: 1000, offers: [{ merchant: 'naver', price: 1000, commissionRate: 0.02 }] };
  fs.writeFileSync(livePath, JSON.stringify({ _meta: { syncedAt: new Date().toISOString() }, merchants: { naver: {} }, products: [product] }));
  assert.equal(loadCatalog().source, 'live');

  fs.writeFileSync(livePath, JSON.stringify({ _meta: { syncedAt: new Date(Date.now() - 100 * 36e5).toISOString() }, merchants: { naver: {} }, products: [product] }));
  const stale = loadCatalog();
  assert.equal(stale.source, 'live-stale');
  assert.ok(stale.ageHours >= 99);
  delete process.env.SKINLAB_CATALOG;
});

test('키가 없으면 어댑터는 스스로 건너뛴다고 답한다', async () => {
  const { ADAPTERS } = await import('../server/feeds/index.js');
  for (const [key, a] of Object.entries(ADAPTERS)) {
    assert.equal(typeof a.isConfigured, 'function', `${key}: isConfigured 없음`);
    assert.equal(typeof a.search, 'function', `${key}: search 없음`);
    assert.equal(typeof a.ping, 'function', `${key}: ping 없음`);
  }
});

test('시드 큐레이션 파일이 실제 카탈로그와 맞는다', () => {
  const curation = JSON.parse(fs.readFileSync(new URL('../data/curation.json', import.meta.url), 'utf8'));
  const seed = JSON.parse(fs.readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(curation.products).length, seed.products.length);
  for (const p of seed.products) {
    const c = curation.products[p.id];
    assert.ok(c, `${p.id} 큐레이션 누락`);
    assert.ok(c.query, `${p.id} 검색어 누락`);
    assert.deepEqual(c.match, p.match);
  }
});
