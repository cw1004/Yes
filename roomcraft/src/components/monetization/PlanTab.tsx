import { useCredits, useStudio } from '../../store/useStudio'
import { useAuth } from '../../store/useAuth'
import { CREDIT_COST, CREDIT_PACKS, PLANS, planById } from '../../data/plans'
import { pct, usd } from '../../lib/format'
import { Badge, Button, SectionTitle, Stat } from '../ui/primitives'

export function PlanTab() {
  const { planId, setPlan, addCredits, openModal } = useStudio()
  const { credits, isServer } = useCredits()
  const { user, paymentProvider, loading, startCheckout } = useAuth()

  // 로그인 상태면 플랜/크레딧은 결제를 거쳐 서버가 부여합니다.
  const activePlanId = user?.planId ?? planId
  const current = planById(activePlanId)

  const buyPlan = (id: (typeof PLANS)[number]['id']) => {
    if (!user) {
      // 비로그인 데모에서는 즉시 반영해 흐름만 보여줍니다.
      setPlan(id)
      return
    }
    void startCheckout('plan', id)
  }

  const buyPack = (packId: string, credited: number) => {
    if (!user) {
      addCredits(credited)
      return
    }
    void startCheckout('pack', packId)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="현재 플랜" value={current.name} sub={`월 ${usd(current.priceUsd)}`} tone="amber" />
        <Stat
          label="보유 크레딧"
          value={credits}
          sub={isServer ? `서버 저장 · 렌더 1회 = ${CREDIT_COST.render} 크레딧` : `로컬 데모 · 렌더 1회 = ${CREDIT_COST.render} 크레딧`}
        />
        <Stat label="템플릿 정산 비율" value={pct(current.payoutRate)} sub="마켓 판매 시 창작자 몫" tone="emerald" />
      </div>

      {!user ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-brand/30 bg-amber-brand/8 p-4">
          <p className="text-xs leading-relaxed text-amber-brand">
            지금은 <strong>로컬 데모 모드</strong>입니다. 플랜 변경과 충전이 브라우저에만 반영됩니다.
            <br />
            로그인하면 크레딧이 서버에 저장되고 실제 결제 흐름을 사용할 수 있습니다.
          </p>
          <Button variant="primary" size="sm" onClick={() => openModal('auth')}>
            🔐 로그인 / 회원가입
          </Button>
        </div>
      ) : null}

      <section className="rounded-xl border border-line-soft bg-ink-850 p-4">
        <SectionTitle
          icon="♛"
          title="구독 플랜"
          desc="렌더 횟수, 해상도, 판매 권한이 플랜에 따라 달라집니다."
          right={
            user ? (
              <Badge tone={paymentProvider === 'stripe' ? 'emerald' : 'neutral'}>
                결제: {paymentProvider === 'stripe' ? 'Stripe' : 'dev 시뮬레이터'}
              </Badge>
            ) : null
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => {
            const on = p.id === activePlanId
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-xl border p-4 ${
                  on ? 'border-amber-brand bg-amber-brand/8' : 'border-line-soft bg-ink-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-mist-200">{p.name}</h4>
                  {on ? <Badge tone="amber">사용 중</Badge> : null}
                </div>
                <p className="mt-2">
                  <span className="text-2xl font-extrabold text-mist-200">{usd(p.priceUsd)}</span>
                  <span className="text-xs text-mist-500"> /월</span>
                </p>
                <p className="mt-1 text-xs text-amber-brand">월 {p.monthlyCredits} 크레딧</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-mist-400">
                  {p.perks.map((perk) => (
                    <li key={perk}>· {perk}</li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={on ? 'chip' : 'primary'}
                  disabled={on || loading || (Boolean(user) && p.priceUsd === 0)}
                  onClick={() => buyPlan(p.id)}
                >
                  {on
                    ? '현재 플랜'
                    : p.priceUsd === 0
                      ? '무료 플랜'
                      : user
                        ? `${usd(p.priceUsd)} 결제하고 시작`
                        : '이 플랜으로 변경'}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line-soft bg-ink-850 p-4">
        <SectionTitle icon="⚡" title="크레딧 충전" desc="구독과 별개로 필요할 때만 추가 렌더 크레딧을 구매합니다." />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className="rounded-xl border border-line-soft bg-ink-900 p-4 text-center">
              <p className="text-lg font-bold text-mist-200">
                {pack.credits}
                {pack.bonus ? <span className="text-emerald-brand"> +{pack.bonus}</span> : null}
              </p>
              <p className="text-xs text-mist-500">크레딧</p>
              <p className="mt-2 text-sm font-bold text-amber-brand">{usd(pack.priceUsd)}</p>
              <Button
                className="mt-3 w-full"
                variant="outline"
                disabled={loading}
                onClick={() => buyPack(pack.id, pack.credits + pack.bonus)}
              >
                {user ? `${usd(pack.priceUsd)} 결제` : '충전하기'}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mist-500">
          {paymentProvider === 'stripe'
            ? '※ 결제는 Stripe Checkout 으로 진행되며, 크레딧은 결제 완료 웹훅에서 지급됩니다. 같은 결제가 두 번 전달돼도 지급은 한 번만 일어납니다.'
            : '※ STRIPE_SECRET_KEY 가 없어 dev 시뮬레이터로 동작합니다. Stripe 웹훅과 동일한 지급 경로를 타지만 실제 청구는 없습니다.'}
        </p>
      </section>
    </div>
  )
}
