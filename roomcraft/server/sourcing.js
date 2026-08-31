/**
 * AI 실시간 제품 소싱.
 *
 * 지금까지 카탈로그는 코드에 박힌 105개였습니다. 스타일이 30종이고 공간이 8종이니
 * 조합마다 맞는 제품을 사람이 계속 채워 넣는 것은 불가능합니다. 그래서 모델이
 * 웹 검색으로 "지금 실제로 살 수 있는" 제품을 찾아오게 합니다.
 *
 * 두 번에 나눠 호출합니다.
 *   1) 웹 검색 도구를 켜고 제품을 찾게 합니다.
 *   2) 도구 없이 그 결과만 스키마에 맞춰 정규화합니다.
 * 한 번에 하지 않는 이유는 검색 결과가 인용(citation) 블록을 동반하는데,
 * 구조화 출력(output_config.format)과 함께 쓸 수 없기 때문입니다.
 *
 * ── 정직하게 짚어둘 것 ────────────────────────────────────────────────
 * 모델이 찾아온 가격·재고·링크는 검색 시점의 스냅샷이며 곧 틀려집니다.
 * 그래서 결과에 sourcedAt 을 남기고 TTL 이 지나면 다시 찾습니다. 그래도
 * "결제 직전의 정확한 가격"은 각 쇼핑몰만 알 수 있습니다 — 이 값으로 정산을
 * 확정하면 안 되고, 제휴 콘솔의 실제 판매 데이터가 최종 근거입니다.
 */
import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { createHash, randomUUID } from 'node:crypto'
import { db, now } from './db.js'
import { CREDIT_COST, InsufficientCredits, addLedger, getBalance, spendCredits } from './credits.js'
import { requireUserOrGuest } from './auth.js'
import { sourcingLimiter } from './limits.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const SOURCING_MODEL = process.env.SOURCING_MODEL || 'claude-opus-5'
/** 캐시 수명. 가구 가격은 분 단위로 바뀌지 않지만 재고와 프로모션은 바뀝니다. */
const TTL_MS = Number(process.env.SOURCING_TTL_MS || 6 * 60 * 60 * 1000)

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null
export const sourcingReady = Boolean(ANTHROPIC_API_KEY) || (process.env.SOURCING_PROVIDER ?? '').startsWith('stub')
export const sourcingModel = SOURCING_MODEL

const SYSTEM = `You are a furniture sourcing researcher for an interior design app.

Find real, currently purchasable furniture and lighting that matches the requested
interior style, room type, region and budget. Prefer products that are:
  - actually in production and buyable online right now
  - well known enough that a shopper can find them on major marketplaces
  - spread across the price range, not all at the top

For each product report: exact product name, brand, an approximate current price in USD,
the retailer or brand site you saw it on, the primary material, and one concrete sentence
on why it suits the style. Never invent a product. If you are unsure a product exists,
leave it out rather than guessing.`

/** 정규화 스키마 — 앱의 Product 모양에 맞춥니다. */
const PRODUCT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'brand', 'price', 'category', 'silhouette', 'materials', 'reason', 'searchTerm', 'swatch'],
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          vendor: { type: 'string' },
          price: { type: 'number' },
          category: {
            type: 'string',
            enum: ['Seating', 'Table', 'Storage', 'Lighting', 'Rug', 'Decor', 'Appliance', 'Bed'],
          },
          silhouette: {
            type: 'string',
            enum: [
              'sofa', 'lounge', 'dining-chair', 'stool', 'bench', 'coffee-table', 'dining-table',
              'sideboard', 'shelf', 'floor-lamp', 'pendant', 'table-lamp', 'rug', 'vase',
              'mirror', 'art', 'plant', 'bed', 'appliance',
            ],
          },
          materials: { type: 'string' },
          reason: { type: 'string' },
          /** 제휴 딥링크에 쓰는 한국어 검색어 */
          searchTerm: { type: 'string' },
          /** 주 재질 색 (#rrggbb) — 썸네일 실루엣에 씁니다 */
          swatch: { type: 'string' },
          swatch2: { type: 'string' },
          officialUrl: { type: 'string' },
        },
      },
    },
  },
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * 모델이 준 값을 그대로 믿지 않습니다.
 * 색이 형식에 안 맞으면 썸네일이 깨지고, 가격이 문자열이면 수익 계산이 NaN 이 됩니다.
 */
