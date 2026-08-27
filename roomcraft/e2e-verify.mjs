/**
 * 이메일 인증 · 레이트 리밋 E2E.
 * 크레딧이 가입이 아니라 인증 시점에 지급되는지 확인합니다.
 *
 * 서버는 가입 상한을 올려 띄우세요 — 스위트 전체가 여러 번 가입합니다.
 *   RATE_LIMIT_SIGNUP_PER_HOUR=200 npm run server
 */
import { chromium } from 'playwright'

// 배포된 주소를 향해서도 그대로 돌릴 수 있게 합니다.
const BASE_URL = process.env.BASE_URL || BASE_URL

const errors = []
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await b.newPage({ viewport: { width: 1680, height: 1050 } })
page.on('pageerror', (e) => errors.push(e.message))

const step = async (l, fn) => {
  try { await fn(); console.log(`✓ ${l}`) }
  catch (e) { console.log(`✗ ${l} — ${e.message.split('\n')[0]}`); errors.push(l) }
}

const email = `vfy${Date.now()}@example.com`
await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

await step('가입 후 크레딧 0 · 인증 배너 노출', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  await page.getByText(/인증 메일을 확인해 주세요|인증 메일 재발송/).first().waitFor({ timeout: 10000 })

  const header = await page.locator('header').innerText()
  const credits = header.match(/(\d+)\s*크레딧/)?.[1]
  if (credits !== '0') throw new Error(`가입 직후 크레딧이 ${credits} (0이어야 함)`)
})

await step('인증 전에는 서버 렌더가 크레딧 부족으로 막힘', async () => {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/render', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/png;base64,AA==', prompt: 'x' }),
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  })
  // 키가 없으면 503, 있으면 402. 어느 쪽이든 렌더가 수행되면 안 됩니다.
  if (![402, 503].includes(res.status)) throw new Error(`status=${res.status}`)
})

await step('인증 완료 → 크레딧 20 지급', async () => {
  await page.getByRole('button', { name: /개발용 즉시 인증/ }).click()
  await page.waitForTimeout(1500)
  const header = await page.locator('header').innerText()
  if (!header.includes('20')) throw new Error(`크레딧 미지급: ${header.replace(/\s+/g, ' ').slice(0, 120)}`)
})

await step('인증 후 배너 사라짐', async () => {
  const count = await page.getByRole('button', { name: '인증 메일 재발송' }).count()
  if (count > 0) throw new Error('배너가 남아 있음')
})

await step('이미 인증된 계정은 재인증해도 크레딧 중복 지급 없음', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const header = await page.locator('header').innerText()
  if (!header.includes('20')) throw new Error(`크레딧이 20이 아님: ${header.replace(/\s+/g, ' ').slice(0, 120)}`)
})

const signupLimit = await page.evaluate(
  async () => (await (await fetch('/api/health')).json()).limits.signupPerHour,
)

// 상한이 높게 설정된 서버에서는 건너뜁니다.
// 끝까지 돌리면 가입 예산을 통째로 소진해 뒤따르는 E2E 가 전부 가입에 실패합니다.
// (기본 상한으로 띄운 서버에서 npm run test:api 가 같은 내용을 검증합니다.)
if (signupLimit > 20) {
  console.log(`- 가입 레이트 리밋 검증 건너뜀 (설정 ${signupLimit}/시간이 너무 높음)`)
} else await step('가입 레이트 리밋이 브라우저에서도 적용됨', async () => {
  const limit = signupLimit
  const results = await page.evaluate(async (n) => {
    const out = []
    for (let i = 0; i < n + 3; i++) {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `bot${Date.now()}-${i}@example.com`, password: 'password123' }),
      })
      out.push(r.status)
    }
    return out
  }, limit)
  const created = results.filter((s) => s === 201).length
  const blocked = results.filter((s) => s === 429).length
  if (blocked === 0) throw new Error(`차단 없음: ${JSON.stringify(results)}`)
  if (created > limit) throw new Error(`상한 초과 생성: ${created} > ${limit}`)
})

if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
console.log('\n--- 오류 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await b.close()
process.exit(errors.length ? 1 : 0)
