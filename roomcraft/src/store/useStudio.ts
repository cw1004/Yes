import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AffiliateIds,
  Product,
  ChatMessage,
  ClientQuote,
  Hotspot,
  MallId,
  MoodboardItem,
  PlanId,
  RenderResult,
  SpaceKind,
  TemplateListing,
} from '../types'
import { productBySku } from '../data/catalog'
import { styleById } from '../data/styles'
import { spaceById } from '../data/spaces'
import { CREDIT_COST, planById } from '../data/plans'
import { DEFAULT_ENABLED_MALLS, EMPTY_AFFILIATE_IDS } from '../lib/affiliate'
import { DEFAULT_QUOTE } from '../lib/quote'
import { buildRenderPrompt } from '../lib/prompt'
import { OutOfCredits, askDesigner, renderMakeover } from '../lib/ai'
import { useAuth } from './useAuth'
import { uid } from '../lib/id'

export type PanelTab = 'designer' | 'spec' | 'earnings'
export type WorkspaceTab = 'makeover' | 'staging' | 'spaces'
export type ModalKind = 'none' | 'monetization' | 'moodboard' | 'plans' | 'auth' | 'account'

interface StudioState {
  // ── 디자인 입력 ─────────────────────────────────────────────
  spaceId: SpaceKind
  styleId: string
  intensity: number
  extras: string[]
  sourceImage: string | null
  sourceName: string | null
  projectName: string

  // ── 렌더 ────────────────────────────────────────────────────
  render: RenderResult | null
  isRendering: boolean
  renderError: string | null
  /** 렌더 이미지 위의 쇼퍼블 태그 */
  hotspots: Hotspot[]

  // ── 상거래 ──────────────────────────────────────────────────
  moodboard: MoodboardItem[]
  affiliateIds: AffiliateIds
  /** 링크를 생성할 제휴 채널 */
  enabledMalls: MallId[]
  /** 클릭 대비 구매 전환율 — 기대 정산액 계산에 사용 */
  conversionRate: number
  quote: ClientQuote
  templates: TemplateListing[]

  // ── 계정 ────────────────────────────────────────────────────
  planId: PlanId
  credits: number

  // ── 대화 ────────────────────────────────────────────────────
  chat: ChatMessage[]
  isChatting: boolean

  // ── UI ──────────────────────────────────────────────────────
  panel: PanelTab
  workspace: WorkspaceTab
  modal: ModalKind
  fullscreen: boolean
  toast: string | null

  // ── 액션 ────────────────────────────────────────────────────
  setSpace: (id: SpaceKind) => void
  setStyle: (id: string) => void
  setIntensity: (v: number) => void
  addExtra: (text: string) => void
  setSource: (dataUrl: string, name: string) => void
  setProjectName: (name: string) => void
  generate: () => Promise<void>

  addHotspot: (sku: string, x?: number, y?: number) => void
  moveHotspot: (id: string, x: number, y: number) => void
  removeHotspot: (id: string) => void
  sendChat: (message: string) => Promise<void>

  addToMoodboard: (sku: string) => void
  removeFromMoodboard: (sku: string) => void
  setQty: (sku: string, qty: number) => void
  syncStyleToMoodboard: () => void
  clearMoodboard: () => void

  setAffiliateIds: (ids: Partial<AffiliateIds>) => void
  toggleMall: (id: MallId) => void
  setEnabledMalls: (ids: MallId[]) => void
  setConversionRate: (rate: number) => void
  setQuote: (patch: Partial<ClientQuote>) => void
  publishTemplate: (title: string, priceUsd: number) => void
  removeTemplate: (id: string) => void
  recordTemplateSale: (id: string) => void

  setPlan: (id: PlanId) => void
  addCredits: (n: number) => void

  setPanel: (p: PanelTab) => void
  setWorkspace: (w: WorkspaceTab) => void
  openModal: (m: ModalKind) => void
  closeModal: () => void
  toggleFullscreen: () => void
  showToast: (msg: string) => void
}

const clamp01 = (v: number) => Math.min(0.97, Math.max(0.03, v))

/**
 * 태그 초기 위치.
 *
 * 렌더마다 가구 배치가 달라 정확한 좌표를 알 수 없으므로 겹치지 않게 펼쳐 놓고
 * 사용자가 드래그로 맞추게 합니다.
 *
 * 가로는 비교 슬라이더 기본값(50%)보다 오른쪽에만 찍습니다. 태그는 After 이미지의
 * 상품이라 Before 쪽에 가려지면 클릭할 수 없는데, 처음부터 절반이 숨어 있으면
 * 태그가 없는 것처럼 보입니다.
 */
