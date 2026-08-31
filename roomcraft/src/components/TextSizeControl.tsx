import { useEffect, useState } from 'react'

/**
 * 글자 크기 조절.
 *
 * Tailwind 의 text-xs/sm/base 가 rem 기반이라, 루트 폰트 크기 하나만 바꾸면
 * 앱 전체 글자가 비율을 유지한 채 함께 커집니다. 레이아웃은 그대로 두고
 * 가독성만 올릴 수 있습니다.
 */
const STEPS = [
  { id: 'normal', label: '보통', px: 16 },
  { id: 'large', label: '크게', px: 18 },
  { id: 'xlarge', label: '아주 크게', px: 20 },
] as const

type StepId = (typeof STEPS)[number]['id']

const STORAGE_KEY = 'roomcraft-text-size'

function apply(px: number) {
  document.documentElement.style.setProperty('--rc-root-size', `${px}px`)
}

export function TextSizeControl() {
  const [step, setStep] = useState<StepId>('normal')

  useEffect(() => {
    // 저장소 접근이 막힌 환경(시크릿 모드 등)에서도 앱은 정상 동작해야 합니다.
    let saved: string | null = null
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      saved = null
    }
    const found = STEPS.find((s) => s.id === saved)
    if (found) {
      setStep(found.id)
      apply(found.px)
    }
  }, [])

  const choose = (id: StepId) => {
    const found = STEPS.find((s) => s.id === id)
    if (!found) return
    setStep(id)
    apply(found.px)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // 저장에 실패해도 이번 세션에는 적용됩니다.
    }
  }

  return (
    <div
      role="group"
      aria-label="글자 크기"
      title="글자 크기 조절"
      className="flex items-center gap-0.5 rounded-xl border border-line-soft bg-ink-850 p-1"
    >
      <span aria-hidden className="px-1.5 text-xs text-mist-400">
        가
      </span>
      {STEPS.map((s) => (
        <button
          key={s.id}
          onClick={() => choose(s.id)}
          aria-pressed={step === s.id}
          aria-label={`글자 ${s.label}`}
          className={`min-h-[32px] rounded-lg px-2.5 text-xs font-bold transition ${
            step === s.id
              ? 'bg-amber-brand text-on-brand'
              : 'text-mist-300 hover:bg-ink-800 hover:text-mist-200'
          }`}
          style={{ fontSize: `${12 + STEPS.indexOf(s) * 2}px` }}
        >
          가
        </button>
      ))}
    </div>
  )
}
