'use strict';
/**
 * 접근 제어 — 이 서버는 실제 주문을 내거나 유료 API를 호출할 수 있다.
 *
 * 그래서 기본값은 127.0.0.1(내 컴퓨터) 전용이다.
 * 휴대폰에서 보려고 HOST=0.0.0.0 으로 열면 같은 와이파이의 다른 기기도 들어올 수 있으므로,
 * 돈이 나가는 요청(주문·AI 분석)은 KIS_UI_TOKEN 을 요구한다.
 */

const { URL } = require('url');

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

/** 이 요청이 내 컴퓨터에서 온 것인가 */
function isLoopback(req) {
  const host = String((req.headers && req.headers.host) || '');
  if (LOOPBACK.test(host)) return true;
  // Host 헤더는 위조될 수 있으므로 실제 소켓 주소도 확인한다
  const addr = req.socket && req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * 돈이 나가거나 되돌릴 수 없는 요청을 허용할지 판단한다.
 * @returns {{ok:boolean, reason?:string}}
 */
function allowSensitive(req) {
  const token = process.env.KIS_UI_TOKEN;
  if (isLoopback(req) && !token) return { ok: true };
  if (!token) {
    return {
      ok: false,
      reason: '외부 기기에서는 KIS_UI_TOKEN 이 필요합니다. (.env 에 KIS_UI_TOKEN=원하는_암호 를 넣고 다시 실행하세요)',
    };
  }
  let given = req.headers['x-ui-token'];
  if (!given) {
    try {
      given = new URL(req.url, 'http://x').searchParams.get('token');
    } catch (_) { /* 무시 */ }
  }
  return given === token
    ? { ok: true }
    : { ok: false, reason: '토큰이 올바르지 않습니다.' };
}

module.exports = { isLoopback, allowSensitive, LOOPBACK };
