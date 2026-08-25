'use strict';
/** 프로바이더 레지스트리 — 사용 가능한 AI 엔진을 모아 관리한다. */

const claude = require('./claude');
const llama = require('./llama');

const ALL = [claude, llama];

/** 설정상 켜져 있는 프로바이더 */
function configuredProviders() {
  return ALL.filter((p) => p.available());
}

/** 실제로 응답하는 프로바이더만 (로컬 Llama 는 살아 있는지 두드려 본다) */
async function readyProviders() {
  const checks = await Promise.all(configuredProviders().map(async (p) => ({ p, r: await p.ready() })));
  return checks.filter((c) => c.r.ok).map((c) => c.p);
}

function byName(name) {
  return ALL.find((p) => p.name === name) || null;
}

/** 화면에 보여줄 상태표 (도달 여부까지 확인) */
async function status() {
  return Promise.all(ALL.map(async (p) => {
    const r = p.available() ? await p.ready() : { ok: false, reason: '설정 없음' };
    return {
      name: p.name,
      label: p.label,
      configured: p.available(),
      ready: r.ok,
      reason: r.ok ? null : r.reason,
      model: p.MODEL,
      endpoint: p.BASE_URL || 'api.anthropic.com',
    };
  }));
}

module.exports = { ALL, configuredProviders, readyProviders, byName, status, claude, llama };
