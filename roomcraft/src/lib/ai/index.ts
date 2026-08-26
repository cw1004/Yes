import { mockChat, mockRender } from './mock'
import { CATALOG } from '../../data/catalog'
import type { ChatRequest, ChatResponse, RenderRequest, RenderResponse } from './types'

export type { ChatRequest, ChatResponse, RenderRequest, RenderResponse }

let serverAvailable: boolean | null = null
/** StrictMode 의 이펙트 이중 실행으로 health 요청이 두 번 나가지 않도록 in-flight 프로미스를 공유합니다. */
let inFlight: Promise<boolean> | null = null

/** /api/health 를 한 번만 확인하고 결과를 캐시합니다. */
export async function checkServer(): Promise<boolean> {
  if (serverAvailable !== null) return serverAvailable
  if (inFlight) return inFlight
  inFlight = probe().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function probe(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { renderReady?: boolean }
    serverAvailable = Boolean(data.renderReady)
  } catch {
    serverAvailable = false
  }
  return serverAvailable
}

export async function renderMakeover(req: RenderRequest): Promise<RenderResponse> {
  if (await checkServer()) {
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image: req.sourceImage,
          prompt: req.prompt,
          styleId: req.style.id,
          spaceId: req.space.id,
          intensity: req.intensity,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { imageUrl: string; notes?: string[] }
      return {
        imageUrl: data.imageUrl,
        provider: 'server',
        matchScore: Math.round(90 + (req.intensity / 100) * 9),
        notes: data.notes ?? [],
      }
    } catch (err) {
      // 서버 렌더 실패 시 사용자가 흐름을 잃지 않도록 목으로 폴백합니다.
      const fallback = await mockRender(req)
      return {
        ...fallback,
        notes: [`서버 렌더 실패로 목 프리뷰를 표시합니다: ${(err as Error).message}`, ...fallback.notes],
      }
    }
  }
  return mockRender(req)
}

export async function askDesigner(req: ChatRequest): Promise<ChatResponse> {
  if (await checkServer()) {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: req.message,
          history: req.history.map((m) => ({ role: m.role, content: m.content })),
          styleId: req.style.id,
          spaceId: req.space.id,
          moodboard: req.moodboard,
          // 서버 모델이 존재하지 않는 SKU 를 지어내지 않도록 허용 목록을 함께 보냅니다.
          catalog: CATALOG.map((p) => p.sku),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as {
        content: string
        recommendations?: string[]
        requestsRerender?: boolean
      }
      return {
        content: data.content,
        recommendations: data.recommendations ?? [],
        provider: 'server',
        requestsRerender: Boolean(data.requestsRerender),
      }
    } catch {
      return mockChat(req)
    }
  }
  return mockChat(req)
}
