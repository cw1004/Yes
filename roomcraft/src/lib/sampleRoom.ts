import type { SpaceKind } from '../types'

/**
 * 데모용 샘플 "Before" 사진 생성기.
 * 네트워크 없이도 Before/After 비교 흐름을 확인할 수 있도록,
 * 밋밋한 기본 상태의 공간을 캔버스에 그려 data URL 로 돌려줍니다.
 */
export function generateSampleRoom(space: SpaceKind): string {
  const w = 1280
  const h = 860
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const wall = '#dfdbd4'
  const wallShade = '#cbc6bd'
  const floor = '#b49b7d'
  const floorDark = '#9c8365'

  // 벽 + 바닥
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = wallShade
  ctx.fillRect(0, 0, w * 0.18, h)
  ctx.fillStyle = floor
  ctx.fillRect(0, h * 0.68, w, h * 0.32)
  ctx.strokeStyle = floorDark
  ctx.lineWidth = 2
  for (let i = 0; i < 14; i++) {
    const y = h * 0.68 + (i * h * 0.32) / 14
    ctx.globalAlpha = 0.25
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // 창문 (자연광)
  const winX = w * 0.62
  const winY = h * 0.14
  const winW = w * 0.28
  const winH = h * 0.42
  ctx.fillStyle = '#eef3f5'
  ctx.fillRect(winX, winY, winW, winH)
  ctx.strokeStyle = '#8f8b84'
  ctx.lineWidth = 6
  ctx.strokeRect(winX, winY, winW, winH)
  ctx.beginPath()
  ctx.moveTo(winX + winW / 2, winY)
  ctx.lineTo(winX + winW / 2, winY + winH)
  ctx.stroke()
  const light = ctx.createLinearGradient(winX, winY, winX - w * 0.35, h)
  light.addColorStop(0, 'rgba(255,255,240,0.55)')
  light.addColorStop(1, 'rgba(255,255,240,0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, w, h)

  const box = (x: number, y: number, bw: number, bh: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, bw, bh)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.fillRect(x, y + bh - 8, bw, 8)
  }

  switch (space) {
    case 'kitchen':
      box(w * 0.06, h * 0.5, w * 0.42, h * 0.2, '#c9c4bb') // 하부장
      box(w * 0.06, h * 0.46, w * 0.42, h * 0.05, '#8d8880') // 상판
      box(w * 0.08, h * 0.14, w * 0.24, h * 0.16, '#d3cec5') // 상부장
      box(w * 0.2, h * 0.7, w * 0.3, h * 0.16, '#a8927a') // 식탁
      break
    case 'bedroom':
      box(w * 0.1, h * 0.55, w * 0.4, h * 0.22, '#cfcabf') // 침대
      box(w * 0.09, h * 0.42, w * 0.42, h * 0.14, '#bdb7ac') // 헤드보드
      box(w * 0.54, h * 0.6, w * 0.09, h * 0.14, '#b3ac9f') // 협탁
      break
    case 'office':
      box(w * 0.12, h * 0.55, w * 0.38, h * 0.06, '#b9b2a6') // 책상 상판
      box(w * 0.14, h * 0.61, w * 0.03, h * 0.14, '#8f8880')
      box(w * 0.45, h * 0.61, w * 0.03, h * 0.14, '#8f8880')
      box(w * 0.24, h * 0.6, w * 0.12, h * 0.18, '#9c958a') // 의자
      break
    default:
      box(w * 0.08, h * 0.52, w * 0.34, h * 0.2, '#2f3238') // 낡은 소파
      box(w * 0.46, h * 0.56, w * 0.16, h * 0.16, '#d7d2c8') // 서랍장
      box(w * 0.2, h * 0.74, w * 0.18, h * 0.05, '#a08a6e') // 테이블
  }

  // 빈 벽 (After 에서 아트월/조명이 들어갈 자리)
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  ctx.fillRect(w * 0.2, h * 0.12, w * 0.2, h * 0.22)

  ctx.fillStyle = 'rgba(20,20,24,0.62)'
  ctx.fillRect(16, h - 46, 232, 30)
  ctx.fillStyle = '#d8d8dd'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText('샘플 Before 이미지 (자동 생성)', 26, h - 26)

  return canvas.toDataURL('image/jpeg', 0.92)
}
