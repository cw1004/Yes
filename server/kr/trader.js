'use strict';
/**
 * 초단타 자동매매 엔진.
 *
 * ▶ 주문이 실제로 나가려면 아래 관문을 "전부" 통과해야 한다.
 *    1) 엔진 enabled = true
 *    2) 킬스위치가 눌리지 않았을 것
 *    3) 정규장 시간일 것 (동시호가·시간외 진입 금지)
 *    4) dryRun = false      ← 기본값은 true(모의 실행)라 켜기 전엔 주문이 나가지 않는다
 *    5) 실전 계좌라면 allowLive = true 까지 명시적으로 켜져 있을 것
 *    6) 일일 손실한도 / 일일 주문수 / 동시 보유종목 / 1회 투입액 한도 이내일 것
 *    7) 같은 종목에 진행 중인 주문이 없을 것 (중복 발주 방지)
 *
 * 어느 하나라도 막히면 주문 대신 사유가 로그에 남는다.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const C = require('./config');
const KRSignal = require('../../public/js/kr-signal.js');

const BASE_DIR = process.env.KR_STATE_DIR || path.join(__dirname, '..', '..');
const STATE_FILE = path.join(BASE_DIR, '.kr-trader.json');
const LOG_DIR = path.join(BASE_DIR, 'logs');

const DEFAULT_CONFIG = {
  enabled: false,
  dryRun: true,             // 실제 주문 대신 시뮬레이션
  allowLive: false,         // 실전 계좌 발주 허용 (모의계좌에는 영향 없음)
  symbols: [],
  timeframe: '10s',         // 진입 판단 주기
  entryScore: 45,           // 이 점수 이상이면 매수 진입
  exitScore: -15,           // 보유 중 점수가 이 아래로 떨어지면 청산
  maxPositions: 2,
  orderAmount: 1000000,     // 1회 최대 투입액(원)
  riskPct: 0.5,             // 계좌 대비 1회 허용 손실(%)
  stopTicks: 0,             // 0이면 신호 플랜의 손절 사용
  takeProfitTicks: 0,       // 0이면 신호 플랜의 목표 사용
  trailingTicks: 0,         // >0이면 고점 대비 N틱 밀리면 청산
  maxHoldSeconds: 180,      // 이 시간 넘으면 무조건 청산 (초단타)
  dailyLossLimit: 300000,   // 하루 실현손실이 이만큼이면 킬스위치 자동 발동
  dailyProfitTarget: 0,     // >0이면 목표 달성 시 자동 중단
  maxOrdersPerDay: 60,
  cooldownSeconds: 30,      // 청산 후 같은 종목 재진입 금지 시간
  minSpreadTicks: 3,        // 스프레드가 이 이상이면 진입 안 함
  minFlowTicks: 2,          // 봉당 체결건수가 이보다 적으면 진입 안 함
  forceExitAt: '15:15',     // 이 시각(KST) 이후에는 신규 진입 금지 + 보유분 청산
  entryOrdDvsn: C.ORD_DVSN.최유리지정가,
  exitOrdDvsn: C.ORD_DVSN.시장가,
};

class Trader extends EventEmitter {
  /**
   * @param {{hub:object, client:object}} deps
   */
  constructor({ hub, client }) {
    super();
    this.hub = hub;
    this.client = client;
    this.config = Object.assign({}, DEFAULT_CONFIG);
    this.positions = new Map();   // code → 포지션
    this.cooldowns = new Map();   // code → 재진입 가능 시각
    this.inFlight = new Set();    // 주문 진행 중인 종목
    this.killed = false;
    this.killReason = '';
    this.daily = this._freshDaily();
    this.logs = [];               // 최근 200건 (화면 표시용)
    this._load();

    this.hub.on('bar', (tf, bar, st) => this._onBar(tf, bar, st));
    this.hub.on('tick', (tick, st) => this._onTick(tick, st));

    // 보유분 시간 초과·강제청산은 틱이 없어도 확인해야 한다
    this.timer = setInterval(() => this._housekeeping(), 1000);
    if (this.timer.unref) this.timer.unref();
  }

  /* ------------------------------------------------------------ 상태 */

  _freshDaily() {
    return { date: kstDate(), orders: 0, realizedPnl: 0, wins: 0, losses: 0, fees: 0 };
  }

  _rollDaily() {
    if (this.daily.date !== kstDate()) {
      this.daily = this._freshDaily();
      this.killed = false;
      this.killReason = '';
      this._save();
    }
  }

  status() {
    this._rollDaily();
    return {
      config: this.config,
      killed: this.killed,
      killReason: this.killReason,
      daily: this.daily,
      phase: C.marketPhase(),
      accountMode: this.client.mock ? '데모' : this.client.paper ? '모의투자' : '실전',
      liveArmed: !this.config.dryRun && (this.client.paper || this.client.mock || this.config.allowLive),
      positions: Array.from(this.positions.values()),
      cooldowns: Object.fromEntries(this.cooldowns),
      logs: this.logs.slice(-60),
    };
  }

  setConfig(patch) {
    const next = Object.assign({}, this.config, patch || {});
    // 숫자 항목 정리 및 하한/상한
    next.entryScore = clamp(num(next.entryScore, 45), 10, 100);
    next.exitScore = clamp(num(next.exitScore, -15), -100, 50);
    next.maxPositions = clamp(Math.floor(num(next.maxPositions, 2)), 1, 10);
    next.orderAmount = Math.max(0, num(next.orderAmount, 1000000));
    next.riskPct = clamp(num(next.riskPct, 0.5), 0.05, 10);
    next.maxHoldSeconds = clamp(Math.floor(num(next.maxHoldSeconds, 180)), 5, 3600);
    next.dailyLossLimit = Math.max(0, num(next.dailyLossLimit, 300000));
    next.maxOrdersPerDay = clamp(Math.floor(num(next.maxOrdersPerDay, 60)), 1, 500);
    next.cooldownSeconds = clamp(Math.floor(num(next.cooldownSeconds, 30)), 0, 3600);
    next.symbols = (next.symbols || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10);

    const wasLive = this.config.allowLive;
    this.config = next;
    if (!wasLive && next.allowLive) {
      this._log('warn', 'ALLOW_LIVE', '실전 주문 전송이 허용되었습니다.');
    }
    for (const code of next.symbols) this.hub.watch(code).then(() => this.hub.pin(code, true)).catch(() => {});
    this._save();
    return this.status();
  }

  /** 킬스위치: 즉시 중단. closePositions=true면 보유분 시장가 청산까지 시도 */
  async kill(reason = '수동 정지', closePositions = true) {
    this.killed = true;
    this.killReason = reason;
    this.config.enabled = false;
    this._log('warn', 'KILL', `킬스위치 발동: ${reason}`);
    this._save();
    if (closePositions) {
      for (const code of Array.from(this.positions.keys())) {
        await this._exit(code, '킬스위치 청산').catch((e) => this._log('error', 'EXIT_FAIL', `${code} 청산 실패: ${e.message}`));
      }
    }
    this.emit('changed');
    return this.status();
  }

  resume() {
    this.killed = false;
    this.killReason = '';
    this._log('info', 'RESUME', '킬스위치를 해제했습니다.');
    this._save();
    return this.status();
  }

  /* ------------------------------------------------------------ 판단 */

  _onBar(tf, bar, st) {
    if (tf !== this.config.timeframe) return;
    if (!this._tradingAllowed()) return;
    if (!this.config.symbols.includes(st.code)) return;
    this._evaluate(st).catch((e) => this._log('error', 'EVAL', `${st.code} 판단 오류: ${e.message}`));
  }

  _onTick(tick, st) {
    const pos = this.positions.get(st.code);
    if (!pos || pos.status !== 'open') return;
    pos.last = tick.price;
    pos.high = Math.max(pos.high, tick.price);
    pos.low = Math.min(pos.low, tick.price);

    const tickSize = C.tickSize(pos.entry, st.market || 'KOSPI');
    let reason = null;
    if (tick.price <= pos.stop) reason = '손절';
    else if (pos.target && tick.price >= pos.target) reason = '목표 도달';
    else if (this.config.trailingTicks > 0) {
      const trail = pos.high - this.config.trailingTicks * tickSize;
      if (tick.price <= trail && pos.high > pos.entry) reason = '트레일링 스탑';
    }
    if (reason) this._exit(st.code, reason).catch((e) => this._log('error', 'EXIT_FAIL', `${st.code} ${e.message}`));
  }

  async _evaluate(st) {
    const candles = st.agg.getCandles(this.config.timeframe);
    if (candles.length < 30) return; // 초봉이 충분히 쌓이기 전엔 판단하지 않는다

    const analysis = KRSignal.analyze(candles);
    const signal = KRSignal.evaluate(analysis, {
      orderbook: st.orderbook,
      flow: st.agg.recentStats('10s', 6),
      quote: st.quote,
      market: st.market || 'KOSPI',
    });
    st.signal = signal;

    const pos = this.positions.get(st.code);
    if (pos && pos.status === 'open') {
      if (signal.score <= this.config.exitScore) {
        await this._exit(st.code, `신호 악화(${signal.score})`);
      }
      return;
    }
    if (signal.score < this.config.entryScore) return;

    const plan = signal.plan;
    if (!plan || plan.side !== 'LONG') return;   // 공매도는 취급하지 않는다
    if (!plan.viable) {
      this._log('info', 'SKIP', `${st.code} 진입 보류: ${plan.note}`);
      return;
    }
    const spread = signal.stats.spreadTicks;
    if (spread != null && spread >= this.config.minSpreadTicks) {
      this._log('info', 'SKIP', `${st.code} 진입 보류: 스프레드 ${spread}호가`);
      return;
    }
    const flow = st.agg.recentStats('10s', 6);
    if (flow && flow.ticksPerBar < this.config.minFlowTicks) {
      this._log('info', 'SKIP', `${st.code} 진입 보류: 체결 한산(봉당 ${flow.ticksPerBar.toFixed(1)}건)`);
      return;
    }
    await this._enter(st, signal);
  }

  /* ------------------------------------------------------------ 진입/청산 */

  async _enter(st, signal) {
    const code = st.code;
    const plan = signal.plan;
    const gate = this._gate(code);
    if (!gate.ok) {
      this._log('info', 'GATE', `${code} 진입 차단: ${gate.reason}`);
      return;
    }

    let cash = this.config.orderAmount;
    try {
      const bal = await this.client.balance();
      cash = Math.min(this.config.orderAmount, bal.orderableCash || bal.cash || 0);
    } catch (err) {
      this._log('warn', 'BALANCE', `잔고 조회 실패, 설정 금액으로 진행: ${err.message}`);
    }

    const sizing = KRSignal.positionSize({
      cash,
      riskPct: this.config.riskPct,
      riskPerShare: plan.riskPerShare,
      entry: plan.entry,
      maxAmount: this.config.orderAmount,
    });
    if (!sizing || sizing.qty < 1) {
      this._log('info', 'SKIP', `${code} 수량 0주 (투입 가능 ${Math.round(cash).toLocaleString()}원)`);
      return;
    }

    const stopTicks = this.config.stopTicks || plan.stopTicks;
    const tpTicks = this.config.takeProfitTicks || plan.targetTicks;
    const tick = plan.tick;

    const result = await this._placeOrder({
      code, side: 'buy', qty: sizing.qty, price: plan.entry,
      ordDvsn: this.config.entryOrdDvsn,
      why: `신호 ${signal.score}점 (${signal.label})`,
    });
    if (!result.ok) return;

    const entry = result.filledPrice || plan.entry;
    this.positions.set(code, {
      code,
      name: st.quote && st.quote.name,
      qty: sizing.qty,
      entry,
      stop: entry - stopTicks * tick,
      target: entry + tpTicks * tick,
      stopTicks, tpTicks, tick,
      entryTime: Date.now(),
      high: entry, low: entry, last: entry,
      status: result.simulated ? 'open' : 'open',   // 실주문도 즉시 관리 시작(체결통보로 정정)
      orderNo: result.orderNo,
      simulated: !!result.simulated,
      signalScore: signal.score,
    });
    this._log('trade', 'ENTRY', `${code} ${sizing.qty}주 @ ${entry.toLocaleString()} · 손절 ${stopTicks}틱 / 목표 ${tpTicks}틱 · ${result.simulated ? '모의' : '실주문'}`);
    this.emit('changed');
  }

  async _exit(code, reason) {
    const pos = this.positions.get(code);
    if (!pos || pos.status !== 'open') return;
    pos.status = 'closing';

    const st = this.hub.get(code);
    const price = (st && st.quote && st.quote.price) || pos.last || pos.entry;
    const result = await this._placeOrder({
      code, side: 'sell', qty: pos.qty, price,
      ordDvsn: this.config.exitOrdDvsn,
      why: reason,
      force: true,   // 청산은 일일 주문수 한도에 막히면 안 된다
    });

    const exitPrice = result.filledPrice || price;
    const gross = (exitPrice - pos.entry) * pos.qty;
    const fees = C.roundTripCost((pos.entry + exitPrice) / 2, pos.qty);
    const net = gross - fees;

    this.daily.realizedPnl += net;
    this.daily.fees += fees;
    if (net >= 0) this.daily.wins++; else this.daily.losses++;
    this.positions.delete(code);
    this.cooldowns.set(code, Date.now() + this.config.cooldownSeconds * 1000);

    this._log('trade', 'EXIT', `${code} ${pos.qty}주 @ ${Math.round(exitPrice).toLocaleString()} · ${reason} · 순손익 ${Math.round(net).toLocaleString()}원`);
    this._save();
    this.emit('changed');

    // 일일 손실한도 확인
    if (this.config.dailyLossLimit > 0 && this.daily.realizedPnl <= -this.config.dailyLossLimit) {
      await this.kill(`일일 손실한도 ${this.config.dailyLossLimit.toLocaleString()}원 도달`, true);
    } else if (this.config.dailyProfitTarget > 0 && this.daily.realizedPnl >= this.config.dailyProfitTarget) {
      await this.kill(`일일 목표수익 ${this.config.dailyProfitTarget.toLocaleString()}원 달성`, true);
    }
  }

  /* ------------------------------------------------------------ 안전 관문 */

  _tradingAllowed() {
    this._rollDaily();
    if (!this.config.enabled || this.killed) return false;
    if (C.marketPhase() !== 'regular') return false;
    if (this._pastForceExit()) return false;
    return true;
  }

  _pastForceExit() {
    const [h, m] = String(this.config.forceExitAt || '15:15').split(':').map(Number);
    const now = kstNow();
    return now.getUTCHours() * 60 + now.getUTCMinutes() >= h * 60 + m;
  }

  /** 진입 전 종합 점검 */
  _gate(code) {
    if (this.killed) return { ok: false, reason: `킬스위치(${this.killReason})` };
    if (!this.config.enabled) return { ok: false, reason: '엔진 꺼짐' };
    if (C.marketPhase() !== 'regular') return { ok: false, reason: '정규장 아님' };
    if (this._pastForceExit()) return { ok: false, reason: `${this.config.forceExitAt} 이후 신규 진입 금지` };
    if (this.inFlight.has(code)) return { ok: false, reason: '이미 주문 진행 중' };
    if (this.positions.has(code)) return { ok: false, reason: '이미 보유 중' };
    if (this.positions.size >= this.config.maxPositions) return { ok: false, reason: `동시 보유 한도 ${this.config.maxPositions}종목` };
    if (this.daily.orders >= this.config.maxOrdersPerDay) return { ok: false, reason: `일일 주문 한도 ${this.config.maxOrdersPerDay}건` };
    if (this.config.dailyLossLimit > 0 && this.daily.realizedPnl <= -this.config.dailyLossLimit) {
      return { ok: false, reason: '일일 손실한도 도달' };
    }
    const cd = this.cooldowns.get(code);
    if (cd && Date.now() < cd) return { ok: false, reason: `쿨다운 ${Math.ceil((cd - Date.now()) / 1000)}초` };
    return { ok: true };
  }

  /**
   * 실제 주문 전송 지점. 여기서만 client.order() 를 호출한다.
   */
  async _placeOrder(req) {
    const { code, side, qty, price, ordDvsn, why, force } = req;
    if (!force) {
      const gate = this._gate(code);
      if (!gate.ok) return { ok: false, reason: gate.reason };
    }
    if (this.inFlight.has(code)) return { ok: false, reason: '중복 주문 방지' };

    const amount = qty * price;
    if (side === 'buy' && this.config.orderAmount > 0 && amount > this.config.orderAmount * 1.02) {
      return { ok: false, reason: `1회 투입 한도 초과 (${Math.round(amount).toLocaleString()}원)` };
    }

    // ── 모의 실행 (기본값) ──────────────────────────────────────────
    if (this.config.dryRun) {
      this.daily.orders++;
      this._log('order', side === 'buy' ? 'DRY_BUY' : 'DRY_SELL',
        `[모의] ${code} ${side === 'buy' ? '매수' : '매도'} ${qty}주 @ ${Math.round(price).toLocaleString()} — ${why}`);
      return { ok: true, simulated: true, filledPrice: price, orderNo: 'DRY-' + Date.now() };
    }

    // ── 실전 계좌인데 allowLive 가 꺼져 있으면 여기서 막는다 ──────────
    const isRealAccount = !this.client.paper && !this.client.mock;
    if (isRealAccount && !this.config.allowLive) {
      this._log('warn', 'BLOCKED', `${code} 실전 주문이 차단되었습니다 (allowLive=false). 설정에서 명시적으로 켜야 전송됩니다.`);
      return { ok: false, reason: 'allowLive=false' };
    }

    this.inFlight.add(code);
    try {
      const res = await this.client.order({ code, side, qty, price, ordDvsn });
      this.daily.orders++;
      this._log('order', side === 'buy' ? 'BUY' : 'SELL',
        `${code} ${side === 'buy' ? '매수' : '매도'} ${qty}주 @ ${Math.round(price).toLocaleString()} · 주문번호 ${res.orderNo} — ${why}`);
      return { ok: true, orderNo: res.orderNo, filledPrice: res.filledPrice || price, simulated: !!res.mock };
    } catch (err) {
      this._log('error', 'ORDER_FAIL', `${code} 주문 실패: ${err.message}`);
      return { ok: false, reason: err.message };
    } finally {
      this.inFlight.delete(code);
    }
  }

  /* ------------------------------------------------------------ 주기 점검 */

  _housekeeping() {
    if (!this.positions.size) return;
    const now = Date.now();
    for (const [code, pos] of this.positions) {
      if (pos.status !== 'open') continue;
      const held = (now - pos.entryTime) / 1000;
      if (held >= this.config.maxHoldSeconds) {
        this._exit(code, `보유시간 ${Math.round(held)}초 초과`).catch(() => {});
      } else if (this._pastForceExit()) {
        this._exit(code, `${this.config.forceExitAt} 강제청산`).catch(() => {});
      }
    }
  }

  /** 체결통보(H0STCNI0) 반영 — 실제 체결가로 포지션을 정정한다 */
  onNotice(fill) {
    if (!fill || !fill.filled) return;
    const pos = this.positions.get(fill.code);
    if (!pos || !fill.price) return;
    if (fill.side === 'buy') {
      const drift = fill.price - pos.entry;
      pos.entry = fill.price;
      pos.stop += drift;
      pos.target += drift;
      this._log('info', 'FILL', `${fill.code} 체결가 ${fill.price.toLocaleString()}원으로 정정`);
    }
  }

  /* ------------------------------------------------------------ 로그/저장 */

  _log(level, code, message) {
    const entry = { t: Date.now(), level, code, message };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    this.emit('log', entry);
    if (this.hub) this.hub.broadcast('trader-log', entry);
    // 주문·체결은 파일로도 남긴다 (감사 추적)
    if (level === 'order' || level === 'trade' || level === 'error') {
      try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(path.join(LOG_DIR, `kr-trades-${kstDate()}.jsonl`), JSON.stringify(entry) + '\n');
      } catch (_) {}
    }
  }

  _save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        config: this.config, daily: this.daily, killed: this.killed, killReason: this.killReason,
      }, null, 2));
    } catch (_) {}
  }

  _load() {
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // 저장된 설정을 복원하되, 실전 발주 허용만은 재시작 때마다 꺼둔다
      this.config = Object.assign({}, DEFAULT_CONFIG, s.config, { allowLive: false, enabled: false });
      if (s.daily && s.daily.date === kstDate()) this.daily = s.daily;
      this.killed = !!s.killed;
      this.killReason = s.killReason || '';
    } catch (_) {}
  }

  close() {
    clearInterval(this.timer);
  }
}

/* ------------------------------------------------------------------ 유틸 */

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDate = () => kstNow().toISOString().slice(0, 10);
const num = (v, d) => (isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

module.exports = { Trader, DEFAULT_CONFIG };
