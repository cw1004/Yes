import { useMoodboardTotals, useStudio, type PanelTab } from '../store/useStudio'
import { DesignerChat } from './DesignerChat'
import { SpecSheet } from './SpecSheet'
import { EarningsPanel } from './EarningsPanel'

export function SidePanel() {
  const { panel, setPanel, openModal } = useStudio()
  const { count } = useMoodboardTotals()

  const tabs: { id: PanelTab; label: string; icon: string }[] = [
    { id: 'designer', label: 'AI Designer', icon: '💬' },
    { id: 'spec', label: `Spec Sheet (${count})`, icon: '🗂' },
    { id: 'earnings', label: 'Earnings', icon: '💲' },
  ]

  return (
    <aside className="flex h-[calc(100vh-140px)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-line-soft bg-ink-850">
      <div className="flex items-center justify-between border-b border-line-soft px-2">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setPanel(t.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold transition ${
                panel === t.id
                  ? 'border-amber-brand text-amber-brand'
                  : 'border-transparent text-mist-400 hover:text-mist-200'
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => openModal('moodboard')}
          className="mr-1 rounded-lg px-2.5 py-2 text-xs text-mist-300 transition hover:bg-ink-800 hover:text-amber-brand"
        >
          Full Cart →
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {panel === 'designer' ? <DesignerChat /> : panel === 'spec' ? <SpecSheet /> : <EarningsPanel />}
      </div>
    </aside>
  )
}
