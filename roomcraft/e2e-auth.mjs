/**
 * 계정 · 결제 · 크레딧 브라우저 E2E.
 * API 서버와 dev 서버가 모두 떠 있어야 합니다.
 *
 * 서버는 가입 상한을 올려 띄우세요 — 스위트 전체가 여러 번 가입합니다.
 *   RATE_LIMIT_SIGNUP_PER_HOUR=200 npm run server
 */
import { chromium } from 'playwright'

const errors = []
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const step = async (label, fn) => {
  try { await fn(); console.log(`✓ ${label}`) }
  catch (e) { console.log(`✗ ${label} — ${e.message.split('\n')[0]}`); errors.push(label) }
}

const email = `e2e${Date.now()}@example.com`
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

await step('비로그인: 로컬 크레딧 배지 표시', async () => {
  await page.getByText('로컬', { exact: true }).first().waitFor({ timeout: 5000 })
})

await step('회원가입', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  await page.getByText(email.split('@')[0]).first().waitFor({ timeout: 10000 })
})

await step('이메일 인증 완료', async () => {
  // 크레딧은 가입이 아니라 인증 시점에 지급됩니다.
  await page.getByRole('button', { name: /개발용 즉시 인증/ }).click()
  await page.waitForTimeout(1500)
})

await step('인증 후 서버 크레딧 20 표시', async () => {
  const header = await page.locator('header').innerText()
  if (!header.includes('20')) throw new Error(`헤더에 20 없음: ${header.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (header.includes('로컬')) throw new Error('여전히 로컬 모드로 표시됨')
})

await step('크레딧 팩 결제 (dev 시뮬레이터)', async () => {
  await page.getByRole('button', { name: /크레딧/ }).first().click()
  await page.getByRole('button', { name: /구독 플랜 관리/ }).click()
  await page.getByRole('button', { name: /\$24 결제/ }).click()
  await page.getByText('결제 시뮬레이션').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '결제 확인' }).click()
  await page.waitForTimeout(1200)
})

await step('결제 후 크레딧 350 반영 (20 + 300 + 30)', async () => {
  const text = await page.locator('body').innerText()
  if (!text.includes('350')) throw new Error('350 크레딧이 반영되지 않음')
})

await step('Pro 플랜 결제 → 플랜 변경 + 600 크레딧', async () => {
  await page.getByRole('button', { name: /\$49 결제하고 시작/ }).click()
  await page.getByText('결제 시뮬레이션').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '결제 확인' }).click()
  await page.waitForTimeout(1200)
  const text = await page.locator('body').innerText()
  if (!text.includes('950')) throw new Error('950 크레딧이 반영되지 않음')
  if (!text.includes('PRO CREATOR')) throw new Error('플랜 배지가 갱신되지 않음')
})

await step('계정 모달: 원장 · 결제 내역', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByText('크레딧 원장').waitFor({ timeout: 5000 })
  const text = await page.locator('body').innerText()
  if (!text.includes('크레딧 팩 충전')) throw new Error('원장에 충전 기록 없음')
  if (!text.includes('Pro Creator 플랜 지급')) throw new Error('원장에 플랜 지급 기록 없음')
  if (!text.includes('완료')) throw new Error('결제 내역에 완료 상태 없음')
})

await step('새로고침 후 세션 유지', async () => {
  await page.keyboard.press('Escape')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText(email.split('@')[0]).first().waitFor({ timeout: 10000 })
  const header = await page.locator('header').innerText()
  if (!header.includes('950')) throw new Error('새로고침 후 크레딧 불일치')
})

await step('목 렌더는 서버 크레딧을 차감하지 않음', async () => {
  await page.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
  await page.getByRole('button', { name: /스타일 적용하기/ }).first().click()
  await page.getByText(/스타일 일치도/).first().waitFor({ timeout: 20000 })
  const header = await page.locator('header').innerText()
  if (!header.includes('950')) throw new Error('목 렌더가 서버 잔액을 건드림')
})

await step('로그아웃 → 로컬 모드 복귀', async () => {
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /로그인/ }).first().waitFor({ timeout: 5000 })
})

await step('재로그인으로 크레딧 복원', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  await page.waitForTimeout(1200)
  const header = await page.locator('header').innerText()
  if (!header.includes('950')) throw new Error(`크레딧 복원 실패: ${header.replace(/\s+/g, ' ').slice(0, 150)}`)
})

await step('잘못된 비밀번호 거부', async () => {
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('wrongpassword')
  await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  await page.getByText(/이메일 또는 비밀번호가 올바르지 않습니다/).waitFor({ timeout: 5000 })
})

await step('로컬 플랜이 서버 플랜을 덮어쓰지 않음', async () => {
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.getByText(/크리에이터 수익화/).waitFor({ timeout: 5000 })
  const modal = await page.getByText(/크리에이터 수익화/).locator('../..').innerText()
  // 이 계정은 Pro 플랜을 결제했으므로 헤더 배지도 Pro Creator 여야 합니다.
  if (!modal.includes('Pro Creator')) throw new Error(`플랜 배지 불일치: ${modal.replace(/\s+/g, ' ').slice(0, 120)}`)
  const body = await page.locator('body').innerText()
  if (body.includes('85 크레딧')) throw new Error('로컬 크레딧이 표시되고 있음')
})

if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
console.log('\n--- 오류 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await browser.close()
process.exit(errors.length ? 1 : 0)
