'use strict';
/**
 * AI 추천 종목 3선 엔진.
 *
 * 흐름:
 *   1) screener 가 우리 지표 엔진으로 유니버스를 훑어 **측정된 사실**로 후보를 추린다.
 *   2) Claude(Opus 5)에게 후보 + 실제 지표 수치를 주고, **서버측 웹 검색 도구**로
 *      월가·글로벌 매체의 최신 뉴스·실적·애널리스트 코멘트·거시 이벤트를 직접 확인하게 한다.
 *   3) 최종 3종목은 strict 스키마 도구(submit_recommendations)로만 받는다.
 *
 * 원칙:
 *   - 종목은 반드시 후보 목록 안에서 고른다. 존재하지 않는 티커를 지어내는 것을 막고,
 *     모든 추천이 우리가 실제로 계산한 지표와 짝을 이루게 하기 위함이다.
 *   - 검색으로 확인되지 않은 사실은 쓰지 않는다. 종목마다 출처 URL을 남긴다.
 *   - 이 결과는 참고용 분석이며 투자 권유가 아니다.
 */

const fs = require('fs');
const path = require('path');
const screener = require('./screener');

const MODEL = 'claude-opus-5';
const LOG_DIR = process.env.AI_LOG_DIR || path.join(__dirname, '..', '..', 'logs');

// Opus 5 단가 (USD / 1M 토큰) — 사용량 표시용
const PRICE = { input: 5, output: 25 };

