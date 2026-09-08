/** 화면 렌더링 (문자열 템플릿 기반). 데이터는 서버 응답 그대로를 신뢰원으로 쓴다. */

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ring(score) {
  const r = 74, c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return `<div class="ring">
    <svg width="172" height="172" viewBox="0 0 172 172">
      <circle cx="86" cy="86" r="${r}" fill="none" stroke="#241d31" stroke-width="12"/>
      <circle cx="86" cy="86" r="${r}" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff8a9b"/><stop offset="100%" stop-color="#e8c07d"/>
      </linearGradient></defs>
    </svg>
    <div class="val"><b>${score}</b><span>SKIN SCORE</span></div>
  </div>`;
}

function metricBar(m) {
  return `<div class="metric">
    <div class="row"><span>${esc(m.label)}</span><span class="lv">${esc(m.levelLabel)} · ${m.score}</span></div>
    <div class="track"><i class="s-${m.level}" style="width:${m.score}%"></i></div>
  </div>`;
}

/** ───── 결과 화면 ───── */
export function renderResult(report) {
  const a = report.analysis;
  const t = a.tone;
  const pc = report.personalColor;
  const q = report.quality;

  const qualityBadge = q
    ? `<span class="pill ${q.confidence >= 75 ? 'live' : ''}">촬영 신뢰도 ${q.confidence}%</span>`
    : '';
  const simBadge = report.simulated
    ? '<span class="sim-badge">🧪 체험용 샘플 데이터입니다</span>'
    : '';

  const free = report.free;
  const preview = free.preview.map((p) => `
    <div class="metric">
      <div class="row"><span>${esc(p.label)}</span><span class="lv">${esc(p.levelLabel)} · ${p.score}</span></div>
      <div class="track"><i class="s-${p.score >= 70 ? 'good' : p.score >= 55 ? 'fair' : p.score >= 40 ? 'weak' : 'poor'}" style="width:${p.score}%"></i></div>
      <p class="hint" style="margin-top:7px">${esc(p.tip)}</p>
    </div>`).join('');

  return `
  <div class="card score-hero">
    ${ring(a.totalScore)}
    <div class="grade">GRADE ${esc(a.grade)} · ${esc(report.skinType.label)} 피부</div>
    <p class="hint" style="margin-top:10px">${esc(report.skinType.desc)}</p>
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${simBadge}${qualityBadge}</div>
  </div>

  <div class="card">
    <h3>🎨 피부톤 좌표</h3>
    <div class="tone-strip">
      <div class="swatch" style="background:${esc(t.hex)}"></div>
      <div class="tone-meta">
        <b>${esc(t.categoryLabel)}</b> · Fitzpatrick ${esc(t.fitzpatrick)} · <b>${esc(t.undertoneLabel)}</b><br>
        ITA ${t.ita}° · L*${t.L} a*${t.a} b*${t.b}<br>
        퍼스널컬러 <b>${esc(pc.label)}</b>
      </div>
    </div>
    <div class="palette">${pc.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div>
    <p class="hint">${esc(pc.desc)}</p>
  </div>

  <div class="card">
    <h3>⚠️ 지금 가장 급한 3가지 <span class="pill">무료</span></h3>
    ${preview}
  </div>

  ${report.locked ? renderLocked(report) : renderPro(report)}

  <div class="card">
    <div class="row">
      <div><b style="font-size:14px">내 톤에 맞는 제품 보기</b>
      <p class="hint" style="margin:4px 0 0">ITA ${t.ita}° · ${esc(t.undertoneLabel)} 기준 셰이드 매칭 + 판매처 최저가 비교</p></div>
    </div>
    <button class="cta secondary" style="margin-top:14px" data-action="shop">맞춤 추천 보기 →</button>
  </div>

  <p class="fineprint">${esc(report.disclaimer)}</p>`;
}

