import type { DesignStyle, Space } from '../types'

/** 변환 강도 슬라이더(10~100)를 실제 렌더 지시문으로 번역 */
export function intensityDirective(intensity: number): string {
  if (intensity <= 25) {
    return 'Preserve the original architecture, layout, flooring and built-ins exactly. Restyle soft furnishings, decor and lighting only (subtle refresh).'
  }
  if (intensity <= 50) {
    return 'Keep the room geometry, window positions and flooring. Replace furniture, rugs, lighting fixtures and wall finishes (balanced makeover).'
  }
  if (intensity <= 80) {
    return 'Keep only the room shell and window openings. Replace flooring, wall finishes, lighting, all furniture and built-in storage (strong remodel).'
  }
  return 'Full premium remodel from floor to ceiling: flooring, ceiling treatment, lighting design, all furniture, finishes and built-in storage. Keep the camera position and window openings so the before/after comparison stays readable.'
}

export function intensityLabel(intensity: number): string {
  if (intensity <= 25) return '은은한 조화'
  if (intensity <= 50) return '균형 잡힌 변화'
  if (intensity <= 80) return '강한 리모델링'
  return '완전한 공간 리모델링'
}

export interface PromptInput {
  style: DesignStyle
  space: Space
  intensity: number
  /** 사용자가 채팅/직접 입력으로 추가한 요청 */
  extras: string[]
}

/** 이미지 모델에 보낼 최종 프롬프트를 조립합니다. */
export function buildRenderPrompt({ style, space, intensity, extras }: PromptInput): string {
  const lines = [
    `Photorealistic interior redesign of this ${space.labelEn.toLowerCase()}.`,
    `Style: ${style.nameEn}. ${style.promptCore}.`,
    `Lighting: ${style.lighting}.`,
    `Signature pieces to include: ${style.signatureItems.join(', ')}.`,
    `Remodel scope (${intensity}%): ${intensityDirective(intensity)}`,
    'Camera: same viewpoint, focal length and perspective as the source photo.',
    'Output: magazine-quality architectural photography, realistic materials, correct shadows, no text, no watermark, no people.',
  ]
  if (extras.length) lines.push(`Additional client requests: ${extras.join('; ')}.`)
  return lines.join('\n')
}
