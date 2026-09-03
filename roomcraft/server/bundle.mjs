// Picking the six products that ride on one video.
//
// Division of labour, on purpose:
//   scoring.mjs  owns every number that touches money (commission, conversion,
//                EPC, the click ladder). Arithmetic, reproducible, auditable.
//   this file    owns the judgements a model is actually good at — does this
//                set read as one room, which item should open the video, what
//                is the hook line, what should the landing page say.
//
// The model never returns a rate, a price, or an expected revenue. If it did,
// a hallucinated number would silently drive a spending decision.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { MODEL, BUNDLE_SIZE, ASSUMPTIONS, hasAnthropicKey } from './config.mjs';
import { bundleValue, ladderCheck, productEpc } from './scoring.mjs';

const SelectionSchema = z.object({
  slots: z
    .array(
      z.object({
        id: z.string().describe('후보 목록에 있는 제품 id'),
        role: z
          .enum(['hero', 'anchor', 'entry', 'filler'])
          .describe('hero=영상을 여는 주인공, anchor=가장 비싼 기준점, entry=충동구매 진입, filler=구성 보완'),
        why: z.string().describe('이 세트에 왜 필요한지 한 문장'),
      }),
    )
    .describe('클릭이 많이 몰릴 순서대로 정렬. 첫 항목이 영상을 여는 제품'),
  roomConcept: z.string().describe('이 세트가 만드는 공간을 한 문장으로'),
  hook: z.string().describe('영상 첫 1~2초에 나올 한국어 후크. 12자 이내'),
  landingTitle: z.string().describe('링크 페이지 제목. 20자 이내'),
  contentFit: z
    .number()
    .min(0)
    .max(1)
    .describe('세로 영상 소재로서의 적합도. 시각적으로 보여줄 게 있는가, 하나의 방으로 읽히는가'),
  fitReason: z.string().describe('contentFit 점수의 근거 한 문장'),
  rejected: z.array(z.string()).describe('뽑지 않은 후보 id 중 이유가 분명한 것들'),
});

const SYSTEM = `당신은 원룸·자취 니치의 숏폼 커머스 편성자입니다.

후보 상품 목록에서 영상 한 편에 실을 세트를 고릅니다. 판단 기준:

1. 하나의 방으로 읽혀야 합니다. 재질과 톤이 섞이면 영상이 카탈로그처럼 보이고 이탈합니다.
2. 세로 화면에서 보여줄 게 있어야 합니다. 형태가 뚜렷하고 배경 분리가 쉬운 물건이 유리합니다.
3. 가격 사다리를 만듭니다. 부담 없이 누를 진입 상품과, 기준점이 될 비싼 상품이 함께 있어야 합니다.
4. 첫 항목이 영상을 엽니다. 가장 시선을 끄는 물건을 앞에 둡니다.

중요: 수수료율·전환율·예상수익은 계산하지 마세요. 그 숫자는 시스템이 따로 계산합니다.
당신은 구성과 카피만 판단합니다.

후크는 설명이 아니라 장면이어야 합니다. "원룸 가구 추천"이 아니라 "책상이 벽이 됐다" 쪽입니다.`;

function candidateLine(p) {
  const off = p.originalPrice > 0 ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  return [
    `- id=${p.id}`,
    `${p.title}`,
    `${p.platform}/${p.category}`,
    `${p.price.toLocaleString('ko-KR')}원${off > 0 ? ` (${off}% 할인)` : ''}`,
    p.rating ? `평점 ${p.rating}` : null,
    p.reviewCount ? `리뷰 ${p.reviewCount}` : null,
    p.material ? `재질 ${p.material}` : null,
    p.color ? `색 ${p.color}` : null,
    p.inStock === false ? '**품절**' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Fallback when no API credential is present: rank by EPC, then force a price
// ladder. Worse copy, same economics — the tool stays usable without a key.
function heuristicSelection(candidates, size) {
  const ranked = [...candidates]
    .filter(p => p.inStock !== false)
    .sort((a, b) => productEpc(b).epc - productEpc(a).epc);

  const picked = [];
  const cheap = ranked.find(p => p.price <= 30000);
  const dear = ranked.find(p => p.price >= 80000);
  for (const p of [ranked[0], cheap, dear]) if (p && !picked.includes(p)) picked.push(p);
  for (const p of ranked) {
    if (picked.length >= size) break;
    if (!picked.includes(p)) picked.push(p);
  }

  return {
    slots: picked.map((p, i) => ({
      id: p.id,
      role: i === 0 ? 'hero' : p.price >= 80000 ? 'anchor' : p.price <= 30000 ? 'entry' : 'filler',
      why: '휴리스틱 선정 (EPC 순 + 가격 사다리 보정)',
    })),
    roomConcept: '원룸 기본 구성',
    hook: '원룸이 이렇게 바뀝니다',
    landingTitle: '이 영상 속 제품',
    contentFit: 0.6,
    fitReason: 'API 키가 없어 구성 적합도를 판단하지 않았습니다 (기본값)',
    rejected: [],
  };
}

export async function pickBundle(candidates, { size = BUNDLE_SIZE, model = MODEL } = {}) {
  if (candidates.length < size) {
    throw new Error(`후보가 ${candidates.length}개뿐입니다. 최소 ${size}개 필요합니다.`);
  }

  let selection;
  let source;

  if (!hasAnthropicKey()) {
    selection = heuristicSelection(candidates, size);
    source = 'heuristic';
  } else {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(SelectionSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `후보 ${candidates.length}개 중 ${size}개를 골라 영상 한 편의 세트를 구성하세요.

${candidates.map(candidateLine).join('\n')}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`모델이 요청을 거절했습니다: ${response.stop_details?.category ?? 'unknown'}`);
    }
    selection = response.parsed_output;
    if (!selection) throw new Error('구조화 출력 파싱에 실패했습니다');
    source = model;
  }

  // The model returns ids; we resolve them ourselves so a hallucinated id
  // becomes a hard error rather than a silently missing slot.
  const byId = new Map(candidates.map(p => [p.id, p]));
  const products = selection.slots.map(s => {
    const p = byId.get(s.id);
    if (!p) throw new Error(`알 수 없는 제품 id: ${s.id}`);
    return { ...p, role: s.role, why: s.why };
  });

  const value = bundleValue(products, selection.contentFit);
  const ladder = ladderCheck(products);

  return {
    source,
    concept: selection.roomConcept,
    hook: selection.hook,
    landingTitle: selection.landingTitle,
    contentFit: selection.contentFit,
    fitReason: selection.fitReason,
    rejected: selection.rejected,
    ladder,
    attributionHours: ASSUMPTIONS.attributionHours,
    epcPerVideoClick: value.epcPerVideoClick,
    score: value.score,
    slots: value.slots.map((s, i) => ({
      slot: i,
      id: s.id,
      title: s.title,
      platform: s.platform,
      price: s.price,
      originalPrice: s.originalPrice,
      url: s.url,
      image: s.image ?? null,
      role: products[i].role,
      why: products[i].why,
      clickShare: s.clickShare,
      commissionRate: s.commissionRate,
      perSale: s.perSale,
      epc: s.epc,
      factors: s.factors,
    })),
  };
}
