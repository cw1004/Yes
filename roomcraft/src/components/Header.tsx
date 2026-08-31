import { useCredits, useMoodboardTotals, useStudio } from '../store/useStudio'
import { useAuth } from '../store/useAuth'
import { SPACES, spaceById } from '../data/spaces'
import { styleById } from '../data/styles'
import { planById } from '../data/plans'
import { usd } from '../lib/format'
import { Badge, Button } from './ui/primitives'
import { TextSizeControl } from './TextSizeControl'
import { ThemeControl } from './ThemeControl'
import type { SpaceKind } from '../types'

function HeaderCell({
  children,
  onClick,
  active = false,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  title?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-xs transition ${
        active
          ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
          : 'border-line-soft bg-ink-850 text-mist-300'
      } ${onClick ? 'hover:border-amber-brand/50 hover:text-amber-brand' : ''}`}
    >
      {children}
    </Tag>
  )
}

export function Header() {
  const {
    spaceId,
    styleId,
    planId,
    fullscreen,
    setSpace,
    openModal,
    toggleFullscreen,
    showToast,
  } = useStudio()
  const { count, total } = useMoodboardTotals()
  const { credits, isServer } = useCredits()
  const user = useAuth((s) => s.user)
  const serverAvailable = useAuth((s) => s.serverAvailable)

  const space = spaceById(spaceId)
  const style = styleById(styleId)
  // 로그인 상태에서는 서버가 알려준 플랜이 진실입니다.
  const plan = planById(user?.planId ?? planId)

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-line-soft bg-ink-900/95 px-4 py-3 backdrop-blur">
      <div className="flex min-w-[210px] items-center gap-3 pr-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-brand to-amber-deep text-lg text-on-brand">
          ✦
        </span>
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-extrabold tracking-tight text-mist-200">RoomCraft</span>
            <Badge tone="amber">AI</Badge>
          </div>
          <p className="text-xs text-mist-500">AI 인테리어 리모델링 &amp; 쇼퍼블 공간 디자인 스튜디오</p>
        </div>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        <HeaderCell title="작업할 공간 유형">
          <span className="text-mist-500">🏠 공간:</span>
          <select
            value={spaceId}
            onChange={(e) => setSpace(e.target.value as SpaceKind)}
            className="cursor-pointer rounded-md bg-transparent font-semibold text-mist-200 outline-none"
          >
            {SPACES.map((s) => (
              <option key={s.id} value={s.id} className="bg-ink-900">
                {s.labelEn}
              </option>
            ))}
          </select>
          <Badge tone="amber">{space.label}</Badge>
        </HeaderCell>

        <HeaderCell title="현재 선택된 디자인 스타일">
          <span className="h-2 w-2 rounded-full" style={{ background: style.palette[0] }} />
          <span className="font-semibold text-mist-200">{style.name}</span>
        </HeaderCell>

        <HeaderCell onClick={toggleFullscreen} active={fullscreen} title="캔버스를 넓게 봅니다">
          ▥ 확장형 뷰
        </HeaderCell>

        <HeaderCell
          onClick={() => showToast('프로젝트를 브라우저에 저장했습니다. (무드보드·정산 설정은 자동 저장)')}
          title="무드보드/정산 설정은 브라우저에 자동 저장됩니다"
        >
          ☁ 클라우드 저장
        </HeaderCell>

        <HeaderCell
          onClick={() => openModal('plans')}
          title={isServer ? '서버에 저장된 크레딧 잔액' : '로컬 데모 크레딧 (로그인하면 서버에 저장됩니다)'}
        >
          <span className="text-amber-brand">♛</span>
          <span className="font-bold tabular-nums text-mist-200">{credits}</span>
          <span className="text-mist-500">크레딧</span>
          <Badge tone="amber">{plan.name.toUpperCase()}</Badge>
          {!isServer ? <Badge>로컬</Badge> : null}
        </HeaderCell>
      </div>

      <div className="flex items-center gap-2">
        <ThemeControl />
        <TextSizeControl />
        <Button variant="success" size="sm" onClick={() => openModal('monetization')}>
          💲 수익 허브 &amp; 출금
        </Button>
        <HeaderCell onClick={() => openModal('moodboard')} title="AI 글로벌 제품 소싱">
          🌐 AI 제품 소싱
        </HeaderCell>
        <HeaderCell onClick={() => openModal('moodboard')} active={count > 0}>
          🗂 무드보드
          <Badge tone={count > 0 ? 'amber' : 'neutral'}>{count}</Badge>
          <span className="font-semibold tabular-nums">{usd(total)}</span>
        </HeaderCell>
        <HeaderCell onClick={() => openModal('moodboard')}>⤓ 내보내기</HeaderCell>
        {user ? (
          <HeaderCell onClick={() => openModal('account')} title={`${user.email} · 클릭하여 계정 관리`}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-amber-brand to-amber-deep text-xs text-on-brand">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-[120px] truncate font-semibold text-mist-200">{user.displayName}</span>
          </HeaderCell>
        ) : (
          <Button
            size="sm"
            variant={serverAvailable ? 'outline' : 'ghost'}
            onClick={() => openModal('auth')}
            title={serverAvailable ? '로그인 / 회원가입' : '서버가 연결되지 않아 로컬 데모로 동작합니다'}
          >
            🔐 로그인
          </Button>
        )}
      </div>
    </header>
  )
}
