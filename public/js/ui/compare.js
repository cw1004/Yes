/**
 * 전/후 비교 화면.
 *
 * 점수 숫자만으로는 "정말 좋아졌나?"가 체감되지 않는다.
 * 같은 각도의 사진 두 장을 슬라이더로 겹쳐 보여주고, 그 위에
 * 닥터가 짚었던 부위를 그대로 표시해 무엇이 달라졌는지 눈으로 확인시킨다.
 */
import { esc } from './render.js';
import { faceZones } from '../engine/skinmask.js';

const fmtDate = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5));

const ZONE_OF_METRIC = {
  oiliness: 'nose', texture: 'leftCheek', pigmentation: 'rightCheek',
  darkCircle: 'underEyeLeft', wrinkle: 'eyeCornerLeft', redness: 'leftCheek',
  hydration: 'chin', evenness: 'forehead', clarity: 'forehead',
};

/** 사진 위에 얹을 부위 마커 (박스 좌표계 → 퍼센트) */
function markers(photo, metrics) {
  if (!photo?.box) return '';
  const zones = faceZones(photo.box);
  const picked = metrics.filter((m) => m.score < 70 && ZONE_OF_METRIC[m.key]).slice(0, 3);
  const placed = [];
  return picked
    .map((m) => {
      const z = zones[ZONE_OF_METRIC[m.key]];
      const cx = ((z.x + z.width / 2) / photo.width) * 100;
      let cy = ((z.y + z.height / 2) / photo.height) * 100;
      // 같은 높이에 라벨이 겹치면 아래로 밀어 읽을 수 있게 한다
      while (placed.some((p) => Math.abs(p - cy) < 7)) cy += 7;
      placed.push(cy);
      // 얼굴 오른쪽 절반이면 라벨을 왼쪽으로 빼서 화면 밖으로 나가지 않게 한다
      const side = cx > 52 ? 'left' : 'right';
      return `<div class="marker ${m.score < 45 ? 'bad' : 'warn'} to-${side}" style="left:${cx}%;top:${cy}%">
        <i></i><span>${esc(m.label)} ${m.score}</span></div>`;
    })
    .join('');
}

/**
 * @param {{before:object,after:object}} photos IndexedDB 레코드
 * @param {{before:object,after:object}} records 서버 history 항목 (점수)
 */
export function renderCompare({ photos, records, showMarkers = true }) {
  if (!records?.before || !records?.after) {
    return `<div class="empty">비교하려면 최소 2회 측정이 필요합니다.<br>
      4주 간격으로 같은 조명에서 다시 촬영해 주세요.</div>`;
  }
  const { before, after } = records;
  const gap = daysBetween(before.createdAt, after.createdAt);
  const delta = after.totalScore - before.totalScore;

  const beforeMap = Object.fromEntries(before.metrics.map((m) => [m.key, m]));
  const rows = after.metrics
    .map((m) => ({ ...m, prev: beforeMap[m.key]?.score ?? null }))
    .map((m) => ({ ...m, diff: m.prev === null ? null : m.score - m.prev }))
    .sort((a, b) => (b.diff ?? -99) - (a.diff ?? -99));

  const improved = rows.filter((r) => (r.diff ?? 0) > 0);
  const worsened = rows.filter((r) => (r.diff ?? 0) < 0).sort((a, b) => a.diff - b.diff);

  const missingPhotos = !photos?.before?.dataUrl || !photos?.after?.dataUrl;

  return `
  <div class="card">
    <div class="row">
      <div><b style="font-size:15px">${fmtDate(before.createdAt)} → ${fmtDate(after.createdAt)}</b>
        <p class="hint" style="margin:4px 0 0">${gap}일 경과 · 같은 조명 조건에서 비교해야 정확합니다</p></div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:800" class="${delta >= 0 ? 'delta up' : 'delta down'}">
          ${delta >= 0 ? '+' : ''}${delta}</div>
        <div class="hint" style="margin:0">${before.totalScore} → ${after.totalScore}점</div>
      </div>
    </div>
  </div>

  ${missingPhotos ? `
  <div class="card"><h3>📷 사진 비교</h3>
    <p class="hint" style="margin-top:0">이 기기에 저장된 사진이 없어 사진 비교를 표시할 수 없습니다.
    사진은 서버에 올라가지 않고 기기 안에만 보관되기 때문에, 다른 기기나 시크릿 모드에서는 보이지 않습니다.</p>
  </div>` : `
  <div class="card">
    <h3>📷 전 / 후 <span class="pill">밀어서 비교</span></h3>
    <div class="compare" id="compare-widget">
      <img class="after" src="${esc(photos.after.dataUrl)}" alt="최근 촬영" />
      <img class="before" id="compare-clip" src="${esc(photos.before.dataUrl)}" alt="기준 촬영" />
      ${showMarkers ? `<div class="markers">${markers(photos.after, after.metrics)}</div>` : ''}
      <div class="handle" id="compare-handle"><i></i></div>
      <span class="tag-b">BEFORE ${before.totalScore}</span>
      <span class="tag-a">AFTER ${after.totalScore}</span>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="hint" style="margin:0">붉은 표시는 최근 측정에서 관리가 필요한 부위입니다</span>
      <button class="ghost tiny" data-action="toggle-markers">${showMarkers ? '표시 끄기' : '표시 켜기'}</button>
    </div>
  </div>`}

  <div class="card">
    <h3>📊 항목별 변화</h3>
    ${rows.map((r) => `
      <div class="metric">
        <div class="row">
          <span>${esc(r.label)}</span>
          <span class="lv">${r.prev ?? '—'} → <b style="color:var(--text)">${r.score}</b>
            ${r.diff === null ? ''
              : r.diff === 0 ? '<span class="delta same">유지</span>'
              : `<span class="delta ${r.diff > 0 ? 'up' : 'down'}">${r.diff > 0 ? '▲' : '▼'} ${Math.abs(r.diff)}</span>`}</span>
        </div>
        <div class="track dual">
          ${r.prev === null ? '' : `<i class="prev" style="width:${r.prev}%"></i>`}
          <i class="s-${r.level}" style="width:${r.score}%"></i>
        </div>
      </div>`).join('')}
  </div>

  <div class="card">
    <h3>🩺 닥터 세라의 재진 소견</h3>
    <div class="doctor-note">
      ${followUpNote(delta, improved, worsened, gap)}
    </div>
  </div>`;
}

