/**
 * AI 제품 소싱 · 제품 이미지 E2E.
 *
 * 실제 모델을 부르지 않고 스텁 제공자로 배관만 검증합니다.
 * 서버를 이렇게 띄우세요:
 *   SOURCING_PROVIDER=stub RATE_LIMIT_GUEST_PER_HOUR=500 npm run server
 */
const API = process.env.API_BASE || 'http://localhost:8787/api'

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
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 160) } }
  return { status: res.status, json }
}

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const health = await call('/health')
if (!health.json.sourcingReady) {
  console.error('\n소싱이 꺼져 있습니다. SOURCING_PROVIDER=stub 로 서버를 띄우세요.\n')
  process.exit(1)
}

// ── 가입 없이 소싱 ────────────────────────────────────────────────────
const first = await call('/sourcing', { method: 'POST', body: { style: 'Japandi', space: 'living', budgetUsd: 6000 } })
check('가입 없이 소싱 (게스트 자동 생성)', first.status === 200, `status=${first.status}`)
check('제품을 돌려줌', (first.json.products?.length ?? 0) > 0)

const products = first.json.products ?? []
check('sku 가 ai- 접두사 (내장 카탈로그와 섞이지 않음)', products.every((p) => p.sku.startsWith('ai-')))
check('가격이 모두 양수', products.every((p) => Number.isFinite(p.price) && p.price > 0))
check('색이 모두 #rrggbb', products.every((p) => /^#[0-9a-fA-F]{6}$/.test(p.swatch)))
check('빈 이름·음수 가격은 걸러짐', !products.some((p) => !p.name || p.price <= 0))
check('http 가 아닌 officialUrl 은 비움', products.every((p) => p.officialUrl === '' || /^https?:\/\//.test(p.officialUrl)))

// ── 캐시 ──────────────────────────────────────────────────────────────
const before = first.json.credits
const again = await call('/sourcing', { method: 'POST', body: { style: 'Japandi', space: 'living', budgetUsd: 6000 } })
check('같은 조건은 캐시', again.json.cached === true)
check('캐시 적중은 재과금 없음', again.json.credits === before, `${before} → ${again.json.credits}`)

const other = await call('/sourcing', { method: 'POST', body: { style: 'Art Deco', space: 'bedroom', budgetUsd: 9000 } })
check('조건이 다르면 새로 소싱', other.json.cached === false)
check('새 소싱은 과금됨', other.json.credits < before, `${before} → ${other.json.credits}`)

// ── 입력 검증 ─────────────────────────────────────────────────────────
const bad = await call('/sourcing', { method: 'POST', body: { style: 'X' } })
check('필수 값 누락 → 400', bad.status === 400)

// ── 이미지 ────────────────────────────────────────────────────────────
const noImage = await fetch(`${API}/product-image/${products[0]?.sku ?? 'none'}`)
check('생성 전 이미지 조회 → 404 (클라이언트가 실루엣으로 폴백)', noImage.status === 404)

console.log(`\n통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
