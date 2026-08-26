/**
 * 렌더/챗 프록시.
 *
 * 두 가지 이유로 서버를 거칩니다.
 *   1. API 키를 브라우저에 노출하지 않기 위해
 *   2. 크레딧 차감을 클라이언트가 아니라 서버가 결정하기 위해
 *
 * 차감은 외부 API 호출 "전" 에 하고, 호출이 실패하면 되돌립니다.
 * 반대 순서로 하면 응답을 받고 차감 전에 연결이 끊길 때 무료 렌더가 됩니다.
 */
import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { CREDIT_COST, InsufficientCredits, addLedger, getBalance, spendCredits } from './credits.js'
import { requireAuth } from './auth.js'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const RENDER_MODEL = process.env.RENDER_MODEL || 'gemini-2.5-flash-image'
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-5'

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

export const aiReady = { render: Boolean(GEMINI_API_KEY), chat: Boolean(ANTHROPIC_API_KEY) }
export const aiModels = { render: RENDER_MODEL, chat: CHAT_MODEL }

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '')
  if (!m) throw new Error('이미지는 base64 data URL 형식이어야 합니다.')
  return { mimeType: m[1], base64: m[2] }
}

export const aiRouter = Router()

aiRouter.post('/render', requireAuth, async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' })

  const requestId = randomUUID()
  let credits
  try {
    credits = spendCredits(req.user.id, CREDIT_COST.render, 'render', requestId)
  } catch (err) {
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: err.message, code: err.code, balance: err.balance })
    }
    throw err
  }

  try {
    const { image, prompt } = req.body || {}
    const { mimeType, base64 } = parseDataUrl(image)

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${RENDER_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
            },
          ],
        }),
      },
    )

    if (!upstream.ok) throw new Error(`렌더 API 오류: ${(await upstream.text()).slice(0, 300)}`)

    const data = await upstream.json()
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => p.inline_data?.data || p.inlineData?.data)
    if (!imagePart) {
      throw new Error(`이미지가 반환되지 않았습니다. ${parts.find((p) => p.text)?.text ?? ''}`.trim())
    }

    const inline = imagePart.inline_data || imagePart.inlineData
    res.json({
      imageUrl: `data:${inline.mime_type || inline.mimeType || 'image/png'};base64,${inline.data}`,
      notes: [`${RENDER_MODEL} 렌더`],
      credits,
    })
  } catch (err) {
    // 렌더가 실패했으면 차감을 되돌립니다.
    addLedger(req.user.id, CREDIT_COST.render, 'render:refund', requestId)
    res.status(502).json({ error: err.message, credits: getBalance(req.user.id) })
  }
})

const DESIGNER_SYSTEM = `You are "Archie", the AI Principal Interior Designer at RoomCraft.
You advise on interior styling for a specific room and design style, and you recommend
purchasable furniture that matches.

Reply in the same language the user writes in (usually Korean).

Return ONLY a JSON object, no prose outside it, with this shape:
{
  "content": string,            // your answer in markdown (use **bold**), 2-6 short paragraphs or bullets
  "recommendations": string[],  // 0-3 SKU ids, chosen ONLY from the provided catalog list
  "requestsRerender": boolean   // true if the user's request changes the rendered image
}
Never invent SKU ids that are not in the catalog list.`

aiRouter.post('/chat', requireAuth, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' })

  const requestId = randomUUID()
  let credits
  try {
    credits = spendCredits(req.user.id, CREDIT_COST.chatTurn, 'chat', requestId)
  } catch (err) {
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: err.message, code: err.code, balance: err.balance })
    }
    throw err
  }

  try {
    const { message, history = [], styleId, spaceId, moodboard = [], catalog = [] } = req.body || {}

    const context = [
      `Room type: ${spaceId}`,
      `Design style: ${styleId}`,
      `Items already in the user's moodboard: ${moodboard.join(', ') || '(none)'}`,
      `Catalog SKU ids you may recommend: ${catalog.join(', ') || '(none provided)'}`,
    ].join('\n')

    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 2000,
      system: DESIGNER_SYSTEM,
      output_config: { effort: 'low' },
      messages: [
        ...history.slice(-10).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
        { role: 'user', content: `${context}\n\nUser request: ${message}` },
      ],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    // 모델이 코드펜스로 감싸는 경우까지 방어적으로 처리합니다.
    let parsed
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      parsed = { content: text, recommendations: [], requestsRerender: false }
    }

    res.json({
      content: String(parsed.content ?? text),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 3) : [],
      requestsRerender: Boolean(parsed.requestsRerender),
      credits,
    })
  } catch (err) {
    addLedger(req.user.id, CREDIT_COST.chatTurn, 'chat:refund', requestId)
    res.status(502).json({ error: err.message, credits: getBalance(req.user.id) })
  }
})
