import type { Product, Silhouette } from '../../types'
import type { Dims, FloorPlan, PlacedItem, Room } from './types'
import { areaSqm, footprint, rectGap, rectsOverlap, roomOf } from './types'

/**
 * 동선 · 부피감 검사.
 *
 * "가구를 놓아보는 것"만으로는 배치가 되는지 알 수 없습니다. 실제로 살 때 문제가 되는
 * 것은 가구 자체가 아니라 **가구 사이에 남는 공간**입니다 — 식탁 뒤에서 의자를 뺄 수
 * 있는지, 침대 옆으로 지나갈 수 있는지, 문이 가구에 걸리지 않는지.
 *
 * 아래 수치는 인체 치수에서 나온 통용 기준입니다. 법정 기준이 아니라 실무 권장값이며,
 * 파일 안에 근거를 적어 두었습니다. 화면에도 권장값임을 표시합니다.
 */

/** 가구 유형별 표준 치수 (mm). 폭 × 깊이 × 높이 */
const DEFAULT_DIMS: Record<Silhouette, Dims> = {
  // 좌석
  sofa: { w: 2200, d: 900, h: 800 },
  lounge: { w: 800, d: 850, h: 900 },
  'dining-chair': { w: 480, d: 520, h: 850 },
  stool: { w: 400, d: 400, h: 650 },
  bench: { w: 1400, d: 400, h: 450 },
  // 테이블
  'coffee-table': { w: 1100, d: 600, h: 400 },
  'dining-table': { w: 1600, d: 900, h: 750 },
  // 수납
  sideboard: { w: 1600, d: 450, h: 750 },
  shelf: { w: 900, d: 350, h: 1800 },
  // 조명
  'floor-lamp': { w: 400, d: 400, h: 1600 },
  pendant: { w: 400, d: 400, h: 300 },
  'table-lamp': { w: 300, d: 300, h: 450 },
  // 기타
  rug: { w: 2000, d: 3000, h: 10 },
  vase: { w: 300, d: 300, h: 450 },
  mirror: { w: 900, d: 40, h: 1200 },
  art: { w: 1000, d: 40, h: 800 },
  plant: { w: 600, d: 600, h: 1500 },
  bed: { w: 1600, d: 2000, h: 500 },
  appliance: { w: 600, d: 650, h: 1800 },
  // 자재는 바닥에 놓이는 물건이 아니라 마감이므로 배치 대상이 아닙니다.
  flooring: { w: 0, d: 0, h: 0 },
  tile: { w: 0, d: 0, h: 0 },
  paint: { w: 0, d: 0, h: 0 },
  wallpaper: { w: 0, d: 0, h: 0 },
  door: { w: 900, d: 40, h: 2100 },
  window: { w: 1200, d: 40, h: 1400 },
  countertop: { w: 0, d: 0, h: 0 },
  faucet: { w: 200, d: 200, h: 350 },
  moulding: { w: 0, d: 0, h: 0 },
  hardware: { w: 0, d: 0, h: 0 },
}

/**
 * 제품의 치수.
 *
 * **이 값은 제조사 스펙이 아니라 그 가구 유형의 통상 치수입니다.** 138개 제품의
 * 실제 치수를 제가 확인할 방법이 없어서, 확인되지 않은 숫자를 스펙인 것처럼 넣지
 * 않았습니다. 동선이 되는지 가늠하는 용도로는 충분하지만, 실제 구매 전에는 반드시
 * 제품 페이지의 실측 치수로 다시 확인해야 합니다.
 */
export function dimsOf(product: Product): Dims {
  return DEFAULT_DIMS[product.silhouette]
}

/** 배치 가능한 품목인지 — 마감재는 도면에 놓지 않습니다. */
export const isPlaceable = (product: Product): boolean => dimsOf(product).w > 0

/**
 * 이격 기준 (mm).
 *
 * - 주 통로 900: 성인 한 명이 편히 지나가는 폭. 휠체어 기준은 1200 입니다.
 * - 보조 통로 700: 옆으로 서서 지나갈 수 있는 최소폭.
 * - 식탁 뒤 900: 의자를 빼고 일어서는 데 필요한 깊이.
 * - 소파–테이블 350~450: 다리를 넣고 앉을 수 있으면서 손이 닿는 거리.
 * - 침대 옆 700: 이불을 정리하며 지나갈 수 있는 폭.
 * - 문 앞 반경 = 문 폭: 문이 열리는 부채꼴을 비워야 합니다.
 */
