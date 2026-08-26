import type { ChatMessage, DesignStyle, Space } from '../../types'

export interface RenderRequest {
  /** Before 사진 (data URL) */
  sourceImage: string
  prompt: string
  style: DesignStyle
  space: Space
  intensity: number
}

export interface RenderResponse {
  imageUrl: string
  provider: 'mock' | 'server'
  matchScore: number
  notes: string[]
}

export interface ChatRequest {
  history: ChatMessage[]
  message: string
  style: DesignStyle
  space: Space
  /** 현재 무드보드에 담긴 상품명 (컨텍스트) */
  moodboard: string[]
}

export interface ChatResponse {
  content: string
  recommendations: string[]
  provider: 'mock' | 'server'
  /** 렌더를 다시 돌려야 하는 요청이면 true */
  requestsRerender: boolean
}