function normalize(raw, region) {
  const list = Array.isArray(raw?.products) ? raw.products : []
  return list
    .map((p) => {
      const price = Number(p.price)
      if (!Number.isFinite(price) || price <= 0) return null
      const name = String(p.name ?? '').trim()
      const brand = String(p.brand ?? '').trim()
      if (!name || !brand) return null
      return {
        // 소싱 결과임을 sku 에 남깁니다. 카탈로그 SKU 와 섞이면 안 됩니다.
        sku: `ai-${createHash('sha1').update(`${brand}|${name}`).digest('hex').slice(0, 12)}`,
        name: name.slice(0, 140),
        brand: brand.slice(0, 60),
        vendor: String(p.vendor ?? brand).slice(0, 80),
        category: p.category,
        silhouette: p.silhouette,
        price: Math.round(price),
        rating: 4,
        materials: String(p.materials ?? '').slice(0, 200),
        reason: String(p.reason ?? '').slice(0, 300),
        officialUrl: /^https?:\/\//.test(p.officialUrl ?? '') ? p.officialUrl : '',
        searchTerm: String(p.searchTerm ?? name).slice(0, 100),
        swatch: HEX.test(p.swatch ?? '') ? p.swatch : '#b7ac9b',
        swatch2: HEX.test(p.swatch2 ?? '') ? p.swatch2 : undefined,
        sourced: true,
        region,
      }
    })
    .filter(Boolean)
}

const keyFor = (q) =>
  createHash('sha1').update(JSON.stringify(q)).digest('hex')

function readCache(key) {
  const row = db.prepare('SELECT * FROM sourced_products WHERE query_key = ?').get(key)
  if (!row) return null
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sourced_products WHERE query_key = ?').run(key)
    return null
  }
  return { products: JSON.parse(row.payload), provider: row.provider, sourcedAt: row.created_at }
}

function writeCache(key, products, provider) {
  db.prepare(
    `INSERT INTO sourced_products (query_key, payload, provider, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(query_key) DO UPDATE SET
       payload = excluded.payload, provider = excluded.provider,
       created_at = excluded.created_at, expires_at = excluded.expires_at`,
  ).run(key, JSON.stringify(products), provider, now(), now() + TTL_MS)
}

async function sourceWithClaude({ style, space, region, budgetUsd, count }) {
  const ask = [
    `Interior style: ${style}`,
    `Room: ${space}`,
    `Shopper region: ${region} (prefer retailers that ship there)`,
    `Budget for the whole room: about $${budgetUsd} USD`,
    `Find ${count} products.`,
  ].join('\n')

  // 1) 웹 검색으로 실제 제품을 찾습니다.
  const found = await anthropic.messages.create({
    model: SOURCING_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: ask }],
  })

  const research = found.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  if (!research) throw new Error('검색 결과가 비어 있습니다.')

  /*
   * 2) 정규화. 검색 결과는 인용 블록을 동반하고, 인용은 구조화 출력과 함께 쓸 수 없어서
   *    도구를 끈 두 번째 호출에서 스키마를 강제합니다.
   */
  const shaped = await anthropic.messages.create({
    model: SOURCING_MODEL,
    max_tokens: 8000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: PRODUCT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `아래 조사 결과를 스키마에 맞춰 정규화하세요. 조사 결과에 없는 제품을 새로 만들지 마세요.\n` +
          `swatch 는 그 제품의 주 재질 색을 #rrggbb 로, searchTerm 은 한국 쇼핑몰에서 검색할 한국어 키워드로 적으세요.\n\n` +
          research,
      },
    ],
  })

  const text = shaped.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  return JSON.parse(text)
}

/**
 * 테스트용 스텁 제공자.
 *
 * 캐시·정규화·과금/환불 경로는 API 키 없이도 검증할 수 있어야 합니다. 그러지 않으면
 * 키가 있는 환경에서만 처음 돌려보게 되고, 그때 나는 버그는 실제 요금을 태우면서
 * 찾게 됩니다. 잘못된 값(음수 가격·깨진 색·빈 이름)을 일부러 섞어 정규화가
 * 그것들을 걸러내는지도 함께 봅니다.
 */
