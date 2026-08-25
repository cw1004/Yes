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
    result: null,
    startedAt: 0,
    timer: null,
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
      if (force) q.set('force', '1');
      const result = await api('/api/ai/recommend?' + q.toString());
      state.result = result;
      render();
      if (result.engine === 'rules') {
        toast('ANTHROPIC_API_KEY 가 없어 지표 기반 결과만 표시합니다.', 'warn');
      }
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
      ? `<b class="up">AI 분석</b> <span class="muted">(${esc(r.model || '')})</span>`
      : '<b class="warn-text">지표 전용</b> <span class="muted">(AI 키 없음)</span>';
    const src = r.dataSource === 'mock' ? '<b class="warn-text">데모 데이터</b>' : `<b>${esc(r.dataSource)}</b>`;
    bar.innerHTML = `
      <div class="stat"><span>엔진</span>${engine}</div>
      <div class="stat"><span>시세</span>${src}</div>
      <div class="stat"><span>스캔</span><b>${r.scanned}종목</b></div>
      <div class="stat"><span>웹 검색</span><b>${r.webSearches}회</b></div>
      ${r.usage ? `<div class="stat"><span>토큰</span><b>${(r.usage.input_tokens + r.usage.output_tokens).toLocaleString()}</b></div>
        <div class="stat"><span>예상 비용</span><b>$${r.usage.estimatedCostUsd.toFixed(3)}</b></div>` : ''}
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

      <div class="pick-section">
        <h4>출처 ${sources.length ? '' : '<span class="muted">(없음)</span>'}</h4>
        <div class="sources">
          ${sources.map((src) => `<a href="${esc(src.href)}" target="_blank" rel="noopener noreferrer">
            ${esc(src.title || src.href)} <span class="pub">· ${esc(src.publisher || hostOf(src.href))}</span></a>`).join('')}
        </div>
      </div>
    </article>`;
  }

  function listSection(kind, title, items) {
    if (!items || !items.length) return '';
    return `<div class="pick-section ${kind}">
      <h4>${title}</h4>
      <ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>`;
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
      const badge = $('#modeBadge');
      badge.textContent = h.configured ? 'AI 연결됨' : 'AI 키 없음 · 지표 전용';
      badge.className = 'badge ' + (h.configured ? 'live' : 'demo');

      fillSelect('#horizonSelect', h.horizons, state.horizon || h.horizons[1]);
      fillSelect('#riskSelect', h.risks, state.risk || h.risks[1]);
      state.horizon = $('#horizonSelect').value;
      state.risk = $('#riskSelect').value;

      $('#horizonSelect').addEventListener('change', (e) => { state.horizon = e.target.value; LS.set('horizon', state.horizon); });
      $('#riskSelect').addEventListener('change', (e) => { state.risk = e.target.value; LS.set('risk', state.risk); });

      if (!h.configured) {
        toast('ANTHROPIC_API_KEY 를 설정하면 실제 뉴스 분석이 켜집니다. 지금은 지표 기반 결과만 나옵니다.', 'warn');
      }
    } catch (err) {
      toast('서버 상태 확인 실패: ' + err.message, 'err');
    }

    $('#picks').innerHTML = '<div class="empty-state">아직 분석 결과가 없습니다. 상단의 <b>AI 분석 실행</b>을 눌러 주세요.</div>';
  }

  function fillSelect(sel, options, selected) {
    const el = $(sel);
    el.innerHTML = options.map((o) => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
