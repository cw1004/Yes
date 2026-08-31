/**
 * 평면도 모델.
 *
 * 모든 좌표와 치수는 **mm** 입니다. 화면 비율(%)로 두면 "통로 900mm 확보" 같은
 * 판단을 아예 할 수 없습니다 — 동선 검사를 하려면 실측 단위가 필요합니다.
 *
 * 원점은 도면 좌상단, x 는 오른쪽, y 는 아래쪽입니다.
 */

export interface Vec {
  x: number
  y: number
}

/** 방 하나. 지금은 직사각형만 다룹니다(대부분의 아파트 실이 직사각형입니다). */
export interface Room {
  id: string
  /** 화면에 표시할 이름 */
  name: string
  /** 어떤 용도의 방인지 — 가구 추천과 동선 규칙에 씁니다 */
  kind: 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'entry' | 'balcony' | 'utility'
  x: number
  y: number
  w: number
  h: number
}

/** 벽에 뚫린 개구부. 문은 열림 반경까지 동선 검사에 반영합니다. */
export interface Opening {
  id: string
  kind: 'door' | 'window' | 'archway'
  /** 개구부 중심 */
  x: number
  y: number
  /** 개구부 폭 */
  width: number
  /** 벽 방향 — 수평 벽이면 'h', 수직 벽이면 'v' */
  axis: 'h' | 'v'
  /** 문이 열리는 쪽 (동선 검사에서 열림 반경을 비워야 합니다) */
  swing?: 1 | -1
}

export interface FloorPlan {
  id: string
  name: string
  /** 전체 외곽 */
  width: number
  height: number
  rooms: Room[]
  openings: Opening[]
  /** 벽 두께 — 그리기와 면적 계산에 씁니다 */
  wallThickness: number
  /**
   * 생성된 도면인지 실측 도면인지.
   *
   * 주소로 실제 아파트 도면을 불러오려면 건설사·도면 제공사가 라이선스한 데이터가
   * 필요합니다. 그런 DB 없이 그린 도면을 "우리집 도면"이라고 부르면 거짓말이 됩니다.
   * 그래서 출처를 데이터에 남기고 화면에도 표시합니다.
   */
  source: 'generated' | 'user-drawn' | 'imported'
}

/** 도면 위에 놓인 가구 하나 */
export interface PlacedItem {
  id: string
  sku: string
  /** 가구 중심 좌표 (mm) */
  x: number
  y: number
  /** 회전 각도 (도). 0 = 정면이 아래쪽 */
  rot: number
}

/** 가구 치수 (mm). 폭 × 깊이 × 높이 */
export interface Dims {
  w: number
  d: number
  h: number
}

/** 회전을 반영한 바운딩 박스 (축 정렬) */
export function footprint(item: PlacedItem, dims: Dims): { x: number; y: number; w: number; h: number } {
  const rad = (item.rot * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const w = dims.w * c + dims.d * s
  const h = dims.w * s + dims.d * c
  return { x: item.x - w / 2, y: item.y - h / 2, w, h }
}

export const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** 사각형 두 개 사이의 최단 거리 (겹치면 0) */
export function rectGap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

export const roomOf = (plan: FloorPlan, p: Vec): Room | null =>
  plan.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) ?? null

export const areaSqm = (r: { w: number; h: number }): number => (r.w * r.h) / 1_000_000
