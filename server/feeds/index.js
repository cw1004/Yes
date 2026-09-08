/**
 * 카탈로그 동기화 오케스트레이터.
 *
 * 흐름: 큐레이션(사람이 정한 '무엇을 팔지') → 판매처별 검색 → 정규화 → 병합 → 검증 → 저장
 *
 * 설계 원칙 두 가지:
 * 1) 한 판매처가 실패해도 나머지는 살린다. 그리고 실패한 판매처는 **직전 데이터를 유지**한다.
 *    (전부 날려버리면 그날 그 판매처 매출이 0이 된다.)
 * 2) 검증에 실패한 결과는 저장하지 않는다. 깨진 카탈로그로 서비스하느니 어제 데이터가 낫다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProduct, mergeByProduct, mergeCurated, validateCatalog } from './normalize.js';
import * as coupang from './coupang.js';
import * as naver from './naver.js';
import * as amazon from './amazon.js';
import { loadAll as loadManual } from './manual.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SEED_PATH = path.join(ROOT, 'data', 'products.json');
export const LIVE_PATH = process.env.SKINLAB_CATALOG || path.join(ROOT, 'data', 'catalog.live.json');
const CURATION_PATH = path.join(ROOT, 'data', 'curation.json');
const RATES_PATH = path.join(ROOT, 'data', 'commission-rates.json');
const MANUAL_DIR = path.join(ROOT, 'data', 'manual');

export const ADAPTERS = { coupang, naver, amazon };

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

/** 수수료율은 API 가 주지 않는다 — 각 프로그램의 요율표를 사람이 적는다 */
export function commissionFor(merchant, category, rates) {
  const m = rates?.[merchant];
  if (!m) return 0;
  return Number(m[category] ?? m.default ?? 0);
}

/**
 * 서버가 쓸 카탈로그를 고른다.
 * 실데이터가 있고 너무 낡지 않았으면 그것을, 아니면 시드로 되돌아간다.
 */
export function loadCatalog({ maxAgeHours = 48 } = {}) {
  const seed = readJson(SEED_PATH, null);
  const live = readJson(LIVE_PATH, null);
  if (!live?.products?.length) {
    return { catalog: seed, source: 'seed', reason: '실데이터 없음 — 샘플 카탈로그로 동작 중' };
  }
  const ageHours = (Date.now() - new Date(live._meta?.syncedAt || 0)) / 36e5;
  if (ageHours > maxAgeHours) {
    return { catalog: live, source: 'live-stale', ageHours: Math.round(ageHours),
      reason: `${Math.round(ageHours)}시간 전 데이터 — 동기화가 멈춘 것은 아닌지 확인하세요` };
  }
  return { catalog: live, source: 'live', ageHours: Math.round(ageHours * 10) / 10 };
}

/**
 * 실제 동기화.
 * @param {{dryRun?:boolean, only?:string[], log?:Function}} opts
 */
