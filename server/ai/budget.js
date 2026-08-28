'use strict';
/**
 * AI 호출 비용 방어.
 *
 * 추천 1회는 실제 요금이 나간다. 실수로 반복 호출되거나(새로고침 연타, 스크립트 루프),
 * 모델이 웹 검색을 길게 돌면 하루에 수십 달러가 조용히 나갈 수 있다.
 * 여기서 하루 한도를 걸고, 넘으면 **호출 자체를 막는다.**
 *
 * 한도는 기본 3달러다. 넉넉히 쓰려면 AI_DAILY_BUDGET_USD 로 올린다.
 * 0 으로 두면 무제한이지만 권하지 않는다.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.AI_LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const FILE = path.join(DIR, 'ai-budget.json');

const LIMIT_USD = Number(process.env.AI_DAILY_BUDGET_USD ?? 3);
/** 한 번의 추천이 이 금액을 넘을 것 같으면 아예 시작하지 않는다 */
const PER_CALL_GUESS_USD = Number(process.env.AI_CALL_ESTIMATE_USD ?? 0.35);

/** 하루 경계는 사용자가 사는 곳(한국) 기준 */
function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && raw.date === today()) return raw;
  } catch (_) { /* 없으면 새로 시작 */ }
  return { date: today(), spentUsd: 0, calls: 0, blocked: 0 };
}

function save(state) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (_) { /* 기록 실패가 추천을 막지는 않는다 */ }
}

/**
 * 지금 호출해도 되는지.
 * @returns {{ok:boolean, reason?:string, state:object}}
 */
function check() {
  const state = load();
  if (LIMIT_USD <= 0) return { ok: true, state };

  if (state.spentUsd >= LIMIT_USD) {
    state.blocked++;
    save(state);
    return {
      ok: false,
      reason: `오늘 AI 사용액이 한도에 도달했습니다 ($${state.spentUsd.toFixed(3)} / $${LIMIT_USD.toFixed(2)}). ` +
        '내일 자동으로 초기화되며, AI_DAILY_BUDGET_USD 로 한도를 올릴 수 있습니다.',
      state,
    };
  }
  // 남은 예산이 한 번 호출분도 안 되면 중간에 끊기느니 시작하지 않는다
  if (state.spentUsd + PER_CALL_GUESS_USD > LIMIT_USD) {
    state.blocked++;
    save(state);
    return {
      ok: false,
      reason: `남은 예산이 1회 호출분($${PER_CALL_GUESS_USD.toFixed(2)})보다 적습니다 ` +
        `(남음 $${(LIMIT_USD - state.spentUsd).toFixed(3)}). 오늘은 여기까지입니다.`,
      state,
    };
  }
  return { ok: true, state };
}

/** 실제로 쓴 금액을 기록한다 */
function spend(usd) {
  const state = load();
  state.spentUsd = Math.round((state.spentUsd + (Number(usd) || 0)) * 1e6) / 1e6;
  state.calls++;
  save(state);
  return state;
}

/** 화면 표시용 */
function status() {
  const state = load();
  return {
    date: state.date,
    limitUsd: LIMIT_USD,
    spentUsd: state.spentUsd,
    remainingUsd: LIMIT_USD > 0 ? Math.max(0, Math.round((LIMIT_USD - state.spentUsd) * 1e6) / 1e6) : null,
    calls: state.calls,
    blocked: state.blocked,
    unlimited: LIMIT_USD <= 0,
  };
}

module.exports = { check, spend, status, today, LIMIT_USD, FILE };
