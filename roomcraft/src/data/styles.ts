import type { DesignStyle } from '../types'

/**
 * 디자인 아키타입.
 * promptCore 는 렌더 프롬프트 조립(lib/prompt.ts)에 그대로 삽입됩니다.
 */
export const STYLES: DesignStyle[] = [
  {
    id: 'mid-century-modern',
    name: '미드센추리 모던 (Mid-Century Modern)',
    nameEn: 'Mid-Century Modern',
    family: 'modern',
    tagline: '1950년대 건축적 우아함, 따뜻한 월넛 원목과 아이코닉한 실루엣',
    promptCore:
      'mid-century modern interior: warm walnut and teak wood tones, tapered legs, architectural furniture silhouettes, ' +
      'muted olive and burnt-orange accents, brass hardware, low-profile seating, geometric textiles',
    lighting: '2700K 웜톤 무드 조명 및 브라스 스탠드 조명',
    palette: ['#c96f4a', '#3f6f52', '#d8a03a', '#7a6a5c', '#f2ede4'],
    signatureItems: ['임스 스타일 라운지 체어', '월넛 텐바보드 사이드보드'],
    curatedSkus: ['hm-eames-lounge', 'usm-haller-2x2', 'flos-arco', 'hm-noguchi-table', 'gubi-beetle', 'ch24-wishbone'],
    previewGradient: 'linear-gradient(135deg,#4a3728,#8a5230 55%,#c96f4a)',
  },
  {
    id: 'scandinavian-hygge',
    name: '스칸디나비안 휘게 (Scandinavian Hygge)',
    nameEn: 'Scandinavian Hygge',
    family: 'minimal',
    tagline: '밝은 오크 원목, 따스한 화이트, 포근한 부클레 텍스처와 미니멀 감성',
    promptCore:
      'scandinavian hygge interior: pale oak wood, warm white walls, cream bouclé and wool textiles, ' +
      'layered soft lighting, uncluttered surfaces, functional storage, natural daylight from large windows',
    lighting: '3000K 확산 간접 조명 및 다층 램프 배치',
    palette: ['#ffffff', '#e8e1d5', '#cbbfae', '#8f8a7f', '#4a4741'],
    signatureItems: ['페일 오크 네스팅 커피테이블', '크림 부클레 모듈 소파'],
    curatedSkus: ['muuto-connect', 'hay-nesting', 'ph5-pendant', 'string-shelf', 'ferm-wool-rug'],
    previewGradient: 'linear-gradient(135deg,#f4efe6,#dcd3c4 55%,#b7ac9b)',
  },
  {
    id: 'japandi-serenity',
    name: '재팬디 세레니티 (Japandi Serenity)',
    nameEn: 'Japandi Serenity',
    family: 'minimal',
    tagline: '와비사비의 고요함과 북유럽 실용 미니멀리즘의 완벽한 조화',
    promptCore:
      'japandi interior: wabi-sabi restraint, low-profile solid oak furniture, linen and washi textures, ' +
      'plaster walls, negative space, a single sculptural ceramic, muted greige and charcoal palette',
    lighting: '2400K 저조도 간접광, 그림자를 살린 조명 설계',
    palette: ['#e6e0d4', '#b9a68c', '#8a8175', '#4f4a42', '#26241f'],
    signatureItems: ['로우 프로파일 평상형 소파', '수직 오크 루버 아트월'],
    curatedSkus: ['karimoku-ns01', 'ariake-oak-table', 'maruni-hiroshima', 'ambientec-turn'],
    previewGradient: 'linear-gradient(135deg,#dfd8ca,#a89a86 55%,#6f665a)',
  },
  {
    id: 'biophilic-sanctuary',
    name: '바이오필릭 생츄어리 (Biophilic Sanctuary)',
    nameEn: 'Biophilic Sanctuary',
    family: 'natural',
    tagline: '싱그러운 플랜테리어, 천연 트래버틴 스톤과 유기적 자연 텍스처',
    promptCore:
      'biophilic interior: abundant large-leaf indoor plants, travertine and raw stone surfaces, ' +
      'rattan and jute textures, organic curved forms, earthy green and sand palette, generous natural light',
    lighting: '자연광 극대화 + 3000K 식물 성장 보조 스팟',
    palette: ['#2f5d3a', '#7d9a6b', '#d6c6a8', '#b08d54', '#f0ece3'],
    signatureItems: ['뱅갈고무나무 및 몬스테라 플랜테리어', '천연 트래버틴 원석 테이블'],
    curatedSkus: ['menu-androgyne', 'monstera-xl', 'ferm-bau-pot', 'kettal-mesh'],
    previewGradient: 'linear-gradient(135deg,#24402c,#4f7a4a 55%,#a8b98f)',
  },
  {
    id: 'industrial-loft',
    name: '인더스트리얼 소호 로프트 (Industrial Loft)',
    nameEn: 'Industrial Soho Loft',
    family: 'eclectic',
    tagline: '노출 콘크리트와 빈티지 가죽, 뉴욕 소호의 원형 그대로',
    promptCore:
      'industrial soho loft interior: exposed concrete and brick, black steel window frames, ' +
      'aged cognac leather, raw timber beams, track lighting, oversized factory windows, high ceilings',
    lighting: '블랙 레일 조명 + 에디슨 필라멘트 팬던트',
    palette: ['#2b2b2d', '#75787b', '#8a5230', '#b9b2a6', '#d9d4c9'],
    signatureItems: ['풀그레인 코냑 가죽 소파', '블랙 스틸 레일 조명'],
    curatedSkus: ['maxwell-leather', 'vitra-ea108', 'tolix-a', 'astro-track'],
    previewGradient: 'linear-gradient(135deg,#1e1e20,#4a4a4d 55%,#8a5230)',
  },
  {
    id: 'modern-luxury-glam',
    name: '모던 럭셔리 글램 (Modern Luxury Glam)',
    nameEn: 'Modern Luxury Glam',
    family: 'luxury',
    tagline: '브러시드 브라스, 스모크 글래스, 딥 벨벳의 호텔 스위트 감성',
    promptCore:
      'modern luxury glam interior: brushed brass detailing, fumé smoked glass, deep velvet upholstery, ' +
      'book-matched marble, layered ambient and accent lighting, hotel-suite proportions',
    lighting: '2700K 디밍 가능한 레이어드 조명 (앰비언트 + 액센트)',
    palette: ['#1c1b19', '#3d3a35', '#b39a6b', '#6b4a5a', '#efe9df'],
    signatureItems: ['슬림 브라스 레그 벨벳 소파', '원형 브라스 벽거울'],
    curatedSkus: ['minotti-andersen', 'gr-mirror', 'flos-arco'],
    previewGradient: 'linear-gradient(135deg,#171614,#3f3a33 55%,#b39a6b)',
  },
  {
    id: 'warm-minimal',
    name: '웜 미니멀리즘 (Warm Minimalism)',
    nameEn: 'Warm Minimalism',
    family: 'minimal',
    tagline: '색은 덜어내고 질감은 더하는, 절제된 따뜻함',
    promptCore:
      'warm minimalist interior: limewash plaster walls, monochrome sand palette, hidden storage, ' +
      'a single statement artwork, matte finishes, no visible clutter, soft shadow gradients',
    lighting: '2700K 코브 간접 조명, 눈부심 없는 확산광',
    palette: ['#f1ece3', '#ddd4c6', '#b3a795', '#6f665a', '#332f2a'],
    signatureItems: ['라임워시 플라스터 벽면', '히든 스토리지 월'],
    curatedSkus: ['karimoku-ns01', 'hay-nesting', 'ferm-wool-rug', 'ambientec-turn'],
    previewGradient: 'linear-gradient(135deg,#efe8dd,#c9bfae 55%,#8e8474)',
  },
  {
    id: 'coastal-calm',
    name: '코스탈 캄 (Coastal Calm)',
    nameEn: 'Coastal Calm',
    family: 'natural',
    tagline: '표백된 목재와 리넨, 바다에서 온 빛과 여백',
    promptCore:
      'coastal calm interior: bleached driftwood tones, off-white linen, pale blue accents, ' +
      'woven rattan, airy sheer curtains, sun-washed daylight, sand-toned flooring',
    lighting: '자연 채광 중심 + 4000K 화이트 보조광',
    palette: ['#f6f4ef', '#dfe6e6', '#a8bfc4', '#cbb99c', '#5c6b70'],
    signatureItems: ['라탄 위빙 라운지 체어', '표백 오크 다이닝 테이블'],
    curatedSkus: ['kettal-mesh', 'ariake-oak-table', 'ferm-wool-rug', 'ph5-pendant'],
    previewGradient: 'linear-gradient(135deg,#eef2f1,#bcd0d3 55%,#8fa3a8)',
  },
]

export const styleById = (id: string): DesignStyle =>
  STYLES.find((s) => s.id === id) ?? STYLES[0]

export const STYLE_FAMILIES: { id: StyleFamilyFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'modern', label: '모던' },
  { id: 'minimal', label: '미니멀' },
  { id: 'luxury', label: '럭셔리' },
  { id: 'eclectic', label: '에클레틱' },
  { id: 'natural', label: '내추럴/전통' },
]

export type StyleFamilyFilter = 'all' | DesignStyle['family']
