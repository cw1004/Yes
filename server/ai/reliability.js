'use strict';
/**
 * AI 엔진 호출 방어막.
 *
 * 문제 세 가지를 막는다.
 *  1) **멈춤** — 스트림이 응답하지 않으면 추천 요청이 영원히 끝나지 않았다. 이제 시간 제한이 있다.
 *  2) **헛된 재시도** — 네트워크 문제는 다시 걸면 되지만, 모델이 거절했거나 도구를 안 부른 것은
 *     다시 걸어도 같다. 게다가 재시도는 **요금이 두 배로 나간다.** 그래서 일시적 오류만 재시도한다.
 *  3) **죽은 엔진에 계속 매달리기** — 연속 실패한 엔진은 잠시 끊는다(서킷 브레이커).
 *     Llama 로컬 서버가 꺼져 있는데 매번 기다릴 이유가 없다.
 */

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 180000);   // 웹 검색 포함이라 넉넉히
const MAX_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS || 2);
const BREAKER_THRESHOLD = Number(process.env.AI_BREAKER_FAILS || 3);
const BREAKER_COOLDOWN_MS = Number(process.env.AI_BREAKER_COOLDOWN_MS || 300000); // 5분

/** provider 이름 → { fails, openUntil } */
const breakers = new Map();

/** 다시 걸면 될 만한 오류인가 (요금이 나가므로 확실할 때만 재시도한다) */
function isTransient(err) {
  const msg = String((err && err.message) || err || '');
  const status = err && (err.status || err.statusCode);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed/i.test(msg)) return true;
  if (/시간이 초과/.test(msg)) return true;
  // 모델이 거절했거나 결과를 제출하지 않은 것은 다시 걸어도 같다 → 재시도 안 함
  return false;
}

function breakerOf(name) {
  if (!breakers.has(name)) breakers.set(name, { fails: 0, openUntil: 0 });
  return breakers.get(name);
}

/** 지금 이 엔진을 부를 수 있는가 */
function isOpen(name) {
  const b = breakerOf(name);
  if (b.openUntil && Date.now() < b.openUntil) {
    return { open: true, until: b.openUntil, fails: b.fails };
  }
  if (b.openUntil && Date.now() >= b.openUntil) {
    b.openUntil = 0;     // 쿨다운이 끝나면 한 번 더 기회를 준다
    b.fails = 0;
  }
  return { open: false };
}

function recordSuccess(name) {
  const b = breakerOf(name);
  b.fails = 0;
  b.openUntil = 0;
}

function recordFailure(name) {
  const b = breakerOf(name);
  b.fails++;
  if (b.fails >= BREAKER_THRESHOLD) b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  return b;
}

// 두 타이머 모두 unref() 하지 않는다.
// 대기 중인 await 가 이 타이머에 의존하므로, unref 하면 이벤트 루프가 비었을 때
// 시간 초과가 발동하는 대신 프로세스가 조용히 끝나 버린다.
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 응답 시간이 초과했습니다 (${Math.round(ms / 1000)}초).`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 방어막을 두른 analyze 호출.
 * @param {{name:string, label:string, analyze:Function}} provider
 * @param {object} ctx
 * @returns {Promise<object>} 성공하면 provider.analyze 결과에 attempts 를 붙여 돌려준다
 */
async function guardedAnalyze(provider, ctx) {
  const gate = isOpen(provider.name);
  if (gate.open) {
    const secs = Math.ceil((gate.until - Date.now()) / 1000);
    const err = new Error(`연속 ${gate.fails}회 실패해 ${secs}초간 호출을 멈춘 상태입니다.`);
    err.breakerOpen = true;
    throw err;
  }

  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const value = await withTimeout(provider.analyze(ctx), TIMEOUT_MS, provider.label);
      recordSuccess(provider.name);
      return { ...value, attempts: attempt };
    } catch (err) {
      last = err;
      if (attempt >= MAX_ATTEMPTS || !isTransient(err)) break;
      await sleep(1000 * 2 ** (attempt - 1));   // 1초 → 2초
    }
  }
  recordFailure(provider.name);
  throw last;
}

/** 화면·테스트용 상태 */
function status() {
  return Object.fromEntries(Array.from(breakers, ([name, b]) => [name, {
    fails: b.fails,
    open: Boolean(b.openUntil && Date.now() < b.openUntil),
    openUntil: b.openUntil || null,
  }]));
}

/** 테스트용 초기화 */
function reset() { breakers.clear(); }

module.exports = {
  guardedAnalyze, isTransient, isOpen, status, reset,
  TIMEOUT_MS, MAX_ATTEMPTS, BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS,
};
