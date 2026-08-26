import { useMemo, useState } from 'react'
import { useMoodboardTotals, useStudio } from '../../store/useStudio'
import { MALLS, buildDeeplink, estimateCommission } from '../../lib/affiliate'
import { copyToClipboard, downloadText, toBlogHtml, toCsv, toKakaoText } from '../../lib/exporters'
import { styleById } from '../../data/styles'
import { spaceById } from '../../data/spaces'
import { pct, usd } from '../../lib/format'
import { Button, Field, SectionTitle, Stat, inputClass } from '../ui/primitives'
import type { MallId } from '../../types'

export function AffiliateTab() {
  const { affiliateIds, styleId, spaceId, setAffiliateIds, showToast } = useStudio()
  const { rows, total, count } = useMoodboardTotals()
  const [primaryMall, setPrimaryMall] = useState<MallId>('coupang')
  const [term, setTerm] = useState('')
  const [saved, setSaved] = useState(false)

  const est = useMemo(() => estimateCommission(total), [total])
  const style = styleById(styleId)
  const space = spaceById(spaceId)

  const linkedMalls = MALLS.filter((m) => {
    const v = {
      coupang: affiliateIds.coupangSubId,
      ohouse: affiliateIds.ohousePartnerId,
      amazon: affiliateIds.amazonTag,
      aliexpress: affiliateIds.aliexpressKey,
    }[m.id]
    return Boolean(v.trim())
  })

  const copy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text)
    showToast(ok ? `${label}을(를) 클립보드에 복사했습니다.` : '복사에 실패했습니다. 직접 선택해 주세요.')
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="배치된 총 가구 견적" value={usd(total)} sub={`총 ${count}개 가구/소품 스타일링됨`} />
        <Stat
          label="예상 제휴 판매 수수료"
          value={`+${usd(est.expected, { cents: true })}`}
          sub={`쇼핑몰별 평균 ${pct(est.avgRate, 1)} 커미션 적립`}
          tone="emerald"
        />
        <Stat
          label="연동된 파트너 커머스"
          value={linkedMalls.length ? linkedMalls.map((m) => m.label).join(' · ') : '미연동'}
          sub={linkedMalls.length ? '✓ 자동 딥링크 및 SubID 추적 활성화' : '아래에서 파트너 ID를 입력하세요'}
          tone={linkedMalls.length ? 'emerald' : 'neutral'}
        />
      </div>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🛡"
          title="내 제휴 파트너스 ID 설정 (MY AFFILIATE PARTNER IDS)"
          desc="각 제휴 프로그램 콘솔에서 발급받은 추적 ID를 입력하면 모든 링크에 자동으로 삽입됩니다."
          right={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setSaved(true)
                showToast('제휴 설정을 저장했습니다. (브라우저에 로컬 저장)')
                setTimeout(() => setSaved(false), 1800)
              }}
            >
              ✦ {saved ? '저장됨 ✓' : '설정 저장'}
            </Button>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="🛒 쿠팡 파트너스 SubID">
            <input
              className={inputClass}
              value={affiliateIds.coupangSubId}
              placeholder="AF_ROOMCRAFT_01"
              onChange={(e) => setAffiliateIds({ coupangSubId: e.target.value })}
            />
          </Field>
          <Field label="🏠 오늘의집 파트너 ID">
            <input
              className={inputClass}
              value={affiliateIds.ohousePartnerId}
              placeholder="OH_ROOMCRAFT_77"
              onChange={(e) => setAffiliateIds({ ohousePartnerId: e.target.value })}
            />
          </Field>
          <Field label="📦 Amazon Associates Tag">
            <input
              className={inputClass}
              value={affiliateIds.amazonTag}
              placeholder="roomcraft-20"
              onChange={(e) => setAffiliateIds({ amazonTag: e.target.value })}
            />
          </Field>
          <Field label="⚡ AliExpress Portals Key">
            <input
              className={inputClass}
              value={affiliateIds.aliexpressKey}
              placeholder="roomcraft_global"
              onChange={(e) => setAffiliateIds({ aliexpressKey: e.target.value })}
            />
          </Field>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-mist-500">
          ⚠ 제휴 링크가 포함된 콘텐츠에는 각 프로그램 약관과 공정거래위원회 「추천·보증 등에 관한 표시·광고 심사지침」에
          따라 <strong className="text-mist-300">대가성 문구를 반드시 표기</strong>해야 합니다. 아래 내보내기 결과에는
          문구가 자동으로 포함됩니다.
        </p>
      </section>

      <section className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <SectionTitle
          icon="🔗"
          title="현재 룸 배치 가구 대량 제휴 링크 일괄 생성 (Bulk Exporter)"
          desc="블로그 포스팅, 카카오톡 공유, 유튜브 설명란, 인스타그램 프로필용으로 1클릭 복사하세요."
          right={
            <select
              value={primaryMall}
              onChange={(e) => setPrimaryMall(e.target.value as MallId)}
              className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-mist-200 outline-none"
            >
              {MALLS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.icon} {m.label}
                </option>
              ))}
            </select>
          }
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="success"
            disabled={!rows.length}
            onClick={() =>
              void copy(
                toBlogHtml(rows, affiliateIds, {
                  styleName: style.name,
                  spaceLabel: space.label,
                  primaryMall,
                }),
                '블로그 포스팅 HTML',
              )
            }
          >
            📋 블로그 포스팅용 복사
          </Button>
          <Button
            variant="primary"
            disabled={!rows.length}
            onClick={() =>
              void copy(toKakaoText(rows, affiliateIds, { styleName: style.name, primaryMall }), '카톡 공유 텍스트')
            }
          >
            📋 카톡 공유용 복사
          </Button>
          <Button
            variant="outline"
            disabled={!rows.length}
            onClick={() => {
              downloadText(`roomcraft-affiliate-${Date.now()}.csv`, toCsv(rows, affiliateIds), 'text/csv')
              showToast('CSV 파일을 다운로드했습니다.')
            }}
          >
            ⤓ CSV 다운로드
          </Button>
        </div>
        {!rows.length ? (
          <p className="mt-3 text-xs text-mist-500">무드보드에 가구를 먼저 담아주세요.</p>
        ) : (
          <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-ink-700">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-ink-900 text-mist-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">제품</th>
                  <th className="px-3 py-2 font-semibold">단가</th>
                  <th className="px-3 py-2 font-semibold">딥링크</th>
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
          desc="카탈로그에 없는 제품도 이름만 입력하면 전 채널 검색 링크를 즉시 만들어 줍니다."
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
            {MALLS.map((m) => {
              const link = buildDeeplink(m.id, term.trim(), affiliateIds)
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-mist-200">
                      {m.icon} {m.label}
                    </p>
                    <p className="truncate text-[10px] text-mist-500" title={link}>
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
                      className="grid h-7 w-7 place-items-center rounded-md border border-ink-700 text-[11px] text-mist-400 hover:text-amber-brand"
                    >
                      ↗
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}