/** 최종 결과를 받는 도구. strict 로 스키마를 강제한다. */
const SUBMIT_TOOL = {
  name: 'submit_recommendations',
  description:
    '조사를 마친 뒤 최종 추천 종목 3개를 제출한다. 반드시 정확히 3개를 담고, ' +
    '각 종목은 후보 목록에 있던 심볼이어야 하며, 웹 검색으로 확인한 출처를 1개 이상 포함해야 한다.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['marketContext', 'picks'],
    properties: {
      marketContext: {
        type: 'string',
        description: '오늘 시장 전반의 상황과 분위기를 2~4문장으로. 검색으로 확인한 내용만.',
      },
      picks: {
        type: 'array',
        description: '추천 종목 3개.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['symbol', 'name', 'thesis', 'catalysts', 'risks', 'confidence', 'horizon', 'sources'],
          properties: {
            symbol: { type: 'string', description: '후보 목록에 있던 심볼/종목코드 그대로.' },
            name: { type: 'string', description: '종목명.' },
            thesis: { type: 'string', description: '왜 지금 이 종목인지 3~5문장. 기술적 지표와 뉴스 근거를 함께.' },
            catalysts: {
              type: 'array',
              description: '상승 촉매 2~4개. 각 항목은 한 문장.',
              items: { type: 'string' },
            },
            risks: {
              type: 'array',
              description: '이 판단이 틀릴 수 있는 리스크 2~3개. 각 항목은 한 문장.',
              items: { type: 'string' },
            },
            confidence: {
              type: 'string',
              enum: ['높음', '중간', '낮음'],
              description: '근거의 확실성. 검색 근거가 약하면 낮음.',
            },
            horizon: {
              type: 'string',
              enum: ['당일', '2~3일', '1~2주'],
              description: '이 아이디어가 유효한 기간.',
            },
            sources: {
              type: 'array',
              description: '근거로 삼은 웹 검색 출처. 최소 1개.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'url'],
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  publisher: { type: 'string', description: '매체명. 모르면 빈 문자열.' },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `당신은 한국어로 보고하는 주식 리서치 애널리스트입니다.
사용자는 이미 자체 기술적 지표 엔진으로 후보 종목을 추려 두었고, 당신의 역할은
**최신 시장 정보를 직접 확인해** 그 후보 중에서 지금 가장 매력적인 3종목을 고르는 것입니다.

반드시 지킬 것:
1. 웹 검색을 사용해 실제로 확인한 내용만 서술합니다. 기억이나 추측으로 뉴스·실적·목표주가를 쓰지 마세요.
   확인되지 않으면 "확인되지 않음"이라고 쓰거나 그 근거를 아예 빼십시오.
2. 종목은 **반드시 제공된 후보 목록 안에서** 고릅니다. 목록에 없는 티커를 지어내지 마세요.
3. 제공된 기술적 지표 수치는 사용자 시스템이 실제로 계산한 값입니다. 사실로 취급하되,
   그 수치를 다시 지어내거나 바꾸지 마세요.
4. 수익을 보장하거나 단정하는 표현을 쓰지 마세요. "~할 가능성", "~라면"처럼 조건부로 씁니다.
   각 종목마다 이 판단이 틀릴 수 있는 리스크를 반드시 함께 적습니다.
5. 종목마다 출처 URL을 최소 1개 남깁니다. 검색 결과에 실제로 있던 URL만 씁니다.
6. 조사할 것: 월가 주요 매체(Reuters, Bloomberg, CNBC, WSJ, Barron's 등)의 해당 종목 뉴스,
   실적·가이던스, 애널리스트 목표주가 변경, 섹터 흐름, 그리고 지수·금리·환율·유가 같은 거시 이벤트와
   아시아·유럽 등 글로벌 시장 동향까지. 오늘 날짜 기준의 최신 정보를 우선합니다.
7. 조사가 끝나면 반드시 submit_recommendations 도구를 호출해 결과를 제출합니다.
   도구 호출 없이 글로만 답하지 마세요.

당신의 분석은 참고용이며 투자 권유가 아닙니다. 이 점을 전제로 균형 있게 서술하세요.`;

/* ------------------------------------------------------------------ 캐시 */

const cache = new Map();
const CACHE_TTL = Number(process.env.AI_CACHE_TTL_MS || 600000); // 기본 10분

function cacheKey(opts) {
  return [opts.market, opts.horizon, opts.risk, (opts.symbols || []).join('|')].join(':');
}

/* ------------------------------------------------------------------ 본체 */

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let sdkModule;
function loadSdk() {
  if (sdkModule) return sdkModule;
  try {
    const mod = require('@anthropic-ai/sdk');
    sdkModule = mod.default || mod;
    return sdkModule;
  } catch (err) {
    throw new Error('@anthropic-ai/sdk 가 설치되어 있지 않습니다. `npm install` 을 실행하세요.');
  }
}

/**
 * AI 추천 3종목 생성.
 * @param {{market:'US'|'KR', horizon?:string, risk?:string, symbols?:string[], force?:boolean, client?:object}} opts
 */
async function recommend(opts = {}) {
  const market = opts.market === 'KR' ? 'KR' : 'US';
  const horizon = opts.horizon || '당일~2일 단타';
  const risk = opts.risk || '중립';

  const key = cacheKey({ market, horizon, risk, symbols: opts.symbols });
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expires) return { ...hit.value, cached: true };
  }

  const scan = await screener.screen(market, {
    symbols: market === 'US' ? opts.symbols : undefined,
    codes: market === 'KR' ? opts.symbols : undefined,
    limit: 10,
  });

  if (!scan.candidates.length) {
    throw new Error('후보 종목을 만들지 못했습니다. 시세 조회에 실패했을 수 있습니다.');
  }

  // AI 자격증명이 없으면 지표 기반으로만 상위 3종목을 낸다 (AI 없음을 명시)
  if (!hasCredentials() && !opts.client) {
    return finish(key, fallbackPicks(scan, market, horizon));
  }

  const Anthropic = opts.client ? null : loadSdk();
  const client = opts.client || new Anthropic();

  const userContent = buildPrompt({ market, horizon, risk, scan });

  const tools = [
    // 서버측 웹 검색 — Anthropic 인프라에서 실행되며 결과가 같은 응답에 담겨 온다
    { type: 'web_search_20260209', name: 'web_search', max_uses: 10 },
    SUBMIT_TOOL,
  ];

  const messages = [{ role: 'user', content: userContent }];
  let submitted = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let searches = 0;
  let servedModel = MODEL;

  for (let turn = 0; turn < 5 && !submitted; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      // 복잡한 판단이므로 적응형 사고를 켠다
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // Opus 5 안전 분류기가 거절하면 서버측에서 대체 모델로 자동 재시도
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });
    const response = await stream.finalMessage();

    usage.input_tokens += response.usage.input_tokens || 0;
    usage.output_tokens += response.usage.output_tokens || 0;
    servedModel = response.model || servedModel;

    // 거절은 예외가 아니라 정상 응답으로 온다. content 를 읽기 전에 먼저 확인한다.
    if (response.stop_reason === 'refusal') {
      const detail = response.stop_details || {};
      throw new Error(`모델이 요청을 거절했습니다 (${detail.category || '사유 미상'}).`);
    }

    for (const block of response.content) {
      if (block.type === 'web_search_tool_result') searches++;
      if (block.type === 'tool_use' && block.name === SUBMIT_TOOL.name) submitted = block.input;
    }

    if (submitted) break;

    if (response.stop_reason === 'pause_turn') {
      // 서버 도구가 아직 진행 중 — 받은 내용을 그대로 돌려주고 이어서 진행한다
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    // 도구를 부르지 않고 글로만 끝냈으면 한 번 더 요청한다
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: 'submit_recommendations 도구를 호출해 최종 3종목을 제출해 주세요.',
    });
  }

  if (!submitted) throw new Error('AI가 추천 결과를 제출하지 않았습니다. 잠시 후 다시 시도해 주세요.');

  const result = buildResult({ submitted, scan, market, horizon, risk, usage, searches, servedModel });
  writeAudit(result);
  return finish(key, result);
}

