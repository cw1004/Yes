/**
 * ScalpDesk AI — 추천 종목 화면 컨트롤러.
 *
 * 주의: 이 화면에 그려지는 문장·링크는 LLM과 웹 검색 결과에서 온 외부 콘텐츠다.
 * 모든 텍스트는 이스케이프하고, 링크는 http(s) 스킴만 허용한다.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('scalpai:' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('scalpai:' + k, JSON.stringify(v)); } catch (_) {} },
  };

  const state = {
    market: LS.get('market', 'US'),
    horizon: LS.get('horizon', null),
    risk: LS.get('risk', null),
    running: false,
    providers: [],            // 서버가 알려준 엔진 상태
    selected: LS.get('selected', null),  // 사용자가 고른 엔진 (null = 전부)
    result: null,
    performance: null,
    startedAt: 0,
    timer: null,
    scanOn: LS.get('scanOn', false),
    scanES: null,
    scan: { US: null, KR: null },
  };

  /* ------------------------------------------------------------- 유틸 */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** LLM/웹에서 온 URL은 http(s)만 허용한다 (javascript: 등 차단) */
  function safeUrl(raw) {
    try {
      const u = new URL(String(raw));
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (_) { return null; }
  }
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

  const isKR = () => state.market === 'KR';
  const price = (v) => {
    if (v == null || !isFinite(v)) return '—';
    return isKR() ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2);
  };
  const pct = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%');
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const num = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function api(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '요청 실패 (' + res.status + ')');
    return json;
  }

  /* ------------------------------------------------------------- 실행 */

  async function run(force) {
    if (state.running) return;
    state.running = true;
    state.startedAt = Date.now();
    $('#runBtn').disabled = true;
    renderStatus();
    state.timer = setInterval(renderStatus, 1000);

    try {
      const q = new URLSearchParams({
        market: state.market,
        horizon: state.horizon || '',
        risk: state.risk || '',
      });
      const chosen = selectedProviders();
      if (chosen.length) q.set('providers', chosen.join(','));
      if (force) q.set('force', '1');
      const result = await api('/api/ai/recommend?' + q.toString());
      state.result = result;
      render();
      if (result.engine === 'rules') {
        toast('사용 가능한 AI 엔진이 없어 지표 기반 결과만 표시합니다.', 'warn');
      }
      (result.failures || []).forEach((f) => toast(`${f.label} 실패: ${f.error}`, 'warn'));
      loadPerformance();
    } catch (err) {
      toast('분석 실패: ' + err.message, 'err');
      $('#picks').innerHTML = `<div class="empty-state">분석에 실패했습니다.<br />${esc(err.message)}</div>`;
    } finally {
      state.running = false;
      clearInterval(state.timer);
      $('#runBtn').disabled = false;
      renderStatus();
    }
  }

  /* ------------------------------------------------------------- 렌더 */

  function renderStatus() {
    const bar = $('#statusBar');
    if (state.running) {
      const sec = Math.round((Date.now() - state.startedAt) / 1000);
      bar.innerHTML = `<div class="progress-note"><i class="spinner"></i>
        <span>종목 스캔 후 웹에서 최신 뉴스를 조사하는 중… <b>${sec}초</b> 경과 (보통 30~90초)</span></div>`;
      return;
    }
    const r = state.result;
    if (!r) {
      bar.innerHTML = '<div class="muted">‘AI 분석 실행’을 누르면 종목을 스캔한 뒤 최신 뉴스를 조사합니다.</div>';
      return;
    }
    const engine = r.engine === 'ai'
      ? `<b class="up">${(r.engines || []).map((e) => esc(e.label)).join(' + ') || 'AI'}</b> <span class="muted">(${esc(r.model || '')})</span>`
      : '<b class="warn-text">지표 전용</b> <span class="muted">(AI 엔진 없음)</span>';
    const src = r.dataSource === 'mock' ? '<b class="warn-text">데모 데이터</b>' : `<b>${esc(r.dataSource)}</b>`;
    bar.innerHTML = `
      <div class="stat"><span>엔진</span>${engine}</div>
      <div class="stat"><span>시세</span>${src}</div>
      <div class="stat"><span>스캔</span><b>${r.scanned}종목</b></div>
      <div class="stat"><span>웹 검색</span><b>${r.webSearches}회</b></div>
      ${r.news ? `<div class="stat"><span>뉴스</span><b>${r.news.articles}건</b>
        <span class="muted">(피드 ${r.news.feedsOk}/${r.news.feedsTried})</span></div>` : ''}
      ${r.usage ? `<div class="stat"><span>토큰</span><b>${(r.usage.input_tokens + r.usage.output_tokens).toLocaleString()}</b></div>
        ${r.usage.estimatedCostUsd != null ? `<div class="stat"><span>예상 비용</span><b>$${r.usage.estimatedCostUsd.toFixed(3)}</b></div>` : ''}` : ''}
      <div class="stat"><span>생성</span><b>${new Date(r.generatedAt).toLocaleTimeString('ko-KR', { hour12: false })}</b></div>
      ${r.cached ? '<div class="stat"><span>캐시된 결과</span></div>' : ''}
      <button id="forceBtn" class="mini-btn">새로 분석</button>`;
    $('#forceBtn').addEventListener('click', () => run(true));
  }

  function render() {
    const r = state.result;
    if (!r) return;

    $('#contextCard').hidden = !r.marketContext;
    $('#marketContext').textContent = r.marketContext || '';

    $('#picks').innerHTML = r.picks.map((p, i) => pickCard(p, i)).join('');
    $('#candidatesPanel').hidden = false;
    $('#candidateNote').textContent = `${r.scanned}종목 스캔 · 상위 ${r.candidates.length}개`;

    const picked = new Set(r.picks.map((p) => String(p.symbol).toUpperCase()));
    $('#candTable tbody').innerHTML = r.candidates.map((c) => `
      <tr class="${picked.has(String(c.symbol).toUpperCase()) ? 'picked' : ''}">
        <td><b>${esc(c.name || c.symbol)}</b> <span class="muted">${esc(c.symbol)}</span></td>
        <td>${price(c.price)}</td>
        <td class="${cls(c.changePercent)}">${pct(c.changePercent)}</td>
        <td class="${cls(c.score)}">${c.score > 0 ? '+' : ''}${c.score}</td>
        <td>${num(c.technicals.rsi14)}</td>
        <td>${num(c.technicals.volumeRatio, 2)}</td>
        <td>${num(c.technicals.atrPct, 2)}</td>
        <td>${esc((c.topReasons || []).join(', '))}</td>
      </tr>`).join('');

    if (r.disclaimer) $('#disclaimer').textContent = r.disclaimer;
  }

  function pickCard(p, i) {
    const s = p.snapshot;
    const conf = { '높음': 'high', '중간': 'mid', '낮음': 'low' }[p.confidence] || 'mid';
    const sources = (p.sources || [])
      .map((src) => ({ ...src, href: safeUrl(src.url) }))
      .filter((src) => src.href);

    return `<article class="pick-card rank${i + 1}">
      <div class="pick-head">
        <div class="pick-rank">${i + 1}</div>
        <div class="pick-title">
          <h3>${esc(p.name || p.symbol)}</h3>
          <span class="sym">${esc(p.symbol)}</span>
        </div>
        ${s ? `<div class="pick-price">
          <div class="p">${price(s.price)}</div>
          <div class="c ${cls(s.changePercent)}">${pct(s.changePercent)}</div>
        </div>` : ''}
      </div>

      <div class="pick-badges">
        <span class="pill ${conf}">신뢰도 ${esc(p.confidence)}</span>
        <span class="pill">${esc(p.horizon)}</span>
        ${s ? `<span class="pill score ${cls(s.score)}">신호 ${s.score > 0 ? '+' : ''}${s.score}</span>
               <span class="pill">${esc(s.label)}</span>` : ''}
        ${consensusPill(p)}
        ${p.inCandidates ? '' : '<span class="pill warn">후보 목록 밖 · 지표 미검증</span>'}
        ${s && s.score <= -20 ? '<span class="pill warn">⚠ 지표는 매도 신호</span>' : ''}
        ${s && s.plan && s.plan.side === 'SHORT' ? '<span class="pill warn">하락 방향 플랜</span>' : ''}
      </div>

      <p class="pick-thesis">${esc(p.thesis)}</p>

      ${listSection('catalysts', '상승 촉매', p.catalysts)}
      ${listSection('risks', '리스크', p.risks)}

      ${s ? `<div class="snap">
        <div><span>RSI(14)</span><b>${num(s.technicals.rsi14)}</b></div>
        <div><span>거래량 배율</span><b>${num(s.technicals.volumeRatio, 2)}배</b></div>
        <div><span>ATR</span><b>${num(s.technicals.atrPct, 2)}%</b></div>
      </div>` : ''}

      ${s && s.plan ? `<div class="plan-row">
        <span>${s.plan.side === 'SHORT' ? '<b class="down">하락</b>' : '<b class="up">상승</b>'} 진입 <b>${price(s.plan.entry)}</b></span>
        <span class="down">손절 <b>${price(s.plan.stop)}</b>${s.plan.stopTicks ? ` (${s.plan.stopTicks}호가)` : ''}</span>
        <span class="up">목표 <b>${price(s.plan.target)}</b>${s.plan.targetTicks ? ` (${s.plan.targetTicks}호가)` : ''}</span>
        <span>R:R <b>${s.plan.rr == null ? '—' : '1:' + s.plan.rr.toFixed(2)}</b></span>
      </div>` : ''}

      ${perProviderBlock(p)}

      <div class="pick-section">
        <h4>출처 ${sources.length ? '' : '<span class="muted">(없음)</span>'}</h4>
        <div class="sources">
          ${sources.map((src) => `<a href="${esc(src.href)}" target="_blank" rel="noopener noreferrer">
            ${esc(src.title || src.href)} <span class="pub">· ${esc(src.publisher || hostOf(src.href))}</span></a>`).join('')}
        </div>
      </div>
    </article>`;
  }

  /** 몇 개 엔진이 이 종목을 골랐는지 */
  function consensusPill(p) {
    const c = p.consensus;
    if (!c || !c.total) return '';
    if (c.total === 1) return `<span class="pill">${esc(c.labels[0] || '')} 단독</span>`;
    return c.agreed
      ? `<span class="pill consensus">✓ ${c.votes}개 엔진 합의</span>`
      : `<span class="pill solo">${esc(c.labels.join(', '))}만 선택 (${c.votes}/${c.total})</span>`;
  }

  /** 엔진별 서술 비교 (의견이 갈리는 지점을 직접 볼 수 있게) */
  function perProviderBlock(p) {
    const list = p.perProvider || [];
    if (list.length < 2) return '';
    return `<details class="per-provider">
      <summary>엔진별 의견 ${list.length}건 비교</summary>
      ${list.map((x) => `<div class="pp-item">
        <div class="pp-head">
          <span class="pp-name">${esc(x.label)}</span>
          <span class="pill">${x.rank}순위</span>
          <span class="pill">신뢰도 ${esc(x.confidence)}</span>
        </div>
        <div>${esc(x.thesis)}</div>
      </div>`).join('')}
    </details>`;
  }

  function listSection(kind, title, items) {
    if (!items || !items.length) return '';
    return `<div class="pick-section ${kind}">
      <h4>${title}</h4>
      <ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>`;
  }

  /* --------------------------------------------------------- 엔진 선택 */

  function selectedProviders() {
    if (!state.selected) return [];   // 전부 사용
    return state.selected.filter((n) => state.providers.some((p) => p.name === n && p.ready));
  }

  function renderEngineChips() {
    const el = $('#engineChips');
    if (!state.providers.length) { el.innerHTML = ''; return; }
    const chosen = state.selected;
    el.innerHTML = state.providers.map((p) => {
      const on = !chosen || chosen.includes(p.name);
      const title = p.ready ? `${p.model} · ${p.endpoint}` : (p.reason || '사용 불가');
      return `<label class="engine-chip ${p.ready ? 'ready' : 'off'}" title="${esc(title)}">
        <input type="checkbox" data-provider="${esc(p.name)}" ${p.ready ? '' : 'disabled'} ${p.ready && on ? 'checked' : ''} />
        <i class="engine-dot"></i>${esc(p.label)}
      </label>`;
    }).join('');
    el.querySelectorAll('input[data-provider]').forEach((input) => {
      input.addEventListener('change', () => {
        const picked = Array.from(el.querySelectorAll('input[data-provider]:checked')).map((i) => i.dataset.provider);
        const readyNames = state.providers.filter((p) => p.ready).map((p) => p.name);
        state.selected = picked.length === readyNames.length ? null : picked;
        LS.set('selected', state.selected);
      });
    });
  }

  /* --------------------------------------------------------- 성과 추적 */

  async function loadPerformance() {
    try {
      const perf = await api('/api/ai/performance');
      state.performance = perf;
      renderPerformance();
    } catch (err) {
      $('#perfBody').innerHTML = `<div class="muted">성과를 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  }

  function renderPerformance() {
    const p = state.performance;
    if (!p) return;
    $('#perfNote').textContent = `기록 ${p.total}건 · 진행 중 ${p.open} · 종료 ${p.closed}`;

    if (!p.closed) {
      $('#perfBody').innerHTML = `<div class="muted" style="font-size:12.5px;line-height:1.7">
        아직 채점이 끝난 추천이 없습니다. 추천이 나오면 그 시점의 가격이 함께 저장되고,
        목표가·손절가에 닿거나 기간이 지나면 자동으로 채점됩니다.
        ${p.open ? `<br />현재 <b>${p.open}건</b>이 결과를 기다리는 중입니다.` : ''}
      </div>`;
      return;
    }

    const o = p.overall;
    const tbl = (title, obj) => {
      const rows = Object.entries(obj).filter(([, v]) => v.n > 0);
      if (!rows.length) return '';
      return `<div><h4>${title}</h4><table class="perf-table">
        <tr><th></th><th>건수</th><th>승률</th><th>평균</th></tr>
        ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td>
          <td class="${v.winRate >= 50 ? 'up' : 'down'}">${v.winRate}%</td>
          <td class="${cls(v.avgPnlPct)}">${pct(v.avgPnlPct)}</td></tr>`).join('')}
      </table></div>`;
    };

    $('#perfBody').innerHTML = `
      <div class="perf-cards">
        <div><span>채점 완료</span><b>${o.n}건</b></div>
        <div><span>승률</span><b class="${o.winRate >= 50 ? 'up' : 'down'}">${o.winRate}%</b></div>
        <div><span>평균 수익률</span><b class="${cls(o.avgPnlPct)}">${pct(o.avgPnlPct)}</b></div>
        <div><span>최고 / 최저</span><b class="pair"><span class="up">${pct(o.best)}</span> / <span class="down">${pct(o.worst)}</span></b></div>
        <div><span>목표/손절/만료</span><b>${p.byOutcome.target} / ${p.byOutcome.stop} / ${p.byOutcome.expired}</b></div>
      </div>
      <div class="perf-split">
        ${tbl('엔진별', p.byProvider)}
        ${tbl('신뢰도별', p.byConfidence)}
        ${tbl('시장별', p.byMarket)}
      </div>
      ${p.note ? `<div class="perf-warn">⚠ ${esc(p.note)}</div>` : ''}`;
  }

  /* ------------------------------------------------------------- 시작 */

  async function init() {
    $$('#marketGroup button').forEach((b) => {
      b.classList.toggle('active', b.dataset.market === state.market);
      b.addEventListener('click', () => {
        state.market = b.dataset.market;
        LS.set('market', state.market);
        $$('#marketGroup button').forEach((x) => x.classList.toggle('active', x === b));
        state.result = null;
        $('#picks').innerHTML = '';
        $('#contextCard').hidden = true;
        $('#candidatesPanel').hidden = true;
        renderStatus();
      });
    });

    $('#runBtn').addEventListener('click', () => run(false));

    try {
      const h = await api('/api/ai/health');
      state.providers = h.providers || [];
      renderEngineChips();
      const readyCount = state.providers.filter((p) => p.ready).length;
      const badge = $('#modeBadge');
      badge.textContent = readyCount ? `엔진 ${readyCount}개 연결됨` : 'AI 엔진 없음 · 지표 전용';
      badge.className = 'badge ' + (readyCount ? 'live' : 'demo');

      fillSelect('#horizonSelect', h.horizons, state.horizon || h.horizons[1]);
      fillSelect('#riskSelect', h.risks, state.risk || h.risks[1]);
      state.horizon = $('#horizonSelect').value;
      state.risk = $('#riskSelect').value;

      $('#horizonSelect').addEventListener('change', (e) => { state.horizon = e.target.value; LS.set('horizon', state.horizon); });
      $('#riskSelect').addEventListener('change', (e) => { state.risk = e.target.value; LS.set('risk', state.risk); });

      if (!readyCount) {
        toast('ANTHROPIC_API_KEY 를 넣거나 Llama 엔드포인트를 연결하면 뉴스 분석이 켜집니다. 지금은 지표 기반 결과만 나옵니다.', 'warn');
      }
    } catch (err) {
      toast('서버 상태 확인 실패: ' + err.message, 'err');
    }

    $('#picks').innerHTML = '<div class="empty-state">아직 분석 결과가 없습니다. 상단의 <b>AI 분석 실행</b>을 눌러 주세요.</div>';
    bindScanner();
    loadPerformance();
  }


  /* --------------------------------------------------- 실시간 단타 스캐너 */

  /** 시장별 가격 표기 (스캐너는 두 시장을 동시에 보여 주므로 행마다 따로 판단한다) */
  const rowPrice = (v, market) => (v == null || !isFinite(v) ? '—'
    : market === 'KR' ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2));

  function scanRow(r) {
    const chartHref = r.market === 'KR'
      ? '/kr.html#' + encodeURIComponent(r.symbol)
      : '/#' + encodeURIComponent(r.symbol);
    const dir = r.side === 'long' ? '매수' : '매도';
    const why = (r.parts || []).slice(0, 3).map((p) => esc(p.label)).join(' · ');
    const planText = r.plan
      ? `진입 ${rowPrice(r.plan.entry, r.market)} · 손절 ${rowPrice(r.plan.stop, r.market)} · 목표 ${rowPrice(r.plan.target, r.market)}`
      : '플랜 없음';
    return `<a class="scan-row grade-${esc(r.grade)}" href="${chartHref}">
      <span class="scan-fit">${r.fit}</span>
      <span class="scan-main">
        <span class="scan-name">${esc(r.name || r.symbol)}
          <span class="scan-sym">${esc(r.symbol)}</span>
          ${r.isNew ? '<span class="scan-new">NEW</span>' : ''}
          <span class="scan-side ${r.side}">${dir}</span>
        </span>
        <span class="scan-why">${why || '&nbsp;'}</span>
        <span class="scan-plan">${planText}</span>
      </span>
      <span class="scan-right">
        <span>${rowPrice(r.price, r.market)}</span>
        <span class="${cls(r.changePercent)}">${pct(r.changePercent)}</span>
        <span class="scan-grade">${esc(r.grade)} · ${esc(r.text)}</span>
      </span>
    </a>`;
  }

  function renderScanMarket(market) {
    const view = state.scan[market];
    const listEl = $(market === 'US' ? '#scanUs' : '#scanKr');
    const metaEl = $(market === 'US' ? '#scanUsMeta' : '#scanKrMeta');
    if (!view) return;

    if (view.error) {
      metaEl.textContent = '오류';
      listEl.innerHTML = `<div class="muted scan-empty">스캔 실패: ${esc(view.error)}</div>`;
      return;
    }
    const parts = [];
    if (view.asOf) parts.push(new Date(view.asOf).toLocaleTimeString('ko-KR', { hour12: false }));
    if (view.scanned) parts.push(view.scanned + '종목');
    if (view.source) parts.push(view.source === 'mock' ? '데모' : view.source);
    if (view.phase && view.phase !== 'regular') parts.push(phaseText(view.phase));
    metaEl.textContent = parts.join(' · ');

    const rows = (view.top || []).filter((r) => r.fit >= 40);
    listEl.innerHTML = rows.length
      ? rows.map(scanRow).join('')
      : '<div class="muted scan-empty">지금은 단타에 쓸 만한 종목이 없습니다</div>';
  }

  const PHASE_TEXT = {
    preopen: '장전 동시호가', regular: '정규장', closeauction: '장마감 동시호가',
    after: '시간외', closed: '장 마감',
  };
  const phaseText = (p) => PHASE_TEXT[p] || p;

  function applyScan(snapshot) {
    if (snapshot.US) state.scan.US = snapshot.US;
    if (snapshot.KR) state.scan.KR = snapshot.KR;
    renderScanMarket('US');
    renderScanMarket('KR');
    const running = (state.scan.US && state.scan.US.running) || (state.scan.KR && state.scan.KR.running);
    $('#scanDot').classList.toggle('on', !!running);
    $('#scanNote').textContent = running ? '실시간 스캔 중' : '정지됨';
  }

  function startScan() {
    if (state.scanES) return;
    $('#scanNote').textContent = '연결 중…';
    const es = new EventSource('/api/ai/scan/stream');
    state.scanES = es;
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'snapshot') applyScan(msg.data);
      else if (msg.type === 'scan') applyScan({ [msg.market]: msg.data });
    };
    es.onerror = () => {
      $('#scanNote').textContent = '연결 끊김 · 다시 연결 중';
    };
  }

  function stopScan() {
    if (state.scanES) { state.scanES.close(); state.scanES = null; }
    $('#scanDot').classList.remove('on');
    $('#scanNote').textContent = '정지됨';
  }

  function bindScanner() {
    const box = $('#scanOn');
    box.checked = !!state.scanOn;
    box.addEventListener('change', () => {
      state.scanOn = box.checked;
      LS.set('scanOn', state.scanOn);
      if (state.scanOn) startScan(); else stopScan();
    });
    // 켜져 있지 않아도 마지막으로 모아 둔 결과는 한 번 보여 준다
    api('/api/ai/scan').then(applyScan).catch(() => {});
    if (state.scanOn) startScan();
    window.addEventListener('beforeunload', stopScan);
  }

  function fillSelect(sel, options, selected) {
    const el = $(sel);
    el.innerHTML = options.map((o) => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
