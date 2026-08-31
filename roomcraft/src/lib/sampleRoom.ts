import type { SpaceKind } from '../types'
import { renderScene } from './room/scene'

/**
 * 데모용 샘플 "Before" 사진.
 *
 * 예전에는 정면 사각형 몇 개를 겹쳐 그린 그림이었습니다. 방으로 보이지 않았고,
 * After 가 그 위에 색만 입힌 것이라 Before 와 거의 같아 보였습니다 —
 * 이 앱의 핵심인 "사진 한 장이 확 바뀐다"는 순간이 아예 일어나지 않았습니다.
 * 지금은 lib/room 의 1점 투시 렌더러가 실제 방을 그립니다.
 */
export function generateSampleRoom(space: SpaceKind): string {
  return renderScene({ space, label: '샘플 Before 이미지 (자동 생성)' })
}
