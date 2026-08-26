import { useStudio } from '../store/useStudio'
import { STYLES, styleById } from '../data/styles'
import { spaceById } from '../data/spaces'
import { SpaceUploader } from './SpaceUploader'
import { StyleSelector } from './StyleSelector'
import { BeforeAfter } from './BeforeAfter'
import { TagManager } from './TagManager'
import { StagingBoard } from './StagingBoard'
import { Badge, Button, Card } from './ui/primitives'
import type { WorkspaceTab } from '../store/useStudio'

const TABS: { id: WorkspaceTab; label: string; icon: string }[] = [
  { id: 'makeover', label: 'Before / After Makeover', icon: '👁' },
  { id: 'staging', label: '2D/3D Furniture Staging', icon: '◎' },
  { id: 'spaces', label: 'Spaces & Upload', icon: '🖼' },
]

export function CanvasStudio() {
  const {
    projectName,
    spaceId,
    styleId,
    workspace,
    fullscreen,
    sourceImage,
    isRendering,
    renderError,
    setWorkspace,
    setStyle,
    toggleFullscreen,
    generate,
  } = useStudio()

  const space = spaceById(spaceId)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-amber-brand">★</span>
              <h2 className="text-lg font-bold text-mist-200">{projectName}</h2>
              <Badge>{space.labelEn} · 34m²</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STYLES.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    s.id === styleId
                      ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
                      : 'border-ink-700 text-mist-400 hover:text-mist-200'
                  }`}
                >
                  ✦ {s.name}
                </button>
              ))}
              <span className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-mist-400">
                {STYLES.length} Styles ⊞
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button variant="primary" size="sm" onClick={() => void generate()} disabled={isRendering || !sourceImage}>
              ✧ Re-Generate Makeover
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen}>
              ▤ {fullscreen ? 'Standard View' : 'Expanded View'}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-3">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setWorkspace(t.id)}
                className={`flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-3 text-xs font-semibold transition ${
                  workspace === t.id
                    ? 'border-amber-brand text-amber-brand'
                    : 'border-transparent text-mist-400 hover:text-mist-200'
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          <span className="pr-2 text-[11px] text-mist-500">
            {fullscreen ? 'Expanded Canvas Mode' : 'Standard Canvas'}
          </span>
        </div>

        <div className="p-4">
          {workspace === 'spaces' ? (
            <div className="space-y-4">
              <SpaceUploader />
              <StyleSelector />
            </div>
          ) : workspace === 'staging' ? (
            <StagingBoard />
          ) : (
            <MakeoverView />
          )}
        </div>
      </Card>

      {renderError ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {renderError}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Before/After 뷰.
 *
 * CanvasStudio 안에 중첩 정의하면 렌더마다 컴포넌트 identity 가 새로 생겨
 * React 가 하위 트리를 통째로 언마운트/재마운트합니다. 그러면 드래그 중인
 * 포인터 캡처와 비교 슬라이더 상태가 스토어 갱신마다 날아갑니다.
 * 반드시 최상위 컴포넌트로 둡니다.
 */
function MakeoverView() {
  const { sourceImage, render, isRendering, styleId, fullscreen, toggleFullscreen, showToast } = useStudio()
  const style = styleById(styleId)

  if (!sourceImage) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-ink-600 bg-ink-900 p-8 text-center">
          <div className="text-4xl">🏠</div>
          <p className="mt-3 text-sm font-semibold text-mist-200">아직 업로드된 공간 사진이 없습니다</p>
          <p className="mt-1 text-xs text-mist-400">
            아래에서 사진을 올리고 스타일을 선택하면 Before/After 비교가 여기에 표시됩니다.
          </p>
        </div>
        <SpaceUploader />
        <StyleSelector />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-mist-200">
            <span className="text-amber-brand">✦</span>
            {style.name} Makeover
            {fullscreen ? ' — Expanded Fullscreen Studio' : ''}
          </h3>
          <p className="mt-1 text-xs text-mist-400">
            고해상도로 텍스처, 앰비언트 조명, 가구 배치를 확인하세요.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!render}
            onClick={() => {
              if (!render) return
              const a = document.createElement('a')
              a.href = render.imageUrl
              a.download = `roomcraft-${style.id}-${render.id}.jpg`
              a.click()
              showToast('렌더 이미지를 저장했습니다.')
            }}
          >
            ⤓ Save
          </Button>
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            ⤢ {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {isRendering ? (
        <div className="rc-shimmer grid aspect-[16/10] w-full place-items-center rounded-xl border border-ink-700">
          <div className="text-center">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-amber-brand" />
            <p className="mt-3 text-sm font-semibold text-mist-300">{style.name} 렌더링 중…</p>
            <p className="mt-1 text-xs text-mist-500">조명 · 재질 · 가구 배치를 계산하고 있습니다</p>
          </div>
        </div>
      ) : render ? (
        <>
          <BeforeAfter
            before={sourceImage}
            after={render.imageUrl}
            styleName={style.name}
            palette={style.palette}
          />
          <TagManager />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-mist-400">
            <Badge tone={render.provider === 'server' ? 'emerald' : 'neutral'}>
              {render.provider === 'server' ? 'AI 렌더' : 'MOCK 프리뷰'}
            </Badge>
            <span>스타일 일치도 {render.matchScore}%</span>
            <span className="text-ink-600">•</span>
            <span>강도 {render.intensity}%</span>
            {render.notes.map((n) => (
              <span key={n} className="text-mist-500">
                · {n}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="grid aspect-[16/10] w-full place-items-center rounded-xl border border-dashed border-ink-600 bg-ink-900">
          <div className="text-center">
            <img
              src={sourceImage}
              alt="원본"
              className="mx-auto max-h-64 rounded-lg opacity-60"
            />
            <p className="mt-4 text-sm text-mist-300">
              아직 렌더가 없습니다 — 스타일을 고르고 <span className="text-amber-brand">적용하기</span>를 누르세요.
            </p>
          </div>
        </div>
      )}

      <StyleSelector />
    </div>
  )
}
