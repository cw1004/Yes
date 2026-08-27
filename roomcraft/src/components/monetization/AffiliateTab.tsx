import { useMemo, useState } from 'react'
import { useMoodboardTotals, useStudio } from '../../store/useStudio'
import {
  MALLS,
  PROGRAMS,
  REGIONS,
  buildDeeplink,
  estimateCommission,
  isMallLinked,
  mallById,
  programById,
} from '../../lib/affiliate'
import {
  copyToClipboard,
  downloadText,
  toBlogHtml,
  toCsv,
  toKakaoText,
  type LinkResolver,
} from '../../lib/exporters'
import { resolveLinks } from '../../lib/tracking'
import { useAuth } from '../../store/useAuth'
import { styleById } from '../../data/styles'
import { spaceById } from '../../data/spaces'
import { pct, usd } from '../../lib/format'
import { Badge, Button, SectionTitle, Stat, inputClass } from '../ui/primitives'
import type { MallId } from '../../types'

export function AffiliateTab() {
  const {
    affiliateIds,
    enabledMalls,
    conversionRate,
    styleId,
    spaceId,
    setAffiliateIds,
    toggleMall,
    setEnabledMalls,
    setConversionRate,
    showToast,
  } = useStudio()
  const { rows, total, count } = useMoodboardTotals()
  const signedIn = Boolean(useAuth((s) => s.user))
  const [primaryMall, setPrimaryMall] = useState<MallId>('coupang')
  const [exporting, setExporting] = useState(false)
  const [term, setTerm] = useState('')
  const [saved, setSaved] = useState(false)

  const est = useMemo(
    () => estimateCommission(total, enabledMalls, conversionRate),
    [total, enabledMalls, conversionRate],
  )
  const style = styleById(styleId)
  const space = spaceById(spaceId)

  const linkedPrograms = PROGRAMS.filter((p) => (affiliateIds[p.id] ?? '').trim())
  const linkedMallCount = enabledMalls.filter((id) => isMallLinked(mallById(id), affiliateIds)).length

  const copy = async (text: string, label: string, note = '') => {
    const ok = await copyToClipboard(text)
    showToast(ok ? `${label}을(를) 복사했습니다.${note}` : '복사에 실패했습니다. 직접 선택해 주세요.')
  }

  /**
   * 내보내기 직전에 추적 링크를 발급받습니다.
   * 로그인하지 않았으면 원본 딥링크로 폴백합니다 — 추적만 빠지고 기능은 그대로 동작합니다.
   */
  const withLinks = async (
    mallIds: MallId[],
    source: string,
    run: (resolve: LinkResolver, tracked: boolean) => Promise<void> | void,
  ) => {
    setExporting(true)
    try {
      const { resolver, tracked } = await resolveLinks({
        rows,
        mallIds,
        affiliateIds,
        source,
        signedIn,
      })
      await run(resolver, tracked)
    } finally {
      setExporting(false)
    }
  }


  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="추천 제품 총 견적" value={usd(total)} sub={`총 ${count}개 추천 제품`} />
        <Stat
          label="기대 제휴 정산액"
          value={`+${usd(est.expected, { cents: true })}`}
          sub={`상한 ${usd(est.gross, { cents: true })} × 전환율 ${pct(conversionRate, 1)}`}
          tone="emerald"
        />
        <Stat
          label="활성 채널 / 연동 완료"
          value={`${enabledMalls.length} / ${linkedMallCount}`}
          sub={
            linkedPrograms.length
              ? `${linkedPrograms.map((p) => p.label).join(' · ')} 연동됨`
              : '아래에서 프로그램 ID를 입력하세요'
          }
          tone={linkedMallCount ? 'emerald' : 'neutral'}
        />
      </div>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🛍"
          title={`제휴 채널 선택 (${enabledMalls.length}/${MALLS.length})`}
          desc="링크를 생성할 쇼핑몰을 고르세요. 국내 종합몰은 대부분 하나의 CPS 네트워크로 묶여 있어 ID는 프로그램 단위로 관리됩니다."
          right={
            <div className="flex gap-1">
              <Button size="sm" variant="chip" onClick={() => setEnabledMalls(MALLS.map((m) => m.id))}>
                전체 켜기
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEnabledMalls([])}>
                전체 끄기
              </Button>
            </div>
          }
        />

        {REGIONS.map((region) => (
          <div key={region.id} className="mt-4">
            <p className="mb-2 text-xs font-bold tracking-wide text-mist-400">
              {region.flag} {region.label} ({MALLS.filter((m) => m.region === region.id).length})
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MALLS.filter((m) => m.region === region.id).map((mall) => {
                const on = enabledMalls.includes(mall.id)
                const linked = isMallLinked(mall, affiliateIds)
                return (
                  <button
                    key={mall.id}
                    onClick={() => toggleMall(mall.id)}
                    className={`rounded-lg border p-2.5 text-left transition ${
                      on ? 'border-emerald-brand/50 bg-emerald-brand/8' : 'border-ink-700 bg-ink-900 hover:border-ink-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-mist-200">
                        {mall.icon} {mall.label}
                      </span>
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded text-xs ${
                          on ? 'bg-emerald-brand text-ink-950' : 'border border-ink-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-mist-500">
                      {pct(mall.commissionMin)}~{pct(mall.commissionMax)} · {mall.strength}
                    </p>
                    <p className="mt-1 text-xs">
                      <span className={linked ? 'text-emerald-brand' : 'text-mist-500'}>
                        {linked ? '✓ ' : '○ '}
                        {programById(mall.programId).label}
                      </span>
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🛡"
          title="제휴 프로그램 ID 설정 (AFFILIATE PROGRAM IDS)"
          desc="가입한 프로그램의 추적 ID만 입력하면 됩니다. 해당 프로그램에 속한 모든 몰의 링크에 자동 삽입됩니다."
          right={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setSaved(true)
                showToast('제휴 설정을 저장했습니다.')
                setTimeout(() => setSaved(false), 1800)
              }}
            >
              ✦ {saved ? '저장됨 ✓' : '설정 저장'}
            </Button>
          }
        />
        {REGIONS.map((region) => (
          <div key={region.id} className="mt-4">
            <p className="mb-2 text-xs font-bold tracking-wide text-mist-400">
              {region.flag} {region.label}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PROGRAMS.filter((p) => p.region === region.id).map((program) => {
            const covered = MALLS.filter((m) => m.programId === program.id)
            const activeCovered = covered.filter((m) => enabledMalls.includes(m.id))
                return (
                  <div key={program.id} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-mist-200">{program.label}</span>
                  <Badge tone={activeCovered.length ? 'amber' : 'neutral'}>
                    {activeCovered.length}/{covered.length} 몰
                  </Badge>
                </div>
                <input
                  className={`${inputClass} mt-2`}
                  value={affiliateIds[program.id] ?? ''}
                  placeholder={program.idPlaceholder}
                  onChange={(e) => setAffiliateIds({ [program.id]: e.target.value })}
                  aria-label={program.idLabel}
                />
                <p className="mt-1.5 text-xs text-mist-500">
                  파라미터 <code className="rounded bg-ink-800 px-1">{program.paramKey}</code> ·{' '}
                  {covered.map((m) => m.label).join(', ')}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-mist-500">{program.note}</p>
                {program.consoleUrl ? (
                  <a
                    href={program.consoleUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1.5 inline-block text-xs text-amber-brand hover:underline"
                  >
                    가입/콘솔 열기 ↗
                  </a>
                ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <p className="mt-3 text-xs leading-relaxed text-mist-500">
          ⚠ 제휴 링크가 포함된 콘텐츠에는 각 프로그램 약관과 공정거래위원회 「추천·보증 등에 관한 표시·광고 심사지침」에
          따라 <strong className="text-mist-300">대가성 문구를 반드시 표기</strong>해야 합니다. 아래 내보내기 결과에는
          문구가 자동으로 포함됩니다. 표시된 커미션 구간은 참고용이며, 확정 요율은 각 프로그램 콘솔에서 확인하세요.
        </p>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="📈"
          title="전환율 가정"
          desc="링크 클릭 대비 실제 구매 비율입니다. 기대 정산액은 이 값에 좌우되므로 낙관적으로 잡지 마세요."
          right={
            <span className="rounded-md bg-amber-brand/15 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-brand">
              {pct(conversionRate, 1)}
            </span>
          }
        />
        <input
          type="range"
          min={0.5}
          max={8}
          step={0.1}
          value={conversionRate * 100}
          onChange={(e) => setConversionRate(Number(e.target.value) / 100)}
          className="rc-range mt-4 w-full"
          aria-label="전환율"
        />
        <div className="mt-1.5 flex justify-between text-xs text-mist-500">
          <span>0.5% 콜드 트래픽</span>
          <span>2% 일반적인 블로그/SNS</span>
          <span>8% 고관여 검색 유입</span>
        </div>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🔗"
          title="추천 제품 대량 제휴 링크 일괄 생성 (Bulk Exporter)"
          desc="블로그 포스팅, 카카오톡 공유, 유튜브 설명란, 인스타그램 프로필용으로 1클릭 복사하세요."
          right={
            <select
              value={primaryMall}
              onChange={(e) => setPrimaryMall(e.target.value as MallId)}
              className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-mist-200 outline-none"
            >
              {REGIONS.map((r) => (
                <optgroup key={r.id} label={`${r.flag} ${r.label}`}>
                  {MALLS.filter((m) => m.region === r.id).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.icon} {m.label}
                      {enabledMalls.includes(m.id) ? '' : ' (비활성)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          }
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="success"
            disabled={!rows.length || exporting}
            onClick={() =>
              void withLinks([primaryMall], 'blog', (resolve, tracked) =>
                copy(
                  toBlogHtml(
                    rows,
                    affiliateIds,
                    { styleName: style.name, spaceLabel: space.label, primaryMall },
                    resolve,
                  ),
                  '블로그 포스팅 HTML',
                  tracked ? ' (클릭 추적 링크 적용)' : '',
                ),
              )
            }
          >
            📋 블로그 포스팅용 복사
          </Button>
          <Button
            variant="primary"
            disabled={!rows.length || exporting}
            onClick={() =>
              void withLinks([primaryMall], 'kakao', (resolve, tracked) =>
                copy(
                  toKakaoText(rows, affiliateIds, { styleName: style.name, primaryMall }, resolve),
                  '카톡 공유 텍스트',
                  tracked ? ' (클릭 추적 링크 적용)' : '',
                ),
              )
            }
          >
            📋 카톡 공유용 복사
          </Button>
          <Button
            variant="outline"
            disabled={!rows.length || !enabledMalls.length || exporting}
            onClick={() =>
              void withLinks(enabledMalls, 'csv', (resolve, tracked) => {
                downloadText(
                  `roomcraft-affiliate-${Date.now()}.csv`,
                  toCsv(rows, affiliateIds, enabledMalls, resolve),
                  'text/csv',
                )
                showToast(
                  `활성 채널 ${enabledMalls.length}개 기준 CSV를 다운로드했습니다.${tracked ? ' (클릭 추적 적용)' : ''}`,
                )
              })
            }
          >
            ⤓ CSV 다운로드 ({enabledMalls.length}채널)
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-mist-500">
          {signedIn
            ? '내보내는 링크는 클릭 추적 링크(/r/…)로 발급되어, 아래 수익 대시보드에 클릭 수가 집계됩니다.'
            : '⚠ 비로그인 상태에서는 원본 딥링크로 내보내집니다. 클릭 수가 집계되지 않아 어떤 채널이 돈이 되는지 알 수 없습니다.'}
        </p>
        {!rows.length ? (
          <p className="mt-3 text-xs text-mist-500">무드보드에 가구를 먼저 담아주세요.</p>
        ) : (
          <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-ink-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-ink-900 text-mist-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">제품</th>
                  <th className="px-3 py-2 font-semibold">단가</th>
                  <th className="px-3 py-2 font-semibold">{mallById(primaryMall).label} 딥링크</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, qty }) => {
                  const link = buildDeeplink(primaryMall, product.searchTerm, affiliateIds)
                  return (
                    <tr key={product.sku} className="border-t border-ink-700">
                      <td className="max-w-[220px] truncate px-3 py-2 text-mist-200">
                        {product.name}
                        {qty > 1 ? ` ×${qty}` : ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-amber-brand">{usd(product.price)}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void copy(link, '딥링크')}
                          className="max-w-[300px] truncate text-left text-mist-400 underline decoration-ink-600 hover:text-amber-brand"
                          title={link}
                        >
                          {link}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="⚡"
          title="실시간 딥링크 즉시 생성기 (INSTANT MULTI-MALL SEARCH LINKER)"
          desc="카탈로그에 없는 제품도 이름만 입력하면 활성화된 전 채널 링크를 즉시 만들어 줍니다."
        />
        <div className="mt-4 flex gap-2">
          <input
            className={inputClass}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="가구/조명명 입력 (예: 부클레 라운드 소파, 아르떼미데 톨로메오 조명…)"
          />
          <Button variant="primary" disabled={!term.trim()} onClick={() => setTerm(term.trim())}>
            딥링크 생성
          </Button>
        </div>
        {term.trim() ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {enabledMalls.map(mallById).map((m) => {
              const link = buildDeeplink(m.id, term.trim(), affiliateIds)
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-mist-200">
                      {m.icon} {m.label}
                      {isMallLinked(m, affiliateIds) ? null : (
                        <span className="ml-1 font-normal text-amber-brand">· 추적 ID 없음</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-mist-500" title={link}>
                      {link}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="chip" onClick={() => void copy(link, `${m.label} 링크`)}>
                      복사
                    </Button>
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="grid h-7 w-7 place-items-center rounded-md border border-ink-700 text-xs text-mist-400 hover:text-amber-brand"
                    >
                      ↗
                    </a>
                  </div>
                </div>
              )
            })}
            {!enabledMalls.length ? (
              <p className="col-span-full text-xs text-mist-500">활성화된 채널이 없습니다.</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
