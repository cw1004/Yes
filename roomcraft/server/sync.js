/**
 * 스튜디오 상태 동기화.
 *
 * 무드보드·제휴설정·견적 같은 작업 상태는 JSON 한 덩어리로 저장합니다(형태가 자주 바뀌므로).
 * 반면 템플릿은 마켓에서 조회·판매되는 객체라 정규화된 테이블로 둡니다.
 */
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, now } from './db.js'
import { requireAuth } from './auth.js'

export const syncRouter = Router()

syncRouter.use(requireAuth)

syncRouter.get('/state', (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM user_state WHERE user_id = ?').get(req.user.id)
  res.json({
    state: row ? JSON.parse(row.data) : null,
    updatedAt: row?.updated_at ?? null,
  })
})

syncRouter.put('/state', (req, res) => {
  const state = req.body?.state
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'state 객체가 필요합니다.' })
  }
  const json = JSON.stringify(state)
  if (json.length > 512 * 1024) {
    return res.status(413).json({ error: '동기화 데이터가 너무 큽니다 (512KB 초과).' })
  }
  db.prepare(
    `INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(req.user.id, json, now())
  res.json({ ok: true, updatedAt: now() })
})

const toTemplate = (r) => ({
  id: r.id,
  title: r.title,
  styleId: r.style_id,
  spaceId: r.space_id,
  priceUsd: r.price_cents / 100,
  sales: r.sales,
  createdAt: r.created_at,
})

syncRouter.get('/templates', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
  res.json({ templates: rows.map(toTemplate) })
})

syncRouter.post('/templates', (req, res) => {
  const title = String(req.body?.title ?? '').trim()
  const styleId = String(req.body?.styleId ?? '')
  const spaceId = String(req.body?.spaceId ?? '')
  const priceUsd = Number(req.body?.priceUsd ?? 0)

  if (!title) return res.status(400).json({ error: '제목이 필요합니다.' })
  if (!Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 5000) {
    return res.status(400).json({ error: '판매가가 올바르지 않습니다.' })
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO templates (id, user_id, title, style_id, space_id, price_cents, sales, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, req.user.id, title, styleId, spaceId, Math.round(priceUsd * 100), now())

  res.status(201).json({ template: toTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)) })
})

syncRouter.delete('/templates/:id', (req, res) => {
  const changes = db
    .prepare('DELETE FROM templates WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id).changes
  if (!changes) return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' })
  res.json({ ok: true })
})
