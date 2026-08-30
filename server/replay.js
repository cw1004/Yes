'use strict';
/**
 * 과거 장 재생 연습 (replay practice).
 *
 * 설정을 검증하는 건 백테스트가 하고, **손에 익히는 건 사람이 직접 해 봐야** 한다.
 * 지나간 장을 빨리감기로 틀어 놓고 사람이 매수·매도 버튼을 누르며 연습하는 모드다.
 *
 * ── 진짜 연습이 되게 하려고 지킨 것 ─────────────────────────────────────
 * 1) **미래를 서버가 쥐고 있는다.** 아직 오지 않은 봉은 응답에 담지 않는다.
 *    브라우저 개발자도구를 열어도 다음 봉을 볼 수 없다. 이게 이 모드의 전부다.
 * 2) **체결은 다음 봉 시가에.** 지금 보고 있는 봉의 종가로는 못 산다.
 *    실제로도 "이 봉이 좋네" 하고 누르면 다음 봉에서 체결된다.
 * 3) **슬리피지와 실제 비용을 뗀다.** 수수료·증권거래세를 원 미만 절사까지 반영한다.
 * 4) **채점은 비교로.** 그냥 사서 들고 있었을 때(buy & hold)와 비교해 보여 준다.
 *    수익이 났어도 그냥 들고 있는 것보다 못했다면 그건 잘한 게 아니다.
 */

const C = require('./kr/config');

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;   // 2시간 지나면 정리
const MAX_SESSIONS = 20;
/** 시작할 때 미리 보여 줄 봉 수 (지표가 나오려면 필요하다) */
const PRIME_BARS = 60;
/** 이만큼은 진행할 수 있어야 연습이라 할 수 있다 */
const MIN_PLAYABLE = 60;

const sessions = new Map();

const uid = () => 'rp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.touched > SESSION_TTL_MS) sessions.delete(id);
  }
  // 너무 많이 쌓이면 오래된 것부터 버린다
  while (sessions.size > MAX_SESSIONS) {
    const oldest = Array.from(sessions.entries()).sort((a, b) => a[1].touched - b[1].touched)[0];
    sessions.delete(oldest[0]);
  }
}

/**
 * 연습 세션 시작.
 * @param {{code:string, name?:string, market?:string, isEtf?:boolean,
 *          bars:Array, cash?:number, primeBars?:number}} o
 */
function start(o) {
  sweep();
  const bars = (o.bars || []).filter((b) => b && isFinite(b.c) && b.c > 0);
  const prime = Math.min(o.primeBars || PRIME_BARS, Math.max(10, Math.floor(bars.length / 3)));
  // 진행할 봉이 이보다 적으면 연습이 되지 않는다
  const playable = bars.length - prime;
  if (playable < MIN_PLAYABLE) {
    throw new Error(
      `연습에 쓸 봉이 부족합니다 — 진행할 수 있는 봉이 ${Math.max(0, playable)}개뿐입니다 ` +
      `(최소 ${MIN_PLAYABLE}개 필요). 조회 봉 수를 늘려 보세요.`);
  }

  const id = uid();
  const s = {
    id,
    code: o.code,
    name: o.name || o.code,
    market: o.market || 'KOSPI',
    isEtf: Boolean(o.isEtf),
    bars,                       // 전체 — 서버만 갖고 있는다
    cursor: prime - 1,          // 지금 보고 있는 마지막 봉의 인덱스
    startCash: o.cash || 10000000,
    cash: o.cash || 10000000,
    position: null,             // { qty, entry, entryIdx }
    trades: [],
    started: Date.now(),
    touched: Date.now(),
    finished: false,
  };
  sessions.set(id, s);
  return {
    id,
    code: s.code, name: s.name, market: s.market, isEtf: s.isEtf,
    totalBars: bars.length,
    visible: bars.slice(0, prime),        // 여기까지만 준다
    cursor: s.cursor,
    remaining: bars.length - 1 - s.cursor,
    account: accountOf(s),
  };
}

