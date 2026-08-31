import type { Point, RoomBox } from './geometry'
import { alpha, fillPoly, lerp, shade } from './geometry'

/**
 * 방 껍데기와 가구 프리미티브.
 *
 * 모든 것을 지면 좌표 (x, z) 와 방 높이 비율로 지정하고 geometry 가 화면 좌표로 옮깁니다.
 * 덕분에 가구를 방 어디에 놓아도 원근이 저절로 맞습니다.
 */

export interface Materials {
  wall: string
  wallAccent: string
  floor: string
  /** 바닥 결 방향 — 널결(plank)인지 타일인지 */
  floorKind: 'plank' | 'tile' | 'concrete' | 'rug-only'
  trim: string
  /** 조명 색온도 — 따뜻할수록 노란빛 */
  lightWarm: string
  /** 조명 세기 0~1 */
  lightPower: number
  /** 주 강조색 (쿠션·아트·소품) */
  accent: string
}

/** 방 껍데기: 천장·벽·바닥·걸레받이 */
export function drawShell(ctx: CanvasRenderingContext2D, r: RoomBox, m: Materials): void {
  const { w, h, tl, tr, bl, br } = r

  // 천장은 벽보다 살짝 어둡게 — 위에서 빛이 오면 천장이 가장 덜 받습니다.
  fillPoly(ctx, [{ x: 0, y: 0 }, { x: w, y: 0 }, tr, tl], shade(m.wall, 0.9))

  // 뒷벽
  fillPoly(ctx, [tl, tr, br, bl], m.wall)

  // 좌우 벽 — 창이 오른쪽에 있으므로 왼쪽을 어둡게 해서 방향광을 만듭니다.
  fillPoly(ctx, [{ x: 0, y: 0 }, tl, bl, { x: 0, y: h }], shade(m.wall, 0.82))
  fillPoly(ctx, [{ x: w, y: 0 }, tr, br, { x: w, y: h }], shade(m.wall, 1.04))

  // 바닥
  fillPoly(ctx, [{ x: 0, y: h }, { x: w, y: h }, br, bl], m.floor)
  drawFloorPattern(ctx, r, m)

  // 걸레받이 — 벽과 바닥이 만나는 선이 없으면 방이 종이처럼 보입니다.
  ctx.strokeStyle = m.trim
  ctx.lineWidth = Math.max(2, h * 0.006)
  ctx.beginPath()
  ctx.moveTo(0, h)
  ctx.lineTo(bl.x, bl.y)
  ctx.lineTo(br.x, br.y)
  ctx.lineTo(w, h)
  ctx.stroke()

  // 천장 몰딩
  ctx.lineWidth = Math.max(1, h * 0.003)
  ctx.strokeStyle = alpha(m.trim, 0.5)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(tl.x, tl.y)
  ctx.lineTo(tr.x, tr.y)
  ctx.lineTo(w, 0)
  ctx.stroke()
}

