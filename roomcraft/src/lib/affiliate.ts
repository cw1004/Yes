import type { AffiliateIds, MallId, Product, ProgramId } from '../types'

/**
 * 제휴 커머스 모델은 2계층입니다.
 *
 *   AffiliateProgram — 실제로 가입하고 추적 ID를 발급받는 주체 (쿠팡 파트너스, 링크프라이스, Amazon Associates …)
 *   Mall             — 링크를 거는 쇼핑몰 (11번가, G마켓, SSG …)
 *
 * 국내 종합몰 다수가 하나의 CPS 네트워크(링크프라이스 등)를 공유하기 때문에
 * 몰마다 ID를 따로 받는 구조로는 확장되지 않습니다. 프로그램 단위로 ID를 관리하고,
 * 몰은 자신이 속한 프로그램을 참조합니다.
 */

export type Region = 'KR' | 'US' | 'JP' | 'CN' | 'EU'

export const REGIONS: { id: Region; label: string; flag: string }[] = [
  { id: 'KR', label: '국내', flag: '🇰🇷' },
  { id: 'US', label: '미국·글로벌', flag: '🇺🇸' },
  { id: 'JP', label: '일본', flag: '🇯🇵' },
  { id: 'CN', label: '중국', flag: '🇨🇳' },
  { id: 'EU', label: '유럽', flag: '🇪🇺' },
]

export interface AffiliateProgram {
  id: ProgramId
  label: string
  region: Region
  /** 파트너 ID 입력 필드 라벨 */
  idLabel: string
  idPlaceholder: string
  /** 링크에 붙일 추적 파라미터 이름 */
  paramKey: string
  /** 가입/콘솔 주소 */
  consoleUrl: string
  /** 링크 형식에 대한 주의사항 */
  note: string
}

