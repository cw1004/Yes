'use strict';
/**
 * KIS 실시간 WebSocket 클라이언트.
 *
 *  - H0STCNT0 실시간 체결가  → 초봉 집계의 원천 데이터
 *  - H0STASP0 실시간 호가    → 호가창, 호가 불균형 신호
 *  - H0STCNI0/9 체결통보     → 자동매매 체결 반영 (AES256-CBC 복호화 필요)
 *
 * 한 세션당 실시간 등록은 41건까지다 (종목 × TR 조합 기준).
 * Node 22의 내장 WebSocket을 쓰므로 추가 패키지가 필요 없다.
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const C = require('../kr/config');

const MAX_SUBSCRIPTIONS = 41;

/** H0STCNT0 실시간 체결 필드 순서 (KIS 문서 기준) */
const TRADE_FIELDS = [
  'code', 'time', 'price', 'sign', 'change', 'changePct', 'vwap',
  'open', 'high', 'low', 'ask1', 'bid1', 'tradeVol', 'accVol', 'accValue',
  'sellCount', 'buyCount', 'netCount', 'strength', 'sellQty', 'buyQty',
  'tickType', 'buyRate', 'prevVolRate', 'openTime', 'openSign', 'openChange',
  'highTime', 'highSign', 'highChange', 'lowTime', 'lowSign', 'lowChange',
  'bizDate', 'marketOper', 'tradeHaltYn',
];
const TRADE_FIELD_COUNT = TRADE_FIELDS.length;

/** H0STASP0 실시간 호가: 코드/시각/구분 뒤에 매도호가10, 매수호가10, 매도잔량10, 매수잔량10 */
const ORDERBOOK_HEAD = 3;
const ORDERBOOK_FIELD_COUNT = 59;

class KisRealtime extends EventEmitter {
  /** @param {import('./kis').KisClient} client */
  constructor(client) {
    super();
    this.client = client;
    this.ws = null;
    this.subs = new Map();        // "TR|code" → {trId, code}
    this.crypto = null;           // 체결통보 복호화용 { key, iv }
    this.status = 'idle';         // idle | connecting | open | closed
    this.retry = 0;
    this.closedByUser = false;
    this.lastMessageAt = 0;
  }

  get subscriptionCount() {
    return this.subs.size;
  }

