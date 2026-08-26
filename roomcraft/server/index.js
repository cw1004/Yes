/**
 * RoomCraft AI — 렌더/챗 프록시 서버
 *
 * 이 서버가 존재하는 이유는 하나입니다: API 키를 브라우저에 노출하지 않기 위해서.
 * 프론트엔드는 /api/health 를 먼저 호출해 서버 가용 여부를 확인하고,
 * 사용할 수 없으면 자동으로 목(mock) 프로바이더로 폴백합니다.
 */
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'

// .env 로더 (의존성 없이 최소 구현)
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  // .env 가 없으면 실제 환경변수만 사용합니다.
}

const PORT = Number(process.env.PORT || 8787)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const RENDER_MODEL = process.env.RENDER_MODEL || 'gemini-2.5-flash-image'
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-5'

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    renderReady: Boolean(GEMINI_API_KEY),
    chatReady: Boolean(ANTHROPIC_API_KEY),
    renderModel: RENDER_MODEL,
    chatModel: CHAT_MODEL,
  })
})

/** data URL -> { mimeType, base64 } */
function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '')
  if (!m) throw new Error('이미지는 base64 data URL 형식이어야 합니다.')
  return { mimeType: m[1], base64: m[2] }
}

/**
 * Before 사진 + 프롬프트 -> After 렌더.
 * Gemini 이미지 모델은 이미지와 텍스트를 함께 받아 편집된 이미지를 돌려줍니다.
 */
app.post('/api/render', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' })
  }
  try {
    const { image, prompt } = req.body || {}
    const { mimeType, base64 } = parseDataUrl(image)

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${RENDER_MODEL}:generateContent`
    const upstream = await fetch(url, {
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
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      return res.status(upstream.status).json({ error: `렌더 API 오류: ${detail.slice(0, 400)}` })
    }

    const data = await upstream.json()
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => p.inline_data?.data || p.inlineData?.data)
    if (!imagePart) {
      const text = parts.find((p) => p.text)?.text
      return res.status(502).json({ error: `이미지가 반환되지 않았습니다. ${text ?? ''}`.trim() })
    }

    const inline = imagePart.inline_data || imagePart.inlineData
    const outMime = inline.mime_type || inline.mimeType || 'image/png'
    res.json({
      imageUrl: `data:${outMime};base64,${inline.data}`,
      notes: [`${RENDER_MODEL} 렌더`],
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
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

app.post('/api/chat', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' })
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
    const jsonText = text.replace(/^```(?:json)?\s*|\s*```$/g, '')
    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      parsed = { content: text, recommendations: [], requestsRerender: false }
    }

    res.json({
      content: String(parsed.content ?? text),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 3) : [],
      requestsRerender: Boolean(parsed.requestsRerender),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`RoomCraft 프록시 서버: http://localhost:${PORT}`)
  console.log(`  렌더(${RENDER_MODEL}): ${GEMINI_API_KEY ? '준비됨' : '키 없음 — 클라이언트가 목 모드로 동작'}`)
  console.log(`  챗(${CHAT_MODEL}):    ${ANTHROPIC_API_KEY ? '준비됨' : '키 없음 — 클라이언트가 목 모드로 동작'}`)
})
