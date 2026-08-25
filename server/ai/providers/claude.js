'use strict';
/**
 * Claude(Anthropic) 프로바이더 — 공식 Anthropic SDK 사용.
 * 서버측 웹 검색 도구를 쓸 수 있어, 수집된 RSS 뉴스에 더해 직접 조사까지 한다.
 */

const S = require('./schema');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const PRICE = { input: 5, output: 25 }; // USD / 1M 토큰 (Opus 5)

let sdk;
function loadSdk() {
  if (sdk) return sdk;
  try {
    const mod = require('@anthropic-ai/sdk');
    sdk = mod.default || mod;
    return sdk;
  } catch (_) {
    throw new Error('@anthropic-ai/sdk 가 설치되어 있지 않습니다. `npm install` 을 실행하세요.');
  }
}

const available = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
// 키가 있으면 준비된 것으로 본다 (확인용 호출도 과금되므로 두드려 보지 않는다)
const ready = async () => (available() ? { ok: true } : { ok: false, reason: 'ANTHROPIC_API_KEY 없음' });

/**
 * @param {{scan:object, news:object, newsText:string, market:string, horizon:string, risk:string, client?:object}} ctx
 * @returns {Promise<{provider:string, model:string, marketContext:string, picks:Array, usage:object, webSearches:number}>}
 */
async function analyze(ctx) {
  const Anthropic = ctx.client ? null : loadSdk();
  const client = ctx.client || new Anthropic();

  const tools = [
    // Anthropic 인프라에서 실행되는 웹 검색 (동적 필터링 버전)
    { type: 'web_search_20260209', name: 'web_search', max_uses: 10 },
    {
      name: S.TOOL_NAME,
      description: S.TOOL_DESCRIPTION,
      strict: true,
      input_schema: S.INPUT_SCHEMA,
    },
  ];

  const messages = [{
    role: 'user',
    content: S.buildUserPrompt({ ...ctx, newsText: ctx.newsText, canSearch: true }),
  }];

  let submitted = null;
  let searches = 0;
  let servedModel = MODEL;
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < 5 && !submitted; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // 안전 분류기가 거절하면 서버측에서 권장 대체 모델로 자동 재시도
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: S.SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });
    const response = await stream.finalMessage();

    usage.input_tokens += response.usage.input_tokens || 0;
    usage.output_tokens += response.usage.output_tokens || 0;
    servedModel = response.model || servedModel;

    // 거절은 예외가 아니라 정상 응답으로 온다. content 를 읽기 전에 먼저 확인한다.
    if (response.stop_reason === 'refusal') {
      const d = response.stop_details || {};
      throw new Error(`모델이 요청을 거절했습니다 (${d.category || '사유 미상'}).`);
    }

    for (const block of response.content) {
      if (block.type === 'web_search_tool_result') searches++;
      if (block.type === 'tool_use' && block.name === S.TOOL_NAME) submitted = block.input;
    }
    if (submitted) break;

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;  // 서버 도구 진행 중
    messages.push({ role: 'user', content: `${S.TOOL_NAME} 도구를 호출해 최종 3종목을 제출해 주세요.` });
  }

  if (!submitted) throw new Error('Claude 가 추천 결과를 제출하지 않았습니다.');

  return {
    provider: 'claude',
    label: 'Claude',
    model: servedModel,
    marketContext: submitted.marketContext || '',
    picks: submitted.picks || [],
    webSearches: searches,
    usage: {
      ...usage,
      estimatedCostUsd: round6((usage.input_tokens / 1e6) * PRICE.input + (usage.output_tokens / 1e6) * PRICE.output),
    },
  };
}

const round6 = (v) => (isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

module.exports = { name: 'claude', label: 'Claude', available, ready, analyze, MODEL };
