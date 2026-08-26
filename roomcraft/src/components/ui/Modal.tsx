import { useEffect, type ReactNode } from 'react'

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  headerRight,
  width = 'max-w-5xl',
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  headerRight?: ReactNode
  width?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={`rc-fade-up my-auto w-full ${width} overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-700 bg-ink-850 px-5 py-4">
          <div className="flex items-start gap-3">
            {icon ? (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-brand/15 text-lg">
                {icon}
              </span>
            ) : null}
            <div>
              <h2 className="text-base font-bold text-mist-200">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-xs text-mist-400">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            <button
              onClick={onClose}
              aria-label="닫기"
              className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-ink-800 hover:text-mist-200"
            >
              ✕
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode; badge?: ReactNode }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-3">
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition ${
              on
                ? 'border-amber-brand text-amber-brand'
                : 'border-transparent text-mist-400 hover:text-mist-200'
            }`}
          >
            {t.label}
            {t.badge}
          </button>
        )
      })}
    </div>
  )
}
