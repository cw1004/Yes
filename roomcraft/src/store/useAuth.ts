import { create } from 'zustand'
import { ApiError, api, type ServerUser } from '../lib/api'

/**
 * 계정 상태.
 *
 * 서버가 없거나(목 모드) 로그아웃 상태면 user 는 null 이고, 스튜디오는 로컬 크레딧으로 동작합니다.
 * 로그인하면 크레딧의 권한이 서버로 넘어갑니다 — 클라이언트는 서버가 알려준 잔액을 표시만 합니다.
 */
interface AuthState {
  user: ServerUser | null
  serverAvailable: boolean
  paymentProvider: 'stripe' | 'dev' | null
  loading: boolean
  error: string | null
  /** dev 결제 확인 모달에 표시할 정보 */
  pendingPayment: { paymentId: string; name: string; amountCents: number } | null

  init: () => Promise<void>
  signup: (email: string, password: string) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  clearError: () => void

  /** 서버가 알려준 최신 잔액을 반영 */
  setCredits: (credits: number) => void
  refresh: () => Promise<void>

  startCheckout: (kind: 'plan' | 'pack', itemId: string) => Promise<void>
  confirmDevPayment: () => Promise<void>
  cancelDevPayment: () => void
}

export const useAuth = create<AuthState>()((set, get) => ({
  user: null,
  serverAvailable: false,
  paymentProvider: null,
  loading: false,
  error: null,
  pendingPayment: null,

  init: async () => {
    try {
      const health = await api.health()
      set({ serverAvailable: health.ok, paymentProvider: health.paymentProvider })
      const { user } = await api.me()
      set({ user })
    } catch {
      // 서버가 없으면 로컬 데모 모드로 계속 동작합니다.
      set({ serverAvailable: false, user: null })
    }
  },

  signup: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const { user } = await api.signup(email, password)
      set({ user, loading: false })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '가입에 실패했습니다.' })
      return false
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const { user } = await api.login(email, password)
      set({ user, loading: false })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '로그인에 실패했습니다.' })
      return false
    }
  },

  logout: async () => {
    try {
      await api.logout()
    } finally {
      set({ user: null })
    }
  },

  clearError: () => set({ error: null }),

  setCredits: (credits) => set((s) => (s.user ? { user: { ...s.user, credits } } : s)),

  refresh: async () => {
    if (!get().serverAvailable) return
    try {
      const { user } = await api.me()
      set({ user })
    } catch {
      set({ user: null })
    }
  },

  startCheckout: async (kind, itemId) => {
    set({ loading: true, error: null })
    try {
      const session = await api.checkout(kind, itemId)
      if (session.provider === 'stripe' && session.url) {
        // Stripe 결제창으로 이동합니다. 지급은 웹훅이 처리합니다.
        window.location.href = session.url
        return
      }
      set({
        loading: false,
        pendingPayment: {
          paymentId: session.paymentId,
          name: session.name ?? '결제',
          amountCents: session.amountCents ?? 0,
        },
      })
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '결제를 시작하지 못했습니다.' })
    }
  },

  confirmDevPayment: async () => {
    const pending = get().pendingPayment
    if (!pending) return
    set({ loading: true })
    try {
      const result = await api.devComplete(pending.paymentId)
      set((s) => ({
        loading: false,
        pendingPayment: null,
        user: s.user ? { ...s.user, credits: result.credits, planId: result.planId } : s.user,
      }))
    } catch (err) {
      set({
        loading: false,
        pendingPayment: null,
        error: err instanceof ApiError ? err.message : '결제 처리에 실패했습니다.',
      })
    }
  },

  cancelDevPayment: () => set({ pendingPayment: null }),
}))
