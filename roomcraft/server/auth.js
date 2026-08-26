/**
 * 계정 + 세션.
 *
 * 비밀번호는 scrypt 로 사용자별 salt 와 함께 해시합니다(외부 의존성 없이 node:crypto).
 * 세션 토큰은 DB에 저장하고 httpOnly 쿠키로 전달합니다 — JWT 와 달리 즉시 폐기할 수 있습니다.
 */
import { Router } from 'express'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, now } from './db.js'
import { grantMonthlyCredits, getBalance } from './credits.js'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const COOKIE = 'rc_session'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  }).toString('hex')
  return { hash, salt }
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now() + SESSION_TTL_MS,
    now(),
  )
  return token
}

export function userFromToken(token) {
  if (!token) return null
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!session) return null
  if (session.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) ?? null
}

/** 로그인 여부만 붙이고 통과시키는 미들웨어 */
export function attachUser(req, _res, next) {
  req.user = userFromToken(req.cookies?.[COOKIE])
  next()
}

/** 로그인을 강제하는 미들웨어 */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.', code: 'unauthorized' })
  next()
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    planId: user.plan_id,
    credits: getBalance(user.id),
    createdAt: user.created_at,
  }
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const authRouter = Router()

authRouter.post('/signup', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '').trim()

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' })
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
  }

  const { hash, salt } = hashPassword(password)
  const id = randomUUID()

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, salt, display_name, plan_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'free', ?)`,
    ).run(id, email, hash, salt, displayName || email.split('@')[0], now())
    // 가입 즉시 Free 플랜 크레딧을 지급합니다.
    grantMonthlyCredits(id, 'free', `signup:${id}`)
  })()

  setSessionCookie(res, createSession(id))
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  res.status(201).json({ user: publicUser(user) })
})

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  // 존재하지 않는 계정과 비밀번호 오류를 같은 메시지로 응답해 계정 존재 여부를 흘리지 않습니다.
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  }

  setSessionCookie(res, createSession(user.id))
  res.json({ user: publicUser(user) })
})

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[COOKIE]
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null })
  res.json({ user: publicUser(req.user) })
})
