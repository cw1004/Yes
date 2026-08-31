/**
 * 제품 이미지 생성 · 보관.
 *
 * 목록이 단색 사각형이나 벡터 실루엣이면 사고 싶어지지 않습니다. 그렇다고 소매점의
 * 제품 사진을 가져다 쓸 수는 없습니다 — 대부분 약관 위반이고, 핫링크한 이미지는
 * 상대가 경로를 바꾸는 순간 통째로 사라집니다.
 *
 * 그래서 이미지 모델로 "상품 페이지에 올라갈 법한" 컷을 만들어 DB 에 보관합니다.
 * 렌더에 이미 쓰고 있는 Gemini 이미지 모델을 그대로 씁니다.
 *
 * ── 반드시 지켜야 할 것 ───────────────────────────────────────────────
 * 생성 이미지는 **실제 판매 상품의 사진이 아닙니다.** 그대로 상품 이미지처럼 보이게
 * 두면 소비자를 오인시키는 광고가 됩니다(표시광고법·각 제휴 프로그램 정책 모두 문제).
 * 그래서 is_generated 를 저장하고 응답 헤더로 내려보내며, 화면에는 라벨을 답니다.
 *
 * 제휴 프로그램(쿠팡 파트너스·Amazon PA-API·라쿠텐 등)에 승인되면 그쪽 API 가
 * 사용이 허락된 실제 상품 이미지를 내려줍니다. 그게 정식 경로이고, 이 모듈은
 * 승인 전까지의 대체재입니다. fetchAffiliateImage 자리를 비워 둔 이유입니다.
 */
import { Router } from 'express'
import { db, now } from './db.js'
import { CREDIT_COST, InsufficientCredits, addLedger, getBalance, spendCredits } from './credits.js'
import { requireUserOrGuest } from './auth.js'
import { imageLimiter } from './limits.js'
import { randomUUID } from 'node:crypto'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const IMAGE_MODEL = process.env.PRODUCT_IMAGE_MODEL || 'gemini-2.5-flash-image'

export const productImagesReady = Boolean(GEMINI_API_KEY)
export const productImageModel = IMAGE_MODEL

/**
 * 상품 컷 프롬프트.
 * 배경·조명·앵글을 고정해야 목록에 늘어놨을 때 한 가게처럼 보입니다.
 * 브랜드 로고나 상표는 넣지 않게 명시합니다 — 상표권 문제가 됩니다.
 */
function promptFor(p) {
  return [
    `A single piece of furniture photographed for an online shop listing:`,
    `${p.name}. Materials: ${p.materials || 'as typical for this piece'}.`,
    ``,
    `Composition: the object centered, shot straight on at eye level, filling most of the frame.`,
    `Background: seamless off-white studio backdrop, soft even daylight, gentle contact shadow under the object.`,
    `Style: clean commercial product photography, sharp focus, true-to-material colour, no props.`,
    `Do not include: text, watermarks, brand logos, trademarks, people, or any other furniture.`,
    `Square 1:1 framing.`,
  ].join('\n')
}

export function getStoredImage(sku) {
  return db.prepare('SELECT * FROM product_images WHERE sku = ?').get(sku) ?? null
}

async function generate(product) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptFor(product) }] }],
      }),
    },
  )
  if (!res.ok) throw new Error(`이미지 API 오류: ${(await res.text()).slice(0, 240)}`)

  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const part = parts.find((x) => x.inline_data?.data || x.inlineData?.data)
  if (!part) {
    throw new Error(`이미지가 반환되지 않았습니다. ${parts.find((x) => x.text)?.text ?? ''}`.trim())
  }
  const inline = part.inline_data || part.inlineData
  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mime: inline.mime_type || inline.mimeType || 'image/jpeg',
  }
}

export const productImagesRouter = Router()

/**
 * 보관된 이미지를 그대로 내려줍니다. 없으면 404 — 클라이언트는 벡터 실루엣으로 폴백합니다.
 * 생성은 GET 에서 하지 않습니다. 조회 한 번이 과금과 수 초의 대기를 유발하면
 * 목록을 스크롤하는 것만으로 요금이 나갑니다.
 */
productImagesRouter.get('/:sku', (req, res) => {
  const row = getStoredImage(String(req.params.sku))
  if (!row) return res.status(404).json({ error: '이미지가 아직 없습니다.', code: 'not_generated' })

  res.setHeader('Content-Type', row.mime)
  // 생성 이미지라는 사실이 이미지 파이프라인 어디서든 확인 가능해야 합니다.
  res.setHeader('X-Image-Generated', row.is_generated ? '1' : '0')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(row.image)
})

/** 아직 없는 SKU 만 골라 생성합니다. */
productImagesRouter.post('/', requireUserOrGuest, imageLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY 가 설정되지 않아 제품 이미지를 만들 수 없습니다.' })
  }

  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 6) : []
  if (!items.length) return res.status(400).json({ error: 'items 가 필요합니다.' })

  const pending = items.filter((p) => p?.sku && !getStoredImage(String(p.sku)))
  if (!pending.length) {
    return res.json({ generated: [], skipped: items.length, credits: getBalance(req.user.id) })
  }

  const requestId = randomUUID()
  const cost = CREDIT_COST.productSourcing * pending.length
  let credits
  try {
    credits = spendCredits(req.user.id, cost, 'product-image', requestId)
  } catch (err) {
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: err.message, code: err.code, balance: err.balance })
    }
    throw err
  }

  const generated = []
  const failed = []
  for (const p of pending) {
    try {
      const { buffer, mime } = await generate(p)
      db.prepare(
        `INSERT INTO product_images (sku, image, mime, provider, is_generated, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(sku) DO UPDATE SET image = excluded.image, mime = excluded.mime, created_at = excluded.created_at`,
      ).run(String(p.sku), buffer, mime, IMAGE_MODEL, now())
      generated.push(String(p.sku))
    } catch (err) {
      failed.push({ sku: String(p.sku), error: err.message.slice(0, 200) })
    }
  }

  // 만들지 못한 만큼만 되돌립니다. 전부 실패했는데 과금이 남으면 안 됩니다.
  if (failed.length) {
    addLedger(req.user.id, CREDIT_COST.productSourcing * failed.length, 'product-image:refund', requestId)
  }

  res.json({ generated, failed, credits: getBalance(req.user.id) })
})
