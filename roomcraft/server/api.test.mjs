/**
 * API 통합 테스트.
 *
 *   npm run server        # 터미널 1
 *   npm run test:api      # 터미널 2
 *
 * 다른 포트/DB 를 쓴다면 API_BASE 와 DATABASE_PATH 를 맞춰서 넘기세요.
 * (원장 단위 검증이 같은 DB 파일을 직접 열기 때문에 둘이 일치해야 합니다.)
 *
 * 결제/크레딧처럼 "되면 안 되는 것"(이중 지급, 타인 결제 완료, 잔액 초과 차감)을
 * 중심으로 검증합니다.
 */
const BASE = process.env.API_BASE || 'http://localhost:8787/api'
let cookie = ''
let pass = 0, fail = 0

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...opts.headers },
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, body }
}

const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.log(`✗ ${label} ${detail}`) }
}

const email = `t${Date.now()}@example.com`

// 인증
let r = await call('/auth/me')
check('비로그인 me → null', r.body?.user === null)

r = await call('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'short' }) })
check('짧은 비밀번호 거부', r.status === 400, JSON.stringify(r.body))

r = await call('/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'bad', password: 'longenough1' }) })
check('잘못된 이메일 거부', r.status === 400)

r = await call('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) })
check('회원가입 성공', r.status === 201, JSON.stringify(r.body))
check('가입 즉시 Free 크레딧 20 지급', r.body?.user?.credits === 20, `credits=${r.body?.user?.credits}`)

r = await call('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) })
check('중복 이메일 거부', r.status === 409)

r = await call('/auth/me')
check('세션 쿠키로 me 조회', r.body?.user?.email === email)

// 크레딧 권한
r = await call('/render', { method: 'POST', body: JSON.stringify({ image: 'x', prompt: 'y' }) })
check('키 없이 렌더 → 503 (차감 전 거절)', r.status === 503, JSON.stringify(r.body))

r = await call('/auth/me')
check('실패한 렌더는 크레딧 미차감', r.body?.user?.credits === 20, `credits=${r.body?.user?.credits}`)

// 결제
r = await call('/payments/config')
check('결제 프로바이더 = dev', r.body?.provider === 'dev')

r = await call('/payments/checkout', { method: 'POST', body: JSON.stringify({ kind: 'plan', itemId: 'free' }) })
check('무료 플랜 결제 거부', r.status === 400)

r = await call('/payments/checkout', { method: 'POST', body: JSON.stringify({ kind: 'pack', itemId: 'nope' }) })
check('알 수 없는 상품 거부', r.status === 400)

r = await call('/payments/checkout', { method: 'POST', body: JSON.stringify({ kind: 'pack', itemId: 'pack-300' }) })
const paymentId = r.body?.paymentId
check('크레딧 팩 체크아웃 생성', r.status === 200 && Boolean(paymentId), JSON.stringify(r.body))

r = await call('/payments/dev/complete', { method: 'POST', body: JSON.stringify({ paymentId }) })
check('결제 완료 → 330 크레딧 지급 (300+30)', r.body?.credits === 350, `credits=${r.body?.credits}`)

r = await call('/payments/dev/complete', { method: 'POST', body: JSON.stringify({ paymentId }) })
check('같은 결제 재처리 → 이중 지급 없음', r.body?.alreadyFulfilled === true && r.body?.credits === 350, `credits=${r.body?.credits}`)

r = await call('/payments/checkout', { method: 'POST', body: JSON.stringify({ kind: 'plan', itemId: 'pro' }) })
r = await call('/payments/dev/complete', { method: 'POST', body: JSON.stringify({ paymentId: r.body.paymentId }) })
check('Pro 플랜 결제 → 플랜 변경 + 600 크레딧', r.body?.planId === 'pro' && r.body?.credits === 950, JSON.stringify(r.body))

// 남의 결제 건드리기
const otherCookie = cookie
cookie = ''
await call('/auth/signup', { method: 'POST', body: JSON.stringify({ email: `o${Date.now()}@example.com`, password: 'password123' }) })
r = await call('/payments/dev/complete', { method: 'POST', body: JSON.stringify({ paymentId }) })
check('타인의 결제 완료 시도 → 403', r.status === 403, JSON.stringify(r.body))
cookie = otherCookie

// 동기화
r = await call('/sync/state', { method: 'PUT', body: JSON.stringify({ state: { moodboard: [{ sku: 'flos-arco', qty: 2 }] } }) })
check('상태 저장', r.body?.ok === true)
r = await call('/sync/state')
check('상태 복원', r.body?.state?.moodboard?.[0]?.sku === 'flos-arco')

r = await call('/sync/templates', { method: 'POST', body: JSON.stringify({ title: '테스트 프리셋', styleId: 'japandi-serenity', spaceId: 'living', priceUsd: 29 }) })
const tplId = r.body?.template?.id
check('템플릿 등록', r.status === 201 && r.body?.template?.priceUsd === 29, JSON.stringify(r.body))

r = await call('/sync/templates')
check('템플릿 목록 조회', r.body?.templates?.length === 1)

r = await call('/sync/templates', { method: 'POST', body: JSON.stringify({ title: 'x', priceUsd: 99999 }) })
check('비정상 판매가 거부', r.status === 400)

r = await call(`/sync/templates/${tplId}`, { method: 'DELETE' })
check('템플릿 삭제', r.body?.ok === true)

// ── 제휴 링크 클릭 추적 ───────────────────────────────────────────────
r = await call('/links', { method: 'POST', body: JSON.stringify({
  source: 'blog',
  items: [
    { sku: 'flos-arco', mallId: 'coupang', url: 'https://www.coupang.com/np/search?q=arco&subId=T1', label: 'Flos Arco' },
    { sku: 'hm-eames-lounge', mallId: 'amazon', url: 'https://www.amazon.com/s?k=eames&tag=t-20', label: 'Eames' },
  ],
}) })
// 서버는 완성된 추적 URL 을 돌려줍니다 (클라이언트가 주소를 조립하지 않도록).
const linkUrl = r.body?.links?.['flos-arco:coupang']
check('링크 발급', r.status === 200 && /\/r\/[A-Za-z0-9_-]+$/.test(linkUrl ?? ''), JSON.stringify(r.body))

r = await call('/links', { method: 'POST', body: JSON.stringify({
  source: 'blog',
  items: [{ sku: 'flos-arco', mallId: 'coupang', url: 'https://www.coupang.com/np/search?q=arco&subId=T2', label: 'Flos Arco' }],
}) })
check('같은 조합 재발급 시 토큰 재사용', Boolean(linkUrl) && r.body?.links?.['flos-arco:coupang'] === linkUrl,
  `${linkUrl} vs ${r.body?.links?.['flos-arco:coupang']}`)

r = await call('/links', { method: 'POST', body: JSON.stringify({
  source: 'blog',
  items: [{ sku: 'x', mallId: 'coupang', url: 'https://evil.example.com/phish' }],
}) })
check('허용되지 않은 호스트 거부 (오픈 리디렉터 방지)',
  r.body?.rejected?.length === 1 && !Object.keys(r.body?.links ?? {}).length, JSON.stringify(r.body))

r = await call('/links', { method: 'POST', body: JSON.stringify({
  source: 'blog',
  items: [{ sku: 'x', mallId: 'coupang', url: 'http://www.coupang.com/np/search?q=a' }],
}) })
check('http 대상 거부', r.body?.rejected?.length === 1)

// 리디렉트는 /api 밖 경로이고, 발급된 URL 을 그대로 호출합니다.
const ORIGIN = BASE.replace(/\/api$/, '')
const token = linkUrl.split('/r/')[1]
let redirect = await fetch(`${ORIGIN}/r/${token}`, { redirect: 'manual', headers: { referer: 'https://blog.example.com/post' } })
check('리디렉트 302', redirect.status === 302, String(redirect.status))
check('리디렉트 대상이 최신 URL (제휴 ID 갱신 반영)',
  redirect.headers.get('location')?.includes('subId=T2'), redirect.headers.get('location'))

await fetch(`${ORIGIN}/r/${token}`, { redirect: 'manual' })
r = await call('/links/stats')
const stat = r.body?.links?.find((l) => l.id === token)
check('클릭 2회 집계', stat?.clicks === 2, JSON.stringify(stat))
check('채널별 집계', r.body?.byMall?.coupang === 2, JSON.stringify(r.body?.byMall))

redirect = await fetch(`${ORIGIN}/r/does-not-exist`, { redirect: 'manual' })
check('없는 링크 404', redirect.status === 404)

// ── 구독 갱신 ─────────────────────────────────────────────────────────
r = await call('/auth/me')
const beforeRenew = r.body.user.credits
r = await call('/payments/dev/renew', { method: 'POST', body: JSON.stringify({ cycle: '2026-09' }) })
check('구독 갱신 시 월 크레딧 지급', r.body?.credits === beforeRenew + 600, `${beforeRenew} → ${r.body?.credits}`)

r = await call('/payments/dev/renew', { method: 'POST', body: JSON.stringify({ cycle: '2026-09' }) })
check('같은 청구 주기 재지급 차단', r.body?.granted === false && r.body?.credits === beforeRenew + 600,
  JSON.stringify(r.body))

r = await call('/payments/dev/renew', { method: 'POST', body: JSON.stringify({ cycle: '2026-10' }) })
check('다음 주기에는 다시 지급', r.body?.credits === beforeRenew + 1200, JSON.stringify(r.body))

r = await call('/payments/dev/cancel', { method: 'POST' })
check('구독 해지 시 Free 로 강등', r.body?.planId === 'free')
check('해지해도 기존 크레딧은 유지', r.body?.credits === beforeRenew + 1200, JSON.stringify(r.body))

r = await call('/payments/dev/renew', { method: 'POST' })
check('해지 후 갱신 시도 거부', r.status === 400)

// 로그아웃
r = await call('/auth/logout', { method: 'POST' })
cookie = ''
r = await call('/sync/state')
check('로그아웃 후 보호 라우트 → 401', r.status === 401)

r = await call('/payments/history')
check('비로그인 결제내역 → 401', r.status === 401)

// ── 크레딧 원장 단위 검증 ─────────────────────────────────────────────
// 잔액을 컬럼이 아니라 원장 합계로 두는 이유가 여기 있습니다.
const { InsufficientCredits, addLedger, getBalance, spendCredits } = await import('./credits.js')
const { db } = await import('./db.js')

const uid = db.prepare('SELECT id FROM users ORDER BY created_at DESC LIMIT 1').get().id
const start = getBalance(uid)
// ref 는 (reason, ref) 유니크 인덱스에 걸리므로 실행마다 새로 만듭니다.
const runRef = `unit-${Date.now()}`

addLedger(uid, 100, 'test:grant', runRef)
check('원장 적립', getBalance(uid) === start + 100)

addLedger(uid, 100, 'test:grant', runRef)
check('같은 ref 재적립 차단', getBalance(uid) === start + 100)

spendCredits(uid, 40, 'test:spend')
check('차감 반영', getBalance(uid) === start + 60)

let threw = null
try {
  spendCredits(uid, start + 10_000, 'test:overspend')
} catch (err) {
  threw = err
}
check('잔액 초과 차감 거부', threw instanceof InsufficientCredits, String(threw))
check('거부된 차감은 잔액 불변', getBalance(uid) === start + 60)

console.log(`\n통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
