/**
 * SkinLab AI — 화면 전환과 데이터 흐름을 잇는 컨트롤러.
 * 분석은 전부 이 브라우저 안에서 끝나고, 서버에는 숫자 지표만 보낸다.
 */
import { api } from './api.js';
import { Camera, imageDataFromFile } from './ui/camera.js';
import { computeMetrics } from './engine/metrics.js';
import { assessQuality, fallbackFaceBox } from './engine/quality.js';
import { renderResult, renderPaywall, renderShop, renderHistory } from './ui/render.js';
import { renderIntake, renderConsult, playConsult, doctorAvatar } from './ui/doctor.js';
import { renderCompare, bindCompare } from './ui/compare.js';
import { savePhoto, getPhoto, allPhotos } from './storage.js';
import { INTAKE } from './engine/intake.js';
import { PERSONAS, personaById } from './sim/personas.js';
import { faceImageData, drawFace, improved } from './sim/faces.js';

const $ = (s) => document.querySelector(s);
const state = {
  config: null, report: null, analysisId: null, plan: 'monthly', coupon: '', category: '', shop: null,
  intake: loadIntake(), lastFrame: null, lastBox: null, stopTyping: null,
  comparePair: null, showMarkers: true,
};

/** 문진 답변은 기기에 남겨 재측정 때 다시 묻지 않는다 */
function loadIntake() {
  try { return JSON.parse(localStorage.getItem('skinlab.intake') || '{}'); } catch { return {}; }
}
const saveIntake = () => localStorage.setItem('skinlab.intake', JSON.stringify(state.intake));

/* ───────── 공통 UI ───────── */
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/** 안내/오류 문구는 textContent 로 넣는다 (서버 문자열을 HTML 로 해석하지 않게) */
function showEmpty(el, message) {
  el.textContent = '';
  const div = document.createElement('div');
  div.className = 'empty';
  div.textContent = message;
  el.appendChild(div);
}

function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.goto === name));
  window.scrollTo({ top: 0 });
  if (name !== 'capture') camera?.stop();
  if (name !== 'consult') state.stopTyping?.();
  if (name === 'capture') startCapture();
  if (name === 'intake') $('#intake-body').innerHTML = renderIntake(state.intake);
  if (name === 'consult') showConsult();
  if (name === 'shop') loadShop();
  if (name === 'history') loadHistory();
  if (name === 'compare') loadCompare();
}

/* ───────── 카메라 ───────── */
let camera = null;
async function startCapture() {
  if (!camera) {
    camera = new Camera({
      video: $('#video'),
      hintEl: $('#quality-hint'),
      ovalEl: document.querySelector('.guide-oval'),
      onReady: (ok) => { $('#btn-shutter').disabled = false; $('#btn-shutter').dataset.ok = ok ? '1' : '0'; },
    });
  }
  const controls = document.querySelector('.capture-controls');
  try {
    await camera.start();
    controls.classList.remove('no-camera');
  } catch {
    // 카메라를 못 열면 셔터가 아니라 '사진 · 앨범'이 주 동작이 된다
    $('#btn-shutter').disabled = true;
    controls.classList.add('no-camera');
  }
}

/* ───────── 분석 파이프라인 ───────── */
const STEPS = ['피부 영역 검출 중…', '색공간(Lab) 변환 중…', '9개 지표 계산 중…', '진단 규칙 적용 중…', '맞춤 처방 생성 중…'];

async function runAnalysis(imageData, box, opts = {}) {
  if (!opts.silent) go('analyzing');
  const canvas = $('#preview-canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);

  const faceBox = box || fallbackFaceBox(imageData.width, imageData.height);
  const quality = assessQuality(imageData, faceBox);

  let analysis;
  for (let i = 0; i < STEPS.length; i++) {
    if (!opts.silent) {
      $('#analyzing-step').textContent = STEPS[i];
      $('#analyze-bar').style.width = `${((i + 1) / STEPS.length) * 100}%`;
    }
    // 무거운 계산은 3단계에서 한 번만 — 그 전에 프레임을 한 번 넘겨 UI가 멈추지 않게 한다
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, opts.silent ? 0 : 220)));
    if (i === 2) analysis = computeMetrics(imageData, faceBox);
  }

  if (quality.issues.length && quality.confidence < 45) {
    toast(quality.issues[0].message, 4200);
  }

  try {
    const report = await api.submitAnalysis(analysis, quality, state.intake, {
      simulated: opts.simulated, backdateDays: opts.backdate,
    });
    // 사진은 서버로 보내지 않고 이 기기에만 남긴다 (전/후 비교용 기준선)
    try {
      await savePhoto({
        analysisId: report.analysisId, imageData, box: faceBox,
        totalScore: analysis.totalScore, tone: analysis.tone,
      });
    } catch (e) {
      console.warn('사진 로컬 저장 실패:', e.message);
      toast('사진을 기기에 저장하지 못해 전/후 비교가 제한될 수 있습니다.', 3200);
    }
    if (opts.silent) return report;      // 기준선만 만들고 화면은 넘기지 않는다
    showReport(report, { toConsult: true });
  } catch (err) {
    toast(err.message);
    go(opts.simulated ? 'home' : 'capture');
  }
}

