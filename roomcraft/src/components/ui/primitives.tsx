import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'outline' | 'success' | 'danger' | 'chip'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-amber-brand to-amber-deep text-ink-950 font-semibold hover:brightness-110 shadow-lg shadow-amber-deep/20',
  success:
    'bg-gradient-to-b from-emerald-brand to-emerald-deep text-ink-950 font-semibold hover:brightness-110 shadow-lg shadow-emerald-deep/20',
  outline: 'border border-ink-600 text-mist-200 hover:border-amber-brand/60 hover:text-amber-brand bg-ink-850/60',
  ghost: 'text-mist-300 hover:text-mist-200 hover:bg-ink-800',
  danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10',
  chip: 'border border-ink-700 bg-ink-850 text-mist-300 hover:border-amber-brand/50 hover:text-amber-brand',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'outline', size = 'md', className = '', ...rest }: ButtonProps) {
  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-5 py-3 gap-2',
  }[size]
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-45 ${sizes} ${VARIANTS[variant]} ${className}`}
    />
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'amber' | 'emerald' | 'violet'
}) {
  const tones = {
    neutral: 'bg-ink-700 text-mist-300',
    amber: 'bg-amber-brand/15 text-amber-brand border border-amber-brand/30',
    emerald: 'bg-emerald-brand/15 text-emerald-brand border border-emerald-brand/30',
    violet: 'bg-violet-500/15 text-violet-300 border border-violet-500/30',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${tones}`}>
      {children}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-700 bg-ink-850/80 ${className}`}>{children}</div>
  )
}

export function SectionTitle({
  icon,
  title,
  desc,
  right,
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {icon ? <span className="mt-0.5 text-lg leading-none">{icon}</span> : null}
        <div>
          <h3 className="text-sm font-bold text-mist-200">{title}</h3>
          {desc ? <p className="mt-1 text-xs text-mist-400">{desc}</p> : null}
        </div>
      </div>
      {right}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-mist-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-mist-500">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-mist-200 outline-none transition placeholder:text-ink-500 focus:border-amber-brand/60'

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'emerald' | 'amber'
}) {
  const ring = {
    neutral: 'border-ink-700 bg-ink-850',
    emerald: 'border-emerald-brand/35 bg-emerald-brand/8',
    amber: 'border-amber-brand/35 bg-amber-brand/8',
  }[tone]
  const valueTone = {
    neutral: 'text-mist-200',
    emerald: 'text-emerald-brand',
    amber: 'text-amber-brand',
  }[tone]
  return (
    <div className={`rounded-xl border p-4 ${ring}`}>
      <div className="text-[11px] font-medium text-mist-400">{label}</div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums ${valueTone}`}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-mist-500">{sub}</div> : null}
    </div>
  )
}
