import { useRef, useState } from 'react'
import { useMoodboardTotals, useStudio } from '../store/useStudio'
import { CATALOG, productBySku } from '../data/catalog'
import { spaceById } from '../data/spaces'
import { usd } from '../lib/format'
import { Button, Card, SectionTitle } from './ui/primitives'

interface Placed {
  id: string
  sku: string
  x: number
  y: number
}

/**
 * 2D 가구 배치 보드.
 * 무드보드 항목을 평면도 위에 올려 동선/스케일을 가늠하고, 그대로 견적으로 넘깁니다.
 */
export function StagingBoard() {
  const { spaceId, addToMoodboard } = useStudio()
  const { rows, total } = useMoodboardTotals()
  const [placed, setPlaced] = useState<Placed[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  const space = spaceById(spaceId)
  const suggestions = CATALOG.filter((p) => space.focus.includes(p.category)).slice(0, 8)

  const moveTo = (clientX: number, clientY: number, id: string) => {
    const el = boardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(94, Math.max(0, ((clientX - r.left) / r.width) * 100))
    const y = Math.min(90, Math.max(0, ((clientY - r.top) / r.height) * 100))
    setPlaced((prev) => prev.map((p) => (p.id === id ? { ...p, x, y } : p)))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card className="p-4">
        <SectionTitle
          icon="◎"
          title="2D 평면 배치"
          desc="가구 칩을 드래그해 동선과 스케일을 확인하세요. 배치 상태는 견적서의 항목과 연동됩니다."
          right={
            <Button size="sm" variant="ghost" onClick={() => setPlaced([])} disabled={!placed.length}>
              배치 초기화
            </Button>
          }
        />
        <div
          ref={boardRef}
          onPointerMove={(e) => dragId && moveTo(e.clientX, e.clientY, dragId)}
          onPointerUp={() => setDragId(null)}
          onPointerLeave={() => setDragId(null)}
          className="relative mt-4 aspect-[16/10] w-full overflow-hidden rounded-xl border border-line-soft"
          style={{
            background:
              'repeating-linear-gradient(0deg,#15151a,#15151a 1px,transparent 1px,transparent 32px),' +
              'repeating-linear-gradient(90deg,#15151a,#15151a 1px,transparent 1px,transparent 32px),#0f0f13',
          }}
        >
          <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-line" />
          <span className="pointer-events-none absolute left-8 top-8 text-xs text-mist-500">
            {space.label} · 34m²
          </span>
          {/* 창문 표시 */}
          <div className="pointer-events-none absolute right-6 top-6 h-1.5 w-40 rounded-full bg-sky-400/50" />

          {placed.map((p) => {
            const product = productBySku(p.sku)
            if (!product) return null
            return (
              <div
                key={p.id}
                onPointerDown={(e) => {
                  e.preventDefault()
                  setDragId(p.id)
                }}
                onDoubleClick={() => setPlaced((prev) => prev.filter((x) => x.id !== p.id))}
                title={`${product.name} — 더블클릭으로 제거`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: product.swatch }}
                className="absolute cursor-grab touch-none rounded-lg border-2 bg-ink-850/95 px-2 py-1.5 text-xs font-semibold text-mist-200 shadow-lg active:cursor-grabbing"
              >
                <span className="mr-1" style={{ color: product.swatch }}>
                  ▉
                </span>
                {product.category}
                <div className="text-xs font-normal text-mist-500">{product.brand}</div>
              </div>
            )
          })}

          {!placed.length ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="text-xs text-mist-500">우측 목록에서 “배치” 를 눌러 가구를 올려보세요</p>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-mist-500">
          배치된 가구 {placed.length}개 · 무드보드 합계 {usd(total)}
        </p>
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <SectionTitle icon="🗂" title="무드보드 항목" desc="이미 담아둔 가구를 평면에 배치합니다." />
          <div className="mt-3 space-y-2">
            {rows.length ? (
              rows.map(({ product, qty }) => (
                <div
                  key={product.sku}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-ink-900 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-mist-200">{product.name}</p>
                    <p className="text-xs text-mist-500">
                      {product.category} · {usd(product.price)} × {qty}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="chip"
                    onClick={() =>
                      setPlaced((prev) => [
                        ...prev,
                        {
                          id: `${product.sku}-${prev.length}-${Date.now()}`,
                          sku: product.sku,
                          x: 20 + ((prev.length * 13) % 60),
                          y: 25 + ((prev.length * 17) % 50),
                        },
                      ])
                    }
                  >
                    배치
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-mist-500">무드보드가 비어 있습니다. 스펙시트에서 먼저 담아주세요.</p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle icon="✧" title={`${space.label} 추천 가구`} desc="이 공간에서 우선순위가 높은 카테고리" />
          <div className="mt-3 space-y-2">
            {suggestions.map((p) => (
              <div
                key={p.sku}
                className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-ink-900 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-mist-200">{p.name}</p>
                  <p className="text-xs text-mist-500">
                    {p.brand} · {usd(p.price)}
                  </p>
                </div>
                <Button size="sm" variant="chip" onClick={() => addToMoodboard(p.sku)}>
                  담기
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
