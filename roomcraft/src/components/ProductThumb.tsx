import { useEffect, useState } from 'react'
import type { Product, Silhouette } from '../types'

/**
 * 제품 썸네일.
 *
 * 원래는 product.swatch 한 색을 채운 사각형이었습니다. 무엇을 파는 물건인지
 * 알 수 없으니 목록을 훑어도 사고 싶어지지 않습니다.
 *
 * 실제 제품 사진은 쓸 수 없습니다 — 소매점 CDN 을 핫링크하는 것은 약관 위반이고
 * 이미지가 언제든 사라집니다. 대신 카테고리보다 한 단계 구체적인 형태
 * (소파/라운지체어/펜던트/러그…)를 벡터로 그리고, 제품의 재질 색 두 개를 입힙니다.
 *
 * 좌표계는 24×24 로 통일해 어느 크기로 써도 같은 비율이 나옵니다.
 */

/** 밝게 — 슬래브 윗면처럼 빛을 더 받는 면에 씁니다. */
function lighten(hex: string, amount = 0.18): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.min(255, Math.round(v + (255 - v) * amount)),
  )
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 보조색이 없으면 주색을 어둡게 만들어 씁니다. */
function darken(hex: string, amount = 0.32): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** a = 주 재질, b = 프레임·다리 등 보조 재질 */
function shapes(kind: Silhouette, a: string, b: string) {
  switch (kind) {
    case 'sofa':
      return (
        <>
          <rect x="2" y="15" width="20" height="5" rx="1.4" fill={a} />
          <rect x="2.6" y="9.5" width="18.8" height="6" rx="1.8" fill={a} opacity="0.82" />
          <rect x="1.4" y="11" width="3.2" height="8" rx="1.4" fill={b} />
          <rect x="19.4" y="11" width="3.2" height="8" rx="1.4" fill={b} />
          <rect x="4" y="20" width="1.6" height="2.4" rx="0.6" fill={b} />
          <rect x="18.4" y="20" width="1.6" height="2.4" rx="0.6" fill={b} />
        </>
      )
    case 'lounge':
      return (
        <>
          <path d="M5 18c-1.6-4.2-1.2-8.4 1.4-9.6 3-1.4 8.2-1.4 11.2 0 2.6 1.2 3 5.4 1.4 9.6z" fill={a} />
          <rect x="5" y="16.6" width="14" height="3.4" rx="1.5" fill={a} opacity="0.7" />
          <path d="M7.5 20v2.5M16.5 20v2.5" stroke={b} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    case 'dining-chair':
      return (
        <>
          <path d="M7 4.5c3.4-1 6.6-1 10 0l-1 7.5H8z" fill={a} />
          <rect x="5.5" y="12" width="13" height="2.8" rx="1.2" fill={a} />
          <path d="M7 14.8 6 22M17 14.8 18 22M8.6 14.8 9 22M15.4 14.8 15 22" stroke={b} strokeWidth="1.3" strokeLinecap="round" />
        </>
      )
    case 'stool':
      return (
        <>
          <ellipse cx="12" cy="9.5" rx="8" ry="2.6" fill={a} />
          <path d="M5.5 10.5 4 21M18.5 10.5 20 21M12 11v10" stroke={b} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    case 'bench':
      return (
        <>
          <rect x="2" y="11" width="20" height="3.6" rx="1.4" fill={a} />
          <path d="M5 14.6V21M19 14.6V21" stroke={b} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )
    case 'coffee-table':
      return (
        <>
          <ellipse cx="12" cy="10.5" rx="9.5" ry="3" fill={a} />
          <path d="M6 12.5 5 19M18 12.5 19 19" stroke={b} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5 19h14" stroke={b} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        </>
      )
    case 'dining-table':
      return (
        <>
          <rect x="1.5" y="8.5" width="21" height="2.8" rx="1.2" fill={a} />
          <path d="M4.5 11.3V21M19.5 11.3V21" stroke={b} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 13.5h15" stroke={b} strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
        </>
      )
    case 'sideboard':
      return (
        <>
          <rect x="2" y="7.5" width="20" height="10.5" rx="1.2" fill={a} />
          <path d="M12 7.5V18" stroke={b} strokeWidth="1" opacity="0.8" />
          <circle cx="9.6" cy="12.8" r="0.9" fill={b} />
          <circle cx="14.4" cy="12.8" r="0.9" fill={b} />
          <path d="M4.5 18v3.5M19.5 18v3.5" stroke={b} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    case 'shelf':
      return (
        <>
          <rect x="3.5" y="2.5" width="17" height="19" rx="1.2" fill={a} opacity="0.35" />
          <path d="M3.5 7.6h17M3.5 12.2h17M3.5 16.8h17" stroke={b} strokeWidth="1.5" />
          <rect x="5.5" y="4" width="2.4" height="3.6" rx="0.5" fill={b} opacity="0.9" />
          <rect x="9" y="4.6" width="1.8" height="3" rx="0.5" fill={b} opacity="0.65" />
          <rect x="14" y="8.8" width="3.2" height="3.4" rx="0.5" fill={b} opacity="0.75" />
        </>
      )
    case 'floor-lamp':
      return (
        <>
          <path d="M8 8.5h8l-1.6-4.6H9.6z" fill={a} />
          <path d="M12 8.5V20" stroke={b} strokeWidth="1.4" strokeLinecap="round" />
          <ellipse cx="12" cy="20.6" rx="5" ry="1.5" fill={b} />
        </>
      )
    case 'pendant':
      return (
        <>
          <path d="M12 1.5v5" stroke={b} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M5 15c0-4.4 3.1-8 7-8s7 3.6 7 8z" fill={a} />
          <ellipse cx="12" cy="15" rx="7" ry="1.6" fill={b} opacity="0.7" />
        </>
      )
    case 'table-lamp':
      return (
        <>
          <path d="M7 12h10l-2-6H9z" fill={a} />
          <path d="M12 12v6.5" stroke={b} strokeWidth="1.4" strokeLinecap="round" />
          <rect x="8" y="18.5" width="8" height="2.4" rx="1.1" fill={b} />
        </>
      )
    case 'rug':
      return (
        <>
          <rect x="1.5" y="6" width="21" height="12" rx="1.4" fill={a} />
          <rect x="4" y="8.4" width="16" height="7.2" rx="0.8" fill="none" stroke={b} strokeWidth="1.2" />
          <path d="M8 10.4 12 14l4-3.6" stroke={b} strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M1.5 6v12M22.5 6v12" stroke={b} strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
        </>
      )
    case 'vase':
      return (
        <>
          <path d="M9.5 3h5l-.6 3.2c2.4 1.6 3.6 4.2 3.6 7.4 0 4.4-2.4 7.4-6 7.4s-6-3-6-7.4c0-3.2 1.2-5.8 3.6-7.4z" fill={a} />
          <path d="M8.4 12.5c2.6 1.4 4.8 1.4 7.2 0" stroke={b} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
      )
    case 'mirror':
      return (
        <>
          <ellipse cx="12" cy="11.5" rx="7.5" ry="9" fill={a} />
          <ellipse cx="12" cy="11.5" rx="5.6" ry="7.1" fill="none" stroke={b} strokeWidth="1.4" />
          <path d="M9.4 7.6c-1.2 1.4-1.8 3-1.8 4.8" stroke={b} strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.8" />
        </>
      )
    case 'art':
      return (
        <>
          <rect x="2.5" y="3.5" width="19" height="17" rx="1" fill={b} />
          <rect x="4.6" y="5.6" width="14.8" height="12.8" rx="0.5" fill={a} />
          <path d="M4.6 15.4 9 10.6l3.4 3.6 2.8-2.4 4.2 3.6v2.6H4.6z" fill={b} opacity="0.55" />
          <circle cx="15.6" cy="8.8" r="1.3" fill={b} opacity="0.55" />
        </>
      )
    case 'plant':
      return (
        <>
          <path d="M12 13c-3.5-1-5.5-3.6-5-7 3.2.2 5 2.4 5 7z" fill={a} />
          <path d="M12 13c3.5-1.4 5.2-4.2 4.4-7.6-3.2.6-4.8 3-4.4 7.6z" fill={a} opacity="0.78" />
          <path d="M12 13V9" stroke={b} strokeWidth="1.1" strokeLinecap="round" />
          <path d="M7.5 13h9l-1.2 8h-6.6z" fill={b} />
        </>
      )
    case 'bed':
      return (
        <>
          <rect x="2" y="5" width="4" height="12" rx="1.2" fill={b} />
          <rect x="5.6" y="11.5" width="16.4" height="5.5" rx="1.2" fill={a} />
          <rect x="6.6" y="8.4" width="6" height="3.6" rx="1.4" fill={a} opacity="0.7" />
          <path d="M6.5 17v3.4M21 17v3.4" stroke={b} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    // ── 건축·건설 자재 ────────────────────────────────────────────────
    case 'flooring':
      // 널결이 겹쳐 깔린 단면. 마루/데크 공통.
      return (
        <>
          <rect x="1.5" y="7" width="21" height="4.2" rx="0.6" fill={a} />
          <rect x="1.5" y="11.6" width="21" height="4.2" rx="0.6" fill={darken(a, 0.12)} />
          <rect x="1.5" y="16.2" width="21" height="4.2" rx="0.6" fill={a} />
          <path d="M9 7v4.2M16.5 11.6v4.2M6 16.2v4.2M18 16.2v4.2" stroke={b} strokeWidth="0.9" />
          <path d="M1.5 4.6h21l-2.4 2.4H3.9z" fill={b} opacity="0.75" />
        </>
      )
    case 'tile':
      return (
        <>
          <rect x="2" y="2.5" width="20" height="19" rx="1" fill={a} />
          <path d="M12 2.5v19M2 12h20" stroke={b} strokeWidth="1.4" />
          <path d="M7 2.5v19M17 2.5v19M2 7.2h20M2 16.8h20" stroke={b} strokeWidth="0.7" opacity="0.55" />
        </>
      )
    case 'paint':
      return (
        <>
          <path d="M5.5 8h13l-1 12.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9z" fill={a} />
          <rect x="4.6" y="5.6" width="14.8" height="2.6" rx="0.8" fill={b} />
          <path d="M7.5 5.6a4.5 3 0 0 1 9 0" fill="none" stroke={b} strokeWidth="1.1" />
          <rect x="8.5" y="12" width="7" height="4.6" rx="0.6" fill={b} opacity="0.6" />
        </>
      )
    case 'wallpaper':
      // 한쪽이 말려 있는 롤 — 벽지/시트지.
      return (
        <>
          <rect x="6" y="3" width="12" height="18" rx="1" fill={a} />
          <path d="M6 3c-2.6 0-3.4 2-3.4 4.5S3.4 12 6 12z" fill={b} />
          <path d="M9 7h6M9 11h6M9 15h6" stroke={b} strokeWidth="1" opacity="0.7" />
        </>
      )
    case 'door':
      return (
        <>
          <rect x="4.5" y="2" width="15" height="20" rx="0.8" fill={b} />
          <rect x="6.2" y="3.6" width="11.6" height="16.8" rx="0.5" fill={a} />
          <rect x="7.6" y="5" width="8.8" height="6" rx="0.4" fill="none" stroke={b} strokeWidth="0.9" />
          <rect x="7.6" y="12.6" width="8.8" height="6.2" rx="0.4" fill="none" stroke={b} strokeWidth="0.9" />
          <circle cx="16.4" cy="12" r="0.95" fill={b} />
        </>
      )
    case 'window':
      return (
        <>
          <rect x="2.5" y="4" width="19" height="16" rx="0.8" fill={b} />
          <rect x="4.2" y="5.6" width="15.6" height="12.8" rx="0.4" fill="#dbe7ee" />
          <path d="M12 5.6v12.8M4.2 12h15.6" stroke={b} strokeWidth="1.3" />
          <path d="M5.6 7 9 10.4" stroke="#ffffff" strokeWidth="1" opacity="0.85" />
        </>
      )
    case 'countertop':
      // 두꺼운 상판 슬래브의 단면 — 대리석/엔지니어드 스톤.
      return (
        <>
          <path d="M2 9h20v3.4H2z" fill={a} />
          <path d="M2 12.4h20v2.2H2z" fill={b} />
          <path d="M2 9h20l-1.6-1.6H3.6z" fill={lighten(a)} />
          <path d="M5 10.2c2 .8 3.6-.6 5.6.2s3.4-.8 5.4 0" stroke={b} strokeWidth="0.7" fill="none" opacity="0.8" />
        </>
      )
    case 'faucet':
      return (
        <>
          <path d="M8 20V12c0-3.4 2.4-6 5.6-6H17" fill="none" stroke={a} strokeWidth="2.2" strokeLinecap="round" />
          <rect x="5.4" y="19.4" width="5.2" height="2.2" rx="1" fill={b} />
          <path d="M17 6v3.2" stroke={a} strokeWidth="2" strokeLinecap="round" />
          <path d="M11.6 9.6h4.6" stroke={b} strokeWidth="1.4" strokeLinecap="round" />
        </>
      )
    case 'moulding':
      // 몰딩 단면 프로파일 — 걸레받이/천장 몰딩.
      return (
        <>
          <path d="M3 20V8c2.2 0 2.2-2.4 4.4-2.4S9.6 8 11.8 8 14 4.6 16.2 4.6 18.4 8 21 8v12z" fill={a} />
          <path d="M3 20h18" stroke={b} strokeWidth="1.4" />
          <path d="M3 8c2.2 0 2.2-2.4 4.4-2.4S9.6 8 11.8 8 14 4.6 16.2 4.6 18.4 8 21 8" fill="none" stroke={b} strokeWidth="0.9" />
        </>
      )
    case 'hardware':
      // 손잡이·경첩 등 철물.
      return (
        <>
          <rect x="3" y="10.4" width="18" height="3.2" rx="1.6" fill={a} />
          <rect x="4.4" y="7.6" width="2.6" height="8.8" rx="1.2" fill={b} />
          <rect x="17" y="7.6" width="2.6" height="8.8" rx="1.2" fill={b} />
          <circle cx="12" cy="12" r="1.5" fill={b} opacity="0.6" />
        </>
      )
    case 'appliance':
      return (
        <>
          <rect x="4.5" y="2.5" width="15" height="19" rx="2" fill={a} />
          <path d="M4.5 10h15" stroke={b} strokeWidth="1.3" />
          <rect x="15.6" y="5" width="1.5" height="3.4" rx="0.7" fill={b} />
          <rect x="15.6" y="12" width="1.5" height="4.4" rx="0.7" fill={b} />
        </>
      )
  }
}

/**
 * 서버에 보관된 생성 이미지가 있으면 그것을, 없으면 벡터 실루엣을 씁니다.
 *
 * 없는 이미지를 매번 조회하면 목록을 스크롤할 때마다 404 가 쏟아지므로
 * 실패한 sku 를 모듈 수준에 기억해 두고 다시 시도하지 않습니다.
 */
const missing = new Set<string>()

export function ProductThumb({
  product,
  className = '',
  /** 생성 이미지를 쓸지. 작은 아이콘 자리에서는 실루엣이 더 잘 읽힙니다. */
  photo = false,
  /**
   * 실제로 생성 사진을 그렸는지 알려줍니다.
   * 부모가 "AI 이미지" 라벨을 붙일지 정해야 하는데, 폴백된 벡터 실루엣에까지
   * 그 라벨을 붙이면 사실과 다릅니다.
   */
  onPhotoResolved,
}: {
  product: Product
  className?: string
  photo?: boolean
  onPhotoResolved?: (usingPhoto: boolean) => void
}) {
  const a = product.swatch
  const b = product.swatch2 ?? darken(product.swatch)
  const [failed, setFailed] = useState(() => missing.has(product.sku))

  useEffect(() => setFailed(missing.has(product.sku)), [product.sku])
  useEffect(() => onPhotoResolved?.(photo && !failed), [photo, failed, onPhotoResolved])

  if (photo && !failed) {
    return (
      <img
        src={`/api/product-image/${encodeURIComponent(product.sku)}`}
        alt={product.name}
        loading="lazy"
        onError={() => {
          missing.add(product.sku)
          setFailed(true)
        }}
        onLoad={() => onPhotoResolved?.(true)}
        className={`shrink-0 rounded-md bg-ink-800 object-cover ${className}`}
      />
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 rounded-md bg-ink-800 ${className}`}
      role="img"
      aria-label={`${product.name} 썸네일`}
    >
      {shapes(product.silhouette, a, b)}
    </svg>
  )
}
