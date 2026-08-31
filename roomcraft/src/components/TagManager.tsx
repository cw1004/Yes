import { useState } from 'react'
import { useStudio } from '../store/useStudio'
import { CATALOG, productBySku } from '../data/catalog'
import { styleById } from '../data/styles'
import { copyToClipboard, downloadText, toShoppableHtml } from '../lib/exporters'
import { resolveLinks } from '../lib/tracking'
import { useAuth } from '../store/useAuth'
import { productsBySkus } from '../data/catalog'
import { usd } from '../lib/format'
import { Badge, Button, inputClass } from './ui/primitives'
import { ProductThumb } from './ProductThumb'

/**
 * 이미지 위 태그 관리 바.
 * 태그 추가/제거와, 태그가 그대로 살아있는 쇼퍼블 이미지 HTML 내보내기를 담당합니다.
 */
export function TagManager() {
  const {
    hotspots,
    render,
    styleId,
    projectName,
    affiliateIds,
    enabledMalls,
    addHotspot,
    removeHotspot,
    showToast,
  } = useStudio()
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)
  // 가입 없이도 서버가 게스트 세션으로 추적 링크를 발급합니다.
  const serverAvailable = useAuth((s) => s.serverAvailable)

  const style = styleById(styleId)
  const tagged = new Set(hotspots.map((h) => h.sku))
  const needle = q.trim().toLowerCase()

  const untagged = CATALOG.filter((p) => !tagged.has(p.sku))
  const matches = needle
    ? untagged.filter((p) => p.name.toLowerCase().includes(needle) || p.brand.toLowerCase().includes(needle))
    : // 검색어가 없으면 현재 스타일 큐레이션을 먼저 보여주되,
      // 큐레이션이 이미 전부 태그된 경우에는 나머지 카탈로그로 이어갑니다.
      // (그렇지 않으면 목록이 비어 태그 추가가 불가능한 것처럼 보입니다.)
      [
        ...untagged.filter((p) => style.curatedSkus.includes(p.sku)),
        ...untagged.filter((p) => !style.curatedSkus.includes(p.sku)),
      ]
  const candidates = matches.slice(0, 8)

  /** 내보내기 직전에 추적 링크를 발급받습니다(비로그인이면 원본 딥링크로 폴백). */
  const exportHtml = async () => {
    if (!render) return null
    const mallId = enabledMalls[0] ?? 'coupang'
    const rows = productsBySkus(hotspots.map((h) => h.sku)).map((product) => ({ product, qty: 1 }))

    const { resolver, tracked } = await resolveLinks({
      rows,
      mallIds: [mallId],
      affiliateIds,
      source: 'shoppable',
      enabled: serverAvailable,
    })

    return {
      html: toShoppableHtml({
        imageUrl: render.imageUrl,
        hotspots,
        affiliateIds,
        mallId,
        title: `${projectName} — ${style.name}`,
        resolve: resolver,
      }),
      tracked,
    }
  }

  const runExport = async (after: (html: string, tracked: boolean) => void) => {
    setExporting(true)
    try {
      const result = await exportHtml()
      if (result) after(result.html, result.tracked)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="rounded-xl border border-line-soft bg-ink-850 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-mist-200">🏷 이미지 태그</span>
          <Badge tone={hotspots.length ? 'amber' : 'neutral'}>{hotspots.length}개</Badge>
          {hotspots.map((h) => {
            const p = productBySku(h.sku)
            if (!p) return null
            return (
              <span
                key={h.id}
                className="group flex items-center gap-1 rounded-md border border-line-soft bg-ink-900 py-1 pl-1.5 pr-1 text-xs text-mist-300"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.swatch }} />
                <span className="max-w-[110px] truncate">{p.name}</span>
                <button
                  onClick={() => removeHotspot(h.id)}
                  className="grid h-4 w-4 place-items-center rounded text-mist-500 hover:bg-ink-800 hover:text-red-400"
                  title="태그 제거"
                >
                  ✕
                </button>
              </span>
            )
          })}
          <Button size="sm" variant="chip" onClick={() => setPicking((v) => !v)}>
            ＋ 태그 추가
          </Button>
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="success"
            disabled={!hotspots.length || !render || exporting}
            onClick={() =>
              void runExport(async (html, tracked) => {
                const ok = await copyToClipboard(html)
                showToast(
                  ok
                    ? `쇼퍼블 이미지 HTML을 복사했습니다.${tracked ? ' (클릭 추적 링크 적용)' : ''}`
                    : '복사에 실패했습니다.',
                )
              })
            }
          >
            📋 쇼퍼블 HTML 복사
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hotspots.length || !render || exporting}
            onClick={() =>
              void runExport((html, tracked) => {
                downloadText(`shoppable-${Date.now()}.html`, html, 'text/html')
                showToast(`쇼퍼블 이미지 HTML을 저장했습니다.${tracked ? ' (클릭 추적 적용)' : ''}`)
              })
            }
          >
            ⤓ HTML
          </Button>
        </div>
      </div>

      {picking ? (
        <div className="mt-3 border-t border-line-soft pt-3">
          <input
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제품/브랜드 검색 (비우면 현재 스타일 큐레이션)"
          />
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {candidates.map((p) => (
              <button
                key={p.sku}
                onClick={() => {
                  addHotspot(p.sku)
                  setPicking(false)
                  setQ('')
                }}
                className="flex items-center gap-2 rounded-lg border border-line-soft bg-ink-900 px-2.5 py-2 text-left transition hover:border-amber-brand/50"
              >
                <ProductThumb product={p} className="h-7 w-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-mist-200">{p.name}</span>
                  <span className="block text-xs text-mist-500">
                    {p.brand} · {usd(p.price)}
                  </span>
                </span>
              </button>
            ))}
            {!candidates.length ? (
              <p className="col-span-full py-2 text-center text-xs text-mist-500">
                추가할 제품이 없습니다.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-mist-500">
        내보낸 HTML은 이미지와 태그 위치를 그대로 담고 있어 블로그에서도 클릭하면 제휴 링크로 이동합니다.
        일부 에디터는 인라인 스타일을 제한하므로, 붙여넣은 뒤 미리보기로 확인하세요.
        {serverAvailable ? ' 링크는 클릭 추적용으로 발급됩니다.' : ' 서버에 연결되면 클릭 수가 집계됩니다.'}
      </p>
    </div>
  )
}