const spreadX = (i: number) => clamp01(0.57 + (i % 3) * 0.14)
const spreadY = (i: number) => clamp01(0.4 + Math.floor(i / 3) * 0.18 + (i % 3) * 0.05)

const seedHotspots = (skus: string[]): Hotspot[] =>
  skus.slice(0, 6).map((sku, i) => ({ id: uid('hs'), sku, x: spreadX(i), y: spreadY(i) }))

const greeting = (styleName: string, tagline: string): ChatMessage => ({
  id: uid('msg'),
  role: 'assistant',
  content: `안녕하세요! 저는 RoomCraft의 AI 수석 인테리어 디자이너 **Archie** 입니다.\n\n좌측에서 공간 사진을 올리고 스타일을 고른 뒤 메이크오버를 생성해 주세요.\n\n현재 선택된 스타일은 **${styleName}** — ${tagline}`,
  createdAt: Date.now(),
})

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      spaceId: 'living',
      styleId: 'mid-century-modern',
      intensity: 75,
      extras: [],
      sourceImage: null,
      sourceName: null,
      projectName: 'Modern Apartment Living Room',

      render: null,
      isRendering: false,
      renderError: null,
      hotspots: [],

      moodboard: [],
      affiliateIds: { ...EMPTY_AFFILIATE_IDS },
      enabledMalls: [...DEFAULT_ENABLED_MALLS],
      conversionRate: 0.02,
      quote: { ...DEFAULT_QUOTE },
      templates: [],

      planId: 'pro',
      credits: 85,

      chat: [greeting(styleById('mid-century-modern').name, styleById('mid-century-modern').tagline)],
      isChatting: false,

      panel: 'designer',
      workspace: 'makeover',
      modal: 'none',
      fullscreen: false,
      toast: null,

      setSpace: (id) => set({ spaceId: id }),
      setStyle: (id) => set({ styleId: id }),
      setIntensity: (v) => set({ intensity: Math.min(100, Math.max(10, Math.round(v))) }),
      addExtra: (text) => set((s) => ({ extras: [...s.extras, text].slice(-8) })),
      setSource: (dataUrl, name) =>
        set({ sourceImage: dataUrl, sourceName: name, render: null, renderError: null }),
      setProjectName: (projectName) => set({ projectName }),

      generate: async () => {
        const s = get()
        if (!s.sourceImage) {
          set({ renderError: '먼저 공간 사진을 업로드해 주세요.' })
          return
        }

        /*
         * 여기서 미리 막지 않습니다.
         *
         * 크레딧의 권한은 서버에 있고(로그인이든 게스트든), 서버가 402 로 거절하면
         * 그 메시지를 그대로 보여줍니다. 서버가 없는 목 모드는 API 실비가 들지 않으므로
         * 아예 차감하지 않습니다 — 처음 써보는 사람을 요금제 모달로 막을 이유가 없습니다.
         */

        const style = styleById(s.styleId)
        const space = spaceById(s.spaceId)
        const prompt = buildRenderPrompt({ style, space, intensity: s.intensity, extras: s.extras })

        set({ isRendering: true, renderError: null })
        try {
          const result = await renderMakeover({
            sourceImage: s.sourceImage,
            prompt,
            style,
            space,
            intensity: s.intensity,
          })
          if (result.credits !== undefined) useAuth.getState().setCredits(result.credits)

          set((prev) => ({
            isRendering: false,
            // 크레딧 차감은 서버가 합니다. 목 렌더는 API 실비가 들지 않으므로 차감하지 않습니다.
            credits: prev.credits,
            // 큐레이션 상품으로 태그를 미리 찍어둡니다. 위치는 드래그로 조정합니다.
            hotspots: seedHotspots(style.curatedSkus),
            render: {
              id: uid('render'),
              styleId: style.id,
              spaceId: space.id,
              intensity: s.intensity,
              imageUrl: result.imageUrl,
              prompt,
              createdAt: Date.now(),
              provider: result.provider,
              matchScore: result.matchScore,
              notes: result.notes,
            },
            chat: [
              ...prev.chat,
              {
                id: uid('msg'),
                role: 'assistant',
                content: `**${style.name}** 메이크오버를 생성했습니다. ${style.tagline}\n\n조명은 ${style.lighting} 기준으로 설계했습니다. 스펙시트 탭에서 배치된 가구를 확인하고 무드보드에 담아보세요.`,
                createdAt: Date.now(),
                recommendations: style.curatedSkus.slice(0, 3),
              },
            ],
          }))
        } catch (err) {
          if (err instanceof OutOfCredits) {
            set({ isRendering: false, renderError: err.message, modal: 'plans' })
            useAuth.getState().setCredits(err.balance)
            return
          }
          set({ isRendering: false, renderError: (err as Error).message })
        }
      },

      addHotspot: (sku, x, y) =>
        set((s) => {
          if (!productBySku(sku)) return s
          const index = s.hotspots.length
          return {
            hotspots: [
              ...s.hotspots,
              { id: uid('hs'), sku, x: x ?? spreadX(index), y: y ?? spreadY(index) },
            ],
            toast: '이미지에 태그를 추가했습니다. 드래그해서 위치를 맞추세요.',
          }
        }),

      moveHotspot: (id, x, y) =>
        set((s) => ({
          hotspots: s.hotspots.map((h) =>
            h.id === id ? { ...h, x: clamp01(x), y: clamp01(y) } : h,
          ),
        })),

      removeHotspot: (id) => set((s) => ({ hotspots: s.hotspots.filter((h) => h.id !== id) })),

      sendChat: async (message) => {
        const s = get()
        const trimmed = message.trim()
        if (!trimmed || s.isChatting) return

        const userMsg: ChatMessage = {
          id: uid('msg'),
          role: 'user',
          content: trimmed,
          createdAt: Date.now(),
        }
        set({ chat: [...s.chat, userMsg], isChatting: true, extras: [...s.extras, trimmed].slice(-8) })

        let reply
        try {
          reply = await askDesigner({
            history: s.chat,
            message: trimmed,
            style: styleById(s.styleId),
            space: spaceById(s.spaceId),
            moodboard: s.moodboard
              .map((m) => productBySku(m.sku)?.name)
              .filter((n): n is string => Boolean(n)),
          })
        } catch (err) {
          const message =
            err instanceof OutOfCredits ? err.message : `디자이너 응답을 받지 못했습니다: ${(err as Error).message}`
          if (err instanceof OutOfCredits) useAuth.getState().setCredits(err.balance)
          set((prev) => ({
            isChatting: false,
            modal: err instanceof OutOfCredits ? 'plans' : prev.modal,
            chat: [
              ...prev.chat,
              { id: uid('msg'), role: 'assistant' as const, content: `⚠ ${message}`, createdAt: Date.now() },
            ],
          }))
          return
        }

        if (reply.credits !== undefined) useAuth.getState().setCredits(reply.credits)

        set((prev) => ({
          isChatting: false,
          credits:
            reply.provider === 'server' ? prev.credits : Math.max(0, prev.credits - CREDIT_COST.chatTurn),
          chat: [
            ...prev.chat,
            {
              id: uid('msg'),
              role: 'assistant',
              content: reply.content,
              createdAt: Date.now(),
              recommendations: reply.recommendations,
            },
          ],
        }))
      },

      addToMoodboard: (sku) =>
        set((s) => {
          if (!productBySku(sku)) return s
          const existing = s.moodboard.find((m) => m.sku === sku)
          if (existing) {
            return {
              moodboard: s.moodboard.map((m) => (m.sku === sku ? { ...m, qty: m.qty + 1 } : m)),
              toast: '수량을 1개 추가했습니다.',
            }
          }
          return {
            moodboard: [...s.moodboard, { sku, qty: 1, addedAt: Date.now(), fromStyleId: s.styleId }],
            toast: '무드보드에 담았습니다.',
          }
        }),

      removeFromMoodboard: (sku) => set((s) => ({ moodboard: s.moodboard.filter((m) => m.sku !== sku) })),

      setQty: (sku, qty) =>
        set((s) => ({
          moodboard:
            qty <= 0
              ? s.moodboard.filter((m) => m.sku !== sku)
              : s.moodboard.map((m) => (m.sku === sku ? { ...m, qty } : m)),
        })),

      syncStyleToMoodboard: () =>
        set((s) => {
          const style = styleById(s.styleId)
          const next = [...s.moodboard]
          let added = 0
          for (const sku of style.curatedSkus) {
            if (!next.some((m) => m.sku === sku) && productBySku(sku)) {
              next.push({ sku, qty: 1, addedAt: Date.now(), fromStyleId: style.id })
              added += 1
            }
          }
          return { moodboard: next, toast: `${added}개 항목을 무드보드에 추가했습니다.` }
        }),

      clearMoodboard: () => set({ moodboard: [], toast: '무드보드를 비웠습니다.' }),

      setAffiliateIds: (ids) => set((s) => ({ affiliateIds: { ...s.affiliateIds, ...ids } })),

      toggleMall: (id) =>
        set((s) => ({
          enabledMalls: s.enabledMalls.includes(id)
            ? s.enabledMalls.filter((m) => m !== id)
            : [...s.enabledMalls, id],
        })),

      setEnabledMalls: (ids) => set({ enabledMalls: ids }),

      setConversionRate: (rate) => set({ conversionRate: Math.min(0.2, Math.max(0.001, rate)) }),
      setQuote: (patch) => set((s) => ({ quote: { ...s.quote, ...patch } })),

      publishTemplate: (title, priceUsd) =>
        set((s) => ({
          templates: [
            {
              id: uid('tpl'),
              title: title || `${styleById(s.styleId).nameEn} — ${spaceById(s.spaceId).labelEn}`,
              styleId: s.styleId,
              spaceId: s.spaceId,
              priceUsd,
              sales: 0,
              createdAt: Date.now(),
            },
            ...s.templates,
          ],
          toast: '템플릿을 마켓에 등록했습니다.',
        })),

      removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      recordTemplateSale: (id) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, sales: t.sales + 1 } : t)),
        })),

      setPlan: (id) =>
        set((s) => ({
          planId: id,
          credits: s.credits + planById(id).monthlyCredits,
          toast: `${planById(id).name} 플랜으로 변경되었습니다. 크레딧 ${planById(id).monthlyCredits} 지급.`,
        })),

      addCredits: (n) => set((s) => ({ credits: s.credits + n, toast: `${n} 크레딧을 충전했습니다.` })),

      setPanel: (panel) => set({ panel }),
      setWorkspace: (workspace) => set({ workspace }),
      openModal: (modal) => set({ modal }),
      closeModal: () => set({ modal: 'none' }),
      toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
      showToast: (toast) => set({ toast }),
    }),
    {
      name: 'roomcraft-studio',
      version: 2,
      /**
       * v1 은 몰마다 ID를 따로 저장했습니다(coupangSubId 등). v2 부터는
       * 프로그램 단위 레코드라, 기존에 입력해 둔 ID를 대응되는 프로그램으로 옮깁니다.
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version >= 2) return state
        const legacy = (state.affiliateIds ?? {}) as Record<string, string>
        state.affiliateIds = {
          ...EMPTY_AFFILIATE_IDS,
          'coupang-partners': legacy.coupangSubId ?? '',
          'ohouse-partners': legacy.ohousePartnerId ?? '',
          'amazon-associates': legacy.amazonTag ?? '',
          'aliexpress-portals': legacy.aliexpressKey ?? '',
        }
        state.enabledMalls = [...DEFAULT_ENABLED_MALLS]
        state.conversionRate = 0.02
        return state
      },
      /**
       * 렌더 결과와 원본 사진은 data URL 이라 용량이 커서 localStorage 쿼터를 넘길 수 있습니다.
       * 세션 간 유지가 필요한 상거래/계정 상태만 영속화합니다.
       */
      partialize: (s) => ({
        spaceId: s.spaceId,
        styleId: s.styleId,
        intensity: s.intensity,
        projectName: s.projectName,
        moodboard: s.moodboard,
        affiliateIds: s.affiliateIds,
        enabledMalls: s.enabledMalls,
        conversionRate: s.conversionRate,
        quote: s.quote,
        templates: s.templates,
        planId: s.planId,
        credits: s.credits,
      }),
    },
  ),
)

