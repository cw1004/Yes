/**
 * RoomCraft AI — API 서버
 *
 * 라우터 조립만 담당합니다. 각 도메인 로직은 옆 파일에 있습니다.
 *   db.js        스키마/마이그레이션
 *   auth.js      계정·세션
 *   credits.js   크레딧 원장 (서버가 잔액의 유일한 권한)
 *   payments.js  Stripe Checkout + dev 시뮬레이터
 *   ai.js        렌더/챗 프록시 (크레딧 차감)
 *   sync.js      스튜디오 상태·템플릿 저장
 */
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { readFileSync } from 'node:fs'

// .env 로더 (의존성 없이 최소 구현)
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  // .env 가 없으면 실제 환경변수만 사용합니다.
}

const { schemaVersion } = await import('./db.js')
const { attachUser, authRouter } = await import('./auth.js')
const { paymentsRouter, stripeWebhook, paymentProvider } = await import('./payments.js')
const { aiRouter, aiReady, aiModels } = await import('./ai.js')
const { syncRouter } = await import('./sync.js')
const { linksRouter, redirectHandler } = await import('./links.js')
const { listLedger } = await import('./credits.js')
const { requireAuth } = await import('./auth.js')

const PORT = Number(process.env.PORT || 8787)
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const app = express()

// 쿠키 세션을 쓰므로 와일드카드 CORS 는 쓸 수 없습니다. 출처를 명시하고 credentials 를 허용합니다.
app.use(cors({ origin: APP_URL, credentials: true }))
app.use(cookieParser())

// Stripe 웹훅은 서명 검증을 위해 raw body 가 필요하므로 express.json 보다 먼저 마운트합니다.
app.post('/api/payments/webhook', ...stripeWebhook)

app.use(express.json({ limit: '25mb' }))
app.use(attachUser)

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    schemaVersion,
    renderReady: aiReady.render,
    chatReady: aiReady.chat,
    renderModel: aiModels.render,
    chatModel: aiModels.chat,
    paymentProvider,
    authenticated: Boolean(req.user),
  })
})

app.use('/api/auth', authRouter)
app.use('/api/payments', paymentsRouter)
app.use('/api/sync', syncRouter)
app.use('/api/links', linksRouter)

// 공개 리디렉트. 독자가 누르는 링크이므로 인증이 없고, 짧은 경로를 씁니다.
app.get('/r/:id', redirectHandler)
app.use('/api', aiRouter)

app.get('/api/credits/ledger', requireAuth, (req, res) => {
  res.json({ entries: listLedger(req.user.id) })
})

// 라우터에서 던진 예외를 JSON 으로 통일합니다.
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message ?? '서버 오류' })
})

app.listen(PORT, () => {
  console.log(`RoomCraft API: http://localhost:${PORT}`)
  console.log(`  DB 스키마    : v${schemaVersion}`)
  console.log(`  렌더(${aiModels.render}): ${aiReady.render ? '준비됨' : '키 없음 — 클라이언트가 목 모드'}`)
  console.log(`  챗(${aiModels.chat})   : ${aiReady.chat ? '준비됨' : '키 없음 — 클라이언트가 목 모드'}`)
  console.log(`  결제         : ${paymentProvider}${paymentProvider === 'dev' ? ' (시뮬레이터)' : ''}`)
})
