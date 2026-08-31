import type { DesignStyle, SpaceKind } from '../../types'
import { alpha, makeRoom, mix, shade } from './geometry'
import type { Materials } from './draw'
import { drawShell, window as drawWindow } from './draw'
import type { Palette } from './furniture'
import {
  bed, coffeeTable, diningSet, floorLamp, loungeChair, pendant, plant,
  rug, shelfUnit, sideboard, sofa, wallArt,
} from './furniture'

/**
 * 장면 조립.
 *
 * Before 는 "손대기 전의 평범한 방"이고, After 는 선택한 스타일이 실제로 적용된 방입니다.
 * 두 장면이 같은 기하 위에서 그려지므로 슬라이더로 비교했을 때 구조는 유지되고
 * 재질·가구·조명만 바뀝니다 — 리모델링 전후가 원래 그렇습니다.
 */

const W = 1280
const H = 860

/** 손대기 전 상태. 어느 스타일을 고르든 동일합니다. */
const BEFORE: Materials = {
  wall: '#d9d5cd',
  wallAccent: '#cbc6bd',
  floor: '#b4a189',
  floorKind: 'plank',
  trim: '#b8b3aa',
  lightWarm: '#fff4dd',
  lightPower: 0.55,
  accent: '#9a958c',
}

const BEFORE_PALETTE: Palette = {
  upholstery: '#8d8b86',
  wood: '#9c8b76',
  metal: '#8f8f95',
  accent: '#a8a49b',
}

/**
 * 스타일 팔레트에서 재질을 뽑습니다.
 *
 * palette 는 밝은 색에서 어두운 색 순으로 5개가 들어 있습니다. 벽은 가장 밝은 쪽,
 * 바닥과 목재는 중간, 강조색은 채도가 가장 높은 것을 고릅니다. 이렇게 해야
 * 스타일을 30개로 늘려도 각각이 화면에서 실제로 달라 보입니다.
 */
export function materialsFor(style: DesignStyle): { m: Materials; p: Palette } {
  const pal = style.palette.length >= 5
    ? style.palette
    : [...style.palette, '#cccccc', '#888888', '#444444', '#222222'].slice(0, 5)

  /*
   * palette[0] 은 그 스타일의 지배색입니다 (밝은 스타일은 밝은 색, 어두운 스타일은 어두운 색).
   * 처음에는 "가장 밝은 색"을 벽으로 골랐는데, 다크 아카데미아처럼 어두운 스타일도
   * 팔레트에 크림색이 하나 들어 있어서 벽이 하얘지고 성격이 통째로 사라졌습니다.
   * 작성해 둔 순서를 그대로 믿는 편이 낫습니다.
   */
  const dominant = pal[0]
  const secondary = pal[1]
  const mid = pal[2] ?? pal[1]
  /*
   * deep/light 는 인덱스가 아니라 명도로 뽑습니다.
   * 밝은 스타일의 팔레트는 밝은 색부터, 어두운 스타일은 어두운 색부터 나열돼 있어서
   * "마지막 = 가장 어두움"이 성립하지 않습니다. 그대로 두면 다크 아카데미아의
   * 금속·다리 색이 크림색이 되어 흰 막대처럼 보였습니다.
   */
  const byLum = [...pal].sort((a, b) => luminance(a) - luminance(b))
  const deep = byLum[0]
  const accent = [...pal].sort((a, b) => saturation(b) - saturation(a))[0]
  const dark = luminance(dominant) < 0.4

  // 바닥은 벽과 확실히 달라야 방이 납작해 보이지 않습니다.
  const floor = Math.abs(luminance(mid) - luminance(dominant)) > 0.12 ? mid : shade(dominant, dark ? 1.45 : 0.62)

  const warmFamilies: Record<string, string> = {
    minimal: '#fff2da',
    modern: '#fff6e8',
    luxury: '#ffe4b5',
    eclectic: '#ffdfa8',
    natural: '#ffeaba',
  }

  const m: Materials = {
    wall: dominant,
    wallAccent: secondary,
    floor,
    floorKind: floorKindFor(style),
    trim: dark ? shade(dominant, 1.7) : shade(dominant, 0.8),
    lightWarm: warmFamilies[style.family] ?? '#fff3e0',
    // 어두운 방일수록 조명이 눈에 띄어야 합니다. 안 그러면 그냥 어둡기만 합니다.
    lightPower: dark ? 1 : 0.7,
    accent,
  }

  /*
   * 목재는 팔레트에서 가장 '따뜻한'(적색이 청색보다 강한) 색을 고릅니다.
   * 처음에는 mid 가 바닥에 쓰이면 deep 으로 넘겼는데, 바닥이 거의 항상 mid 라
   * 목재가 매번 가장 어두운 색이 되어 사이드보드와 테이블 상판이 검게 나왔습니다.
   */
  const warmth = (c: string) => {
    const [r0, , b0] = rgb(c)
    return r0 - b0
  }
  const woodCandidates = pal.filter((c) => c !== floor && c !== dominant)
  const wood = woodCandidates.length
    ? [...woodCandidates].sort((a, b) => warmth(b) - warmth(a))[0]
    : shade(floor, dark ? 1.5 : 0.72)

  const p: Palette = {
    upholstery: dark ? secondary : mix(secondary, deep, 0.25),
    wood,
    metal: mix(deep, '#c9ccd1', style.family === 'luxury' ? 0.7 : 0.4),
    accent,
  }
  return { m, p }
}