/* ───────── 닥터 상담 ───────── */
function showConsult() {
  const report = state.report;
  if (!report?.consult) {
    showEmpty($('#consult-body'), '먼저 진단을 받으면 닥터 세라가 결과를 짚어드립니다.');
    return;
  }
  $('#consult-body').innerHTML = renderConsult(report.consult, {
    locked: report.locked, narrated: report.consultNarrated, simulated: report.simulated,
  });
  const script = report.consult.script;
  state.stopTyping = playConsult($('#chat-stream'), script);
}

function revealAllConsult() {
  const report = state.report;
  if (!report?.consult) return;
  state.stopTyping?.();
  const el = $('#chat-stream');
  if (!el) return;
  el.innerHTML = report.consult.script.map((t) => `
    <div class="bubble in stage-${t.stage}${t.highlight ? ' highlight' : ''}${t.warn ? ' warn' : ''}">
      ${t.highlight ? '<span class="bubble-tag">짚고 갈 점</span>' : ''}
      ${t.warn ? '<span class="bubble-tag warn">주의</span>' : ''}
      <p></p>${t.score !== undefined ? `<span class="bubble-score">${t.score}점</span>` : ''}
    </div>`).join('');
  // 텍스트는 innerHTML 이 아니라 textContent 로 넣는다
  el.querySelectorAll('.bubble p').forEach((p, i) => { p.textContent = report.consult.script[i].text; });
  el.dataset.playing = '0';
}

function showReport(report, { toConsult = false } = {}) {
  state.report = report;
  state.analysisId = report.analysisId;
  $('#result-body').innerHTML = renderResult(report);
  go(toConsult ? 'consult' : 'result');
  if (report.locked) api.paywallView(report.analysisId, toConsult ? 'consult_lock' : 'result_lock');
}

/* ───────── 체험(시뮬레이션) ───────── */
function openSimSheet() {
  const list = $('#sim-list');
  list.textContent = '';
  for (const p of PERSONAS) {
    const btn = document.createElement('button');
    btn.className = 'sim-item';
    btn.dataset.persona = p.id;
    const img = document.createElement('img');
    img.className = 'face';
    img.alt = '';
    img.src = drawFace(p.face, { width: 84, height: 104 }).toDataURL('image/jpeg', 0.7);
    const text = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = p.title;
    const sp = document.createElement('span');
    sp.textContent = p.hint;
    text.append(b, sp);
    btn.append(img, text);
    if (p.badge) {
      const pill = document.createElement('span');
      pill.className = 'pill gold';
      pill.textContent = p.badge;
      btn.appendChild(pill);
    }
    list.appendChild(btn);
  }
  $('#sim-sheet').hidden = false;
}

const closeSimSheet = () => { $('#sim-sheet').hidden = true; };

/**
 * 선택한 페르소나로 전체 흐름을 돌린다.
 * 4주 뒤까지 선택하면 '관리 후' 얼굴을 하나 더 만들어 전·후 비교를 바로 볼 수 있게 한다.
 */
async function runSimulation(personaId, withFollowUp) {
  const persona = personaById(personaId);
  closeSimSheet();
  state.intake = { ...persona.intake };
  saveIntake();

  if (withFollowUp) {
    // 4주 전 상태를 먼저 기록해야 비교가 성립한다
    toast('4주 전 기준 측정을 만드는 중…', 2000);
    await analyzeSample(persona.face, { simulated: true, backdate: 28 });
  }
  await analyzeSample(withFollowUp ? improved(persona.face) : persona.face, { simulated: true });
}

/** 샘플 얼굴 하나를 실제 분석 경로로 통과시킨다 (촬영만 건너뛴다) */
async function analyzeSample(faceSpec, { simulated, backdate = 0 } = {}) {
  const img = faceImageData(faceSpec);
  await camera?.stop();
  return runAnalysis(img, null, { simulated, backdate, silent: backdate > 0 });
}

/* ───────── 페이월 ───────── */
function openPaywall() {
  $('#paywall-body').innerHTML = renderPaywall(state.config, state.plan, state.analysisId, state.coupon);
  go('paywall');
  api.paywallView(state.analysisId, 'paywall_screen');
}