export const PROGRAMS: AffiliateProgram[] = [
  // ── 국내 ──────────────────────────────────────────────────────────────
  {
    id: 'coupang-partners',
    label: '쿠팡 파트너스',
    region: 'KR',
    idLabel: '쿠팡 파트너스 SubID',
    idPlaceholder: 'AF_ROOMCRAFT_01',
    paramKey: 'subId',
    consoleUrl: 'https://partners.coupang.com/',
    note: '정식 추적 링크는 파트너스 콘솔 또는 오픈 API가 발급합니다. SubID는 채널 구분용입니다.',
  },
  {
    id: 'ohouse-partners',
    label: '오늘의집 파트너스',
    region: 'KR',
    idLabel: '오늘의집 파트너 ID',
    idPlaceholder: 'OH_ROOMCRAFT_77',
    paramKey: 'partner_id',
    consoleUrl: 'https://ohou.se/',
    note: '크리에이터/파트너 프로그램 승인 후 발급되는 ID를 입력하세요.',
  },
  {
    id: 'linkprice',
    label: '링크프라이스',
    region: 'KR',
    idLabel: '링크프라이스 제휴 ID',
    idPlaceholder: 'lp_roomcraft',
    paramKey: 'lptag',
    consoleUrl: 'https://www.linkprice.com/',
    note: '11번가·G마켓·옥션·SSG·롯데온 등 국내 종합몰을 한 계정으로 커버합니다. 머천트별 제휴 승인은 각각 필요합니다.',
  },
  {
    id: 'adpick',
    label: '애드픽',
    region: 'KR',
    idLabel: '애드픽 파트너 코드',
    idPlaceholder: 'ap_roomcraft',
    paramKey: 'ad_id',
    consoleUrl: 'https://adpick.co.kr/',
    note: 'CPA/CPS 혼합 네트워크입니다. 가구 브랜드는 캠페인 단위로 열리고 닫힙니다.',
  },

  // ── 미국 / 글로벌 네트워크 ────────────────────────────────────────────
  {
    id: 'amazon-associates',
    label: 'Amazon Associates (US)',
    region: 'US',
    idLabel: 'Associates Tag (US)',
    idPlaceholder: 'roomcraft-20',
    paramKey: 'tag',
    consoleUrl: 'https://affiliate-program.amazon.com/',
    note: '마켓플레이스마다 태그가 다릅니다. OneLink를 켜면 방문자 국가에 맞는 스토어로 자동 전환됩니다.',
  },
  {
    id: 'impact',
    label: 'Impact',
    region: 'US',
    idLabel: 'Impact Partner ID',
    idPlaceholder: 'imp_roomcraft',
    paramKey: 'clickref',
    consoleUrl: 'https://impact.com/',
    note: 'Wayfair·Article·Houzz·Lumens·IKEA 등 홈퍼니싱 브랜드가 다수 입점한 네트워크입니다.',
  },
  {
    id: 'cj-affiliate',
    label: 'CJ Affiliate',
    region: 'US',
    idLabel: 'CJ Publisher ID (PID)',
    idPlaceholder: '1234567',
    paramKey: 'PID',
    consoleUrl: 'https://www.cj.com/',
    note: '북미 대형 리테일러가 많습니다. 머천트별 개별 승인이 필요합니다.',
  },
  {
    id: 'awin',
    label: 'Awin',
    region: 'US',
    idLabel: 'Awin Affiliate ID',
    idPlaceholder: '1234567',
    paramKey: 'awinaffid',
    consoleUrl: 'https://www.awin.com/',
    note: 'Etsy 등 디자인·핸드메이드 머천트와 유럽 브랜드를 함께 커버합니다.',
  },
  {
    id: 'rakuten-advertising',
    label: 'Rakuten Advertising',
    region: 'US',
    idLabel: 'Rakuten Publisher ID',
    idPlaceholder: 'ra_roomcraft',
    paramKey: 'ranMID',
    consoleUrl: 'https://rakutenadvertising.com/',
    note: '일본 라쿠텐 어필리에이트와는 다른 별도 네트워크입니다. 북미 홈 브랜드가 많습니다.',
  },
  {
    id: 'ebay-epn',
    label: 'eBay Partner Network',
    region: 'US',
    idLabel: 'EPN Campaign ID',
    idPlaceholder: '5338000000',
    paramKey: 'campid',
    consoleUrl: 'https://partnernetwork.ebay.com/',
    note: '빈티지 미드센추리 원본 가구 소싱에 강점이 있습니다.',
  },

  // ── 일본 ──────────────────────────────────────────────────────────────
  {
    id: 'amazon-jp',
    label: 'Amazon アソシエイト (JP)',
    region: 'JP',
    idLabel: 'Associates Tag (JP)',
    idPlaceholder: 'roomcraft-22',
    paramKey: 'tag',
    consoleUrl: 'https://affiliate.amazon.co.jp/',
    note: '일본 스토어는 미국과 별도 가입·별도 태그입니다.',
  },
  {
    id: 'rakuten-affiliate',
    label: '楽天アフィリエイト',
    region: 'JP',
    idLabel: '楽天アフィリエイトID',
    idPlaceholder: '1a2b3c4d.5e6f7g8h',
    paramKey: 'scid',
    consoleUrl: 'https://affiliate.rakuten.co.jp/',
    note: '라쿠텐 회원이면 별도 심사 없이 시작할 수 있어 진입 장벽이 가장 낮습니다.',
  },
  {
    id: 'valuecommerce',
    label: 'バリューコマース',
    region: 'JP',
    idLabel: 'ValueCommerce サイトID',
    idPlaceholder: '1234567',
    paramKey: 'vc_sid',
    consoleUrl: 'https://www.valuecommerce.ne.jp/',
    note: 'Yahoo!ショッピング 계열을 커버하는 일본 최대급 ASP입니다.',
  },
  {
    id: 'a8net',
    label: 'A8.net',
    region: 'JP',
    idLabel: 'A8.net メディアID',
    idPlaceholder: 'a12345678',
    paramKey: 'a8',
    consoleUrl: 'https://www.a8.net/',
    note: 'LOWYA·ニトリ 등 일본 가구 브랜드 프로그램이 모여 있습니다.',
  },

  // ── 중국 ──────────────────────────────────────────────────────────────
  {
    id: 'taobao-alliance',
    label: '淘宝联盟 (阿里妈妈)',
    region: 'CN',
    idLabel: '淘宝客 PID',
    idPlaceholder: 'mm_123456_789_012',
    paramKey: 'pid',
    consoleUrl: 'https://pub.alimama.com/',
    note: '중국 실명 인증 계정이 필요합니다. 해외 거주자는 가입 요건을 먼저 확인하세요.',
  },
  {
    id: 'jd-union',
    label: '京东联盟',
    region: 'CN',
    idLabel: 'JD Union 推广位ID',
    idPlaceholder: 'jd_roomcraft',
    paramKey: 'unionId',
    consoleUrl: 'https://union.jd.com/',
    note: '가전·조명 카테고리 요율이 상대적으로 높습니다.',
  },
  {
    id: 'aliexpress-portals',
    label: 'AliExpress Portals',
    region: 'CN',
    idLabel: 'AliExpress Portals Key',
    idPlaceholder: 'roomcraft_global',
    paramKey: 'aff_trace_key',
    consoleUrl: 'https://portals.aliexpress.com/',
    note: '대형 가구는 배송비·관세 비중이 커서 소품·조명 위주로 전환율이 높습니다.',
  },
  {
    id: 'temu-affiliate',
    label: 'Temu Affiliate',
    region: 'CN',
    idLabel: 'Temu Affiliate ID',
    idPlaceholder: 'tm_roomcraft',
    paramKey: '_x_ads_sub_channel',
    consoleUrl: 'https://www.temu.com/affiliate',
    note: '요율은 높지만 프로모션 정책이 자주 바뀝니다. 정산 조건을 주기적으로 확인하세요.',
  },

  // ── 유럽 ──────────────────────────────────────────────────────────────
  {
    id: 'amazon-eu',
    label: 'Amazon PartnerNet (EU)',
    region: 'EU',
    idLabel: 'Associates Tag (EU)',
    idPlaceholder: 'roomcraft-21',
    paramKey: 'tag',
    consoleUrl: 'https://partnernet.amazon.de/',
    note: 'DE/FR/IT/ES는 EU 통합 프로그램, UK는 별도입니다.',
  },
  {
    id: 'tradedoubler',
    label: 'Tradedoubler',
    region: 'EU',
    idLabel: 'Tradedoubler Affiliate ID',
    idPlaceholder: 'td_roomcraft',
    paramKey: 'tduid',
    consoleUrl: 'https://www.tradedoubler.com/',
    note: '유럽 홈·리빙 브랜드(Westwing, Maisons du Monde 등)를 다수 보유한 네트워크입니다.',
  },

  {
    id: 'direct',
    label: '브랜드 직접 제휴',
    region: 'US',
    idLabel: '브랜드 제휴 코드',
    idPlaceholder: 'roomcraft',
    paramKey: 'ref',
    consoleUrl: '',
    note: '브랜드와 직접 계약한 경우의 공용 슬롯입니다. 조건은 계약서를 따릅니다.',
  },
]

