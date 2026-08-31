import type { AffiliateIds, MallId, Product } from '../types'
import type { Mall, MallStrength, Region } from './affiliate'
import { avgCommission, isMallLinked, mallById } from './affiliate'

/**
 * 수익 최적화.
 *
 * 지금까지 링크는 "켜둔 채널 중 첫 번째"(대개 쿠팡, 수수료 1~3%로 전체 최저)로
 * 나갔습니다. 같은 클릭인데 채널만 바꿔도 정산액이 몇 배 달라지므로,
 * 제품마다 기대수익이 가장 큰 채널을 골라 그 채널로만 링크를 겁니다.
 *
 *   클릭당 기대수익 = 가격 × 수수료율 × 전환확률
 *
 * ── 전환확률에 대한 정직한 고지 ──────────────────────────────────────
 * 이 앱에는 실측 전환 데이터가 없습니다. 아래 계수는 "관측된 값"이 아니라
 * 근거를 밝힌 *가정*이며, 계산에 쓰이는 순간 그렇게 표시됩니다.
 * 앱은 이미 클릭을 기록하고 있으므로(server/links.js), 각 제휴 콘솔의 구매
 * 데이터를 가져오면 calibrate() 로 가정을 실측값으로 대체하도록 설계했습니다.
 * 그 전까지 이 숫자는 채널 간 *순위*를 정하는 용도로만 신뢰할 수 있고,
 * 절대 금액으로 읽으면 안 됩니다.
 */

/** 업계에서 흔히 인용되는 제휴 클릭→구매 기준선. 모든 계수는 여기에 곱해집니다. */
export const BASE_CONVERSION = 0.02

/**
 * 가격대 계수.
 * 고가 가구는 클릭에서 결제까지 매장 방문·배송 상담·가족 합의가 끼어들어
 * 전환이 급격히 떨어집니다. 반대로 소품은 충동구매가 일어납니다.
 */
function priceFactor(usd: number): number {
  if (usd < 150) return 2.2
  if (usd < 400) return 1.5
  if (usd < 900) return 1.0
  if (usd < 2000) return 0.6
  if (usd < 5000) return 0.32
  return 0.18
}

/**
 * 채널 성격 계수.
 * 가구를 사러 온 사람이 있는 곳에서 가구가 더 팔립니다.
 * 해외직구는 관세·배송기간이 이탈 지점으로 작용합니다.
 */
const STRENGTH_FACTOR: Record<MallStrength, number> = {
  '가구·인테리어 전문': 1.35,
  '프리미엄 디자인': 1.15,
  종합몰: 1.0,
  '중고·빈티지': 0.85,
  해외직구: 0.55,
}

/**
 * 채널×가격 적합도.
 *
 * 이것이 없으면 채널 순위가 제품과 무관해집니다. perClick = 가격 × 요율 × 전환 인데
 * 가격과 가격대 계수는 모든 채널에 똑같이 곱해져 약분되고, 남는 것은 요율과 채널 성격뿐이라
 * 모든 제품이 같은 채널 하나로 몰립니다(실제로 그렇게 나왔습니다).
 *
 * 현실에서는 채널마다 팔리는 가격대가 다릅니다. 1만 달러짜리 이탈리아 소파는 종합몰에서
 * 팔리지 않고, 2만원짜리 스트링 조명은 프리미엄 디자인 편집숍에 아예 없습니다.
 * 채널 성격별 중심 가격대를 두고 로그 정규 분포로 적합도를 계산합니다.
 */
const PRICE_BAND: Record<MallStrength, { center: number; spread: number }> = {
  // center = 그 채널에서 가장 잘 팔리는 가격대(USD), spread = 로그 스케일 관용도
  종합몰: { center: 180, spread: 1.5 },
  해외직구: { center: 120, spread: 1.4 },
  '가구·인테리어 전문': { center: 1200, spread: 1.5 },
  '프리미엄 디자인': { center: 3800, spread: 1.5 },
  '중고·빈티지': { center: 700, spread: 1.6 },
}

function priceFit(mall: Mall, usd: number): number {
  const { center, spread } = PRICE_BAND[mall.strength]
  const d = Math.log(Math.max(usd, 1)) - Math.log(center)
  return Math.exp(-(d * d) / (2 * spread * spread))
}

/**
 * 청중 지역 계수. 배송비·관세·반품 절차가 같은 나라 안에서 가장 가볍습니다.
 * 청중이 한국이면 KR 채널이 유리하고, 그렇지 않으면 해당 지역 채널이 유리합니다.
 */
function regionFactor(mall: Mall, audience: Region): number {
  if (mall.region === audience) return 1.3
  // 미국 대형몰은 타 지역에서도 어느 정도 통용됩니다.
  if (mall.region === 'US') return 0.8
  return 0.6
}

