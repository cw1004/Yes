/**
 * 수익 최적화 점검 — 브라우저 콘솔에서 window.__revenueCheck() 로 실행합니다.
 * 기존 동작("켜둔 채널 중 첫 번째")과 최적 채널을 나란히 비교합니다.
 */
import { CATALOG } from '../data/catalog'
import { DEFAULT_ENABLED_MALLS, EMPTY_AFFILIATE_IDS, PROGRAMS } from '../lib/affiliate'
import { rankByRevenue } from '../lib/revenue'

export function revenueCheck() {
  // 모든 프로그램에 ID가 있다고 가정 — 링크 여부가 순위를 가리지 않게 합니다.
  const ids = PROGRAMS.reduce((a, p) => ({ ...a, [p.id]: 'TEST' }), {} as typeof EMPTY_AFFILIATE_IDS)
  const ranked = rankByRevenue(CATALOG, DEFAULT_ENABLED_MALLS, ids)
  const rows = ranked.slice(0, 12).map((r, i) => ({
    '#': i + 1,
    제품: r.product.name.slice(0, 34),
    가격: `$${r.product.price.toLocaleString()}`,
    최적채널: r.best.mall.label,
    수수료: `${(r.best.rate * 100).toFixed(1)}%`,
    전환가정: `${(r.best.conversion * 100).toFixed(2)}%`,
    클릭당: `$${r.best.perClick.toFixed(3)}`,
    '첫채널대비': `${r.liftVsFirst.toFixed(1)}×`,
  }))
  const totalBest = ranked.reduce((s, r) => s + r.best.perClick, 0)
  const totalFirst = ranked.reduce((s, r) => {
    const first = [r.best, ...r.runnersUp].find((p) => p.mall.id === DEFAULT_ENABLED_MALLS[0])
    return s + (first?.perClick ?? 0)
  }, 0)
  // 채널 분포 — 가격대별로 실제로 갈리는지 확인합니다.
  const byMall: Record<string, { n: number; min: number; max: number }> = {}
  for (const r of ranked) {
    const k = r.best.mall.label
    const e = (byMall[k] ??= { n: 0, min: Infinity, max: 0 })
    e.n++
    e.min = Math.min(e.min, r.product.price)
    e.max = Math.max(e.max, r.product.price)
  }
  const dist = Object.entries(byMall)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([mall, v]) => ({ 채널: mall, 제품수: v.n, 가격대: `$${v.min.toLocaleString()} ~ $${v.max.toLocaleString()}` }))
  return { rows, dist, totalBest, totalFirst, lift: totalBest / totalFirst, count: ranked.length }
}
