import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { useStudio } from '../store/useStudio'
import { CATALOG, productBySku } from '../data/catalog'
import { COMMON_SPECS, generatePlan, planAreaSqm } from '../lib/plan/templates'
import { CLEARANCE, dimsOf, findFreeSpot, inspectPlan, isPlaceable, occupancyVerdict } from '../lib/plan/clearance'
import { footprint } from '../lib/plan/types'
import type { PlacedItem } from '../lib/plan/types'
import { unitPrice } from '../lib/format'
import { Button, Card, SectionTitle } from './ui/primitives'
import { ProductThumb } from './ProductThumb'
import { ShopCard } from './ShopCard'
/*
 * three.js 는 gzip 기준 130KB 를 더합니다. 대부분의 방문자는 3D 탭을 열지 않으므로
 * 첫 로딩에 태우지 않고, 3D 로 전환할 때 가져옵니다.
 */
const Room3D = lazy(() => import('./Room3D').then((m) => ({ default: m.Room3D })))
import { styleById } from '../data/styles'

/**
 * 평면 배치 편집기.
 *
 * 예전 스테이징 보드는 치수 없는 칩을 % 좌표로 놓는 것이라 "동선이 되는지"를
 * 판단할 수 없었습니다. 여기서는 모든 것이 mm 이고, 가구를 놓을 때마다
 * 통로 폭·문 열림 반경·의자 빼는 공간을 실제로 계산합니다.
 */

/** 스냅 격자 (mm). 50mm 면 손으로 맞추는 정밀도로 충분합니다. */
const GRID = 50
/** 벽에 이만큼 가까우면 딱 붙입니다. */
const WALL_SNAP = 250

