/**
 * API 통합 테스트.
 *
 *   npm run server        # 터미널 1
 *   npm run test:api      # 터미널 2
 *
 * 다른 포트/DB 를 쓴다면 API_BASE 와 DATABASE_PATH 를 맞춰서 넘기세요.
 * (원장 단위 검증이 같은 DB 파일을 직접 열기 때문에 둘이 일치해야 합니다.)
 *
 * 주의: 레이트 리밋 저장소는 메모리라 창이 닫히기 전에는 초기화되지 않습니다.
 * 연속 실행하려면 서버를 재시작하세요.
 *
 * 가입 상한 검증은 기본 상한(5/시간)으로 띄운 서버에서만 실행됩니다.
 * 상한을 올려 띄운 서버(브라우저 E2E 용)에서는 예산을 소진하지 않도록 건너뜁니다.
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
check('가입 시점에는 크레딧 미지급 (남용 방지)', r.body?.user?.credits === 0, `credits=${r.body?.user?.credits}`)
check('가입 응답에 인증 미완료 표시', r.body?.user?.emailVerified === false, JSON.stringify(r.body?.user))
const verifyUrl = r.body?.devVerifyUrl
check('메일 미설정 환경에서 인증 링크 노출', Boolean(verifyUrl), JSON.stringify(r.body))

// ── 이메일 인증 ───────────────────────────────────────────────────────
const verifyToken = verifyUrl?.split('verify=')[1]

r = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ token: 'bogus' }) })
check('잘못된 인증 토큰 거부', r.status === 400 && r.body?.code === 'invalid')

r = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ token: verifyToken }) })
check('인증 완료 → Free 크레딧 20 지급', r.body?.user?.credits === 20 && r.body?.user?.emailVerified === true,
  JSON.stringify(r.body?.user))

r = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ token: verifyToken }) })
check('같은 토큰 재사용 거부', r.status === 400 && r.body?.code === 'used', JSON.stringify(r.body))

r = await call('/auth/me')
check('재인증 시도해도 크레딧 중복 지급 없음', r.body?.user?.credits === 20, `credits=${r.body?.user?.credits}`)

r = await call('/auth/resend-verification', { method: 'POST' })
check('이미 인증된 계정은 재발송 거부', r.status === 400, JSON.stringify(r.body))

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

// ── 비밀번호 재설정 ───────────────────────────────────────────────────
r = await call('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }) })
check('존재하지 않는 계정도 동일 응답 (계정 열거 방지)', r.status === 200 && r.body?.ok === true && !r.body?.devResetUrl,
  JSON.stringify(r.body))

r = await call('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) })
const resetUrl = r.body?.devResetUrl
check('재설정 링크 발급', Boolean(resetUrl), JSON.stringify(r.body))
const resetToken = resetUrl?.split('reset=')[1]

r = await call('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: 'short' }) })
check('짧은 새 비밀번호 거부', r.status === 400)

r = await call('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: 'bogus', password: 'newpassword123' }) })
check('잘못된 재설정 토큰 거부', r.status === 400 && r.body?.code === 'invalid')

// 재설정 전 세션이 살아 있는지 먼저 확인합니다.
const sessionBefore = cookie
r = await call('/auth/me')
check('재설정 전 세션 유효', Boolean(r.body?.user))

r = await call('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: 'newpassword123' }) })
check('재설정 성공 후 자동 로그인', r.body?.user?.email === email, JSON.stringify(r.body))

// 재설정으로 발급된 새 세션은 살아 있고, 기존 세션은 폐기되어야 합니다.
const sessionAfter = cookie
cookie = sessionBefore
r = await call('/auth/me')
check('기존 세션은 폐기됨 (탈취 대비)', r.body?.user === null, JSON.stringify(r.body))
cookie = sessionAfter

r = await call('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: 'another123' }) })
check('같은 재설정 토큰 재사용 거부', r.status === 400 && r.body?.code === 'used')

r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) })
check('옛 비밀번호로는 로그인 불가', r.status === 401)

r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'newpassword123' }) })
check('새 비밀번호로 로그인 성공', r.status === 200, JSON.stringify(r.body))

// ── 레이트 리밋 ───────────────────────────────────────────────────────
// 자동 가입으로 무료 크레딧을 찍어내는 경로를 막는지 확인합니다.
// 상한은 서버 설정에서 읽습니다 — 하드코딩하면 환경마다 테스트가 깨집니다.
const health = (await call('/health')).body
const signupLimit = health?.limits?.signupPerHour ?? 5

// 상한이 높게 설정된 서버에서는 이 검사를 건너뜁니다.
// 끝까지 돌리면 가입 예산을 통째로 소진해, 같은 서버를 쓰는 브라우저 E2E 가 가입에 실패합니다.
if (signupLimit > 20) {
  console.log(`- 가입 상한 검증 건너뜀 (설정 ${signupLimit}/시간이 너무 높음)`)
  console.log(`  검증하려면 기본 상한으로 서버를 띄우세요: npm run server`)
} else {
  let limited = 0
  let created = 0
  for (let i = 0; i < signupLimit + 4; i++) {
    const res = await call('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: `flood${Date.now()}-${i}@example.com`, password: 'password123' }),
    })
    if (res.status === 429) limited++
    if (res.status === 201) created++
  }
  check('가입 폭주가 429 로 차단됨', limited > 0, `생성 ${created}건, 차단 ${limited}건`)
  check(
    `가입 상한(${signupLimit}/시간)이 적용됨`,
    created <= signupLimit,
    `생성 ${created}건 (상한 ${signupLimit})`,
  )
}

// 위 루프에서 마지막 가입 세션으로 바뀌었을 수 있으므로 원래 계정으로 되돌립니다.
r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'newpassword123' }) })
check('레이트 리밋 후에도 정상 로그인 가능', r.status === 200, JSON.stringify(r.body))

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

/*
 * 이 테스트는 API 를 두드리는 동시에 DB 를 직접 열어 원장을 검증합니다.
 * db.js 는 DATABASE_PATH 를 읽으므로, 서버가 다른 경로를 쓰면 여기서 빈 DB 를 열게 됩니다.
 * 그대로 두면 알 수 없는 TypeError 로 죽어서 원인을 찾는 데 시간이 걸립니다.
 */
const lastUser = db.prepare('SELECT id FROM users ORDER BY created_at DESC LIMIT 1').get()
if (!lastUser) {
  console.error(
    '\n✗ DB 에 사용자가 없습니다. 서버와 다른 DB 를 열었을 가능성이 높습니다.\n' +
      `  이 테스트가 연 경로: ${process.env.DATABASE_PATH ?? '(기본) data/roomcraft.db'}\n` +
      '  서버와 같은 DATABASE_PATH 를 넘겨서 실행하세요.\n',
  )
  process.exit(1)
}
const uid = lastUser.id
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
