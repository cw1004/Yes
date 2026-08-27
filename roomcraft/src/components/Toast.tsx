import { useEffect } from 'react'
import { useStudio } from '../store/useStudio'
import { useAuth } from '../store/useAuth'

export function Toast() {
  const { toast, showToast } = useStudio()
  const authNotice = useAuth((s) => s.notice)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => showToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast, showToast])

  // 계정 관련 안내는 별도 상태라 배너가 사라진 뒤에도 한 번은 보이게 합니다.
  const message = toast || authNotice
  if (!message) return null

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
      <div className="rc-fade-up rounded-xl border border-ink-600 bg-ink-800/95 px-4 py-2.5 text-sm text-mist-200 shadow-2xl backdrop-blur">
        {message}
      </div>
    </div>
  )
}
