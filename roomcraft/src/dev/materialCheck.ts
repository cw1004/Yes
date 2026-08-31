/**
 * 자재 수량·견적 점검 — window.__materialCheck() 로 실행합니다.
 * "마루 $78" 이 "34m² × $78 = $2,900" 으로 잡히는지 눈으로 확인하기 위한 훅입니다.
 */
import { CATALOG, productBySku } from '../data/catalog'
import { defaultQtyFor, spaceById } from '../data/spaces'
import { DEFAULT_ENABLED_MALLS, EMPTY_AFFILIATE_IDS, PROGRAMS } from '../lib/affiliate'
import { orderValue, rankByRevenue } from '../lib/revenue'
import { isMaterial } from '../types'

export function materialCheck(spaceId = 'living') {
  const space = spaceById(spaceId)
  const materials = CATALOG.filter((p) => isMaterial(p.category))

  const rows = materials.map((p) => {
    const qty = defaultQtyFor(p, space)
    return {
      제품: p.name.slice(0, 30),
      카테고리: p.category,
      단가: `$${p.price}/${p.unit ?? 'ea'}`,
      기본수량: qty,
      주문액: `$${orderValue(p, qty).toLocaleString()}`,
    }
  })

  // 단가 기준과 주문액 기준의 채널 선택이 실제로 달라지는지 봅니다.
  const ids = PROGRAMS.reduce((a, p) => ({ ...a, [p.id]: 'TEST' }), {} as typeof EMPTY_AFFILIATE_IDS)
  const qtyBySku = Object.fromEntries(materials.map((p) => [p.sku, defaultQtyFor(p, space)]))
  const byUnit = rankByRevenue(materials, DEFAULT_ENABLED_MALLS, ids)
  const byOrder = rankByRevenue(materials, DEFAULT_ENABLED_MALLS, ids, { qtyBySku })

  const changed = byOrder.filter((r) => {
    const before = byUnit.find((x) => x.product.sku === r.product.sku)
    return before && before.best.mall.id !== r.best.mall.id
  })

  return {
    space: `${space.label} ${space.areaSqm}m²`,
    rows,
    총자재비: `$${materials.reduce((s, p) => s + orderValue(p, defaultQtyFor(p, space)), 0).toLocaleString()}`,
    채널이바뀐제품: changed.map((r) => ({
      제품: r.product.name.slice(0, 26),
      단가기준: byUnit.find((x) => x.product.sku === r.product.sku)?.best.mall.label,
      주문액기준: r.best.mall.label,
    })),
    총자재수: materials.length,
    productBySkuOk: Boolean(productBySku(materials[0]?.sku ?? '')),
  }
}
