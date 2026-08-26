/**
 * 결제.
 *
 * 프로바이더는 두 가지입니다.
 *   stripe — STRIPE_SECRET_KEY 가 있으면 Stripe Checkout 세션을 만들고, 웹훅으로 지급합니다.
 *   dev    — 키가 없을 때 쓰는 로컬 시뮬레이터. 결제창 대신 확인 모달을 띄우고 같은 지급 경로를 탑니다.
 *
 * 지급(fulfill)은 두 프로바이더가 같은 함수를 쓰기 때문에, 나중에 토스페이먼츠 등을 붙일 때도
 * 체크아웃 생성과 웹훅 검증만 추가하면 됩니다.
 */
import { Router, raw } from 'express'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { db, now } from './db.js'
import { CREDIT_PACKS, PLANS, addLedger, getBalance, grantMonthlyCredits } from './credits.js'
import { requireAuth } from './auth.js'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null
export const paymentProvider = stripe ? 'stripe' : 'dev'

function resolveItem(kind, itemId) {
  if (kind === 'plan') {
    const plan = PLANS[itemId]
    if (!plan) return null
    return { name: `RoomCraft ${plan.name} 플랜`, amountCents: plan.priceCents }
  }
  if (kind === 'pack') {
    const pack = CREDIT_PACKS[itemId]
    if (!pack) return null
    return {
      name: `크레딧 ${pack.credits}${pack.bonus ? ` (+${pack.bonus} 보너스)` : ''}`,
      amountCents: pack.priceCents,
    }
  }
  return null
}

/**
 * 결제 완료 처리. 여러 번 호출돼도 한 번만 지급됩니다.
 * - payments.status 를 pending -> paid 로 바꾸는 UPDATE 가 0행이면 이미 처리된 결제입니다.
 * - 원장의 (reason, ref) 유니크 인덱스가 2차 방어선입니다.
 */
export const fulfillPayment = db.transaction((paymentId) => {
  const changed = db
    .prepare("UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'")
    .run(now(), paymentId).changes

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)
  if (!payment) return { ok: false, reason: 'not_found' }
  if (!changed) return { ok: true, alreadyFulfilled: true, userId: payment.user_id }

  if (payment.kind === 'plan') {
    const plan = PLANS[payment.item_id] ?? PLANS.free
    db.prepare('UPDATE users SET plan_id = ? WHERE id = ?').run(plan.id, payment.user_id)
    grantMonthlyCredits(payment.user_id, plan.id, payment.id)
  } else {
    const pack = CREDIT_PACKS[payment.item_id]
    if (pack) addLedger(payment.user_id, pack.credits + pack.bonus, `pack:${pack.id}`, payment.id)
  }

  return { ok: true, alreadyFulfilled: false, userId: payment.user_id }
})

export const paymentsRouter = Router()

paymentsRouter.get('/config', (_req, res) => {
  res.json({
    provider: paymentProvider,
    plans: Object.values(PLANS),
    packs: Object.values(CREDIT_PACKS),
  })
})

/** 체크아웃 시작 */
paymentsRouter.post('/checkout', requireAuth, async (req, res) => {
  const kind = String(req.body?.kind ?? '')
  const itemId = String(req.body?.itemId ?? '')
  const item = resolveItem(kind, itemId)
  if (!item) return res.status(400).json({ error: '알 수 없는 상품입니다.' })
  if (item.amountCents <= 0) {
    return res.status(400).json({ error: '무료 플랜은 결제가 필요하지 않습니다.' })
  }

  const paymentId = randomUUID()
  db.prepare(
    `INSERT INTO payments (id, user_id, provider, kind, item_id, amount_cents, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'usd', 'pending', ?)`,
  ).run(paymentId, req.user.id, paymentProvider, kind, itemId, item.amountCents, now())

  if (!stripe) {
    // dev 프로바이더: 결제창 대신 클라이언트가 확인 모달을 띄우고 /dev/complete 를 호출합니다.
    return res.json({ provider: 'dev', paymentId, amountCents: item.amountCents, name: item.name })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: kind === 'plan' ? 'subscription' : 'payment',
      client_reference_id: paymentId,
      metadata: { paymentId, userId: req.user.id },
      customer_email: req.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: item.amountCents,
            product_data: { name: item.name },
            ...(kind === 'plan' ? { recurring: { interval: 'month' } } : {}),
          },
        },
      ],
      success_url: `${APP_URL}/?payment=success&id=${paymentId}`,
      cancel_url: `${APP_URL}/?payment=canceled&id=${paymentId}`,
    })

    db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?').run(session.id, paymentId)
    res.json({ provider: 'stripe', paymentId, url: session.url })
  } catch (err) {
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(paymentId)
    res.status(502).json({ error: `결제 세션 생성 실패: ${err.message}` })
  }
})

/**
 * dev 프로바이더 전용 결제 완료.
 * Stripe 키가 설정된 환경에서는 비활성화됩니다 — 실서비스에서 무료 지급 경로가 열리면 안 됩니다.
 */
paymentsRouter.post('/dev/complete', requireAuth, (req, res) => {
  if (stripe) return res.status(403).json({ error: 'dev 결제는 Stripe 설정 시 비활성화됩니다.' })

  const paymentId = String(req.body?.paymentId ?? '')
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)
  if (!payment) return res.status(404).json({ error: '결제를 찾을 수 없습니다.' })
  if (payment.user_id !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' })

  const result = fulfillPayment(paymentId)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({
    ok: result.ok,
    alreadyFulfilled: Boolean(result.alreadyFulfilled),
    credits: getBalance(req.user.id),
    planId: user.plan_id,
  })
})

/**
 * Stripe 웹훅.
 * 서명 검증을 위해 raw body 가 필요하므로 이 라우트에만 express.raw 를 씁니다.
 */
export const stripeWebhook = [
  raw({ type: 'application/json' }),
  (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe 가 설정되지 않았습니다.' })

    let event
    try {
      if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET 이 없습니다.')
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      // 검증 실패는 반드시 거절합니다. 여기서 통과시키면 누구나 크레딧을 지급받을 수 있습니다.
      return res.status(400).json({ error: `웹훅 서명 검증 실패: ${err.message}` })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const paymentId = session.metadata?.paymentId || session.client_reference_id
      if (paymentId) fulfillPayment(paymentId)
    }

    if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      const paymentId = event.data.object?.metadata?.paymentId
      if (paymentId) {
        db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(paymentId)
      }
    }

    res.json({ received: true })
  },
]

paymentsRouter.get('/history', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT id, kind, item_id, amount_cents, currency, status, created_at, paid_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id)
  res.json({
    payments: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      itemId: r.item_id,
      amountCents: r.amount_cents,
      currency: r.currency,
      status: r.status,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    })),
  })
})
