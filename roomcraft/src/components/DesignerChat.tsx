import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStudio } from '../store/useStudio'
import { productBySku } from '../data/catalog'
import { styleById } from '../data/styles'
import { usd, relativeTime } from '../lib/format'
import { Badge, Button } from './ui/primitives'
import { ProductThumb } from './ProductThumb'

const QUICK = [
  '구조는 유지하고 러그를 네이비 울 텍스처로 변경해줘',
  '독서용 아치형 브라스 플로어 스탠드를 추가해줘',
  '벽면 액자를 미니멀 갤러리월로 바꿔줘',
  '예산 300만원 이하로 대체 제품을 찾아줘',
]

/** **굵게** 와 줄바꿈만 지원하는 경량 렌더러 (외부 마크다운 의존성 없이) */
function renderText(text: string): ReactNode[] {
  return text.split('\n').map((line, li) => (
    <span key={li} className="block min-h-[1px]">
      {line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, pi) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={pi} className="font-bold text-mist-200">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
          return (
            <em key={pi} className="text-mist-500">
              {part.slice(1, -1)}
            </em>
          )
        }
        return <span key={pi}>{part}</span>
      })}
    </span>
  ))
}

export function DesignerChat() {
  const { chat, isChatting, styleId, sendChat, addToMoodboard } = useStudio()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const style = styleById(styleId)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.length, isChatting])

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void sendChat(text)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {chat.map((m) => (
          <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm ${
                m.role === 'assistant' ? 'bg-amber-brand/15 text-amber-brand' : 'bg-ink-700'
              }`}
            >
              {m.role === 'assistant' ? '🪄' : '🙂'}
            </span>
            <div className={`min-w-0 max-w-[85%] ${m.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'assistant'
                    ? 'border border-line-soft bg-ink-850 text-mist-300'
                    : 'bg-amber-brand/90 text-on-brand'
                }`}
              >
                {renderText(m.content)}
              </div>

              {m.recommendations?.length ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-xs font-semibold text-mist-300">
                      🗂 추천 인테리어 가구 &amp; 조명 ({m.recommendations.length}개)
                    </span>
                    <Badge tone="emerald">98% 스타일 일치</Badge>
                  </div>
                  {m.recommendations.map((sku) => {
                    const p = productBySku(sku)
                    if (!p) return null
                    return (
                      <div
                        key={sku}
                        className="rounded-lg border border-line-soft bg-ink-900 p-2.5 text-left"
                      >
                        <div className="flex items-start gap-2.5">
                          <ProductThumb product={p} className="mt-0.5 h-9 w-9" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-mist-200">{p.name}</p>
                            <p className="mt-0.5 text-xs">
                              <span className="font-bold text-amber-brand">{usd(p.price)}</span>
                              <span className="text-mist-500"> · {p.vendor}</span>
                              <span className="ml-1 text-amber-brand">{'★'.repeat(p.rating)}</span>
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-mist-400">
                              스타일 추천 이유: {p.reason}
                            </p>
                            <div className="mt-2 flex gap-1.5">
                              <a
                                href={p.officialUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="rounded-md border border-line px-2.5 py-2 text-xs text-mist-300 hover:border-amber-brand/50 hover:text-amber-brand"
                              >
                                {p.brand} ↗
                              </a>
                              <button
                                onClick={() => addToMoodboard(sku)}
                                className="rounded-md border border-emerald-brand/40 bg-emerald-brand/10 px-2.5 py-2 text-xs font-semibold text-emerald-brand hover:bg-emerald-brand/20"
                              >
                                ✓ 무드보드에 담기
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              <p className="mt-1 px-1 text-xs text-mist-500">{relativeTime(m.createdAt)}</p>
            </div>
          </div>
        ))}

        {isChatting ? (
          <div className="flex gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-brand/15 text-amber-brand">🪄</span>
            <div className="flex items-center gap-1 rounded-xl border border-line-soft bg-ink-850 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-mist-400"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line-soft p-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
          <span className="shrink-0 text-xs text-mist-500">빠른 질문/요청:</span>
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => void sendChat(q)}
              disabled={isChatting}
              className="shrink-0 rounded-lg border border-line-soft bg-ink-850 px-2.5 py-1.5 text-xs text-mist-300 transition hover:border-amber-brand/50 hover:text-amber-brand disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={`인테리어 디자이너 아치에게 질문하세요 (예: "${style.signatureItems[0]} 추천해줘")`}
            className="w-full rounded-lg border border-line-soft bg-ink-900 px-3 py-2.5 text-sm text-mist-200 outline-none placeholder:text-ink-500 focus:border-amber-brand/60"
          />
          <Button variant="primary" onClick={submit} disabled={isChatting || !draft.trim()}>
            ➤ 전송
          </Button>
        </div>
      </div>
    </div>
  )
}
