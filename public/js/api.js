/** 서버 통신 래퍼. 토큰은 로컬에 보관하고 매 요청에 붙인다. */
const TOKEN_KEY = 'skinlab.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),

  async ensureSession() {
    const r = await request('POST', '/api/session');
    if (r.token) setToken(r.token);
    return r;
  },
  config: () => request('GET', '/api/config'),
  submitAnalysis: (analysis, quality, intake) => request('POST', '/api/analysis', { analysis, quality, intake }),
  report: (id) => request('GET', `/api/report?id=${encodeURIComponent(id)}`),
  recommend: (id, category) => request('GET', `/api/recommend?id=${encodeURIComponent(id)}${category ? `&category=${category}` : ''}`),
  history: () => request('GET', '/api/history'),
  checkout: (planId, analysisId, couponCode) => request('POST', '/api/checkout', { planId, analysisId, couponCode }),
  confirm: (orderId, paymentKey, amount) => request('POST', '/api/checkout/confirm', { orderId, paymentKey, amount }),
  paywallView: (analysisId, source) => request('POST', '/api/paywall-view', { analysisId, source }).catch(() => {}),
  click: (productId, merchant, analysisId, position) => request('POST', '/api/click', { productId, merchant, analysisId, position }),
};
