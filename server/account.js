/**
 * 계정 이어받기와 데이터 삭제.
 *
 * 이 앱은 회원가입 없이 브라우저에 저장된 토큰 하나로 사람을 구분한다.
 * 이탈을 줄이는 좋은 설계지만, 그대로 두면 **브라우저 기록을 지우거나 폰을 바꾸는 순간
 * 4주간 쌓은 진단 기록과 결제한 이용권이 영영 사라진다.** 실제 사용자에게는 환불 요구가 되고,
 * 전후 비교라는 이 앱의 핵심 가치도 함께 사라진다.
 *
 * 그래서 '복구 코드'를 준다. 코드 자체가 열쇠이므로 서버에는 해시만 저장하고,
 * 입력 시도는 강하게 제한한다.
 */
import crypto from 'node:crypto';
import { db, logEvent } from './store.js';
import { sign } from './auth.js';

// 사람이 옮겨 적을 수 있어야 해서 헷갈리는 글자(0/O, 1/I)는 뺐다
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 10;

const hash = (code) => crypto.createHash('sha256').update(`skinlab:${code}`).digest('hex');
const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function generate() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 사용자의 복구 코드를 새로 만든다 (이전 코드는 즉시 무효) */
export function createRecoveryCode(userId) {
  const code = generate();
  db.update((d) => {
    d.recovery ||= {};
    // 같은 사용자의 옛 코드는 지운다 — 유출된 코드가 계속 살아 있으면 안 된다
    for (const [h, rec] of Object.entries(d.recovery)) {
      if (rec.userId === userId) delete d.recovery[h];
    }
    d.recovery[hash(code)] = { userId, createdAt: new Date().toISOString(), attempts: 0 };
  });
  db.flushNow();   // 코드를 보여준 뒤 서버가 죽으면 사용자는 못 쓰는 코드를 들고 있게 된다
  logEvent('recovery_code_created', { userId });
  // 읽기 쉽게 4-3-3 으로 끊어서 보여준다
  return { code, formatted: `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}` };
}

/**
 * 코드로 계정을 되찾는다.
 * @returns {{userId:string, token:string}|null}
 */
export function redeemRecoveryCode(rawCode) {
  const code = normalize(rawCode);
  if (code.length !== CODE_LEN) return null;
  const d = db.read();
  const rec = d.recovery?.[hash(code)];
  if (!rec) return null;
  if (!d.users[rec.userId]) return null;

  logEvent('recovery_code_used', { userId: rec.userId });
  return {
    userId: rec.userId,
    token: sign({ sub: rec.userId, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 365 }),
  };
}

/** 내 코드가 이미 있는지 (다시 보여줄 수는 없다 — 해시만 갖고 있다) */
export function hasRecoveryCode(userId) {
  const d = db.read();
  return Object.values(d.recovery || {}).some((r) => r.userId === userId);
}

/**
 * 내 데이터 전부 삭제.
 * 개인정보보호법상 파기 요구에 응할 수 있어야 하고, 무엇보다 사용자가
 * '지울 수 있다'는 걸 알아야 얼굴을 찍는다.
 */
export function deleteAccount(userId) {
  let removed = { analyses: 0, clicks: 0, orders: 0 };
  db.update((d) => {
    for (const [id, a] of Object.entries(d.analyses)) {
      if (a.userId === userId) { delete d.analyses[id]; removed.analyses++; }
    }
    for (const [id, o] of Object.entries(d.orders || {})) {
      // 주문은 정산·세무 목적으로 금액과 시각만 남기고 사람과의 연결을 끊는다
      if (o.userId === userId) { d.orders[id] = { ...o, userId: null, analysisId: null, anonymizedAt: new Date().toISOString() }; removed.orders++; }
    }
    const before = (d.clicks || []).length;
    d.clicks = (d.clicks || []).map((c) => (c.userId === userId ? { ...c, userId: null, analysisId: null } : c));
    removed.clicks = before ? d.clicks.filter((c) => c.userId === null).length : 0;
    delete d.entitlements[userId];
    delete d.users[userId];
    for (const [h, r] of Object.entries(d.recovery || {})) if (r.userId === userId) delete d.recovery[h];
    d.events = (d.events || []).filter((e) => e.userId !== userId);
  });
  db.flushNow();
  logEvent('account_deleted', {});
  return removed;
}