async function pay() {
  try {
    const { order, payment } = await api.checkout(state.plan, state.analysisId, state.coupon || undefined);
    if (order.discount?.invalid) toast('쿠폰 코드를 확인해 주세요. 할인 없이 진행합니다.');

    if (payment.type === 'redirect') { window.location.href = payment.url; return; }
    if (payment.type === 'sdk') { await payWithToss(payment, order); return; }

    // mock 모드: 즉시 승인
    const res = await api.confirm(order.orderId, `mock_${order.orderId}`, order.amount);
    finishPurchase(res);
  } catch (err) {
    toast(err.message);
  }
}

async function payWithToss(payment, order) {
  if (!window.TossPayments) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v1/payment';
      s.onload = resolve; s.onerror = () => reject(new Error('결제 모듈을 불러오지 못했습니다.'));
      document.head.appendChild(s);
    });
  }
  const toss = window.TossPayments(payment.clientKey);
  await toss.requestPayment('카드', {
    amount: payment.amount,
    orderId: payment.orderId,
    orderName: payment.orderName,
    successUrl: `${location.origin}/?paid=${order.orderId}`,
    failUrl: `${location.origin}/?canceled=${order.orderId}`,
  });
}

function finishPurchase(res) {
  toast('결제가 완료되었습니다. 상담이 이어집니다 🎉');
  if (res.report) showReport(res.report, { toConsult: true });
  else if (state.analysisId) api.report(state.analysisId).then((r) => showReport(r, { toConsult: true }));
}

/* ───────── 전/후 비교 ───────── */
async function loadCompare() {
  const body = $('#compare-body');
  showEmpty(body, '기록을 불러오는 중…');
  let items = [];
  try { ({ items } = await api.history()); } catch (err) { showEmpty(body, err.message); return; }

  const asc = [...items].reverse(); // 오래된 것부터
  const sel = $('#compare-select');
  sel.textContent = '';
  for (const it of asc) {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = `${new Date(it.createdAt).toLocaleDateString('ko-KR')} · ${it.totalScore}점`;
    sel.appendChild(opt);
  }

  if (asc.length < 2) {
    body.innerHTML = renderCompare({ records: null });
    return;
  }
  const before = state.comparePair?.before ?? asc[0];
  const after = state.comparePair?.after ?? asc[asc.length - 1];
  sel.value = before.id;
  state.comparePair = { before, after };

  const photos = {
    before: await getPhoto(before.id),
    after: await getPhoto(after.id),
  };
  body.innerHTML = renderCompare({ photos, records: { before, after }, showMarkers: state.showMarkers });
  bindCompare(body);
}

$('#compare-select')?.addEventListener('change', async (e) => {
  const { items } = await api.history();
  const asc = [...items].reverse();
  const before = asc.find((i) => i.id === e.target.value);
  const after = state.comparePair?.after ?? asc[asc.length - 1];
  if (before && after && before.id !== after.id) {
    state.comparePair = { before, after };
    loadCompare();
  } else {
    toast('기준 촬영과 비교 촬영이 같습니다. 다른 날짜를 선택해 주세요.');
  }
});

/* ───────── 커머스 ───────── */
async function loadShop() {
  if (!state.analysisId) {
    showEmpty($('#shop-body'), '먼저 피부를 진단하면 내 톤에 맞는 제품을 랭킹해 드립니다.');
    return;
  }
  showEmpty($('#shop-body'), '추천을 계산하는 중…');
  try {
    const data = await api.recommend(state.analysisId, state.category);
    state.shop = data;
    $('#shop-body').innerHTML = renderShop(data, state.category);
  } catch (err) {
    showEmpty($('#shop-body'), err.message);
  }
}

async function buy(productId, merchant, position) {
  try {
    const { url, partnerLinked } = await api.click(productId, merchant, state.analysisId, position);
    if (!partnerLinked) toast('제휴 ID 미설정 — 판매처 검색 결과로 이동합니다.', 2000);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    toast(err.message);
  }
}

async function loadHistory() {
  try {
    const { items } = await api.history();
    $('#history-body').innerHTML = renderHistory(items);
  } catch (err) {
    showEmpty($('#history-body'), err.message);
  }
}

