import { useMoodboardTotals, useStudio } from '../../store/useStudio'
import { computeQuote } from '../../lib/quote'
import { copyToClipboard, downloadText } from '../../lib/exporters'
import { styleById } from '../../data/styles'
import { spaceById } from '../../data/spaces'
import { krw, usd } from '../../lib/format'
import { Button, Field, SectionTitle, Stat, inputClass } from '../ui/primitives'

export function ClientQuoteTab() {
  const { quote, setQuote, styleId, spaceId, projectName, showToast } = useStudio()
  const { rows } = useMoodboardTotals()
  const q = computeQuote(rows, quote)
  const style = styleById(styleId)
  const space = spaceById(spaceId)

  const asText = () =>
    [
      `[견적서] ${quote.projectName || projectName}`,
      `고객: ${quote.clientName || '-'}`,
      `공간/스타일: ${space.label} / ${style.name}`,
      '',
      ...q.lines.map(
        (l) =>
          `- ${l.product.name} × ${l.qty}  ${usd(l.unitBilled)} → ${usd(l.lineTotal)}`,
      ),
      '',
      `가구 소계: ${usd(q.furnitureBilled)}`,
      `디자인 피: ${usd(q.designFee)}`,
      `부가세(${quote.vatRate}%): ${usd(q.vat)}`,
      `합계: ${usd(q.grandTotal)} (${krw(q.grandTotal)})`,
      '',
      quote.notes,
    ].join('\n')

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="가구 원가" value={usd(q.furnitureCost)} sub={`${rows.length}개 품목`} />
        <Stat label="가구 청구액" value={usd(q.furnitureBilled)} sub={`마진율 ${quote.marginRate}%`} />
        <Stat label="총 청구액 (VAT 포함)" value={usd(q.grandTotal)} sub={krw(q.grandTotal)} tone="amber" />
        <Stat label="디자이너 순이익" value={usd(q.netProfit)} sub="가구 마진 + 디자인 피" tone="emerald" />
      </div>

      <section className="rounded-xl border border-line-soft bg-ink-850 p-4">
        <SectionTitle icon="📄" title="견적 조건" desc="고객 정보와 마진 정책을 설정하면 아래 견적서가 즉시 갱신됩니다." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="고객명">
            <input
              className={inputClass}
              value={quote.clientName}
              onChange={(e) => setQuote({ clientName: e.target.value })}
              placeholder="김OO 고객님"
            />
          </Field>
          <Field label="프로젝트명">
            <input
              className={inputClass}
              value={quote.projectName}
              onChange={(e) => setQuote({ projectName: e.target.value })}
              placeholder={projectName}
            />
          </Field>
          <Field label="가구 마진율 (%)">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={100}
              value={quote.marginRate}
              onChange={(e) => setQuote({ marginRate: Number(e.target.value) })}
            />
          </Field>
          <Field label="디자인 피 (USD)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={quote.designFeeUsd}
              onChange={(e) => setQuote({ designFeeUsd: Number(e.target.value) })}
            />
          </Field>
          <Field label="부가세율 (%)">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={30}
              value={quote.vatRate}
              onChange={(e) => setQuote({ vatRate: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="비고">
          <textarea
            className={`${inputClass} mt-3 min-h-[64px] resize-y`}
            value={quote.notes}
            onChange={(e) => setQuote({ notes: e.target.value })}
          />
        </Field>
      </section>

      <section className="rounded-xl border border-line-soft bg-ink-850 p-4">
        <SectionTitle
          icon="🧾"
          title="납품 견적서 미리보기"
          right={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!rows.length}
                onClick={async () => {
                  const ok = await copyToClipboard(asText())
                  showToast(ok ? '견적서를 복사했습니다.' : '복사에 실패했습니다.')
                }}
              >
                📋 텍스트 복사
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!rows.length}
                onClick={() => {
                  downloadText(`quote-${Date.now()}.txt`, asText())
                  showToast('견적서를 저장했습니다.')
                }}
              >
                ⤓ 다운로드
              </Button>
            </div>
          }
        />

        {rows.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line-soft">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-ink-900 text-mist-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">품목</th>
                  <th className="px-3 py-2 font-semibold">수량</th>
                  <th className="px-3 py-2 font-semibold">원가</th>
                  <th className="px-3 py-2 font-semibold">청구 단가</th>
                  <th className="px-3 py-2 text-right font-semibold">금액</th>
                </tr>
              </thead>
              <tbody>
                {q.lines.map((l) => (
                  <tr key={l.product.sku} className="border-t border-line-soft">
                    <td className="max-w-[260px] truncate px-3 py-2 text-mist-200">{l.product.name}</td>
                    <td className="px-3 py-2 text-mist-400">{l.qty}</td>
                    <td className="px-3 py-2 text-mist-500">{usd(l.unitCost)}</td>
                    <td className="px-3 py-2 text-mist-300">{usd(l.unitBilled)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-mist-200">{usd(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-ink-900">
                <tr className="border-t border-line-soft">
                  <td colSpan={4} className="px-3 py-2 text-right text-mist-400">
                    가구 소계
                  </td>
                  <td className="px-3 py-2 text-right text-mist-200">{usd(q.furnitureBilled)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-mist-400">
                    디자인 피
                  </td>
                  <td className="px-3 py-2 text-right text-mist-200">{usd(q.designFee)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-mist-400">
                    부가세 ({quote.vatRate}%)
                  </td>
                  <td className="px-3 py-2 text-right text-mist-200">{usd(q.vat)}</td>
                </tr>
                <tr className="border-t border-line-soft">
                  <td colSpan={4} className="px-3 py-2.5 text-right font-bold text-mist-200">
                    합계
                  </td>
                  <td className="px-3 py-2.5 text-right text-base font-bold text-amber-brand">
                    {usd(q.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-center text-xs text-mist-500">
            무드보드에 가구를 담으면 견적서가 자동으로 작성됩니다.
          </p>
        )}
      </section>
    </div>
  )
}