function stubSource({ style, space }) {
  return {
    products: [
      {
        name: `${style} Low Oak Sofa`, brand: 'Testmoku', vendor: 'Testmoku / Studio',
        price: 2400, category: 'Seating', silhouette: 'sofa',
        materials: 'Solid oak frame, wool bouclé', reason: `Anchors a ${space} in this style.`,
        searchTerm: '오크 로우 소파', swatch: '#c9b190', swatch2: '#8a6f4a',
        officialUrl: 'https://example.com/sofa',
      },
      {
        name: `${style} Paper Pendant`, brand: 'Testlux', vendor: 'Testlux',
        price: 180, category: 'Lighting', silhouette: 'pendant',
        materials: 'Washi paper, steel', reason: 'Diffuses light without a hard edge.',
        searchTerm: '한지 펜던트 조명', swatch: '#f0e8d6',
        officialUrl: 'not-a-url',
      },
      // 아래 셋은 정규화가 버려야 합니다.
      { name: '', brand: 'X', price: 100, category: 'Decor', silhouette: 'vase', materials: '', reason: '', searchTerm: '', swatch: '#ffffff' },
      { name: 'Negative', brand: 'X', price: -5, category: 'Decor', silhouette: 'vase', materials: '', reason: '', searchTerm: '', swatch: '#ffffff' },
      { name: 'Bad Colour', brand: 'X', price: 90, category: 'Decor', silhouette: 'vase', materials: '', reason: '', searchTerm: '', swatch: 'chartreuse' },
    ],
  }
}

/** 실패 경로 검증용 — 환불이 실제로 도는지 봅니다. */
function failingSource() {
  throw new Error('스텁: 의도된 소싱 실패')
}

const PROVIDER = process.env.SOURCING_PROVIDER || 'claude'

function pickProvider() {
  if (PROVIDER === 'stub') return { name: 'stub', fn: stubSource }
  if (PROVIDER === 'stub-fail') return { name: 'stub-fail', fn: failingSource }
  return { name: 'claude-web-search', fn: sourceWithClaude }
}

export const sourcingRouter = Router()

sourcingRouter.post('/', requireUserOrGuest, sourcingLimiter, async (req, res) => {
  const style = String(req.body?.style ?? '').slice(0, 80)
  const space = String(req.body?.space ?? '').slice(0, 40)
  const region = String(req.body?.region ?? 'KR').slice(0, 4)
  const budgetUsd = Math.min(200000, Math.max(200, Number(req.body?.budgetUsd) || 5000))
  const count = Math.min(12, Math.max(3, Number(req.body?.count) || 6))

  if (!style || !space) return res.status(400).json({ error: 'style 과 space 가 필요합니다.' })

  const key = keyFor({ style, space, region, budgetUsd, count })
  const cached = readCache(key)
  // 캐시 적중은 외부 호출이 없으므로 과금하지 않습니다.
  if (cached) return res.json({ ...cached, cached: true, credits: getBalance(req.user.id) })

  const provider = pickProvider()
  if (provider.name === 'claude-web-search' && !anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않아 실시간 소싱을 쓸 수 없습니다.' })
  }

  const requestId = randomUUID()
  let credits
  try {
    credits = spendCredits(req.user.id, CREDIT_COST.productSourcing, 'sourcing', requestId)
  } catch (err) {
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: err.message, code: err.code, balance: err.balance })
    }
    throw err
  }

  try {
    const raw = await provider.fn({ style, space, region, budgetUsd, count })
    const products = normalize(raw, region)
    if (!products.length) throw new Error('사용할 수 있는 제품을 찾지 못했습니다.')

    writeCache(key, products, provider.name)
    res.json({ products, provider: provider.name, sourcedAt: now(), cached: false, credits })
  } catch (err) {
    addLedger(req.user.id, CREDIT_COST.productSourcing, 'sourcing:refund', requestId)
    res.status(502).json({ error: err.message, credits: getBalance(req.user.id) })
  }
})
