import { chromium } from 'playwright'

// 배포된 주소를 향해서도 그대로 돌릴 수 있게 합니다.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const errors = []
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await b.newPage({ viewport: { width: 1680, height: 1050 } })
page.on('pageerror', (e) => errors.push(e.message))
const step = async (l, fn) => { try { await fn(); console.log(`✓ ${l}`) } catch (e) { console.log(`✗ ${l} — ${e.message.split('\n')[0]}`); errors.push(l) } }

await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '샘플 이미지 사용' }).first().click()
await page.getByRole('button', { name: /스타일 적용하기/ }).first().click()
await page.getByText(/스타일 일치도/).first().waitFor({ timeout: 20000 })

const tags = page.locator('button[title*="$"]')

await step('렌더 후 이미지 태그 자동 생성', async () => {
  const count = await tags.count()
  if (count < 3) throw new Error(`태그 ${count}개`)
})

await step('태그가 기본 슬라이더 위치에서 전부 클릭 가능', async () => {
  // 태그는 After 이미지의 상품이라 Before 쪽에 가려지면 pointer-events 가 꺼집니다.
  const n = await tags.count()
  for (let i = 0; i < n; i++) {
    const opacity = await tags.nth(i).evaluate((el) => getComputedStyle(el).opacity)
    if (opacity !== '1') throw new Error(`${i}번 태그가 Before 레이어에 가려짐`)
  }
})

await step('태그 클릭 → 구매 링크 카드', async () => {
  await tags.first().click({ timeout: 8000 })
  await page.getByText(/구매 링크 \(/).waitFor({ timeout: 5000 })
})

await step('카드에 활성 채널 링크가 실제 URL', async () => {
  const href = await page.locator('a[rel*="sponsored"]').first().getAttribute('href')
  if (!href || !href.startsWith('http')) throw new Error(`href=${href}`)
})

const closeCard = async () => {
  // 카드는 같은 태그를 다시 누르면 토글로 닫히므로, 열기 전에 항상 비워둡니다.
  if (await page.getByText(/구매 링크 \(/).count()) {
    await page.locator('button[aria-label="닫기"]').last().click()
    await page.waitForTimeout(200)
  }
}

await step('제휴 ID 입력이 이미지 링크에 반영', async () => {
  await closeCard()
  await page.getByRole('button', { name: /수익 허브/ }).first().click()
  await page.getByPlaceholder('AF_ROOMCRAFT_01').fill('AF_IMG_TEST')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await closeCard()
  await tags.first().click({ timeout: 8000 })
  await page.getByText(/구매 링크 \(/).waitFor({ timeout: 5000 })
  const hrefs = await page.locator('a[rel*="sponsored"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
  if (!hrefs.some((h) => h?.includes('subId=AF_IMG_TEST'))) throw new Error(`추적 ID 미반영: ${hrefs[0]}`)
})

await step('무드보드 담기 동작', async () => {
  await page.getByRole('button', { name: /무드보드에 담기/ }).first().click()
  await page.waitForTimeout(400)
})

await step('태그 드래그로 위치 이동', async () => {
  await closeCard()
  const tag = tags.first()
  // page.mouse 는 자동 스크롤을 하지 않습니다. 뷰포트 밖이면 이벤트가 도달하지 않습니다.
  await tag.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const before = await tag.boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + 160, before.y + 90, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const after = await tag.boundingBox()
  const moved = after.x - before.x
  const expected = 160 - before.width / 2
  if (Math.abs(moved - expected) > 12) {
    throw new Error(`이동량 불일치: ${moved.toFixed(0)}px (기대 ${expected.toFixed(0)}px)`)
  }
})

await step('드래그 중 태그 DOM 노드가 유지됨 (재마운트 회귀 방지)', async () => {
  const persisted = await tags.first().evaluate((el) => {
    const w = window
    w.__probe = el
    return true
  })
  if (!persisted) throw new Error('probe 실패')
  const box = await tags.first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 40, { steps: 6 })
  const connected = await page.evaluate(() => window.__probe.isConnected)
  await page.mouse.up()
  if (!connected) throw new Error('드래그 중 태그가 언마운트됨')
})

await step('드래그 후에는 카드가 열리지 않음', async () => {
  const open = await page.getByText(/구매 링크 \(/).count()
  if (open > 0) throw new Error('드래그가 클릭으로 처리됨')
})

await step('태그 추가', async () => {
  const before = await tags.count()
  await page.getByRole('button', { name: '＋ 태그 추가' }).click()
  // 큐레이션이 이미 전부 태그된 상태여도 나머지 카탈로그가 후보로 나와야 합니다.
  await page.getByPlaceholder(/제품\/브랜드 검색/).fill('Muuto')
  await page.waitForTimeout(300)
  await page.locator('button:has-text("Muuto Connect")').first().click()
  await page.waitForTimeout(400)
  const after = await tags.count()
  if (after <= before) throw new Error(`${before} → ${after}`)
})

await step('쇼퍼블 HTML 내보내기 (링크 포함)', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: /쇼퍼블 HTML 복사/ }).click()
  await page.waitForTimeout(600)
  const html = await page.evaluate(() => navigator.clipboard.readText())
  if (!html.includes('<figure')) throw new Error('figure 없음')
  if (!html.includes('position:absolute')) throw new Error('태그 절대 위치 없음')
  if (!html.includes('subId=AF_IMG_TEST')) throw new Error('제휴 추적 ID 없음')
  if (!html.includes('sponsored')) throw new Error('sponsored rel 없음')
  if (!html.includes('제휴 마케팅 링크를 포함')) throw new Error('대가성 문구 없음')
})

await step('태그 제거', async () => {
  const before = await tags.count()
  await page.locator('span:has-text("Muuto Connect") button[title="태그 제거"]').first().click()
  await page.waitForTimeout(300)
  const after = await tags.count()
  if (after >= before) throw new Error(`${before} → ${after}`)
})

if (process.argv[2]) {
  await tags.first().click({ timeout: 8000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: process.argv[2] })
}
console.log('\n--- 오류 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await b.close()
process.exit(errors.length ? 1 : 0)
