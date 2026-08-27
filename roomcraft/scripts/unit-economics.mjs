/**
 * 단위 경제성 계산기.
 *
 *   node scripts/unit-economics.mjs [렌더단가USD] [챗단가USD] [소진율]
 *   예: node scripts/unit-economics.mjs 0.04 0.02 0.7
 *
 * 렌더 API 단가는 공급자 정책에 따라 자주 바뀌므로 상수로 박지 않습니다.
 * 플랜·크레딧 값은 src/data/plans.ts 에서 직접 읽어, 가격을 바꿔도 이 계산이 따라옵니다.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../src/data/plans.ts'), 'utf8')

const must = (value, what) => {
  if (!value) throw new Error(`plans.ts 에서 ${what} 를 읽지 못했습니다. 파싱 규칙을 확인하세요.`)
  return value
}

const renderCredits = Number(must(src.match(/render:\s*(\d+)/), 'CREDIT_COST.render')[1])
const chatCredits = Number(must(src.match(/chatTurn:\s*(\d+)/), 'CREDIT_COST.chatTurn')[1])

const plans = [...src.matchAll(/id:\s*'(free|creator|pro|studio)'[\s\S]*?priceUsd:\s*([\d.]+)[\s\S]*?monthlyCredits:\s*(\d+)/g)]
  .map((m) => ({ id: m[1], priceUsd: Number(m[2]), credits: Number(m[3]) }))
must(plans.length, '플랜 목록')

const packs = [...src.matchAll(/id:\s*'(pack-[^']+)',\s*credits:\s*(\d+),\s*priceUsd:\s*([\d.]+),\s*bonus:\s*(\d+)/g)]
  .map((m) => ({ id: m[1], credits: Number(m[2]) + Number(m[4]), priceUsd: Number(m[3]) }))
must(packs.length, '크레딧 팩 목록')

const RENDER_COST = Number(process.argv[2] ?? 0.04)
const CHAT_COST = Number(process.argv[3] ?? 0.02)
const UTILIZATION = Number(process.argv[4] ?? 1)

const usd = (n) => `$${n.toFixed(2)}`
const pct = (n) => `${(n * 100).toFixed(0)}%`

console.log(`\n렌더 ${renderCredits}크레딧 · 챗 ${chatCredits}크레딧`)
console.log(`가정: 렌더 ${usd(RENDER_COST)}/회, 챗 ${usd(CHAT_COST)}/턴, 크레딧 소진율 ${pct(UTILIZATION)}\n`)

console.log('■ 손익분기 렌더 단가 (크레딧을 전부 렌더에 쓸 때)')
console.log('  상품            매출     렌더수   분기단가   현재가정 마진')
for (const item of [...plans.filter((p) => p.priceUsd > 0), ...packs]) {
  const renders = Math.floor(item.credits / renderCredits)
  const breakEven = item.priceUsd / renders
  const cost = renders * RENDER_COST * UTILIZATION
  const margin = (item.priceUsd - cost) / item.priceUsd
  const flag = margin < 0.5 ? (margin < 0.2 ? '  ⚠ 위험' : '  △ 주의') : ''
  console.log(
    `  ${item.id.padEnd(14)} ${usd(item.priceUsd).padStart(7)} ${String(renders).padStart(7)} ` +
      `${usd(breakEven).padStart(9)} ${pct(margin).padStart(9)}${flag}`,
  )
}

console.log('\n■ 크레딧을 전부 챗에 쓸 때 (최선 시나리오)')
for (const plan of plans.filter((p) => p.priceUsd > 0)) {
  const turns = Math.floor(plan.credits / chatCredits)
  const cost = turns * CHAT_COST * UTILIZATION
  console.log(
    `  ${plan.id.padEnd(14)} ${usd(plan.priceUsd).padStart(7)} ${String(turns).padStart(7)}턴 ` +
      `원가 ${usd(cost).padStart(7)} 마진 ${pct((plan.priceUsd - cost) / plan.priceUsd).padStart(6)}`,
  )
}

const free = plans.find((p) => p.id === 'free')
const freeRenders = Math.floor(free.credits / renderCredits)
console.log(`\n■ Free 플랜 = 순수 비용`)
console.log(`  가입 1건당 ${freeRenders}회 렌더 → ${usd(freeRenders * RENDER_COST)} 손실`)
console.log(`  가입 1,000건 자동화 시 ${usd(freeRenders * RENDER_COST * 1000)} 손실`)
console.log(`  → 레이트 리밋과 이메일 인증이 없으면 이 금액에 상한이 없습니다.\n`)