function floorKindFor(style: DesignStyle): Materials['floorKind'] {
  if (style.id.includes('brutalist') || style.id.includes('industrial')) return 'concrete'
  if (style.id.includes('mediterranean') || style.id.includes('desert') || style.id.includes('memphis')) return 'tile'
  return 'plank'
}

function rgb(hex: string): number[] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const saturation = (hex: string): number => {
  const c = rgb(hex).map((v) => v / 255)
  return Math.max(...c) - Math.min(...c)
}

/** 공간별 가구 배치. Before/After 가 같은 배치를 쓰되 재질과 소품이 달라집니다. */
function layout(
  ctx: CanvasRenderingContext2D,
  r: ReturnType<typeof makeRoom>,
  space: SpaceKind,
  m: Materials,
  p: Palette,
  after: boolean,
): void {
  const woodDark = shade(p.wood, 0.6)

  if (space === 'kitchen') {
    diningSet(ctx, r, p, { x: -0.36, z: 0.3 })
    sideboard(ctx, r, p, { x0: 0.28, x1: 0.86, z: 0.82 })
    if (after) {
      pendant(ctx, r, { x: -0.15, z: 0.4, m, color: p.metal })
      plant(ctx, r, { x: 0.72, z: 0.55, pot: p.accent, size: 0.8 })
      wallArt(ctx, r, { cx: 0.3, cy: 0.36, w: 0.13, h: 0.18, fill: m.accent, frame: woodDark })
    }
    return
  }

  if (space === 'bedroom') {
    bed(ctx, r, p, { x: -0.34, z: 0.42 })
    sideboard(ctx, r, p, { x0: 0.34, x1: 0.6, z: 0.6 })
    if (after) {
      rug(ctx, r, { x0: -0.5, x1: 0.34, z0: 0.1, z1: 0.42, color: alpha(p.accent, 0.55), border: alpha(woodDark, 0.5) })
      plant(ctx, r, { x: 0.74, z: 0.5, pot: p.wood })
      wallArt(ctx, r, { cx: 0.34, cy: 0.3, w: 0.2, h: 0.24, fill: m.accent, frame: woodDark })
      floorLamp(ctx, r, { x: 0.68, z: 0.34, m, metal: p.metal })
    }
    return
  }

  if (space === 'office') {
    sideboard(ctx, r, p, { x0: -0.55, x1: 0.05, z: 0.62 })
    loungeChair(ctx, r, p, { x: -0.3, z: 0.34 })
    shelfUnit(ctx, r, p, { x0: 0.4, x1: 0.78, z: 0.8 })
    if (after) {
      plant(ctx, r, { x: 0.24, z: 0.4, pot: p.accent, size: 0.9 })
      wallArt(ctx, r, { cx: 0.28, cy: 0.32, w: 0.16, h: 0.2, fill: m.accent, frame: woodDark })
      floorLamp(ctx, r, { x: -0.7, z: 0.36, m, metal: p.metal })
    }
    return
  }

  // 거실 (기본)
  if (after) {
    rug(ctx, r, { x0: -0.68, x1: 0.52, z0: 0.06, z1: 0.5, color: alpha(shade(p.upholstery, 1.15), 0.62), border: alpha(woodDark, 0.45) })
  }
  sofa(ctx, r, p, { x0: -0.66, x1: -0.02, z: 0.44, low: true })
  coffeeTable(ctx, r, p, { x0: -0.48, x1: -0.16, z: 0.2 })
  loungeChair(ctx, r, p, { x: 0.2, z: 0.16 })
  sideboard(ctx, r, p, { x0: 0.34, x1: 0.84, z: 0.84 })
  if (after) {
    plant(ctx, r, { x: -0.82, z: 0.5, pot: p.accent })
    plant(ctx, r, { x: 0.62, z: 0.62, pot: p.wood, size: 0.75 })
    wallArt(ctx, r, { cx: 0.34, cy: 0.3, w: 0.22, h: 0.26, fill: m.accent, frame: woodDark })
    wallArt(ctx, r, { cx: 0.62, cy: 0.33, w: 0.12, h: 0.16, fill: shade(m.accent, 1.3), frame: woodDark })
    floorLamp(ctx, r, { x: 0.02, z: 0.52, m, metal: p.metal })
    pendant(ctx, r, { x: -0.32, z: 0.28, m, color: p.metal })
  }
}

