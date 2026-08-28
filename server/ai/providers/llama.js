'use strict';
/**
 * Meta Llama 프로바이더.
 *
 * meta.ai(소비자용 채팅)에는 공개 API가 없다. Meta 모델을 프로그램에서 쓰는 길은
 * Llama 모델을 OpenAI 호환 엔드포인트로 부르는 것이고, 아래 어디에나 붙는다.
 *
 *   · 로컬 Ollama        LLAMA_BASE_URL=http://localhost:11434/v1        (키 불필요)
 *   · Meta Llama API     LLAMA_BASE_URL=https://api.llama.com/compat/v1  + LLAMA_API_KEY
 *   · Groq / Together 등 각 서비스의 OpenAI 호환 주소 + 키
 *
 * 모델 이름은 서비스마다 다르므로 LLAMA_MODEL 로 직접 지정한다.
 * (이 파일은 Anthropic SDK 를 쓰지 않는다 — 의도적으로 다른 공급자 경로다.)
 */

const S = require('./schema');

const DEFAULT_BASE = process.env.LLAMA_API_KEY
  ? 'https://api.llama.com/compat/v1'
  : 'http://localhost:11434/v1';

const BASE_URL = (process.env.LLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const MODEL = process.env.LLAMA_MODEL || 'llama3.1';
const API_KEY = process.env.LLAMA_API_KEY || '';
const TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 120000);

/** 설정상 쓸 수 있는가 (로컬은 키 없이도 가능, 원격은 키 필요) */
function available() {
  if (process.env.LLAMA_ENABLED === '0') return false;
  if (API_KEY) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(BASE_URL);
}

let probeCache = null;
/**
 * 실제로 응답하는지 확인한다.
 * 로컬 Ollama 는 설정만으로는 켜져 있는지 알 수 없어, 짧게 두드려 보고 판단한다.
 */
async function ready() {
  if (!available()) return { ok: false, reason: '설정 없음' };
  if (probeCache && Date.now() < probeCache.expires) return probeCache.value;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  let value;
  try {
    const res = await fetch(BASE_URL + '/models', {
      headers: API_KEY ? { Authorization: 'Bearer ' + API_KEY } : {},
      signal: ctrl.signal,
    });
    value = res.ok
      ? { ok: true }
      : { ok: false, reason: `엔드포인트 응답 ${res.status}` };
  } catch (err) {
    value = { ok: false, reason: err.name === 'AbortError' ? '응답 없음(시간 초과)' : '연결 실패' };
  } finally {
    clearTimeout(timer);
  }
  probeCache = { value, expires: Date.now() + 30000 };
  return value;
}

async function analyze(ctx) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: S.SYSTEM_PROMPT },
      { role: 'user', content: S.buildUserPrompt({ ...ctx, canSearch: false }) },
    ],
    // OpenAI 호환 function calling — 결과를 구조화해 받는다
    tools: [{
      type: 'function',
      function: { name: S.TOOL_NAME, description: S.TOOL_DESCRIPTION, parameters: S.INPUT_SCHEMA },
    }],
    tool_choice: { type: 'function', function: { name: S.TOOL_NAME } },
    temperature: 0.2,
    max_tokens: 8000,
  };

  const json = await post('/chat/completions', body);
  const choice = (json.choices || [])[0];
  if (!choice) throw new Error('Llama 응답이 비어 있습니다.');

  const call = (choice.message && choice.message.tool_calls || [])[0];
  let submitted;
  if (call) {
    submitted = safeParse(call.function && call.function.arguments);
  } else if (choice.message && choice.message.content) {
    // 일부 서버는 function calling 을 지원하지 않고 본문에 JSON 을 담아 준다
    submitted = extractJson(choice.message.content);
  }
  if (!submitted || !Array.isArray(submitted.picks)) {
    throw new Error('Llama 가 지정한 형식으로 결과를 주지 않았습니다. (모델의 도구 호출 지원 여부를 확인하세요)');
  }

  const usage = json.usage || {};
  return {
    provider: 'llama',
    label: 'Llama (Meta)',
    model: json.model || MODEL,
    marketContext: submitted.marketContext || '',
    passReason: submitted.passReason || '',
    picks: submitted.picks || [],
    webSearches: 0,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      // 요금은 서비스마다 달라 추정하지 않는다
      estimatedCostUsd: null,
    },
  };
}

async function post(pathname, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE_URL + pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: 'Bearer ' + API_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Llama 엔드포인트 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Llama 응답이 ${TIMEOUT_MS / 1000}초 안에 오지 않았습니다.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return extractJson(raw); }
}

/** 본문에 섞여 온 JSON 블록 추출 */
function extractJson(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : String(text);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch (_) { return null; }
}

module.exports = { name: 'llama', label: 'Llama (Meta)', available, ready, analyze, BASE_URL, MODEL, extractJson };