function finish(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

/** 후보 목록과 지표를 AI가 읽기 좋은 형태로 정리 */
function buildPrompt({ market, horizon, risk, scan }) {
  const now = new Date();
  const kst = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'short',
  }).format(now);
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short',
  }).format(now);

  const marketName = market === 'KR' ? '한국 주식시장(KOSPI/KOSDAQ)' : '미국 주식시장';
  const dataNote = scan.source === 'mock' || scan.source === 'yahoo'
    ? (scan.source === 'mock'
      ? '⚠️ 아래 지표는 실시간 시세 연결이 안 되어 데모 데이터로 계산된 값입니다. 이 점을 marketContext 에 반드시 밝히세요.'
      : '아래 지표는 실시간(지연) 시세로 계산된 실제 값입니다.')
    : '';

  return `# 요청
${marketName}에서 지금 주목할 만한 **3종목**을 골라 주세요.

- 현재 시각: ${kst} (한국) / ${et} (뉴욕)
- 투자 기간: ${horizon}
- 리스크 성향: ${risk}
${scan.phase ? `- 한국 장 상태: ${scan.phase}` : ''}

# 후보 종목 (자체 지표 엔진 스캔 결과 ${scan.scanned}종목 중 상위 ${scan.candidates.length}개)
${dataNote}

아래 수치는 사용자 시스템이 실제 시세로 계산한 값입니다. 점수(score)는 -100~+100 범위의
자체 기술적 신호 점수입니다. 이 목록 **안에서만** 3종목을 고르세요.

\`\`\`json
${JSON.stringify(scan.candidates, null, 1)}
\`\`\`

# 해야 할 일
1. 웹 검색으로 각 후보의 최신 뉴스·실적·애널리스트 의견을 확인하고,
   오늘 시장 전반(지수, 금리, 환율, 주요 이벤트)과 글로벌 동향도 함께 조사하세요.
2. 기술적 신호와 뉴스가 **같은 방향을 가리키는** 종목을 우선하세요.
   지표는 좋은데 악재 뉴스가 있으면 제외하거나 리스크에 명시하세요.
3. 조사가 끝나면 submit_recommendations 도구로 3종목을 제출하세요.`;
}

