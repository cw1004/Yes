import type { RoomBox } from './geometry'
import { alpha, fillPoly, shade } from './geometry'
import { box, rug } from './draw'
import type { Materials } from './draw'

/**
 * 가구 조립.
 *
 * 전부 지면 좌표 (x, z) 로 놓기 때문에 방 어디에 두어도 원근이 맞습니다.
 * 소파 하나를 상자 하나로 그리면 블록처럼 보이므로, 좌판·등받이·팔걸이·다리를
 * 따로 쌓습니다. 실루엣이 가구로 읽히는지가 이 앱의 첫인상을 좌우합니다.
 */

export interface Palette {
  upholstery: string
  wood: string
  metal: string
  accent: string
}

export function sofa(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x0: number; x1: number; z: number; depth?: number; low?: boolean },
): void {
  const d = o.depth ?? 0.16
  const z0 = o.z
  const z1 = o.z + d
  const seatH = o.low ? 0.1 : 0.13
  const legH = o.low ? 0.025 : 0.055

  // 다리
  box(ctx, r, { x0: o.x0 + 0.02, x1: o.x0 + 0.05, z0: z0 + 0.01, z1: z0 + 0.04, y1: legH, color: p.wood })
  box(ctx, r, { x0: o.x1 - 0.05, x1: o.x1 - 0.02, z0: z0 + 0.01, z1: z0 + 0.04, y1: legH, color: p.wood })
  // 좌판
  box(ctx, r, { x0: o.x0, x1: o.x1, z0, z1, y0: legH, y1: legH + seatH, color: p.upholstery })
  // 등받이 (뒤쪽)
  box(ctx, r, {
    x0: o.x0, x1: o.x1, z0: z1 - d * 0.28, z1,
    y0: legH + seatH, y1: legH + seatH + (o.low ? 0.15 : 0.19),
    color: shade(p.upholstery, 0.94),
  })
  // 팔걸이
  const armW = (o.x1 - o.x0) * 0.1
  for (const [a, b] of [[o.x0, o.x0 + armW], [o.x1 - armW, o.x1]]) {
    box(ctx, r, { x0: a, x1: b, z0, z1, y0: legH + seatH, y1: legH + seatH + 0.085, color: shade(p.upholstery, 1.05) })
  }
  // 쿠션 — 강조색이 들어가는 자리
  const cw = (o.x1 - o.x0) * 0.13
  for (const cx of [o.x0 + armW + 0.02, o.x1 - armW - 0.02 - cw]) {
    box(ctx, r, {
      x0: cx, x1: cx + cw, z0: z1 - d * 0.42, z1: z1 - d * 0.2,
      y0: legH + seatH, y1: legH + seatH + 0.1, color: p.accent,
    })
  }
}

export function loungeChair(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x: number; z: number; w?: number },
): void {
  const w = o.w ?? 0.2
  const z0 = o.z
  const z1 = o.z + 0.16
  const seatTop = 0.155
  const arm = w * 0.14

  // 다리
  for (const [a, b] of [[o.x + 0.012, o.x + 0.04], [o.x + w - 0.04, o.x + w - 0.012]]) {
    box(ctx, r, { x0: a, x1: b, z0: z0 + 0.012, z1: z0 + 0.042, y1: 0.055, color: p.metal })
  }
  // 좌판
  box(ctx, r, { x0: o.x, x1: o.x + w, z0, z1, y0: 0.055, y1: seatTop, color: p.upholstery })
  /*
   * 등받이를 좌판 전체 폭으로 세우면 수납장으로 읽힙니다.
   * 안쪽으로 들여 세우고 양옆에 팔걸이를 따로 두어야 의자로 보입니다.
   */
  box(ctx, r, {
    x0: o.x + arm, x1: o.x + w - arm, z0: z1 - 0.04, z1,
    y0: seatTop, y1: 0.3, color: shade(p.upholstery, 0.9),
  })
  for (const [a, b] of [[o.x, o.x + arm], [o.x + w - arm, o.x + w]]) {
    box(ctx, r, { x0: a, x1: b, z0, z1, y0: seatTop, y1: seatTop + 0.055, color: shade(p.upholstery, 1.07) })
  }
}

export function coffeeTable(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x0: number; x1: number; z: number },
): void {
  const z1 = o.z + 0.11
  box(ctx, r, { x0: o.x0 + 0.02, x1: o.x0 + 0.045, z0: o.z + 0.02, z1: o.z + 0.045, y1: 0.095, color: p.metal })
  box(ctx, r, { x0: o.x1 - 0.045, x1: o.x1 - 0.02, z0: z1 - 0.045, z1: z1 - 0.02, y1: 0.095, color: p.metal })
  box(ctx, r, { x0: o.x0, x1: o.x1, z0: o.z, z1, y0: 0.095, y1: 0.118, color: p.wood })
}

