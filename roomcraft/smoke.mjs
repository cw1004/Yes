import { chromium } from 'playwright'

// 배포된 주소를 향해서도 그대로 돌릴 수 있게 합니다.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const errors = []
const browser = await chromium.launch(
  // 별도 크로미움 경로를 쓰는 환경에서는 CHROMIUM_PATH 로 지정하세요.
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const step = async (label, fn) => {
  try { await fn(); console.log(`✓ ${label}`) }
  catch (e) { console.log(`✗ ${label} — ${e.message}`); errors.push(`${label}: ${e.message}`) }
}

await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })

await step('헤더 렌더', async () => {
  await page.getByText('RoomCraft').first().waitFor({ timeout: 5000 })
})

await step('샘플 이미지 업로드', async () => {
  await page.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
  await page.waitForTimeout(400)
})

await step('스타일 변경 (재팬디)', async () => {
  await page.getByRole('button', { name: /재팬디 세레니티/ }).first().click()
})

await step('강도 슬라이더 조절', async () => {
  await page.locator('input[type=range]').first().fill('100')
})

await step('메이크오버 생성 (mock 렌더)', async () => {
  await page.getByRole('button', { name: /스타일 적용하기/ }).first().click()
  await page.getByText(/스타일 일치도/).first().waitFor({ timeout: 15000 })
})

await step('Before/After 슬라이더 존재', async () => {
  await page.getByRole('slider', { name: '비교 슬라이더' }).waitFor({ timeout: 5000 })
})

await step('스펙시트 탭 + 무드보드 담기', async () => {
  await page.getByRole('button', { name: /Spec Sheet/ }).click()
  await page.getByRole('button', { name: /무드보드에 담기/ }).first().click()
  await page.waitForTimeout(300)
})

await step('Sync 로 큐레이션 일괄 담기', async () => {
  await page.getByRole('button', { name: /^Sync/ }).click()
  await page.waitForTimeout(300)
})

await step('Earnings 탭 계산', async () => {
  await page.getByRole('button', { name: /Earnings/ }).click()
  await page.getByText('기대 제휴 정산액').first().waitFor({ timeout: 5000 })
})

await step('수익 허브 모달 열기', async () => {
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.getByText(/크리에이터 수익화/).first().waitFor({ timeout: 5000 })
})

await step('제휴 ID 입력 → 딥링크에 반영', async () => {
  await page.getByPlaceholder('AF_ROOMCRAFT_01').fill('AF_TEST_99')
  await page.waitForTimeout(300)
  const body = await page.locator('table').first().innerText()
  if (!body.includes('subId=AF_TEST_99')) throw new Error('딥링크에 SubID 미반영')
})

await step('권역별 채널 토글 (일본 라쿠텐)', async () => {
  const before = await page.getByText(/제휴 채널 선택 \(/).first().innerText()
  await page.getByRole('button', { name: /楽天市場/ }).first().click()
  await page.waitForTimeout(300)
  const after = await page.getByText(/제휴 채널 선택 \(/).first().innerText()
  if (before === after) throw new Error('채널 토글이 반영되지 않음')
})

await step('전 채널 켜기 → 37개', async () => {
  await page.getByRole('button', { name: '전체 켜기' }).click()
  await page.waitForTimeout(300)
  const label = await page.getByText(/제휴 채널 선택 \(/).first().innerText()
  if (!label.includes('37/37')) throw new Error(`채널 수 불일치: ${label}`)
})

await step('전환율 슬라이더 → 기대 정산액 변화', async () => {
  const read = async () =>
    (await page.getByText('기대 제휴 정산액').first().locator('..').innerText()).replace(/\s+/g, ' ')
  const before = await read()
  await page.locator('input[aria-label="전환율"]').fill('6')
  await page.waitForTimeout(400)
  if ((await read()) === before) throw new Error('전환율이 기대 정산액에 반영되지 않음')
})

await step('실시간 딥링크 생성기', async () => {
  await page.getByPlaceholder(/가구\/조명명 입력/).fill('부클레 라운드 소파')
  await page.getByRole('button', { name: '딥링크 생성' }).click()
  await page.getByText(/rakuten\.co\.jp/).first().waitFor({ timeout: 8000 })
  await page.getByText(/taobao\.com/).first().waitFor({ timeout: 8000 })
})

await step('견적서 탭 계산', async () => {
  await page.getByRole('button', { name: /클라이언트 납품 견적서/ }).click()
  await page.getByText('디자이너 순이익').first().waitFor({ timeout: 5000 })
})

await step('플랜 탭 → 크레딧 충전', async () => {
  await page.getByRole('button', { name: /구독 플랜 관리/ }).click()
  await page.getByRole('button', { name: '충전하기' }).first().click()
  await page.waitForTimeout(300)
})

await step('템플릿 마켓 등록', async () => {
  await page.getByRole('button', { name: /템플릿 마켓 판매/ }).click()
  await page.getByRole('button', { name: '마켓에 등록' }).click()
  await page.getByText(/판매 0건/).first().waitFor({ timeout: 5000 })
})

await page.screenshot({ path: process.argv[2] || 'shot-monetization.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

await step('AI 디자이너 챗 응답', async () => {
  await page.getByRole('button', { name: /AI Designer/ }).click()
  await page.getByPlaceholder(/인테리어 디자이너 아치에게/).fill('러그를 네이비 울로 바꿔줘')
  await page.getByRole('button', { name: /전송/ }).click()
  await page.getByText(/요청을 반영했습니다/).first().waitFor({ timeout: 10000 })
})

await step('평면 배치 · 동선 검사', async () => {
  await page.getByRole('button', { name: /평면 배치 & 동선/ }).click()
  // 가구 칩은 "폭×깊이" 치수를 달고 있습니다.
  const chips = page.locator('button').filter({ hasText: /\d+×\d+/ })
  await chips.first().waitFor({ timeout: 8000 })
  await chips.nth(0).click()
  await chips.nth(1).click()
  await page.waitForTimeout(500)

  // 동선 검사가 실제 수치를 내놓는지 확인합니다.
  const body = await page.locator('body').innerText()
  if (!/최소 통로/.test(body)) throw new Error('동선 검사 패널 없음')
  if (!/전체 점유율/.test(body)) throw new Error('부피감 패널 없음')
  if (!/\d+×\d+×\d+mm/.test(body.replace(/\s/g, ''))) throw new Error('선택 가구의 치수 표시 없음')
})

await page.screenshot({ path: process.argv[3] || 'shot-studio.png', fullPage: false })

console.log('\n--- 콘솔 에러 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await browser.close()
process.exit(errors.length ? 1 : 0)