/** 도구 출력 + 우리 지표를 합쳐 최종 응답 구성 */
function buildResult({ submitted, scan, market, horizon, risk, usage, searches, servedModel }) {
  const bySymbol = new Map(scan.candidates.map((c) => [String(c.symbol).toUpperCase(), c]));
  const picks = (submitted.picks || []).slice(0, 3).map((p) => {
    const matched = bySymbol.get(String(p.symbol).toUpperCase());
    return {
      symbol: p.symbol,
      name: p.name || (matched && matched.name) || p.symbol,
      thesis: p.thesis,
      catalysts: p.catalysts || [],
      risks: p.risks || [],
      confidence: p.confidence,
      horizon: p.horizon,
      sources: (p.sources || []).filter((s) => s && s.url),
      // 지표·플랜은 AI가 아니라 우리 엔진이 계산한 값이다 (환각 방지)
      inCandidates: Boolean(matched),
      snapshot: matched
        ? {
          price: matched.price,
          changePercent: matched.changePercent,
          score: matched.score,
          label: matched.label,
          technicals: matched.technicals,
          plan: matched.plan,
          topReasons: matched.topReasons,
        }
        : null,
    };
  });

  return {
    market,
    horizon,
    risk,
    generatedAt: Date.now(),
    engine: 'ai',
    model: servedModel,
    marketContext: submitted.marketContext || '',
    picks,
    dataSource: scan.source,
    scanned: scan.scanned,
    candidates: scan.candidates,
    webSearches: searches,
    usage: {
      ...usage,
      estimatedCostUsd: round6(
        (usage.input_tokens / 1e6) * PRICE.input + (usage.output_tokens / 1e6) * PRICE.output
      ),
    },
    disclaimer: '이 결과는 공개 정보와 기술적 지표를 AI가 정리한 참고 자료이며 투자 권유가 아닙니다. 최종 판단과 책임은 투자자 본인에게 있습니다.',
  };
}

/** API 키가 없을 때: 지표 점수 상위 3종목만 (AI 분석 없음을 명확히 표시) */
function fallbackPicks(scan, market, horizon) {
  const picks = scan.candidates.slice(0, 3).map((c) => ({
    symbol: c.symbol,
    name: c.name,
    thesis: `자체 기술적 신호 ${c.score}점(${c.label}). 근거: ${c.topReasons.join(', ') || '지표 중립'}. ` +
      'AI 뉴스 분석이 적용되지 않은 순수 지표 기반 결과입니다.',
    catalysts: c.topReasons,
    risks: ['뉴스·실적 등 기본적 요인이 반영되지 않았습니다.', '기술적 신호는 시장 급변 시 빠르게 무효화될 수 있습니다.'],
    confidence: '낮음',
    horizon,
    sources: [],
    inCandidates: true,
    snapshot: {
      price: c.price, changePercent: c.changePercent, score: c.score, label: c.label,
      technicals: c.technicals, plan: c.plan, topReasons: c.topReasons,
    },
  }));

  return {
    market,
    horizon,
    generatedAt: Date.now(),
    engine: 'rules',
    model: null,
    marketContext:
      'ANTHROPIC_API_KEY 가 없어 AI 분석을 건너뛰고 기술적 지표만으로 상위 3종목을 정렬했습니다. ' +
      '뉴스·실적·시장 맥락은 반영되지 않았습니다.',
    picks,
    dataSource: scan.source,
    scanned: scan.scanned,
    candidates: scan.candidates,
    webSearches: 0,
    usage: null,
    disclaimer: '이 결과는 기술적 지표 계산 결과이며 투자 권유가 아닙니다. 최종 판단과 책임은 투자자 본인에게 있습니다.',
  };
}

function writeAudit(result) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    fs.appendFileSync(path.join(LOG_DIR, `ai-recommendations-${day}.jsonl`), JSON.stringify({
      t: result.generatedAt,
      market: result.market,
      model: result.model,
      picks: result.picks.map((p) => ({ symbol: p.symbol, confidence: p.confidence, sources: p.sources.length })),
      usage: result.usage,
    }) + '\n');
  } catch (_) { /* 로그 실패가 기능을 막지 않는다 */ }
}

const round6 = (v) => (isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

module.exports = { recommend, hasCredentials, SUBMIT_TOOL, SYSTEM_PROMPT, buildPrompt, buildResult, fallbackPicks, MODEL };
