/**
 * 익명 디바이스 토큰 + 서명.
 * 회원가입 없이 바로 진단할 수 있어야 이탈이 줄기 때문에
 * 익명 사용자에게 서명된 토큰을 발급하고, 결제 시점에만 식별 정보를 붙인다.
 */
import crypto from 'node:crypto';
import { db, logEvent } from './store.js';

const SECRET = process.env.SKINLAB_SECRET || 'dev-only-insecure-secret-change-me';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createUser(meta = {}) {
  const id = `u_${crypto.randomUUID()}`;
  db.update((d) => {
    d.users[id] = { id, createdAt: new Date().toISOString(), plan: 'free', ...meta };
  });
  logEvent('user_created', { userId: id });
  return {
    userId: id,
    token: sign({ sub: id, iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 24 * 365 }),
  };
}

export function userFromRequest(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verify(token) : null;
  if (!payload) return null;
  const user = db.read().users[payload.sub];
  return user || null;
}