/** 실측값으로 가정을 덮어쓰기 위한 슬롯. 비어 있으면 위의 가정을 씁니다. */
export type MeasuredConversion = Partial<Record<MallId, number>>

export interface RevenueOptions {
  /** 콘텐츠를 보는 사람들의 주 지역 */
  audience?: Region
  /** 제휴 콘솔에서 가져온 채널별 실측 전환율 */
  measured?: MeasuredConversion
}

/** 이 제품을 이 채널로 보냈을 때의 기대 성과 */
export interface ChannelPick {
  mall: Mall
  /** 평균 수수료율 */
  rate: number
  /** 적용된 전환확률 */
  conversion: number
  /** 실측 데이터로 계산했는지 (false 면 가정) */
  measured: boolean
  /** 클릭 1회당 기대 정산액 (USD) */
  perClick: number
  /** 제휴 ID 가 입력되어 채널이 실제로 정산 가능한 상태인지 */
  linked: boolean
}

/** 제품 하나에 대한 채널 비교 결과 */
export interface ProductRevenue {
  product: Product
  best: ChannelPick
  /** perClick 내림차순, best 제외 */
  runnersUp: ChannelPick[]
  /** best 를 썼을 때 "첫 번째 채널"보다 몇 배 버는지 */
  liftVsFirst: number
}

function conversionFor(product: Product, mall: Mall, opts: RevenueOptions): { p: number; measured: boolean } {
  const m = opts.measured?.[mall.id]
  if (typeof m === 'number' && m > 0) return { p: m, measured: true }
  const p =
    BASE_CONVERSION *
    priceFactor(product.price) *
    STRENGTH_FACTOR[mall.strength] *
    regionFactor(mall, opts.audience ?? 'KR') *
    priceFit(mall, product.price)
  // 전환율은 확률이므로 상한을 둡니다. 계수가 곱해지며 1을 넘는 일이 없게 합니다.
  return { p: Math.min(p, 0.25), measured: false }
}

/** 한 제품을 각 채널로 보냈을 때의 기대 성과 — 좋은 순서로 */
export function channelPicks(product: Product, mallIds: MallId[], ids: AffiliateIds, opts: RevenueOptions = {}): ChannelPick[] {
  return mallIds
    .map(mallById)
    .map((mall) => {
      const rate = avgCommission(mall)
      const { p, measured } = conversionFor(product, mall, opts)
      return {
        mall,
        rate,
        conversion: p,
        measured,
        perClick: product.price * rate * p,
        linked: isMallLinked(mall, ids),
      }
    })
    .sort((a, b) => {
      // 정산 ID 가 없는 채널은 지금 당장 돈이 되지 않으므로 뒤로 보냅니다.
      if (a.linked !== b.linked) return a.linked ? -1 : 1
      return b.perClick - a.perClick
    })
}

/** 제품별 최적 채널. mallIds 가 비어 있으면 null. */
export function bestChannel(product: Product, mallIds: MallId[], ids: AffiliateIds, opts: RevenueOptions = {}): ChannelPick | null {
  return channelPicks(product, mallIds, ids, opts)[0] ?? null
}

/** 제품 목록을 클릭당 기대수익 순으로 정렬 */
export function rankByRevenue(products: Product[], mallIds: MallId[], ids: AffiliateIds, opts: RevenueOptions = {}): ProductRevenue[] {
  if (!mallIds.length) return []
  return products
    .map((product) => {
      const picks = channelPicks(product, mallIds, ids, opts)
      const best = picks[0]
      // 개선 전 동작("켜둔 채널 중 첫 번째")과 비교해 얼마나 나아졌는지 보여줍니다.
      const first = picks.find((p) => p.mall.id === mallIds[0])
      return {
        product,
        best,
        runnersUp: picks.slice(1),
        liftVsFirst: first && first.perClick > 0 ? best.perClick / first.perClick : 1,
      }
    })
    .sort((a, b) => b.best.perClick - a.best.perClick)
}

/**
 * 배지 등급. 절대 금액이 아니라 이 목록 안에서의 상대 위치입니다 —
 * 가정에 기반한 값이라 순위만 의미가 있기 때문입니다.
 */
export type RevenueTier = 'hero' | 'strong' | 'standard'

export function tierOf(index: number, total: number): RevenueTier {
  if (total <= 2) return index === 0 ? 'hero' : 'standard'
  if (index === 0) return 'hero'
  if (index < Math.max(1, Math.ceil(total * 0.3))) return 'strong'
  return 'standard'
}

export const TIER_LABEL: Record<RevenueTier, { label: string; hint: string }> = {
  hero: { label: '최고 수익', hint: '이 목록에서 클릭당 기대 정산액이 가장 큽니다' },
  strong: { label: '고수익', hint: '상위 30% 기대 정산액' },
  standard: { label: '', hint: '' },
}
