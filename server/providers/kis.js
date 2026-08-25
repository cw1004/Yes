'use strict';
/**
 * 한국투자증권 OpenAPI REST 클라이언트.
 *
 * - 접근토큰은 24시간 유효하고 발급이 분당 1회로 제한되므로 파일에 캐시해 재기동해도 재사용한다.
 * - 유량(실전 초당 20건 / 모의 초당 2건)을 넘지 않도록 토큰버킷으로 스스로 조절한다.
 * - 자격증명은 환경변수로만 받는다. 절대 코드나 저장소에 넣지 않는다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../kr/config');

const TOKEN_CACHE = path.join(__dirname, '..', '..', '.kis-token.json');

class RateLimiter {
  constructor(perSecond) {
    this.capacity = perSecond;
    this.tokens = perSecond;
    this.last = Date.now();
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.capacity);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil((1 - this.tokens) / this.capacity * 1000)));
    }
  }
}

class KisError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'KisError';
    this.detail = detail || {};
  }
}

class KisClient {
  /**
   * @param {{appKey:string, appSecret:string, account:string, paper:boolean}} opts
   *   account 는 "12345678-01" 형식(종합계좌번호-상품코드)
   */
  constructor(opts = {}) {
    this.appKey = opts.appKey || process.env.KIS_APP_KEY || '';
    this.appSecret = opts.appSecret || process.env.KIS_APP_SECRET || '';
    const acct = opts.account || process.env.KIS_ACCOUNT || '';
    const [cano, prdt] = acct.split('-');
    this.cano = cano || '';
    this.acntPrdtCd = prdt || '01';
    this.paper = opts.paper != null ? opts.paper : process.env.KIS_PAPER !== '0';
    this.env = this.paper ? C.PAPER : C.REAL;
    this.limiter = new RateLimiter(this.env.restPerSecond);
    this.token = null;         // { value, expiresAt }
    this.approvalKey = null;
    this._tokenPromise = null;
  }

  get configured() {
    return Boolean(this.appKey && this.appSecret);
  }
  get tradable() {
    return Boolean(this.configured && this.cano);
  }
  /** 실전/모의에 맞는 TR_ID 선택 */
  tr(entry) {
    if (typeof entry === 'string') return entry;
    return this.paper ? entry.paper : entry.real;
  }

  /* ------------------------------------------------------------ 인증 */

  _cacheKey() {
    return crypto.createHash('sha256').update(this.appKey + (this.paper ? ':P' : ':R')).digest('hex').slice(0, 16);
  }

  _readCachedToken() {
    try {
      const all = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
      const hit = all[this._cacheKey()];
      // 만료 10분 전이면 새로 받는다
      if (hit && hit.expiresAt - Date.now() > 600e3) return hit;
    } catch (_) {}
    return null;
  }

  _writeCachedToken(tok) {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')); } catch (_) {}
    all[this._cacheKey()] = tok;
    try {
      fs.writeFileSync(TOKEN_CACHE, JSON.stringify(all), { mode: 0o600 });
    } catch (err) {
      console.warn('[KIS] 토큰 캐시 저장 실패:', err.message);
    }
  }

  async getToken() {
    if (!this.configured) throw new KisError('KIS_APP_KEY / KIS_APP_SECRET 환경변수가 없습니다.');
    if (this.token && this.token.expiresAt - Date.now() > 600e3) return this.token.value;
    const cached = this._readCachedToken();
    if (cached) {
      this.token = cached;
      return cached.value;
    }
    // 동시에 여러 요청이 토큰을 받으려 하면 한 번만 발급한다 (분당 1회 제한)
    if (!this._tokenPromise) {
      this._tokenPromise = this._issueToken().finally(() => { this._tokenPromise = null; });
    }
    return this._tokenPromise;
  }

  async _issueToken() {
    const res = await fetch(this.env.rest + C.PATH.token, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new KisError('접근토큰 발급 실패: ' + (json.error_description || json.msg1 || res.status), json);
    }
    const ttl = (Number(json.expires_in) || 86400) * 1000;
    this.token = { value: json.access_token, expiresAt: Date.now() + ttl };
    this._writeCachedToken(this.token);
    return this.token.value;
  }

  /** WebSocket 접속용 승인키 (토큰과 별개) */
  async getApprovalKey() {
    if (this.approvalKey) return this.approvalKey;
    if (!this.configured) throw new KisError('KIS 자격증명이 없습니다.');
    const res = await fetch(this.env.rest + C.PATH.approval, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        secretkey: this.appSecret,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.approval_key) throw new KisError('WebSocket 승인키 발급 실패', json);
    this.approvalKey = json.approval_key;
    return this.approvalKey;
  }

  /* ------------------------------------------------------------ 공통 호출 */

  async _headers(trId, extra = {}) {
    const token = await this.getToken();
    return {
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer ' + token,
      appkey: this.appKey,
      appsecret: this.appSecret,
      tr_id: trId,
      custtype: 'P',
      ...extra,
    };
  }

  async get(pathname, params, trId, timeoutMs = 8000) {
    await this.limiter.take();
    const url = new URL(this.env.rest + pathname);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: await this._headers(trId), signal: ctrl.signal });
      const json = await res.json().catch(() => ({}));
      if (json.rt_cd && json.rt_cd !== '0') {
        throw new KisError(`[${json.msg_cd}] ${json.msg1 || 'KIS 오류'}`, json);
      }
      if (!res.ok) throw new KisError('HTTP ' + res.status, json);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async post(pathname, body, trId, extraHeaders = {}, timeoutMs = 8000) {
    await this.limiter.take();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.env.rest + pathname, {
        method: 'POST',
        headers: await this._headers(trId, extraHeaders),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (json.rt_cd && json.rt_cd !== '0') {
        throw new KisError(`[${json.msg_cd}] ${json.msg1 || 'KIS 오류'}`, json);
      }
      if (!res.ok) throw new KisError('HTTP ' + res.status, json);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 주문 등 위변조 방지용 해시키 */
  async hashkey(body) {
    await this.limiter.take();
    const res = await fetch(this.env.rest + C.PATH.hashkey, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        appkey: this.appKey,
        appsecret: this.appSecret,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return json.HASH || '';
  }

  /* ------------------------------------------------------------ 시세 조회 */

  /** 현재가 시세 */
  async price(code) {
    const json = await this.get(C.PATH.price, {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code,
    }, C.TR.price);
    const o = json.output || {};
    return {
      code,
      name: o.rprs_mrkt_kor_name || '',
      price: num(o.stck_prpr),
      open: num(o.stck_oprc),
      high: num(o.stck_hgpr),
      low: num(o.stck_lwpr),
      previousClose: num(o.stck_prpr) - num(o.prdy_vrss),
      change: num(o.prdy_vrss),
      changePercent: num(o.prdy_ctrt),
      volume: num(o.acml_vol),
      value: num(o.acml_tr_pbmn),
      upperLimit: num(o.stck_mxpr),
      lowerLimit: num(o.stck_llam),
      market: (o.rprs_mrkt_kor_name || '').includes('코스닥') ? 'KOSDAQ' : 'KOSPI',
      per: num(o.per), pbr: num(o.pbr),
      // 체결강도: 매수체결량/매도체결량 비율(%)
      strength: num(o.cttr),
      vi: o.vi_cls_code || '',
    };
  }

  /** 호가 10단계 + 예상체결 */
  async orderbook(code) {
    const json = await this.get(C.PATH.orderbook, {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code,
    }, C.TR.orderbook);
    const o = json.output1 || {};
    const o2 = json.output2 || {};
    const asks = [];
    const bids = [];
    for (let i = 1; i <= 10; i++) {
      asks.push({ price: num(o[`askp${i}`]), qty: num(o[`askp_rsqn${i}`]) });
      bids.push({ price: num(o[`bidp${i}`]), qty: num(o[`bidp_rsqn${i}`]) });
    }
    return {
      code,
      time: o.aspr_acpt_hour || '',
      asks,
      bids,
      totalAsk: num(o.total_askp_rsqn),
      totalBid: num(o.total_bidp_rsqn),
      expectedPrice: num(o2.antc_cnpr),
      expectedQty: num(o2.antc_cntg_vrss),
    };
  }

  /**
   * 당일 분봉 (1분 단위). KIS는 한 번에 30건만 주므로 시각을 거슬러 올라가며 여러 번 호출한다.
   * @param {string} code 종목코드
   * @param {number} count 원하는 봉 개수
   */
  async minuteCandles(code, count = 120) {
    const out = [];
    let cursor = ''; // 빈 값이면 현재 시각부터
    const rounds = Math.ceil(count / 30);
    for (let r = 0; r < rounds; r++) {
      const json = await this.get(C.PATH.minuteChart, {
        FID_ETC_CLS_CODE: '',
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code,
        FID_INPUT_HOUR_1: cursor,
        FID_PW_DATA_INCU_YN: 'N',
      }, C.TR.minuteChart);
      const rows = json.output2 || [];
      if (!rows.length) break;
      for (const row of rows) {
        const t = parseKisTime(row.stck_bsop_date, row.stck_cntg_hour);
        if (!t) continue;
        out.push({
          t,
          o: num(row.stck_oprc),
          h: num(row.stck_hgpr),
          l: num(row.stck_lwpr),
          c: num(row.stck_prpr),
          v: num(row.cntg_vol),
        });
      }
      // 가장 이른 봉의 1분 전부터 다음 조회
      const earliest = rows[rows.length - 1];
      const hhmmss = String(earliest.stck_cntg_hour || '');
      if (hhmmss.length !== 6) break;
      const prev = new Date(parseKisTime(earliest.stck_bsop_date, hhmmss) - 60000);
      cursor = pad2(prev.getHours()) + pad2(prev.getMinutes()) + pad2(prev.getSeconds());
      if (out.length >= count) break;
    }
    // 시간 오름차순 + 중복 제거
    const seen = new Set();
    return out
      .filter((c) => (seen.has(c.t) ? false : seen.add(c.t)))
      .sort((a, b) => a.t - b.t)
      .slice(-count);
  }

  /* ------------------------------------------------------------ 주문/계좌 */

  /**
   * 현금 주문.
   * @param {{code:string, side:'buy'|'sell', qty:number, price?:number, ordDvsn?:string}} req
   */
  async order(req) {
    if (!this.tradable) throw new KisError('KIS_ACCOUNT(계좌번호) 환경변수가 없어 주문할 수 없습니다.');
    const ordDvsn = req.ordDvsn || (req.price ? C.ORD_DVSN.지정가 : C.ORD_DVSN.시장가);
    const body = {
      CANO: this.cano,
      ACNT_PRDT_CD: this.acntPrdtCd,
      PDNO: req.code,
      ORD_DVSN: ordDvsn,
      ORD_QTY: String(Math.floor(req.qty)),
      ORD_UNPR: String(ordDvsn === C.ORD_DVSN.시장가 ? 0 : Math.round(req.price || 0)),
    };
    const trEntry = req.side === 'buy' ? C.TR.orderBuy : C.TR.orderSell;
    const hash = await this.hashkey(body).catch(() => '');
    const json = await this.post(C.PATH.orderCash, body, this.tr(trEntry), hash ? { hashkey: hash } : {});
    const o = json.output || {};
    return {
      ok: true,
      orderNo: o.ODNO || '',
      orgNo: o.KRX_FWDG_ORD_ORGNO || '',
      time: o.ORD_TMD || '',
      message: json.msg1 || '',
      request: { ...req, ordDvsn },
    };
  }

  /** 주문 취소 (미체결 잔량 전량) */
  async cancel(orderNo, orgNo, qty) {
    if (!this.tradable) throw new KisError('계좌번호가 없어 취소할 수 없습니다.');
    const body = {
      CANO: this.cano,
      ACNT_PRDT_CD: this.acntPrdtCd,
      KRX_FWDG_ORD_ORGNO: orgNo || '',
      ORGN_ODNO: orderNo,
      ORD_DVSN: C.ORD_DVSN.지정가,
      RVSE_CNCL_DVSN_CD: '02',      // 02 = 취소
      ORD_QTY: String(qty || 0),
      ORD_UNPR: '0',
      QTY_ALL_ORD_YN: qty ? 'N' : 'Y',
    };
    const hash = await this.hashkey(body).catch(() => '');
    const json = await this.post(C.PATH.orderCancel, body, this.tr(C.TR.orderCancel), hash ? { hashkey: hash } : {});
    return { ok: true, message: json.msg1 || '', output: json.output || {} };
  }

  /** 주식 잔고 */
  async balance() {
    if (!this.tradable) throw new KisError('계좌번호가 없어 잔고를 조회할 수 없습니다.');
    const json = await this.get(C.PATH.balance, {
      CANO: this.cano,
      ACNT_PRDT_CD: this.acntPrdtCd,
      AFHR_FLPR_YN: 'N',
      OFL_YN: '',
      INQR_DVSN: '02',
      UNPR_DVSN: '01',
      FUND_STTL_ICLD_YN: 'N',
      FNCG_AMT_AUTO_RDPT_YN: 'N',
      PRCS_DVSN: '00',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    }, this.tr(C.TR.balance));
    const positions = (json.output1 || [])
      .filter((r) => num(r.hldg_qty) > 0)
      .map((r) => ({
        code: r.pdno,
        name: r.prdt_name,
        qty: num(r.hldg_qty),
        available: num(r.ord_psbl_qty),
        avgPrice: num(r.pchs_avg_pric),
        price: num(r.prpr),
        pnl: num(r.evlu_pfls_amt),
        pnlPct: num(r.evlu_pfls_rt),
      }));
    const s = (json.output2 || [])[0] || {};
    return {
      positions,
      cash: num(s.dnca_tot_amt),          // 예수금
      orderableCash: num(s.nxdy_excc_amt), // 익일 정산 기준 주문가능
      totalEval: num(s.tot_evlu_amt),
      totalPnl: num(s.evlu_pfls_smtl_amt),
    };
  }

  /** 매수 가능 수량/금액 */
  async orderable(code, price) {
    if (!this.tradable) throw new KisError('계좌번호가 없습니다.');
    const json = await this.get(C.PATH.orderable, {
      CANO: this.cano,
      ACNT_PRDT_CD: this.acntPrdtCd,
      PDNO: code,
      ORD_UNPR: String(Math.round(price || 0)),
      ORD_DVSN: price ? C.ORD_DVSN.지정가 : C.ORD_DVSN.시장가,
      CMA_EVLU_AMT_ICLD_YN: 'N',
      OVRS_ICLD_YN: 'N',
    }, this.tr(C.TR.orderable));
    const o = json.output || {};
    return {
      cash: num(o.ord_psbl_cash),
      maxQty: num(o.nrcvb_buy_qty || o.max_buy_qty),
      maxAmount: num(o.nrcvb_buy_amt || o.max_buy_amt),
    };
  }
}

/* ------------------------------------------------------------------ 유틸 */

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
const pad2 = (n) => String(n).padStart(2, '0');

/** KIS의 YYYYMMDD + HHMMSS (KST) → epoch ms */
function parseKisTime(ymd, hms) {
  const d = String(ymd || '');
  const t = String(hms || '').padStart(6, '0');
  if (d.length !== 8) {
    // 날짜가 없으면 오늘(KST) 기준
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
    return kstToEpoch(kst.getFullYear(), kst.getMonth() + 1, kst.getDate(), t);
  }
  return kstToEpoch(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8), t);
}

/** KST 벽시계 시각 → epoch ms (UTC+9 고정, 한국은 서머타임 없음) */
function kstToEpoch(y, m, d, hms) {
  const hh = +hms.slice(0, 2);
  const mm = +hms.slice(2, 4);
  const ss = +hms.slice(4, 6);
  return Date.UTC(y, m - 1, d, hh - 9, mm, ss);
}

module.exports = { KisClient, KisError, parseKisTime, kstToEpoch, num };
