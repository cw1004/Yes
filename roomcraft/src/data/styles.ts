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
    // palette[0] 은 그 스타일의 지배색(벽에 칠할 수 있는 색)이어야 합니다.
    // 원래 강조색인 번트오렌지가 앞에 있어서 3D 에서 벽까지 주황색이 됐습니다.
    palette: ['#f2ede4', '#7a6a5c', '#c96f4a', '#3f6f52', '#d8a03a'],
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
    curatedSkus: ['minotti-andersen', 'gr-mirror', 'flos-arco', 'baxter-tactile', 'hotel-velvet-bench', 'milan-castiglioni-taccia'],
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
  // ── Modern ────────────────────────────────────────────────────────────
  {
    id: 'modern-contemporary',
    name: '모던 컨템포러리 (Modern Contemporary)',
    nameEn: 'Modern Contemporary',
    family: 'modern',
    tagline: '군더더기 없는 직선, 넓은 여백, 한 점의 조각 같은 조명',
    promptCore:
      'modern contemporary interior: clean rectilinear volumes, full-height windows, matte lacquer and honed stone, ' +
      'a restrained greige palette with one deep accent, sculptural statement lighting, generous negative space, ' +
      'no visible clutter, architectural shadow lines',
    lighting: '3000K 매입 다운라이트 + 조각적 스탠드 1점',
    palette: ['#f2f0ec', '#cdc9c2', '#8d8a85', '#4a4845', '#1d1c1b'],
    signatureItems: ['조각적 아크 플로어 램프', '허니드 스톤 다이닝 테이블'],
    curatedSkus: ['poliform-mondrian', 'knoll-tulip-table', 'artemide-tolomeo', 'nanimarquina-rug', 'usm-shelf-tall'],
    previewGradient: 'linear-gradient(135deg,#f2f0ec,#a5a29c 55%,#4a4845)',
  },
  {
    id: 'bauhaus-functional',
    name: '바우하우스 기능주의 (Bauhaus Functional)',
    nameEn: 'Bauhaus Functional',
    family: 'modern',
    tagline: '형태는 기능을 따른다 — 원색 삼원색과 튜브 스틸의 정직한 구조',
    promptCore:
      'bauhaus functional interior: exposed tubular chrome steel frames, primary red blue yellow accents on white, ' +
      'geometric grid composition, honest exposed construction, leather sling seating, flat planes, ' +
      'no ornament, industrial precision',
    lighting: '4000K 중성광 직부 조명 및 튜브 스틸 스탠드',
    palette: ['#ffffff', '#d8dadd', '#c8352c', '#1f4e9c', '#f0b52a'],
    signatureItems: ['튜브 스틸 캔틸레버 체어', '그리드 모듈러 선반'],
    curatedSkus: ['knoll-barcelona', 'usm-shelf-tall', 'vitra-eames-dsw', 'artemide-tolomeo'],
    previewGradient: 'linear-gradient(135deg,#ffffff,#c8352c 55%,#1f4e9c)',
  },
  {
    id: 'soft-modern-curve',
    name: '소프트 모던 커브 (Soft Modern Curve)',
    nameEn: 'Soft Modern Curve',
    family: 'modern',
    tagline: '모서리를 없앤 곡선 가구와 부클레, 아치형 개구부',
    promptCore:
      'soft modern curved interior: rounded organic furniture with no visible legs, bouclé and chenille upholstery, ' +
      'arched doorways and niches, plaster-finished walls, warm sand and blush palette, ' +
      'curved plinth bases, soft diffused shadows, nothing sharp-edged',
    lighting: '2700K 확산 간접광, 아치 코브 조명',
    palette: ['#f4ece2', '#e0cfc0', '#c9ae9a', '#9a8272', '#5f5049'],
    signatureItems: ['레그리스 부클레 라운지 체어', '아치형 코브 조명 벽'],
    curatedSkus: ['gubi-pacha', 'ligne-togo', 'maximal-velvet-sofa', 'louis-panthella', 'nanimarquina-rug'],
    previewGradient: 'linear-gradient(135deg,#f4ece2,#d6bda9 55%,#9a8272)',
  },
  {
    id: 'monochrome-gallery',
    name: '모노크롬 갤러리 (Monochrome Gallery)',
    nameEn: 'Monochrome Gallery',
    family: 'modern',
    tagline: '흑백 단 두 색, 작품 하나를 위해 비워둔 벽',
    promptCore:
      'monochrome gallery interior: strictly black white and grey, museum-white walls, ' +
      'one oversized artwork as the only focal point, black steel details, polished concrete or pale oak floor, ' +
      'track lighting aimed at art, zero colour, disciplined negative space',
    lighting: '3500K 작품 조사용 트랙 조명',
    palette: ['#ffffff', '#e2e2e2', '#9b9b9b', '#4a4a4a', '#111111'],
    signatureItems: ['대형 무프레임 캔버스', '블랙 스틸 트랙 조명'],
    curatedSkus: ['gallery-canvas', 'gallery-plinth', 'astro-track', 'knoll-barcelona', 'usm-haller-2x2'],
    previewGradient: 'linear-gradient(135deg,#ffffff,#9b9b9b 55%,#111111)',
  },
  {
    id: 'brutalist-concrete',
    name: '브루탈리스트 콘크리트 (Brutalist Concrete)',
    nameEn: 'Brutalist Concrete',
    family: 'modern',
    tagline: '거푸집 자국이 살아있는 노출 콘크리트와 육중한 매스',
    promptCore:
      'brutalist concrete interior: board-formed exposed concrete walls with visible formwork grain, ' +
      'heavy monolithic masses, raw steel and smoked glass, minimal furniture in dark leather, ' +
      'deep shadow, single shaft of daylight, unfinished honesty of materials',
    lighting: '단일 자연광 유입 + 2700K 저조도 스팟',
    palette: ['#c4c1bb', '#9a978f', '#6d6a64', '#403e3b', '#211f1d'],
    signatureItems: ['노출 콘크리트 벤치', '스모크 글라스 파티션'],
    curatedSkus: ['cassina-lc4', 'gallery-plinth', 'industrial-cart', 'astro-track', 'maxwell-leather'],
    previewGradient: 'linear-gradient(135deg,#c4c1bb,#6d6a64 55%,#211f1d)',
  },

  // ── Minimal ───────────────────────────────────────────────────────────
  {
    id: 'muji-quiet',
    name: '무지 콰이어트 (Muji Quiet)',
    nameEn: 'Muji Quiet',
    family: 'minimal',
    tagline: '규격이 맞아떨어지는 수납, 무표백 면과 오크, 브랜드가 보이지 않는 조용함',
    promptCore:
      'muji-style quiet interior: unbleached cotton and linen, pale oak veneer modular storage, ' +
      'everything sized to a consistent module, no visible branding or logos, soft white walls, ' +
      'items stored out of sight, calm and utilitarian, natural daylight',
    lighting: '3000K 균일 확산광, 그림자를 거의 만들지 않는 배광',
    palette: ['#faf8f3', '#e8e1d3', '#c9a978', '#9a9188', '#544f48'],
    signatureItems: ['오크 스태킹 셸프', '워시드 커버 소파'],
    curatedSkus: ['muji-oak-sofa', 'muji-stacking-shelf', 'artek-stool60', 'menu-jwda', 'hay-nesting'],
    previewGradient: 'linear-gradient(135deg,#faf8f3,#dfd3ba 55%,#9a9188)',
  },
  {
    id: 'gallery-white',
    name: '갤러리 화이트 (Gallery White)',
    nameEn: 'Gallery White',
    family: 'minimal',
    tagline: '벽도 바닥도 흰색, 가구는 좌대처럼 놓인 몇 점뿐',
    promptCore:
      'gallery white interior: all-white walls floor and ceiling, furniture placed like objects on plinths, ' +
      'very few pieces with wide spacing between them, museum lighting, no textiles except one wool rug, ' +
      'shadow used as the only contrast, extreme restraint',
    lighting: '4000K 균일 갤러리 조명 + 국부 스팟',
    palette: ['#ffffff', '#f4f4f2', '#dedcd8', '#a8a6a1', '#3c3b39'],
    signatureItems: ['마블 플린스 사이드 테이블', '무프레임 대형 캔버스'],
    curatedSkus: ['gallery-plinth', 'gallery-canvas', 'knoll-tulip-table', 'nanimarquina-rug', 'louis-panthella'],
    previewGradient: 'linear-gradient(135deg,#ffffff,#e6e5e2 55%,#a8a6a1)',
  },
  {
    id: 'korean-modern-hanok',
    name: '한국 모던 한옥 (Korean Modern Hanok)',
    nameEn: 'Korean Modern Hanok',
    family: 'minimal',
    tagline: '한지 창호로 걸러진 빛, 좌식 동선, 나전과 옻칠의 깊이',
    promptCore:
      'korean modern hanok interior: hanji paper sliding screens diffusing daylight, low floor-seating arrangement, ' +
      'exposed dark timber beams against white plaster, ottchil lacquer and mother-of-pearl inlay accents, ' +
      'onggi ceramics, warm ondol floor tone, restrained traditional geometry, deep eave shadow',
    lighting: '한지 창호 확산 자연광 + 2400K 저조도 간접광',
    palette: ['#f2ece0', '#d8c9a8', '#a98a5f', '#6b4a34', '#2e2721'],
    signatureItems: ['나전 소반', '한지 창호 미닫이'],
    curatedSkus: ['hanok-soban', 'hanok-changhoji', 'hanok-nubi-cushion', 'karimoku-ns01', 'wabi-ceramic-vessel'],
    previewGradient: 'linear-gradient(135deg,#f2ece0,#b99a72 55%,#4a3a2c)',
  },

  // ── Luxury ────────────────────────────────────────────────────────────
  {
    id: 'art-deco-revival',
    name: '아르데코 리바이벌 (Art Deco Revival)',
    nameEn: 'Art Deco Revival',
    family: 'luxury',
    tagline: '부챗살 문양, 흑단과 황동, 고광택 래커의 1920년대',
    promptCore:
      'art deco revival interior: fan and sunburst motifs, high-gloss black lacquer and ebony, ' +
      'polished brass inlay lines, fluted and stepped forms, emerald and sapphire velvet, ' +
      'geometric marble floor inlay, mirrored surfaces, 1920s glamour with modern restraint',
    lighting: '2700K 브라스 샹들리에 + 미러 반사광',
    palette: ['#0f1b24', '#16202a', '#c9a227', '#1e5b47', '#e8e2d4'],
    signatureItems: ['래커 & 브라스 바 카비넷', '선버스트 브라스 미러'],
    curatedSkus: ['deco-bar-cabinet', 'deco-fan-mirror', 'maximal-velvet-sofa', 'flos-arco', 'gr-mirror'],
    previewGradient: 'linear-gradient(135deg,#0f1b24,#1e5b47 55%,#c9a227)',
  },
  {
    id: 'parisian-haussmann',
    name: '파리지앵 오스만 (Parisian Haussmann)',
    nameEn: 'Parisian Haussmann',
    family: 'luxury',
    tagline: '헤링본 파케이, 보아즈리 몰딩, 대리석 벽난로가 있는 파리 아파트',
    promptCore:
      'parisian haussmann apartment interior: herringbone parquet floor, ornate boiserie wall panelling, ' +
      'carrara marble fireplace mantel, tall french windows with wrought-iron juliet balcony, ' +
      'high ceilings with cornice mouldings, mix of antique and modern, chalk-white and warm oak palette',
    lighting: '높은 창의 자연광 + 2700K 크리스탈 샹들리에',
    palette: ['#f5f1e8', '#e0d6c4', '#c3a882', '#8a7154', '#3d3428'],
    signatureItems: ['보아즈리 벽 패널', '카라라 대리석 맨틀'],
    curatedSkus: ['paris-boiserie', 'paris-marble-mantel', 'cassina-lc4', 'gr-mirror', 'nanimarquina-rug'],
    previewGradient: 'linear-gradient(135deg,#f5f1e8,#c3a882 55%,#5d4d38)',
  },
  {
    id: 'italian-milanese',
    name: '밀라네제 모더니즘 (Italian Milanese)',
    nameEn: 'Italian Milanese',
    family: 'luxury',
    tagline: '재단된 듯한 봉제선, 트래버틴과 브론즈, 이탈리아 디자인의 자신감',
    promptCore:
      'italian milanese modernist interior: sartorial tailored upholstery with visible piping, ' +
      'travertine and burl walnut surfaces, bronzed metal details, low-slung generous sofas, ' +
      'terrazzo or marble flooring, warm ochre and olive accents, confident 1970s Milan proportion',
    lighting: '2700K 블로운 글라스 조명 + 브론즈 반사',
    palette: ['#efe6d6', '#d3bd97', '#9d7f4f', '#6b5a3e', '#2f2a24'],
    signatureItems: ['타치아 테이블 램프', '트래버틴 로우 테이블'],
    curatedSkus: ['milan-castiglioni-taccia', 'baxter-tactile', 'poliform-mondrian', 'gallery-plinth', 'cassina-lc4'],
    previewGradient: 'linear-gradient(135deg,#efe6d6,#b99a63 55%,#4d4335)',
  },
  {
    id: 'hotel-suite-luxe',
    name: '호텔 스위트 럭스 (Hotel Suite Luxe)',
    nameEn: 'Hotel Suite Luxe',
    family: 'luxury',
    tagline: '5성급 객실의 레이어드 침구, 침대 벤치, 매입 조명',
    promptCore:
      'five-star hotel suite interior: layered bedding with crisp white linens and a folded throw, ' +
      'upholstered headboard wall, bed-end bench, symmetrical nightstands with integrated reading lights, ' +
      'blackout drapery, deep pile rug, muted taupe and bronze palette, hospitality-grade finish',
    lighting: '2700K 매입 조명 + 좌우 대칭 리딩 라이트',
    palette: ['#f0ece4', '#cfc4b2', '#8f8171', '#4f4740', '#b08d3e'],
    signatureItems: ['벨벳 침대 벤치', '조명 내장 협탁'],
    curatedSkus: ['hotel-velvet-bench', 'hotel-nightstand', 'hastens-bed', 'sferra-linen', 'bedroom-blackout'],
    previewGradient: 'linear-gradient(135deg,#f0ece4,#a89684 55%,#4f4740)',
  },
  {
    id: 'dark-academia-library',
    name: '다크 아카데미아 서재 (Dark Academia Library)',
    nameEn: 'Dark Academia Library',
    family: 'luxury',
    tagline: '천장까지 닿는 책장, 체스터필드 가죽, 초록 갓 스탠드',
    promptCore:
      'dark academia library interior: floor-to-ceiling stained oak bookcases full of books, ' +
      'deep-buttoned chesterfield leather seating, green glass banker lamps, dark green and oxblood palette, ' +
      'brass rolling ladder, worn persian rug, low warm light, scholarly and enclosed',
    lighting: '2400K 국부 스탠드 조명, 전체는 어둡게',
    palette: ['#1f2b25', '#3a2a20', '#5b3a2a', '#a8843f', '#e0d6c0'],
    signatureItems: ['천장형 오크 책장 + 사다리', '뱅커스 그린 램프'],
    curatedSkus: ['academia-bookcase', 'academia-chesterfield', 'academia-green-lamp', 'maxwell-leather', 'gr-mirror'],
    previewGradient: 'linear-gradient(135deg,#1f2b25,#5b3a2a 55%,#a8843f)',
  },

  // ── Eclectic ──────────────────────────────────────────────────────────
  {
    id: 'bohemian-marrakech',
    name: '보헤미안 마라케시 (Bohemian Marrakech)',
    nameEn: 'Bohemian Marrakech',
    family: 'eclectic',
    tagline: '타공 황동 등이 만드는 문양 그림자, 라탄과 베르베르 러그의 층',
    promptCore:
      'bohemian marrakech interior: pierced brass lanterns casting patterned shadows on walls, ' +
      'layered berber and kilim rugs, handwoven rattan seating, zellige tile accents, ' +
      'low floor cushions, arched niches, saffron terracotta and indigo palette, plants in every corner',
    lighting: '2200K 타공 황동 랜턴, 패턴 그림자 강조',
    palette: ['#efe7d6', '#d99a55', '#b5892f', '#2f5d6b', '#5e4413'],
    signatureItems: ['타공 황동 펜던트 랜턴', '베니 우라인 울 러그'],
    curatedSkus: ['boho-brass-lantern', 'boho-beni-rug', 'boho-rattan-chair', 'hanok-nubi-cushion', 'medi-olive-tree'],
    previewGradient: 'linear-gradient(135deg,#efe7d6,#d99a55 55%,#2f5d6b)',
  },
  {
    id: 'maximalist-jewel',
    name: '맥시멀리스트 주얼 (Maximalist Jewel)',
    nameEn: 'Maximalist Jewel',
    family: 'eclectic',
    tagline: '에메랄드와 사파이어, 손으로 그린 실크 벽지, 비어있는 벽이 없음',
    promptCore:
      'maximalist jewel-tone interior: hand-painted chinoiserie silk wallpaper, emerald sapphire and ruby velvet, ' +
      'layered patterns that repeat colour rather than motif, gallery-hung art covering the walls, ' +
      'brass and lacquer, deliberate abundance with a controlled palette, no empty surface',
    lighting: '2700K 다층 조명 — 샹들리에 · 테이블 램프 · 픽처 라이트',
    palette: ['#1e5b47', '#123a5e', '#7b2233', '#c9a86a', '#f0e6d2'],
    signatureItems: ['핸드페인티드 실크 벽지', '에메랄드 벨벳 곡선 소파'],
    curatedSkus: ['maximal-mural-wallpaper', 'maximal-velvet-sofa', 'deco-fan-mirror', 'vintage-gallery-wall', 'boho-beni-rug'],
    previewGradient: 'linear-gradient(135deg,#1e5b47,#7b2233 55%,#c9a86a)',
  },
  {
    id: 'retro-70s-lounge',
    name: '레트로 70s 라운지 (Retro 70s Lounge)',
    nameEn: 'Retro 70s Lounge',
    family: 'eclectic',
    tagline: '컨버세이션 핏, 코듀로이와 크롬, 번트 오렌지의 시대',
    promptCore:
      'retro 1970s lounge interior: sunken conversation pit seating in wide-wale corduroy, ' +
      'chrome and smoked glass, burnt orange mustard and avocado palette, shag pile rug, ' +
      'wood-panelled feature wall, space-age chrome lamps, low horizontal proportion',
    lighting: '2700K 크롬 머쉬룸 램프 + 우드월 간접광',
    palette: ['#e8d4a8', '#c9782f', '#a95f2a', '#6b7040', '#3c2f22'],
    signatureItems: ['모듈러 컨버세이션 핏 소파', '크롬 머쉬룸 램프'],
    curatedSkus: ['retro70-conversation-pit', 'retro70-chrome-arc', 'hm-eames-lounge', 'ferm-wool-rug', 'vintage-flea-sideboard'],
    previewGradient: 'linear-gradient(135deg,#e8d4a8,#c9782f 55%,#3c2f22)',
  },
  {
    id: 'memphis-postmodern',
    name: '멤피스 포스트모던 (Memphis Postmodern)',
    nameEn: 'Memphis Postmodern',
    family: 'eclectic',
    tagline: '규칙을 깨는 원색 블록, 테라조 컨페티, 기울어진 기하학',
    promptCore:
      'memphis postmodern interior: asymmetric primary-colour laminate blocks, squiggle and confetti terrazzo, ' +
      'tilted geometric forms that refuse rectangles, black-and-white graphic patterns, ' +
      'playful clashing colour used with confidence, 1980s Sottsass energy',
    lighting: '4000K 중성광 — 색을 왜곡하지 않는 배광',
    palette: ['#f5f2ea', '#e04a3f', '#f2c230', '#2a7fbe', '#1c1b1a'],
    signatureItems: ['멤피스 칼튼 룸 디바이더', '테라조 컨페티 커피 테이블'],
    curatedSkus: ['memphis-carlton', 'memphis-terrazzo-table', 'vitra-eames-dsw', 'retro70-chrome-arc'],
    previewGradient: 'linear-gradient(135deg,#f5f2ea,#e04a3f 55%,#2a7fbe)',
  },
  {
    id: 'vintage-eclectic-flea',
    name: '빈티지 에클레틱 (Vintage Eclectic)',
    nameEn: 'Vintage Eclectic',
    family: 'eclectic',
    tagline: '시대가 다른 물건들이 한 방에서 어울리는, 수집된 집',
    promptCore:
      'vintage eclectic collected interior: mismatched antique frames in a dense gallery wall, ' +
      'restored mid-century teak beside older turned-wood pieces, worn leather and faded textiles, ' +
      'objects that clearly have history, warm layered browns with one unexpected colour, ' +
      'looks accumulated over years rather than bought at once',
    lighting: '2700K 국부 조명 다수, 균일하지 않은 배광',
    palette: ['#e6dcc8', '#c2a06a', '#8a5a30', '#5c3a1c', '#3a4a3f'],
    signatureItems: ['복원 1960s 티크 사이드보드', '빈티지 액자 갤러리월'],
    curatedSkus: ['vintage-flea-sideboard', 'vintage-gallery-wall', 'academia-chesterfield', 'boho-beni-rug', 'hm-noguchi-table'],
    previewGradient: 'linear-gradient(135deg,#e6dcc8,#a3763f 55%,#3a4a3f)',
  },

  // ── Natural ───────────────────────────────────────────────────────────
  {
    id: 'wabi-sabi-earth',
    name: '와비사비 어스 (Wabi-Sabi Earth)',
    nameEn: 'Wabi-Sabi Earth',
    family: 'natural',
    tagline: '라임워시 벽의 얼룩, 라이브엣지 원목, 완전하지 않아서 아름다운',
    promptCore:
      'wabi-sabi earthen interior: limewash mineral walls with cloudy uneven tone, live-edge solid timber, ' +
      'hand-thrown ash-glazed ceramics, raw linen, visible repair and patina celebrated, ' +
      'muted clay and stone palette, one shaft of low afternoon light, deliberate imperfection',
    lighting: '낮은 각도의 자연광 + 2200K 국부 조명 최소',
    palette: ['#e2d9c8', '#c0b09a', '#9a8b74', '#6d5f4d', '#3b3229'],
    signatureItems: ['라임워시 미네랄 벽', '라이브엣지 느릅나무 벤치'],
    curatedSkus: ['wabi-limewash', 'wabi-elm-bench', 'wabi-ceramic-vessel', 'karimoku-ns01', 'nanimarquina-rug'],
    previewGradient: 'linear-gradient(135deg,#e2d9c8,#9a8b74 55%,#3b3229)',
  },
  {
    id: 'mediterranean-terracotta',
    name: '메디터레이니언 테라코타 (Mediterranean Terracotta)',
    nameEn: 'Mediterranean Terracotta',
    family: 'natural',
    tagline: '손으로 구운 테라코타 바닥, 회벽 아치, 올리브 나무',
    promptCore:
      'mediterranean terracotta interior: handmade terracotta floor tiles with irregular edges, ' +
      'thick lime-plastered white walls with rounded arch openings, exposed timber ceiling beams, ' +
      'woven rush seating, potted olive trees, deep window reveals, sun-bleached ochre and sea-blue accents',
    lighting: '강한 자연광과 깊은 그림자 대비 + 2700K 보조광',
    palette: ['#f2ece0', '#e0c9a6', '#c1703f', '#6f7d54', '#2f5d6b'],
    signatureItems: ['핸드메이드 테라코타 타일', '올리브 나무 화분'],
    curatedSkus: ['medi-terracotta-tile', 'medi-olive-tree', 'medi-rush-chair', 'farm-linen-curtain', 'wabi-ceramic-vessel'],
    previewGradient: 'linear-gradient(135deg,#f2ece0,#c1703f 55%,#2f5d6b)',
  },
  {
    id: 'farmhouse-provence',
    name: '프로방스 팜하우스 (Provence Farmhouse)',
    nameEn: 'Provence Farmhouse',
    family: 'natural',
    tagline: '10인용 원목 식탁, 접시가 보이는 오픈 선반, 세이지 그린 페인트',
    promptCore:
      'provence farmhouse interior: long reclaimed-oak trestle dining table, hand-painted sage-green joinery, ' +
      'open plate racks with everyday ceramics on display, washed belgian linen curtains, ' +
      'lime-plastered walls, terracotta and pewter accents, lavender and dried herbs, unpretentious warmth',
    lighting: '큰 창의 자연광 + 2700K 펜던트 2~3등',
    palette: ['#f3eee2', '#dcd2bd', '#c2a479', '#8e9a8c', '#5c5548'],
    signatureItems: ['프로방스 트레슬 식탁 240cm', '페인티드 웰시 드레서'],
    curatedSkus: ['farm-provence-table', 'farm-dresser', 'farm-linen-curtain', 'medi-rush-chair', 'kitchen-open-shelf'],
    previewGradient: 'linear-gradient(135deg,#f3eee2,#c2a479 55%,#8e9a8c)',
  },
  {
    id: 'desert-southwest',
    name: '데저트 사우스웨스트 (Desert Southwest)',
    nameEn: 'Desert Southwest',
    family: 'natural',
    tagline: '어도비 벽, 새들 가죽과 주트, 사막의 지평선',
    promptCore:
      'desert southwest interior: adobe plaster walls in warm sand, saddle leather and walnut furniture, ' +
      'flatweave jute rugs with southwest geometry, cacti and dried grasses, ' +
      'wide horizon artwork, sun-baked clay and turquoise accents, deep-set windows, dry warm light',
    lighting: '강한 서향 자연광 + 2400K 저조도 보조광',
    palette: ['#f0e2cf', '#d3b184', '#c98d5f', '#9a5f43', '#6d8290'],
    signatureItems: ['새들 가죽 슬링 체어', '사우스웨스트 주트 러그'],
    curatedSkus: ['desert-leather-sling', 'desert-jute-rug', 'desert-saguaro-art', 'wabi-ceramic-vessel', 'medi-olive-tree'],
    previewGradient: 'linear-gradient(135deg,#f0e2cf,#c98d5f 55%,#6d8290)',
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
