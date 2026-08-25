'use strict';
/**
 * 한국 시장 API 라우트.
 *
 * 이 서버는 실제 주문을 낼 수 있으므로 기본적으로 127.0.0.1 에만 바인딩한다.
 * 외부 IP로 열려면(HOST=0.0.0.0) KIS_UI_TOKEN 을 반드시 설정해야 하며,
 * 상태 변경/주문 계열 요청은 토큰 없이는 거부된다.
 */

const { KisClient } = require('../providers/kis');
const { KisRealtime } = require('../providers/kis-ws');
const { MockKisClient, MockRealtime, searchUniverse, UNIVERSE } = require('../providers/kr-mock');
const { KrHub } = require('./hub');
const { Trader } = require('./trader');
const C = require('./config');

let hub = null;
let trader = null;
let client = null;
let mode = 'mock';

function init() {
  if (hub) return { hub, trader, client, mode };

  const real = new KisClient();
  const forceMock = process.env.KIS_MOCK === '1' || !real.configured;
  if (forceMock) {
    client = new MockKisClient();
    hub = new KrHub({ client, realtime: new MockRealtime() });
    mode = 'mock';
    if (!real.configured) {
      console.log('  ⓘ KIS 자격증명이 없어 한국 시장은 데모 데이터로 동작합니다.');
      console.log('    실시간을 쓰려면 KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT 환경변수를 설정하세요.');
    }
  } else {
    client = real;
    const rt = new KisRealtime(real);
    hub = new KrHub({ client, realtime: rt });
    mode = real.paper ? 'paper' : 'live';
    rt.on('notice', (fill) => trader && trader.onNotice(fill));
    if (process.env.KIS_HTS_ID) rt.watchNotice(process.env.KIS_HTS_ID);
  }
  trader = new Trader({ hub, client });
  hub.on('rt-error', (e) => console.warn('[KR]', e.message));
  return { hub, trader, client, mode };
}

const CODE_RE = /^[0-9A-Z]{5,6}$/;

/** 상태를 바꾸는 요청은 루프백이 아니면 토큰을 요구한다 */
function authorized(req) {
  const host = String(req.headers.host || '');
  const isLoopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
  const required = process.env.KIS_UI_TOKEN;
  if (isLoopback && !required) return true;
  if (!required) return false;
  const given = req.headers['x-ui-token'] || new URL(req.url, 'http://x').searchParams.get('token');
  return given === required;
}

