import { useEffect, useState } from 'react'
import { useStudio } from '../store/useStudio'
import { useAuth } from '../store/useAuth'
import { api } from '../lib/api'
import { planById } from '../data/plans'
import { relativeTime, usd } from '../lib/format'
import { Modal } from './ui/Modal'
import { Badge, Button, Stat } from './ui/primitives'

interface LedgerEntry {
  delta: number
  reason: string
  ref: string | null
  createdAt: number
}

interface Payment {
  id: string
  kind: string
  itemId: string
  amountCents: number
  status: string
  createdAt: number
}

const REASON_LABEL: Record<string, string> = {
  render: '렌더 사용',
  'render:refund': '렌더 실패 환불',
  chat: '디자이너 챗',
  'chat:refund': '챗 실패 환불',
  'plan:free': 'Free 플랜 지급',
  'plan:creator': 'Creator 플랜 지급',
  'plan:pro': 'Pro Creator 플랜 지급',
  'plan:studio': 'Studio 플랜 지급',
}

const label = (reason: string) =>
  REASON_LABEL[reason] ?? (reason.startsWith('pack:') ? '크레딧 팩 충전' : reason)

export function AccountModal() {
  const { modal, closeModal, openModal } = useStudio()
  const { user, logout } = useAuth()
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [payments, setPayments] = useState<Payment[]>([])

  const open = modal === 'account'

  useEffect(() => {
    if (!open || !user) return
    void api.ledger().then((r) => setLedger(r.entries)).catch(() => setLedger([]))
    void api.paymentHistory().then((r) => setPayments(r.payments)).catch(() => setPayments([]))
  }, [open, user])

  if (!user) return null
  const plan = planById(user.planId)

  return (
    <Modal
      open={open}
      onClose={closeModal}
      icon="🧑‍🎨"
      title={user.displayName}
      subtitle={user.email}
      width="max-w-3xl"
      headerRight={
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            await logout()
            closeModal()
          }}
        >
          로그아웃
        </Button>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto bg-ink-900 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="현재 플랜" value={plan.name} sub={`월 ${usd(plan.priceUsd)}`} tone="amber" />
          <Stat label="보유 크레딧" value={user.credits} sub="서버에 저장됨" tone="emerald" />
          <Stat label="가입일" value={new Date(user.createdAt).toLocaleDateString('ko-KR')} sub={relativeTime(user.createdAt)} />
        </div>

        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => openModal('plans')}>
            ♛ 플랜 변경 / 크레딧 충전
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => openModal('monetization')}>
            💲 수익 허브
          </Button>
        </div>

        <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <h4 className="text-xs font-bold text-mist-200">크레딧 원장</h4>
          <p className="mt-1 text-xs text-mist-500">
            모든 적립과 차감이 한 줄씩 기록됩니다. 잔액은 이 합계이므로 사후 감사가 가능합니다.
          </p>
          <div className="mt-3 max-h-56 overflow-y-auto">
            {ledger.length ? (
              <table className="w-full text-left text-xs">
                <tbody>
                  {ledger.map((e, i) => (
                    <tr key={`${e.ref ?? i}-${e.createdAt}`} className="border-b border-ink-800 last:border-0">
                      <td className="py-1.5 text-mist-300">{label(e.reason)}</td>
                      <td className="py-1.5 text-right text-mist-500">{relativeTime(e.createdAt)}</td>
                      <td
                        className={`w-16 py-1.5 text-right font-bold tabular-nums ${
                          e.delta > 0 ? 'text-emerald-brand' : 'text-mist-400'
                        }`}
                      >
                        {e.delta > 0 ? '+' : ''}
                        {e.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="py-4 text-center text-xs text-mist-500">기록이 없습니다.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <h4 className="text-xs font-bold text-mist-200">결제 내역</h4>
          <div className="mt-3 space-y-2">
            {payments.length ? (
              payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-mist-200">
                      {p.kind === 'plan' ? `${planById(p.itemId).name} 플랜` : `크레딧 팩 ${p.itemId}`}
                    </p>
                    <p className="text-xs text-mist-500">{relativeTime(p.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-mist-200">{usd(p.amountCents / 100, { cents: true })}</span>
                    <Badge tone={p.status === 'paid' ? 'emerald' : p.status === 'pending' ? 'amber' : 'neutral'}>
                      {p.status === 'paid' ? '완료' : p.status === 'pending' ? '대기' : p.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-center text-xs text-mist-500">결제 내역이 없습니다.</p>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
