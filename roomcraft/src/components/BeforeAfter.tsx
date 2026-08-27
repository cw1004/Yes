import { useCallback, useRef, useState } from 'react'
import { useStudio } from '../store/useStudio'
import { productBySku } from '../data/catalog'
import { ShoppableCard } from './ShoppableTag'
import { usd } from '../lib/format'
import type { DesignStyle, Hotspot } from '../types'

/** 드래그로 간주할 최소 이동 거리(px). 이보다 작으면 클릭으로 처리합니다. */
const DRAG_THRESHOLD = 4

/**
 * 포인터 상호작용은 전부 setPointerCapture 로 처리합니다.
 * useEffect 안에서 window 리스너를 붙이면, pointerdown 직후의 pointermove 가
 * 이펙트 실행보다 먼저 도착해 초반 이동이 통째로 유실됩니다.
 */

export function BeforeAfter({
  before,
  after,
  styleName,
  palette,
}: {
  before: string
  after: string
  styleName: string
  palette: DesignStyle['palette']
}) {
  const { hotspots, moveHotspot } = useStudio()
  const [pos, setPos] = useState(50)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [draggingTag, setDraggingTag] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const ratioFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = frameRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
  }, [])

  const sliderTo = useCallback(
    (clientX: number) => {
      const r = ratioFromEvent(clientX, 0)
      if (r) setPos(Math.min(100, Math.max(0, r.x * 100)))
    },
    [ratioFromEvent],
  )

  const active = hotspots.find((h) => h.id === openTag) ?? null

  return (
    <div>
      <div
        ref={frameRef}
        className="relative select-none overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
        onPointerDown={(e) => {
          setOpenTag(null)
          e.currentTarget.setPointerCapture(e.pointerId)
          sliderTo(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) sliderTo(e.clientX)
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        {/* After (기준 레이어) */}
        <img src={after} alt={`${styleName} 적용 후`} className="block w-full" draggable={false} />

        {/* Before (좌측을 잘라서 덮음) */}
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt="원본" className="block h-full w-full object-cover" draggable={false} />
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/65 px-2.5 py-1 text-xs font-semibold text-mist-200">
          Before (Original)
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-amber-brand/90 px-2.5 py-1 text-xs font-bold text-ink-950">
          ✦ After ({styleName})
        </span>

        {/* 쇼퍼블 태그 — After 영역에서만 보입니다 */}
        {hotspots.map((h) => (
          <Tag
            key={h.id}
            hotspot={h}
            visible={h.x * 100 > pos}
            active={openTag === h.id}
            dragging={draggingTag === h.id}
            onMove={(clientX, clientY) => {
              const r = ratioFromEvent(clientX, clientY)
              if (r) moveHotspot(h.id, r.x, r.y)
            }}
            onDragStateChange={(on) => setDraggingTag(on ? h.id : null)}
            onSelect={() => setOpenTag((cur) => (cur === h.id ? null : h.id))}
          />
        ))}

        {active ? <ShoppableCard hotspot={active} onClose={() => setOpenTag(null)} /> : null}

        {/* 비교 핸들 */}
        <div className="absolute inset-y-0 z-20 w-0.5 bg-white/80" style={{ left: `${pos}%` }}>
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
              setOpenTag(null)
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) sliderTo(e.clientX)
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-white/80 bg-ink-900 text-mist-200 shadow-xl"
          >
            ⇅
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
        <p className="text-xs text-mist-400">
          <span className="text-amber-brand">ⓘ</span> Active Style:{' '}
          <span className="font-semibold text-mist-200">{styleName}</span>
          <span className="mx-1.5 text-ink-600">•</span>
          태그를 <span className="text-mist-200">클릭</span>하면 구매 링크,{' '}
          <span className="text-mist-200">드래그</span>하면 위치를 옮깁니다
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-mist-500">Palette:</span>
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

function Tag({
  hotspot,
  visible,
  active,
  dragging,
  onMove,
  onDragStateChange,
  onSelect,
}: {
  hotspot: Hotspot
  visible: boolean
  active: boolean
  dragging: boolean
  onMove: (clientX: number, clientY: number) => void
  onDragStateChange: (on: boolean) => void
  onSelect: () => void
}) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const product = productBySku(hotspot.sku)
  if (!product) return null

  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, y: e.clientY }
        moved.current = false
      }}
      onPointerMove={(e) => {
        if (!start.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
        if (!moved.current) {
          if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) <= DRAG_THRESHOLD) return
          moved.current = true
          onDragStateChange(true)
        }
        onMove(e.clientX, e.clientY)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        e.currentTarget.releasePointerCapture(e.pointerId)
        // 움직이지 않았으면 클릭으로 보고 상품 카드를 엽니다.
        if (!moved.current) onSelect()
        onDragStateChange(false)
        start.current = null
      }}
      title={`${product.name} — ${usd(product.price)}`}
      style={{
        left: `${hotspot.x * 100}%`,
        top: `${hotspot.y * 100}%`,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 touch-none items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 shadow-lg transition-[background,transform] ${
        active ? 'bg-amber-brand text-ink-950' : 'bg-ink-950/85 text-mist-200 hover:bg-amber-brand hover:text-ink-950'
      } ${dragging ? 'scale-110 cursor-grabbing' : 'cursor-grab'}`}
    >
      <span
        className="grid h-5 w-5 place-items-center rounded-full text-xs"
        style={{ background: product.swatch }}
      >
        🏷
      </span>
      <span className="max-w-[92px] truncate text-xs font-semibold">{product.brand}</span>
    </button>
  )
}
