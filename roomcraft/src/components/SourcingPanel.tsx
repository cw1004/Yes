import { useState } from 'react'
import { useStudio } from '../store/useStudio'
import { useAuth } from '../store/useAuth'
import { styleById } from '../data/styles'
import { defaultQtyFor, spaceById } from '../data/spaces'
import { api, ApiError, type SourcedProduct } from '../lib/api'
import { TIER_LABEL, quantityMap, rankByRevenue, tierOf } from '../lib/revenue'
import { Button, inputClass } from './ui/primitives'
import { ShopCard } from './ShopCard'

/**
 * AI 실시간 제품 소싱.
 *
 * 내장 카탈로그는 사람이 채운 105개라 스타일 30 × 공간 8 조합을 다 덮지 못합니다.
 * 여기서는 모델이 웹 검색으로 지금 살 수 있는 제품을 찾아오고, 찾아온 목록을
 * 수익 엔진이 기대 정산액 순으로 다시 세웁니다.
 *
 * 결과는 검색 시점의 스냅샷입니다. 가격과 재고는 곧 달라지므로 그렇게 표시합니다.
 */
export function SourcingPanel() {
  const { styleId, spaceId, enabledMalls, affiliateIds, showToast } = useStudio()
  const { serverAvailable, health } = useAuth()

  const [budget, setBudget] = useState(6000)
  const [items, setItems] = useState<SourcedProduct[] | null>(null)
  const [meta, setMeta] = useState<{ cached: boolean; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [imgBusy, setImgBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const style = styleById(styleId)
  const space = spaceById(spaceId)
  const ready = serverAvailable && health?.sourcingReady

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.source({
        style: style.nameEn,
        space: space.labelEn,
        budgetUsd: budget,
        count: 6,
      })
      setItems(r.products)
      setMeta({ cached: r.cached, at: r.sourcedAt })
      showToast(r.cached ? '캐시된 결과입니다 (크레딧 차감 없음).' : `${r.products.length}개를 찾았습니다.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const makeImages = async () => {
    if (!items) return
    setImgBusy(true)
    try {
      const r = await api.generateImages(
        items.map((p) => ({ sku: p.sku, name: p.name, materials: p.materials })),
      )
      showToast(`상품 컷 ${r.generated.length}장을 만들었습니다.`)
      // 이미지가 생겼으니 다시 그리게 합니다.
      setItems([...items])
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '이미지 생성에 실패했습니다.')
    } finally {
      setImgBusy(false)
    }
  }

  // 찾아온 제품도 기대 정산액 순으로 세웁니다.
  const ranked = items
    ? rankByRevenue(items, enabledMalls, affiliateIds, {
        qtyBySku: quantityMap(items, (p) => defaultQtyFor(p, space)),
      })
    : []

  return (
    <div className="rounded-xl border border-line-soft bg-ink-850 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-mist-200">🔎 AI 실시간 제품 찾기</h4>
          <p className="mt-1 text-xs text-mist-400">
            {style.name} · {space.label} 에 맞는 제품을 웹에서 지금 찾아옵니다.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-mist-400">
            예산 (USD)
            <input
              type="number"
              min={200}
              step={500}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value) || 200)}
              className={`${inputClass} mt-1 w-28`}
            />
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={!ready || busy}>
            {busy ? '찾는 중…' : '✦ 지금 찾기'}
          </Button>
        </div>
      </div>

      {!ready ? (
        <p className="mt-3 rounded-lg border border-amber-brand/30 bg-amber-brand/8 px-3 py-2 text-xs text-amber-brand">
          실시간 소싱은 서버에 <code>ANTHROPIC_API_KEY</code> 가 있어야 동작합니다. 지금은 내장 카탈로그 105개만
          사용합니다.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {items ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-mist-500">
              {meta?.cached ? '캐시된 결과' : '방금 검색'} ·{' '}
              <span title="가격과 재고는 검색 시점 기준입니다. 결제 직전 값은 각 쇼핑몰이 정합니다.">
                가격은 검색 시점 스냅샷
              </span>
            </p>
            <Button variant="chip" onClick={() => void makeImages()} disabled={imgBusy}>
              {imgBusy ? '만드는 중…' : '🖼 상품 컷 만들기'}
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {ranked.map((r, i) => (
              <ShopCard
                key={r.product.sku}
                product={r.product}
                badge={TIER_LABEL[tierOf(i, ranked.length)].label || undefined}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