function renderLocked(report) {
  const p = report.lockedPreview;
  return `
  <div class="card locked">
    <div class="blur">
      <h3>🔬 전문 진단 리포트</h3>
      ${p.teaser.map((t) => `<div class="metric"><div class="row"><span>${esc(t.label)}</span><span class="lv">${esc(t.levelLabel)}</span></div>
        <div class="track"><i class="s-fair" style="width:62%"></i></div></div>`).join('')}
      <p style="color:var(--muted);font-size:13px;line-height:1.8;margin-top:14px">
        원인 분석 · 아침/저녁 루틴 · 4주 개선 플랜 · 추천 성분 리스트가 여기에 표시됩니다.</p>
    </div>
    <div class="lock-overlay">
      <b>🔒 전문 진단 ${p.concernCount - 3}개 지표가 잠겨 있습니다</b>
      <p>${p.unlocks.map(esc).join(' · ')}</p>
      <button class="cta" data-action="paywall">전체 리포트 해제하기</button>
    </div>
  </div>`;
}

function renderPro(report) {
  const pro = report.pro;
  const metrics = report.analysis.metrics;
  return `
  <div class="card">
    <h3>📊 전체 지표 <span class="pill gold">PRO</span></h3>
    ${metrics.map(metricBar).join('')}
    <p class="hint">T존 광택 ${report.analysis.zoneBalance.tZoneShine}% · U존 ${report.analysis.zoneBalance.uZoneShine}% (차이 ${report.analysis.zoneBalance.delta}%p)</p>
  </div>

  <div class="card">
    <h3>🔬 원인 분석 & 처방</h3>
    ${pro.concerns.slice(0, 6).map((c) => `
      <details class="acc" ${c.rank === 1 ? 'open' : ''}>
        <summary><span>${c.rank}. ${esc(c.label)}</span><span class="pill">${esc(c.levelLabel)} · ${c.score}</span></summary>
        <div class="body">
          <p><b>원인</b><br>${esc(c.cause)}</p>
          <p><b>처방</b><br>${esc(c.action)}</p>
          <div class="tags">
            ${c.ingredients.recommend.map((i) => `<span class="tag rec">+ ${esc(i)}</span>`).join('')}
            ${c.ingredients.avoid.map((i) => `<span class="tag avoid">− ${esc(i)}</span>`).join('')}
          </div>
        </div>
      </details>`).join('')}
  </div>

  <div class="card">
    <h3>🌅 아침 루틴</h3>
    ${pro.routine.am.map((s) => `<div class="step"><div class="n">${s.step}</div><div><b>${esc(s.name)}</b><span>${esc(s.note)}</span></div></div>`).join('')}
  </div>
  <div class="card">
    <h3>🌙 저녁 루틴</h3>
    ${pro.routine.pm.map((s) => `<div class="step"><div class="n">${s.step}</div><div><b>${esc(s.name)}</b><span>${esc(s.note)}</span></div></div>`).join('')}
    <p class="hint">${esc(pro.routine.caution)}</p>
  </div>

  <div class="card">
    <h3>📅 4주 개선 플랜</h3>
    ${pro.plan.map((w) => `<div class="week"><b>WEEK ${w.week} · ${esc(w.title)}</b>
      <ul>${w.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}
  </div>

  <div class="card">
    <h3>🧪 성분 가이드</h3>
    <div class="tags">${pro.ingredients.recommend.map((i) => `<span class="tag rec">+ ${esc(i)}</span>`).join('')}</div>
    <div class="tags">${pro.ingredients.avoid.map((i) => `<span class="tag avoid">− ${esc(i)}</span>`).join('')}</div>
  </div>

  <div class="card">
    <h3>🌿 생활 습관</h3>
    <ul style="margin:0;padding-left:17px;color:var(--muted);font-size:13px;line-height:1.9">
      ${pro.lifestyle.map((l) => `<li>${esc(l)}</li>`).join('')}
    </ul>
  </div>`;
}

/** ───── 페이월 ───── */
export function renderPaywall(config, selected, analysisId, coupon) {
  return `
  <div class="card" style="text-align:center">
    <h3 style="justify-content:center">🔓 전문 진단 해제</h3>
    <p class="hint" style="margin-top:0">측정은 무료입니다. 원인 분석과 4주 처방은 전문 리포트에서 제공됩니다.</p>
  </div>
  ${config.plans.map((p) => `
    <div class="plan ${p.id === selected ? 'sel' : ''}" data-plan="${p.id}">
      ${p.badge ? `<span class="pill gold badge">${esc(p.badge)}</span>` : ''}
      <div class="row">
        <div><b style="font-size:15px">${esc(p.name)}</b>
          <div class="price">${won(p.price)}<span class="per">${p.period === 'once' ? ' / 1회' : p.period === 'month' ? ' / 월' : ' / 년'}</span></div>
        </div>
        <span class="pill">${p.id === selected ? '선택됨' : '선택'}</span>
      </div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    </div>`).join('')}

  <div class="coupon">
    <input id="coupon-input" placeholder="쿠폰 코드 (예: WELCOME30)" value="${esc(coupon || '')}" />
    <button class="ghost small" data-action="apply-coupon">적용</button>
  </div>
  <div id="coupon-msg" class="fineprint" style="margin-top:-6px"></div>

  <button class="cta" data-action="pay">결제하고 리포트 열기</button>
  <p class="fineprint center">결제 수단: ${esc(config.provider)} ${config.provider === 'mock' ? '(데모 모드 — 실제 청구되지 않습니다)' : ''}<br>
  1회 이용권은 7일간 해당 리포트를 열람할 수 있고, 멤버십은 언제든 해지할 수 있습니다.</p>`;
}

/** ───── 추천/커머스 ───── */
export function renderShop(data, category) {
  const cats = [['', '전체'], ['serum', '세럼'], ['toner', '토너'], ['cream', '크림'], ['suncare', '선케어'],
    ['cushion', '쿠션'], ['foundation', '파운데이션'], ['cleanser', '클렌저'], ['exfoliant', '각질'], ['eyecare', '아이케어'], ['lip', '립']];

  const p = data.profile;
  return `
  <div class="card">
    <div class="tone-strip">
      <div class="swatch" style="background:${esc(p.tone.hex)}"></div>
      <div class="tone-meta">
        <b>${esc(p.skinType)}</b> · ${esc(p.tone.undertoneLabel)} · ITA ${p.tone.ita}°<br>
        퍼스널컬러 <b>${esc(p.personalColor.label)}</b><br>
        <span style="color:var(--dim);font-size:12px">이 좌표에 맞춰 ${data.items.length}개 제품을 랭킹했습니다</span>
      </div>
    </div>
  </div>

  <div class="chips">
    ${cats.map(([v, l]) => `<button class="chip ${v === (category || '') ? 'on' : ''}" data-cat="${v}">${l}</button>`).join('')}
  </div>

  ${data.bundle?.items?.length ? `
  <div class="card bundle">
    <h3>🎁 ${esc(data.bundle.title)}</h3>
    <p class="hint" style="margin-top:0">${data.bundle.items.map((i) => esc(i.name)).join(' + ')}</p>
    <div class="row" style="margin-top:12px">
      <div class="total"><s>${won(data.bundle.total)}</s>${won(data.bundle.discounted)}</div>
      <span class="pill gold">${won(data.bundle.saving)} 절약</span>
    </div>
    <button class="cta" style="margin-top:14px" data-action="bundle">풀세트 한 번에 담기</button>
    <p class="hint">${esc(data.bundle.note)}</p>
  </div>` : ''}

  ${renderSections(data.items, category)}

  <p class="disclosure">${esc(data.disclosure)}</p>`;
}

const MAKEUP = ['cushion', 'foundation', 'lip'];

/**
 * 스킨케어와 베이스 메이크업은 구매 결정 기준이 다르다.
 * (전자는 고민 해결, 후자는 톤 매칭) 섞어서 한 줄로 세우면 둘 다 설득력이 떨어진다.
 */
function renderSections(items, category) {
  if (category) return items.map((it, i) => renderProduct(it, i)).join('');
  const care = items.filter((i) => !MAKEUP.includes(i.category));
  const makeup = items.filter((i) => MAKEUP.includes(i.category));
  const block = (title, sub, list) => (list.length ? `
    <h3 style="margin:20px 2px 12px;font-size:15px">${title}
      <span class="pill" style="margin-left:6px">${sub}</span></h3>
    ${list.map((it, i) => renderProduct(it, i)).join('')}` : '');
  return block('🧴 피부 고민 처방 매칭', '진단 결과 기반', care) +
         block('💄 베이스 메이크업 톤 매칭', 'ITA° 셰이드 기반', makeup);
}

function renderProduct(it, idx) {
  return `
  <div class="product" data-product="${esc(it.id)}">
    <div class="head">
      <div>
        <div class="rank">#${idx + 1} · 적합도 ${it.scores.relevance}%</div>
        <div class="brand-name">${esc(it.brand)}</div>
        <div class="title">${esc(it.name)}</div>
        <div class="brand-name">★ ${it.rating} · 리뷰 ${Number(it.reviews).toLocaleString('ko-KR')}</div>
      </div>
      <span class="pill">${esc(categoryLabel(it.category))}</span>
    </div>
    ${!it.shade ? ''
      : it.shade.matched
        ? `<div class="shade-chip"><i style="background:${esc(it.shade.hex)}"></i> 추천 호수 ${esc(it.shade.code)} ${esc(it.shade.name)} · 매칭 ${it.shade.fit}%</div>`
        : `<div class="shade-chip no-match">⚠ 내 톤에 맞는 호수가 없습니다 (가장 가까운 호수 ${esc(it.shade.code)}, 매칭 ${it.shade.fit}%)</div>`}
    <ul class="reasons">${it.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${it.keyIngredients?.length ? `<div class="tags">${it.keyIngredients.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
    <div class="offers">
      ${it.offers.map((o, i) => `
        <div class="offer ${i === 0 ? 'best' : ''} ${o.stock ? '' : 'out'}">
          <div>
            <div class="m">${esc(o.merchantLogo)} ${esc(o.merchantName)} ${o.isLowest ? '<span class="pill gold">최저가</span>' : ''}</div>
            <div class="meta">${o.shippingDays === 1 ? '내일 도착' : `${o.shippingDays}일 배송`}${o.coupon ? ` · 쿠폰 ${won(o.coupon)}` : ''}${o.stock ? '' : ' · 품절'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="p">${o.coupon ? `<s>${won(o.price)}</s>` : ''}${won(o.netPrice)}</div>
            ${o.stock ? `<button class="buy" data-buy="${esc(it.id)}" data-merchant="${esc(o.merchant)}" data-pos="${idx + 1}">구매</button>` : ''}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

function categoryLabel(c) {
  return { serum: '세럼', toner: '토너', cream: '크림', suncare: '선케어', cushion: '쿠션',
    foundation: '파운데이션', cleanser: '클렌저', exfoliant: '각질', eyecare: '아이케어', mask: '마스크', lip: '립' }[c] || c;
}

/** ───── 기록 ───── */
export function renderHistory(items) {
  if (!items.length) {
    return `<div class="empty">아직 기록이 없습니다.<br>첫 진단을 하면 여기에 변화 그래프가 쌓입니다.</div>`;
  }
  const asc = [...items].reverse();
  const w = 480, h = 140, pad = 14;
  const xs = asc.map((_, i) => pad + (i * (w - pad * 2)) / Math.max(1, asc.length - 1));
  const ys = asc.map((it) => h - pad - ((it.totalScore / 100) * (h - pad * 2)));
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');

  return `
  <div class="card">
    <h3>📈 스킨 스코어 변화</h3>
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4" fill="#ff8a9b"/>`).join('')}
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#ff8a9b"/><stop offset="100%" stop-color="#e8c07d"/></linearGradient></defs>
    </svg>
    <p class="hint">같은 조명·같은 시간대에 측정해야 비교가 의미 있습니다.</p>
  </div>
  <div class="card">
    <h3>기록</h3>
    ${items.map((it, i) => {
      const prev = items[i + 1];
      const delta = prev ? it.totalScore - prev.totalScore : null;
      return `<div class="hist-row">
        <div><b>${it.totalScore}</b> <span class="pill">${esc(it.grade)}</span>${it.simulated ? ' <span class="pill gold">체험</span>' : ''}
          <div style="color:var(--dim);font-size:11.5px;margin-top:3px">${new Date(it.createdAt).toLocaleString('ko-KR')}</div></div>
        <div style="text-align:right">
          ${delta === null ? '<span class="pill">첫 측정</span>' : `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>`}
          <div><button class="ghost tiny" data-open="${esc(it.id)}">리포트</button></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}