export function FloorPlanner() {
  const { showToast, styleId } = useStudio()
  const [view, setView] = useState<'2d' | '3d'>('2d')
  const [specIndex, setSpecIndex] = useState(3)
  const [items, setItems] = useState<PlacedItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const plan = useMemo(() => generatePlan(COMMON_SPECS[specIndex]), [specIndex])
  const report = useMemo(() => inspectPlan(plan, items, productBySku), [plan, items])

  const placeable = CATALOG.filter(isPlaceable)
  const selectedItem = items.find((i) => i.id === selected)
  const selectedProduct = selectedItem ? productBySku(selectedItem.sku) : undefined

  /**
   * 화면 좌표 → 도면 mm.
   *
   * getBoundingClientRect 로 선형 환산하면 안 됩니다. viewBox 비율과 요소 비율이
   * 다르면 preserveAspectRatio 가 레터박싱을 하는데(여기서는 1.18 vs 1.33),
   * 그 여백만큼 좌표가 어긋나 가구가 커서를 따라오지 않습니다.
   * getScreenCTM 의 역행렬을 쓰면 어떤 비율에서도 정확합니다.
   */
  const toPlan = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const snap = (v: number) => Math.round(v / GRID) * GRID

  const moveTo = (id: string, px: number, py: number) => {
    const product = productBySku(items.find((i) => i.id === id)?.sku ?? '')
    if (!product) return
    const d = dimsOf(product)
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const box = footprint({ ...it, x: px, y: py }, d)
        let x = snap(px)
        let y = snap(py)
        // 벽에 가까우면 붙입니다 — 실제 배치에서 가구는 대부분 벽에 붙습니다.
        if (box.x < WALL_SNAP) x = box.w / 2
        if (box.y < WALL_SNAP) y = box.h / 2
        if (plan.width - (box.x + box.w) < WALL_SNAP) x = plan.width - box.w / 2
        if (plan.height - (box.y + box.h) < WALL_SNAP) y = plan.height - box.h / 2
        return { ...it, x, y }
      }),
    )
  }

  const add = (sku: string) => {
    const product = productBySku(sku)
    if (!product) return
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    /*
     * 가구 유형에 맞는 방을 먼저 고릅니다 — 침대를 거실에 놓고 시작하면
     * 사용자가 매번 옮겨야 합니다.
     */
    const kindByCategory: Record<string, string> = {
      Bed: 'bedroom', Appliance: 'kitchen', Plumbing: 'bathroom',
    }
    const wanted = kindByCategory[product.category] ?? 'living'
    const room =
      plan.rooms.find((r) => r.kind === wanted) ?? plan.rooms.find((r) => r.kind === 'living') ?? plan.rooms[0]

    // 이미 놓인 가구와 겹치지 않는 자리를 찾습니다.
    const taken = items
      .map((it) => {
        const pr = productBySku(it.sku)
        return pr ? footprint(it, dimsOf(pr)) : null
      })
      .filter((b): b is NonNullable<typeof b> => Boolean(b))

    const spot = findFreeSpot(room, dimsOf(product), taken)
    setItems((prev) => [...prev, { id, sku, x: spot.x, y: spot.y, rot: 0 }])
    setSelected(id)
  }

  const rotate = (id: string) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, rot: (it.rot + 90) % 360 } : it)))

  const remove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (selected === id) setSelected(null)
  }

  const errors = report.issues.filter((i) => i.level === 'error')
  const warns = report.issues.filter((i) => i.level === 'warn')
  const badItems = new Set(report.issues.flatMap((i) => i.items))
  const verdict = occupancyVerdict(report.totalRatio)

  const vb = `-400 -400 ${plan.width + 800} ${plan.height + 2400}`

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
      <Card className="p-4">
        <SectionTitle
          icon="▦"
          title="평면 배치"
          desc="가구를 드래그해 배치하면 통로 폭·문 열림·의자 빼는 공간을 실시간으로 검사합니다."
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-line">
                {(['2d', '3d'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`min-h-[36px] px-3 text-xs font-bold transition ${
                      view === v ? 'bg-amber-brand text-on-brand' : 'bg-ink-850 text-mist-300 hover:text-mist-200'
                    }`}
                  >
                    {v === '2d' ? '▦ 평면' : '⬢ 3D'}
                  </button>
                ))}
              </div>
              <select
                value={specIndex}
                onChange={(e) => {
                  setSpecIndex(Number(e.target.value))
                  setItems([])
                }}
                className="rounded-lg border border-line bg-ink-900 px-2 py-2 text-xs text-mist-200 outline-none"
              >
                {COMMON_SPECS.map((s, i) => (
                  <option key={s.label} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => setItems([])} disabled={!items.length}>
                비우기
              </Button>
            </div>
          }
        />

        <p className="mt-2 rounded-lg border border-amber-brand/30 bg-amber-brand/8 px-3 py-2 text-xs text-amber-brand">
          ⓘ 평형·베이로 <b>생성한 도식 평면</b>입니다. 실제 아파트 도면이 아닙니다 — 실측 도면은 건설사·도면
          제공사의 저작물이라 임의로 불러올 수 없습니다. 치수는 대략의 배치 감각을 잡는 용도로 쓰세요.
        </p>

        {view === '3d' ? (
          <div className="mt-3">
            <Suspense
              fallback={
                <div
                  className="grid place-items-center rounded-xl border border-line-soft bg-ink-850 text-xs text-mist-400"
                  style={{ aspectRatio: '16 / 10' }}
                >
                  3D 엔진을 불러오는 중…
                </div>
              }
            >
              <Room3D
                plan={plan}
                items={items}
                style={styleById(styleId)}
                productBySku={productBySku}
                selected={selected}
                onSelect={setSelected}
              />
            </Suspense>
          </div>
        ) : (
        <div
          className="mt-3 overflow-hidden rounded-xl border border-line-soft bg-ink-850"
          onPointerMove={(e) => {
            if (!dragging) return
            const p = toPlan(e.clientX, e.clientY)
            if (p) moveTo(dragging, p.x, p.y)
          }}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
        >
          <svg ref={svgRef} viewBox={vb} className="block w-full touch-none" style={{ aspectRatio: '4 / 3' }}>
            {/* 격자 */}
            <defs>
              <pattern id="grid1m" width="1000" height="1000" patternUnits="userSpaceOnUse">
                <path d="M1000 0H0V1000" fill="none" stroke="currentColor" strokeWidth="12" className="text-line-soft" />
              </pattern>
            </defs>
            <rect x="-400" y="-400" width={plan.width + 800} height={plan.height + 2400} fill="url(#grid1m)" />

            {/* 방 */}
            {plan.rooms.map((r) => (
              <g key={r.id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  className={r.kind === 'balcony' ? 'fill-ink-800' : 'fill-ink-900'}
                  stroke="currentColor"
                  strokeWidth={plan.wallThickness}
                  strokeLinejoin="miter"
                  style={{ color: 'var(--color-line)' }}
                />

              </g>
            ))}

            {/* 개구부 — 문은 열림 반경까지 그립니다 */}
            {plan.openings.map((op) => {
              const half = op.width / 2
              const isH = op.axis === 'h'
              const x1 = isH ? op.x - half : op.x
              const y1 = isH ? op.y : op.y - half
              const x2 = isH ? op.x + half : op.x
              const y2 = isH ? op.y : op.y + half
              return (
                <g key={op.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ink-900)" strokeWidth={plan.wallThickness + 40} />
                  {op.kind === 'window' ? (
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7fb2cc" strokeWidth={60} />
                  ) : null}
                  {op.kind === 'door' ? (
                    <path
                      d={`M ${x1} ${y1} L ${x1} ${y1 + (op.swing ?? 1) * op.width} A ${op.width} ${op.width} 0 0 ${
                        (op.swing ?? 1) > 0 ? 0 : 1
                      } ${x2} ${y2}`}
                      fill="none"
                      stroke="var(--color-line)"
                      strokeWidth={40}
                      strokeDasharray="120 90"
                    />
                  ) : null}
                </g>
              )
            })}

            {/* 가구 */}
            {items.map((it) => {
              const product = productBySku(it.sku)
              if (!product) return null
              const d = dimsOf(product)
              const bad = badItems.has(it.id)
              const isSel = selected === it.id
              return (
                <g
                  key={it.id}
                  transform={`translate(${it.x} ${it.y}) rotate(${it.rot})`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelected(it.id)
                    setDragging(it.id)
                  }}
                  className="cursor-grab"
                >
                  <rect
                    x={-d.w / 2}
                    y={-d.d / 2}
                    width={d.w}
                    height={d.d}
                    rx={40}
                    fill={product.swatch}
                    fillOpacity={product.silhouette === 'rug' ? 0.4 : 0.92}
                    stroke={bad ? 'var(--color-amber-brand)' : isSel ? 'var(--color-emerald-brand)' : 'var(--color-line)'}
                    strokeWidth={bad || isSel ? 90 : 40}
                  />
                  {/* 정면 표시 — 회전했는지 한눈에 보여야 합니다 */}
                  <line
                    x1={-d.w / 2 + 80}
                    y1={d.d / 2 - 90}
                    x2={d.w / 2 - 80}
                    y2={d.d / 2 - 90}
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth={60}
                  />
                  <text
                    textAnchor="middle"
                    y={40}
                    className="pointer-events-none"
                    style={{ fontSize: 200, fontWeight: 700, fill: 'rgba(0,0,0,0.62)' }}
                  >
                    {product.brand.slice(0, 10)}
                  </text>
                </g>
              )
            })}

            {/*
              * 방 이름은 가구 위에 그립니다.
              * 방 안쪽에 두면 벽에 붙인 가구가 그대로 덮어서 어느 방인지 알 수 없습니다.
              * 건축 도면에서도 실명은 최상단 레이어입니다.
              */}
            {plan.rooms.map((r) => (
              <g key={`label-${r.id}`} className="pointer-events-none">
                <text
                  x={r.x + 200}
                  y={r.y + 420}
                  className="fill-mist-400"
                  style={{
                    fontSize: 260,
                    fontWeight: 700,
                    paintOrder: 'stroke',
                    stroke: 'var(--color-ink-900)',
                    strokeWidth: 120,
                    strokeLinejoin: 'round',
                  }}
                >
                  {r.name}
                </text>
                <text
                  x={r.x + 200}
                  y={r.y + 700}
                  className="fill-mist-500"
                  style={{
                    fontSize: 210,
                    paintOrder: 'stroke',
                    stroke: 'var(--color-ink-900)',
                    strokeWidth: 100,
                    strokeLinejoin: 'round',
                  }}
                >
                  {((r.w * r.h) / 1_000_000).toFixed(1)}㎡
                </text>
              </g>
            ))}

            {/* 위반 표시 */}
            {report.issues.map((iss, i) => (
              <g key={i}>
                <circle
                  cx={iss.at.x}
                  cy={iss.at.y}
                  r={200}
                  fill={iss.level === 'error' ? 'var(--color-amber-brand)' : 'transparent'}
                  stroke="var(--color-amber-brand)"
                  strokeWidth={60}
                />
                <text
                  x={iss.at.x}
                  y={iss.at.y + 70}
                  textAnchor="middle"
                  style={{ fontSize: 220, fontWeight: 800, fill: iss.level === 'error' ? '#000' : 'var(--color-amber-brand)' }}
                >
                  !
                </text>
              </g>
            ))}
          </svg>
        </div>
        )}

        {selectedItem && selectedProduct ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-ink-900 p-2.5">
            <ProductThumb product={selectedProduct} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-mist-200">{selectedProduct.name}</p>
              <p className="text-xs text-mist-500">
                {dimsOf(selectedProduct).w} × {dimsOf(selectedProduct).d} × {dimsOf(selectedProduct).h}mm
                <span className="ml-1" title="제조사 스펙이 아니라 그 가구 유형의 통상 치수입니다.">
                  (통상 치수)
                </span>
              </p>
            </div>
            <Button size="sm" variant="chip" onClick={() => rotate(selectedItem.id)}>
              ⟳ 90° 회전
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove(selectedItem.id)}>
              🗑 삭제
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="space-y-4">
        {/* 동선 검사 */}
        <Card className="p-4">
          <SectionTitle
            icon="↔"
            title="동선 검사"
            desc={`주 통로 ${CLEARANCE.primaryPath}mm · 문 열림 반경 · 의자 빼는 공간을 확인합니다.`}
          />
          {!items.length ? (
            <p className="mt-3 rounded-lg border border-dashed border-line p-4 text-center text-xs text-mist-500">
              아래에서 가구를 담아 도면에 올려보세요.
            </p>
          ) : (
            <>
              <div className="mt-3 flex gap-2">
                <div className="flex-1 rounded-lg border border-line-soft bg-ink-900 p-2.5">
                  <p className="text-xs text-mist-500">막힘</p>
                  <p className={`text-lg font-bold ${errors.length ? 'text-amber-brand' : 'text-emerald-brand'}`}>
                    {errors.length}건
                  </p>
                </div>
                <div className="flex-1 rounded-lg border border-line-soft bg-ink-900 p-2.5">
                  <p className="text-xs text-mist-500">주의</p>
                  <p className="text-lg font-bold text-mist-200">{warns.length}건</p>
                </div>
                <div className="flex-1 rounded-lg border border-line-soft bg-ink-900 p-2.5">
                  <p className="text-xs text-mist-500">최소 통로</p>
                  <p className="text-lg font-bold tabular-nums text-mist-200">
                    {report.narrowestGap === null ? '—' : `${Math.round(report.narrowestGap)}mm`}
                  </p>
                </div>
              </div>

              <ul className="mt-3 max-h-52 space-y-1.5 overflow-y-auto">
                {report.issues.map((iss, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border px-2.5 py-2 text-xs ${
                      iss.level === 'error'
                        ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
                        : 'border-line-soft bg-ink-900 text-mist-400'
                    }`}
                  >
                    <b>{iss.title}</b>
                    <br />
                    {iss.detail}
                  </li>
                ))}
                {!report.issues.length ? (
                  <li className="rounded-lg border border-emerald-brand bg-emerald-brand/10 px-2.5 py-2 text-xs text-emerald-brand">
                    ✓ 통로와 문 열림 반경에 걸리는 것이 없습니다.
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </Card>

        {/* 부피감 */}
        <Card className="p-4">
          <SectionTitle icon="▤" title="부피감" desc="가구가 바닥을 얼마나 차지하는지 봅니다." />
          <div className="mt-3 rounded-lg border border-line-soft bg-ink-900 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-mist-500">전체 점유율 (전용 {planAreaSqm(plan).toFixed(1)}㎡)</span>
              <span className="text-lg font-bold tabular-nums text-mist-200">
                {(report.totalRatio * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
              <div
                className={`h-full rounded-full ${
                  verdict.tone === 'good' ? 'bg-emerald-brand' : verdict.tone === 'warn' ? 'bg-amber-brand' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, report.totalRatio * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-mist-400">{verdict.label}</p>
          </div>
          <ul className="mt-2 space-y-1">
            {report.occupancy
              .filter((o) => o.usedSqm > 0)
              .map((o) => (
                <li key={o.room.id} className="flex justify-between text-xs text-mist-400">
                  <span>{o.room.name}</span>
                  <span className="tabular-nums">
                    {o.usedSqm.toFixed(1)} / {o.areaSqm.toFixed(1)}㎡ · {(o.ratio * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
          </ul>
        </Card>

        {/* 선택 제품 구매 */}
        {selectedProduct ? (
          <div>
            <p className="mb-2 text-xs font-semibold text-mist-400">선택한 제품 바로 구매</p>
            <ShopCard product={selectedProduct} />
          </div>
        ) : null}

        {/* 가구 담기 */}
        <Card className="p-4">
          <SectionTitle icon="＋" title="가구 올리기" desc="누르면 거실 가운데에 놓입니다." />
          <div className="mt-3 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
            {placeable.slice(0, 40).map((p) => (
              <button
                key={p.sku}
                onClick={() => {
                  add(p.sku)
                  showToast(`${p.brand} 을(를) 도면에 올렸습니다.`)
                }}
                className="flex items-center gap-2 rounded-lg border border-line-soft bg-ink-900 p-2 text-left transition hover:border-amber-brand"
              >
                <ProductThumb product={p} className="h-8 w-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-mist-200">{p.brand}</span>
                  <span className="block truncate text-xs text-mist-500">
                    {dimsOf(p).w}×{dimsOf(p).d} · {unitPrice(p.price, p.unit)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
