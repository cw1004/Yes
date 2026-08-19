/**
 * ScalpDesk 앱 컨트롤러 — 데이터 로딩 · 상태 관리 · UI 바인딩.
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const LS = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('scalpdesk:' + key);
        return v ? JSON.parse(v) : fallback;
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('scalpdesk:' + key, JSON.stringify(value)); } catch (_) {}
    },
  };

  const DEFAULT_MA = [
    { period: 5, type: 'ema', on: true },
    { period: 20, type: 'sma', on: true },
    { period: 60, type: 'sma', on: true },
    { period: 120, type: 'sma', on: false },
  ];
  const DEFAULT_SETTINGS = { bbPeriod: 20, bbMult: 2, rsiPeriod: 14, pivotLen: 3 };
  const MARKET_SYMBOLS = [
    { symbol: 'SPY', label: 'S&P500' },
    { symbol: 'QQQ', label: '나스닥100' },
    { symbol: 'DIA', label: '다우' },
    { symbol: 'IWM', label: '러셀2000' },
    { symbol: '^VIX', label: 'VIX 공포지수' },
  ];
  // 봉 주기별로 허용되는 조회 기간 (야후 API 제약 반영)
  const RANGE_LIMITS = {
    '1m': ['1d', '5d'],
    '2m': ['1d', '5d', '1mo'],
    '5m': ['1d', '5d', '1mo'],
    '15m': ['1d', '5d', '1mo', '3mo'],
    '30m': ['1d', '5d', '1mo', '3mo'],
    '60m': ['5d', '1mo', '3mo', '6mo', '1y'],
    '1d': ['1mo', '3mo', '6mo', '1y'],
  };
  const POLL_MS = { '1m': 20000, '2m': 30000, '5m': 45000, '15m': 60000, '30m': 90000, '60m': 120000, '1d': 300000 };

  const state = {
    symbol: LS.get('symbol', 'AAPL'),
    interval: LS.get('interval', '5m'),
    range: LS.get('range', '5d'),
    auto: LS.get('auto', true),
    watchlist: LS.get('watchlist', ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMD']),
    maConfig: LS.get('maConfig', DEFAULT_MA),
    settings: Object.assign({}, DEFAULT_SETTINGS, LS.get('settings', {})),
    show: LS.get('show', null),
    account: LS.get('account', { size: 10000, risk: 1 }),
    alerts: LS.get('alerts', []),
    data: null,
    analysis: null,
    signal: null,
    timer: null,
    loading: false,
    lastNotice: null,
  };

  let chart;

  /* ------------------------------------------------------------ 유틸 */

  const fmtPrice = window.fmtPrice;
  const fmtNum = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d));
  const fmtVol = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  };
  const signClass = (v) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const withSign = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }

  async function api(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('요청 실패 (' + res.status + ')');
    return res.json();
  }

  /* ------------------------------------------------------ 데이터 로딩 */

  async function load(showSpinner = true) {
    if (state.loading) return;
    state.loading = true;
    if (showSpinner) {
      const btn = $('#refreshBtn');
      btn.classList.add('spin');
      setTimeout(() => btn.classList.remove('spin'), 600);
    }
    try {
      const data = await api(
        `/api/candles?symbol=${encodeURIComponent(state.symbol)}&interval=${state.interval}&range=${state.range}`
      );
      if (data.error) throw new Error(data.error);
      state.data = data;
      if (data.notice && state.lastNotice !== data.notice) {
        state.lastNotice = data.notice;
        toast(data.notice, 'warn');
      }
      recompute();
      renderAll();
      checkAlerts();
    } catch (err) {
      toast('시세를 불러오지 못했습니다: ' + err.message, 'err');
    } finally {
      state.loading = false;
    }
  }

  function recompute() {
    if (!state.data || !state.data.candles.length) return;
    const s = state.settings;
    state.analysis = Signals.analyze(state.data.candles, {
      maConfig: state.maConfig,
      bbPeriod: s.bbPeriod,
      bbMult: s.bbMult,
      rsiPeriod: s.rsiPeriod,
      pivotLeft: s.pivotLen,
      pivotRight: s.pivotLen,
      intraday: state.interval !== '1d',
      barsPerYear: state.interval === '1d' ? 252 : 98280,
    });
    state.signal = Signals.evaluate(state.analysis);
  }

  /* ---------------------------------------------------------- 렌더링 */

  function renderAll() {
    renderQuote();
    syncVwapToggle();
    chart.intraday = state.interval !== '1d';
    chart.setMaConfig(state.maConfig);
    chart.setDrawings(LS.get('draw:' + state.symbol + ':' + state.interval, []));
    chart.setData(state.data.candles, state.analysis);
    renderLegend(state.data.candles.length - 1);
    renderSignal();
    renderPlan();
    renderIndicators();
    renderAlerts();
    renderWatchlistActive();
  }

  /** 일봉에서는 VWAP 토글을 잠그고 이유를 알려준다 */
  function syncVwapToggle() {
    const input = document.querySelector('#overlayToggles input[data-show="vwap"]');
    if (!input) return;
    const daily = state.interval === '1d';
    input.disabled = daily;
    const label = input.closest('label');
    label.style.opacity = daily ? '.4' : '';
    label.title = daily ? '일봉에서는 VWAP이 의미가 없어 비활성화됩니다 (분/시간봉에서 사용)' : '';
  }

  function renderQuote() {
    const m = state.data.meta;
    const candles = state.data.candles;
    const last = candles[candles.length - 1];
    const price = m.price != null ? m.price : last.c;
    const prev = m.previousClose;
    const chg = prev != null ? price - prev : null;
    const chgPct = prev ? (chg / prev) * 100 : null;

    $('#qSymbol').textContent = state.data.symbol || state.symbol;
    $('#qName').textContent = m.name || '';
    $('#qPrice').textContent = fmtPrice(price);
    const chgEl = $('#qChange');
    chgEl.textContent = chg == null ? '—' : `${withSign(chg)} (${withSign(chgPct)}%)`;
    chgEl.className = 'chg ' + signClass(chg);

    const sessionStart = lastSessionStart(candles);
    const day = candles.slice(sessionStart);
    $('#qHigh').textContent = fmtPrice(m.dayHigh != null ? m.dayHigh : Math.max(...day.map((c) => c.h)));
    $('#qLow').textContent = fmtPrice(m.dayLow != null ? m.dayLow : Math.min(...day.map((c) => c.l)));
    $('#qVol').textContent = fmtVol(m.regularMarketVolume != null ? m.regularMarketVolume : day.reduce((a, c) => a + (c.v || 0), 0));
    const st = state.signal ? state.signal.stats : {};
    $('#qAtr').textContent = st.atr != null ? `${fmtNum(st.atr)} (${fmtNum(st.atrPct)}%)` : '—';
    $('#qVola').textContent = st.volatility != null ? fmtNum(st.volatility, 1) + '%' : '—';
    $('#qUpdated').textContent = new Date().toLocaleTimeString('ko-KR', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const badge = $('#modeBadge');
    const live = state.data.source === 'yahoo';
    badge.textContent = live ? '실시간 · Yahoo' : '데모 데이터';
    badge.className = 'badge ' + (live ? 'live' : 'demo');
    document.title = `${fmtPrice(price)} ${state.data.symbol || state.symbol} · ScalpDesk`;
  }

  /** 마지막 거래일(세션) 시작 인덱스 */
  function lastSessionStart(candles) {
    if (state.interval === '1d') return Math.max(0, candles.length - 1);
    const lastDay = new Date(candles[candles.length - 1].t).toDateString();
    for (let i = candles.length - 1; i >= 0; i--) {
      if (new Date(candles[i].t).toDateString() !== lastDay) return i + 1;
    }
    return 0;
  }

  function renderLegend(index) {
    const a = state.analysis;
    if (!a) return;
    const i = Math.max(0, Math.min(index, state.data.candles.length - 1));
    const parts = [];
    state.maConfig.forEach((m, k) => {
      if (!m.on) return;
      const v = a.ma[k][i];
      parts.push(`<span style="color:${MA_COLORS[k % MA_COLORS.length]}"><i style="background:${MA_COLORS[k % MA_COLORS.length]}"></i>${m.type.toUpperCase()}${m.period} ${v == null ? '—' : fmtPrice(v)}</span>`);
    });
    if (chart.show.bb && a.bb.upper[i] != null) {
      parts.push(`<span style="color:#6b8afd"><i style="background:#6b8afd"></i>BB ${fmtPrice(a.bb.upper[i])} / ${fmtPrice(a.bb.mid[i])} / ${fmtPrice(a.bb.lower[i])}</span>`);
    }
    if (chart.show.vwap && a.vwap && a.vwap[i] != null) {
      parts.push(`<span style="color:#f0b429"><i style="background:#f0b429"></i>VWAP ${fmtPrice(a.vwap[i])}</span>`);
    }
    $('#legend').innerHTML = parts.join('');

    const c = state.data.candles[i];
    const chg = c.o ? ((c.c - c.o) / c.o) * 100 : 0;
    $('#hoverBar').innerHTML =
      `${chart.fmtDateTime(c.t)}${state.interval === '1d' ? '' : ' (ET)'} &nbsp;·&nbsp; 시 <b>${fmtPrice(c.o)}</b> 고 <b>${fmtPrice(c.h)}</b> 저 <b>${fmtPrice(c.l)}</b> 종 <b class="${signClass(c.c - c.o)}">${fmtPrice(c.c)}</b> ` +
      `<span class="${signClass(chg)}">(${withSign(chg)}%)</span> &nbsp;·&nbsp; 거래량 <b>${fmtVol(c.v)}</b>` +
      (a.rsi[i] != null ? ` &nbsp;·&nbsp; RSI <b>${fmtNum(a.rsi[i], 1)}</b>` : '') +
      (a.macd.hist[i] != null ? ` &nbsp;·&nbsp; MACD hist <b>${fmtNum(a.macd.hist[i], 3)}</b>` : '');
  }

  function renderSignal() {
    const s = state.signal;
    if (!s) return;
    const card = $('#signalCard');
    card.className = 'signal-card ' + s.tone;
    $('#signalLabel').textContent = s.label;
    $('#signalScore').textContent = (s.score > 0 ? '+' : '') + s.score;

    const fill = $('#gaugeFill');
    const pct = Math.min(50, Math.abs(s.score) / 2);
    fill.style.width = pct + '%';
    if (s.score >= 0) {
      fill.style.left = '50%';
      fill.style.background = 'var(--up)';
    } else {
      fill.style.left = 50 - pct + '%';
      fill.style.background = 'var(--down)';
    }

    $('#reasonList').innerHTML = s.reasons
      .slice(0, 14)
      .map(
        (r) => `<li><span class="dot ${r.dir > 0 ? 'up' : r.dir < 0 ? 'down' : ''}"></span>
          <div><b>${escapeHtml(r.title)}</b>${r.weight ? ` <span class="muted">(${r.dir > 0 ? '+' : '-'}${r.weight})</span>` : ''}
          <small>${escapeHtml(r.detail)}</small></div></li>`
      )
      .join('');
  }

  function renderPlan() {
    const p = state.signal && state.signal.plan;
    const cells = ['#pSide', '#pEntry', '#pStop', '#pT1', '#pT2', '#pRR'];
    if (!p) {
      cells.forEach((c) => ($(c).textContent = '—'));
      return;
    }
    const long = p.side === 'LONG';
    $('#pSide').innerHTML = `<b class="${long ? 'up' : 'down'}">${long ? '롱 (매수)' : '숏 (매도/관망)'}</b>`;
    $('#pEntry').textContent = fmtPrice(p.entry);
    $('#pStop').innerHTML = `<span class="down">${fmtPrice(p.stop)}</span> <small class="muted">(${long ? '-' : '+'}${fmtNum(p.stopPct)}%)</small>`;
    $('#pT1').innerHTML = `<span class="up">${fmtPrice(p.target1)}</span>`;
    $('#pT2').innerHTML = `<span class="up">${fmtPrice(p.target2)}</span>`;
    const rrClass = p.rr >= 1.5 ? 'up' : p.rr >= 1 ? 'flat' : 'down';
    $('#pRR').innerHTML = `<b class="${rrClass}">1 : ${fmtNum(p.rr)}</b>`;
    renderCalc();
  }

  function renderCalc() {
    const p = state.signal && state.signal.plan;
    const acct = Number($('#acctInput').value) || 0;
    const risk = Number($('#riskInput').value) || 0;
    state.account = { size: acct, risk };
    LS.set('account', state.account);
    if (!p) return;
    const pos = Signals.positionSize(acct, risk, p.riskPerShare, p.entry);
    $('#cRisk').textContent = '$' + fmtNum(p.riskPerShare);
    $('#cShares').innerHTML = pos
      ? pos.shares.toLocaleString() + '주' +
        (pos.capped ? ` <small class="muted" title="리스크 기준 ${pos.sharesByRisk}주지만 매수 여력이 부족합니다">(여력 제한)</small>` : '')
      : '—';
    $('#cNotional').textContent = pos ? '$' + pos.notional.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
    $('#cLoss').textContent = pos ? '-$' + pos.maxLoss.toFixed(0) : '—';
  }

  function renderIndicators() {
    const st = state.signal ? state.signal.stats : null;
    const a = state.analysis;
    if (!st || !a) return;
    const i = state.data.candles.length - 1;
    const rows = [
      ['현재가', fmtPrice(st.price)],
      ['VWAP 이격', st.vwap ? `${withSign(((st.price - st.vwap) / st.vwap) * 100)}%` : '—'],
      ['RSI(14)', colorize(fmtNum(st.rsi, 1), st.rsi >= 70 ? 'down' : st.rsi <= 30 ? 'up' : 'flat')],
      ['MACD 히스토그램', colorize(fmtNum(st.macdHist, 3), st.macdHist > 0 ? 'up' : 'down')],
      ['스토캐스틱 %K', fmtNum(st.stochK, 1)],
      ['볼린저 %B', st.percentB == null ? '—' : colorize(fmtNum(st.percentB), st.percentB > 0.8 ? 'down' : st.percentB < 0.2 ? 'up' : 'flat')],
      ['밴드폭 순위', st.bbWidthRank == null ? '—' : `${fmtNum(st.bbWidthRank, 0)}% ${st.bbWidthRank < 15 ? '(스퀴즈)' : ''}`],
      ['ATR(14)', `${fmtNum(st.atr)} (${fmtNum(st.atrPct)}%)`],
      ['거래량 배율', st.volRatio == null ? '—' : colorize(fmtNum(st.volRatio, 2) + '배', st.volRatio >= 1.5 ? 'up' : 'flat')],
      ['OBV', fmtVol(a.obv[i])],
      ['캔들 패턴', st.pattern ? st.pattern.name : '—'],
      ['근접 지지', st.nearest.support ? fmtPrice(st.nearest.support.price) : '—'],
      ['근접 저항', st.nearest.resistance ? fmtPrice(st.nearest.resistance.price) : '—'],
    ];
    $('#indicatorTable tbody').innerHTML = rows
      .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
      .join('');
  }

  const colorize = (text, cls) => `<span class="${cls}">${text}</span>`;
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------- 관심종목 */

  async function refreshWatchlist() {
    const syms = state.watchlist;
    const el = $('#watchlist');
    if (!syms.length) {
      el.innerHTML = '<li class="muted" style="padding:10px">관심종목이 없습니다.</li>';
      return;
    }
    el.innerHTML = syms.map((s) => rowHtml({ symbol: s })).join('');
    bindWatchRows();
    try {
      const { quotes } = await api('/api/quotes?symbols=' + encodeURIComponent(syms.join(',')));
      const map = new Map(quotes.map((q) => [q.symbol, q]));
      el.innerHTML = syms.map((s) => rowHtml(map.get(s) || { symbol: s })).join('');
      bindWatchRows();
      renderWatchlistActive();
    } catch (_) { /* 조용히 무시: 다음 폴링에서 재시도 */ }
  }

  async function refreshMarket() {
    const el = $('#marketList');
    el.innerHTML = MARKET_SYMBOLS.map((m) => `<li data-symbol="${m.symbol}"><div><span class="w-sym">${m.label}</span><span class="w-name">${m.symbol}</span></div><span class="w-price">—</span><span class="w-chg">—</span></li>`).join('');
    try {
      const { quotes } = await api('/api/quotes?symbols=' + encodeURIComponent(MARKET_SYMBOLS.map((m) => m.symbol).join(',')));
      const map = new Map(quotes.map((q) => [q.symbol, q]));
      el.innerHTML = MARKET_SYMBOLS.map((m) => {
        const q = map.get(m.symbol) || {};
        const cls = signClass(q.change);
        return `<li data-symbol="${m.symbol}">
          <div><span class="w-sym">${m.label}</span><span class="w-name">${m.symbol}</span></div>
          <span class="w-price">${q.price != null ? fmtPrice(q.price) : '—'}</span>
          <span class="w-chg ${cls}">${q.changePercent != null ? withSign(q.changePercent) + '%' : '—'}</span>
        </li>`;
      }).join('');
      el.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => selectSymbol(li.dataset.symbol)));
    } catch (_) {}
  }

  function rowHtml(q) {
    const cls = signClass(q.change);
    return `<li data-symbol="${q.symbol}">
      <div><span class="w-sym">${q.symbol}</span><span class="w-name">${escapeHtml(q.name || '')}</span></div>
      <div style="text-align:right">
        <span class="w-price">${q.price != null ? fmtPrice(q.price) : '…'}</span><br />
        <span class="w-chg ${cls}">${q.changePercent != null ? withSign(q.changePercent) + '%' : ''}</span>
      </div>
      <button class="w-del" title="삭제">✕</button>
    </li>`;
  }

  function bindWatchRows() {
    $$('#watchlist li[data-symbol]').forEach((li) => {
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('w-del')) {
          state.watchlist = state.watchlist.filter((s) => s !== li.dataset.symbol);
          LS.set('watchlist', state.watchlist);
          refreshWatchlist();
          return;
        }
        selectSymbol(li.dataset.symbol);
      });
    });
  }

  function renderWatchlistActive() {
    $$('#watchlist li[data-symbol]').forEach((li) => {
      li.classList.toggle('active', li.dataset.symbol === state.symbol);
    });
  }

  function selectSymbol(sym) {
    if (!sym || sym === state.symbol) return;
    state.symbol = sym.toUpperCase();
    LS.set('symbol', state.symbol);
    chart.resetView();
    load();
  }

  /* ------------------------------------------------------------ 알림 */

  function renderAlerts() {
    const el = $('#alertList');
    el.innerHTML = state.alerts
      .map((a, i) => `<li class="${a.fired ? 'fired' : ''}">
        <span>${a.symbol} · ${labelForAlert(a)} ${a.value}</span>
        <button data-idx="${i}" title="삭제">✕</button></li>`)
      .join('');
    el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.alerts.splice(Number(b.dataset.idx), 1);
        LS.set('alerts', state.alerts);
        renderAlerts();
      })
    );
  }

  const labelForAlert = (a) =>
    ({ above: '가격 ≥', below: '가격 ≤', rsiAbove: 'RSI ≥', rsiBelow: 'RSI ≤' }[a.type] || a.type);

  function checkAlerts() {
    if (!state.signal) return;
    const st = state.signal.stats;
    let changed = false;
    for (const a of state.alerts) {
      if (a.symbol !== state.symbol || a.fired) continue;
      const value = a.type.startsWith('rsi') ? st.rsi : st.price;
      if (value == null) continue;
      const hit = a.type === 'above' || a.type === 'rsiAbove' ? value >= a.value : value <= a.value;
      if (hit) {
        a.fired = true;
        changed = true;
        const msg = `🔔 ${a.symbol} ${labelForAlert(a)} ${a.value} 도달 (현재 ${fmtNum(value)})`;
        toast(msg, 'ok');
        notify(msg);
      }
    }
    if (changed) {
      LS.set('alerts', state.alerts);
      renderAlerts();
    }
  }

  function notify(msg) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification('ScalpDesk', { body: msg });
  }

  /* ------------------------------------------------------------ 검색 */

  let searchTimer = null;
  function bindSearch() {
    const input = $('#searchInput');
    const list = $('#searchResults');
    const close = () => { list.hidden = true; list.innerHTML = ''; };

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 1) return close();
      searchTimer = setTimeout(async () => {
        try {
          const { results } = await api('/api/search?q=' + encodeURIComponent(q));
          if (!results.length) return close();
          list.innerHTML = results
            .map((r) => `<li data-symbol="${r.symbol}"><span class="sym">${r.symbol}</span><span class="ex">${escapeHtml(r.name || '')} · ${escapeHtml(r.exchange || '')}</span></li>`)
            .join('');
          list.hidden = false;
          list.querySelectorAll('li').forEach((li) =>
            li.addEventListener('mousedown', () => {
              selectSymbol(li.dataset.symbol);
              input.value = '';
              close();
            })
          );
        } catch (_) { close(); }
      }, 220);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const sel = list.querySelector('li');
        const sym = sel ? sel.dataset.symbol : input.value.trim().toUpperCase();
        if (sym) {
          selectSymbol(sym);
          input.value = '';
          close();
        }
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  /* --------------------------------------------------------- 컨트롤 */

  function syncRangeButtons() {
    const allowed = RANGE_LIMITS[state.interval] || [];
    $$('#rangeGroup button').forEach((b) => {
      const ok = allowed.includes(b.dataset.range);
      b.disabled = !ok;
      b.style.opacity = ok ? '' : '.3';
      b.classList.toggle('active', b.dataset.range === state.range);
    });
    if (!allowed.includes(state.range)) {
      state.range = allowed[Math.min(1, allowed.length - 1)];
      LS.set('range', state.range);
      $$('#rangeGroup button').forEach((b) => b.classList.toggle('active', b.dataset.range === state.range));
    }
  }

  function bindControls() {
    $$('#intervalGroup button').forEach((b) =>
      b.addEventListener('click', () => {
        state.interval = b.dataset.interval;
        LS.set('interval', state.interval);
        $$('#intervalGroup button').forEach((x) => x.classList.toggle('active', x === b));
        syncRangeButtons();
        chart.resetView();
        load();
        restartTimer();
      })
    );
    $$('#rangeGroup button').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.disabled) return;
        state.range = b.dataset.range;
        LS.set('range', state.range);
        $$('#rangeGroup button').forEach((x) => x.classList.toggle('active', x === b));
        chart.resetView();
        load();
      })
    );

    $('#refreshBtn').addEventListener('click', () => load());
    $('#autoRefresh').checked = state.auto;
    $('#autoRefresh').addEventListener('change', (e) => {
      state.auto = e.target.checked;
      LS.set('auto', state.auto);
      restartTimer();
      toast(state.auto ? '자동 새로고침 켜짐' : '자동 새로고침 꺼짐');
    });

    $('#addWatch').addEventListener('click', () => {
      if (state.watchlist.includes(state.symbol)) return toast('이미 관심종목에 있습니다.');
      state.watchlist.unshift(state.symbol);
      LS.set('watchlist', state.watchlist);
      refreshWatchlist();
      toast(state.symbol + ' 추가됨', 'ok');
    });

    $$('#overlayToggles input[data-show]').forEach((input) => {
      const key = input.dataset.show;
      if (state.show && key in state.show) input.checked = state.show[key];
      input.addEventListener('change', () => {
        chart.setShow({ [key]: input.checked });
        state.show = Object.assign({}, chart.show);
        LS.set('show', state.show);
        renderLegend(state.data.candles.length - 1);
      });
    });

    $('#drawBtn').addEventListener('click', () => {
      const on = !chart.drawMode;
      chart.setDrawMode(on);
      $('#drawBtn').classList.toggle('on', on);
      if (on) toast('차트에서 두 지점을 클릭해 추세선을 그리세요.');
    });
    $('#clearDrawBtn').addEventListener('click', () => {
      chart.setDrawings([]);
      LS.set('draw:' + state.symbol + ':' + state.interval, []);
      toast('사용자 추세선을 지웠습니다.');
    });

    $('#csvBtn').addEventListener('click', exportCsv);

    $('#acctInput').value = state.account.size;
    $('#riskInput').value = state.account.risk;
    $('#acctInput').addEventListener('input', renderCalc);
    $('#riskInput').addEventListener('input', renderCalc);

    $('#alertAdd').addEventListener('click', () => {
      const type = $('#alertType').value;
      const value = Number($('#alertValue').value);
      if (!value) return toast('알림 값을 입력하세요.', 'warn');
      state.alerts.push({ symbol: state.symbol, type, value, fired: false });
      LS.set('alerts', state.alerts);
      renderAlerts();
      $('#alertValue').value = '';
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      toast('알림이 등록되었습니다.', 'ok');
    });

    bindSettingsModal();

    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'r' || e.key === 'R') load();
      if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
      if (e.key === 'd' || e.key === 'D') $('#drawBtn').click();
    });
  }

  function bindSettingsModal() {
    const modal = $('#settingsModal');
    const open = () => {
      renderMaConfig();
      $('#bbPeriod').value = state.settings.bbPeriod;
      $('#bbMult').value = state.settings.bbMult;
      $('#rsiPeriod').value = state.settings.rsiPeriod;
      $('#pivotLen').value = state.settings.pivotLen;
      modal.hidden = false;
    };
    $('#settingsBtn').addEventListener('click', open);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    $('#settingsClose').addEventListener('click', () => {
      state.settings = {
        bbPeriod: clampInt($('#bbPeriod').value, 2, 200, 20),
        bbMult: Math.max(0.5, Math.min(4, Number($('#bbMult').value) || 2)),
        rsiPeriod: clampInt($('#rsiPeriod').value, 2, 50, 14),
        pivotLen: clampInt($('#pivotLen').value, 1, 15, 3),
      };
      LS.set('settings', state.settings);
      LS.set('maConfig', state.maConfig);
      modal.hidden = true;
      recompute();
      renderAll();
    });
    $('#settingsReset').addEventListener('click', () => {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      state.maConfig = JSON.parse(JSON.stringify(DEFAULT_MA));
      LS.set('settings', state.settings);
      LS.set('maConfig', state.maConfig);
      open();
      recompute();
      renderAll();
    });
  }

  function renderMaConfig() {
    $('#maConfig').innerHTML = state.maConfig
      .map(
        (m, i) => `<div class="ma-row">
          <span class="ma-swatch" style="background:${MA_COLORS[i % MA_COLORS.length]}"></span>
          <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-ma="on" data-i="${i}" ${m.on ? 'checked' : ''} /> 이동평균 ${i + 1}</label>
          <input type="number" data-ma="period" data-i="${i}" value="${m.period}" min="2" max="400" />
          <select data-ma="type" data-i="${i}">
            <option value="sma" ${m.type === 'sma' ? 'selected' : ''}>단순(SMA)</option>
            <option value="ema" ${m.type === 'ema' ? 'selected' : ''}>지수(EMA)</option>
          </select>
        </div>`
      )
      .join('');
    $$('#maConfig [data-ma]').forEach((el) =>
      el.addEventListener('change', () => {
        const i = Number(el.dataset.i);
        const field = el.dataset.ma;
        if (field === 'on') state.maConfig[i].on = el.checked;
        else if (field === 'period') state.maConfig[i].period = clampInt(el.value, 2, 400, 20);
        else state.maConfig[i].type = el.value;
        LS.set('maConfig', state.maConfig);
        recompute();
        renderAll();
      })
    );
  }

  const clampInt = (v, lo, hi, dflt) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
  };

  function exportCsv() {
    if (!state.data) return;
    const a = state.analysis;
    const head = ['time_iso', 'open', 'high', 'low', 'close', 'volume', 'vwap', 'bb_upper', 'bb_mid', 'bb_lower', 'rsi', 'macd_hist'];
    const lines = [head.join(',')];
    state.data.candles.forEach((c, i) => {
      lines.push([
        new Date(c.t).toISOString(), c.o, c.h, c.l, c.c, c.v,
        n(a.vwap[i]), n(a.bb.upper[i]), n(a.bb.mid[i]), n(a.bb.lower[i]), n(a.rsi[i]), n(a.macd.hist[i]),
      ].join(','));
    });
    function n(v) { return v == null || !isFinite(v) ? '' : Number(v).toFixed(4); }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.symbol}_${state.interval}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('CSV를 내려받았습니다.', 'ok');
  }

  /* ------------------------------------------------------------ 타이머 */

  function restartTimer() {
    clearInterval(state.timer);
    if (!state.auto) return;
    state.timer = setInterval(() => {
      if (document.hidden) return; // 백그라운드 탭에서는 폴링 중단
      load(false);
      refreshWatchlist();
    }, POLL_MS[state.interval] || 60000);
  }

  /* --------------------------------------------------------------- 시작 */

  function init() {
    chart = new ScalpChart($('#chart'), {
      onHover: (i) => renderLegend(i),
      onDrawingsChange: (list) => LS.set('draw:' + state.symbol + ':' + state.interval, list),
    });
    if (state.show) chart.setShow(state.show);
    chart.setMaConfig(state.maConfig);

    $$('#intervalGroup button').forEach((b) => b.classList.toggle('active', b.dataset.interval === state.interval));
    syncRangeButtons();
    bindControls();
    bindSearch();
    renderAlerts();

    load();
    refreshWatchlist();
    refreshMarket();
    restartTimer();
    setInterval(refreshMarket, 120000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
