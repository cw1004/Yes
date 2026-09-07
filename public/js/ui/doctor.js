/**
 * 닥터 세라 — 가상 상담 캐릭터 UI.
 * 아바타는 순수 SVG 로 직접 그린 오리지널 캐릭터다(실존 인물·타 브랜드 캐릭터 무관).
 */
import { esc } from './render.js';
import { INTAKE } from '../engine/intake.js';

/**
 * @param {'idle'|'talking'|'concerned'|'happy'} mood
 */
export function doctorAvatar(size = 96, mood = 'idle') {
  const brow = mood === 'concerned' ? 'M30,40 Q36,36 42,39 M58,39 Q64,36 70,40' : 'M30,39 Q36,35 42,38 M58,38 Q64,35 70,39';
  const mouth = mood === 'happy'
    ? 'M42,64 Q50,72 58,64'
    : mood === 'talking' ? 'M44,64 Q50,70 56,64' : 'M43,65 Q50,68 57,65';
  return `
  <svg class="avatar mood-${mood}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="닥터 세라">
    <defs>
      <linearGradient id="dg-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2b2338"/><stop offset="100%" stop-color="#1a1524"/></linearGradient>
      <linearGradient id="dg-coat" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f6f2fa"/><stop offset="100%" stop-color="#d9d2e4"/></linearGradient>
      <linearGradient id="dg-acc" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff8a9b"/><stop offset="100%" stop-color="#e8c07d"/></linearGradient>
    </defs>
    <circle cx="50" cy="50" r="49" fill="url(#dg-bg)"/>
    <path d="M18,100 Q22,76 38,72 L62,72 Q78,76 82,100 Z" fill="url(#dg-coat)"/>
    <path d="M44,70 L50,84 L56,70 L52,68 L48,68 Z" fill="#efe9f5"/>
    <path d="M50,84 L50,92" stroke="url(#dg-acc)" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="50" cy="92" r="3.4" fill="url(#dg-acc)"/>
    <path d="M26,44 Q26,16 50,16 Q74,16 74,44 L74,52 Q74,58 70,58 L30,58 Q26,58 26,52 Z" fill="#241c33"/>
    <ellipse cx="50" cy="48" rx="21" ry="24" fill="#f0cdb4"/>
    <path d="M29,40 Q30,18 50,18 Q70,18 71,40 Q64,30 50,30 Q36,30 29,40 Z" fill="#2e2440"/>
    <path d="${brow}" stroke="#3c3048" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="38" cy="49" rx="3.6" ry="4.2" fill="#33283f"/>
    <ellipse cx="62" cy="49" rx="3.6" ry="4.2" fill="#33283f"/>
    <circle cx="39.3" cy="47.6" r="1.3" fill="#fff" opacity=".9"/>
    <circle cx="63.3" cy="47.6" r="1.3" fill="#fff" opacity=".9"/>
    <path d="${mouth}" stroke="#b76b6b" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="31" cy="57" r="3.4" fill="#ff9aa6" opacity=".33"/>
    <circle cx="69" cy="57" r="3.4" fill="#ff9aa6" opacity=".33"/>
  </svg>`;
}

