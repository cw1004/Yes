import type { ClientQuote, Product } from '../types'

export interface QuoteLine {
  product: Product
  qty: number
  unitCost: number
  /** 마진 적용 후 고객 청구 단가 */
  unitBilled: number
  lineTotal: number
}

export interface QuoteTotals {
  lines: QuoteLine[]
  furnitureCost: number
  furnitureBilled: number
  furnitureMargin: number
  designFee: number
  subtotal: number
  vat: number
  grandTotal: number
  /** 디자이너가 실제로 남기는 금액 */
  netProfit: number
}

export function computeQuote(
  items: { product: Product; qty: number }[],
  quote: ClientQuote,
): QuoteTotals {
  const marginMultiplier = 1 + quote.marginRate / 100

  const lines: QuoteLine[] = items.map(({ product, qty }) => {
    const unitBilled = Math.round(product.price * marginMultiplier)
    return {
      product,
      qty,
      unitCost: product.price,
      unitBilled,
      lineTotal: unitBilled * qty,
    }
  })

  const furnitureCost = lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0)
  const furnitureBilled = lines.reduce((sum, l) => sum + l.lineTotal, 0)
  const furnitureMargin = furnitureBilled - furnitureCost
  const designFee = quote.designFeeUsd
  const subtotal = furnitureBilled + designFee
  const vat = Math.round((subtotal * quote.vatRate) / 100)
  const grandTotal = subtotal + vat

  return {
    lines,
    furnitureCost,
    furnitureBilled,
    furnitureMargin,
    designFee,
    subtotal,
    vat,
    grandTotal,
    netProfit: furnitureMargin + designFee,
  }
}

export const DEFAULT_QUOTE: ClientQuote = {
  clientName: '',
  projectName: '',
  marginRate: 15,
  designFeeUsd: 1200,
  vatRate: 10,
  notes: '가구 리드타임은 발주 확정일로부터 4~8주이며, 배송·설치비는 별도 청구됩니다.',
}
