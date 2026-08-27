import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/useAuth'
import { useStudio } from '../store/useStudio'
import { api } from '../lib/api'
import { mallById } from '../lib/affiliate'
import { productBySku } from '../data/catalog'
import { relativeTime, usd } from '../lib/format'
import { Badge, Button } from './ui/primitives'

interface Stats {
  links: {
    id: string
    sku: string
    mallId: string
    label: string
    source: string
    clicks: number
    visitors: number
    lastClick: number | null
  }[]
  totalClicks: number
  byMall: Record<string, number>
  bySku: Record<string, number>
}

const SOURCE_LABEL: Record<string, string> = {
  blog: '블로그',
  kakao: '카톡',
  csv: 'CSV',
  shoppable: '쇼퍼블 이미지',
  app: '앱',
}

/**
 * 실측 클릭 대시보드.
 *
 * 기대 정산액은 전환율 "가정"에 기반하지만, 여기 숫자는 실제로 발생한 클릭입니다.
 * 창작자가 어떤 채널·제품이 실제로 반응하는지 판단하는 유일한 근거입니다.
 */
export function ClickStats() {
  const user = useAuth((s) => s.user)
  const openModal = useStudio((s) => s.openModal)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      setStats(await api.linkStats())
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  if (!user) {
    return (
      <div className="rounded-xl border border-amber-brand/30 bg-amber-brand/8 p-4">
        <h4 className="text-xs font-bold text-amber-brand">실측 클릭 데이터 없음</h4>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist-400">
          지금 보이는 정산액은 전부 <strong className="text-mist-300">가정값</strong>입니다. 로그인하면 내보내는 링크가
          추적 링크로 발급되어, 어떤 채널·제품이 실제로 클릭되는지 여기서 확인할 수 있습니다.
        </p>
        <Button size="sm" variant="primary" className="mt-3" onClick={() => openModal('auth')}>
          🔐 로그인하고 클릭 추적 켜기
        </Button>
      </div>
    )
  }

  const top = stats?.links.filter((l) => l.clicks > 0).slice(0, 6) ?? []
  const maxClicks = top[0]?.clicks ?? 0

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-mist-200">실측 클릭 (내보낸 링크)</h4>
        <div className="flex items-center gap-2">
          <Badge tone={stats?.totalClicks ? 'emerald' : 'neutral'}>{stats?.totalClicks ?? 0}회</Badge>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-[11px] text-mist-400 transition hover:text-amber-brand disabled:opacity-50"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {top.length ? (
        <>
          <div className="mt-3 space-y-2">
            {top.map((l) => {
              const product = productBySku(l.sku)
              const mall = mallById(l.mallId as never)
              return (
                <div key={l.id}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate text-mist-300">
                      {mall.icon} {product?.name ?? l.label}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-brand">{l.clicks}회</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-deep to-emerald-brand"
                      style={{ width: `${maxClicks ? (l.clicks / maxClicks) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-mist-500">
                    {mall.label} · {SOURCE_LABEL[l.source] ?? l.source} · 방문자 {l.visitors}명
                    {product ? ` · ${usd(product.price)}` : ''}
                    {l.lastClick ? ` · 마지막 ${relativeTime(l.lastClick)}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="mt-3 border-t border-ink-700 pt-2 text-[10px] leading-relaxed text-mist-500">
            클릭은 실측치지만 <strong className="text-mist-400">구매 전환은 각 제휴 콘솔에서만 확인</strong>됩니다.
            클릭 대비 실제 정산액을 비교해 위 전환율 가정을 보정하세요.
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-ink-600 p-4 text-center text-[11px] leading-relaxed text-mist-500">
          아직 클릭이 없습니다.
          <br />
          수익 허브에서 블로그·카톡·쇼퍼블 HTML을 내보내면 그 링크의 클릭이 여기 집계됩니다.
        </p>
      )}
    </div>
  )
}
