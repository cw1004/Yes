/**
 * AI 닥터 내레이션 어댑터.
 *
 * 기본은 규칙 기반 상담 엔진(consult.js)이다 — 키가 없어도, 오프라인에서도,
 * 지연 없이 항상 같은 품질로 나오고 무엇을 말할지 전부 추적 가능하다.
 * ANTHROPIC_API_KEY 가 있으면 그 대본을 Claude 가 자연스러운 상담 어투로 다듬는다.
 *
 * 규칙 하나: 모델은 **문장을 다듬을 뿐 수치와 처방을 바꾸지 않는다.**
 * 숫자를 지어내면 그건 곧 의료 오정보가 되므로, 실패 시 조용히 규칙 대본으로 되돌아간다.
 */
import { buildConsult, consultContext, DOCTOR } from '../public/js/engine/consult.js';

const MODEL = process.env.SKINLAB_DOCTOR_MODEL || 'claude-opus-5';

const SYSTEM = `당신은 스킨케어 앱의 AI 상담 캐릭터 "${DOCTOR.name}"입니다.
주어진 대본(script)을 같은 순서, 같은 사실관계로 유지하면서 말투만 자연스럽게 다듬습니다.

지켜야 할 것:
- 점수, 퍼센트, 부위, 성분명, 순서는 절대 바꾸지 않습니다. 새로운 수치를 만들지 않습니다.
- '진단', '처방', '치료', '질환명'을 쓰지 않습니다. '소견', '관리', '제안'으로 표현합니다.
- 의사를 사칭하지 않습니다. 의학적 판단이 필요한 내용은 피부과 전문의 진료를 권합니다.
- 한 문장은 짧게. 과장·공포 마케팅 없이, 차분하고 신뢰감 있게.
- 대본에 없는 제품 브랜드를 추천하지 않습니다.

출력은 JSON 배열만 반환합니다: [{"stage": "<원본 stage>", "text": "<다듬은 문장>"}]
배열 길이와 stage 순서는 입력 대본과 정확히 같아야 합니다.`;

let sdkPromise;
/** SDK 는 선택적 의존성 — 설치돼 있지 않으면 그냥 규칙 엔진으로 간다 */
async function loadSdk() {
  sdkPromise ??= import('@anthropic-ai/sdk').then((m) => m.default).catch(() => null);
  return sdkPromise;
}

export function ruleConsult(analysis, diagnosis, intake) {
  return buildConsult(analysis, diagnosis, intake);
}

/**
 * @returns {Promise<{consult:object, narrated:boolean, reason?:string}>}
 */
export async function narrate(analysis, diagnosis, intake, { tier = 'free' } = {}) {
  const consult = buildConsult(analysis, diagnosis, intake);
  if (!process.env.ANTHROPIC_API_KEY) return { consult, narrated: false, reason: 'no_api_key' };

  const Anthropic = await loadSdk();
  if (!Anthropic) return { consult, narrated: false, reason: 'sdk_not_installed' };

  // 무료 구간은 대사가 짧으니 그 부분만 다듬어 비용을 아낀다
  const source = tier === 'pro' ? consult.script : consult.free.script;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content: `측정 컨텍스트:\n${JSON.stringify(consultContext(analysis, diagnosis, intake))}\n\n다듬을 대본:\n${JSON.stringify(source.map((t) => ({ stage: t.stage, text: t.text })))}`,
      }],
    });
    if (response.stop_reason === 'refusal') return { consult, narrated: false, reason: 'refusal' };

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    if (!Array.isArray(parsed) || parsed.length !== source.length) {
      return { consult, narrated: false, reason: 'length_mismatch' };
    }
    // stage 순서가 어긋나면 사실관계가 섞였다는 뜻 — 통째로 버린다
    if (parsed.some((p, i) => p.stage !== source[i].stage || typeof p.text !== 'string' || !p.text.trim())) {
      return { consult, narrated: false, reason: 'stage_mismatch' };
    }
    const rewritten = new Map(source.map((t, i) => [t, parsed[i].text]));
    const apply = (arr) => arr.map((t) => (rewritten.has(t) ? { ...t, text: rewritten.get(t) } : t));
    return {
      consult: { ...consult, script: apply(consult.script), free: { ...consult.free, script: apply(consult.free.script) } },
      narrated: true,
      model: MODEL,
    };
  } catch (err) {
    console.error('[doctor] narration failed, falling back to rule engine:', err.message);
    return { consult, narrated: false, reason: 'error' };
  }
}
