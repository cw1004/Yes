import { useStudio } from '../../store/useStudio'
import { CREDIT_COST, CREDIT_PACKS, PLANS, planById } from '../../data/plans'
import { pct, usd } from '../../lib/format'
import { Badge, Button, SectionTitle, Stat } from '../ui/primitives'

export function PlanTab() {
  const { planId, credits, setPlan, addCredits } = useStudio()
  const current = planById(planId)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="현재 플랜" value={current.name} sub={`월 ${usd(current.priceUsd)}`} tone="amber" />
        <Stat label="보유 크레딧" value={credits} sub={`렌더 1회 = ${CREDIT_COST.render} 크레딧`} />
        <Stat label="템플릿 정산 비율" value={pct(current.payoutRate)} sub="마켓 판매 시 창작자 몫" tone="emerald" />
      </div>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle icon="♛" title="구독 플랜" desc="렌더 횟수, 해상도, 판매 권한이 플랜에 따라 달라집니다." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => {
            const on = p.id === planId
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-xl border p-4 ${
                  on ? 'border-amber-brand bg-amber-brand/8' : 'border-ink-700 bg-ink-900'
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
                <p className="mt-1 text-[11px] text-amber-brand">월 {p.monthlyCredits} 크레딧</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-[11px] text-mist-400">
                  {p.perks.map((perk) => (
                    <li key={perk}>· {perk}</li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  variant={on ? 'chip' : 'primary'}
                  disabled={on}
                  onClick={() => setPlan(p.id)}
                >
                  {on ? '현재 플랜' : '이 플랜으로 변경'}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle icon="⚡" title="크레딧 충전" desc="구독과 별개로 필요할 때만 추가 렌더 크레딧을 구매합니다." />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-center">
              <p className="text-lg font-bold text-mist-200">
                {pack.credits}
                {pack.bonus ? <span className="text-emerald-brand"> +{pack.bonus}</span> : null}
              </p>
              <p className="text-[11px] text-mist-500">크레딧</p>
              <p className="mt-2 text-sm font-bold text-amber-brand">{usd(pack.priceUsd)}</p>
              <Button
                className="mt-3 w-full"
                variant="outline"
                onClick={() => addCredits(pack.credits + pack.bonus)}
              >
                충전하기
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-mist-500">
          ※ 이 데모에는 결제 연동이 포함되어 있지 않습니다. 실제 서비스에서는 이 버튼이 Stripe / 토스페이먼츠 결제
          세션으로 연결되며, 결제 완료 웹훅에서 크레딧이 지급되어야 합니다.
        </p>
      </section>
    </div>
  )
}
