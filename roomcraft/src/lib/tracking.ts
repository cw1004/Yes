import type { AffiliateIds, MallId } from '../types'
import { buildDeeplink } from './affiliate'
import { api } from './api'
import type { ExportRow } from './exporters'

/**
 * 내보내기용 링크 해석기.
 *
 * 로그인 상태면 서버에서 추적 토큰을 발급받아 `/r/:id` 링크를 씁니다.
 * 비로그인이거나 서버가 없으면 원본 딥링크로 폴백합니다 —
 * 추적이 안 될 뿐, 내보내기 자체는 항상 동작해야 합니다.
 */
export type LinkResolver = (sku: string, mallId: MallId) => string

export function rawResolver(ids: AffiliateIds, searchTermOf: (sku: string) => string): LinkResolver {
  return (sku, mallId) => buildDeeplink(mallId, searchTermOf(sku), ids)
}

export interface TrackedLinks {
  resolver: LinkResolver
  /** 실제로 추적 링크가 발급됐는지 (UI 표기용) */
  tracked: boolean
  rejected: number
}

export async function resolveLinks({
  rows,
  mallIds,
  affiliateIds,
  source,
  // 서버가 게스트 세션을 자동으로 만들어 주므로 로그인 여부로 막지 않습니다.
  // 서버가 아예 없을 때(정적 데모)만 원본 딥링크로 폴백합니다.
  enabled = true,
}: {
  rows: ExportRow[]
  mallIds: MallId[]
  affiliateIds: AffiliateIds
  source: string
  enabled?: boolean
}): Promise<TrackedLinks> {
  const searchTermOf = (sku: string) =>
    rows.find((r) => r.product.sku === sku)?.product.searchTerm ?? sku
  const fallback = rawResolver(affiliateIds, searchTermOf)

  if (!enabled || !rows.length || !mallIds.length) {
    return { resolver: fallback, tracked: false, rejected: 0 }
  }

  const items = rows.flatMap(({ product }) =>
    mallIds.map((mallId) => ({
      sku: product.sku,
      mallId,
      url: buildDeeplink(mallId, product.searchTerm, affiliateIds),
      label: product.name,
    })),
  )

  try {
    // 서버가 완성된 URL 을 내려줍니다. 클라이언트가 주소를 조립하지 않습니다.
    const { links, rejected } = await api.mintLinks(items, source)
    return {
      tracked: Object.keys(links).length > 0,
      rejected: rejected.length,
      resolver: (sku, mallId) => links[`${sku}:${mallId}`] ?? fallback(sku, mallId),
    }
  } catch {
    // 발급 실패 시에도 내보내기는 되도록 원본 링크로 진행합니다.
    return { resolver: fallback, tracked: false, rejected: 0 }
  }
}
