import { useState } from 'react'
import { useCredits, useStudio } from '../store/useStudio'
import { STYLES, STYLE_FAMILIES, styleById, type StyleFamilyFilter } from '../data/styles'
import { CREDIT_COST } from '../data/plans'
import { intensityLabel, intensityDirective } from '../lib/prompt'
import { Badge, Button, Card, SectionTitle, inputClass } from './ui/primitives'

const PRESETS = [
  { label: '은은하게', value: 25 },
  { label: '표준', value: 50 },
  { label: '강하게', value: 75 },
  { label: '전체', value: 100 },
]

export function StyleSelector() {
  const { styleId, intensity, isRendering, sourceImage, setStyle, setIntensity, addExtra, generate } = useStudio()
  const { credits } = useCredits()
  const [family, setFamily] = useState<StyleFamilyFilter>('all')
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')

  const style = styleById(styleId)
  const visible = family === 'all' ? STYLES : STYLES.filter((s) => s.family === family)
  const canGenerate = Boolean(sourceImage) && !isRendering

  return (
    <Card className="p-4">
      <SectionTitle
        icon="②"
        title="인테리어 디자인 스타일 선택"
        desc="전문 디자이너 아키타입을 선택하거나 나만의 맞춤 AI 프롬프트를 입력하세요."
        right={
          <div className="flex flex-wrap items-center gap-1">
            {STYLE_FAMILIES.map((f) => (
              <button
                key={f.id}
                onClick={() => setFamily(f.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                  family === f.id ? 'bg-ink-700 text-mist-200' : 'text-mist-400 hover:text-mist-200'
                }`}
              >
                {f.label}
              </button>
            ))}
            <Button size="sm" variant="chip" onClick={() => setCustomOpen((v) => !v)}>
              ＋ 직접 프롬프트 입력
            </Button>
          </div>
        }
      />

      {customOpen ? (
        <div className="mt-3 flex gap-2">
          <input
            className={inputClass}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder='예: "천장은 서까래 노출, 벽은 라임워시, 조명은 2200K로"'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) {
                addExtra(custom.trim())
                setCustom('')
                setCustomOpen(false)
              }
            }}
          />
          <Button
            variant="primary"
            onClick={() => {
              if (custom.trim()) {
                addExtra(custom.trim())
                setCustom('')
                setCustomOpen(false)
              }
            }}
          >
            추가
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((s) => {
          const on = s.id === styleId
          return (
            <button
              key={s.id}
              onClick={() => setStyle(s.id)}
              className={`overflow-hidden rounded-xl border text-left transition ${
                on
                  ? 'border-amber-brand ring-1 ring-amber-brand/40'
                  : 'border-ink-700 hover:border-ink-500'
              }`}
            >
              <div className="relative h-32" style={{ background: s.previewGradient }}>
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold capitalize text-mist-200">
                  {s.family}
                </span>
                {on ? (
                  <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-amber-brand text-xs text-ink-950">
                    ✓
                  </span>
                ) : null}
                <div className="absolute bottom-2 left-2 flex gap-1">
                  {s.palette.map((c) => (
                    <span
                      key={c}
                      className="h-3 w-3 rounded-full ring-1 ring-black/30"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="bg-ink-850 p-3">
                <h4 className="text-[13px] font-bold leading-snug text-mist-200">{s.name}</h4>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-mist-400">{s.tagline}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.signatureItems.map((i) => (
                    <span key={i} className="rounded-md bg-ink-800 px-2 py-0.5 text-[10px] text-mist-400">
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-brand/15 text-amber-brand">
              ⇅
            </span>
            <div>
              <p className="text-sm font-bold text-mist-200">
                인테리어 변환 강도 조절{' '}
                <span className="font-normal text-mist-500">(자연스러운 조화 vs 전면 리모델링)</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="violet">{intensityLabel(intensity)}</Badge>
            <span className="rounded-md bg-amber-brand/15 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-brand">
              {intensity}%
            </span>
          </div>
        </div>

        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="rc-range mt-4 w-full"
          aria-label="변환 강도"
        />
        <div className="mt-1.5 flex justify-between text-[10px] text-mist-500">
          <span>10% 은은한 조화</span>
          <span>50% 균형 잡힌 변화</span>
          <span>100% 완전 리모델링</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-[11px] italic text-mist-400">“{intensityDirective(intensity)}”</p>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setIntensity(p.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                  intensity === p.value ? 'bg-amber-brand text-ink-950' : 'bg-ink-800 text-mist-300 hover:bg-ink-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-mist-400">
          선택된 스타일: <span className="font-bold text-amber-brand">{style.name}</span>
          <span className="mx-2 text-ink-600">•</span>
          {style.lighting}
        </p>
        <Button variant="primary" size="lg" disabled={!canGenerate} onClick={() => void generate()}>
          {isRendering ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-950/40 border-t-ink-950" />
              생성 중…
            </>
          ) : (
            <>✦ {style.name} 스타일 적용하기 ({intensity}%)</>
          )}
        </Button>
      </div>
      <p className="mt-2 text-right text-[11px] text-mist-500">
        렌더 1회 = {CREDIT_COST.render} 크레딧 · 잔여 {credits} 크레딧
        {!sourceImage ? ' · 사진을 먼저 업로드하세요' : ''}
      </p>
    </Card>
  )
}