const get = (id) => {
  const s = sessions.get(id);
  if (!s) throw new Error('연습 세션을 찾을 수 없습니다. 다시 시작해 주세요.');
  s.touched = Date.now();
  return s;
};

/**
 * 봉을 n개 진행한다. **새로 열린 봉만** 돌려준다.
 */
function step(id, n = 1) {
  const s = get(id);
  const want = Math.max(1, Math.min(Math.floor(n) || 1, 200));
  const from = s.cursor + 1;
  const to = Math.min(s.bars.length - 1, s.cursor + want);
  const revealed = s.bars.slice(from, to + 1);
  s.cursor = to;

  const atEnd = s.cursor >= s.bars.length - 1;
  if (atEnd && !s.finished) s.finished = true;

  return {
    revealed,
    cursor: s.cursor,
    remaining: s.bars.length - 1 - s.cursor,
    atEnd,
    account: accountOf(s),
  };
}

/**
 * 매수·매도. 규칙 2에 따라 **다음 봉 시가**에 체결된다.
 * @param {{side:'buy'|'sell', qty:number}} o
 */
function order(id, o) {
  const s = get(id);
  const side = o.side === 'sell' ? 'sell' : 'buy';
  const next = s.bars[s.cursor + 1];
  if (!next) throw new Error('마지막 봉입니다. 더 진행할 수 없습니다.');

  // 규칙 3: 시장가는 호가만큼 밀린다
  const raw = next.o;
  const tick = C.tickSize(raw, s.market);
  const fill = C.alignPrice(side === 'buy' ? raw + tick : raw - tick, s.market, side === 'buy' ? 'up' : 'down');

  if (side === 'buy') {
    if (s.position) throw new Error('이미 보유 중입니다. 먼저 매도하세요.');
    const qty = Math.max(1, Math.floor(o.qty || 0));
    const cost = fill * qty + Math.floor(fill * qty * C.COST.commissionRate);
    if (cost > s.cash) {
      throw new Error(`현금이 부족합니다 (필요 ${Math.round(cost).toLocaleString()}원 / 보유 ${Math.round(s.cash).toLocaleString()}원).`);
    }
    s.cash -= cost;
    s.position = { qty, entry: fill, entryIdx: s.cursor + 1, entryT: next.t, cost };
    return { ok: true, side, fill, qty, account: accountOf(s) };
  }

  if (!s.position) throw new Error('보유한 주식이 없습니다.');
  const pos = s.position;
  const bill = C.settlement({ buyPrice: pos.entry, qty: pos.qty, sellPrice: fill, isEtf: s.isEtf });
  s.cash += bill.totalSellSettle;
  s.trades.push({
    entryT: pos.entryT, exitT: next.t,
    entry: pos.entry, exit: fill, qty: pos.qty,
    bars: (s.cursor + 1) - pos.entryIdx,
    gross: (fill - pos.entry) * pos.qty,
    cost: bill.totalCost,
    net: bill.netProfit,
    netPct: bill.netReturnRate,
  });
  s.position = null;
  return { ok: true, side, fill, qty: pos.qty, trade: s.trades[s.trades.length - 1], account: accountOf(s) };
}

/** 지금 시점의 계좌 상태 */
function accountOf(s) {
  const price = s.bars[s.cursor].c;
  let unrealized = 0;
  let breakeven = null;
  if (s.position) {
    unrealized = C.settlement({
      buyPrice: s.position.entry, qty: s.position.qty, sellPrice: price, isEtf: s.isEtf,
    }).netProfit;
    breakeven = C.breakevenPrice({
      buyPrice: s.position.entry, qty: s.position.qty, market: s.market, isEtf: s.isEtf,
    });
  }
  const holdValue = s.position ? price * s.position.qty : 0;
  return {
    cash: Math.round(s.cash),
    price,
    position: s.position
      ? { qty: s.position.qty, entry: s.position.entry, unrealized: Math.round(unrealized), breakeven }
      : null,
    // 평가자산 = 현금 + 지금 팔면 들어올 돈
    equity: Math.round(s.cash + holdValue),
    realized: Math.round(s.trades.reduce((a, t) => a + t.net, 0)),
    trades: s.trades.length,
    startCash: s.startCash,
  };
}

