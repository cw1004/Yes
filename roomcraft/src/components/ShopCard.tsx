import { useCallback, useState } from 'react'
import { useStudio } from '../store/useStudio'
import { usdFine, unitPrice } from '../lib/format'
import { buildDeeplink } from '../lib/affiliate'
import { bestChannel } from '../lib/revenue'
import { defaultQtyFor, spaceById } from '../data/spaces'
import { ProductThumb } from './ProductThumb'
import type { Product } from '../types'

/**
 * 상품 카드 — 쇼핑몰 목록처럼 보이게 하는 것이 목적입니다.
 *
 * 정사각 이미지가 위, 이름·가격·판매처가 아래, 구매 버튼이 맨 아래.
 * 이 순서가 익숙해서 사람이 훑는 속도가 빨라집니다.
 *
 * 이미지는 생성물입니다 — 실제 판매 상품의 사진이 아닙니다. 라벨을 반드시
 * 표시합니다. 표시 없이 상품 이미지처럼 두면 소비자를 오인시키는 광고가 됩니다.
 */
export function ShopCard({
  product,
  badge,
}: {
  product: Product
  badge?: string
}) {
  const { affiliateIds, enabledMalls, addToMoodboard, moodboard, showToast, spaceId } = useStudio()
  const inBoard = moodboard.some((m) => m.sku === product.sku)

  // 폴백된 벡터 실루엣에 "AI 이미지" 라벨을 붙이면 사실과 다릅니다.
  const [isPhoto, setIsPhoto] = useState(false)
  const onPhotoResolved = useCallback((v: boolean) => setIsPhoto(v), [])

  // 자재는 면적으로 사므로 단가가 아니라 주문액으로 채널을 골라야 합니다.
  const qty = defaultQtyFor(product, spaceById(spaceId))
  const pick = bestChannel(product, enabledMalls, affiliateIds, { qtyBySku: { [product.sku]: qty } })
  const href = pick ? buildDeeplink(pick.mall.id, product.searchTerm, affiliateIds) : product.officialUrl

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line-soft bg-ink-900">
      <div className="relative aspect-square bg-ink-850">
        <ProductThumb product={product} photo onPhotoResolved={onPhotoResolved} className="h-full w-full" />
        {isPhoto ? (
          <span
            title="이 이미지는 AI 가 만든 연출 컷입니다. 실제 판매 상품의 사진이 아닙니다."
            className="absolute bottom-1.5 left-1.5 rounded-md bg-ink-950/85 px-1.5 py-0.5 text-xs font-semibold text-mist-200"
          >
            AI 이미지
          </span>
        ) : null}
        {badge ? (
          <span className="absolute right-1.5 top-1.5 rounded-md border border-emerald-brand bg-emerald-brand/15 px-1.5 py-0.5 text-xs font-bold text-emerald-brand">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-mist-200">{product.name}</p>
        <p className="text-xs text-mist-500">
          {product.brand} · ★{product.rating}
        </p>
        <p className="mt-auto pt-1">
          <span className="text-base font-bold text-amber-brand">{unitPrice(product.price, product.unit)}</span>
          {pick ? (
            <span className="ml-1.5 text-xs text-mist-500" title="가정에 기반한 클릭당 기대 정산액입니다.">
              {pick.mall.icon} {usdFine(pick.perClick)}/클릭
            </span>
          ) : null}
        </p>

        <div className="mt-1.5 flex gap-1.5">
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener sponsored"
            className="flex-1 rounded-md bg-gradient-to-b from-amber-brand to-amber-deep px-2.5 py-2 text-center text-xs font-bold text-on-brand hover:brightness-110"
          >
            구매하러 가기
          </a>
          <button
            onClick={() => {
              addToMoodboard(product.sku)
              showToast(`${product.brand} 제품을 무드보드에 담았습니다.`)
            }}
            aria-label={inBoard ? '수량 추가' : '무드보드에 담기'}
            className={`rounded-md border px-2.5 py-2 text-xs font-semibold ${
              inBoard
                ? 'border-line text-mist-400 hover:text-mist-200'
                : 'border-emerald-brand bg-emerald-brand/10 text-emerald-brand hover:bg-emerald-brand/20'
            }`}
          >
            {inBoard ? '＋' : '✓ 담기'}
          </button>
        </div>
      </div>
    </div>
  )
}