export async function sync(opts = {}) {
  const log = opts.log || console.log;
  // 큐레이션 파일은 설명(_readme)과 데이터(products)를 함께 담는다
  const curationFile = readJson(CURATION_PATH, {});
  const curation = curationFile.products || curationFile;
  const rates = readJson(RATES_PATH, {});
  const seed = readJson(SEED_PATH, { merchants: {}, products: [] });
  const previous = readJson(LIVE_PATH, null);

  const keywords = Object.values(curation).map((c) => c.query || `${c.brand} ${c.name}`).filter(Boolean);
  if (!keywords.length) {
    return { ok: false, error: 'data/curation.json 이 비어 있습니다. 팔 제품을 먼저 정하세요.' };
  }

  const wanted = opts.only?.length ? opts.only : Object.keys(ADAPTERS);
  const collected = [];
  const report = { merchants: {}, startedAt: new Date().toISOString() };

  for (const key of wanted) {
    const adapter = ADAPTERS[key];
    if (!adapter) { report.merchants[key] = { status: 'unknown-adapter' }; continue; }
    if (!adapter.isConfigured()) {
      report.merchants[key] = { status: 'skipped', reason: '키 미설정' };
      log(`  · ${adapter.name}: 키가 없어 건너뜁니다`);
      continue;
    }
    const perHour = adapter.limits?.callsPerHour;
    const budget = perHour ? Math.min(keywords.length, perHour) : keywords.length;
    if (perHour && keywords.length > perHour) {
      log(`  · ${adapter.name}: 시간당 ${perHour}회 한도 — 이번엔 ${budget}개만 조회합니다`);
    }

    let okCount = 0, failCount = 0;
    for (const keyword of keywords.slice(0, budget)) {
      try {
        const items = await adapter.search(keyword, { limit: adapter.limits?.itemsPerCall ?? 10 });
        for (const raw of items) {
          const category = curationCategory(curation, keyword) || 'etc';
          collected.push(normalizeProduct(raw, {
            merchant: key,
            commissionRate: commissionFor(key, category, rates),
            shippingDays: raw.shippingDays,
            category,
          }));
        }
        okCount++;
      } catch (err) {
        failCount++;
        log(`  · ${adapter.name} "${keyword}" 실패: ${err.message.slice(0, 80)}`);
        if (err.status === 429 || err.status === 403) break; // 한도/권한 문제면 더 두드리지 않는다
      }
      if (adapter.limits?.callsPerSecond) await new Promise((r) => setTimeout(r, 1100));
    }
    report.merchants[key] = { status: okCount ? 'ok' : 'failed', queries: okCount, failures: failCount };
    log(`  · ${adapter.name}: ${okCount}건 조회, ${failCount}건 실패`);
  }

  // 공개 API 가 없는 판매처는 CSV 로
  for (const { merchant, items } of loadManual(MANUAL_DIR)) {
    for (const raw of items) {
      collected.push(normalizeProduct(raw, {
        merchant,
        commissionRate: commissionFor(merchant, raw.category || 'etc', rates),
        shippingDays: raw.shippingDays,
        category: raw.category,
      }));
    }
    report.merchants[merchant] = { status: 'ok', source: 'csv', items: items.length };
    log(`  · ${merchant}(CSV): ${items.length}건`);
  }

  let products = mergeCurated(mergeByProduct(collected), curation);

  // 이번에 실패한 판매처의 오퍼는 직전 데이터에서 살려둔다
  const failed = Object.entries(report.merchants).filter(([, v]) => v.status === 'failed').map(([k]) => k);
  if (failed.length && previous?.products?.length) {
    products = carryOverOffers(products, previous.products, failed);
    log(`  · 실패한 판매처(${failed.join(', ')})는 직전 가격을 유지합니다`);
  }

  const catalog = {
    _meta: {
      syncedAt: new Date().toISOString(),
      source: 'partner-api',
      note: '판매처 API 동기화 결과입니다. 편집하지 마세요 — 다음 동기화에서 덮어씁니다.',
      report,
    },
    merchants: seed.merchants,
    products,
  };

  const validation = validateCatalog(catalog);
  if (!validation.ok) {
    return { ok: false, error: `검증 실패 ${validation.count}건 — 저장하지 않았습니다.`, problems: validation.problems, catalog };
  }
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(LIVE_PATH), { recursive: true });
    fs.writeFileSync(LIVE_PATH, JSON.stringify(catalog, null, 2));
  }
  return { ok: true, dryRun: Boolean(opts.dryRun), path: LIVE_PATH, products: products.length, report };
}

function curationCategory(curation, keyword) {
  for (const c of Object.values(curation)) {
    if ((c.query || `${c.brand} ${c.name}`) === keyword) return c.category;
  }
  return null;
}

function carryOverOffers(products, previousProducts, failedMerchants) {
  const prevById = new Map(previousProducts.map((p) => [p.id, p]));
  return products.map((p) => {
    const prev = prevById.get(p.id);
    if (!prev) return p;
    const kept = prev.offers.filter((o) => failedMerchants.includes(o.merchant));
    if (!kept.length) return p;
    const merged = [...p.offers.filter((o) => !failedMerchants.includes(o.merchant)), ...kept.map((o) => ({ ...o, stale: true }))];
    return { ...p, offers: merged };
  });
}

/** 키가 유효한지 판매처별로 1회씩 확인 */
export async function checkKeys(log = console.log) {
  const out = {};
  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    if (!adapter.isConfigured()) { out[key] = { configured: false }; log(`  ✗ ${adapter.name}: 키 없음`); continue; }
    try {
      const r = await adapter.ping();
      out[key] = { configured: true, ok: true, sample: r.sample };
      log(`  ✓ ${adapter.name}: 연결 성공${r.sample ? ` (예: ${r.sample.slice(0, 30)})` : ''}`);
    } catch (err) {
      out[key] = { configured: true, ok: false, error: err.message.slice(0, 140) };
      log(`  ✗ ${adapter.name}: ${err.message.slice(0, 100)}`);
    }
  }
  return out;
}
