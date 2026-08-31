/**
 * 1점 투시 방 상자.
 *
 * 기존 샘플 이미지는 정면 사각형 몇 개를 겹쳐 그린 것이라 방으로 보이지 않았고,
 * After 는 그 위에 색만 입혀서 Before 와 거의 같아 보였습니다. 이 앱의 핵심인
 * "사진 한 장이 확 바뀐다"는 순간이 아예 일어나지 않았습니다.
 *
 * 그래서 실제 원근을 계산합니다. 소실점 하나를 두고, 정면 프레임(캔버스 전체)을
 * 소실점 쪽으로 축소해 뒷벽을 만듭니다. 바닥의 한 점은
 *
 *   ground(x, z) = VP + scale(z) · (front(x) − VP)
 *
 * 로 구합니다. scale(z) 는 카메라 거리에 반비례하므로(1/d) 깊이가 화면에서 올바르게
 * 압축됩니다. 선형 보간을 쓰면 방 뒤쪽이 부자연스럽게 넓어집니다.
 */

export interface Point {
  x: number
  y: number
}

export interface RoomBox {
  w: number
  h: number
  /** 소실점 */
  vp: Point
  /** 뒷벽 축소율 — 작을수록 방이 깊어 보입니다 */
  back: number
  bl: Point
  br: Point
  tl: Point
  tr: Point
  /** 깊이 z(0=카메라 앞, 1=뒷벽)에서의 배율 */
  scaleAt: (z: number) => number
  /** 바닥 위의 점. x 는 -1(왼쪽 벽) ~ 1(오른쪽 벽) */
  ground: (x: number, z: number) => Point
  /** 바닥 점에서 방 높이의 비율 hh 만큼 올라간 점 */
  up: (p: Point, z: number, hh: number) => Point
}

export function makeRoom(
  w: number,
  h: number,
  opts: { back?: number; vpx?: number; vpy?: number } = {},
): RoomBox {
  const back = opts.back ?? 0.44
  const vp: Point = { x: w * (opts.vpx ?? 0.47), y: h * (opts.vpy ?? 0.60) }

  const shrink = (p: Point, s: number): Point => ({
    x: vp.x + (p.x - vp.x) * s,
    y: vp.y + (p.y - vp.y) * s,
  })

  /*
   * 깊이 z 에서의 배율. 카메라 거리 d 는 z 에 대해 선형이고 화면 크기는 1/d 이므로,
   * d(0)=1, d(1)=1/back 이 되도록 두면 scale(z)=1/d(z) 가 됩니다.
   */
  const scaleAt = (z: number) => 1 / (1 + z * (1 / back - 1))
  const front = (x: number): Point => ({ x: ((x + 1) / 2) * w, y: h })

  return {
    w,
    h,
    vp,
    back,
    bl: shrink({ x: 0, y: h }, back),
    br: shrink({ x: w, y: h }, back),
    tl: shrink({ x: 0, y: 0 }, back),
    tr: shrink({ x: w, y: 0 }, back),
    scaleAt,
    ground: (x, z) => shrink(front(x), scaleAt(z)),
    // 방 높이는 정면 프레임 기준 h 이므로, 깊이 z 에서는 h·scale(z) 만큼 올라갑니다.
    up: (p, z, hh) => ({ x: p.x, y: p.y - hh * h * scaleAt(z) }),
  }
}

/** 다각형 채우기 — 벽·바닥처럼 네 점으로 정의되는 면에 씁니다. */
export function fillPoly(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  fill: string | CanvasGradient,
): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const px = (hex: string): number[] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = (c: number[]): string =>
  `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

/** 밝기 배율. 면마다 다른 밝기를 줘야 상자가 입체로 보입니다. */
export const shade = (color: string, mul: number): string => hex(px(color).map((v) => v * mul))

/** 두 색을 섞습니다. */
export const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [px(a), px(b)]
  return hex(x.map((v, i) => lerp(v, y[i], t)))
}

/** 알파를 붙인 rgba 문자열 */
export const alpha = (color: string, a: number): string => {
  const [r, g, b] = px(color)
  return `rgba(${r},${g},${b},${a})`
}
