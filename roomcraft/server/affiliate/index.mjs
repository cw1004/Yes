import * as coupang from './coupang.mjs';
import * as amazon from './amazon.mjs';

const ADAPTERS = { Coupang: coupang, Amazon: amazon };

export function adapterFor(platform) {
  return ADAPTERS[platform] ?? null;
}

// Converts in per-platform groups (Coupang bills one API call per batch) and
// returns a url→affiliate map. A platform with no credentials falls back to the
// original url and is reported, so a partial setup still produces a working
// bundle instead of failing the whole run.
export async function convertAll(products) {
  const out = new Map();
  const warnings = [];
  const groups = new Map();

  for (const p of products) {
    if (!groups.has(p.platform)) groups.set(p.platform, []);
    groups.get(p.platform).push(p);
  }

  for (const [platform, items] of groups) {
    const adapter = adapterFor(platform);
    const urls = items.map(p => p.url);
    if (!adapter || !adapter.configured()) {
      warnings.push(`${platform}: 자격증명 없음 — 원본 링크를 그대로 씁니다 (수수료 추적 안 됨)`);
      urls.forEach(u => out.set(u, u));
      continue;
    }
    try {
      const converted = await adapter.toAffiliate(urls);
      urls.forEach((u, i) => out.set(u, converted[i] ?? u));
    } catch (err) {
      warnings.push(`${platform}: 변환 실패 (${err.message}) — 원본 링크 사용`);
      urls.forEach(u => out.set(u, u));
    }
  }

  return { links: out, warnings };
}
