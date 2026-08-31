import type { FloorPlan, Opening, Room } from './types'

/**
 * 평형·베이 구조로 평면도를 생성합니다.
 *
 * ── 왜 실제 도면을 불러오지 않는가 ─────────────────────────────────────
 * 주소나 단지명으로 실제 아파트 평면도를 부르려면 건설사·도면 제공사가 라이선스한
 * 데이터가 필요합니다. 그 도면 자체가 저작물이라 임의로 복제해 넣을 수 없고,
 * 이 앱에는 그런 DB 도 없습니다. 없는 데이터를 그럴듯하게 그려 놓고 "우리집 도면"이라
 * 부르면 그건 거짓말입니다.
 *
 * 대신 한국 아파트에서 실제로 반복되는 구성(전용면적, 베이 수, 남향 실 배치)을
 * 파라미터로 받아 도식 평면을 만듭니다. 치수는 사용자가 실측으로 고칠 수 있어야 하고,
 * source: 'generated' 로 남겨 화면에도 생성 도면임을 표시합니다.
 *
 * 베이(bay) = 남향(발코니 면)에 붙는 실의 개수입니다. 3베이는 거실+방2,
 * 4베이는 거실+방3 이 전면에 늘어섭니다.
 */

export interface PlanSpec {
  /** 전용면적 (m²) */
  areaSqm: number
  /** 남향에 면한 실 개수 */
  bays: 3 | 4
  name?: string
}

/** 한국 아파트에서 실제로 흔한 평형 */
export const COMMON_SPECS: (PlanSpec & { label: string })[] = [
  { label: '17평 (39㎡) · 3베이', areaSqm: 39, bays: 3 },
  { label: '24평 (59㎡) · 3베이', areaSqm: 59, bays: 3 },
  { label: '29평 (74㎡) · 3베이', areaSqm: 74, bays: 3 },
  { label: '34평 (84㎡) · 3베이', areaSqm: 84, bays: 3 },
  { label: '34평 (84㎡) · 4베이', areaSqm: 84, bays: 4 },
  { label: '43평 (114㎡) · 4베이', areaSqm: 114, bays: 4 },
]

const MM = 1000

/**
 * 전용면적에서 외곽 치수를 정합니다.
 *
 * 한국 아파트는 발코니 면(전면)이 넓고 깊이가 얕은 직사각형이 일반적입니다.
 * 가로세로비 1.45 정도가 실제 평면에 가깝습니다.
 */
function envelope(areaSqm: number): { w: number; h: number } {
  const ratio = 1.45
  const h = Math.sqrt((areaSqm * 1_000_000) / ratio)
  return { w: Math.round((h * ratio) / 10) * 10, h: Math.round(h / 10) * 10 }
}

export function generatePlan(spec: PlanSpec): FloorPlan {
  const { w, h } = envelope(spec.areaSqm)
  const wall = 150

  const rooms: Room[] = []
  const openings: Opening[] = []

  /*
   * 남향(아래쪽)에 베이를 늘어놓습니다. 거실이 가장 넓고 나머지는 방입니다.
   * 전면 깊이는 전체의 60% — 뒤쪽 40% 에 주방·욕실·현관·복도가 들어갑니다.
   */
  const frontH = Math.round(h * 0.6)
  const backH = h - frontH

  // 거실이 전면 폭의 42%(3베이) / 36%(4베이) 를 차지합니다.
  const livingW = Math.round(w * (spec.bays === 3 ? 0.42 : 0.36))
  const bedroomCount = spec.bays - 1
  const bedroomW = Math.round((w - livingW) / bedroomCount)

  rooms.push({ id: 'living', name: '거실', kind: 'living', x: 0, y: backH, w: livingW, h: frontH })
  for (let i = 0; i < bedroomCount; i++) {
    const x = livingW + i * bedroomW
    const bw = i === bedroomCount - 1 ? w - x : bedroomW
    rooms.push({
      id: `bed${i + 1}`,
      name: i === 0 ? '안방' : `침실 ${i + 1}`,
      kind: 'bedroom',
      x,
      y: backH,
      w: bw,
      h: frontH,
    })
  }

  // 뒤쪽: 주방 · 욕실 · 현관 · 복도
  const kitchenW = Math.round(w * 0.4)
  const bathW = Math.round(w * 0.22)
  const entryW = Math.round(w * 0.2)
  rooms.push({ id: 'kitchen', name: '주방 & 다이닝', kind: 'kitchen', x: 0, y: 0, w: kitchenW, h: backH })
  rooms.push({ id: 'bath1', name: '욕실', kind: 'bathroom', x: kitchenW, y: 0, w: bathW, h: backH })
  rooms.push({
    id: 'entry',
    name: '현관',
    kind: 'entry',
    x: kitchenW + bathW,
    y: 0,
    w: entryW,
    h: Math.round(backH * 0.55),
  })
  rooms.push({
    id: 'utility',
    name: '다용도실',
    kind: 'utility',
    x: kitchenW + bathW + entryW,
    y: 0,
    w: w - (kitchenW + bathW + entryW),
    h: backH,
  })

  // 남향 발코니 — 전면 전체에 깊이 1400mm
  rooms.push({ id: 'balcony', name: '발코니', kind: 'balcony', x: 0, y: h, w, h: 1400 })

  /*
   * 개구부.
   * 현관문, 각 방 문, 거실↔주방 아치, 발코니 창을 놓습니다.
   * 문 폭은 실제 규격(거실 900, 방 800, 욕실 700)을 씁니다 —
   * 이 값이 동선 검사의 기준이 됩니다.
   */
  openings.push({
    id: 'entry-door', kind: 'door', axis: 'h', width: 900,
    x: kitchenW + bathW + entryW / 2, y: 0, swing: 1,
  })
  for (let i = 0; i < bedroomCount; i++) {
    const room = rooms.find((r) => r.id === `bed${i + 1}`)!
    openings.push({
      id: `${room.id}-door`, kind: 'door', axis: 'h', width: 800,
      x: room.x + room.w / 2, y: backH, swing: -1,
    })
  }
  openings.push({
    id: 'bath-door', kind: 'door', axis: 'h', width: 700,
    x: kitchenW + bathW / 2, y: backH, swing: -1,
  })
  openings.push({
    id: 'living-arch', kind: 'archway', axis: 'h', width: Math.round(livingW * 0.7),
    x: livingW / 2, y: backH,
  })
  openings.push({ id: 'balcony-window', kind: 'window', axis: 'h', width: Math.round(w * 0.8), x: w / 2, y: h })

  return {
    id: `gen-${spec.areaSqm}-${spec.bays}`,
    name: spec.name ?? `${Math.round(spec.areaSqm / 3.3058)}평 (${spec.areaSqm}㎡) · ${spec.bays}베이`,
    width: w,
    height: h,
    rooms,
    openings,
    wallThickness: wall,
    source: 'generated',
  }
}

/** 도면 전체 전용면적 (발코니 제외) */
export const planAreaSqm = (plan: FloorPlan): number =>
  plan.rooms.filter((r) => r.kind !== 'balcony').reduce((s, r) => s + (r.w * r.h) / 1_000_000, 0)

export { MM }
