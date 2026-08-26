import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignStyle } from '../types'

interface Hotspot {
  /** 이미지 기준 상대 좌표 (0~1) */
  x: number
  y: number
  label: string
}

export function BeforeAfter({
  before,
  after,
  styleName,
  palette,
  hotspots = [],
  onHotspot,
}: {
  before: string
  after: string
  styleName: string
  palette: DesignStyle['palette']
  hotspots?: Hotspot[]
  onHotspot?: (label: string) => void
}) {
  const [pos, setPos] = useState(50)
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)

  const updateFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.min(100, Math.max(0, ratio)))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => updateFromClientX(e.clientX)
    const onUp = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, updateFromClientX])

  return (
    <div>
      <div
        ref={frameRef}
        className="relative select-none overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
        onPointerDown={(e) => {
          setDragging(true)
          updateFromClientX(e.clientX)
        }}
      >
        {/* After (기준 레이어) */}
        <img src={after} alt={`${styleName} 적용 후`} className="block w-full" draggable={false} />

        {/* Before (좌측을 잘라서 덮음) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          <img src={before} alt="원본" className="block h-full w-full object-cover" draggable={false} />
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-mist-200">
          Before (Original)
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-amber-brand/90 px-2.5 py-1 text-[11px] font-bold text-ink-950">
          ✦ After ({styleName})
        </span>

        {/* 핫스팟 태그 — After 영역에서만 보이도록 */}
        {hotspots.map((h) => {
          const visible = h.x * 100 > pos
          return (
            <button
              key={h.label}
              onClick={(e) => {
                e.stopPropagation()
                onHotspot?.(h.label)
              }}
              title={h.label}
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, opacity: visible ? 1 : 0 }}
              className="absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-amber-brand text-xs text-ink-950 shadow-lg transition hover:scale-110"
            >
              🏷
            </button>
          )
        })}

        {/* 핸들 */}
        <div
          className="absolute inset-y-0 z-20 w-0.5 bg-white/80"
          style={{ left: `${pos}%` }}
        >
          <button
            aria-label="비교 슬라이더"
            role="slider"
            aria-valuenow={Math.round(pos)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 4))
              if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 4))
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setDragging(true)
            }}
            className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-white/80 bg-ink-900 text-mist-200 shadow-xl"
          >
            ⇅
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
        <p className="text-[11px] text-mist-400">
          <span className="text-amber-brand">ⓘ</span> Active Style:{' '}
          <span className="font-semibold text-mist-200">{styleName}</span>
          <span className="mx-1.5 text-ink-600">•</span>
          슬라이더를 좌우로 드래그해 디테일을 비교하세요 (←/→ 키 지원)
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-mist-500">Palette:</span>
          <div className="flex gap-1">
            {palette.map((c) => (
              <span
                key={c}
                title={c}
                className="h-3.5 w-3.5 rounded-full ring-1 ring-black/40"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
