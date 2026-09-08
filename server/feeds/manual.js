/**
 * 수동 입력 어댑터 (CSV).
 *
 * 올리브영처럼 **공개 상품 API 가 없는 판매처**를 위한 통로다.
 * 이런 곳은 보통 제휴 네트워크(링크프라이스 등)를 통해 링크만 받고,
 * 가격·재고는 직접 넣어야 한다. 그 '직접 넣는 일'을 코드 수정이 아니라
 * 스프레드시트로 하게 만든다 — 담당자가 개발자가 아닐 가능성이 높다.
 *
 * data/manual/<판매처>.csv
 *   brand,name,category,price,coupon,shippingDays,stock,url,externalId
 */
import fs from 'node:fs';
import path from 'node:path';

export const id = 'manual';
export const name = '수동 입력';

/** 따옴표와 쉼표를 처리하는 최소 CSV 파서 */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** @returns {{merchant:string, items:object[]}[]} */
export function loadAll(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => {
      const merchant = path.basename(f, '.csv');
      const rows = parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
      const items = rows.map((r) => ({
        externalId: r.externalId || null,
        brand: r.brand,
        name: r.name,
        category: r.category || null,
        price: Number(String(r.price).replace(/[^\d.]/g, '')) || 0,
        coupon: Number(String(r.coupon || 0).replace(/[^\d.]/g, '')) || 0,
        shippingDays: Number(r.shippingDays) || 2,
        stock: !/^(false|n|no|0|품절)$/i.test(r.stock || ''),
        url: r.url || null,
        rating: Number(r.rating) || null,
        reviews: Number(r.reviews) || 0,
      })).filter((i) => i.name && i.price > 0);
      return { merchant, items };
    });
}
