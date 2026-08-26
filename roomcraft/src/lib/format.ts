/** 표시 통화 = USD, 보조 표기 = KRW (고정 환율은 설정에서 조정) */
export const USD_TO_KRW = 1380

export const usd = (n: number, opts: { cents?: boolean } = {}): string =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })}`

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