export const programById = (id: ProgramId): AffiliateProgram =>
  PROGRAMS.find((p) => p.id === id) ?? PROGRAMS[PROGRAMS.length - 1]

/** 몰의 성격 — 무드보드 구성에 따라 어느 채널을 밀지 판단하는 근거 */
export type MallStrength = '가구·인테리어 전문' | '종합몰' | '해외직구' | '프리미엄 디자인' | '중고·빈티지'

export interface Mall {
  id: MallId
  label: string
  icon: string
  region: Region
  programId: ProgramId
  strength: MallStrength
  /** 참고용 커미션 구간 (소수). 확정 요율은 각 프로그램 콘솔에서 확인해야 합니다. */
  commissionMin: number
  commissionMax: number
  /** 정산 통화 */
  currency: 'KRW' | 'USD' | 'JPY' | 'CNY' | 'EUR'
  /**
   * 검색 딥링크 생성기.
   * 쇼핑몰이 검색 경로를 개편하면 이 한 줄만 고치면 됩니다.
   */
  searchUrl: (term: string) => string
}

const qs = (base: string, key: string, term: string) => {
  const url = new URL(base)
  url.searchParams.set(key, term)
  return url.toString()
}

/** MALLS 정의를 짧게 유지하기 위한 헬퍼 */
const m = (
  id: MallId,
  label: string,
  icon: string,
  region: Region,
  programId: ProgramId,
  strength: MallStrength,
  commissionMin: number,
  commissionMax: number,
  currency: Mall['currency'],
  searchUrl: (term: string) => string,
): Mall => ({ id, label, icon, region, programId, strength, commissionMin, commissionMax, currency, searchUrl })

