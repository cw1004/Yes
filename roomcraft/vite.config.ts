import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 개발 중에는 AI 요청을 로컬 프록시 서버(server/index.js)로 보냅니다.
      // 서버가 꺼져 있으면 클라이언트가 자동으로 목(mock) 프로바이더로 폴백합니다.
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
})