/**
 * 화면에 표시할 플랜.
 *
 * 로그인 상태에서는 결제로 부여된 서버 플랜이 진실입니다.
 * 비로그인 데모에서만 로컬 선택값을 씁니다.
 */
export function useActivePlanId(): string {
  const serverUser = useAuth((s) => s.user)
  const local = useStudio((s) => s.planId)
  return serverUser?.planId ?? local
}

/**
 * 화면에 표시할 크레딧.
 *
 * 로그인 상태에서는 서버 잔액이 진실입니다. 비로그인 데모에서는 로컬 잔액을 씁니다.
 */
export function useCredits(): { credits: number; isServer: boolean } {
  const serverUser = useAuth((s) => s.user)
  const local = useStudio((s) => s.credits)
  return serverUser ? { credits: serverUser.credits, isServer: true } : { credits: local, isServer: false }
}

/**
 * 무드보드 합계 (파생 상태).
 *
 * zustand v5 의 셀렉터는 반환값을 참조 비교하므로, 매 호출마다 새 객체를 만드는
 * 셀렉터를 그대로 넘기면 무한 리렌더가 발생합니다. 원본 배열만 구독하고
 * 파생 계산은 useMemo 로 감쌉니다.
 */
export function useMoodboardTotals() {
  const moodboard = useStudio((s) => s.moodboard)

  return useMemo(() => {
    const rows = moodboard
      .map((m) => {
        const product = productBySku(m.sku)
        return product ? { product, qty: m.qty } : null
      })
      .filter((r): r is { product: Product; qty: number } => Boolean(r))

    const total = rows.reduce((sum, r) => sum + r.product.price * r.qty, 0)
    const count = rows.reduce((sum, r) => sum + r.qty, 0)
    return { rows, total, count }
  }, [moodboard])
}
