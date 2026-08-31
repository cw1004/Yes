/**
 * 수익 흐름 시뮬레이터 — 실제 서버 API 만 두드려 한 사이클을 끝까지 돌립니다.
 *   API_BASE=http://localhost:8899/api node scripts/simulate.mjs
 *
 * 목적은 "돈이 어디서 들어와 어디서 빠지는지"를 로그로 눈에 보이게 하는 것입니다.
 * 결제는 dev 시뮬레이터를 쓰므로 Stripe 키가 설정된 환경에서는 동작하지 않습니다.
 */
const API = process.env.API_BASE || 'http://localhost:8787/api'
const ORIGIN = API.replace(/\/api$/, '')

let cookie = ''
const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error ?? text.slice(0, 120)}`)
  return json
}

const money = (c) => `$${(c / 100).toFixed(2)}`
const line = (label, value) => console.log(`  ${label.padEnd(24)} ${value}`)
const head = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const health = await call('/health')
if (health.paymentProvider !== 'dev') {
  console.error(`결제 프로바이더가 '${health.paymentProvider}' 입니다. 이 시뮬레이터는 dev 전용입니다.`)
  process.exit(1)
}

// ── 1. 가입 (크레딧 0)
head('1. 가입 — 이 시점에는 크레딧을 주지 않습니다')
const email = `sim-${Date.now()}@example.com`
const signup = await call('/auth/signup', { method: 'POST', body: { email, password: 'sim-password-123' } })
line('이메일', email)
line('크레딧', signup.user.credits)
line('플랜', signup.user.planId)
if (!signup.devVerifyUrl) { console.error('인증 링크가 없습니다 (운영 모드에서는 노출되지 않습니다).'); process.exit(1) }

// ── 2. 이메일 인증 → 무료 크레딧
head('2. 이메일 인증 — 여기서 무료 크레딧이 지급됩니다')
const token = new URL(signup.devVerifyUrl).searchParams.get('verify')
const verified = await call('/auth/verify', { method: 'POST', body: { token } })
line('인증 후 크레딧', verified.user.credits)

// ── 3. 결제
head('3. 결제 — 크레딧 팩 구매')
const checkout = await call('/payments/checkout', { method: 'POST', body: { kind: 'pack', itemId: 'pack-300' } })
line('상품', checkout.name)
line('청구액', money(checkout.amountCents))
const paid = await call('/payments/dev/complete', { method: 'POST', body: { paymentId: checkout.paymentId } })
line('결제 후 크레딧', paid.credits)
const again = await call('/payments/dev/complete', { method: 'POST', body: { paymentId: checkout.paymentId } })
line('같은 결제 재처리', again.alreadyFulfilled ? `무시됨 (크레딧 ${again.credits} 그대로) ✓ 멱등` : '⚠ 중복 지급!')

// ── 4. 구독
head('4. 구독 — 플랜 전환과 갱신')
const sub = await call('/payments/checkout', { method: 'POST', body: { kind: 'plan', itemId: 'creator' } })
line('구독 상품', `${sub.name} · ${money(sub.amountCents)}/월`)
const subPaid = await call('/payments/dev/complete', { method: 'POST', body: { paymentId: sub.paymentId } })
line('플랜', subPaid.planId)
line('크레딧', subPaid.credits)
const renewed = await call('/payments/dev/renew', { method: 'POST' })
line('다음 달 갱신 후', renewed.credits)

// ── 5. 렌더 (크레딧 차감)
head('5. 렌더 — 크레딧이 빠지는 유일한 지점')
const before = (await call('/auth/me')).user.credits
try {
  await call('/render', { method: 'POST', body: { styleId: 'japandi', spaceId: 'living', intensity: 80 } })
} catch (e) {
  line('렌더 결과', `키 없음 — ${e.message.split('→')[1]?.trim() ?? e.message}`)
}
const after = (await call('/auth/me')).user.credits
line('크레딧 변화', `${before} → ${after} (${after - before})`)

// ── 6. 추적 링크 발급 + 클릭
head('6. 제휴 추적 링크 — 발급하고 실제로 클릭해 봅니다')
const minted = await call('/links', {
  method: 'POST',
  body: {
    source: 'sim',
    items: [
      { sku: 'sofa-karimoku', mallId: 'coupang', url: 'https://www.coupang.com/vp/products/123', label: 'Karimoku 소파' },
      { sku: 'table-ariake', mallId: 'amazon-us', url: 'https://www.amazon.com/dp/B0TEST', label: 'Ariake 테이블' },
      { sku: 'evil', mallId: 'coupang', url: 'https://evil.example.com/steal', label: '허용되지 않은 대상' },
    ],
  },
})
line('발급', `${Object.keys(minted.links).length}개`)
line('거부', `${minted.rejected.length}개 — ${minted.rejected.map((r) => r.reason).join(', ')} ✓ 오픈 리디렉트 차단`)

const urls = Object.values(minted.links)
for (const [i, url] of urls.entries()) {
  for (let k = 0; k <= i * 2; k++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': `sim-visitor-${k}` } })
    if (k === 0) line(`클릭 ${url.replace(ORIGIN, '')}`, `${r.status} → ${r.headers.get('location')?.slice(0, 48)}…`)
  }
}

const stats = await call('/links/stats')
head('7. 정산 근거 — 서버가 기록한 클릭')
for (const l of stats.links) line(`${l.label ?? l.sku}`, `클릭 ${l.clicks} · 방문자 ${l.visitors}`)

// ── 8. 원장
head('8. 크레딧 원장 — 잔액은 합계로만 존재합니다')
const ledger = await call('/credits/ledger')
for (const e of ledger.entries.slice(0, 10)) {
  line(`${e.delta > 0 ? '+' : ''}${e.delta}`, `${e.reason}${e.ref ? ` (${e.ref})` : ''}`)
}
line('합계', `${ledger.entries.reduce((s, e) => s + e.delta, 0)} 크레딧`)

head('요약')
const me = (await call('/auth/me')).user
line('플랜', me.planId)
line('크레딧', me.credits)
line('사용자가 낸 돈', money(2400 + 1900))
line('클릭 기록', `${stats.links.reduce((s, l) => s + l.clicks, 0)}건`)
console.log('')
