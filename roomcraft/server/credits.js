/**
 * 크레딧 원장.
 *
 * 잔액을 컬럼으로 들고 있으면 동시 요청에서 값이 덮이고, 이중 지급을 사후에 추적할 수 없습니다.
 * 여기서는 모든 변동을 credit_ledger 에 append 하고 잔액은 SUM(delta) 로 계산합니다.
 * ref 에는 결제 ID 나 요청 ID 를 넣고, (reason, ref) 유니크 인덱스가 중복 적립을 DB 에서 막습니다.
 */
import { randomUUID } from 'node:crypto'
import { db, now } from './db.js'

/** 렌더/챗 1회당 크레딧 — 클라이언트의 data/plans.ts 와 값을 맞춰야 합니다. */
export const CREDIT_COST = {
  render: 5,
  upscale: 8,
  productSourcing: 2,
  chatTurn: 1,
}

export const PLANS = {
  free: { id: 'free', name: 'Free', priceCents: 0, monthlyCredits: 20, payoutRate: 0.7 },
  creator: { id: 'creator', name: 'Creator', priceCents: 1900, monthlyCredits: 200, payoutRate: 0.8 },
  pro: { id: 'pro', name: 'Pro Creator', priceCents: 4900, monthlyCredits: 600, payoutRate: 0.85 },
  studio: { id: 'studio', name: 'Studio', priceCents: 14900, monthlyCredits: 2400, payoutRate: 0.9 },
}

export const CREDIT_PACKS = {
  'pack-100': { id: 'pack-100', credits: 100, bonus: 0, priceCents: 900 },
  'pack-300': { id: 'pack-300', credits: 300, bonus: 30, priceCents: 2400 },
  'pack-1000': { id: 'pack-1000', credits: 1000, bonus: 150, priceCents: 6900 },
}

export function getBalance(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?').get(userId)
  return row?.balance ?? 0
}

/**
 * 원장에 한 줄 추가합니다.
 * ref 가 주어지고 이미 같은 (reason, ref) 가 있으면 조용히 건너뜁니다 — 웹훅 재전송 대비.
 */
export function addLedger(userId, delta, reason, ref = null) {
  try {
    db.prepare(
      'INSERT INTO credit_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), userId, delta, reason, ref, now())
    return true
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return false
    throw err
  }
}

export function grantMonthlyCredits(userId, planId, ref) {
  const plan = PLANS[planId] ?? PLANS.free
  return addLedger(userId, plan.monthlyCredits, `plan:${plan.id}`, ref)
}

export class InsufficientCredits extends Error {
  constructor(required, balance) {
    super(`크레딧이 부족합니다. 필요: ${required}, 보유: ${balance}`)
    this.code = 'insufficient_credits'
    this.required = required
    this.balance = balance
  }
}

/**
 * 크레딧을 차감합니다. 잔액 확인과 차감을 한 트랜잭션에 묶어
 * 동시 요청이 잔액을 음수로 만들지 못하게 합니다.
 */
export const spendCredits = db.transaction((userId, amount, reason, ref = null) => {
  const balance = getBalance(userId)
  if (balance < amount) throw new InsufficientCredits(amount, balance)
  addLedger(userId, -amount, reason, ref)
  return balance - amount
})

export function listLedger(userId, limit = 50) {
  return db
    .prepare('SELECT delta, reason, ref, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map((r) => ({ delta: r.delta, reason: r.reason, ref: r.ref, createdAt: r.created_at }))
}
