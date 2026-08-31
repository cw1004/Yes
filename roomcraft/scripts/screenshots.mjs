/**
 * 실행 중인 앱을 실제 브라우저로 걸어가며 화면을 캡처합니다.
 *   BASE_URL=http://localhost:8899 OUT=/tmp/shots node scripts/screenshots.mjs
 * 데모·문서용이며 테스트가 아니므로 실패해도 다음 단계로 넘어갑니다.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const OUT = process.env.OUT || 'shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })

let n = 0
const shot = async (name) => {
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file })
  console.log(`📸 ${file}`)
}
const step = async (label, fn) => {
  try { await fn(); console.log(`✓ ${label}`) }
  catch (e) { console.log(`✗ ${label} — ${e.message}`) }
}

await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
await shot('landing')

await step('샘플 이미지 업로드', async () => {
  await page.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
  await page.waitForTimeout(500)
  await shot('uploaded')
})

await step('스타일 선택', async () => {
  await page.getByRole('button', { name: /재팬디 세레니티/ }).first().click()
  await page.locator('input[type=range]').first().fill('85')
  await page.waitForTimeout(300)
  await shot('style-selected')
})

await step('메이크오버 생성', async () => {
  await page.getByRole('button', { name: /스타일 적용하기/ }).first().click()
  await page.getByText(/스타일 일치도/).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
  await shot('makeover')
})

await step('Before/After 슬라이더 이동', async () => {
  const slider = page.getByRole('slider', { name: '비교 슬라이더' })
  await slider.focus()
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(400)
  await shot('before-after')
})

await step('Spec Sheet + 무드보드', async () => {
  await page.getByRole('button', { name: /Spec Sheet/ }).click()
  await page.waitForTimeout(300)
  await shot('spec-sheet')
  await page.getByRole('button', { name: /^Sync/ }).click()
  await page.waitForTimeout(400)
})

await step('Earnings 탭', async () => {
  await page.getByRole('button', { name: /Earnings/ }).click()
  await page.getByText('기대 제휴 정산액').first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
  await shot('earnings')
})

await step('수익 허브', async () => {
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.waitForTimeout(600)
  await shot('revenue-hub')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
})

await step('요금제 모달', async () => {
  await page.getByRole('button', { name: /요금제|업그레이드|크레딧/ }).first().click()
  await page.waitForTimeout(600)
  await shot('pricing')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
})

await step('로그인 모달', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.waitForTimeout(500)
  await shot('auth')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
})

await step('모바일 화면', async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await m.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
  await m.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
  await m.waitForTimeout(600)
  await m.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-mobile.png`, fullPage: false })
  console.log(`📸 ${OUT}/${String(n).padStart(2, '0')}-mobile.png`)
  await m.close()
})

await browser.close()
console.log(`\n총 ${n}장 → ${OUT}`)
