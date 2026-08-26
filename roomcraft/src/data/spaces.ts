import type { Space } from '../types'

export const SPACES: Space[] = [
  { id: 'living', label: '거실', labelEn: 'Living Room', focus: ['Seating', 'Table', 'Lighting', 'Rug', 'Decor'] },
  { id: 'kitchen', label: '주방 & 다이닝', labelEn: 'Kitchen & Dining', focus: ['Table', 'Seating', 'Lighting', 'Appliance', 'Storage'] },
  { id: 'bedroom', label: '침실', labelEn: 'Bedroom', focus: ['Bed', 'Lighting', 'Storage', 'Rug', 'Decor'] },
  { id: 'bathroom', label: '욕실', labelEn: 'Bathroom', focus: ['Storage', 'Lighting', 'Decor'] },
  { id: 'office', label: '홈오피스', labelEn: 'Home Office', focus: ['Table', 'Seating', 'Storage', 'Lighting'] },
  { id: 'kids', label: '아이방', labelEn: 'Kids Room', focus: ['Bed', 'Storage', 'Rug', 'Decor'] },
  { id: 'balcony', label: '발코니 & 테라스', labelEn: 'Balcony & Terrace', focus: ['Seating', 'Table', 'Decor', 'Lighting'] },
  { id: 'commercial', label: '카페 & 상업공간', labelEn: 'Cafe & Retail', focus: ['Seating', 'Table', 'Lighting', 'Decor'] },
]

export const spaceById = (id: string): Space => SPACES.find((s) => s.id === id) ?? SPACES[0]
