import { useEffect, useState } from 'react'

/**
 * 밝게 / 어둡게 전환.
 *
 * 색은 컴포넌트가 아니라 index.css 의 토큰이 쥐고 있습니다.
 * html[data-theme='light'] 에서 --color-* 를 뒤집으면 Tailwind 유틸리티가
 * 그대로 var() 를 참조하므로 앱 전체가 함께 바뀝니다.
 *
 * 첫 페인트 전 적용은 public/boot.js 가 담당합니다. 여기서는 현재 값을 읽어
 * 버튼 상태를 맞추고, 사용자가 바꾸면 반영·저장만 합니다.
 *
 * 버튼은 하나입니다. 두 개를 나란히 두면 헤더 폭을 그만큼 먹어서
 * 옆 칩들이 단어 중간에서 줄바꿈됩니다.
 */
type Theme = 'light' | 'dark'

const STORAGE_KEY = 'roomcraft-theme'

const read = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('light')

  // boot.js 가 이미 적용해 둔 값을 그대로 가져옵니다.
  useEffect(() => setTheme(read()), [])

  const next: Theme = theme === 'light' ? 'dark' : 'light'
  const label = next === 'dark' ? '어둡게' : '밝게'

  const toggle = () => {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장에 실패해도 이번 세션에는 적용됩니다.
    }
  }

  return (
    <button
      onClick={toggle}
      title={`화면을 ${label} 전환합니다`}
      aria-label={`화면 ${label}`}
      className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-ink-850 px-3 text-xs font-semibold text-mist-200 transition hover:border-amber-brand hover:text-amber-brand"
    >
      <span aria-hidden className="text-sm">
        {next === 'dark' ? '☾' : '☀'}
      </span>
      {label}
    </button>
  )
}
