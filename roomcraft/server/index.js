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
const { LIMITS, globalLimiter, TRUST_PROXY_HOPS } = await import('./limits.js')
const { mailerReady } = await import('./mailer.js')
const { IS_PRODUCTION, mountStatic, preflight, securityHeaders } = await import('./production.js')
const { requireAuth } = await import('./auth.js')

const PORT = Number(process.env.PORT || 8787)
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const app = express()

/**
 * 프록시 뒤에 배포하면 req.ip 가 프록시 IP 가 되어 레이트 리밋이 전원을 한 덩어리로 묶습니다.
 * 반대로 무조건 신뢰하면 X-Forwarded-For 위조로 리밋을 우회할 수 있으므로,
 * 신뢰할 홉 수를 환경변수로 명시합니다 (직접 노출이면 0).
 */
app.set('trust proxy', TRUST_PROXY_HOPS)

// 배포 사고의 대부분은 코드가 아니라 설정에서 납니다. 뜨기 전에 확인합니다.
const checks = preflight({ paymentProvider, mailerReady, aiReady, trustProxyHops: TRUST_PROXY_HOPS })
for (const w of checks.warn) console.warn(`⚠  ${w}`)
if (checks.fatal.length) {
  console.error('\n기동을 중단합니다. 다음 설정을 먼저 해결하세요:\n')
  for (const f of checks.fatal) console.error(`  ✗ ${f}`)
  console.error('')
  process.exit(1)
}

app.use(securityHeaders)

/*
 * 프로덕션에서는 웹과 API 가 같은 오리진이라 CORS 자체가 필요 없습니다.
 * 개발에서만 Vite(5173) ↔ API(8787) 분리 구성을 위해 켭니다.
 * 쿠키 세션이라 와일드카드 출처는 쓸 수 없습니다.
 */
if (!IS_PRODUCTION) app.use(cors({ origin: APP_URL, credentials: true }))
app.use(cookieParser())

// Stripe 웹훅은 서명 검증을 위해 raw body 가 필요하므로 express.json 보다 먼저 마운트합니다.
app.post('/api/payments/webhook', ...stripeWebhook)

app.use(express.json({ limit: '25mb' }))
app.use(attachUser)

// 사용자 식별 후에 걸어야 로그인 사용자를 계정 단위로 셀 수 있습니다.
app.use('/api', globalLimiter)

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    schemaVersion,
    renderReady: aiReady.render,
    chatReady: aiReady.chat,
    renderModel: aiModels.render,
    chatModel: aiModels.chat,
    paymentProvider,
    mailerReady,
    limits: LIMITS,
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

// 빌드된 SPA 서빙. API·리디렉트 라우트 뒤에 두어야 폴백이 그것들을 삼키지 않습니다.
const staticInfo = mountStatic(app)

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
  console.log(`  메일         : ${mailerReady ? 'SMTP 설정됨' : '미설정 — 인증 링크를 콘솔에 출력합니다'}`)
  console.log(`  trust proxy  : ${TRUST_PROXY_HOPS} 홉`)
  console.log(`  정적 파일    : ${staticInfo.mounted ? staticInfo.dist : '없음 (npm run build 필요 · 개발은 Vite 사용)'}`)
  console.log(`  모드         : ${IS_PRODUCTION ? 'production' : 'development'}`)
})