export const CLEARANCE = {
  primaryPath: 900,
  secondaryPath: 700,
  diningPullOut: 900,
  sofaToTableMin: 350,
  sofaToTableMax: 450,
  bedSide: 700,
} as const

export type IssueLevel = 'error' | 'warn'

export interface Issue {
  level: IssueLevel
  /** 관련 배치 항목 id */
  items: string[]
  title: string
  detail: string
  /** 화면에 표시할 위치 */
  at: { x: number; y: number }
}

export interface PlanReport {
  issues: Issue[]
  /** 방별 가구 점유율 */
  occupancy: { room: Room; areaSqm: number; usedSqm: number; ratio: number }[]
  /** 전체 점유율 */
  totalRatio: number
  /** 가장 좁은 통로 (mm). 측정할 통로가 없으면 null */
  narrowestGap: number | null
}

interface Resolved {
  item: PlacedItem
  product: Product
  dims: Dims
  box: { x: number; y: number; w: number; h: number }
}

export function inspectPlan(
  plan: FloorPlan,
  items: PlacedItem[],
  productBySku: (sku: string) => Product | undefined,
): PlanReport {
  const resolved: Resolved[] = []
  for (const item of items) {
    const product = productBySku(item.sku)
    if (!product) continue
    const dims = dimsOf(product)
    if (dims.w <= 0) continue
    resolved.push({ item, product, dims, box: footprint(item, dims) })
  }

  const issues: Issue[] = []

  // ── 1. 벽 밖으로 나갔는지 ───────────────────────────────────────────
  for (const r of resolved) {
    const out =
      r.box.x < 0 || r.box.y < 0 || r.box.x + r.box.w > plan.width || r.box.y + r.box.h > plan.height + 1400
    if (out) {
      issues.push({
        level: 'error',
        items: [r.item.id],
        title: '벽 밖으로 나감',
        detail: `${r.product.brand} 가 도면 밖에 걸쳐 있습니다.`,
        at: { x: r.item.x, y: r.item.y },
      })
    }
  }

  // ── 2. 가구끼리 겹침 ────────────────────────────────────────────────
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i]
      const b = resolved[j]
      // 러그는 아래에 깔리는 물건이라 겹쳐도 정상입니다.
      if (a.product.silhouette === 'rug' || b.product.silhouette === 'rug') continue
      if (rectsOverlap(a.box, b.box)) {
        issues.push({
          level: 'error',
          items: [a.item.id, b.item.id],
          title: '가구가 겹칩니다',
          detail: `${a.product.brand} 와 ${b.product.brand} 가 같은 자리를 차지합니다.`,
          at: { x: (a.item.x + b.item.x) / 2, y: (a.item.y + b.item.y) / 2 },
        })
      }
    }
  }

  // ── 3. 통로 폭 ──────────────────────────────────────────────────────
  let narrowest: number | null = null
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i]
      const b = resolved[j]
      if (a.product.silhouette === 'rug' || b.product.silhouette === 'rug') continue
      const gap = rectGap(a.box, b.box)
      if (gap <= 0) continue

      // 마주 보고 붙어 있는 조합(소파–테이블)은 오히려 가까워야 합니다.
      const pairIsSeatingSet =
        (a.product.silhouette === 'sofa' && b.product.silhouette === 'coffee-table') ||
        (b.product.silhouette === 'sofa' && a.product.silhouette === 'coffee-table')

      if (pairIsSeatingSet) {
        if (gap > CLEARANCE.sofaToTableMax) {
          issues.push({
            level: 'warn',
            items: [a.item.id, b.item.id],
            title: '소파와 테이블이 멉니다',
            detail: `${Math.round(gap)}mm — 손이 닿으려면 ${CLEARANCE.sofaToTableMin}~${CLEARANCE.sofaToTableMax}mm 가 적당합니다.`,
            at: { x: (a.item.x + b.item.x) / 2, y: (a.item.y + b.item.y) / 2 },
          })
        }
        continue
      }

      if (narrowest === null || gap < narrowest) narrowest = gap

      if (gap < CLEARANCE.secondaryPath) {
        issues.push({
          level: 'error',
          items: [a.item.id, b.item.id],
          title: '지나갈 수 없습니다',
          detail: `사이가 ${Math.round(gap)}mm 입니다. 옆으로 서서 지나가려 해도 ${CLEARANCE.secondaryPath}mm 는 필요합니다.`,
          at: { x: (a.item.x + b.item.x) / 2, y: (a.item.y + b.item.y) / 2 },
        })
      } else if (gap < CLEARANCE.primaryPath) {
        issues.push({
          level: 'warn',
          items: [a.item.id, b.item.id],
          title: '통로가 좁습니다',
          detail: `사이가 ${Math.round(gap)}mm 입니다. 주 통로는 ${CLEARANCE.primaryPath}mm 를 권장합니다.`,
          at: { x: (a.item.x + b.item.x) / 2, y: (a.item.y + b.item.y) / 2 },
        })
      }
    }
  }

  // ── 4. 식탁 의자를 뺄 공간 ──────────────────────────────────────────
  for (const r of resolved) {
    if (r.product.silhouette !== 'dining-table') continue
    const zone = {
      x: r.box.x - CLEARANCE.diningPullOut,
      y: r.box.y - CLEARANCE.diningPullOut,
      w: r.box.w + CLEARANCE.diningPullOut * 2,
      h: r.box.h + CLEARANCE.diningPullOut * 2,
    }
    const blocker = resolved.find(
      (o) =>
        o !== r &&
        o.product.silhouette !== 'rug' &&
        o.product.silhouette !== 'dining-chair' &&
        rectsOverlap(o.box, zone),
    )
    if (blocker) {
      issues.push({
        level: 'warn',
        items: [r.item.id, blocker.item.id],
        title: '의자를 뺄 공간이 부족합니다',
        detail: `식탁 둘레 ${CLEARANCE.diningPullOut}mm 안에 ${blocker.product.brand} 가 있습니다.`,
        at: { x: r.item.x, y: r.item.y },
      })
    }
  }

  // ── 5. 침대 옆 통로 ─────────────────────────────────────────────────
  for (const r of resolved) {
    if (r.product.silhouette !== 'bed') continue
    const room = roomOf(plan, { x: r.item.x, y: r.item.y })
    if (!room) continue
    const left = r.box.x - room.x
    const right = room.x + room.w - (r.box.x + r.box.w)
    // 한쪽 벽에 붙이는 것은 정상입니다. 양쪽 다 좁으면 문제입니다.
    if (Math.max(left, right) < CLEARANCE.bedSide) {
      issues.push({
        level: 'warn',
        items: [r.item.id],
        title: '침대 옆으로 지나갈 수 없습니다',
        detail: `양옆이 ${Math.round(left)}mm / ${Math.round(right)}mm 입니다. 한쪽은 ${CLEARANCE.bedSide}mm 를 남기세요.`,
        at: { x: r.item.x, y: r.item.y },
      })
    }
  }

  // ── 6. 문 열림 반경 ─────────────────────────────────────────────────
  for (const op of plan.openings) {
    if (op.kind !== 'door') continue
    const rad = op.width
    const swing = op.swing ?? 1
    const zone =
      op.axis === 'h'
        ? { x: op.x - rad / 2, y: swing > 0 ? op.y : op.y - rad, w: rad, h: rad }
        : { x: swing > 0 ? op.x : op.x - rad, y: op.y - rad / 2, w: rad, h: rad }

    const blocker = resolved.find((o) => o.product.silhouette !== 'rug' && rectsOverlap(o.box, zone))
    if (blocker) {
      issues.push({
        level: 'error',
        items: [blocker.item.id],
        title: '문이 가구에 걸립니다',
        detail: `문 열림 반경(${rad}mm) 안에 ${blocker.product.brand} 가 있습니다.`,
        at: { x: op.x, y: op.y },
      })
    }
  }

  // ── 부피감: 방별 가구 점유율 ────────────────────────────────────────
  const occupancy = plan.rooms
    .filter((r) => r.kind !== 'balcony')
    .map((room) => {
      const used = resolved
        .filter((o) => o.product.silhouette !== 'rug')
        .filter((o) => {
          const cx = o.item.x
          const cy = o.item.y
          return cx >= room.x && cx <= room.x + room.w && cy >= room.y && cy <= room.y + room.h
        })
        .reduce((s, o) => s + (o.box.w * o.box.h) / 1_000_000, 0)
      const roomArea = areaSqm(room)
      return { room, areaSqm: roomArea, usedSqm: used, ratio: roomArea ? used / roomArea : 0 }
    })

  const totalRoom = occupancy.reduce((s, o) => s + o.areaSqm, 0)
  const totalUsed = occupancy.reduce((s, o) => s + o.usedSqm, 0)

  return {
    issues,
    occupancy,
    totalRatio: totalRoom ? totalUsed / totalRoom : 0,
    narrowestGap: narrowest,
  }
}

