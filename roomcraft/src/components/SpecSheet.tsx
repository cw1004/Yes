import { useMoodboardTotals, useStudio } from '../store/useStudio'
import { CATALOG, productsBySkus } from '../data/catalog'
import { styleById } from '../data/styles'
import { usd, usdFine } from '../lib/format'
import { Button } from './ui/primitives'
import { ProductThumb } from './ProductThumb'
import { TIER_LABEL, rankByRevenue, tierOf } from '../lib/revenue'

export function SpecSheet() {
  const {
    styleId,
    addToMoodboard,
    removeFromMoodboard,
    syncStyleToMoodboard,
    openModal,
    showToast,
    enabledMalls,
    affiliateIds,
  } = useStudio()
  const { rows, total, count } = useMoodboardTotals()
  const style = styleById(styleId)

  /*
   * 큐레이션을 카탈로그 순서대로 두면 무엇부터 밀어야 할지 알 수 없습니다.
   * 클릭당 기대 정산액이 큰 순으로 세워 상위 항목에 배지를 답니다.
   * (기대값은 가정에 기반하므로 절대 금액이 아니라 순서로 읽어야 합니다 — lib/revenue.ts)
   */
  const ranked = rankByRevenue(productsBySkus(style.curatedSkus), enabledMalls, affiliateIds)
  const curated = ranked.length ? ranked : productsBySkus(style.curatedSkus).map((product) => ({
    product,
    best: null,
    runnersUp: [],
    liftVsFirst: 1,
  }))

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line-soft p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-mist-200">
              🗂 Curated Furniture Spec Sheet
            </h3>
            <p className="mt-1 text-xs text-mist-400">{count} items in active design collection</p>
          </div>
          <p className="text-lg font-bold text-mist-200">{usd(total)}</p>
        </div>

        <div className="mt-3 space-y-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              showToast('전 세계 파트너 몰에서 동일 스타일 제품을 검색합니다.')
              openModal('moodboard')
            }}
          >
            ✦ 🌐 AI Global Product Sourcing Engine
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={syncStyleToMoodboard}>
              ✦ ＋ {style.name}
            </Button>
            <Button variant="chip" onClick={syncStyleToMoodboard}>
              Sync ({curated.length})
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {rows.length ? (
          <>
            <p className="text-xs font-semibold text-mist-400">무드보드 ({count})</p>
            {rows.map(({ product, qty }) => (
              <div
                key={product.sku}
                className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-ink-900 p-2.5"
              >
                <ProductThumb product={product} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-mist-200">{product.name}</p>
                  <p className="text-xs">
                    <span className="font-bold text-amber-brand">{usd(product.price)}</span>
                    <span className="text-mist-500">
                      {' '}
                      · {product.vendor}
                      {qty > 1 ? ` · ×${qty}` : ''}
                    </span>
                  </p>
                </div>
                <a
                  href={product.officialUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="브랜드 공식몰"
                  className="grid h-7 w-7 place-items-center rounded-md border border-line text-xs text-mist-400 hover:text-amber-brand"
                >
                  ↗
                </a>
                <button
                  onClick={() => removeFromMoodboard(product.sku)}
                  title="무드보드에서 제거"
                  className="grid h-7 w-7 place-items-center rounded-md border border-line text-xs text-mist-400 hover:border-red-500/50 hover:text-red-400"
                >
                  🗑
                </button>
              </div>
            ))}
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-mist-500">
            무드보드가 비어 있습니다. 아래 큐레이션에서 담아보세요.
          </p>
        )}

        <p className="pt-3 text-xs font-semibold text-mist-400">
          {style.name} 큐레이션 ({curated.length})
        </p>
        {curated.map(({ product: p, best }, i) => {
          const tier = TIER_LABEL[tierOf(i, curated.length)]
          return (
          <div key={p.sku} className="rounded-lg border border-line-soft bg-ink-900 p-2.5">
            <div className="flex items-start gap-2.5">
              <ProductThumb product={p} className="mt-0.5 h-10 w-10" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-mist-200">{p.name}</p>
                  {tier.label ? (
                    <span
                      title={tier.hint}
                      className="shrink-0 whitespace-nowrap rounded-md border border-emerald-brand bg-emerald-brand/10 px-1.5 py-0.5 text-xs font-bold text-emerald-brand"
                    >
                      {tier.label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs">
                  <span className="font-bold text-amber-brand">{usd(p.price)} USD</span>
                  <span className="text-mist-500"> · {p.vendor}</span>
                  <span className="ml-1 text-amber-brand">★{p.rating}</span>
                </p>
                {best ? (
                  <p
                    className="mt-0.5 text-xs text-mist-500"
                    title="가격·수수료율·전환 가정으로 계산한 값입니다. 실측이 아니라 채널 간 순위 판단용입니다."
                  >
                    최적 채널 <span className="font-semibold text-mist-300">{best.mall.icon} {best.mall.label}</span>
                    {' · '}수수료 {(best.rate * 100).toFixed(1)}%
                    {' · '}<span className="tabular-nums">{usdFine(best.perClick)}</span>/클릭(가정)
                  </p>
                ) : null}
                <p className="mt-1 line-clamp-2 text-xs text-mist-400">스타일 추천 이유: {p.reason}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-mist-500">소재/마감: {p.materials}</p>
                <div className="mt-2 flex gap-1.5">
                  <a
                    href={p.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-md border border-line px-2.5 py-2 text-xs text-mist-300 hover:border-amber-brand/50 hover:text-amber-brand"
                  >
                    {p.brand} ↗
                  </a>
                  <button
                    onClick={() => addToMoodboard(p.sku)}
                    className="rounded-md border border-emerald-brand/40 bg-emerald-brand/10 px-2.5 py-2 text-xs font-semibold text-emerald-brand hover:bg-emerald-brand/20"
                  >
                    ✓ 무드보드에 담기
                  </button>
                </div>
              </div>
            </div>
          </div>
          )
        })}
      </div>

      <div className="border-t border-line-soft p-3">
        <Button variant="primary" className="w-full" onClick={() => openModal('moodboard')}>
          🗂 Open Full Moodboard &amp; Catalog Modal
        </Button>
        <p className="mt-2 text-center text-xs text-mist-500">
          카탈로그 총 {CATALOG.length}개 제품 · 제휴 링크는 수익 허브에서 설정합니다
        </p>
      </div>
    </div>
  )
}
