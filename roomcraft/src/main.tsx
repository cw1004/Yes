import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * 수익 모델 점검 훅.
 * 채널 선택이 실제로 제품별로 갈리는지 브라우저에서 확인할 때 씁니다.
 * import.meta.env.DEV 로 감싸 프로덕션 번들에서는 통째로 제거됩니다.
 */
if (import.meta.env.DEV) {
  void import('./dev/revenueCheck').then(({ revenueCheck }) => {
    ;(window as unknown as Record<string, unknown>).__revenueCheck = revenueCheck
  })
  void import('./dev/roomPreview').then(({ renderRooms }) => {
    ;(window as unknown as Record<string, unknown>).__renderRooms = renderRooms
  })
  void import('./dev/materialCheck').then(({ materialCheck }) => {
    ;(window as unknown as Record<string, unknown>).__materialCheck = materialCheck
  })
}