export function diningSet(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x: number; z: number },
): void {
  const x0 = o.x
  const x1 = o.x + 0.42
  const z0 = o.z
  const z1 = o.z + 0.2
  for (const [cx, cz] of [[x0 + 0.03, z0 + 0.03], [x1 - 0.06, z0 + 0.03], [x0 + 0.03, z1 - 0.06], [x1 - 0.06, z1 - 0.06]]) {
    box(ctx, r, { x0: cx, x1: cx + 0.03, z0: cz, z1: cz + 0.03, y1: 0.24, color: p.wood })
  }
  box(ctx, r, { x0, x1, z0, z1, y0: 0.24, y1: 0.268, color: shade(p.wood, 1.12) })
  // 의자 — 상판 뒤에 등받이만 보이게 두면 식탁 구성이 읽힙니다.
  for (const cx of [x0 + 0.06, x0 + 0.2, x0 + 0.32]) {
    box(ctx, r, { x0: cx, x1: cx + 0.09, z0: z1 + 0.01, z1: z1 + 0.05, y0: 0.2, y1: 0.44, color: p.upholstery })
  }
}

export function bed(ctx: CanvasRenderingContext2D, r: RoomBox, p: Palette, o: { x: number; z: number }): void {
  const x0 = o.x
  const x1 = o.x + 0.6
  const z0 = o.z
  const z1 = o.z + 0.34
  // 헤드보드
  box(ctx, r, { x0, x1, z0: z1 - 0.03, z1, y1: 0.4, color: p.upholstery })
  // 매트리스
  box(ctx, r, { x0, x1, z0, z1: z1 - 0.03, y0: 0.06, y1: 0.18, color: '#f2efe8' })
  // 프레임
  box(ctx, r, { x0, x1, z0, z1: z1 - 0.03, y1: 0.06, color: p.wood })
  // 이불 접힘 + 쿠션
  box(ctx, r, { x0, x1, z0, z1: z0 + 0.1, y0: 0.18, y1: 0.208, color: p.accent })
  for (const cx of [x0 + 0.06, x0 + 0.34]) {
    box(ctx, r, { x0: cx, x1: cx + 0.2, z0: z1 - 0.11, z1: z1 - 0.05, y0: 0.18, y1: 0.26, color: '#ffffff' })
  }
}

export function sideboard(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x0: number; x1: number; z: number },
): void {
  box(ctx, r, { x0: o.x0, x1: o.x1, z0: o.z, z1: o.z + 0.07, y0: 0.04, y1: 0.3, color: p.wood })
  box(ctx, r, { x0: o.x0 + 0.01, x1: o.x0 + 0.03, z0: o.z, z1: o.z + 0.02, y1: 0.04, color: p.metal })
  box(ctx, r, { x0: o.x1 - 0.03, x1: o.x1 - 0.01, z0: o.z, z1: o.z + 0.02, y1: 0.04, color: p.metal })
}

export function shelfUnit(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  p: Palette,
  o: { x0: number; x1: number; z: number; tiers?: number },
): void {
  const tiers = o.tiers ?? 4
  const top = 0.72
  box(ctx, r, { x0: o.x0, x1: o.x1, z0: o.z, z1: o.z + 0.05, y1: top, color: shade(p.wood, 0.55) })
  for (let i = 1; i < tiers; i++) {
    const y = (top / tiers) * i
    box(ctx, r, { x0: o.x0 + 0.005, x1: o.x1 - 0.005, z0: o.z - 0.002, z1: o.z + 0.05, y0: y, y1: y + 0.008, color: p.wood })
  }
  // 책·소품
  for (let i = 0; i < tiers - 1; i++) {
    const y = (top / tiers) * (i + 1) + 0.008
    const bx = o.x0 + 0.015 + (i % 2) * 0.03
    box(ctx, r, { x0: bx, x1: bx + 0.05, z0: o.z + 0.01, z1: o.z + 0.04, y0: y, y1: y + 0.05, color: i % 2 ? p.accent : shade(p.upholstery, 1.1) })
  }
}

/** 벽에 거는 액자 — 뒷벽에만 붙입니다 */
export function wallArt(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  o: { cx: number; cy: number; w: number; h: number; fill: string; frame: string },
): void {
  // 뒷벽 사각형 안에서의 상대 좌표
  const px = (u: number, v: number) => ({
    x: r.tl.x + (r.tr.x - r.tl.x) * u,
    y: r.tl.y + (r.bl.y - r.tl.y) * v,
  })
  const c = [
    px(o.cx - o.w / 2, o.cy - o.h / 2),
    px(o.cx + o.w / 2, o.cy - o.h / 2),
    px(o.cx + o.w / 2, o.cy + o.h / 2),
    px(o.cx - o.w / 2, o.cy + o.h / 2),
  ]
  fillPoly(ctx, c, o.frame)
  const inset = 0.012
  const d = [
    px(o.cx - o.w / 2 + inset, o.cy - o.h / 2 + inset * 1.6),
    px(o.cx + o.w / 2 - inset, o.cy - o.h / 2 + inset * 1.6),
    px(o.cx + o.w / 2 - inset, o.cy + o.h / 2 - inset * 1.6),
    px(o.cx - o.w / 2 + inset, o.cy + o.h / 2 - inset * 1.6),
  ]
  fillPoly(ctx, d, o.fill)
}

