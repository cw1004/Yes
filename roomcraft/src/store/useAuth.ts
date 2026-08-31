import type { HealthInfo } from '../lib/api'
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
  /** health 응답 전체 — 어떤 AI 기능이 살아 있는지 UI 가 알아야 합니다. */
  health: HealthInfo | null
  paymentProvider: 'stripe' | 'dev' | null
  loading: boolean
  error: string | null
  /** 메일 서버가 없는 개발 환경에서만 채워지는 링크 */
  devVerifyUrl: string | null
  devResetUrl: string | null
  /** URL 에서 읽은 비밀번호 재설정 토큰 */
  resetToken: string | null
  notice: string | null
  /** dev 결제 확인 모달에 표시할 정보 */
  pendingPayment: { paymentId: string; name: string; amountCents: number } | null

  init: () => Promise<void>
  signup: (email: string, password: string) => Promise<boolean>
  verifyEmail: (token: string) => Promise<boolean>
  requestPasswordReset: (email: string) => Promise<boolean>
  resetPassword: (token: string, password: string) => Promise<boolean>
  setResetToken: (token: string | null) => void
  resendVerification: () => Promise<void>
  clearNotice: () => void
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
  health: null,
  paymentProvider: null,
  loading: false,
  error: null,
  devVerifyUrl: null,
  devResetUrl: null,
  resetToken: null,
  notice: null,
  pendingPayment: null,

  init: async () => {
    try {
      const health = await api.health()
      set({ serverAvailable: health.ok, paymentProvider: health.paymentProvider, health })
      const { user } = await api.me()
      set({ user })
    } catch {
      // 서버가 없으면 로컬 데모 모드로 계속 동작합니다.
      set({ serverAvailable: false, user: null, health: null })
    }
  },

  signup: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const { user, devVerifyUrl } = await api.signup(email, password)
      // 크레딧은 이메일 인증을 마쳐야 지급됩니다.
      set({
        user,
        loading: false,
        devVerifyUrl: devVerifyUrl ?? null,
        notice: '가입되었습니다. 이메일 인증을 마치면 Free 크레딧이 지급됩니다.',
      })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '가입에 실패했습니다.' })
      return false
    }
  },

  verifyEmail: async (token) => {
    set({ loading: true, error: null })
    try {
      const { user } = await api.verifyEmail(token)
      set({ user, loading: false, devVerifyUrl: null, notice: '이메일 인증이 완료되었습니다. 크레딧이 지급되었습니다.' })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '인증에 실패했습니다.' })
      return false
    }
  },

  requestPasswordReset: async (email) => {
    set({ loading: true, error: null })
    try {
      const { devResetUrl } = await api.requestPasswordReset(email)
      // 서버는 계정 존재 여부와 무관하게 같은 응답을 줍니다. 안내 문구도 동일해야 합니다.
      set({
        loading: false,
        devResetUrl: devResetUrl ?? null,
        notice: '가입된 이메일이라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.',
      })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '요청에 실패했습니다.' })
      return false
    }
  },

  resetPassword: async (token, password) => {
    set({ loading: true, error: null })
    try {
      const { user } = await api.resetPassword(token, password)
      set({
        user,
        loading: false,
        resetToken: null,
        devResetUrl: null,
        notice: '비밀번호가 변경되었습니다. 다른 기기의 로그인은 모두 해제되었습니다.',
      })
      return true
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '재설정에 실패했습니다.' })
      return false
    }
  },

  setResetToken: (resetToken) => set({ resetToken }),

  resendVerification: async () => {
    set({ loading: true, error: null })
    try {
      const { devVerifyUrl } = await api.resendVerification()
      set({ loading: false, devVerifyUrl: devVerifyUrl ?? null, notice: '인증 메일을 다시 보냈습니다.' })
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : '재발송에 실패했습니다.' })
    }
  },

  clearNotice: () => set({ notice: null }),

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