  async connect() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('이 Node 버전에는 내장 WebSocket이 없습니다. Node 22 이상에서 실행하세요.');
    }
    if (this.ws && (this.status === 'open' || this.status === 'connecting')) return;
    this.closedByUser = false;
    this._setStatus('connecting');

    const approvalKey = await this.client.getApprovalKey();
    this.approvalKey = approvalKey;

    const ws = new WebSocket(this.client.env.ws);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retry = 0;
      this._setStatus('open');
      // 재접속이면 기존 구독을 모두 복구한다
      for (const sub of this.subs.values()) this._send(sub.trId, sub.code, '1');
    });

    ws.addEventListener('message', (ev) => {
      this.lastMessageAt = Date.now();
      try {
        this._handle(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch (err) {
        this.emit('error', err);
      }
    });

    ws.addEventListener('close', () => {
      this._setStatus('closed');
      if (!this.closedByUser) this._scheduleReconnect();
    });

    ws.addEventListener('error', (err) => {
      this.emit('error', new Error('WebSocket 오류: ' + (err && err.message ? err.message : 'unknown')));
    });
  }

  _setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  _scheduleReconnect() {
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    setTimeout(() => {
      if (!this.closedByUser) this.connect().catch((e) => this.emit('error', e));
    }, delay);
  }

  close() {
    this.closedByUser = true;
    if (this.ws) try { this.ws.close(); } catch (_) {}
    this.ws = null;
    this._setStatus('idle');
  }

  /* -------------------------------------------------------------- 구독 */

  subscribe(trId, code) {
    const key = trId + '|' + code;
    if (this.subs.has(key)) return true;
    if (this.subs.size >= MAX_SUBSCRIPTIONS) {
      this.emit('error', new Error(`실시간 등록 한도(${MAX_SUBSCRIPTIONS}건)를 넘었습니다.`));
      return false;
    }
    this.subs.set(key, { trId, code });
    if (this.status === 'open') this._send(trId, code, '1');
    return true;
  }

  unsubscribe(trId, code) {
    const key = trId + '|' + code;
    if (!this.subs.delete(key)) return;
    if (this.status === 'open') this._send(trId, code, '2');
  }

  /** 한 종목의 체결+호가를 함께 구독 */
  watch(code) {
    this.subscribe(C.TR.wsTrade, code);
    this.subscribe(C.TR.wsOrderbook, code);
  }
  unwatch(code) {
    this.unsubscribe(C.TR.wsTrade, code);
    this.unsubscribe(C.TR.wsOrderbook, code);
  }

  /** 체결통보 구독 (자동매매용). tr_key 는 HTS ID */
  watchNotice(htsId) {
    const trId = this.client.paper ? C.TR.wsNoticePaper : C.TR.wsNoticeReal;
    this.subscribe(trId, htsId);
  }

  _send(trId, trKey, trType) {
    if (!this.ws || this.status !== 'open') return;
    this.ws.send(JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: trType,
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: trId, tr_key: trKey } },
    }));
  }

  /* -------------------------------------------------------------- 수신 */

  _handle(raw) {
    if (!raw) return;
    // 제어 메시지(구독 응답, PINGPONG)는 JSON
    if (raw[0] === '{') {
      const msg = JSON.parse(raw);
      const trId = msg.header && msg.header.tr_id;
      if (trId === 'PINGPONG') {
        if (this.ws) this.ws.send(raw); // 받은 그대로 되돌려줘야 연결이 유지된다
        return;
      }
      const body = msg.body || {};
      if (body.output && body.output.key && body.output.iv) {
        this.crypto = { key: body.output.key, iv: body.output.iv };
      }
      this.emit('control', { trId, code: body.msg_cd, message: body.msg1 });
      if (body.rt_cd && body.rt_cd !== '0' && body.rt_cd !== '7') {
        this.emit('error', new Error(`실시간 등록 실패 [${body.msg_cd}] ${body.msg1}`));
      }
      return;
    }

    // 실시간 데이터: 암호화여부|TR_ID|건수|페이로드
    const parts = raw.split('|');
    if (parts.length < 4) return;
    const [encrypted, trId, countStr, payloadRaw] = parts;
    const count = Number(countStr) || 1;
    const payload = encrypted === '1' ? this._decrypt(payloadRaw) : payloadRaw;
    if (!payload) return;

    if (trId === C.TR.wsTrade) this._handleTrades(payload, count);
    else if (trId === C.TR.wsOrderbook) this._handleOrderbook(payload);
    else if (trId === C.TR.wsNoticeReal || trId === C.TR.wsNoticePaper) this._handleNotice(payload);
  }

  _decrypt(b64) {
    if (!this.crypto) return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.crypto.key, this.crypto.iv);
      return decipher.update(b64, 'base64', 'utf8') + decipher.final('utf8');
    } catch (err) {
      this.emit('error', new Error('체결통보 복호화 실패: ' + err.message));
      return '';
    }
  }

  _handleTrades(payload, count) {
    const f = payload.split('^');
    for (let n = 0; n < count; n++) {
      const base = n * TRADE_FIELD_COUNT;
      if (f.length < base + 14) break;
      const g = (i) => f[base + i];
      const tick = {
        code: g(0),
        time: g(1),                       // HHMMSS (KST)
        t: hmsToEpoch(g(1)),
        price: +g(2) || 0,
        change: +g(4) || 0,
        changePct: +g(5) || 0,
        open: +g(7) || 0,
        high: +g(8) || 0,
        low: +g(9) || 0,
        ask1: +g(10) || 0,
        bid1: +g(11) || 0,
        volume: +g(12) || 0,              // 이번 체결 수량
        accVolume: +g(13) || 0,
        accValue: +g(14) || 0,
        strength: +g(18) || 0,            // 체결강도
        // 체결구분: 1=매수(상승틱) 5=매도(하락틱)  → 초단타 수급 판단의 핵심
        side: g(21) === '1' ? 'buy' : g(21) === '5' ? 'sell' : 'flat',
        halt: g(35) === 'Y',
      };
      if (!tick.price) continue;
      this.emit('trade', tick);
    }
  }

  _handleOrderbook(payload) {
    const f = payload.split('^');
    if (f.length < ORDERBOOK_HEAD + 40) return;
    const asks = [];
    const bids = [];
    for (let i = 0; i < 10; i++) {
      asks.push({ price: +f[ORDERBOOK_HEAD + i] || 0, qty: +f[ORDERBOOK_HEAD + 20 + i] || 0 });
      bids.push({ price: +f[ORDERBOOK_HEAD + 10 + i] || 0, qty: +f[ORDERBOOK_HEAD + 30 + i] || 0 });
    }
    this.emit('orderbook', {
      code: f[0],
      time: f[1],
      asks,
      bids,
      totalAsk: +f[ORDERBOOK_HEAD + 40] || 0,
      totalBid: +f[ORDERBOOK_HEAD + 41] || 0,
    });
  }

  _handleNotice(payload) {
    const f = payload.split('^');
    // 체결통보: 고객ID^계좌^주문번호^원주문번호^매도매수구분^정정구분^주문종류^주문조건^종목코드^체결수량^체결단가^...
    this.emit('notice', {
      accountId: f[0],
      orderNo: f[2],
      originalOrderNo: f[3],
      side: f[4] === '02' ? 'buy' : 'sell',   // 01 매도 / 02 매수
      code: (f[8] || '').trim(),
      qty: +f[9] || 0,
      price: +f[10] || 0,
      time: f[11] || '',
      // 체결여부: 2=주문접수, 1=체결
      filled: f[13] === '1' || f[12] === '1',
      raw: f,
    });
  }
}

/** HHMMSS(KST) → 오늘 날짜의 epoch ms */
function hmsToEpoch(hms) {
  const s = String(hms || '').padStart(6, '0');
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return Date.UTC(
    kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(),
    +s.slice(0, 2) - 9, +s.slice(2, 4), +s.slice(4, 6)
  );
}

module.exports = { KisRealtime, MAX_SUBSCRIPTIONS, TRADE_FIELDS, hmsToEpoch };
