import type { RenderRequest, RenderResponse, ChatRequest, ChatResponse } from './types'
import { productBySku } from '../../data/catalog'
import { renderScene } from '../room/scene'

/**
 * API 키 없이도 앱 전체 흐름(렌더 -> 스펙시트 -> 무드보드 -> 수익화)을 확인할 수 있게 하는
 * 로컬 목 프로바이더입니다. 원본 사진에 스타일 팔레트 기반 컬러 그레이딩을 적용해
 * "After" 프리뷰를 캔버스에서 합성합니다. 실제 가구 배치는 서버 프로바이더가 담당합니다.
 */
export async function mockRender(req: RenderRequest): Promise<RenderResponse> {
  /*
   * Before 가 앱이 생성한 샘플 방이면 같은 기하 위에 스타일을 적용해 다시 그립니다.
   * 벽·바닥 재질, 가구 색, 조명, 러그·식물·액자가 실제로 바뀌므로 Before/After 가
   * 눈에 띄게 달라집니다. 컬러 그레이딩만으로는 두 장이 거의 같아 보였습니다.
   *
   * 사용자가 올린 사진에는 이렇게 할 수 없습니다 — 사진 속 가구를 실제로 바꾸려면
   * 이미지 생성 모델이 필요하고, 그건 서버 프로바이더(GEMINI_API_KEY)의 몫입니다.
   */
  if (req.sourceIsSample) {
    const imageUrl = renderScene({
      space: req.space.id,
      style: req.style,
      intensity: req.intensity,
      label: 'AI 시안 (목 프리뷰 · API 키 미설정)',
    })
    await delay(700)
    return {
      imageUrl,
      provider: 'mock',
      matchScore: Math.round(86 + (req.intensity / 100) * 12),
      notes: [
        '샘플 공간에 스타일을 적용해 다시 렌더했습니다. 실제 사진의 가구 배치 변경은 서버에 API 키를 설정하면 활성화됩니다.',
        `적용 강도 ${req.intensity}% — ${req.style.nameEn}`,
      ],
    }
  }

  const img = await loadImage(req.sourceImage)
  const maxW = 1280
  const scale = Math.min(1, maxW / img.width)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context를 생성하지 못했습니다.')

  // 강도가 높을수록 원본에서 더 멀어지는 그레이딩
  const t = req.intensity / 100
  ctx.filter = [
    `saturate(${(1 + t * 0.35).toFixed(2)})`,
    `contrast(${(1 + t * 0.18).toFixed(2)})`,
    `brightness(${(1 + t * 0.06).toFixed(2)})`,
    `sepia(${(t * 0.22).toFixed(2)})`,
  ].join(' ')
  ctx.drawImage(img, 0, 0, w, h)
  ctx.filter = 'none'

  // 스타일 팔레트를 소프트라이트로 덧입혀 톤을 이동시킵니다.
  const grad = ctx.createLinearGradient(0, 0, w, h)
  const palette = req.style.palette
  palette.forEach((c, i) => grad.addColorStop(i / Math.max(1, palette.length - 1), c))
  ctx.globalAlpha = 0.18 + t * 0.22
  ctx.globalCompositeOperation = 'soft-light'
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // 웜톤 조명 느낌의 코너 글로우
  ctx.globalCompositeOperation = 'overlay'
  const glow = ctx.createRadialGradient(w * 0.72, h * 0.18, 0, w * 0.72, h * 0.18, Math.max(w, h) * 0.7)
  glow.addColorStop(0, 'rgba(255,214,150,0.55)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.35 + t * 0.2
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // 비네팅
  ctx.globalCompositeOperation = 'multiply'
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  vig.addColorStop(0, 'rgba(255,255,255,1)')
  vig.addColorStop(1, 'rgba(120,110,100,1)')
  ctx.globalAlpha = 0.5
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1

  // 목 렌더임을 명확히 표기 (실제 결과물로 오인되지 않도록)
  const badge = 'MOCK PREVIEW · API 키 미설정'
  ctx.font = `600 ${Math.max(13, Math.round(w * 0.016))}px system-ui, sans-serif`
  const tw = ctx.measureText(badge).width
  const pad = Math.round(w * 0.012)
  ctx.fillStyle = 'rgba(12,12,14,0.72)'
  ctx.fillRect(pad, h - pad - 30, tw + pad * 2, 30)
  ctx.fillStyle = '#f5c877'
  ctx.fillText(badge, pad * 2, h - pad - 10)

  await delay(650)

  return {
    imageUrl: canvas.toDataURL('image/jpeg', 0.9),
    provider: 'mock',
    matchScore: Math.round(84 + t * 14),
    notes: [
      '목 프로바이더는 컬러 그레이딩만 수행합니다. 실제 가구 배치·구조 변경은 서버에 API 키를 설정하면 활성화됩니다.',
      `적용 강도 ${req.intensity}% — ${req.style.nameEn}`,
    ],
  }
}

export async function mockChat(req: ChatRequest): Promise<ChatResponse> {
  await delay(500)
  const msg = req.message.trim()
  const picks = req.style.curatedSkus.slice(0, 3)
  const names = picks.map((s) => productBySku(s)?.name).filter(Boolean) as string[]

  const rerenderHints = ['변경', '바꿔', '다시', '러그', '컬러', '색', '레이아웃', '배치', 'change', 'swap']
  const requestsRerender = rerenderHints.some((k) => msg.toLowerCase().includes(k))

  const content = msg
    ? [
        `요청을 반영했습니다: **${msg}**`,
        '',
        `${req.style.name} 기준으로 ${req.space.label} 구성을 다음과 같이 제안합니다.`,
        `- 조명: ${req.style.lighting}`,
        `- 핵심 아이템: ${req.style.signatureItems.join(', ')}`,
        names.length ? `- 추천 제품: ${names.join(' / ')}` : '',
        '',
        requestsRerender
          ? '변경 사항을 적용하려면 상단의 **Re-Generate Makeover** 를 눌러 다시 렌더해 주세요.'
          : '더 필요한 조정이 있으면 말씀해 주세요.',
        '',
        '_(목 응답입니다. 서버에 API 키를 설정하면 실제 디자이너 모델이 답변합니다.)_',
      ]
        .filter(Boolean)
        .join('\n')
    : `안녕하세요! 저는 RoomCraft의 AI 수석 인테리어 디자이너 **Archie** 입니다.\n\n선택하신 공간에 **${req.style.name}** 메이크오버를 생성했습니다. ${req.style.tagline}\n\n어떻게 커스터마이징할까요? (예: "구조는 유지하고 러그를 네이비 울 텍스처로 변경해줘")`

  return { content, recommendations: picks, provider: 'mock', requestsRerender }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'))
    img.src = src
  })
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
