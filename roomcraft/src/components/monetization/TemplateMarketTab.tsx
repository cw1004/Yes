import { useState } from 'react'
import { useActivePlanId, useStudio } from '../../store/useStudio'
import { styleById } from '../../data/styles'
import { spaceById } from '../../data/spaces'
import { planById } from '../../data/plans'
import { pct, relativeTime, usd } from '../../lib/format'
import { Badge, Button, Field, SectionTitle, Stat, inputClass } from '../ui/primitives'

export function TemplateMarketTab() {
  const {
    templates,
    styleId,
    spaceId,
    publishTemplate,
    removeTemplate,
    recordTemplateSale,
  } = useStudio()
  const style = styleById(styleId)
  const space = spaceById(spaceId)
  const plan = planById(useActivePlanId())

  const [title, setTitle] = useState('')
  const [price, setPrice] = useState(29)

  const gross = templates.reduce((s, t) => s + t.priceUsd * t.sales, 0)
  const net = gross * plan.payoutRate
  const sales = templates.reduce((s, t) => s + t.sales, 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="등록된 템플릿" value={`${templates.length}개`} sub={`누적 판매 ${sales}건`} />
        <Stat label="총 판매액 (GMV)" value={usd(gross)} sub="마켓 결제 기준" />
        <Stat
          label={`창작자 정산액 (${pct(plan.payoutRate)})`}
          value={usd(net, { cents: true })}
          sub={`${plan.name} 플랜 정산 비율 적용`}
          tone="emerald"
        />
      </div>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🏬"
          title="현재 디자인을 템플릿으로 판매 등록"
          desc="선택한 스타일·강도·큐레이션 구성이 하나의 프리셋으로 묶여 마켓에 등록됩니다."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Field label="템플릿 제목">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${style.nameEn} — ${space.labelEn} 프리셋`}
            />
          </Field>
          <Field label="판매가 (USD)" hint={`정산 ${pct(plan.payoutRate)} 적용 시 건당 ${usd(price * plan.payoutRate, { cents: true })}`}>
            <input
              className={inputClass}
              type="number"
              min={5}
              max={499}
              value={price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Button
            variant="primary"
            className="mb-0.5"
            disabled={plan.id === 'free' || plan.id === 'creator'}
            onClick={() => publishTemplate(title, price)}
          >
            마켓에 등록
          </Button>
        </div>
        {plan.id === 'free' || plan.id === 'creator' ? (
          <p className="mt-3 text-[11px] text-amber-brand">
            템플릿 판매는 Pro Creator 플랜부터 가능합니다. 구독 플랜 탭에서 업그레이드하세요.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle icon="📦" title="내 템플릿" desc="판매 시뮬레이션 버튼으로 정산 흐름을 확인할 수 있습니다." />
        <div className="mt-4 space-y-2">
          {templates.length ? (
            templates.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-mist-200">{t.title}</p>
                  <p className="mt-0.5 text-[11px] text-mist-500">
                    {styleById(t.styleId).name} · {spaceById(t.spaceId).label} · 등록 {relativeTime(t.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="amber">{usd(t.priceUsd)}</Badge>
                  <Badge tone={t.sales ? 'emerald' : 'neutral'}>판매 {t.sales}건</Badge>
                  <Button size="sm" variant="chip" onClick={() => recordTemplateSale(t.id)}>
                    판매 시뮬레이션 +1
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => removeTemplate(t.id)}>
                    삭제
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-ink-600 p-4 text-center text-xs text-mist-500">
              아직 등록한 템플릿이 없습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
