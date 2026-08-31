import type { Space } from '../types'

/**
 * 공간 정의.
 *
 * areaSqm 은 자재 견적의 기준입니다. 자재는 개수가 아니라 면적으로 사기 때문에
 * (마루 한 장이 아니라 "34m² 분량"), 이 값이 없으면 무드보드에 자재를 담았을 때
 * 수량 1이 되어 견적이 실제의 수십 분의 1로 나옵니다.
 *
 * focus 에 자재 카테고리를 함께 넣습니다 — 욕실은 가구보다 타일과 수전이 먼저입니다.
 */
export const SPACES: Space[] = [
  {
    id: 'living', label: '거실', labelEn: 'Living Room', areaSqm: 34,
    focus: ['Seating', 'Table', 'Lighting', 'Rug', 'Decor', 'Flooring', 'Wall'],
  },
  {
    id: 'kitchen', label: '주방 & 다이닝', labelEn: 'Kitchen & Dining', areaSqm: 18,
    focus: ['Table', 'Seating', 'Lighting', 'Appliance', 'Storage', 'Countertop', 'Tile', 'Plumbing'],
  },
  {
    id: 'bedroom', label: '침실', labelEn: 'Bedroom', areaSqm: 16,
    focus: ['Bed', 'Lighting', 'Storage', 'Rug', 'Decor', 'Flooring', 'Wall'],
  },
  {
    id: 'bathroom', label: '욕실', labelEn: 'Bathroom', areaSqm: 6,
    focus: ['Tile', 'Plumbing', 'Lighting', 'Storage', 'Hardware'],
  },
  {
    id: 'office', label: '홈오피스', labelEn: 'Home Office', areaSqm: 12,
    focus: ['Table', 'Seating', 'Storage', 'Lighting', 'Wall', 'Flooring'],
  },
  {
    id: 'kids', label: '아이방', labelEn: 'Kids Room', areaSqm: 11,
    focus: ['Bed', 'Storage', 'Rug', 'Decor', 'Wall', 'Flooring'],
  },
  {
    id: 'balcony', label: '발코니 & 테라스', labelEn: 'Balcony & Terrace', areaSqm: 8,
    focus: ['Seating', 'Table', 'Decor', 'Lighting', 'Tile'],
  },
  {
    id: 'commercial', label: '카페 & 상업공간', labelEn: 'Cafe & Retail', areaSqm: 60,
    focus: ['Seating', 'Table', 'Lighting', 'Decor', 'Flooring', 'Countertop', 'Wall'],
  },
]

export const spaceById = (id: string): Space => SPACES.find((s) => s.id === id) ?? SPACES[0]

/**
 * 자재를 담을 때의 기본 수량.
 *
 * 면적 자재는 방 면적 + 재단 손실 10%, 몰딩 같은 연장 자재는 둘레(정사각 가정),
 * 페인트·벽지처럼 "한 통이 N m² 를 덮는" 자재는 필요 통수로 올림합니다.
 */
export function defaultQtyFor(
  product: { unit?: string; coversSqm?: number; category: string },
  space: Space,
): number {
  const area = space.areaSqm
  switch (product.unit) {
    case 'm2': {
      // 벽 자재는 바닥이 아니라 벽 면적을 씁니다 (둘레 × 천장고 2.4m).
      const target = product.category === 'Wall' || product.category === 'Tile' ? perimeter(area) * 2.4 : area
      return Math.ceil(target * 1.1)
    }
    case 'lm':
      return Math.ceil(perimeter(area))
    case 'roll':
    case 'can':
      return product.coversSqm ? Math.max(1, Math.ceil((perimeter(area) * 2.4) / product.coversSqm)) : 1
    default:
      return 1
  }
}

/** 정사각형으로 가정한 방 둘레(m). 실측 도면이 없을 때의 근사입니다. */
const perimeter = (areaSqm: number): number => 4 * Math.sqrt(areaSqm)
