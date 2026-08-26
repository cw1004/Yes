import { useEffect, useState } from 'react'
import { useStudio } from './store/useStudio'
import { checkServer } from './lib/ai'
import { Header } from './components/Header'
import { CanvasStudio } from './components/CanvasStudio'
import { SidePanel } from './components/SidePanel'
import { MonetizationModal } from './components/monetization/MonetizationModal'
import { MoodboardModal } from './components/MoodboardModal'
import { Toast } from './components/Toast'

export default function App() {
  const fullscreen = useStudio((s) => s.fullscreen)
  const [serverReady, setServerReady] = useState<boolean | null>(null)

  useEffect(() => {
    void checkServer().then(setServerReady)
  }, [])

  return (
    <div className="min-h-screen bg-ink-950">
      <Header />

      {serverReady === false ? (
        <div className="border-b border-amber-brand/25 bg-amber-brand/8 px-4 py-2 text-center text-[11px] text-amber-brand">
          렌더 서버가 연결되지 않아 <strong>목(mock) 프리뷰 모드</strong>로 동작합니다 — 실제 AI 렌더는{' '}
          <code className="rounded bg-ink-800 px-1">.env</code> 에 API 키를 넣고{' '}
          <code className="rounded bg-ink-800 px-1">npm run server</code> 를 실행하면 활성화됩니다.
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
      <Toast />
    </div>
  )
}