/**
 * 새 가구를 놓을 빈자리를 찾습니다.
 *
 * 전부 방 한가운데에 놓으면 추가하는 즉시 서로 겹쳐서 "막힘 10건"이 뜹니다.
 * 실제 배치에서 가구는 대부분 벽을 등지므로, 벽에 가까운 자리부터 훑어
 * 기존 가구와 겹치지 않고 최소 통로가 확보되는 첫 자리를 씁니다.
 */
export function findFreeSpot(
  room: Room,
  dims: Dims,
  taken: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number } {
  /*
   * 주 통로(900mm)를 확보한 자리를 먼저 찾습니다.
   * 처음에는 보조 통로(700mm)를 기준으로 놓았는데, 검사기가 900mm 미만을 경고하므로
   * 가구를 올리자마자 "통로가 좁습니다" 가 떴습니다 — 배치기와 검사기가 서로 다른
   * 기준을 쓰면 안 됩니다. 여유가 없을 때만 보조 통로로 좁힙니다.
   */
  return search(room, dims, taken, CLEARANCE.primaryPath) ?? search(room, dims, taken, CLEARANCE.secondaryPath) ?? {
    x: room.x + room.w / 2,
    y: room.y + room.h / 2,
  }
}

function search(
  room: Room,
  dims: Dims,
  taken: { x: number; y: number; w: number; h: number }[],
  margin: number,
): { x: number; y: number } | null {
  const step = 100
  const halfW = dims.w / 2
  const halfD = dims.d / 2

  let best: { x: number; y: number; score: number } | null = null

  for (let y = room.y + halfD; y <= room.y + room.h - halfD; y += step) {
    for (let x = room.x + halfW; x <= room.x + room.w - halfW; x += step) {
      const box = { x: x - halfW, y: y - halfD, w: dims.w, h: dims.d }
      if (taken.some((t) => rectsOverlap(box, t))) continue
      if (taken.some((t) => rectGap(box, t) < margin)) continue

      /*
       * 벽 가까움만 보고 고르면 스캔 순서 때문에 전부 왼쪽 벽에 줄지어 붙습니다.
       * 이미 놓인 가구에서 떨어진 정도를 함께 봐서 방 전체에 퍼지게 합니다.
       */
      const toWall = Math.min(
        box.x - room.x,
        box.y - room.y,
        room.x + room.w - (box.x + box.w),
        room.y + room.h - (box.y + box.h),
      )
      const spread = taken.length ? Math.min(...taken.map((t) => rectGap(box, t))) : 0
      const score = -toWall / 1000 + Math.min(spread, 3000) / 2500
      if (!best || score > best.score) best = { x, y, score }
    }
  }

  return best ? { x: best.x, y: best.y } : null
}

/**
 * 점유율 해석.
 * 실무에서 통용되는 감각 — 35% 를 넘으면 방이 답답해지기 시작합니다.
 */
export function occupancyVerdict(ratio: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (ratio < 0.18) return { label: '여유로움 — 더 채울 수 있습니다', tone: 'good' }
  if (ratio < 0.35) return { label: '적정', tone: 'good' }
  if (ratio < 0.45) return { label: '빡빡함 — 동선을 확인하세요', tone: 'warn' }
  return { label: '과밀 — 가구를 줄이는 편이 낫습니다', tone: 'bad' }
}
