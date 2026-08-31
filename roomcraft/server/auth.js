/**
 * 계정 + 세션.
 *
 * 비밀번호는 scrypt 로 사용자별 salt 와 함께 해시합니다(외부 의존성 없이 node:crypto).
 * 세션 토큰은 DB에 저장하고 httpOnly 쿠키로 전달합니다 — JWT 와 달리 즉시 폐기할 수 있습니다.
 */
import { Router } from 'express'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, now } from './db.js'
import { addLedger, grantMonthlyCredits, getBalance } from './credits.js'
import { exposesLinks, passwordResetEmail, sendMail, verificationEmail } from './mailer.js'
import { signupLimiter, loginLimiter, passwordResetLimiter, verifyMailLimiter, guestLimiter } from './limits.js'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
// 재설정 링크는 인증 링크보다 짧게 둡니다 — 탈취 시 계정을 통째로 넘겨주는 링크입니다.
const RESET_TTL_MS = 60 * 60 * 1000
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

/**
 * 게스트 크레딧.
 *
 * 가입을 강제하지 않는 대신 렌더 API 실비가 무한정 새지 않도록 한도를 둡니다.
 * 계정을 만들고 메일을 인증하면 free 플랜(20)을 따로 받으므로, 가입에는 여전히 이득이 있습니다.
 */
const GUEST_CREDITS = 15

/**
 * 세션이 없으면 게스트 사용자를 만들어 붙입니다.
 *
 * 게스트도 users 행으로 두는 이유: 세션·크레딧 원장·레이트 리밋·결제 경로가
 * user_id 를 기준으로 이미 완성돼 있어서, 별도의 게스트 체계를 만들면 같은 로직을
 * 두 벌 유지하게 됩니다. email 이 NOT NULL UNIQUE 라 합성 주소를 넣고 is_guest 로 구분합니다.
 *
 * 비밀번호는 로그인에 쓰이지 않아야 하므로 검증 불가능한 무작위 값을 넣습니다
 * (빈 문자열을 넣으면 빈 비밀번호로 로그인이 뚫립니다).
 */
export function ensureGuest(req, res) {
  if (req.user) return req.user

  const id = randomUUID()
  const { hash, salt } = hashPassword(randomBytes(32).toString('hex'))
  db.prepare(
    `INSERT INTO users (id, email, password_hash, salt, display_name, plan_id, created_at, is_guest)
     VALUES (?, ?, ?, ?, '게스트', 'free', ?, 1)`,
  ).run(id, `guest-${id}@guest.local`, hash, salt, now())

  addLedger(id, GUEST_CREDITS, 'guest', `guest:${id}`)
  setSessionCookie(res, createSession(id))
  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  return req.user
}

/**
 * 로그인 또는 게스트를 요구하는 미들웨어.
 * 가입 없이 바로 쓸 수 있게 하되, 익명 요청마다 새 게스트가 생겨 한도가 무의미해지지
 * 않도록 게스트 생성 자체에 IP 단위 상한을 겁니다.
 */
export function requireUserOrGuest(req, res, next) {
  if (req.user) return next()
  guestLimiter(req, res, (err) => {
    if (err) return next(err)
    // 리밋에 걸리면 guestLimiter 가 이미 응답했습니다.
    if (res.headersSent) return
    ensureGuest(req, res)
    next()
  })
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
    isGuest: Boolean(user.is_guest),
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
  // 게스트의 email 은 합성 주소라 실제로 발송되지 않습니다. 시도 자체가 메일 평판에 해롭습니다.
  if (req.user.is_guest) return res.status(400).json({ error: '게스트 세션입니다. 계정을 먼저 만들어 주세요.' })
  if (req.user.email_verified_at) return res.status(400).json({ error: '이미 인증된 계정입니다.' })

  const verification = await issueVerification(req.user)
  res.json({ verificationSent: verification.delivered, devVerifyUrl: verification.devUrl })
})

authRouter.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')

  // 게스트 행은 로그인 대상이 아닙니다. 비밀번호가 무작위라 뚫리지는 않지만 경로를 아예 막습니다.
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_guest = 0').get(email)
  // 존재하지 않는 계정과 비밀번호 오류를 같은 메시지로 응답해 계정 존재 여부를 흘리지 않습니다.
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  }

  setSessionCookie(res, createSession(user.id))
  res.json({ user: publicUser(user) })
})

/**
 * 비밀번호 재설정 요청.
 *
 * 계정 존재 여부와 무관하게 항상 같은 응답을 돌려줍니다.
 * 응답이 갈리면 이메일 목록으로 가입 여부를 훑을 수 있습니다.
 */
authRouter.post('/request-password-reset', passwordResetLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  // 게스트는 제외합니다 — guest-<uuid>@guest.local 은 계정 주소가 아닙니다.
  const user = EMAIL_RE.test(email)
    ? db.prepare('SELECT * FROM users WHERE email = ? AND is_guest = 0').get(email)
    : null

  let devUrl
  if (user) {
    db.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL").run(
      now(),
      user.id,
    )

    const token = randomBytes(32).toString('base64url')
    db.prepare(
      `INSERT INTO email_tokens (token, user_id, purpose, expires_at, used_at, created_at)
       VALUES (?, ?, 'reset', ?, NULL, ?)`,
    ).run(token, user.id, now() + RESET_TTL_MS, now())

    const url = `${APP_URL}/?reset=${token}`
    await sendMail({ to: user.email, ...passwordResetEmail({ displayName: user.display_name, url }) })
    if (exposesLinks) devUrl = url
  }

  res.json({ ok: true, devResetUrl: devUrl })
})

/**
 * 비밀번호 재설정 실행.
 *
 * 비밀번호를 바꾸면 기존 세션을 전부 폐기합니다.
 * 계정을 탈취당해 재설정하는 경우, 공격자의 세션이 살아 있으면 재설정이 무의미합니다.
 */
export const applyPasswordReset = db.transaction((token, password) => {
  const row = db.prepare("SELECT * FROM email_tokens WHERE token = ? AND purpose = 'reset'").get(token)
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (row.expires_at < now()) return { ok: false, reason: 'expired' }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
  if (!user) return { ok: false, reason: 'invalid' }

  const { hash, salt } = hashPassword(password)
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, user.id)
  db.prepare('UPDATE email_tokens SET used_at = ? WHERE token = ?').run(now(), token)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)

  // 재설정 링크를 열 수 있었다는 것은 메일함을 소유했다는 뜻이므로 인증도 함께 처리합니다.
  if (!user.email_verified_at) {
    db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(now(), user.id)
    grantMonthlyCredits(user.id, 'free', `verify:${user.id}`)
  }

  return { ok: true, userId: user.id }
})

authRouter.post('/reset-password', passwordResetLimiter, (req, res) => {
  const token = String(req.body?.token ?? '')
  const password = String(req.body?.password ?? '')
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })

  const result = applyPasswordReset(token, password)
  if (!result.ok) {
    const reason = {
      invalid: '유효하지 않은 재설정 링크입니다.',
      used: '이미 사용된 재설정 링크입니다.',
      expired: '재설정 링크가 만료되었습니다. 다시 요청해 주세요.',
    }[result.reason]
    return res.status(400).json({ error: reason, code: result.reason })
  }

  // 새 비밀번호로 곧바로 로그인시킵니다 (기존 세션은 위에서 모두 폐기됨).
  setSessionCookie(res, createSession(result.userId))
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId)
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
