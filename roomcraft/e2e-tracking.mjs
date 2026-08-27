/**
 * 클릭 추적 E2E.
 * 내보낸 링크가 /r/:id 로 발급되고, 그 링크를 실제로 열었을 때 집계되는지 확인합니다.
 *
 * 서버는 가입 상한을 올려 띄우세요 — 스위트 전체가 여러 번 가입합니다.
 *   RATE_LIMIT_SIGNUP_PER_HOUR=200 npm run server
 */
import { chromium } from 'playwright'

// 배포된 주소를 향해서도 그대로 돌릴 수 있게 합니다.
const BASE_URL = process.env.BASE_URL || BASE_URL

const errors = []
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const ctx = await b.newContext({ viewport: { width: 1680, height: 1050 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))

const step = async (l, fn) => {
  try { await fn(); console.log(`✓ ${l}`) }
  catch (e) { console.log(`✗ ${l} — ${e.message.split('\n')[0]}`); errors.push(l) }
}

const email = `trk${Date.now()}@example.com`
await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

await step('준비: 가입 + 렌더 + 무드보드', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  await page.getByText(email.split('@')[0]).first().waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
  await page.getByRole('button', { name: /스타일 적용하기/ }).first().click()
  await page.getByText(/스타일 일치도/).first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /Spec Sheet/ }).click()
  await page.getByRole('button', { name: /^Sync/ }).click()
  await page.waitForTimeout(500)
})

let trackedUrl = null

await step('블로그 내보내기가 추적 링크(/r/) 사용', async () => {
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.getByPlaceholder('AF_ROOMCRAFT_01').fill('AF_TRACK_TEST')
  await page.getByRole('button', { name: /블로그 포스팅용 복사/ }).click()
  await page.waitForTimeout(1500)
  const html = await page.evaluate(() => navigator.clipboard.readText())
  const m = html.match(/https?:\/\/[^"']*\/r\/[A-Za-z0-9_-]+/)
  if (!m) throw new Error(`추적 링크 없음: ${html.slice(0, 200)}`)
  trackedUrl = m[0]
})

await step('고지 문구가 정직하게 수정됨', async () => {
  const html = await page.evaluate(() => navigator.clipboard.readText())
  if (!html.includes('AI로 생성된 시안')) throw new Error('AI 시안 고지 없음')
  if (!html.includes('동일한 제품이 아닐 수 있습니다')) throw new Error('제품 불일치 고지 없음')
  if (html.includes('실제 배치된 가구')) throw new Error('과장 표현이 남아 있음')
})

await step('추적 링크 클릭 → 쇼핑몰로 302', async () => {
  const res = await page.request.get(trackedUrl, { maxRedirects: 0 })
  if (res.status() !== 302) throw new Error(`status=${res.status()}`)
  const loc = res.headers()['location']
  if (!loc?.includes('subId=AF_TRACK_TEST')) throw new Error(`제휴 ID 미반영: ${loc}`)
})

await step('클릭이 대시보드에 집계됨', async () => {
  await page.request.get(trackedUrl, { maxRedirects: 0 })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Earnings/ }).click()
  await page.getByText('실측 클릭 (내보낸 링크)').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '새로고침' }).click()
  await page.waitForTimeout(1200)
  const text = await page.locator('body').innerText()
  if (!/2회/.test(text)) throw new Error(`클릭 2회가 안 보임: ${text.slice(text.indexOf('실측 클릭'), text.indexOf('실측 클릭') + 200)}`)
})

await step('쇼퍼블 HTML 도 추적 링크 사용', async () => {
  await page.getByRole('button', { name: /Before \/ After Makeover/ }).click()
  await page.getByRole('button', { name: /쇼퍼블 HTML 복사/ }).click()
  await page.waitForTimeout(1500)
  const html = await page.evaluate(() => navigator.clipboard.readText())
  if (!/\/r\/[A-Za-z0-9_-]+/.test(html)) throw new Error('쇼퍼블 HTML 에 추적 링크 없음')
  if (!html.includes('AI 생성 시안')) throw new Error('쇼퍼블 HTML 고지 없음')
})

await step('구독 갱신 크레딧 지급 (dev 시뮬레이터)', async () => {
  const before = await page.evaluate(async () => (await (await fetch('/api/auth/me', { credentials: 'include' })).json()).user.credits)
  await page.evaluate(async () => {
    await fetch('/api/payments/checkout', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'plan', itemId: 'creator' }),
    }).then((r) => r.json()).then((s) => fetch('/api/payments/dev/complete', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentId: s.paymentId }),
    }))
  })
  const afterFirst = await page.evaluate(async () => (await (await fetch('/api/auth/me', { credentials: 'include' })).json()).user.credits)
  if (afterFirst !== before + 200) throw new Error(`최초 결제 지급 실패: ${before} → ${afterFirst}`)

  const renewed = await page.evaluate(async () => {
    const r = await fetch('/api/payments/dev/renew', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycle: '2026-11' }),
    })
    return (await r.json()).credits
  })
  if (renewed !== afterFirst + 200) throw new Error(`갱신 지급 실패: ${afterFirst} → ${renewed}`)
})

await step('비로그인은 원본 딥링크로 폴백', async () => {
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.getByRole('button', { name: /블로그 포스팅용 복사/ }).click()
  await page.waitForTimeout(1200)
  const html = await page.evaluate(() => navigator.clipboard.readText())
  if (/\/r\/[A-Za-z0-9_-]+/.test(html)) throw new Error('비로그인인데 추적 링크가 생성됨')
  if (!html.includes('coupang.com')) throw new Error('원본 딥링크 폴백 실패')
})

if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
console.log('\n--- 오류 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await b.close()
process.exit(errors.length ? 1 : 0)
