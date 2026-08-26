import { useActivePlanId, useMoodboardTotals, useStudio } from '../store/useStudio'
import { estimateCommission, isMallLinked, mallById } from '../lib/affiliate'
import { planById } from '../data/plans'
import { computeQuote } from '../lib/quote'
import { krw, pct, usd } from '../lib/format'
import { Badge, Button, Stat } from './ui/primitives'

export function EarningsPanel() {
  const { templates, quote, affiliateIds, enabledMalls, conversionRate, openModal } = useStudio()
  const planId = useActivePlanId()
  const { rows, total, count } = useMoodboardTotals()

  const plan = planById(planId)
  const est = estimateCommission(total, enabledMalls, conversionRate)
  const q = computeQuote(rows, quote)
  const templateRevenue = templates.reduce((s, t) => s + t.priceUsd * t.sales * plan.payoutRate, 0)
  const monthlyCost = plan.priceUsd
  const net = est.expected + templateRevenue - monthlyCost
  const linkedCount = enabledMalls.filter((id) => isMallLinked(mallById(id), affiliateIds)).length

  const top = [...est.perMall].sort((a, b) => b.gross - a.gross)
  const maxGross = top[0]?.gross ?? 0

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="배치된 총 가구 견적" value={usd(total)} sub={`총 ${count}개 가구/소품`} />
        <Stat
          label="기대 제휴 정산액"
          value={`+${usd(est.expected, { cents: true })}`}
          sub={`전환율 ${pct(conversionRate, 1)} 반영`}
          tone="emerald"
        />
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-mist-200">채널별 기여도</h4>
          <Badge tone={linkedCount ? 'emerald' : 'neutral'}>
            {enabledMalls.length}개 채널 · {linkedCount}개 연동됨
          </Badge>
        </div>

        <div className="mt-3 space-y-2">
          {top.map(({ mall, rate, gross, expected }) => {
            const linked = isMallLinked(mall, affiliateIds)
            return (
              <div key={mall.id}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={linked ? 'text-mist-300' : 'text-mist-500'}>
                    {mall.icon} {mall.label}
                    {!linked ? <span className="ml-1 text-amber-brand">· ID 미입력</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-brand">
                    {usd(expected, { cents: true })}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className={`h-full rounded-full ${
                      linked
                        ? 'bg-gradient-to-r from-emerald-deep to-emerald-brand'
                        : 'bg-gradient-to-r from-ink-600 to-ink-500'
                    }`}
                    style={{ width: `${maxGross > 0 ? (gross / maxGross) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-mist-500">
                  요율 {pct(rate, 1)} · {mall.strength} · {mall.currency}
                </p>
              </div>
            )
          })}
          {!top.length ? (
            <p className="rounded-lg border border-dashed border-ink-600 p-4 text-center text-[11px] text-mist-500">
              활성화된 제휴 채널이 없습니다. 수익 허브에서 채널을 켜주세요.
            </p>
          ) : null}
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
          ※ 배치 가구가 전부 팔렸다고 가정한 상한은 {usd(est.gross, { cents: true })} 이며, 위 기대값은 여기에 전환율
          {' '}{pct(conversionRate, 1)}를 곱한 값입니다. 요율은 참고 구간이므로 각 프로그램 콘솔에서 확인하세요.
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
        💲 수익 허브에서 채널 설정 &amp; 링크 생성
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
