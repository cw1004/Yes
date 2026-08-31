/**
 * 방 렌더러 눈 확인용 — window.__renderRooms() 로 여러 스타일을 한 번에 뽑습니다.
 * UI 를 거치지 않고 렌더러만 검증하기 위한 개발 훅입니다.
 */
import { STYLES } from '../data/styles'
import { renderScene } from '../lib/room/scene'
import type { SpaceKind } from '../types'

export function renderRooms(styleIds: string[], space: SpaceKind = 'living') {
  const out: { id: string; name: string; dataUrl: string }[] = [
    { id: 'before', name: 'Before (손대기 전)', dataUrl: renderScene({ space, label: 'Before' }) },
  ]
  for (const id of styleIds) {
    const style = STYLES.find((s) => s.id === id)
    if (!style) continue
    out.push({ id, name: style.nameEn, dataUrl: renderScene({ space, style, intensity: 100, label: style.nameEn }) })
  }
  return out
}