export const MALLS: Mall[] = [
  // ── 국내 ──────────────────────────────────────────────────────────────
  m('coupang', '쿠팡', '🛒', 'KR', 'coupang-partners', '종합몰', 0.01, 0.03, 'KRW',
    (t) => qs('https://www.coupang.com/np/search', 'q', t)),
  m('ohouse', '오늘의집', '🏠', 'KR', 'ohouse-partners', '가구·인테리어 전문', 0.01, 0.05, 'KRW',
    (t) => qs('https://ohou.se/search', 'query', t)),
  m('naver', '네이버쇼핑', '🟢', 'KR', 'linkprice', '종합몰', 0.01, 0.04, 'KRW',
    (t) => qs('https://search.shopping.naver.com/search/all', 'query', t)),
  m('11st', '11번가', '1️⃣', 'KR', 'linkprice', '종합몰', 0.01, 0.06, 'KRW',
    (t) => qs('https://search.11st.co.kr/Search.tmall', 'kwd', t)),
  m('gmarket', 'G마켓', '🟩', 'KR', 'linkprice', '종합몰', 0.01, 0.06, 'KRW',
    (t) => qs('https://browse.gmarket.co.kr/search', 'keyword', t)),
  m('auction', '옥션', '🔨', 'KR', 'linkprice', '종합몰', 0.01, 0.06, 'KRW',
    (t) => qs('https://browse.auction.co.kr/search', 'keyword', t)),
  m('ssg', 'SSG닷컴', '🅢', 'KR', 'linkprice', '종합몰', 0.01, 0.05, 'KRW',
    (t) => qs('https://www.ssg.com/search.ssg', 'query', t)),
  m('lotteon', '롯데온', '🔴', 'KR', 'linkprice', '종합몰', 0.01, 0.05, 'KRW',
    (t) => qs('https://www.lotteon.com/search/search/search.ecn', 'render', t)),
  m('hanssem', '한샘몰', '🪑', 'KR', 'adpick', '가구·인테리어 전문', 0.02, 0.08, 'KRW',
    (t) => qs('https://store.hanssem.com/search', 'keyword', t)),
  m('livart', '현대리바트', '🛋', 'KR', 'adpick', '가구·인테리어 전문', 0.02, 0.08, 'KRW',
    (t) => qs('https://www.hyundailivart.co.kr/search', 'keyword', t)),

  // ── 미국 ──────────────────────────────────────────────────────────────
  m('amazon', 'Amazon.com', '📦', 'US', 'amazon-associates', '종합몰', 0.01, 0.04, 'USD',
    (t) => qs('https://www.amazon.com/s', 'k', t)),
  m('wayfair', 'Wayfair', '🛏', 'US', 'impact', '가구·인테리어 전문', 0.03, 0.07, 'USD',
    (t) => qs('https://www.wayfair.com/keyword.php', 'keyword', t)),
  m('westelm', 'West Elm', '🌾', 'US', 'rakuten-advertising', '프리미엄 디자인', 0.02, 0.06, 'USD',
    (t) => qs('https://www.westelm.com/search/results.html', 'words', t)),
  m('crateandbarrel', 'Crate & Barrel', '📐', 'US', 'cj-affiliate', '프리미엄 디자인', 0.02, 0.06, 'USD',
    (t) => qs('https://www.crateandbarrel.com/search', 'query', t)),
  m('article', 'Article', '🪵', 'US', 'impact', '가구·인테리어 전문', 0.03, 0.08, 'USD',
    (t) => qs('https://www.article.com/search', 'q', t)),
  m('houzz', 'Houzz', '🏡', 'US', 'impact', '가구·인테리어 전문', 0.03, 0.07, 'USD',
    (t) => `https://www.houzz.com/products/query/${encodeURIComponent(t)}`),
  m('lumens', 'Lumens', '💡', 'US', 'impact', '프리미엄 디자인', 0.03, 0.08, 'USD',
    (t) => qs('https://www.lumens.com/search', 'q', t)),
  m('etsy', 'Etsy', '🎨', 'US', 'awin', '프리미엄 디자인', 0.02, 0.05, 'USD',
    (t) => qs('https://www.etsy.com/search', 'q', t)),
  m('ebay', 'eBay', '🏷', 'US', 'ebay-epn', '중고·빈티지', 0.01, 0.04, 'USD',
    (t) => qs('https://www.ebay.com/sch/i.html', '_nkw', t)),

  // ── 일본 ──────────────────────────────────────────────────────────────
  m('rakuten-ichiba', '楽天市場', '🇯🇵', 'JP', 'rakuten-affiliate', '종합몰', 0.02, 0.08, 'JPY',
    (t) => `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(t)}/`),
  m('amazon-jp', 'Amazon.co.jp', '📦', 'JP', 'amazon-jp', '종합몰', 0.01, 0.04, 'JPY',
    (t) => qs('https://www.amazon.co.jp/s', 'k', t)),
  m('yahoo-shopping', 'Yahoo!ショッピング', '🟣', 'JP', 'valuecommerce', '종합몰', 0.01, 0.05, 'JPY',
    (t) => qs('https://shopping.yahoo.co.jp/search', 'p', t)),
  m('lowya', 'LOWYA (ロウヤ)', '🌿', 'JP', 'a8net', '가구·인테리어 전문', 0.02, 0.08, 'JPY',
    (t) => qs('https://www.low-ya.com/search', 'keyword', t)),
  m('nitori', 'ニトリ', '🟡', 'JP', 'a8net', '가구·인테리어 전문', 0.01, 0.05, 'JPY',
    (t) => qs('https://www.nitori-net.jp/ec/search/', 'keyword', t)),
  m('muji', '無印良品', '⚪', 'JP', 'a8net', '프리미엄 디자인', 0.01, 0.05, 'JPY',
    (t) => qs('https://www.muji.com/jp/ja/search', 'q', t)),

  // ── 중국 ──────────────────────────────────────────────────────────────
  m('taobao', '淘宝 / 天猫', '🧧', 'CN', 'taobao-alliance', '해외직구', 0.02, 0.1, 'CNY',
    (t) => qs('https://s.taobao.com/search', 'q', t)),
  m('jd', '京东 (JD.com)', '🔺', 'CN', 'jd-union', '해외직구', 0.02, 0.08, 'CNY',
    (t) => qs('https://search.jd.com/Search', 'keyword', t)),
  m('aliexpress', 'AliExpress', '⚡', 'CN', 'aliexpress-portals', '해외직구', 0.03, 0.09, 'USD',
    (t) => qs('https://www.aliexpress.com/wholesale', 'SearchText', t)),
  m('temu', 'Temu', '🟠', 'CN', 'temu-affiliate', '해외직구', 0.03, 0.1, 'USD',
    (t) => qs('https://www.temu.com/search_result.html', 'search_key', t)),
  m('1688', '1688 (도매·소싱)', '🏭', 'CN', 'taobao-alliance', '해외직구', 0.01, 0.05, 'CNY',
    (t) => qs('https://s.1688.com/selloffer/offer_search.htm', 'keywords', t)),

  // ── 유럽 ──────────────────────────────────────────────────────────────
  m('amazon-de', 'Amazon.de', '📦', 'EU', 'amazon-eu', '종합몰', 0.01, 0.04, 'EUR',
    (t) => qs('https://www.amazon.de/s', 'k', t)),
  m('ikea', 'IKEA', '🟦', 'EU', 'impact', '가구·인테리어 전문', 0.02, 0.05, 'EUR',
    (t) => qs('https://www.ikea.com/kr/ko/search/', 'q', t)),
  m('nordicnest', 'Nordic Nest', '❄️', 'EU', 'awin', '프리미엄 디자인', 0.03, 0.08, 'EUR',
    (t) => qs('https://www.nordicnest.com/search/', 'q', t)),
  m('connox', 'Connox', '🔷', 'EU', 'awin', '프리미엄 디자인', 0.03, 0.08, 'EUR',
    (t) => qs('https://www.connox.com/search', 'query', t)),
  m('madeindesign', 'Made in Design', '🇫🇷', 'EU', 'tradedoubler', '프리미엄 디자인', 0.03, 0.07, 'EUR',
    (t) => qs('https://www.madeindesign.co.uk/search', 'q', t)),
  m('westwing', 'Westwing', '🕯', 'EU', 'tradedoubler', '가구·인테리어 전문', 0.03, 0.08, 'EUR',
    (t) => qs('https://www.westwing.de/search/', 'q', t)),
  m('maisonsdumonde', 'Maisons du Monde', '🏛', 'EU', 'tradedoubler', '가구·인테리어 전문', 0.03, 0.07, 'EUR',
    (t) => qs('https://www.maisonsdumonde.com/FR/fr/search', 'q', t)),
]