/** 재진 소견 — 좋아진 것과 나빠진 것을 둘 다 말한다 */
function followUpNote(delta, improved, worsened, gap) {
  const lines = [];
  if (gap < 14) {
    lines.push(`아직 ${gap}일밖에 지나지 않았습니다. 피부 turnover 주기가 약 28일이라 지금 차이는 조명·컨디션 영향일 수 있습니다.`);
  }
  if (delta >= 5) {
    lines.push(`종합 ${delta}점 올랐습니다. 특히 ${improved.slice(0, 2).map((i) => `${i.label}(+${i.diff})`).join(', ')}가 반응했어요. 지금 루틴을 바꾸지 마세요.`);
  } else if (delta <= -5) {
    lines.push(`종합 ${Math.abs(delta)}점 떨어졌습니다. ${worsened.slice(0, 2).map((i) => `${i.label}(${i.diff})`).join(', ')} 쪽이 원인입니다. 최근 새로 추가한 제품이 있다면 그것부터 2주 빼보세요.`);
  } else {
    lines.push(`종합 점수는 큰 변화가 없습니다(${delta >= 0 ? '+' : ''}${delta}점). 이 구간에서는 제품을 늘리기보다 사용 빈도를 지키는 게 더 효과적입니다.`);
  }
  if (improved.length && worsened.length) {
    lines.push(`${improved[0].label}은 올랐는데 ${worsened[0].label}은 내려갔습니다. 한쪽에 집중하느라 다른 쪽 관리가 빠지지 않았는지 확인해 보세요.`);
  }
  lines.push('다음 재측정은 4주 뒤, 같은 시간대·같은 조명에서 해주세요.');
  return lines.map((l) => `<p>${esc(l)}</p>`).join('');
}

/** 슬라이더 드래그 바인딩 (렌더 후 호출) */
export function bindCompare(root = document) {
  const widget = root.querySelector('#compare-widget');
  const clip = root.querySelector('#compare-clip');
  const handle = root.querySelector('#compare-handle');
  if (!widget || !clip || !handle) return;

  // 래퍼 폭을 줄이는 대신 clip-path 로 잘라낸다 (사진 비율이 흐트러지지 않는다)
  const set = (ratio) => {
    const r = Math.min(1, Math.max(0, ratio));
    clip.style.clipPath = `inset(0 ${(1 - r) * 100}% 0 0)`;
    handle.style.left = `${r * 100}%`;
  };
  set(0.5);

  const move = (clientX) => {
    const rect = widget.getBoundingClientRect();
    set((clientX - rect.left) / rect.width);
  };
  let dragging = false;
  const start = (e) => { dragging = true; move((e.touches?.[0] ?? e).clientX); };
  const drag = (e) => { if (!dragging) return; e.preventDefault(); move((e.touches?.[0] ?? e).clientX); };
  const end = () => { dragging = false; };

  widget.addEventListener('mousedown', start);
  widget.addEventListener('touchstart', start, { passive: true });
  window.addEventListener('mousemove', drag);
  window.addEventListener('touchmove', drag, { passive: false });
  window.addEventListener('mouseup', end);
  window.addEventListener('touchend', end);
}