export function plant(ctx: CanvasRenderingContext2D, r: RoomBox, o: { x: number; z: number; size?: number; pot: string }): void {
  const s = o.size ?? 1
  const base = r.ground(o.x, o.z)
  const k = r.scaleAt(o.z) * r.h
  // 화분
  box(ctx, r, { x0: o.x - 0.04 * s, x1: o.x + 0.04 * s, z0: o.z - 0.02, z1: o.z + 0.02, y1: 0.1 * s, color: o.pot })
  // 잎 — 타원 몇 개면 실루엣이 식물로 읽힙니다.
  const top = base.y - 0.1 * s * k
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4
    const rr = 0.1 * s * k * (0.7 + (i % 3) * 0.22)
    ctx.fillStyle = i % 2 ? '#3d6b46' : '#4f8355'
    ctx.beginPath()
    ctx.ellipse(base.x + Math.cos(a) * rr * 0.55, top - Math.abs(Math.sin(a)) * rr * 0.9, rr * 0.42, rr * 0.2, a, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function floorLamp(ctx: CanvasRenderingContext2D, r: RoomBox, o: { x: number; z: number; m: Materials; metal: string }): void {
  const base = r.ground(o.x, o.z)
  const k = r.scaleAt(o.z) * r.h
  ctx.strokeStyle = o.metal
  ctx.lineWidth = Math.max(2, k * 0.008)
  ctx.beginPath()
  ctx.moveTo(base.x, base.y)
  ctx.lineTo(base.x, base.y - 0.38 * k)
  ctx.stroke()
  ctx.fillStyle = o.metal
  ctx.beginPath()
  ctx.ellipse(base.x, base.y, 0.045 * k, 0.014 * k, 0, 0, Math.PI * 2)
  ctx.fill()
  // 갓
  const shadeTop = base.y - 0.4 * k
  fillPoly(ctx, [
    { x: base.x - 0.05 * k, y: shadeTop + 0.07 * k },
    { x: base.x + 0.05 * k, y: shadeTop + 0.07 * k },
    { x: base.x + 0.035 * k, y: shadeTop },
    { x: base.x - 0.035 * k, y: shadeTop },
  ], '#f4ead6')
  // 빛
  const g = ctx.createRadialGradient(base.x, shadeTop + 0.07 * k, 0, base.x, shadeTop + 0.07 * k, 0.34 * k)
  g.addColorStop(0, alpha(o.m.lightWarm, 0.5 * o.m.lightPower))
  g.addColorStop(1, alpha(o.m.lightWarm, 0))
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = g
  ctx.fillRect(base.x - 0.34 * k, shadeTop - 0.2 * k, 0.68 * k, 0.6 * k)
  ctx.globalCompositeOperation = 'source-over'
}

export function pendant(ctx: CanvasRenderingContext2D, r: RoomBox, o: { x: number; z: number; m: Materials; color: string }): void {
  const g0 = r.ground(o.x, o.z)
  const k = r.scaleAt(o.z) * r.h
  const y = g0.y - 0.78 * k
  ctx.strokeStyle = '#4a4a50'
  ctx.lineWidth = Math.max(1, k * 0.004)
  ctx.beginPath()
  ctx.moveTo(g0.x, g0.y - 1.0 * k)
  ctx.lineTo(g0.x, y)
  ctx.stroke()
  fillPoly(ctx, [
    { x: g0.x - 0.075 * k, y: y + 0.055 * k },
    { x: g0.x + 0.075 * k, y: y + 0.055 * k },
    { x: g0.x + 0.03 * k, y },
    { x: g0.x - 0.03 * k, y },
  ], o.color)
  const gl = ctx.createRadialGradient(g0.x, y + 0.06 * k, 0, g0.x, y + 0.06 * k, 0.42 * k)
  gl.addColorStop(0, alpha(o.m.lightWarm, 0.55 * o.m.lightPower))
  gl.addColorStop(1, alpha(o.m.lightWarm, 0))
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = gl
  ctx.fillRect(g0.x - 0.42 * k, y - 0.1 * k, 0.84 * k, 0.7 * k)
  ctx.globalCompositeOperation = 'source-over'
}

export { rug }
