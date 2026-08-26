import { useMoodboardTotals, useStudio } from '../store/useStudio'
import { MALLS, avgCommission, estimateCommission } from '../lib/affiliate'
import { planById } from '../data/plans'
import { computeQuote } from '../lib/quote'
import { krw, pct, usd } from '../lib/format'
import { Button, Stat } from './ui/primitives'

export function EarningsPanel() {
  const { planId, templates, quote, openModal } = useStudio()
  const { rows, total, count } = useMoodboardTotals()

  const plan = planById(planId)
  const est = estimateCommission(total)
  const q = computeQuote(rows, quote)
  const templateRevenue = templates.reduce((s, t) => s + t.priceUsd * t.sales * plan.payoutRate, 0)
  const monthlyCost = plan.priceUsd
  const net = est.expected + templateRevenue - monthlyCost

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="배치된 총 가구 견적" value={usd(total)} sub={`총 ${count}개 가구/소품`} />
        <Stat
          label="예상 제휴 판매 수수료"
          value={`+${usd(est.expected, { cents: true })}`}
          sub={`평균 ${pct(est.avgRate, 1)} 커미션`}
          tone="emerald"
        />
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h4 className="text-xs font-bold text-mist-200">채널별 예상 수수료</h4>
        <div className="mt-3 space-y-2">
          {MALLS.map((m) => {
            const rate = avgCommission(m)
            const amount = total * rate
            const width = est.optimistic > 0 ? (amount / (total * m.commissionMax || 1)) * 100 : 0
            return (
              <div key={m.id}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-mist-300">
                    {m.icon} {m.label}
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-brand">
                    {usd(amount, { cents: true })}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-deep to-emerald-brand"
                    style={{ width: `${Math.min(100, width)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-mist-500">
                  커미션 {pct(m.commissionMin)}~{pct(m.commissionMax)} · {m.currency}
                </p>
              </div>
            )
          })}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-700 pt-3 text-center">
          <div>
            <p className="text-[10px] text-mist-500">보수적</p>
            <p className="text-xs font-bold text-mist-300">{usd(est.conservative, { cents: true })}</p>
          </div>
          <div>
            <p className="text-[10px] text-mist-500">기대값</p>
            <p className="text-xs font-bold text-emerald-brand">{usd(est.expected, { cents: true })}</p>
          </div>
          <div>
            <p className="text-[10px] text-mist-500">낙관적</p>
            <p className="text-xs font-bold text-mist-300">{usd(est.optimistic, { cents: true })}</p>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mist-500">
          ※ 위 금액은 배치 가구 전액이 제휴 링크로 구매된다고 가정한 상한 추정치입니다. 실제 정산액은 클릭 대비
          구매 전환율(보통 1~4%)에 따라 크게 달라집니다.
        </p>
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h4 className="text-xs font-bold text-mist-200">수익원 요약 (이번 달)</h4>
        <dl className="mt-3 space-y-2 text-[12px]">
          <Row label="제휴 커머스 (기대값)" value={usd(est.expected, { cents: true })} tone="emerald" />
          <Row
            label={`템플릿 마켓 (${templates.length}개 등록 · 정산 ${pct(plan.payoutRate)})`}
            value={usd(templateRevenue, { cents: true })}
            tone="emerald"
          />
          <Row label="클라이언트 납품 순이익" value={usd(q.netProfit)} tone="emerald" />
          <Row label={`구독료 (${plan.name})`} value={`-${usd(monthlyCost)}`} tone="muted" />
          <div className="border-t border-ink-700 pt-2">
            <Row label="합계 (견적 제외)" value={usd(net, { cents: true })} tone="strong" />
          </div>
        </dl>
        <p className="mt-2 text-[10px] text-mist-500">≈ {krw(net)} (환율 1,380원 기준)</p>
      </div>

      <Button variant="success" className="w-full" onClick={() => openModal('monetization')}>
        💲 수익 허브에서 링크 생성 &amp; 출금 설정
      </Button>
    </div>
  )
}

function Row({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'emerald' | 'muted' | 'strong'
}) {
  const cls = {
    default: 'text-mist-300',
    emerald: 'text-emerald-brand',
    muted: 'text-mist-500',
    strong: 'text-mist-200 font-bold',
  }[tone]
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-mist-400">{label}</dt>
      <dd className={`tabular-nums ${cls}`}>{value}</dd>
    </div>
  )
}
