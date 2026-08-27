import { useMemo } from 'react'
import { useStudio } from '../store/useStudio'
import { productBySku } from '../data/catalog'
import { MALLS, buildDeeplink, isMallLinked, mallById } from '../lib/affiliate'
import { copyToClipboard } from '../lib/exporters'
import { usd } from '../lib/format'
import type { Hotspot } from '../types'

/**
 * 이미지 위 태그를 눌렀을 때 뜨는 상품 카드.
 *
 * 이 카드가 제휴 수익이 실제로 발생하는 지점입니다. 무드보드에 담기 전에도
 * 바로 구매 링크로 넘어갈 수 있어야 하므로, 활성 채널 링크를 여기서 바로 노출합니다.
 */
export function ShoppableCard({
  hotspot,
  onClose,
}: {
  hotspot: Hotspot
  onClose: () => void
}) {
  const { affiliateIds, enabledMalls, addToMoodboard, removeHotspot, moodboard, showToast } = useStudio()
  const product = productBySku(hotspot.sku)

  const links = useMemo(() => {
    if (!product) return []
    const ids = enabledMalls.length ? enabledMalls : MALLS.slice(0, 4).map((m) => m.id)
    return ids.map(mallById).map((mall) => ({
      mall,
      url: buildDeeplink(mall.id, product.searchTerm, affiliateIds),
      linked: isMallLinked(mall, affiliateIds),
    }))
  }, [product, enabledMalls, affiliateIds])

  if (!product) return null

  const inBoard = moodboard.some((m) => m.sku === product.sku)

  // 오른쪽/아래 가장자리에서는 카드를 반대편으로 붙여 화면 밖으로 나가지 않게 합니다.
  const flipX = hotspot.x > 0.58
  const flipY = hotspot.y > 0.55

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        left: `${hotspot.x * 100}%`,
        top: `${hotspot.y * 100}%`,
        transform: `translate(${flipX ? 'calc(-100% - 22px)' : '22px'}, ${flipY ? 'calc(-100% + 14px)' : '-14px'})`,
      }}
      className="rc-fade-up absolute z-30 w-[290px] overflow-hidden rounded-xl border border-ink-600 bg-ink-900/97 shadow-2xl backdrop-blur"
    >
      <div className="flex items-start gap-2.5 border-b border-ink-700 p-3">
        <span className="mt-0.5 h-11 w-11 shrink-0 rounded-lg" style={{ background: product.swatch }} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold leading-snug text-mist-200">{product.name}</p>
          <p className="mt-0.5 text-[11px]">
            <span className="font-bold text-amber-brand">{usd(product.price)}</span>
            <span className="text-mist-500"> · {product.brand}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] text-mist-500 hover:bg-ink-800 hover:text-mist-200"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[168px] overflow-y-auto p-2">
        <p className="px-1 pb-1.5 text-[10px] font-semibold text-mist-400">
          추천 제품 구매 링크 ({links.length}개 채널)
        </p>
        <div className="space-y-1">
          {links.map(({ mall, url, linked }) => (
            <div key={mall.id} className="flex items-center gap-1">
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener sponsored"
                className="flex flex-1 items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-[11px] text-mist-300 transition hover:border-amber-brand/50 hover:text-amber-brand"
              >
                <span className="truncate">
                  {mall.icon} {mall.label}
                </span>
                <span className={linked ? 'text-emerald-brand' : 'text-mist-600'}>
                  {linked ? '추적 ✓' : '추적 ✗'}
                </span>
              </a>
              <button
                onClick={async () => {
                  const ok = await copyToClipboard(url)
                  showToast(ok ? `${mall.label} 링크를 복사했습니다.` : '복사에 실패했습니다.')
                }}
                title="링크 복사"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-ink-700 text-[10px] text-mist-400 hover:text-amber-brand"
              >
                ⧉
              </button>
            </div>
          ))}
        </div>
      </div>

      <p className="border-t border-ink-700 px-3 py-1.5 text-[10px] leading-relaxed text-mist-500">
        이미지는 AI 시안입니다. 이 제품은 스타일에 맞춰 고른 추천 상품으로, 이미지 속 가구와 동일한 제품이 아닐 수 있습니다.
      </p>

      <div className="flex gap-1.5 border-t border-ink-700 p-2">
        <button
          onClick={() => addToMoodboard(product.sku)}
          className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
            inBoard
              ? 'border border-ink-600 text-mist-400 hover:text-mist-200'
              : 'border border-emerald-brand/40 bg-emerald-brand/10 text-emerald-brand hover:bg-emerald-brand/20'
          }`}
        >
          {inBoard ? '＋ 수량 추가' : '✓ 무드보드에 담기'}
        </button>
        <a
          href={product.officialUrl}
          target="_blank"
          rel="noreferrer noopener"
          title="브랜드 공식몰"
          className="grid h-7 w-7 place-items-center rounded-md border border-ink-600 text-[11px] text-mist-400 hover:text-amber-brand"
        >
          ↗
        </a>
        <button
          onClick={() => {
            removeHotspot(hotspot.id)
            onClose()
          }}
          title="이미지에서 태그 제거"
          className="grid h-7 w-7 place-items-center rounded-md border border-ink-600 text-[11px] text-mist-400 hover:border-red-500/50 hover:text-red-400"
        >
          🗑
        </button>
      </div>
    </div>
  )
}