/** 사진처럼 보이게 하는 마무리 — 비네팅과 미세한 노이즈 */
function finish(ctx: CanvasRenderingContext2D, w: number, h: number, warm: string, power: number): void {
  const vig = ctx.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.32, w / 2, h * 0.5, Math.max(w, h) * 0.78)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(18,16,14,0.42)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  // 전체 색온도
  ctx.globalCompositeOperation = 'soft-light'
  ctx.fillStyle = alpha(warm, 0.3 * power)
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'

  // 필름 그레인 — 완전히 매끈한 면은 CG 로 보입니다.
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 9
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

export interface SceneOptions {
  space: SpaceKind
  /** 없으면 Before(손대기 전) 장면 */
  style?: DesignStyle
  /** 스타일 적용 강도 0~100 — Before 재질과 섞는 비율 */
  intensity?: number
  label?: string
}

/** 방 한 장을 그려 data URL 로 돌려줍니다. */
export function renderScene(o: SceneOptions): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const r = makeRoom(W, H)
  const after = Boolean(o.style)

  let m = BEFORE
  let p = BEFORE_PALETTE
  if (o.style) {
    const derived = materialsFor(o.style)
    const t = Math.max(0, Math.min(1, (o.intensity ?? 100) / 100))
    // 강도 슬라이더가 실제로 보이게 — 낮으면 손대기 전 재질에 가깝습니다.
    m = {
      ...derived.m,
      wall: mix(BEFORE.wall, derived.m.wall, t),
      floor: mix(BEFORE.floor, derived.m.floor, t),
      trim: mix(BEFORE.trim, derived.m.trim, t),
      lightPower: BEFORE.lightPower + (derived.m.lightPower - BEFORE.lightPower) * t,
    }
    p = {
      upholstery: mix(BEFORE_PALETTE.upholstery, derived.p.upholstery, t),
      wood: mix(BEFORE_PALETTE.wood, derived.p.wood, t),
      metal: mix(BEFORE_PALETTE.metal, derived.p.metal, t),
      accent: mix(BEFORE_PALETTE.accent, derived.p.accent, t),
    }
  }

  drawShell(ctx, r, m)
  drawWindow(ctx, r, m)
  layout(ctx, r, o.space, m, p, after)
  finish(ctx, W, H, m.lightWarm, m.lightPower)

  if (o.label) {
    ctx.font = `600 ${Math.round(W * 0.015)}px system-ui, sans-serif`
    const tw = ctx.measureText(o.label).width
    ctx.fillStyle = 'rgba(12,12,14,0.66)'
    ctx.fillRect(18, H - 52, tw + 28, 32)
    ctx.fillStyle = '#f0ece4'
    ctx.fillText(o.label, 32, H - 31)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
