import { useEffect } from 'react'
import { useStudio } from '../store/useStudio'
import { useAuth } from '../store/useAuth'

export function Toast() {
  const { toast, showToast, modal } = useStudio()
  const authNotice = useAuth((s) => s.notice)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => showToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast, showToast])

  /*
   * 계정 안내는 인증 모달 안에도 표시됩니다.
   * 모달이 열려 있는 동안 토스트까지 띄우면 같은 문장이 화면에 두 번 나옵니다.
   */
  const message = toast || (modal === 'auth' ? null : authNotice)
  if (!message) return null

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
      <div className="rc-fade-up rounded-xl border border-ink-600 bg-ink-800/95 px-4 py-2.5 text-sm text-mist-200 shadow-2xl backdrop-blur">
        {message}
      </div>
    </div>
  )
}