/** ───── 문진 화면 ───── */
export function renderIntake(answers = {}) {
  const answered = INTAKE.filter((q) => answers[q.key]).length;
  return `
  <div class="card doctor-card">
    <div class="doctor-head">
      ${doctorAvatar(64, 'idle')}
      <div>
        <b>닥터 세라</b><span class="pill" style="margin-left:6px">AI 상담</span>
        <p class="hint" style="margin:4px 0 0">촬영 전에 여섯 가지만 여쭤볼게요. 측정값만으로는 원인을 말씀드릴 수 없어서요.</p>
      </div>
    </div>
    <div class="progress" style="margin-top:14px"><div class="bar" style="width:${(answered / INTAKE.length) * 100}%"></div></div>
  </div>

  ${INTAKE.map((q, i) => `
    <div class="card question ${answers[q.key] ? 'done' : ''}">
      <div class="q-head"><span class="q-no">Q${i + 1}</span>
        <div><b>${esc(q.question)}</b><p class="hint" style="margin:3px 0 0">${esc(q.why)}</p></div></div>
      <div class="opts">
        ${q.options.map((o) => `
          <button class="opt ${answers[q.key] === o.value ? 'on' : ''}"
            data-intake="${esc(q.key)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
      </div>
    </div>`).join('')}

  <button class="cta" data-action="intake-done">${answered === INTAKE.length ? '촬영하러 가기' : `건너뛰고 촬영 (${answered}/${INTAKE.length})`}</button>
  <p class="fineprint center">답변은 상담 정확도에만 쓰이며 언제든 건너뛸 수 있습니다.</p>`;
}

/** ───── 상담 화면 ───── */
export function renderConsult(consult, { locked, narrated }) {
  const script = locked ? consult.free.script : consult.script;
  return `
  <div class="card doctor-card">
    <div class="doctor-head">
      ${doctorAvatar(72, 'idle')}
      <div>
        <b>${esc(consult.doctor.name)}</b>
        <span class="pill" style="margin-left:6px">${esc(consult.doctor.title)}</span>
        <p class="hint" style="margin:4px 0 0">${esc(consult.doctor.intro)}</p>
      </div>
    </div>
    <p class="fineprint" style="margin-top:12px">⚠️ ${esc(consult.doctor.disclaimerShort)}${narrated ? ' · 응답 문장은 Claude 가 다듬었습니다' : ''}</p>
  </div>

  <div class="chat" id="chat-stream"></div>

  ${locked ? `
  <div class="card lock-cta">
    <b>🔒 상담이 ${consult.free.lockedTurns}개 남았습니다</b>
    <p class="hint">${esc(consult.free.teaser)}</p>
    <button class="cta" data-action="paywall">정밀 상담 이어서 듣기</button>
  </div>` : `
  <div class="card">
    <div class="row">
      <div><b style="font-size:14px">재진 예약</b>
        <p class="hint" style="margin:4px 0 0">${new Date(consult.followUpAt).toLocaleDateString('ko-KR')} · 오늘 사진이 기준선으로 저장됐습니다</p></div>
    </div>
    <button class="cta secondary" style="margin-top:12px" data-action="shop">닥터가 말한 성분으로 제품 보기 →</button>
  </div>`}
`;
}

/**
 * 대사를 한 줄씩 타이핑하듯 흘려보낸다.
 * 전부 한 번에 뿌리면 '결과 화면'이 되고, 한 줄씩 나오면 '상담'이 된다.
 * @returns {() => void} 중단 함수
 */
export function playConsult(container, script, { speed = 1 } = {}) {
  container.innerHTML = '';
  container.dataset.playing = '1'; // 재생 상태를 DOM 에 드러낸다 (외부에서 완료를 알 수 있게)
  let i = 0;
  let stopped = false;

  const typing = document.createElement('div');
  typing.className = 'bubble typing';
  typing.innerHTML = '<i></i><i></i><i></i>';

  const next = () => {
    if (stopped) return;
    if (i >= script.length) { typing.remove(); container.dataset.playing = '0'; return; }
    const t = script[i++];
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    // 무료 구간의 핵심(불일치 지적)은 네 번째 말풍선이다. 한 줄에 1초씩 쓰면
    // 후크가 5초 뒤에 나오고, 그 전에 이탈한다. 상담 느낌은 유지하되 더 빠르게.
    const pause = Math.min(700, 170 + t.text.length * 7) / speed;
    setTimeout(() => {
      if (stopped) return;
      typing.remove();
      const b = document.createElement('div');
      b.className = `bubble stage-${t.stage}${t.highlight ? ' highlight' : ''}${t.warn ? ' warn' : ''}`;
      b.innerHTML = `${t.highlight ? '<span class="bubble-tag">짚고 갈 점</span>' : ''}${
        t.warn ? '<span class="bubble-tag warn">주의</span>' : ''}<p>${esc(t.text)}</p>${
        t.score !== undefined ? `<span class="bubble-score">${t.score}점</span>` : ''}`;
      container.appendChild(b);
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => b.classList.add('in'));
      setTimeout(next, 150 / speed);
    }, pause);
  };
  next();
  return () => { stopped = true; typing.remove(); container.dataset.playing = '0'; };
}
