import type { AffiliateIds, MallId, Product } from '../types'

export interface Mall {
  id: MallId
  label: string
  icon: string
  /** 예상 커미션 구간 (소수) */
  commissionMin: number
  commissionMax: number
  /** 파트너 ID 입력 필드 라벨 */
  idLabel: string
  idPlaceholder: string
  /** 결제 통화 표기 */
  currency: 'KRW' | 'USD'
}

export const MALLS: Mall[] = [
  {
    id: 'coupang',
    label: '쿠팡 파트너스',
    icon: '🛒',
    commissionMin: 0.03,
    commissionMax: 0.1,
    idLabel: '쿠팡 파트너스 SubID',
    idPlaceholder: 'AF_ROOMCRAFT_01',
    currency: 'KRW',
  },
  {
    id: 'ohouse',
    label: '오늘의집',
    icon: '🏠',
    commissionMin: 0.02,
    commissionMax: 0.08,
    idLabel: '오늘의집 파트너 ID',
    idPlaceholder: 'OH_ROOMCRAFT_77',
    currency: 'KRW',
  },
  {
    id: 'amazon',
    label: 'Amazon Associates',
    icon: '📦',
    commissionMin: 0.03,
    commissionMax: 0.08,
    idLabel: 'Amazon Associates Tag',
    idPlaceholder: 'roomcraft-20',
    currency: 'USD',
  },
  {
    id: 'aliexpress',
    label: 'AliExpress Portals',
    icon: '⚡',
    commissionMin: 0.03,
    commissionMax: 0.09,
    idLabel: 'AliExpress Portals Key',
    idPlaceholder: 'roomcraft_global',
    currency: 'USD',
  },
]

export const mallById = (id: MallId): Mall => MALLS.find((m) => m.id === id) ?? MALLS[0]

export const EMPTY_AFFILIATE_IDS: AffiliateIds = {
  coupangSubId: '',
  ohousePartnerId: '',
  amazonTag: '',
  aliexpressKey: '',
}

const idFor = (mall: MallId, ids: AffiliateIds): string => {
  switch (mall) {
    case 'coupang':
      return ids.coupangSubId
    case 'ohouse':
      return ids.ohousePartnerId
    case 'amazon':
      return ids.amazonTag
    case 'aliexpress':
      return ids.aliexpressKey
  }
}

/**
 * 몰별 검색 딥링크를 생성합니다.
 *
 * 주의: 각 제휴 프로그램의 정식 추적 링크는 파트너 콘솔/API가 발급합니다.
 * 여기서 만드는 링크는 검색 URL + 파트너 파라미터 형태이며,
 * 승인된 계정에서 파트너 API 연동 시 lib/affiliate 의 이 함수만 교체하면 됩니다.
 */
export function buildDeeplink(mall: MallId, term: string, ids: AffiliateIds): string {
  const q = encodeURIComponent(term.trim())
  const partner = idFor(mall, ids).trim()

  switch (mall) {
    case 'coupang': {
      const url = new URL('https://www.coupang.com/np/search')
      url.searchParams.set('q', term)
      if (partner) url.searchParams.set('subId', partner)
      return url.toString()
    }
    case 'ohouse': {
      const url = new URL('https://ohou.se/search')
      url.searchParams.set('query', term)
      if (partner) url.searchParams.set('affect_type', `partner_${partner}`)
      return url.toString()
    }
    case 'amazon': {
      const url = new URL('https://www.amazon.com/s')
      url.searchParams.set('k', term)
      if (partner) url.searchParams.set('tag', partner)
      return url.toString()
    }
    case 'aliexpress': {
      const base = `https://www.aliexpress.com/wholesale?SearchText=${q}`
      return partner ? `${base}&aff_platform=portals&aff_trace_key=${encodeURIComponent(partner)}` : base
    }
  }
}

/** 상품 하나에 대한 전 채널 딥링크 */
export function buildAllDeeplinks(product: Product, ids: AffiliateIds): Record<MallId, string> {
  return MALLS.reduce(
    (acc, mall) => {
      acc[mall.id] = buildDeeplink(mall.id, product.searchTerm, ids)
      return acc
    },
    {} as Record<MallId, string>,
  )
}

/** 몰 평균 커미션율 (min/max 중앙값) */
export const avgCommission = (mall: Mall): number => (mall.commissionMin + mall.commissionMax) / 2

/**
 * 배치된 가구 총액에 대한 예상 제휴 수수료.
 * 실제 정산은 클릭 -> 구매 전환율에 좌우되므로 낙관/보수 두 값을 함께 돌려줍니다.
 */
export function estimateCommission(totalUsd: number): {
  conservative: number
  expected: number
  optimistic: number
  avgRate: number
} {
  const rates = MALLS.map(avgCommission)
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length
  return {
    conservative: totalUsd * Math.min(...MALLS.map((m) => m.commissionMin)),
    expected: totalUsd * avgRate,
    optimistic: totalUsd * Math.max(...MALLS.map((m) => m.commissionMax)),
    avgRate,
  }
}