async function handle(req, res, url, sendJSON) {
  const p = url.pathname;
  const params = url.searchParams;
  if (!p.startsWith('/api/kr/')) return false;

  const { hub, trader, client, mode } = init();
  const code = String(params.get('code') || '').toUpperCase();
  const mutating = req.method === 'POST';

  if (mutating && !authorized(req)) {
    sendJSON(res, 403, { error: '외부 접속에서는 KIS_UI_TOKEN 이 필요합니다. (기본은 127.0.0.1 전용)' });
    return true;
  }

  try {
    switch (p) {
      case '/api/kr/health':
        sendJSON(res, 200, {
          ok: true,
          mode,                                   // mock | paper | live
          modeLabel: { mock: '데모', paper: '모의투자', live: '실전' }[mode],
          phase: C.marketPhase(),
          tradable: client.tradable,
          wsStatus: hub.rt.status,
          subscriptions: hub.rt.subscriptionCount,
          timeframes: Object.keys(C.TIMEFRAMES),
          serverTime: Date.now(),
        });
        return true;

      case '/api/kr/search': {
        const q = String(params.get('q') || '').trim();
        const results = searchUniverse(q);
        // 6자리 종목코드를 직접 넣으면 실제 시세로 이름을 확인해 결과에 넣는다
        if (/^[0-9]{6}$/.test(q) && !results.some((r) => r.code === q)) {
          try {
            const info = await client.price(q);
            if (info && info.price) results.unshift({ code: q, name: info.name || q, market: info.market || '' });
          } catch (_) {
            results.unshift({ code: q, name: '(이름 확인 실패 — 코드로 조회)', market: '' });
          }
        }
        sendJSON(res, 200, { results, universeOnly: mode === 'mock' });
        return true;
      }

      case '/api/kr/quotes': {
        const codes = String(params.get('codes') || '')
          .split(',').map((c) => c.trim().toUpperCase()).filter((c) => CODE_RE.test(c)).slice(0, 12);
        const quotes = [];
        for (const c of codes) {
          // 이미 구독 중인 종목은 실시간 값을 그대로 쓴다 (REST 유량 절약)
          const st = hub.get(c);
          if (st && st.quote) { quotes.push(st.quote); continue; }
          try { quotes.push(await client.price(c)); } catch (_) { quotes.push({ code: c, price: 0 }); }
        }
        sendJSON(res, 200, { quotes });
        return true;
      }

      case '/api/kr/universe':
        sendJSON(res, 200, {
          items: Object.entries(UNIVERSE).map(([c, m]) => ({ code: c, name: m.name, market: m.market })),
        });
        return true;

      case '/api/kr/watch': {
        if (!CODE_RE.test(code)) return bad(res, sendJSON, '종목코드 형식이 올바르지 않습니다.');
        await hub.watch(code);
        sendJSON(res, 200, hub.snapshot(code, params.get('tf') || '10s', 400));
        return true;
      }

      case '/api/kr/snapshot': {
        if (!CODE_RE.test(code)) return bad(res, sendJSON, '종목코드 형식이 올바르지 않습니다.');
        const tf = params.get('tf') || '10s';
        if (!C.TIMEFRAMES[tf]) return bad(res, sendJSON, '지원하지 않는 봉 주기입니다.');
        if (!hub.get(code)) await hub.watch(code);
        sendJSON(res, 200, hub.snapshot(code, tf, Number(params.get('limit')) || 400));
        return true;
      }

      case '/api/kr/stream': {
        if (!CODE_RE.test(code)) return bad(res, sendJSON, '종목코드 형식이 올바르지 않습니다.');
        const tf = params.get('tf') || '10s';
        await hub.watch(code);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const sseClient = hub.addClient(res, code, tf);
        const ping = setInterval(() => {
          try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
        }, 15000);
        req.on('close', () => {
          clearInterval(ping);
          hub.clients.delete(sseClient);
        });
        return true;
      }

      case '/api/kr/orderbook': {
        if (!CODE_RE.test(code)) return bad(res, sendJSON, '종목코드 형식이 올바르지 않습니다.');
        sendJSON(res, 200, await client.orderbook(code));
        return true;
      }

      case '/api/kr/balance':
        sendJSON(res, 200, await client.balance());
        return true;

      case '/api/kr/trader':
        sendJSON(res, 200, trader.status());
        return true;

      case '/api/kr/trader/config': {
        const body = await readBody(req);
        sendJSON(res, 200, trader.setConfig(body));
        return true;
      }

      case '/api/kr/trader/kill': {
        const body = await readBody(req);
        sendJSON(res, 200, await trader.kill(body.reason || '수동 정지', body.closePositions !== false));
        return true;
      }

      case '/api/kr/trader/resume':
        sendJSON(res, 200, trader.resume());
        return true;

      case '/api/kr/order': {
        // 수동 주문: 화면에서 확인을 거친 뒤에만 호출된다
        const body = await readBody(req);
        const { code: c, side, qty, price, ordDvsn } = body;
        if (!CODE_RE.test(String(c || '').toUpperCase())) return bad(res, sendJSON, '종목코드가 올바르지 않습니다.');
        if (!['buy', 'sell'].includes(side)) return bad(res, sendJSON, 'side 는 buy/sell 이어야 합니다.');
        if (!(Number(qty) > 0)) return bad(res, sendJSON, '수량이 올바르지 않습니다.');
        if (mode === 'live' && !trader.config.allowLive) {
          return bad(res, sendJSON, '실전 주문이 잠겨 있습니다. 자동매매 설정에서 "실전 주문 허용"을 켜야 합니다.', 423);
        }
        const result = await client.order({ code: String(c).toUpperCase(), side, qty: Number(qty), price: Number(price) || 0, ordDvsn });
        trader._log('order', side === 'buy' ? 'MANUAL_BUY' : 'MANUAL_SELL',
          `[수동] ${c} ${side === 'buy' ? '매수' : '매도'} ${qty}주 @ ${price ? Number(price).toLocaleString() : '시장가'}`);
        sendJSON(res, 200, result);
        return true;
      }

      default:
        sendJSON(res, 404, { error: '알 수 없는 엔드포인트' });
        return true;
    }
  } catch (err) {
    sendJSON(res, 500, { error: err.message || String(err) });
    return true;
  }
}

function bad(res, sendJSON, message, status = 400) {
  sendJSON(res, status, { error: message });
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('요청 본문이 너무 큽니다.'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = { handle, init };
