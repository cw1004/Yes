/**
 * SkinLab AI — 화면 전환과 데이터 흐름을 잇는 컨트롤러.
 * 분석은 전부 이 브라우저 안에서 끝나고, 서버에는 숫자 지표만 보낸다.
 */
import { api } from './api.js';
import { Camera, imageDataFromFile } from './ui/camera.js';
import { computeMetrics } from './engine/metrics.js';
import { assessQuality, fallbackFaceBox } from './engine/quality.js';
import { renderResult, renderPaywall, renderShop, renderHistory } from './ui/render.js';

const $ = (s) => document.querySelector(s);
const state = { config: null, report: null, analysisId: null, plan: 'monthly', coupon: '', category: '', shop: null };

/* ───────── 공통 UI ───────── */
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.goto === name));
  window.scrollTo({ top: 0 });
  if (name !== 'capture') camera?.stop();
  if (name === 'capture') startCapture();
  if (name === 'shop') loadShop();
  if (name === 'history') loadHistory();
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
  try { await camera.start(); } catch { $('#btn-shutter').disabled = true; }
}

/* ───────── 분석 파이프라인 ───────── */
const STEPS = ['피부 영역 검출 중…', '색공간(Lab) 변환 중…', '9개 지표 계산 중…', '진단 규칙 적용 중…', '맞춤 처방 생성 중…'];

async function runAnalysis(imageData, box) {
  go('analyzing');
  const canvas = $('#preview-canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);

  const faceBox = box || fallbackFaceBox(imageData.width, imageData.height);
  const quality = assessQuality(imageData, faceBox);

  for (let i = 0; i < STEPS.length; i++) {
    $('#analyzing-step').textContent = STEPS[i];
    $('#analyze-bar').style.width = `${((i + 1) / STEPS.length) * 100}%`;
    // 무거운 계산은 3단계에서 한 번만 — 그 전에 프레임을 한 번 넘겨 UI가 멈추지 않게 한다
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 220)));
    if (i === 2) var analysis = computeMetrics(imageData, faceBox);
  }

  if (quality.issues.length && quality.confidence < 45) {
    toast(quality.issues[0].message, 4200);
  }

  try {
    const report = await api.submitAnalysis(analysis, quality);
    showReport(report);
  } catch (err) {
    toast(err.message);
    go('capture');
  }
}

function showReport(report) {
  state.report = report;
  state.analysisId = report.analysisId;
  $('#result-body').innerHTML = renderResult(report);
  go('result');
  if (report.locked) api.paywallView(report.analysisId, 'result_lock');
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
  toast('결제가 완료되었습니다. 전체 리포트가 열렸습니다 🎉');
  if (res.report) showReport(res.report);
  else if (state.analysisId) api.report(state.analysisId).then(showReport);
}

/* ───────── 커머스 ───────── */
async function loadShop() {
  if (!state.analysisId) {
    $('#shop-body').innerHTML = `<div class="empty">먼저 피부를 진단하면<br>내 톤에 맞는 제품을 랭킹해 드립니다.</div>`;
    return;
  }
  $('#shop-body').innerHTML = `<div class="empty">추천을 계산하는 중…</div>`;
  try {
    const data = await api.recommend(state.analysisId, state.category);
    state.shop = data;
    $('#shop-body').innerHTML = renderShop(data, state.category);
  } catch (err) {
    $('#shop-body').innerHTML = `<div class="empty">${err.message}</div>`;
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
    $('#history-body').innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

/* ───────── 이벤트 바인딩 ───────── */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-goto],[data-action],[data-plan],[data-cat],[data-buy],[data-open]');
  if (!el) return;

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
  if (el.dataset.buy) return buy(el.dataset.buy, el.dataset.merchant, Number(el.dataset.pos));
  if (el.dataset.open) {
    const report = await api.report(el.dataset.open).catch((err) => { toast(err.message); return null; });
    if (report) showReport(report);
    return;
  }

  switch (el.dataset.action) {
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

$('#btn-start').addEventListener('click', () => go('capture'));
$('#btn-history-home').addEventListener('click', () => go('history'));
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