/* ───────── 이벤트 바인딩 ───────── */
document.addEventListener('click', async (e) => {
  // 시트 바깥을 누르면 닫는다
  if (e.target.id === 'sim-sheet') return closeSimSheet();

  const el = e.target.closest('[data-goto],[data-action],[data-plan],[data-cat],[data-buy],[data-open],[data-intake],[data-persona]');
  if (!el) return;

  if (el.dataset.intake) {
    state.intake[el.dataset.intake] = el.dataset.value;
    saveIntake();
    $('#intake-body').innerHTML = renderIntake(state.intake);
    const done = INTAKE.filter((q) => state.intake[q.key]).length;
    if (done === INTAKE.length) toast('문진 완료 — 이제 촬영해 주세요.');
    return;
  }

  if (el.dataset.goto) return go(el.dataset.goto);

  if (el.dataset.plan) {
    state.plan = el.dataset.plan;
    $('#paywall-body').innerHTML = renderPaywall(state.config, state.plan, state.analysisId, state.coupon);
    return;
  }
  if (el.dataset.cat !== undefined && el.classList.contains('chip')) {
    state.category = el.dataset.cat;
    return loadShop();
  }
  if (el.dataset.persona) return runSimulation(el.dataset.persona, $('#sim-followup').checked);
  if (el.dataset.buy) return buy(el.dataset.buy, el.dataset.merchant, Number(el.dataset.pos));
  if (el.dataset.open) {
    const report = await api.report(el.dataset.open).catch((err) => { toast(err.message); return null; });
    if (report) showReport(report);
    return;
  }

  switch (el.dataset.action) {
    case 'intake-done': return go('capture');
    case 'sim-close': return closeSimSheet();
    case 'toggle-markers': {
      state.showMarkers = !state.showMarkers;
      return loadCompare();
    }
    case 'paywall': return openPaywall();
    case 'pay': return pay();
    case 'shop': return go('shop');
    case 'apply-coupon': {
      state.coupon = $('#coupon-input').value.trim().toUpperCase();
      const known = state.config.coupons.find((c) => c.code === state.coupon);
      $('#coupon-msg').textContent = known ? `✓ ${known.label} 적용됨` : '해당 코드를 찾을 수 없습니다.';
      return;
    }
    case 'bundle': {
      const b = state.shop?.bundle;
      if (!b?.items?.length) return;
      // 번들은 판매처가 섞이므로 상품별 최적 오퍼로 순차 오픈한다
      for (const [i, item] of b.items.entries()) {
        await buy(item.id, item.bestOffer.merchant, i + 1);
      }
      return;
    }
  }
});

$('#btn-start').addEventListener('click', () => go('intake'));
$('#btn-skip-typing').addEventListener('click', revealAllConsult);
$('#hero-doctor').innerHTML = doctorAvatar(104, 'happy');
$('#btn-history-home').addEventListener('click', () => go('history'));
$('#btn-simulate').addEventListener('click', openSimSheet);
$('#btn-retake').addEventListener('click', () => go('capture'));
$('#btn-flip').addEventListener('click', () => camera?.flip());

$('#btn-shutter').addEventListener('click', async () => {
  const frame = camera?.grabFrame(640);
  if (!frame) return toast('카메라가 준비되지 않았습니다.');
  const box = await camera.detectBox(frame);
  await camera.stop();
  runAnalysis(frame, box);
});

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  // 같은 사진을 다시 고르면 change 가 안 뜬다. 값을 비워 재선택이 항상 먹히게 한다
  // (재측정 때 같은 파일을 다시 여는 건 흔한 동작이고, 안 비우면 앱이 멈춘 것처럼 보인다)
  e.target.value = '';
  if (!file) return;
  try {
    const img = await imageDataFromFile(file, 640);
    await camera?.stop();
    runAnalysis(img, null);
  } catch (err) { toast(err.message); }
});

/* ───────── 부팅 ───────── */
(async function boot() {
  try {
    await api.ensureSession();
    state.config = await api.config();
    $('#home-disclaimer').textContent = state.config.disclaimer;
  } catch (err) {
    toast(`서버에 연결할 수 없습니다: ${err.message}`);
  }

  // 외부 결제창에서 돌아온 경우 승인 처리
  const params = new URLSearchParams(location.search);
  const paid = params.get('paid');
  const paymentKey = params.get('paymentKey');
  const amount = params.get('amount');
  if (paid) {
    try {
      const res = await api.confirm(paid, paymentKey || paid, amount);
      history.replaceState({}, '', location.pathname);
      finishPurchase(res);
    } catch (err) { toast(`결제 확인 실패: ${err.message}`); }
  }
  // 터미널 리허설(scripts/simulate.mjs)이 앱과 같은 샘플 얼굴을 쓰도록 노출한다.
  // 두 곳이 다른 얼굴을 쓰면 "리허설은 통과했는데 앱은 다르다"가 된다.
  window.__skinlabSim = { PERSONAS, drawFace, improved, runSimulation };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
