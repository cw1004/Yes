import { useMemo, useState } from 'react'
import { useMoodboardTotals, useStudio } from '../store/useStudio'
import { CATALOG } from '../data/catalog'
import { styleById } from '../data/styles'
import { estimateCommission } from '../lib/affiliate'
import { downloadText, toCsv } from '../lib/exporters'
import { usd } from '../lib/format'
import { Modal } from './ui/Modal'
import { Badge, Button, inputClass } from './ui/primitives'
import type { ProductCategory } from '../types'

const CATEGORIES: (ProductCategory | 'All')[] = [
  'All',
  'Seating',
  'Table',
  'Storage',
  'Lighting',
  'Rug',
  'Decor',
  'Appliance',
  'Bed',
]

export function MoodboardModal() {
  const {
    modal,
    closeModal,
    styleId,
    affiliateIds,
    addToMoodboard,
    removeFromMoodboard,
    setQty,
    clearMoodboard,
    openModal,
    showToast,
  } = useStudio()
  const { rows, total, count } = useMoodboardTotals()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('All')

  const style = styleById(styleId)
  const est = estimateCommission(total)

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return CATALOG.filter((p) => {
      if (cat !== 'All' && p.category !== cat) return false
      if (!needle) return true
      return (
        p.name.toLowerCase().includes(needle) ||
        p.brand.toLowerCase().includes(needle) ||
        p.searchTerm.includes(needle)
      )
    })
  }, [q, cat])

  return (
    <Modal
      open={modal === 'moodboard'}
      onClose={closeModal}
      icon="🗂"
      title="무드보드 & 글로벌 제품 카탈로그"
      subtitle={`${count}개 항목 · 총 ${usd(total)} · 예상 제휴 수수료 ${usd(est.expected, { cents: true })}`}
      headerRight={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!rows.length}
            onClick={() => {
              downloadText(`moodboard-${Date.now()}.csv`, toCsv(rows, affiliateIds), 'text/csv')
              showToast('무드보드를 CSV로 내보냈습니다.')
            }}
          >
            ⤓ 내보내기
          </Button>
          <Button size="sm" variant="success" onClick={() => openModal('monetization')}>
            💲 수익화
          </Button>
        </div>
      }
      width="max-w-6xl"
    >
      <div className="grid max-h-[74vh] gap-0 overflow-hidden bg-ink-900 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-h-0 flex-col border-r border-ink-700">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
            <input
              className={`${inputClass} flex-1 min-w-[180px]`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="제품/브랜드 검색 (예: 임스, Flos, 러그…)"
            />
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value as (typeof CATEGORIES)[number])}
              className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-2 text-xs text-mist-200 outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
            {results.map((p) => {
              const inBoard = rows.some((r) => r.product.sku === p.sku)
              const recommended = style.curatedSkus.includes(p.sku)
              return (
                <div key={p.sku} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
                  <div className="flex items-start gap-2.5">
                    <span className="h-12 w-12 shrink-0 rounded-md" style={{ background: p.swatch }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] font-semibold leading-snug text-mist-200">{p.name}</p>
                        {recommended ? <Badge tone="amber">추천</Badge> : null}
                      </div>
                      <p className="mt-1 text-[11px]">
                        <span className="font-bold text-amber-brand">{usd(p.price)}</span>
                        <span className="text-mist-500"> · {p.brand}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-[10px] text-mist-500">{p.reason}</p>
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" variant={inBoard ? 'chip' : 'primary'} onClick={() => addToMoodboard(p.sku)}>
                          {inBoard ? '＋ 수량 추가' : '＋ 담기'}
                        </Button>
                        <a
                          href={p.officialUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="grid h-7 w-7 place-items-center rounded-md border border-ink-700 text-[11px] text-mist-400 hover:text-amber-brand"
                        >
                          ↗
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {!results.length ? (
              <p className="col-span-full p-6 text-center text-xs text-mist-500">검색 결과가 없습니다.</p>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2.5">
            <p className="text-xs font-bold text-mist-200">내 무드보드 ({count})</p>
            <Button size="sm" variant="ghost" disabled={!rows.length} onClick={clearMoodboard}>
              전체 비우기
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {rows.length ? (
              rows.map(({ product, qty }) => (
                <div key={product.sku} className="rounded-lg border border-ink-700 bg-ink-850 p-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="h-9 w-9 shrink-0 rounded-md" style={{ background: product.swatch }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-mist-200">{product.name}</p>
                      <p className="text-[11px] text-amber-brand">{usd(product.price * qty)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setQty(product.sku, qty - 1)}
                        className="h-6 w-6 rounded border border-ink-600 text-mist-300 hover:border-amber-brand/50"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-xs tabular-nums text-mist-200">{qty}</span>
                      <button
                        onClick={() => setQty(product.sku, qty + 1)}
                        className="h-6 w-6 rounded border border-ink-600 text-mist-300 hover:border-amber-brand/50"
                      >
                        ＋
                      </button>
                      <button
                        onClick={() => removeFromMoodboard(product.sku)}
                        className="ml-1 h-6 w-6 rounded border border-ink-600 text-mist-400 hover:border-red-500/50 hover:text-red-400"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-ink-600 p-6 text-center text-xs text-mist-500">
                왼쪽 카탈로그에서 가구를 담아보세요.
              </p>
            )}
          </div>
          <div className="border-t border-ink-700 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-mist-400">합계</span>
              <span className="font-bold text-mist-200">{usd(total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-mist-500">예상 제휴 수수료</span>
              <span className="font-semibold text-emerald-brand">{usd(est.expected, { cents: true })}</span>
            </div>
            <Button variant="success" className="mt-3 w-full" onClick={() => openModal('monetization')}>
              💲 제휴 링크 생성하러 가기
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
