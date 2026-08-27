/**
 * 제휴 링크 클릭 추적.
 *
 * 이게 없으면 창작자는 어떤 스타일·채널이 실제로 돈이 되는지 알 수 없고,
 * "기대 정산액"은 사용자가 손으로 넣은 전환율 가정에 머뭅니다.
 *
 * 흐름: 내보내기 시 링크를 발급(/api/links) → 독자가 /r/:id 클릭 →
 *       클릭 기록 후 실제 쇼핑몰로 302.
 */
import { Router } from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { db, now } from './db.js'
import { requireAuth } from './auth.js'

/**
 * 리디렉트 대상으로 허용하는 호스트.
 *
 * target_url 은 우리가 만든 딥링크지만, 발급 API 를 통해 임의 URL 이 들어오면
 * 오픈 리디렉터가 됩니다(피싱 경유지로 악용). 호스트를 화이트리스트로 막습니다.
 */
const ALLOWED_HOSTS = [
  'coupang.com', 'ohou.se', 'naver.com', '11st.co.kr', 'gmarket.co.kr', 'auction.co.kr',
  'ssg.com', 'lotteon.com', 'hanssem.com', 'hyundailivart.co.kr',
  'amazon.com', 'amazon.co.jp', 'amazon.de', 'wayfair.com', 'westelm.com',
  'crateandbarrel.com', 'article.com', 'houzz.com', 'lumens.com', 'etsy.com', 'ebay.com',
  'rakuten.co.jp', 'yahoo.co.jp', 'low-ya.com', 'nitori-net.jp', 'muji.com',
  'taobao.com', 'jd.com', 'aliexpress.com', 'temu.com', '1688.com',
  'ikea.com', 'nordicnest.com', 'connox.com', 'madeindesign.co.uk',
  'westwing.de', 'maisonsdumonde.com',
]

function isAllowedTarget(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** 짧고 URL 안전한 토큰 */
const makeToken = () => randomBytes(8).toString('base64url')

/**
 * 추적 링크의 공개 주소.
 *
 * 클라이언트가 window.location.origin 으로 추측하면 안 됩니다 —
 * 운영에서는 웹(정적 호스팅)과 API 가 다른 도메인일 수 있고, 그때 /r/ 은
 * 웹 쪽에 존재하지 않습니다. 서버가 자기 공개 주소를 알고 완성된 URL 을 내려줍니다.
 */
const LINK_BASE = (process.env.LINK_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '')
export const linkUrl = (id) => (LINK_BASE ? `${LINK_BASE}/r/${id}` : `/r/${id}`)

/**
 * 방문자 해시.
 * 원문 IP 를 저장하지 않기 위해 일별로 바뀌는 솔트를 섞습니다.
 * 같은 날 같은 방문자의 중복 클릭만 구분할 수 있고, 날짜가 바뀌면 연결이 끊깁니다.
 */
const DAILY_SALT_BASE = process.env.CLICK_SALT || randomBytes(16).toString('hex')
function visitorHash(req) {
  const day = new Date().toISOString().slice(0, 10)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || ''
  return createHash('sha256').update(`${DAILY_SALT_BASE}:${day}:${ip}`).digest('hex').slice(0, 32)
}

export const linksRouter = Router()

/**
 * 링크 일괄 발급.
 * 같은 (사용자, 제품, 몰, 채널) 조합은 기존 토큰을 재사용합니다 —
 * 내보내기를 다시 해도 통계가 새 토큰으로 흩어지지 않게.
 */
linksRouter.post('/', requireAuth, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const source = String(req.body?.source ?? 'app').slice(0, 32)
  if (!items.length) return res.status(400).json({ error: 'items 가 필요합니다.' })
  if (items.length > 200) return res.status(413).json({ error: '한 번에 200개까지 발급할 수 있습니다.' })

  const rejected = []
  const links = {}

  const insert = db.prepare(
    `INSERT INTO links (id, user_id, sku, mall_id, target_url, label, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const findExisting = db.prepare(
    'SELECT id FROM links WHERE user_id = ? AND sku = ? AND mall_id = ? AND source = ?',
  )
  const refresh = db.prepare('UPDATE links SET target_url = ?, label = ? WHERE id = ?')

  db.transaction(() => {
    for (const item of items) {
      const sku = String(item?.sku ?? '')
      const mallId = String(item?.mallId ?? '')
      const targetUrl = String(item?.url ?? '')
      const label = String(item?.label ?? '').slice(0, 200)
      if (!sku || !mallId || !isAllowedTarget(targetUrl)) {
        rejected.push({ sku, mallId, reason: '허용되지 않은 대상 URL' })
        continue
      }

      const existing = findExisting.get(req.user.id, sku, mallId, source)
      if (existing) {
        // 제휴 ID 를 바꿨을 수 있으므로 대상 URL 은 갱신합니다.
        refresh.run(targetUrl, label, existing.id)
        links[`${sku}:${mallId}`] = linkUrl(existing.id)
        continue
      }

      const id = makeToken()
      insert.run(id, req.user.id, sku, mallId, targetUrl, label, source, now())
      links[`${sku}:${mallId}`] = linkUrl(id)
    }
  })()

  res.json({ links, rejected })
})

/** 링크별 클릭 통계 */
linksRouter.get('/stats', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.sku, l.mall_id, l.label, l.source, l.created_at,
              COUNT(c.id)                    AS clicks,
              COUNT(DISTINCT c.visitor_hash) AS visitors,
              MAX(c.clicked_at)              AS last_click
       FROM links l
       LEFT JOIN link_clicks c ON c.link_id = l.id
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY clicks DESC, l.created_at DESC
       LIMIT 200`,
    )
    .all(req.user.id)

  const links = rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    mallId: r.mall_id,
    label: r.label,
    source: r.source,
    createdAt: r.created_at,
    clicks: r.clicks,
    visitors: r.visitors,
    lastClick: r.last_click,
  }))

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0)
  const byMall = {}
  const bySku = {}
  for (const l of links) {
    byMall[l.mallId] = (byMall[l.mallId] ?? 0) + l.clicks
    bySku[l.sku] = (bySku[l.sku] ?? 0) + l.clicks
  }

  res.json({ links, totalClicks, byMall, bySku })
})

/**
 * 공개 리디렉트. 로그인 없이 누구나 접근합니다(독자가 누르는 링크이므로).
 * 기록에 실패하더라도 리디렉트는 반드시 수행합니다 — 통계 때문에 매출을 잃으면 안 됩니다.
 */
export function redirectHandler(req, res) {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id)
  if (!link) return res.status(404).type('text/plain').send('링크를 찾을 수 없습니다.')

  try {
    db.prepare(
      `INSERT INTO link_clicks (id, link_id, clicked_at, referrer, user_agent, visitor_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      link.id,
      now(),
      String(req.get('referer') ?? '').slice(0, 300) || null,
      String(req.get('user-agent') ?? '').slice(0, 300) || null,
      visitorHash(req),
    )
  } catch (err) {
    console.error('클릭 기록 실패:', err.message)
  }

  // 302 로 보냅니다. 301 은 브라우저가 캐시해서 이후 클릭이 서버에 도달하지 않습니다.
  res.redirect(302, link.target_url)
}
