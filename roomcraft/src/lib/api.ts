/**
 * 서버 API 클라이언트.
 *
 * 세션이 httpOnly 쿠키라 모든 요청에 credentials: 'include' 가 필요합니다.
 * 서버가 없을 수도 있으므로(목 모드), 모든 호출은 ApiError 를 던지고
 * 호출부가 폴백을 결정합니다.
 */
export class ApiError extends Error {
  status: number
  code?: string
  payload: unknown

  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.status = status
    this.code = (payload as { code?: string })?.code
    this.payload = payload
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // 본문이 없는 응답 (204 등)
  }

  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `요청 실패 (${res.status})`
    throw new ApiError(res.status, message, body)
  }
  return body as T
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })

export interface ServerUser {
  id: string
  email: string
  displayName: string
  planId: string
  credits: number
  createdAt: number
  emailVerified: boolean
}

export interface HealthInfo {
  ok: boolean
  renderReady: boolean
  chatReady: boolean
  paymentProvider: 'stripe' | 'dev'
  authenticated: boolean
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  signup: (email: string, password: string, displayName?: string) =>
    post<{ user: ServerUser; verificationSent: boolean; devVerifyUrl?: string }>('/auth/signup', {
      email,
      password,
      displayName,
    }),
  verifyEmail: (token: string) => post<{ user: ServerUser }>('/auth/verify', { token }),
  resendVerification: () =>
    post<{ verificationSent: boolean; devVerifyUrl?: string }>('/auth/resend-verification'),
  login: (email: string, password: string) => post<{ user: ServerUser }>('/auth/login', { email, password }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => request<{ user: ServerUser | null }>('/auth/me'),

  checkout: (kind: 'plan' | 'pack', itemId: string) =>
    post<{ provider: 'stripe' | 'dev'; paymentId: string; url?: string; name?: string; amountCents?: number }>(
      '/payments/checkout',
      { kind, itemId },
    ),
  devComplete: (paymentId: string) =>
    post<{ ok: boolean; alreadyFulfilled: boolean; credits: number; planId: string }>('/payments/dev/complete', {
      paymentId,
    }),
  paymentHistory: () =>
    request<{
      payments: {
        id: string
        kind: string
        itemId: string
        amountCents: number
        currency: string
        status: string
        createdAt: number
        paidAt: number | null
      }[]
    }>('/payments/history'),

  ledger: () =>
    request<{ entries: { delta: number; reason: string; ref: string | null; createdAt: number }[] }>(
      '/credits/ledger',
    ),

  /**
   * 내보낼 링크를 발급받습니다. 응답 키는 `${sku}:${mallId}`.
   * 같은 조합은 서버가 기존 토큰을 재사용하므로 통계가 흩어지지 않습니다.
   */
  mintLinks: (
    items: { sku: string; mallId: string; url: string; label: string }[],
    source: string,
  ) =>
    post<{ links: Record<string, string>; rejected: { sku: string; reason: string }[] }>('/links', {
      items,
      source,
    }),

  linkStats: () =>
    request<{
      links: {
        id: string
        sku: string
        mallId: string
        label: string
        source: string
        createdAt: number
        clicks: number
        visitors: number
        lastClick: number | null
      }[]
      totalClicks: number
      byMall: Record<string, number>
      bySku: Record<string, number>
    }>('/links/stats'),

  getState: <T>() => request<{ state: T | null; updatedAt: number | null }>('/sync/state'),
  putState: (state: unknown) => request<{ ok: boolean }>('/sync/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  }),
}
