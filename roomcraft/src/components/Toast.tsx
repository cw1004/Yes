import { useEffect } from 'react'
import { useStudio } from '../store/useStudio'

export function Toast() {
  const { toast, showToast } = useStudio()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => showToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast, showToast])

  if (!toast) return null

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
      <div className="rc-fade-up rounded-xl border border-ink-600 bg-ink-800/95 px-4 py-2.5 text-sm text-mist-200 shadow-2xl backdrop-blur">
        {toast}
      </div>
    </div>
  )
}