function drawFloorPattern(ctx: CanvasRenderingContext2D, r: RoomBox, m: Materials): void {
  if (m.floorKind === 'rug-only') return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, r.h)
  ctx.lineTo(r.w, r.h)
  ctx.lineTo(r.br.x, r.br.y)
  ctx.lineTo(r.bl.x, r.bl.y)
  ctx.closePath()
  ctx.clip()

  if (m.floorKind === 'concrete') {
    // 콘크리트는 결이 없고 얼룩만 있습니다.
    for (let i = 0; i < 26; i++) {
      const z = Math.random()
      const p = r.ground(Math.random() * 2 - 1, z)
      const s = 60 * r.scaleAt(z)
      ctx.fillStyle = alpha(shade(m.floor, Math.random() > 0.5 ? 1.06 : 0.94), 0.25)
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, s, s * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return
  }

  // 널결/타일: 세로선은 소실점으로 모이고, 가로선은 깊이에 따라 촘촘해집니다.
  ctx.strokeStyle = alpha(shade(m.floor, 0.82), 0.55)
  ctx.lineWidth = Math.max(1, r.h * 0.0022)
  const cols = m.floorKind === 'tile' ? 10 : 14
  for (let i = 0; i <= cols; i++) {
    const x = -1 + (2 * i) / cols
    const a = r.ground(x, 0)
    const b = r.ground(x, 1)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  if (m.floorKind === 'tile') {
    for (let i = 1; i < 9; i++) {
      const z = i / 9
      const a = r.ground(-1, z)
      const b = r.ground(1, z)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  } else {
    // 널결은 이음매가 어긋나 있어야 마루처럼 보입니다.
    // 이음매를 촘촘히 넣으면 타일 격자로 보이므로 성기게, 그리고 흐리게 긋습니다.
    ctx.strokeStyle = alpha(shade(m.floor, 0.86), 0.3)
    for (let i = 1; i < 6; i++) {
      const z = Math.pow(i / 6, 1.6)
      for (let c = 0; c < cols; c += 2) {
        const x0 = -1 + (2 * ((c + (i % 2)) % cols)) / cols
        const x1 = x0 + 2 / cols
        const a = r.ground(x0, z)
        const b = r.ground(Math.min(1, x1), z)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/**
 * 지면 위의 직육면체.
 *
 * 앞면·윗면·옆면을 각각 다른 밝기로 칠해야 입체로 보입니다. 카메라가 방 중앙을
 * 보고 있으므로 물체가 소실점 왼쪽에 있으면 오른쪽 옆면이, 오른쪽에 있으면
 * 왼쪽 옆면이 보입니다.
 */
export function box(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  o: { x0: number; x1: number; z0: number; z1: number; y0?: number; y1: number; color: string },
): void {
  const y0 = o.y0 ?? 0
  const g = (x: number, z: number) => r.ground(x, z)
  const u = (p: Point, z: number, hh: number) => r.up(p, z, hh)

  const fbl = u(g(o.x0, o.z0), o.z0, y0)
  const fbr = u(g(o.x1, o.z0), o.z0, y0)
  const ftl = u(g(o.x0, o.z0), o.z0, o.y1)
  const ftr = u(g(o.x1, o.z0), o.z0, o.y1)
  const bbl = u(g(o.x0, o.z1), o.z1, y0)
  const bbr = u(g(o.x1, o.z1), o.z1, y0)
  const btl = u(g(o.x0, o.z1), o.z1, o.y1)
  const btr = u(g(o.x1, o.z1), o.z1, o.y1)

  // 접지 그림자 — 이게 없으면 가구가 공중에 뜬 것처럼 보입니다.
  if (y0 === 0) {
    const sh = ctx.createLinearGradient(fbl.x, fbl.y, fbl.x, fbl.y + (fbr.x - fbl.x) * 0.18)
    sh.addColorStop(0, 'rgba(0,0,0,0.34)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    fillPoly(ctx, [
      { x: fbl.x - 6, y: fbl.y },
      { x: fbr.x + 6, y: fbr.y },
      { x: fbr.x + 18, y: fbr.y + (fbr.x - fbl.x) * 0.14 },
      { x: fbl.x - 18, y: fbl.y + (fbr.x - fbl.x) * 0.14 },
    ], sh)
  }

  // 옆면 (소실점 반대쪽)
  const mid = (o.x0 + o.x1) / 2
  if (mid < 0) fillPoly(ctx, [fbr, bbr, btr, ftr], shade(o.color, 0.78))
  else fillPoly(ctx, [fbl, bbl, btl, ftl], shade(o.color, 0.78))

  // 윗면 — 빛을 가장 많이 받습니다
  fillPoly(ctx, [ftl, ftr, btr, btl], shade(o.color, 1.14))
  // 앞면
  fillPoly(ctx, [fbl, fbr, ftr, ftl], o.color)
}

/** 바닥에 깔리는 러그 — 원근 사각형 */
export function rug(
  ctx: CanvasRenderingContext2D,
  r: RoomBox,
  o: { x0: number; x1: number; z0: number; z1: number; color: string; border?: string },
): void {
  const pts = [
    r.ground(o.x0, o.z0),
    r.ground(o.x1, o.z0),
    r.ground(o.x1, o.z1),
    r.ground(o.x0, o.z1),
  ]
  fillPoly(ctx, pts, o.color)
  if (o.border) {
    ctx.strokeStyle = o.border
    ctx.lineWidth = Math.max(2, r.h * 0.005)
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.stroke()
  }
}

/** 오른쪽 벽의 창 + 바닥에 떨어지는 빛 웅덩이 */
export function window(ctx: CanvasRenderingContext2D, r: RoomBox, m: Materials): void {
  const { w, h, tr, br } = r
  // 오른쪽 벽면 위에서 창의 네 모서리를 잡습니다 (벽 사다리꼴 내부 보간).
  const p = (tx: number, ty: number): Point => {
    const top = { x: lerp(w, tr.x, tx), y: lerp(0, tr.y, tx) }
    const bot = { x: lerp(w, br.x, tx), y: lerp(h, br.y, tx) }
    return { x: lerp(top.x, bot.x, ty), y: lerp(top.y, bot.y, ty) }
  }
  const c = [p(0.12, 0.16), p(0.72, 0.16), p(0.72, 0.78), p(0.12, 0.78)]

  const sky = ctx.createLinearGradient(c[0].x, c[0].y, c[2].x, c[2].y)
  sky.addColorStop(0, '#eef4f8')
  sky.addColorStop(1, '#cfdde4')
  fillPoly(ctx, c, sky)

  // 창틀
  ctx.strokeStyle = shade(m.trim, 1.1)
  ctx.lineWidth = Math.max(3, h * 0.008)
  ctx.beginPath()
  ctx.moveTo(c[0].x, c[0].y)
  for (const q of c.slice(1)) ctx.lineTo(q.x, q.y)
  ctx.closePath()
  ctx.stroke()
  // 중간 세로 창살
  const midTop = p(0.42, 0.16)
  const midBot = p(0.42, 0.78)
  ctx.lineWidth = Math.max(2, h * 0.004)
  ctx.beginPath()
  ctx.moveTo(midTop.x, midTop.y)
  ctx.lineTo(midBot.x, midBot.y)
  ctx.stroke()

  // 창에서 들어와 바닥에 떨어지는 빛 — 방향을 만들어 주는 가장 큰 요소입니다.
  // 창에서 바닥으로 떨어지는 빛. 방향을 만드는 가장 큰 요소라 약하면 방이 평평해 보입니다.
  const pool = [r.ground(1, 0.1), r.ground(1, 0.78), r.ground(-0.35, 0.62), r.ground(-0.1, 0.06)]
  const grad = ctx.createLinearGradient(w * 0.98, h * 0.55, w * 0.15, h * 0.98)
  grad.addColorStop(0, alpha(m.lightWarm, 0.75 * m.lightPower))
  grad.addColorStop(0.55, alpha(m.lightWarm, 0.3 * m.lightPower))
  grad.addColorStop(1, alpha(m.lightWarm, 0))
  ctx.globalCompositeOperation = 'screen'
  fillPoly(ctx, pool, grad)
  ctx.globalCompositeOperation = 'source-over'
}
