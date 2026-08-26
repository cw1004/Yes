import type { CreditPack, Plan } from '../types'

/** 렌더 1회에 소모되는 크레딧 (해상도/강도에 따라 가산) */
export const CREDIT_COST = {
  render: 5,
  upscale: 8,
  productSourcing: 2,
  chatTurn: 1,
} as const

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    monthlyCredits: 20,
    payoutRate: 0.7,
    perks: ['월 4회 렌더', '표준 해상도 (1024px)', '제휴 링크 5개/월', '워터마크 포함'],
    watermark: true,
  },
  {
    id: 'creator',
    name: 'Creator',
    priceUsd: 19,
    monthlyCredits: 200,
    payoutRate: 0.8,
    perks: ['월 40회 렌더', '고해상도 (2048px)', '제휴 링크 무제한', '워터마크 제거', '블로그/카톡 대량 내보내기'],
    watermark: false,
  },
  {
    id: 'pro',
    name: 'Pro Creator',
    priceUsd: 49,
    monthlyCredits: 600,
    payoutRate: 0.85,
    perks: [
      '월 120회 렌더',
      '4K 업스케일',
      '템플릿 마켓 판매 (85% 정산)',
      '클라이언트 납품 견적서',
      '멀티몰 딥링크 자동 생성',
    ],
    watermark: false,
  },
  {
    id: 'studio',
    name: 'Studio',
    priceUsd: 149,
    monthlyCredits: 2400,
    payoutRate: 0.9,
    perks: ['무제한급 렌더 (2,400 크레딧)', '팀 시트 5인', '화이트라벨 견적서', 'API 액세스', '전담 지원'],
    watermark: false,
  },
]

export const planById = (id: string): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0]

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack-100', credits: 100, priceUsd: 9, bonus: 0 },
  { id: 'pack-300', credits: 300, priceUsd: 24, bonus: 30 },
  { id: 'pack-1000', credits: 1000, priceUsd: 69, bonus: 150 },
]
