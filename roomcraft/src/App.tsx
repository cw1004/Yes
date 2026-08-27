import { useEffect, useState } from 'react'
import { useStudio } from './store/useStudio'
import { useAuth } from './store/useAuth'
import { checkServer } from './lib/ai'
import { Header } from './components/Header'
import { CanvasStudio } from './components/CanvasStudio'
import { SidePanel } from './components/SidePanel'
import { MonetizationModal } from './components/monetization/MonetizationModal'
import { MoodboardModal } from './components/MoodboardModal'
import { AuthModal, DevPaymentModal } from './components/AuthModal'
import { VerifyBanner } from './components/VerifyBanner'
import { AccountModal } from './components/AccountModal'
import { Toast } from './components/Toast'

export default function App() {
  const fullscreen = useStudio((s) => s.fullscreen)
  const modal = useStudio((s) => s.modal)
  const closeModal = useStudio((s) => s.closeModal)
  const openModal = useStudio((s) => s.openModal)
  const showToast = useStudio((s) => s.showToast)
  const initAuth = useAuth((s) => s.init)
  const refreshAuth = useAuth((s) => s.refresh)
  const [serverReady, setServerReady] = useState<boolean | null>(null)

  useEffect(() => {
    void checkServer().then(setServerReady)
    void initAuth()
  }, [initAuth])

  // Stripe Checkout 에서 돌아온 경우: 지급은 웹훅이 하므로 여기서는 잔액만 다시 읽습니다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')
    if (!payment) return

    if (payment === 'success') {
      showToast('결제가 접수되었습니다. 크레딧 반영까지 잠시 걸릴 수 있습니다.')
      void refreshAuth()
      // 웹훅이 도착할 시간을 준 뒤 한 번 더 확인합니다.
      const t = setTimeout(() => void refreshAuth(), 3000)
      window.history.replaceState({}, '', window.location.pathname)
      return () => clearTimeout(t)
    }

    showToast('결제가 취소되었습니다.')
    window.history.replaceState({}, '', window.location.pathname)
  }, [refreshAuth, showToast])

  return (
    <div className="min-h-screen bg-ink-950">
      <Header />
      <VerifyBanner />

      {serverReady === false ? (
        <div className="border-b border-amber-brand/25 bg-amber-brand/8 px-4 py-2 text-center text-[11px] text-amber-brand">
          렌더 서버가 연결되지 않아 <strong>목(mock) 프리뷰 모드</strong>로 동작합니다 — 실제 AI 렌더는{' '}
          <code className="rounded bg-ink-800 px-1">.env</code> 에 API 키를 넣고{' '}
          <code className="rounded bg-ink-800 px-1">npm run server</code> 를 실행하면 활성화됩니다.{' '}
          <button onClick={() => openModal('auth')} className="underline hover:text-mist-200">
            로그인
          </button>{' '}
          하면 크레딧이 서버에 저장됩니다.
        </div>
      ) : null}

      <main
        className={`mx-auto grid max-w-[1720px] gap-4 p-4 ${
          fullscreen ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)]'
        }`}
      >
        <CanvasStudio />
        {!fullscreen ? <SidePanel /> : null}
      </main>

      <footer className="mx-auto max-w-[1720px] px-4 pb-8 pt-2 text-[11px] leading-relaxed text-mist-500">
        <p>
          RoomCraft AI — 생성된 이미지는 실제 시공 결과와 다를 수 있으며, 구조·전기·배관 변경은 반드시 전문가 검토가
          필요합니다. 제품 가격은 참고용이며 실제 판매가와 다를 수 있습니다.
        </p>
      </footer>

      <MonetizationModal />
      <MoodboardModal />
      <AccountModal />
      <AuthModal open={modal === 'auth'} onClose={closeModal} />
      <DevPaymentModal />
      <Toast />
    </div>
  )
}
