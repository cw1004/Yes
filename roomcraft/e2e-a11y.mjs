/**
 * 비밀번호 재설정 · 가독성 E2E.
 *
 * 서버는 상한을 올려 띄우세요:
 *   RATE_LIMIT_SIGNUP_PER_HOUR=500 RATE_LIMIT_PASSWORD_RESET_PER_HOUR=100 npm run server
 */
import { chromium } from 'playwright'

const errors = []
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await b.newPage({ viewport: { width: 1680, height: 1050 } })
page.on('pageerror', (e) => errors.push(e.message))

const step = async (l, fn) => {
  try { await fn(); console.log(`✓ ${l}`) }
  catch (e) { console.log(`✗ ${l} — ${e.message.split('\n')[0]}`); errors.push(l) }
}

const email = `a11y${Date.now()}@example.com`
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

await step('준비: 가입 + 인증', async () => {
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByRole('button', { name: '회원가입', exact: true }).click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  await page.getByRole('button', { name: /개발용 즉시 인증/ }).click({ timeout: 10000 })
  await page.waitForTimeout(1200)
})

await step('로그아웃 후 비밀번호 찾기 진입', async () => {
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByRole('button', { name: '비밀번호를 잊으셨나요?' }).click()
  await page.getByText('가입한 이메일을 입력하면').waitFor({ timeout: 5000 })
})

await step('재설정 요청 → 계정 존재 여부를 흘리지 않는 안내', async () => {
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: '재설정 링크 받기' }).click()
  await page.getByText(/가입된 이메일이라면 재설정 링크를 보냈습니다/).first().waitFor({ timeout: 8000 })
  // 같은 안내가 모달과 토스트에 동시에 뜨지 않아야 합니다.
  const shown = await page.getByText(/가입된 이메일이라면 재설정 링크를 보냈습니다/).count()
  if (shown !== 1) throw new Error(`안내가 ${shown}곳에 중복 표시됨`)
})

await step('새 비밀번호로 변경', async () => {
  await page.getByRole('button', { name: /개발용 재설정 링크 열기/ }).click()
  await page.getByText('새 비밀번호를 입력하세요').waitFor({ timeout: 5000 })
  await page.getByPlaceholder('••••••••').fill('brandnew12345')
  await page.getByRole('button', { name: '비밀번호 변경' }).click()
  await page.waitForTimeout(1500)
  await page.getByText(email.split('@')[0]).first().waitFor({ timeout: 8000 })
})

await step('옛 비밀번호는 더 이상 통하지 않음', async () => {
  await page.getByRole('button', { name: new RegExp(email.split('@')[0]) }).first().click()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /로그인/ }).first().click()
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  await page.getByText(/이메일 또는 비밀번호가 올바르지 않습니다/).waitFor({ timeout: 8000 })
})

await step('새 비밀번호로 로그인', async () => {
  await page.getByPlaceholder('••••••••').fill('brandnew12345')
  await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  await page.getByText(email.split('@')[0]).first().waitFor({ timeout: 8000 })
  await page.keyboard.press('Escape')
})

// ── 가독성 ────────────────────────────────────────────────────────────
await step('12px 미만 글자가 없음', async () => {
  const tooSmall = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      if (!el.textContent?.trim() || el.children.length) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size && size < 12) bad.push(`${el.tagName}.${el.className}`.slice(0, 60) + ` = ${size}px`)
    }
    return [...new Set(bad)].slice(0, 5)
  })
  if (tooSmall.length) throw new Error(`작은 글자 ${tooSmall.length}종: ${tooSmall[0]}`)
})

await step('본문 대비가 AA(4.5:1) 이상', async () => {
  const failures = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map((c) => {
        c /= 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) || []).map(Number)
      return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 }
    }
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })
    /**
     * 실효 배경색.
     * 반투명 배경은 아래 색과 합성해야 하고, 그라디언트는 단일 색으로 환산할 수 없어
     * 측정 대상에서 제외합니다(자동 판정 대신 눈으로 확인해야 하는 영역).
     */
    const bgOf = (el) => {
      const layers = []
      let n = el
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n)
        if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) return null
        const c = parse(cs.backgroundColor)
        if (c.a > 0) {
          layers.push(c)
          if (c.a === 1) break
        }
        n = n.parentElement
      }
      let acc = { r: 8, g: 8, b: 10, a: 1 }
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc)
      return `rgb(${acc.r}, ${acc.g}, ${acc.b})`
    }
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      if (!el.textContent?.trim() || el.children.length) continue
      const cs = getComputedStyle(el)
      if (cs.opacity === '0' || cs.visibility === 'hidden') continue
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight) >= 700
      const large = size >= 24 || (size >= 18.66 && bold)
      const bg = bgOf(el)
      if (!bg) continue // 그라디언트 배경은 자동 판정에서 제외
      const l1 = lum(cs.color)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      if (ratio < (large ? 3 : 4.5)) bad.push(`${el.textContent.trim().slice(0, 20)} = ${ratio.toFixed(2)}:1`)
    }
    return [...new Set(bad)].slice(0, 6)
  })
  if (failures.length) throw new Error(`대비 미달 ${failures.length}종: ${failures.join(' | ')}`)
})

await step('글자 크기 조절이 실제로 반영됨', async () => {
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
  await page.getByRole('button', { name: '글자 아주 크게' }).click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
  if (after <= before) throw new Error(`${before}px → ${after}px`)
})

await step('글자 크기 설정이 새로고침 후에도 유지됨', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const size = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
  if (size !== 20) throw new Error(`유지 실패: ${size}px`)
  await page.getByRole('button', { name: '글자 보통' }).click()
})

await step('버튼 클릭 영역이 WCAG 2.2 최소치(24px) 이상', async () => {
  const small = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('button')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // 문장 안에 놓인 인라인 링크는 WCAG 2.2 타깃 크기 예외입니다.
      if (getComputedStyle(el).display === 'inline') continue
      if (r.height < 24) bad.push(`${el.textContent?.trim().slice(0, 16)} = ${Math.round(r.height)}px`)
    }
    return [...new Set(bad)].slice(0, 5)
  })
  if (small.length) throw new Error(`작은 버튼 ${small.length}개: ${small.join(', ')}`)
})

if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
console.log('\n--- 오류 ---')
console.log(errors.length ? errors.join('\n') : '없음')
await b.close()
process.exit(errors.length ? 1 : 0)
