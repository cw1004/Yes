import { mockChat, mockRender } from './mock'
import { CATALOG } from '../../data/catalog'
import { OutOfCredits } from './types'
import type { ChatRequest, ChatResponse, RenderRequest, RenderResponse } from './types'

export type { ChatRequest, ChatResponse, RenderRequest, RenderResponse }
export { OutOfCredits }

/**
 * 서버 렌더/챗은 로그인과 크레딧을 요구합니다.
 *   401 → 비로그인. 목 프로바이더로 폴백해 데모를 계속할 수 있게 합니다.
 *   402 → 크레딧 부족. 폴백하면 유료 기능이 무료가 되므로 그대로 올립니다.
 */
async function callServer<T>(path: string, body: unknown): Promise<T | 'unauthorized'> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (res.status === 401) return 'unauthorized'

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status === 402) {
    throw new OutOfCredits(String(data?.error ?? '크레딧이 부족합니다.'), Number(data?.balance ?? 0))
  }
  if (!res.ok) throw new Error(String(data?.error ?? `요청 실패 (${res.status})`))
  return data as T
}

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
  if (!(await checkServer())) return mockRender(req)

  try {
    const data = await callServer<{ imageUrl: string; notes?: string[]; credits?: number }>('/api/render', {
      image: req.sourceImage,
      prompt: req.prompt,
      styleId: req.style.id,
      spaceId: req.space.id,
      intensity: req.intensity,
    })
    if (data === 'unauthorized') return mockRender(req)

    return {
      imageUrl: data.imageUrl,
      provider: 'server',
      matchScore: Math.round(90 + (req.intensity / 100) * 9),
      notes: data.notes ?? [],
      credits: data.credits,
    }
  } catch (err) {
    if (err instanceof OutOfCredits) throw err
    // 그 밖의 서버 실패는 사용자가 흐름을 잃지 않도록 목으로 폴백합니다.
    const fallback = await mockRender(req)
    return {
      ...fallback,
      notes: [`서버 렌더 실패로 목 프리뷰를 표시합니다: ${(err as Error).message}`, ...fallback.notes],
    }
  }
}

export async function askDesigner(req: ChatRequest): Promise<ChatResponse> {
  if (!(await checkServer())) return mockChat(req)

  try {
    const data = await callServer<{
      content: string
      recommendations?: string[]
      requestsRerender?: boolean
      credits?: number
    }>('/api/chat', {
      message: req.message,
      history: req.history.map((m) => ({ role: m.role, content: m.content })),
      styleId: req.style.id,
      spaceId: req.space.id,
      moodboard: req.moodboard,
      // 서버 모델이 존재하지 않는 SKU 를 지어내지 않도록 허용 목록을 함께 보냅니다.
      catalog: CATALOG.map((p) => p.sku),
    })
    if (data === 'unauthorized') return mockChat(req)

    return {
      content: data.content,
      recommendations: data.recommendations ?? [],
      provider: 'server',
      requestsRerender: Boolean(data.requestsRerender),
      credits: data.credits,
    }
  } catch (err) {
    if (err instanceof OutOfCredits) throw err
    return mockChat(req)
  }
}
