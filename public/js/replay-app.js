/**
 * 과거 장 재생 연습 — 화면 컨트롤러.
 *
 * 중요한 설계: **미래 봉을 브라우저가 갖지 않는다.**
 * 서버가 열어 준 만큼만 candles 배열에 쌓아 차트에 그린다.
 * 그래서 개발자도구를 열어도 다음 봉을 볼 수 없다.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const C = window.KRConfig;

  const state = {
    id: null,
    meta: null,
    candles: [],       // 서버가 열어 준 봉만 들어 있다
    account: null,
    playing: false,
    timer: null,
    log: [],
  };

  let chart = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('ko-KR'));
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '요청 실패 (' + res.status + ')');
    return json;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

  /* ------------------------------------------------------------- 시작 */

  async function start() {
    const code = ($('#rpCode').value || '').trim();
    if (!/^[0-9A-Z]{5,6}$/.test(code)) { toast('종목코드 6자리를 넣어 주세요.', 'err'); return; }
    stopPlay();
    $('#rpStart').disabled = true;
    try {
      const cash = Number($('#rpCash').value);
      const r = await api(`/api/kr/replay/start?code=${encodeURIComponent(code)}&cash=${cash}&bars=400`);
      state.id = r.id;
      state.meta = r;
      state.candles = r.visible.slice();
      state.account = r.account;
      state.log = [];

      $('#rpIntro').hidden = true;
      $('#rpScore').hidden = true;
      $('#rpBoard').hidden = false;
      $('#rpName').textContent = r.name + ' · ' + r.code + (r.isEtf ? ' (ETF)' : '');
      $('#sessBadge').textContent = '연습 중';
      $('#sessBadge').className = 'badge live';

      if (!chart) {
        chart = new ScalpChart($('#chart'), { onHover: null });
        chart.setShow({ volume: true, rsi: false, macd: false, stoch: false, bb: true, ma: true, vwap: false, sr: false, fib: false, regression: false, trend: false });
        chart.setMaConfig([
          { period: 5, type: 'ema', on: true },
          { period: 20, type: 'sma', on: true },
          { period: 60, type: 'sma', on: false },
          { period: 120, type: 'sma', on: false },
        ]);
      }
      draw();
      log('연습 시작 — ' + r.name + ' · 시작 자금 ' + won(cash) + '원');
    } catch (err) {
      console.error('연습 시작 실패', err);
      toast('시작 실패: ' + err.message, 'err');
    } finally {
      $('#rpStart').disabled = false;
    }
  }

  /* ------------------------------------------------------------- 진행 */

  async function step(n) {
    if (!state.id) return;
    try {
      const r = await post('/api/kr/replay/step', { id: state.id, n });
      // 서버가 열어 준 봉만 뒤에 붙인다
      for (const b of r.revealed) state.candles.push(b);
      state.account = r.account;
      draw();
      if (r.atEnd) {
        stopPlay();
        toast('마지막 봉입니다. 채점해 보세요.', 'warn');
      }
    } catch (err) {
      stopPlay();
      toast(err.message, 'err');
    }
  }

  function togglePlay() {
    if (state.playing) { stopPlay(); return; }
    state.playing = true;
    $('#rpPlay').textContent = '⏸ 멈춤';
    $('#rpPlay').classList.add('playing');
    const tick = async () => {
      if (!state.playing) return;
      await step(1);
      if (state.playing) state.timer = setTimeout(tick, Number($('#rpSpeed').value));
    };
    tick();
  }

  function stopPlay() {
    state.playing = false;
    clearTimeout(state.timer);
    const b = $('#rpPlay');
    if (b) { b.textContent = '⏵ 자동'; b.classList.remove('playing'); }
  }

  /* ------------------------------------------------------------- 주문 */

  async function order(side) {
    if (!state.id) return;
    const qty = Math.max(1, Math.floor(Number($('#rpQty').value) || 1));
    try {
      const r = await post('/api/kr/replay/order', { id: state.id, side, qty });
      state.account = r.account;
      if (side === 'buy') {
        log(`매수 ${r.qty}주 @ ${won(r.fill)}`, 'buy');
      } else {
        const t = r.trade;
        log(`매도 ${r.qty}주 @ ${won(r.fill)} · 순손익 ${won(t.net)}원 (${t.netPct.toFixed(2)}%)`,
          t.net >= 0 ? 'win' : 'loss');
      }
      // 체결은 다음 봉이므로 한 봉 진행해 결과를 보여 준다
      await step(1);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  /* ------------------------------------------------------------- 그리기 */

  function draw() {
    const cs = state.candles;
    if (!cs.length) return;
    let analysis = null;
    try { analysis = KRSignal.analyze(cs); } catch (_) { /* 봉이 적으면 지표 없이 */ }
    chart.setData(cs, analysis);

    const last = cs[cs.length - 1];
    const prev = cs.length > 1 ? cs[cs.length - 2] : last;
    const d = last.c - prev.c;
    $('#rpPrice').innerHTML = `${won(last.c)} <small class="${cls(d)}">${d > 0 ? '+' : ''}${won(d)}</small>
      <small class="muted">${hhmm(last.t)}</small>`;

    const done = cs.length;
    const total = state.meta.totalBars;
    $('#rpProgress').textContent = `${done} / ${total}봉`;

    renderAccount();
  }

  function renderAccount() {
    const a = state.account;
    if (!a) return;
    const pnl = a.equity - a.startCash;
    const pos = a.position;
    $('#rpAcct').innerHTML = `
      <div class="acct-row big">
        <span>평가자산</span>
        <b class="${cls(pnl)}">${won(a.equity)}원</b>
      </div>
      <div class="acct-row">
        <span>손익</span>
        <b class="${cls(pnl)}">${pnl > 0 ? '+' : ''}${won(pnl)}원 (${((pnl / a.startCash) * 100).toFixed(2)}%)</b>
      </div>
      <div class="acct-row"><span>현금</span><b>${won(a.cash)}원</b></div>
      <div class="acct-row"><span>실현손익</span><b class="${cls(a.realized)}">${won(a.realized)}원</b></div>
      <div class="acct-row"><span>거래</span><b>${a.trades}회</b></div>
      ${pos ? `<div class="acct-pos">
        <div class="acct-row"><span>보유</span><b>${pos.qty}주 @ ${won(pos.entry)}</b></div>
        <div class="acct-row"><span>평가손익 <small>세후</small></span>
          <b class="${cls(pos.unrealized)}">${won(pos.unrealized)}원</b></div>
        ${pos.breakeven ? `<div class="acct-row"><span>본전가</span>
          <b class="${a.price < pos.breakeven.price ? 'down' : 'up'}">${won(pos.breakeven.price)}</b></div>` : ''}
      </div>` : '<div class="acct-empty">보유 없음</div>'}`;

    const maxQty = a.price ? Math.floor(a.cash / a.price) : 0;
    $('#rpMaxQty').textContent = pos ? `보유 ${pos.qty}주` : `최대 ${maxQty.toLocaleString()}주 살 수 있음`;
    $('#rpBuy').disabled = Boolean(pos);
    $('#rpSell').disabled = !pos;
  }

  function log(text, kind = '') {
    state.log.unshift({ text, kind, t: Date.now() });
    $('#rpLog').innerHTML = state.log.slice(0, 12).map((l) =>
      `<div class="rp-log-row ${esc(l.kind)}">${esc(l.text)}</div>`).join('');
  }

  /* ------------------------------------------------------------- 채점 */

  async function finish() {
    if (!state.id) return;
    stopPlay();
    try {
      const s = await api(`/api/kr/replay/score?id=${encodeURIComponent(state.id)}`);
      $('#rpScore').hidden = false;
      $('#rpScore').innerHTML = renderScore(s);
      $('#sessBadge').textContent = '채점 완료';
      $('#sessBadge').className = 'badge';
      $('#rpScore').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      toast('채점 실패: ' + err.message, 'err');
    }
  }

  function renderScore(s) {
    const beat = s.beatHold;
    const tiles = [
      ['최종 평가자산', won(s.equity) + '원', cls(s.equity - s.startCash)],
      ['수익률', (s.returnPct > 0 ? '+' : '') + s.returnPct + '%', cls(s.returnPct)],
      ['거래', s.trades + '회', ''],
      ['승률', s.winRate == null ? '—' : s.winRate + '%', ''],
      ['수수료·세금', won(s.totalCost) + '원', 'down'],
    ];
    return `
      <h2>연습 결과 — ${esc(s.name)}</h2>
      <div class="score-verdict ${beat ? 'good' : 'bad'}">${esc(s.verdict)}</div>
      <div class="score-tiles">
        ${tiles.map(([k, v, c]) => `<div class="tile">
          <span>${esc(k)}</span><b class="${c}">${esc(v)}</b></div>`).join('')}
      </div>
      <div class="score-compare">
        <div class="cmp ${beat ? 'win' : ''}">
          <span>직접 매매</span>
          <b class="${cls(s.realized)}">${won(s.realized)}원</b>
        </div>
        <div class="cmp-vs">vs</div>
        <div class="cmp ${!beat ? 'win' : ''}">
          <span>그냥 사서 들고 있기</span>
          <b class="${cls(s.buyAndHold.net)}">${won(s.buyAndHold.net)}원</b>
          <small class="muted">${won(s.buyAndHold.entry)} → ${won(s.buyAndHold.exit)} · ${s.buyAndHold.qty}주</small>
        </div>
      </div>
      ${s.tradeList.length ? `<div class="table-scroll"><table class="score-table">
        <thead><tr><th>진입</th><th>청산</th><th>수량</th><th>보유</th><th>총손익</th><th>비용</th><th>순손익</th></tr></thead>
        <tbody>${s.tradeList.map((t) => `<tr>
          <td>${won(t.entry)}</td><td>${won(t.exit)}</td><td>${t.qty}</td><td>${t.bars}봉</td>
          <td class="${cls(t.gross)}">${won(t.gross)}</td>
          <td class="down">-${won(t.cost)}</td>
          <td class="${cls(t.net)}"><b>${won(t.net)}</b></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      <p class="score-note">
        ${s.costVsGross != null ? `총 움직인 금액의 <b>${s.costVsGross}%</b>가 수수료·세금으로 나갔습니다. ` : ''}
        연습은 실제 체결·호가 잔량을 완벽히 재현하지 못합니다. 실제로는 더 불리할 수 있습니다.
      </p>
      <button id="rpAgain" class="run-btn">다시 연습</button>`;
  }

  /* ------------------------------------------------------------- 초기화 */

  function init() {
    $('#rpStart').addEventListener('click', start);
    $$('[data-step]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.step))));
    $('#rpPlay').addEventListener('click', togglePlay);
    $('#rpFinish').addEventListener('click', finish);
    $('#rpBuy').addEventListener('click', () => order('buy'));
    $('#rpSell').addEventListener('click', () => order('sell'));
    $('#rpScore').addEventListener('click', (e) => { if (e.target.id === 'rpAgain') start(); });

    // 키보드: 스페이스=진행, B=매수, S=매도
    document.addEventListener('keydown', (e) => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); step(1); }
      else if (e.key === 'b' || e.key === 'B') order('buy');
      else if (e.key === 's' || e.key === 'S') order('sell');
      else if (e.key === 'p' || e.key === 'P') togglePlay();
    });
    window.addEventListener('beforeunload', () => {
      if (state.id) navigator.sendBeacon?.(`/api/kr/replay/end?id=${state.id}`);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
