/**
 * ScalpDesk KR — 한국 주식 초단타 화면 컨트롤러.
 *
 * 서버(SSE)에서 300ms 주기로 [시세·호가·체결테이프·집계봉] 스냅샷을 받아
 * 차트/신호/호가창/자동매매 패널을 갱신한다.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const C = window.KRConfig;

  window.PRICE_MODE = 'KRW';   // 차트 가격 표기를 원화 정수로

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('scalpkr:' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('scalpkr:' + k, JSON.stringify(v)); } catch (_) {} },
  };

  const state = {
    code: LS.get('code', '005930'),
    tf: LS.get('tf', '10s'),
    watchlist: LS.get('watchlist', ['005930', '000660', '035720', '247540', '042700']),
    show: LS.get('show', null),
    snapshot: null,
    analysis: null,
    signal: null,
    trader: null,
    es: null,
    lastRender: 0,
  };

  let chart;

  /* ------------------------------------------------------------- 유틸 */

  const won = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('ko-KR'));
  const pct = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%');
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function volFmt(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(1) + '억';
    if (v >= 1e4) return (v / 1e4).toFixed(1) + '만';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '요청 실패 (' + res.status + ')');
    return json;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

  /* --------------------------------------------------------- 실시간 연결 */

  function connect() {
    if (state.es) state.es.close();
    setConn('연결 중');
    const es = new EventSource(`/api/kr/stream?code=${encodeURIComponent(state.code)}&tf=${state.tf}`);
    state.es = es;

    es.addEventListener('snapshot', (ev) => {
      try {
        onSnapshot(JSON.parse(ev.data));
        setConn('실시간', true);
      } catch (err) {
        console.error(err);
      }
    });
    es.addEventListener('trader-log', (ev) => {
      const log = JSON.parse(ev.data);
      if (log.level === 'trade' || log.level === 'error') toast(log.message, log.level === 'error' ? 'err' : 'ok');
      refreshTrader();
    });
    es.onerror = () => {
      setConn('재연결 중');
      // EventSource 는 자동 재접속한다. 상태만 표시.
    };
  }

  function setConn(text, ok) {
    const el = $('#connBadge');
    el.textContent = 'SSE ' + text;
    el.className = 'badge ' + (ok ? 'live' : '');
  }

  function onSnapshot(snap) {
    if (!snap || !snap.ready) return;
    state.snapshot = snap;

    const candles = snap.candles || [];
    if (candles.length >= 10) {
      state.analysis = KRSignal.analyze(candles);
      state.signal = KRSignal.evaluate(state.analysis, {
        orderbook: snap.orderbook,
        flow: snap.flow,
        quote: snap.quote,
        market: snap.market,
        phase: snap.phase,
        barSeconds: C.TIMEFRAMES[state.tf] || 10,
      });
    } else {
      state.analysis = null;
      state.signal = null;
    }

    // 차트는 60ms 이상 간격으로만 다시 그린다 (300ms 스냅샷이면 사실상 매번)
    const now = performance.now();
    if (now - state.lastRender > 60) {
      state.lastRender = now;
      chart.secondsPrecision = C.TIMEFRAMES[state.tf] < 60;
      chart.intraday = true;
      chart.setData(candles, state.analysis);
      renderLegend(candles.length - 1);
    }

    renderQuote(snap);
    renderOrderbook(snap);
    renderTape(snap);
    renderSignal();
    renderPlan();
    renderPhase(snap.phase);
    const warming = candles.length < 30;
    $('#barInfo').textContent = `${state.tf} 봉 ${candles.length}개` +
      (C.TIMEFRAMES[state.tf] < 60 ? ' · 접속 후 집계' : ' · 분봉 시딩됨') +
      (warming ? ` · 지표 워밍업 ${candles.length}/30봉` : '');
    $('#barInfo').className = warming ? 'warn-text' : 'muted';
  }

  /* ------------------------------------------------------------- 렌더 */

  function renderQuote(snap) {
    const q = snap.quote;
    if (!q) return;
    const tick = C.tickSize(q.price, snap.market);
    $('#qName').textContent = q.name || snap.code;
    $('#qCode').textContent = `${snap.code} · ${snap.market || ''}`;
    $('#qPrice').textContent = won(q.price);
    $('#qPrice').className = cls(q.change);
    const chg = $('#qChange');
    chg.textContent = `${q.change > 0 ? '+' : ''}${won(q.change)} (${pct(q.changePercent)})`;
    chg.className = 'chg ' + cls(q.change);
    $('#qHigh').textContent = won(q.high);
    $('#qLow').textContent = won(q.low);
    $('#qVol').textContent = volFmt(q.volume) + '주';
    $('#qValue').textContent = volFmt(q.value) + '원';
    const st = $('#qStrength');
    st.textContent = q.strength ? q.strength.toFixed(0) + '%' : '—';
    st.className = q.strength >= 120 ? 'up' : q.strength <= 80 ? 'down' : '';
    $('#qTick').textContent = won(tick) + '원';
    $('#qLimit').textContent = `${won(q.upperLimit)} / ${won(q.lowerLimit)}`;
    document.title = `${won(q.price)} ${q.name || snap.code} · ScalpDesk KR`;
    if (!$('#ordPrice').value && document.activeElement !== $('#ordPrice')) updateOrderEstimate();
  }

  function renderPhase(phase) {
    const map = {
      regular: ['정규장', 'live'], preopen: ['장전 동시호가', 'demo'],
      closeauction: ['마감 동시호가', 'demo'], after: ['시간외', 'demo'], closed: ['장 마감', ''],
    };
    const [label, kind] = map[phase] || [phase, ''];
    const el = $('#phaseBadge');
    el.textContent = label;
    el.className = 'badge ' + kind;
  }

  function renderLegend(index) {
    const a = state.analysis;
    const snap = state.snapshot;
    if (!a || !snap) return;
    const i = Math.max(0, Math.min(index, snap.candles.length - 1));
    const parts = [];
    a.maConfig.forEach((m, k) => {
      const v = a.ma[k][i];
      if (v == null) return;
      parts.push(`<span style="color:${MA_COLORS[k % MA_COLORS.length]}"><i style="background:${MA_COLORS[k % MA_COLORS.length]}"></i>${m.type.toUpperCase()}${m.period} ${won(v)}</span>`);
    });
    if (a.bb.upper[i] != null) parts.push(`<span style="color:#6b8afd"><i style="background:#6b8afd"></i>BB ${won(a.bb.upper[i])} / ${won(a.bb.lower[i])}</span>`);
    if (a.vwap && a.vwap[i] != null) parts.push(`<span style="color:#f0b429"><i style="background:#f0b429"></i>VWAP ${won(a.vwap[i])}</span>`);
    $('#legend').innerHTML = parts.join('');

    const c = snap.candles[i];
    if (!c) return;
    const bias = c.buyVol + c.sellVol > 0 ? ((c.buyVol - c.sellVol) / (c.buyVol + c.sellVol)) * 100 : 0;
    $('#hoverBar').innerHTML =
      `${chart.fmtDateTime(c.t)} · 시 <b>${won(c.o)}</b> 고 <b>${won(c.h)}</b> 저 <b>${won(c.l)}</b> 종 <b class="${cls(c.c - c.o)}">${won(c.c)}</b>` +
      ` · 거래량 <b>${volFmt(c.v)}</b> · 체결 <b>${c.ticks || 0}</b>건` +
      ` · 매수/매도 <b class="up">${volFmt(c.buyVol)}</b>/<b class="down">${volFmt(c.sellVol)}</b>` +
      ` <span class="${cls(bias)}">(${bias > 0 ? '+' : ''}${bias.toFixed(0)}%)</span>`;
  }

  function renderOrderbook(snap) {
    const ob = snap.orderbook;
    const el = $('#orderbook');
    if (!ob || !ob.asks) {
      el.innerHTML = '<div class="muted" style="padding:10px">호가 수신 대기…</div>';
      return;
    }
    const all = ob.asks.concat(ob.bids);
    const max = Math.max(1, ...all.map((r) => r.qty));
    const price = snap.quote ? snap.quote.price : 0;
    const rows = [];
    for (let i = 9; i >= 0; i--) {
      const a = ob.asks[i];
      if (!a) continue;
      rows.push(obRow(a, 'ask', max, price));
    }
    for (let i = 0; i < 10; i++) {
      const b = ob.bids[i];
      if (!b) continue;
      rows.push(obRow(b, 'bid', max, price));
    }
    const imb = ob.totalAsk + ob.totalBid > 0 ? ((ob.totalBid - ob.totalAsk) / (ob.totalBid + ob.totalAsk)) * 100 : 0;
    el.innerHTML = rows.join('') +
      `<div class="ob-total">
         <span class="down">매도 ${volFmt(ob.totalAsk)}</span>
         <span class="${cls(imb)}">불균형 ${imb > 0 ? '+' : ''}${imb.toFixed(0)}%</span>
         <span class="up">매수 ${volFmt(ob.totalBid)}</span>
       </div>`;
    el.querySelectorAll('.ob-row').forEach((row) => {
      row.addEventListener('click', () => {
        $('#ordPrice').value = row.dataset.price;
        updateOrderEstimate();
      });
    });
  }

  function obRow(row, side, max, price) {
    const w = Math.min(100, (row.qty / max) * 100);
    const isCur = row.price === price;
    return `<div class="ob-row ${side} ${isCur ? 'cur' : ''}" data-price="${row.price}">
      <span class="ob-qty">${side === 'bid' ? '' : volFmt(row.qty)}</span>
      <span class="ob-price">${won(row.price)}</span>
      <span class="ob-qty right">${side === 'bid' ? volFmt(row.qty) : ''}</span>
      <i class="ob-bar ${side}" style="width:${w}%"></i>
    </div>`;
  }

  function renderTape(snap) {
    const rows = (snap.tape || []).slice(-22).reverse();
    $('#tape tbody').innerHTML = rows.map((t) => `<tr class="${t.side === 'buy' ? 'up' : 'down'}">
      <td>${(t.time || '').replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')}</td>
      <td class="num">${won(t.price)}</td>
      <td class="num">${volFmt(t.volume)}</td>
    </tr>`).join('');
  }

  function renderSignal() {
    const s = state.signal;
    const card = $('#signalCard');
    if (!s) {
      $('#signalLabel').textContent = '봉 집계 중…';
      $('#signalScore').textContent = '—';
      $('#reasonList').innerHTML = '<li class="muted">10초봉은 접속 후 쌓입니다. 30봉 이상 모이면 신호가 나옵니다.</li>';
      card.className = 'signal-card';
      return;
    }
    card.className = 'signal-card ' + s.tone;
    $('#signalLabel').textContent = s.label;
    $('#signalScore').textContent = (s.score > 0 ? '+' : '') + s.score;
    const fill = $('#gaugeFill');
    const w = Math.min(50, Math.abs(s.score) / 2);
    fill.style.width = w + '%';
    fill.style.left = s.score >= 0 ? '50%' : 50 - w + '%';
    fill.style.background = s.score >= 0 ? 'var(--up)' : 'var(--down)';
    $('#reasonList').innerHTML = s.reasons.slice(0, 12).map((r) =>
      `<li><span class="dot ${r.dir > 0 ? 'up' : r.dir < 0 ? 'down' : ''}"></span>
        <div><b>${esc(r.title)}</b>${r.weight ? ` <span class="muted">(${r.dir > 0 ? '+' : '-'}${r.weight})</span>` : ''}
        <small>${esc(r.detail)}</small></div></li>`).join('');
  }

  function renderPlan() {
    const s = state.signal;
    const p = s && s.plan;
    const ids = ['#pEntry', '#pStop', '#pTarget', '#pBreakeven', '#pCost', '#pNet', '#pRR'];
    if (!p) { ids.forEach((i) => ($(i).textContent = '—')); return; }
    $('#pEntry').textContent = won(p.entry);
    $('#pStop').innerHTML = `<span class="down">${won(p.stop)}</span> <small class="muted">(${p.stopTicks}호가)</small>`;
    $('#pTarget').innerHTML = `<span class="up">${won(p.target)}</span> <small class="muted">(${p.targetTicks}호가)</small>`;
    $('#pBreakeven').innerHTML = `${p.breakevenTicks}호가 <small class="muted">수수료+세금</small>`;
    $('#pCost').textContent = won(p.costPerShare) + '원';
    $('#pNet').innerHTML = `<span class="${p.netPerShare > 0 ? 'up' : 'down'}">${won(p.netPerShare)}원</span>`;
    $('#pRR').innerHTML = p.rr == null ? '—'
      : `<b class="${p.rr >= 1.5 ? 'up' : p.rr >= 1 ? 'flat' : 'down'}">1 : ${p.rr.toFixed(2)}</b>`;
  }

  /* ----------------------------------------------------------- 관심종목 */

  function renderWatchlist() {
    const el = $('#watchlist');
    el.innerHTML = state.watchlist.map((code) => {
      const active = code === state.code ? 'active' : '';
      const name = (window.KR_NAMES && window.KR_NAMES[code]) || code;
      return `<li class="${active}" data-code="${code}">
        <div><span class="w-sym">${esc(name)}</span><span class="w-name">${code}</span></div>
        <span class="w-price" data-wprice="${code}">—</span>
        <button class="w-del" title="삭제">✕</button>
      </li>`;
    }).join('');
    el.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('w-del')) {
          state.watchlist = state.watchlist.filter((c) => c !== li.dataset.code);
          LS.set('watchlist', state.watchlist);
          renderWatchlist();
          refreshWatchQuotes();
          return;
        }
        selectCode(li.dataset.code);
      });
    });
  }

  function selectCode(code) {
    if (!code || code === state.code) return;
    state.code = code;
    LS.set('code', code);
    chart.resetView();
    renderWatchlist();
    connect();
  }

  async function refreshWatchQuotes() {
    if (!state.watchlist.length) return;
    try {
      const { quotes } = await api('/api/kr/quotes?codes=' + encodeURIComponent(state.watchlist.join(',')));
      for (const q of quotes) {
        const el = document.querySelector(`[data-wprice="${q.code}"]`);
        if (!el) continue;
        el.innerHTML = q.price
          ? `${won(q.price)}<br /><span class="w-chg ${cls(q.change)}">${pct(q.changePercent)}</span>`
          : '—';
        const li = el.closest('li');
        const nameEl = li && li.querySelector('.w-sym');
        if (nameEl && q.name && nameEl.textContent === q.code) nameEl.textContent = q.name;
      }
    } catch (_) { /* 다음 주기에 재시도 */ }
  }

  async function loadNames() {
    try {
      const { items } = await api('/api/kr/universe');
      window.KR_NAMES = Object.fromEntries(items.map((i) => [i.code, i.name]));
      renderWatchlist();
    } catch (_) {}
  }

  /* ------------------------------------------------------------- 주문 */

  function updateOrderEstimate() {
    const snap = state.snapshot;
    if (!snap || !snap.quote) return;
    const price = Number($('#ordPrice').value) || snap.quote.price;
    const qty = Math.max(1, Math.floor(Number($('#ordQty').value) || 1));
    const amount = price * qty;
    const cost = C.roundTripCost(price, qty);
    const be = C.breakevenTicks(price, snap.market);
    $('#ordEst').innerHTML =
      `투입 <b>${won(amount)}원</b> · 왕복비용 <b>${won(cost)}원</b> · 본전까지 <b>${be}호가</b>`;
  }

  function confirmOrder(side) {
    const snap = state.snapshot;
    if (!snap || !snap.quote) return;
    const priceInput = Number($('#ordPrice').value);
    const qty = Math.max(1, Math.floor(Number($('#ordQty').value) || 1));
    const price = priceInput || snap.quote.price;
    const isMarket = !priceInput;
    const mode = state.trader ? state.trader.accountMode : '?';

    $('#confirmTitle').textContent = side === 'buy' ? '매수 주문 확인' : '매도 주문 확인';
    $('#confirmBody').innerHTML = `
      <div class="confirm-row"><span>계좌</span><b class="${mode === '실전' ? 'down' : ''}">${mode}</b></div>
      <div class="confirm-row"><span>종목</span><b>${esc(snap.quote.name)} (${snap.code})</b></div>
      <div class="confirm-row"><span>구분</span><b class="${side === 'buy' ? 'up' : 'down'}">${side === 'buy' ? '매수' : '매도'} · ${isMarket ? '시장가' : '지정가'}</b></div>
      <div class="confirm-row"><span>가격</span><b>${isMarket ? '시장가' : won(price) + '원'}</b></div>
      <div class="confirm-row"><span>수량</span><b>${qty.toLocaleString()}주</b></div>
      <div class="confirm-row"><span>예상 금액</span><b>${won(price * qty)}원</b></div>
      ${side === 'buy' && $('#ordBracket').checked
        ? '<div class="confirm-row"><span>자동 청산</span><b class="warn-text">매수 후 손절·목표 감시 시작</b></div>'
        : ''}
      ${mode === '실전' ? '<div class="confirm-warn">실전 계좌입니다. 전송하면 실제 주문이 나갑니다.</div>' : ''}`;

    const modal = $('#confirmModal');
    modal.hidden = false;
    $('#confirmOk').onclick = async () => {
      modal.hidden = true;
      try {
        const r = await post('/api/kr/order', {
          code: snap.code, side, qty,
          price: isMarket ? 0 : price,
          ordDvsn: isMarket ? C.ORD_DVSN.시장가 : C.ORD_DVSN.지정가,
          bracket: side === 'buy' && $('#ordBracket').checked,
        });
        toast(`주문 접수 · 주문번호 ${r.orderNo || '-'}`, 'ok');
        if (r.bracket) {
          toast(`🛡 자동 청산 감시 시작 — 손절 ${won(r.bracket.stop)} / 목표 ${won(r.bracket.target)}`, 'ok');
        }
        if (r.bracketError) toast('자동 청산을 걸지 못했습니다: ' + r.bracketError, 'warn');
        refreshTrader();
      } catch (err) {
        toast('주문 실패: ' + err.message, 'err');
      }
    };
  }

  /* ---------------------------------------------------------- 자동매매 */

  async function refreshTrader() {
    try {
      state.trader = await api('/api/kr/trader');
      renderTrader();
    } catch (_) {}
  }

  function renderTrader() {
    const t = state.trader;
    if (!t) return;
    const cfg = t.config;
    const armed = t.liveArmed && cfg.enabled && !t.killed;
    $('#autoStatus').innerHTML = `
      <div class="auto-row"><span>상태</span><b class="${t.killed ? 'down' : armed ? 'up' : ''}">${t.killed ? '정지됨 · ' + esc(t.killReason) : cfg.enabled ? (cfg.dryRun ? '가동(모의 실행)' : '가동') : '꺼짐'}</b></div>
      <div class="auto-row"><span>계좌</span><b class="${t.accountMode === '실전' ? 'down' : ''}">${t.accountMode}</b></div>
      <div class="auto-row"><span>오늘</span><b class="${cls(t.daily.realizedPnl)}">${won(t.daily.realizedPnl)}원</b> <span class="muted">${t.daily.wins}승 ${t.daily.losses}패 · ${t.daily.orders}주문</span></div>
      <div class="auto-row"><span>현재 신호</span><b>${state.signal ? (state.signal.score > 0 ? '+' : '') + state.signal.score : '—'}점</b> <span class="muted">진입 기준 ${cfg.entryScore}점${state.signal && state.signal.score < cfg.entryScore ? ' · 대기 중' : ''}</span></div>`;
    $('#resumeBtn').hidden = !t.killed;
    $('#killBtn').hidden = t.killed;
    $('#acctBadge').textContent = t.accountMode;
    $('#acctBadge').className = 'badge ' + (t.accountMode === '실전' ? 'demo' : 'live');

    // 입력값은 사용자가 편집 중이면 덮어쓰지 않는다
    const setIf = (sel, val, prop = 'value') => {
      const el = $(sel);
      if (el && document.activeElement !== el) el[prop] = val;
    };
    setIf('#cfgEnabled', cfg.enabled, 'checked');
    setIf('#cfgDryRun', cfg.dryRun, 'checked');
    setIf('#cfgAllowLive', cfg.allowLive, 'checked');
    setIf('#cfgSymbols', (cfg.symbols || []).join(','));
    setIf('#cfgTimeframe', cfg.timeframe);
    setIf('#cfgEntryScore', cfg.entryScore);
    setIf('#cfgExitScore', cfg.exitScore);
    setIf('#cfgSizingMode', cfg.sizingMode || 'auto');
    setIf('#cfgOrderAmount', cfg.orderAmount);
    setIf('#cfgRiskPct', cfg.riskPct);
    setIf('#cfgFixedQty', cfg.fixedQty);
    syncSizingFields();
    setIf('#cfgMaxPositions', cfg.maxPositions);
    setIf('#cfgMaxHold', cfg.maxHoldSeconds);
    setIf('#cfgTrailing', cfg.trailingTicks);
    setIf('#cfgExitBasis', cfg.exitBasis);
    setIf('#cfgStopPct', cfg.stopLossPct);
    setIf('#cfgTpPct', cfg.takeProfitPct);
    setIf('#cfgStopWon', cfg.stopLossWon);
    setIf('#cfgTpWon', cfg.takeProfitWon);
    setIf('#cfgStopTicks', cfg.stopTicks);
    setIf('#cfgTpTicks', cfg.takeProfitTicks);
    setIf('#cfgTrailingPct', cfg.trailingPct);
    syncExitFields();
    setIf('#cfgDailyLoss', cfg.dailyLossLimit);
    setIf('#cfgForceExit', cfg.forceExitAt);
    $('.live-row').classList.toggle('armed', cfg.allowLive && !cfg.dryRun);

    $('#positions').innerHTML = t.positions.length
      ? '<div class="pos-head">보유 포지션 · 실시간 감시 중</div>' + t.positions.map((p) => {
        const pnl = (p.last - p.entry) * p.qty;
        const pct = p.entry ? ((p.last - p.entry) / p.entry) * 100 : 0;
        return `<div class="pos-row ${p.manual ? 'manual' : ''}">
          <span>${esc(p.name || p.code)} ${p.manual ? '<span class="pos-badge">수동</span>' : ''}</span>
          <span>${p.qty}주 @ ${won(p.entry)}</span>
          <span class="${cls(pnl)}">${won(pnl)}원 (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>
          <button class="mini-btn" data-close="${p.code}">청산</button>
        </div>
        <div class="pos-levels">손절 <b class="down">${won(p.stop)}</b> · 목표 <b class="up">${won(p.target)}</b>${p.exitBasis ? ` <span class="muted">· ${esc(p.exitBasis)}</span>` : ''}</div>`;
      }).join('')
      : '<div class="muted" style="font-size:11px;padding:4px 0">보유 포지션 없음</div>';
    $('#positions').querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await post('/api/kr/order', { code: b.dataset.close, side: 'sell', qty: (t.positions.find((p) => p.code === b.dataset.close) || {}).qty, price: 0, ordDvsn: C.ORD_DVSN.시장가 });
          toast('청산 주문 전송', 'ok');
          refreshTrader();
        } catch (err) { toast('청산 실패: ' + err.message, 'err'); }
      }));

    $('#tradeLog').innerHTML = (t.logs || []).slice(-14).reverse().map((l) =>
      `<div class="log-row ${l.level}"><span class="log-time">${new Date(l.t).toLocaleTimeString('ko-KR', { hour12: false })}</span>${esc(l.message)}</div>`
    ).join('');
  }

  async function saveTraderConfig() {
    const allowLive = $('#cfgAllowLive').checked;
    const dryRun = $('#cfgDryRun').checked;
    if (allowLive && !dryRun && state.trader && state.trader.accountMode === '실전') {
      const ok = confirm('실전 계좌에 자동으로 주문이 나갑니다.\n\n정말 켜시겠습니까?');
      if (!ok) { $('#cfgAllowLive').checked = false; return; }
    }
    try {
      state.trader = await post('/api/kr/trader/config', {
        enabled: $('#cfgEnabled').checked,
        dryRun,
        allowLive,
        symbols: $('#cfgSymbols').value.split(',').map((s) => s.trim()).filter(Boolean),
        timeframe: $('#cfgTimeframe').value,
        entryScore: Number($('#cfgEntryScore').value),
        exitScore: Number($('#cfgExitScore').value),
        sizingMode: $('#cfgSizingMode').value,
        orderAmount: Number($('#cfgOrderAmount').value),
        riskPct: Number($('#cfgRiskPct').value),
        fixedQty: Number($('#cfgFixedQty').value),
        exitBasis: $('#cfgExitBasis').value,
        stopLossPct: Number($('#cfgStopPct').value),
        takeProfitPct: Number($('#cfgTpPct').value),
        stopLossWon: Number($('#cfgStopWon').value),
        takeProfitWon: Number($('#cfgTpWon').value),
        stopTicks: Number($('#cfgStopTicks').value),
        takeProfitTicks: Number($('#cfgTpTicks').value),
        trailingPct: Number($('#cfgTrailingPct').value),
        maxPositions: Number($('#cfgMaxPositions').value),
        maxHoldSeconds: Number($('#cfgMaxHold').value),
        trailingTicks: Number($('#cfgTrailing').value),
        dailyLossLimit: Number($('#cfgDailyLoss').value),
        forceExitAt: $('#cfgForceExit').value,
      });
      renderTrader();
      toast('자동매매 설정을 저장했습니다.', 'ok');
    } catch (err) {
      toast('설정 저장 실패: ' + err.message, 'err');
    }
  }

  /** 선택한 기준의 입력칸만 보여 준다 */
  function syncExitFields() {
    const basis = $('#cfgExitBasis').value;
    $$('.exit-fields[data-basis]').forEach((el) => { el.hidden = el.dataset.basis !== basis; });
    const hints = {
      signal: '신호 엔진이 변동성(ATR)에 맞춰 손절·목표를 자동으로 잡습니다.',
      percent: '진입가 기준 퍼센트로 손절·목표를 잡습니다. 봉 주기와 무관합니다.',
      amount: '총 손익 금액으로 잡습니다. 수량이 정해진 뒤 주당 가격으로 환산됩니다.',
      ticks: '호가(틱) 개수로 잡습니다. 가장 촘촘한 초단타용입니다.',
    };
    $('#exitHint').innerHTML = `${hints[basis] || ''} 봉 주기와 상관없이 <b>틱 단위 실시간</b>으로 감시합니다.`;
  }

  /** 수량 결정 방식에 맞는 입력칸만 보여 준다 */
  function syncSizingFields() {
    const mode = $('#cfgSizingMode').value;
    $$('.exit-fields[data-sizing]').forEach((el) => { el.hidden = el.dataset.sizing !== mode; });
  }

  /** 지금 설정으로 사면 손절·목표가 얼마가 되는지 미리 보여 준다 */
  let previewTimer = null;
  function updateBracketPreview() {
    const box = $('#bracketPreview');
    if (!$('#ordBracket').checked) { box.hidden = true; return; }
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const snap = state.snapshot;
      if (!snap || !snap.quote) return;
      const price = Number($('#ordPrice').value) || snap.quote.price;
      const qty = Math.max(1, Math.floor(Number($('#ordQty').value) || 1));
      try {
        const r = await api(`/api/kr/trader/preview?entry=${price}&qty=${qty}&market=${encodeURIComponent(snap.market || 'KOSPI')}`);
        box.hidden = false;
        box.innerHTML = `매수 후 자동 감시: 손절 <b class="down">${won(r.stop)}</b> (${r.stopPct.toFixed(2)}%)
          · 목표 <b class="up">${won(r.target)}</b> (+${r.targetPct.toFixed(2)}%)<br>
          <span class="muted">기준: ${esc(r.basis)} — 자동매매 패널에서 바꿀 수 있습니다</span>`;
      } catch (_) { box.hidden = true; }
    }, 200);
  }

  /* ------------------------------------------------------------- 검색 */

  function bindSearch() {
    const input = $('#searchInput');
    const list = $('#searchResults');
    const close = () => { list.hidden = true; list.innerHTML = ''; };
    let timer = null;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) return close();
      timer = setTimeout(async () => {
        try {
          const { results } = await api('/api/kr/search?q=' + encodeURIComponent(q));
          if (!results.length) return close();
          list.innerHTML = results.map((r) =>
            `<li data-code="${r.code}"><span class="sym">${esc(r.name)}</span><span class="ex">${r.code} ${esc(r.market || '')}</span></li>`).join('');
          list.hidden = false;
          list.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', () => {
            selectCode(li.dataset.code);
            input.value = '';
            close();
          }));
        } catch (_) { close(); }
      }, 200);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = list.querySelector('li');
        const code = first ? first.dataset.code : input.value.trim();
        if (/^[0-9]{6}$/.test(code)) { selectCode(code); input.value = ''; close(); }
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  /* ------------------------------------------------------------- 시작 */

  function bindControls() {
    $$('#tfGroup button').forEach((b) => b.addEventListener('click', () => {
      state.tf = b.dataset.tf;
      LS.set('tf', state.tf);
      $$('#tfGroup button').forEach((x) => x.classList.toggle('active', x === b));
      chart.resetView();
      connect();
    }));

    $$('#overlayToggles input[data-show]').forEach((input) => {
      const key = input.dataset.show;
      if (state.show && key in state.show) input.checked = state.show[key];
      input.addEventListener('change', () => {
        chart.setShow({ [key]: input.checked });
        state.show = Object.assign({}, chart.show);
        LS.set('show', state.show);
      });
    });

    $('#addWatch').addEventListener('click', () => {
      if (state.watchlist.includes(state.code)) return toast('이미 관심종목에 있습니다.');
      state.watchlist.unshift(state.code);
      LS.set('watchlist', state.watchlist);
      renderWatchlist();
      refreshWatchQuotes();
    });

    $('#ordPrice').addEventListener('input', () => { updateOrderEstimate(); updateBracketPreview(); });
    $('#ordQty').addEventListener('input', () => { updateOrderEstimate(); updateBracketPreview(); });
    $('#btnBuy').addEventListener('click', () => confirmOrder('buy'));
    $('#btnSell').addEventListener('click', () => confirmOrder('sell'));
    $('#confirmCancel').addEventListener('click', () => ($('#confirmModal').hidden = true));
    $('#confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') e.target.hidden = true; });

    $('#cfgSave').addEventListener('click', saveTraderConfig);
    $('#cfgExitBasis').addEventListener('change', () => { syncExitFields(); updateBracketPreview(); });
    $('#cfgSizingMode').addEventListener('change', syncSizingFields);
    $('#ordBracket').addEventListener('change', updateBracketPreview);
    $$('.exit-fields input').forEach((el) => el.addEventListener('input', updateBracketPreview));
    $('#resumeBtn').addEventListener('click', async () => {
      try {
        state.trader = await post('/api/kr/trader/resume', {});
        renderTrader();
        toast('정지를 해제했습니다. 엔진은 꺼진 상태이니 필요하면 다시 켜세요.', 'ok');
      } catch (err) { toast('해제 실패: ' + err.message, 'err'); }
    });
    $('#killBtn').addEventListener('click', async () => {
      if (!confirm('자동매매를 즉시 중단하고 보유 포지션을 청산합니다. 계속할까요?')) return;
      try {
        state.trader = await post('/api/kr/trader/kill', { reason: '화면에서 수동 정지', closePositions: true });
        renderTrader();
        toast('킬스위치가 발동되었습니다.', 'warn');
      } catch (err) { toast('킬스위치 실패: ' + err.message, 'err'); }
    });

    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
      if (e.key === 'Escape') $('#confirmModal').hidden = true;
    });
  }

  async function init() {
    chart = new ScalpChart($('#chart'), {
      timeZone: 'Asia/Seoul',
      onHover: (i) => renderLegend(i),
    });
    chart.setShow(Object.assign({ fib: false, regression: false, stoch: false, sr: false, macd: false }, state.show || {}));
    chart.setMaConfig([
      { period: 5, type: 'ema', on: true },
      { period: 20, type: 'ema', on: true },
      { period: 60, type: 'sma', on: true },
      { period: 120, type: 'sma', on: false },
    ]);

    $$('#tfGroup button').forEach((b) => b.classList.toggle('active', b.dataset.tf === state.tf));
    bindControls();
    bindSearch();
    syncExitFields();
    syncSizingFields();
    renderWatchlist();
    loadNames();
    refreshWatchQuotes();
    setInterval(refreshWatchQuotes, 5000);

    try {
      const h = await api('/api/kr/health');
      const badge = $('#modeBadge');
      badge.textContent = h.modeLabel + (h.mode === 'mock' ? ' (KIS 키 없음)' : '');
      badge.className = 'badge ' + (h.mode === 'live' ? 'demo' : 'live');
      if (h.mode === 'live') toast('실전 계좌에 연결되었습니다. 주문에 주의하세요.', 'warn');
    } catch (_) {}

    connect();
    refreshTrader();
    setInterval(refreshTrader, 5000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