export const mallById = (id: MallId): Mall => MALLS.find((m) => m.id === id) ?? MALLS[0]

/** 앱 첫 실행 시 켜져 있는 채널 */
export const DEFAULT_ENABLED_MALLS: MallId[] = [
  'coupang',
  'ohouse',
  'naver',
  'amazon',
  'wayfair',
  'rakuten-ichiba',
  'aliexpress',
  'nordicnest',
]

export const EMPTY_AFFILIATE_IDS: AffiliateIds = PROGRAMS.reduce((acc, p) => {
  acc[p.id] = ''
  return acc
}, {} as AffiliateIds)

/**
 * 몰별 검색 딥링크를 생성합니다.
 *
 * 주의: 각 제휴 프로그램의 정식 추적 링크는 파트너 콘솔/API가 발급합니다.
 * 여기서 만드는 링크는 검색 URL + 프로그램 추적 파라미터 형태이며,
 * 승인된 계정에서 파트너 API를 붙일 때는 이 함수 하나만 교체하면 됩니다.
 */
export function buildDeeplink(mallId: MallId, term: string, ids: AffiliateIds): string {
  const mall = mallById(mallId)
  const program = programById(mall.programId)
  const partnerId = (ids[program.id] ?? '').trim()

  const base = mall.searchUrl(term.trim())
  if (!partnerId) return base

  const url = new URL(base)
  url.searchParams.set(program.paramKey, partnerId)
  // AliExpress 는 플랫폼 구분자를 함께 요구합니다.
  if (program.id === 'aliexpress-portals') url.searchParams.set('aff_platform', 'portals')
  return url.toString()
}

