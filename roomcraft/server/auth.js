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
import { exposesLinks, sendMail, verificationEmail } from './mailer.js'
import { signupLimiter, loginLimiter, verifyMailLimiter } from './limits.js'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const COOKIE = 'rc_session'
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '')

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
    emailVerified: Boolean(user.email_verified_at),
  }
}

/**
 * 인증 메일 발송.
 *
 * 기존 미사용 토큰은 무효화합니다 — 유효한 링크가 여러 개 떠 있으면
 * 유출 시 회수할 창구가 늘어납니다.
 */
async function issueVerification(user) {
  db.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'verify' AND used_at IS NULL").run(
    now(),
    user.id,
  )

  const token = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO email_tokens (token, user_id, purpose, expires_at, used_at, created_at)
     VALUES (?, ?, 'verify', ?, NULL, ?)`,
  ).run(token, user.id, now() + VERIFY_TTL_MS, now())

  const url = `${APP_URL}/?verify=${token}`
  const mail = verificationEmail({ displayName: user.display_name, url })
  const result = await sendMail({ to: user.email, ...mail })

  // 메일 서버가 없는 개발 환경에서만 링크를 응답에 실어 흐름을 확인할 수 있게 합니다.
  return { delivered: result.delivered, devUrl: exposesLinks ? url : undefined }
}

/**
 * 이메일 인증 완료 → 이 시점에 Free 플랜 크레딧을 지급합니다.
 *
 * 가입 시점에 지급하면 이메일 확인 없이 계정을 찍어내 무료 렌더를 무한히 쓸 수 있습니다.
 * 지급 ref 를 사용자 ID 로 고정해 두어, 재인증해도 두 번 지급되지 않습니다.
 */
export const completeVerification = db.transaction((token) => {
  const row = db.prepare("SELECT * FROM email_tokens WHERE token = ? AND purpose = 'verify'").get(token)
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (row.expires_at < now()) return { ok: false, reason: 'expired' }

  db.prepare('UPDATE email_tokens SET used_at = ? WHERE token = ?').run(now(), token)

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
  if (!user) return { ok: false, reason: 'invalid' }

  if (!user.email_verified_at) {
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(now(), user.id)
    grantMonthlyCredits(user.id, 'free', `verify:${user.id}`)
  }

  return { ok: true, userId: user.id }
})

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

authRouter.post('/signup', signupLimiter, async (req, res) => {
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

  // 크레딧은 여기서 주지 않습니다. 이메일 인증을 마쳐야 지급됩니다.
  db.prepare(
    `INSERT INTO users (id, email, password_hash, salt, display_name, plan_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'free', ?)`,
  ).run(id, email, hash, salt, displayName || email.split('@')[0], now())

  setSessionCookie(res, createSession(id))
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  const verification = await issueVerification(user)

  res.status(201).json({
    user: publicUser(user),
    verificationSent: verification.delivered,
    devVerifyUrl: verification.devUrl,
  })
})

authRouter.post('/verify', (req, res) => {
  const token = String(req.body?.token ?? '')
  const result = completeVerification(token)

  if (!result.ok) {
    const reason = {
      invalid: '유효하지 않은 인증 링크입니다.',
      used: '이미 사용된 인증 링크입니다.',
      expired: '인증 링크가 만료되었습니다. 재발송해 주세요.',
    }[result.reason]
    return res.status(400).json({ error: reason, code: result.reason })
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId)
  res.json({ user: publicUser(user) })
})

authRouter.post('/resend-verification', verifyMailLimiter, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' })
  if (req.user.email_verified_at) return res.status(400).json({ error: '이미 인증된 계정입니다.' })

  const verification = await issueVerification(req.user)
  res.json({ verificationSent: verification.delivered, devVerifyUrl: verification.devUrl })
})

authRouter.post('/login', loginLimiter, (req, res) => {
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