/**
 * 채점표. 그냥 들고 있었을 때와 비교한다.
 */
function score(id) {
  const s = get(id);
  const first = s.bars[Math.max(0, PRIME_BARS - 1)];
  const last = s.bars[s.cursor];

  // 내 성적
  const realized = s.trades.reduce((a, t) => a + t.net, 0);
  const wins = s.trades.filter((t) => t.net > 0);
  const acct = accountOf(s);
  const myReturn = ((acct.equity - s.startCash) / s.startCash) * 100;

  // 비교 1: 같은 돈으로 처음에 사서 끝까지 들고 있었다면
  const holdQty = Math.floor(s.startCash / first.c);
  const hold = holdQty > 0
    ? C.settlement({ buyPrice: first.c, qty: holdQty, sellPrice: last.c, isEtf: s.isEtf })
    : null;
  const holdNet = hold ? hold.netProfit : 0;

  const costs = s.trades.reduce((a, t) => a + t.cost, 0);

  return {
    code: s.code, name: s.name,
    barsPlayed: s.cursor + 1,
    totalBars: s.bars.length,
    trades: s.trades.length,
    winRate: s.trades.length ? round2((wins.length / s.trades.length) * 100) : null,
    realized: Math.round(realized),
    equity: acct.equity,
    startCash: s.startCash,
    returnPct: round3(myReturn),
    totalCost: Math.round(costs),
    // 비용이 수익을 얼마나 먹었는지 — 초단타에서 가장 중요한 숫자
    costVsGross: s.trades.length
      ? round2((costs / Math.max(1, Math.abs(s.trades.reduce((a, t) => a + t.gross, 0)))) * 100)
      : null,
    buyAndHold: {
      qty: holdQty,
      entry: first.c, exit: last.c,
      net: Math.round(holdNet),
      returnPct: round3((holdNet / s.startCash) * 100),
    },
    // 그냥 들고 있는 것보다 잘했는가
    beatHold: Math.round(realized) > Math.round(holdNet),
    tradeList: s.trades,
    verdict: verdictOf({ realized, holdNet, trades: s.trades.length, costs }),
  };
}

function verdictOf({ realized, holdNet, trades, costs }) {
  if (!trades) return '거래를 한 번도 하지 않았습니다. 그것도 하나의 선택입니다.';
  const parts = [];
  parts.push(realized > 0
    ? `${Math.round(realized).toLocaleString()}원 벌었습니다.`
    : `${Math.round(-realized).toLocaleString()}원 잃었습니다.`);
  parts.push(realized > holdNet
    ? '그냥 들고 있는 것보다 나았습니다.'
    : `그냥 사서 들고 있었다면 ${Math.round(holdNet).toLocaleString()}원이었습니다 — 단타가 손해였습니다.`);
  if (costs > Math.abs(realized) && trades >= 3) {
    parts.push(`수수료·세금으로만 ${Math.round(costs).toLocaleString()}원 나갔습니다. 거래를 줄이는 편이 낫습니다.`);
  }
  return parts.join(' ');
}

/** 세션 종료 */
function end(id) {
  const s = sessions.get(id);
  if (s) sessions.delete(id);
  return { ok: true };
}

const round2 = (v) => (isFinite(v) ? Math.round(v * 100) / 100 : null);
const round3 = (v) => (isFinite(v) ? Math.round(v * 1000) / 1000 : null);

module.exports = {
  start, step, order, score, end, get, accountOf, sessions,
  PRIME_BARS, MIN_PLAYABLE, SESSION_TTL_MS,
};
