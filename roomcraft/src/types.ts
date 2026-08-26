/** 앱 전체에서 공유하는 도메인 타입 */

export type SpaceKind =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'office'
  | 'kids'
  | 'balcony'
  | 'commercial'

export interface Space {
  id: SpaceKind
  label: string
  labelEn: string
  /** 해당 공간에서 우선 배치되는 가구 카테고리 */
  focus: ProductCategory[]
}

export type StyleFamily = 'modern' | 'minimal' | 'luxury' | 'eclectic' | 'natural'

export interface DesignStyle {
  id: string
  name: string
  nameEn: string
  family: StyleFamily
  tagline: string
  /** AI 렌더 프롬프트에 삽입되는 상세 지시문 */
  promptCore: string
  /** 조명 설명 (헤더 요약 줄에 노출) */
  lighting: string
  palette: string[]
  signatureItems: string[]
  /** 이 스타일에서 추천되는 카탈로그 상품 id */
  curatedSkus: string[]
  previewGradient: string
}

export type ProductCategory =
  | 'Seating'
  | 'Table'
  | 'Storage'
  | 'Lighting'
  | 'Rug'
  | 'Decor'
  | 'Appliance'
  | 'Bed'

/** 제휴 커머스 채널 (링크를 거는 쇼핑몰) */
export type MallId =
  // 국내
  | 'coupang' | 'ohouse' | 'naver' | '11st' | 'gmarket' | 'auction'
  | 'ssg' | 'lotteon' | 'hanssem' | 'livart'
  // 미국
  | 'amazon' | 'wayfair' | 'westelm' | 'crateandbarrel' | 'article'
  | 'houzz' | 'lumens' | 'etsy' | 'ebay'
  // 일본
  | 'rakuten-ichiba' | 'amazon-jp' | 'yahoo-shopping' | 'lowya' | 'nitori' | 'muji'
  // 중국
  | 'taobao' | 'jd' | 'aliexpress' | 'temu' | '1688'
  // 유럽
  | 'amazon-de' | 'ikea' | 'nordicnest' | 'connox' | 'madeindesign'
  | 'westwing' | 'maisonsdumonde'

/** 제휴 프로그램 (추적 ID를 발급받는 주체). 여러 몰이 하나의 프로그램을 공유합니다. */
export type ProgramId =
  // 국내
  | 'coupang-partners' | 'ohouse-partners' | 'linkprice' | 'adpick'
  // 미국 / 글로벌 네트워크
  | 'amazon-associates' | 'impact' | 'cj-affiliate' | 'awin'
  | 'rakuten-advertising' | 'ebay-epn'
  // 일본
  | 'amazon-jp' | 'rakuten-affiliate' | 'valuecommerce' | 'a8net'
  // 중국
  | 'taobao-alliance' | 'jd-union' | 'aliexpress-portals' | 'temu-affiliate'
  // 유럽
  | 'amazon-eu' | 'tradedoubler'
  | 'direct'

export interface Product {
  sku: string
  name: string
  brand: string
  vendor: string
  category: ProductCategory
  /** USD 기준 정가 */
  price: number
  rating: number
  materials: string
  /** 스타일 추천 사유 (스펙시트에 노출) */
  reason: string
  /** 브랜드 공식몰 링크 (제휴 링크 아님) */
  officialUrl: string
  /** 실제 커머스 딥링크 생성 시 사용하는 검색 키워드 */
  searchTerm: string
  swatch: string
}

/** 무드보드에 담긴 항목 = 수익화 단위 */
export interface MoodboardItem {
  sku: string
  qty: number
  addedAt: number
  /** 어떤 스타일 렌더에서 담겼는지 (성과 분석용) */
  fromStyleId: string
}

/** 프로그램별 추적 ID */
export type AffiliateIds = Record<ProgramId, string>

export interface RenderResult {
  id: string
  styleId: string
  spaceId: SpaceKind
  intensity: number
  /** After 이미지 (data URL 또는 원격 URL) */
  imageUrl: string
  /** 렌더에 실제로 사용된 프롬프트 */
  prompt: string
  createdAt: number
  provider: 'mock' | 'server'
  /** 스타일 일치도 (%) */
  matchScore: number
  notes: string[]
}

/** 렌더 이미지 위에 찍는 쇼퍼블 태그 */
export interface Hotspot {
  id: string
  sku: string
  /** 이미지 기준 상대 좌표 (0~1) */
  x: number
  y: number
}

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user'
  content: string
  createdAt: number
  /** 이 메시지에 첨부된 추천 상품 */
  recommendations?: string[]
}

export type PlanId = 'free' | 'creator' | 'pro' | 'studio'

export interface Plan {
  id: PlanId
  name: string
  priceUsd: number
  monthlyCredits: number
  /** 템플릿 마켓 판매 시 창작자 정산 비율 */
  payoutRate: number
  perks: string[]
  watermark: boolean
}

export interface CreditPack {
  id: string
  credits: number
  priceUsd: number
  bonus: number
}

/** 클라이언트 납품용 견적서 */
export interface ClientQuote {
  clientName: string
  projectName: string
  /** 가구 원가 대비 마진율 (%) */
  marginRate: number
  designFeeUsd: number
  /** 부가세율 (%) */
  vatRate: number
  notes: string
}

/** 템플릿 마켓에 올린 판매용 프리셋 */
export interface TemplateListing {
  id: string
  title: string
  styleId: string
  spaceId: SpaceKind
  priceUsd: number
  sales: number
  createdAt: number
}
