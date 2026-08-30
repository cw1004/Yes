'use strict';
/**
 * 실전 점검 (pre-flight).
 *
 * 실계좌에 주문이 나가기 전에 **한 화면에서** 확인해야 할 것들을 모아 검사한다.
 * 비행기가 이륙 전 체크리스트를 읽는 것과 같은 이유다 — 빠뜨리면 돈으로 배운다.
 *
 * 각 항목은 pass / warn / fail 과 "그래서 어떻게 하라"는 조치를 함께 낸다.
 * fail 이 하나라도 있으면 실전 준비가 안 된 것이다.
 */

const C = require('./kr/config');
const sessions = require('./sessions');

const ok = (id, title, detail) => ({ id, title, level: 'pass', detail });
const warn = (id, title, detail, action) => ({ id, title, level: 'warn', detail, action });
const fail = (id, title, detail, action) => ({ id, title, level: 'fail', detail, action });

/**
 * @param {{client:object, trader:object}} deps
 */
async function check({ client, trader }) {
  const items = [];
  const cfg = trader ? trader.config : {};
  const st = trader ? trader.status() : {};

  /* ── 1. 계좌 연결 ──────────────────────────────────────────────── */
  const mode = client.mock ? '데모' : client.paper ? '모의투자' : '실전';
  if (client.mock) {
    items.push(fail('account', '계좌 연결', '데모 데이터로 동작 중입니다. 실제 주문이 나가지 않습니다.',
      '.env 에 KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT 를 넣고 앱을 다시 켜세요.'));
  } else if (client.paper) {
    items.push(ok('account', '계좌 연결', '모의투자 계좌에 연결됐습니다. 연습에 적합합니다.'));
  } else {
    items.push(warn('account', '계좌 연결', '⚠️ 실전 계좌입니다. 주문이 나가면 진짜 돈이 움직입니다.',
      '충분히 모의투자로 검증한 뒤에만 진행하세요.'));
  }

  /* ── 2. 시세·잔고가 실제로 응답하는가 ─────────────────────────── */
  let balance = null;
  try {
    balance = await client.balance();
    const cash = balance.orderableCash || balance.cash || 0;
    if (cash <= 0) {
      items.push(fail('balance', '주문가능금액', '주문 가능한 현금이 0원입니다.',
        '증권사 앱에서 예수금을 확인하세요.'));
    } else {
      items.push(ok('balance', '주문가능금액', `${Math.round(cash).toLocaleString()}원`));
    }
  } catch (err) {
    items.push(fail('balance', '주문가능금액', `잔고 조회 실패: ${err.message}`,
      '키가 올바른지, 계좌번호 형식이 맞는지 확인하세요.'));
  }

  /* ── 3. 1회 투입액이 잔고를 넘지 않는가 ───────────────────────── */
  if (balance) {
    const cash = balance.orderableCash || balance.cash || 0;
    if (cfg.sizingMode === 'qty') {
      items.push(warn('sizing', '수량 결정', `직접 입력 ${cfg.fixedQty}주 — 1회 투입액 한도가 적용되지 않습니다.`,
        '단가가 높은 종목에서는 예상보다 큰 금액이 나갈 수 있습니다. 수량을 다시 확인하세요.'));
    } else if (cfg.orderAmount > cash) {
      items.push(warn('sizing', '1회 투입액',
        `설정 ${cfg.orderAmount.toLocaleString()}원이 주문가능금액 ${Math.round(cash).toLocaleString()}원보다 큽니다.`,
        '실제로는 잔고만큼만 매수됩니다. 설정을 낮추면 예측이 쉬워집니다.'));
    } else {
      items.push(ok('sizing', '1회 투입액', `${cfg.orderAmount.toLocaleString()}원 (잔고 이내)`));
    }
  }

  /* ── 4. 손실 한도가 걸려 있는가 ───────────────────────────────── */
  if (!cfg.dailyLossLimit || cfg.dailyLossLimit <= 0) {
    items.push(fail('lossLimit', '일일 손실한도', '손실한도가 꺼져 있습니다. 잃는 데 제한이 없습니다.',
      '자동매매 설정에서 하루에 감당할 수 있는 금액을 넣으세요.'));
  } else {
    items.push(ok('lossLimit', '일일 손실한도',
      `${cfg.dailyLossLimit.toLocaleString()}원 도달 시 자동 정지`));
  }

  /* ── 5. 청산 기준이 정해져 있는가 ─────────────────────────────── */
  if (cfg.exitBasis === 'signal') {
    items.push(warn('exit', '청산 기준', '신호 자동(ATR)입니다. 손절 폭이 그날 변동성에 따라 달라집니다.',
      '얼마를 잃을지 미리 정하고 싶다면 퍼센트나 금액 기준으로 바꾸세요.'));
  } else {
    items.push(ok('exit', '청산 기준', st.config ? describeExit(cfg) : describeExit(cfg)));
  }

  /* ── 6. 강제청산 시각이 장 마감 전인가 ────────────────────────── */
  const fe = String(cfg.forceExitAt || '');
  const feMin = /^\d{2}:\d{2}$/.test(fe) ? Number(fe.slice(0, 2)) * 60 + Number(fe.slice(3)) : null;
  const closeMin = 15 * 60 + 20;   // 15:20 동시호가 시작
  if (feMin == null || feMin >= closeMin) {
    items.push(warn('forceExit', '강제청산 시각', `${fe || '없음'} — 동시호가에 걸리면 원하는 가격에 못 팔 수 있습니다.`,
      '15:15 이전으로 두는 편이 안전합니다.'));
  } else {
    items.push(ok('forceExit', '강제청산 시각', `${fe} 이후 신규 진입 금지 + 보유분 청산`));
  }

  /* ── 7. 킬스위치가 눌려 있지 않은가 ───────────────────────────── */
  if (st.killed) {
    items.push(fail('kill', '킬스위치', `눌린 상태입니다: ${st.killReason}`,
      '원인을 확인한 뒤 해제하세요.'));
  } else {
    items.push(ok('kill', '킬스위치', '정상 (필요하면 언제든 즉시 정지)'));
  }

  /* ── 8. 지금 거래 시간대인가 ──────────────────────────────────── */
  const win = sessions.windowNow('KR');
  const phase = C.marketPhase();
  if (phase !== 'regular') {
    items.push(warn('session', '장 상태', `${phaseText(phase)} — 지금은 신규 진입이 막혀 있습니다.`,
      '정규장(09:00~15:20)에 다시 확인하세요.'));
  } else if (win.window && win.window.quality === 'avoid') {
    items.push(warn('session', '거래 시간대', `${win.window.label} — 거래가 마르는 구간입니다.`,
      win.window.why));
  } else if (win.window) {
    items.push(ok('session', '거래 시간대', `${win.window.label} (${win.minutesLeft}분 남음)`));
  } else {
    items.push(ok('session', '거래 시간대', '정규장 (주요 구간은 아님)'));
  }

  /* ── 9. 실전 발주가 실제로 열려 있는가 ────────────────────────── */
  const armed = !cfg.dryRun && (client.paper || client.mock || cfg.allowLive);
  if (cfg.dryRun) {
    items.push(ok('armed', '주문 발사 상태', '모의 실행 — 주문이 나가지 않습니다. 연습에 안전합니다.'));
  } else if (!client.paper && !cfg.allowLive) {
    items.push(warn('armed', '주문 발사 상태', '실전 계좌인데 실전 주문 허용이 꺼져 있어 진입이 막힙니다.',
      '의도한 상태가 맞는지 확인하세요.'));
  } else {
    items.push(warn('armed', '주문 발사 상태', `⚠️ ${mode} 계좌에 실제 주문이 나갑니다.`,
      '킬스위치 위치를 미리 확인해 두세요.'));
  }

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const it of items) counts[it.level]++;

  return {
    mode,
    items,
    counts,
    ready: counts.fail === 0,
    verdict: counts.fail > 0
      ? `실전 준비가 안 됐습니다. 반드시 고쳐야 할 항목이 ${counts.fail}개 있습니다.`
      : counts.warn > 0
        ? `실행은 가능하지만 확인할 항목이 ${counts.warn}개 있습니다.`
        : '모든 항목을 통과했습니다.',
  };
}

function describeExit(cfg) {
  if (cfg.exitBasis === 'percent') return `손절 -${cfg.stopLossPct}% / 목표 +${cfg.takeProfitPct}%`;
  if (cfg.exitBasis === 'amount') return `손절 -${(cfg.stopLossWon || 0).toLocaleString()}원 / 목표 +${(cfg.takeProfitWon || 0).toLocaleString()}원`;
  if (cfg.exitBasis === 'ticks') return `손절 -${cfg.stopTicks}호가 / 목표 +${cfg.takeProfitTicks}호가`;
  return '신호 자동';
}

const PHASE = {
  preopen: '장전 동시호가', regular: '정규장', closeauction: '장마감 동시호가',
  after: '시간외', closed: '장 마감',
};
const phaseText = (p) => PHASE[p] || p;

module.exports = { check };
