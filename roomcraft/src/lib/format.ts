import { UNIT_LABEL, type PriceUnit } from '../types'

/** 표시 통화 = USD, 보조 표기 = KRW (고정 환율은 설정에서 조정) */
export const USD_TO_KRW = 1380

export const usd = (n: number, opts: { cents?: boolean } = {}): string =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })}`

/**
 * 클릭당 정산액처럼 센트 미만이 의미 있는 금액.
 * usd() 의 소수 0~2자리로는 $0.003 이 전부 $0.00 으로 뭉개집니다.
 */
export const usdFine = (n: number): string => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)

/**
 * 단가 표기. 자재는 "$78" 이 아니라 "$78/m²" 로 보여야 합니다.
 * 단위를 숨기면 마루 한 장 값으로 오해하고 견적이 30분의 1로 읽힙니다.
 */
export const unitPrice = (n: number, unit?: PriceUnit): string =>
  unit && unit !== 'ea' ? `${usd(n)}/${UNIT_LABEL[unit]}` : usd(n)

export const krw = (usdAmount: number): string =>
  `₩${Math.round(usdAmount * USD_TO_KRW).toLocaleString('ko-KR')}`

export const pct = (ratio: number, digits = 0): string => `${(ratio * 100).toFixed(digits)}%`

export const relativeTime = (ts: number): string => {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