/** 상품 하나에 대한 지정 채널 딥링크 모음 */
export function buildDeeplinks(product: Product, mallIds: MallId[], ids: AffiliateIds): Record<string, string> {
  return mallIds.reduce<Record<string, string>>((acc, id) => {
    acc[id] = buildDeeplink(id, product.searchTerm, ids)
    return acc
  }, {})
}

/** 몰 평균 커미션율 (min/max 중앙값) */
export const avgCommission = (mall: Mall): number => (mall.commissionMin + mall.commissionMax) / 2

/** 해당 프로그램의 ID가 입력되어 있는지 */
export const isMallLinked = (mall: Mall, ids: AffiliateIds): boolean =>
  Boolean((ids[mall.programId] ?? '').trim())

export interface CommissionEstimate {
  /** 배치 가구가 전액 구매됐다고 가정한 상한 */
  gross: number
  /** 전환율을 반영한 기대 정산액 */
  expected: number
  conservative: number
  optimistic: number
  avgRate: number
  /** 채널별 상한 기여도 */
  perMall: { mall: Mall; rate: number; gross: number; expected: number }[]
}

/**
 * 예상 제휴 수수료.
 *
 * gross 는 "배치된 가구가 전부 팔렸을 때"의 상한이라 그대로 수익으로 읽으면 안 됩니다.
 * expected 는 클릭 대비 구매 전환율(conversionRate)을 곱한 값으로, 실제 계획에 쓸 수치입니다.
 */
export function estimateCommission(
  totalUsd: number,
  enabledMalls: MallId[],
  conversionRate = 0.02,
): CommissionEstimate {
  const malls = enabledMalls.map(mallById)
  if (!malls.length) {
    return { gross: 0, expected: 0, conservative: 0, optimistic: 0, avgRate: 0, perMall: [] }
  }

  const rates = malls.map(avgCommission)
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length

  // 한 상품은 결국 한 채널에서만 팔리므로, 채널 수를 곱하지 않고 채널별로 균등 배분합니다.
  const share = totalUsd / malls.length

  const perMall = malls.map((mall) => {
    const rate = avgCommission(mall)
    const gross = share * rate
    return { mall, rate, gross, expected: gross * conversionRate }
  })

  const gross = perMall.reduce((s, m) => s + m.gross, 0)
  return {
    gross,
    expected: gross * conversionRate,
    conservative: totalUsd * Math.min(...malls.map((m) => m.commissionMin)) * conversionRate,
    optimistic: totalUsd * Math.max(...malls.map((m) => m.commissionMax)) * conversionRate,
    avgRate,
    perMall,
  }
}
