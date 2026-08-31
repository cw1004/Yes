import type { ChatMessage, DesignStyle, Space } from '../../types'

export interface RenderRequest {
  /** Before 사진 (data URL) */
  sourceImage: string
  prompt: string
  style: DesignStyle
  space: Space
  intensity: number
  /**
   * Before 가 앱이 생성한 샘플 방인지.
   * 샘플이면 목 프로바이더가 같은 기하로 After 를 다시 그릴 수 있어서
   * 실제로 달라진 방이 나옵니다. 사용자가 올린 사진은 그렇게 할 수 없습니다.
   */
  sourceIsSample?: boolean
}

export interface RenderResponse {
  imageUrl: string
  provider: 'mock' | 'server'
  matchScore: number
  notes: string[]
  /** 서버가 차감 후 알려준 잔액 (서버 렌더일 때만) */
  credits?: number
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
  credits?: number
}

/** 서버가 크레딧 부족으로 거절했을 때 */
export class OutOfCredits extends Error {
  balance: number
  constructor(message: string, balance: number) {
    super(message)
    this.balance = balance
  }
}
