import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    /*
     * 기본 빌드는 코드 분할을 씁니다 — 3D(three.js) 는 대부분의 방문자가 열지 않으므로
     * 첫 로딩에 태우지 않습니다.
     *
     * demo 모드는 단일 HTML 파일로 묶기 위한 빌드입니다. 파일 하나 안에서는 동적
     * import 가 가리킬 경로가 없으므로 전부 인라인해 한 덩어리로 만듭니다.
     */
    rollupOptions: mode === 'demo' ? { output: { inlineDynamicImports: true } } : {},
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      // 개발 중에는 AI 요청을 로컬 프록시 서버(server/index.js)로 보냅니다.
      // 서버가 꺼져 있으면 클라이언트가 자동으로 목(mock) 프로바이더로 폴백합니다.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      // 추적 리디렉트. 운영에서도 웹 도메인이 /r 을 API 로 넘기도록 구성합니다.
      '/r': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
}))
