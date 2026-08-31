import { useState } from 'react'
import { useActivePlanId, useCredits, useStudio } from '../../store/useStudio'
import { planById } from '../../data/plans'
import { Modal, Tabs } from '../ui/Modal'
import { Badge, Button } from '../ui/primitives'
import { AffiliateTab } from './AffiliateTab'
import { TemplateMarketTab } from './TemplateMarketTab'
import { ClientQuoteTab } from './ClientQuoteTab'
import { PlanTab } from './PlanTab'

type TabId = 'affiliate' | 'templates' | 'quote' | 'plan'

export function MonetizationModal() {
  const { modal, closeModal, openModal } = useStudio()
  const [tab, setTab] = useState<TabId>('affiliate')
  const { credits } = useCredits()
  const plan = planById(useActivePlanId())

  const open = modal === 'monetization' || modal === 'plans'
  const activeTab: TabId = modal === 'plans' ? 'plan' : tab

  return (
    <Modal
      open={open}
      onClose={closeModal}
      icon="💲"
      title={
        <span className="flex items-center gap-2">
          크리에이터 수익화 &amp; 정산 센터
          <Badge tone="emerald">{plan.name}</Badge>
        </span>
      }
      subtitle="제휴 쇼핑몰 수수료, 디자인 템플릿 마켓 판매, 고객 인테리어 견적 마진으로 수익을 창출하세요."
      headerRight={
        <Button size="sm" variant="primary" onClick={() => openModal('plans')}>
          ♛ 플랜 &amp; 크레딧
        </Button>
      }
      width="max-w-6xl"
    >
      <Tabs<TabId>
        active={activeTab}
        onChange={(id) => {
          setTab(id)
          openModal('monetization')
        }}
        tabs={[
          { id: 'affiliate', label: '🛍 1. 제휴 커머스', badge: <Badge tone="emerald">3~10%</Badge> },
          { id: 'templates', label: '🏬 2. 템플릿 마켓 판매', badge: <Badge tone="amber">{`${Math.round(plan.payoutRate * 100)}% 정산`}</Badge> },
          { id: 'quote', label: '📄 3. 클라이언트 납품 견적서' },
          { id: 'plan', label: '♛ 4. 구독 플랜 관리', badge: <Badge>{`${credits} 크레딧`}</Badge> },
        ]}
      />

      <div className="max-h-[70vh] overflow-y-auto bg-ink-900 p-4">
        {activeTab === 'affiliate' ? (
          <AffiliateTab />
        ) : activeTab === 'templates' ? (
          <TemplateMarketTab />
        ) : activeTab === 'quote' ? (
          <ClientQuoteTab />
        ) : (
          <PlanTab />
        )}
      </div>
    </Modal>
  )
}
