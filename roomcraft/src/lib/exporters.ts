import type { AffiliateIds, Hotspot, MallId, Product } from '../types'
import { productBySku } from '../data/catalog'
import { buildDeeplink, mallById } from './affiliate'
import { usd } from './format'

export interface ExportRow {
  product: Product
  qty: number
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 스프레드시트/정산용 CSV — 활성화된 채널만 열로 만듭니다. */
export function toCsv(rows: ExportRow[], ids: AffiliateIds, mallIds: MallId[]): string {
  const malls = mallIds.map(mallById)
  const header = [
    'SKU',
    'Product',
    'Brand',
    'Category',
    'Qty',
    'Unit Price (USD)',
    'Line Total (USD)',
    ...malls.map((m) => `${m.label} Link`),
  ]
  const body = rows.map(({ product, qty }) => [
    product.sku,
    product.name,
    product.brand,
    product.category,
    qty,
    product.price,
    product.price * qty,
    ...malls.map((m) => buildDeeplink(m.id, product.searchTerm, ids)),
  ])
  return [header, ...body].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** 블로그 포스팅용 HTML (티스토리/네이버 에디터에 그대로 붙여넣기) */
export function toBlogHtml(
  rows: ExportRow[],
  ids: AffiliateIds,
  meta: { styleName: string; spaceLabel: string; primaryMall: MallId },
): string {
  const mall = mallById(meta.primaryMall)
  const total = rows.reduce((s, r) => s + r.product.price * r.qty, 0)

  const items = rows
    .map(({ product, qty }) => {
      const link = buildDeeplink(meta.primaryMall, product.searchTerm, ids)
      return [
        '  <li style="margin:0 0 18px;">',
        `    <strong>${escapeHtml(product.name)}</strong>${qty > 1 ? ` × ${qty}` : ''}<br />`,
        `    <span style="color:#666;">${escapeHtml(product.brand)} · ${escapeHtml(product.category)} · ${usd(product.price)}</span><br />`,
        `    <span style="color:#444;">${escapeHtml(product.reason)}</span><br />`,
        `    <a href="${link}" target="_blank" rel="nofollow sponsored noopener">👉 ${escapeHtml(mall.label)}에서 최저가 보기</a>`,
        '  </li>',
      ].join('\n')
    })
    .join('\n')

  return [
    `<h2>${escapeHtml(meta.spaceLabel)} — ${escapeHtml(meta.styleName)} 스타일링 리스트</h2>`,
    `<p>RoomCraft AI로 리모델링한 ${escapeHtml(meta.spaceLabel)}에 실제 배치된 가구 ${rows.length}종입니다. 총 견적 ${usd(total)}.</p>`,
    '<ul style="padding-left:18px;">',
    items,
    '</ul>',
    '<p style="font-size:13px;color:#888;margin-top:24px;">',
    '이 포스팅은 제휴 마케팅 링크를 포함하며, 구매 발생 시 작성자가 일정액의 수수료를 제공받습니다.',
    '</p>',
  ].join('\n')
}

/** 카카오톡/인스타 프로필용 단문 (링크 + 최소 설명) */
export function toKakaoText(
  rows: ExportRow[],
  ids: AffiliateIds,
  meta: { styleName: string; primaryMall: MallId },
): string {
  const lines = rows.map(
    ({ product }, i) =>
      `${i + 1}. ${product.name} (${usd(product.price)})\n${buildDeeplink(meta.primaryMall, product.searchTerm, ids)}`,
  )
  return [
    `🛋 ${meta.styleName} 스타일링 리스트`,
    '',
    ...lines,
    '',
    '※ 제휴 링크 포함 (구매 시 수수료를 받을 수 있습니다)',
  ].join('\n')
}

/**
 * 쇼퍼블 이미지 HTML.
 *
 * 렌더 이미지 위에 태그를 절대 위치로 얹어, 블로그에 붙여넣어도 클릭하면 제휴 링크로
 * 이동하도록 만듭니다. 외부 CSS/JS 없이 인라인 스타일만 사용합니다 —
 * 블로그 에디터 대부분이 <style> 과 <script> 를 제거하기 때문입니다.
 */
export function toShoppableHtml({
  imageUrl,
  hotspots,
  affiliateIds,
  mallId,
  title,
}: {
  imageUrl: string
  hotspots: Hotspot[]
  affiliateIds: AffiliateIds
  mallId: MallId
  title: string
}): string {
  const mall = mallById(mallId)

  const tags = hotspots
    .map((h) => {
      const product = productBySku(h.sku)
      if (!product) return ''
      const link = buildDeeplink(mallId, product.searchTerm, affiliateIds)
      const label = `${product.name} · ${usd(product.price)}`
      return [
        `  <a href="${link}" target="_blank" rel="nofollow sponsored noopener"`,
        `     title="${escapeHtml(label)}"`,
        `     style="position:absolute;left:${(h.x * 100).toFixed(1)}%;top:${(h.y * 100).toFixed(1)}%;` +
          'transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:6px;' +
          'padding:5px 10px 5px 6px;border-radius:999px;background:rgba(12,12,14,.86);' +
          'color:#f0a437;font:600 12px/1 system-ui,sans-serif;text-decoration:none;' +
          'box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap;">',
        `    <span style="display:inline-block;width:14px;height:14px;border-radius:999px;background:${product.swatch};"></span>`,
        `    ${escapeHtml(product.brand)} · ${usd(product.price)}`,
        '  </a>',
      ].join('\n')
    })
    .filter(Boolean)
    .join('\n')

  const list = hotspots
    .map((h) => {
      const product = productBySku(h.sku)
      if (!product) return ''
      const link = buildDeeplink(mallId, product.searchTerm, affiliateIds)
      return `  <li style="margin:0 0 8px;"><a href="${link}" target="_blank" rel="nofollow sponsored noopener">${escapeHtml(product.name)}</a> — ${usd(product.price)} <span style="color:#888;">(${escapeHtml(product.brand)})</span></li>`
    })
    .filter(Boolean)
    .join('\n')

  return [
    `<figure style="margin:0 0 24px;max-width:960px;">`,
    `  <div style="position:relative;line-height:0;">`,
    `    <img src="${imageUrl}" alt="${escapeHtml(title)}" style="width:100%;height:auto;border-radius:12px;" />`,
    tags,
    '  </div>',
    `  <figcaption style="margin-top:10px;font:400 13px/1.5 system-ui,sans-serif;color:#666;">`,
    `    ${escapeHtml(title)} — 이미지의 태그를 누르면 ${escapeHtml(mall.label)} 검색 결과로 이동합니다.`,
    '  </figcaption>',
    '</figure>',
    '<ul style="padding-left:18px;font:400 14px/1.6 system-ui,sans-serif;">',
    list,
    '</ul>',
    '<p style="font-size:13px;color:#888;">이 포스팅은 제휴 마케팅 링크를 포함하며, 구매 발생 시 작성자가 일정액의 수수료를 제공받습니다.</p>',
  ].join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 클립보드 권한이 없는 환경(비 HTTPS 등) 폴백
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}
