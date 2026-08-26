'use strict';
/**
 * 의존성 없는 정적 파일 서버 + 시세 프록시.
 *   node server/server.js            # 실시간(야후) 우선, 실패 시 데모 데이터
 *   MOCK=1 node server/server.js     # 항상 데모 데이터 (오프라인)
 *   PORT=8080 node server/server.js
 *
 * API 키는 프로젝트 폴더의 .env 파일에 적어 두면 자동으로 읽힌다 (.env.example 참고).
 */

// .env 를 가장 먼저 읽는다 — 아래 모듈들이 로드 시점에 process.env 를 참조하기 때문이다
require('./load-env');

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const yahoo = require('./providers/yahoo');
const mock = require('./providers/mock');
const marketdata = require('./marketdata');
const krRoutes = require('./kr/routes');
const aiRoutes = require('./ai/routes');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const FORCE_MOCK = process.env.MOCK === '1' || process.env.MOCK === 'true';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const SYMBOL_RE = marketdata.SYMBOL_RE;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** 짧은 TTL 메모리 캐시 – 자동 새로고침 폴링이 상방 API를 두드리지 않도록 */
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  if (cache.size > 300) cache.clear();
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleCandles(res, params) {
  const symbol = String(params.get('symbol') || 'AAPL');
  const interval = String(params.get('interval') || '5m');
  const range = String(params.get('range') || '5d');
  try {
    sendJSON(res, 200, await marketdata.getCandles(symbol, interval, range));
  } catch (err) {
    sendJSON(res, 400, { error: err.message });
  }
}

async function handleQuotes(res, params) {
  const raw = String(params.get('symbols') || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => SYMBOL_RE.test(s))
    .slice(0, 20);
  if (!raw.length) return sendJSON(res, 200, { quotes: [] });

  const quotes = await Promise.all(
    raw.map(async (symbol) => {
      const key = `q:${symbol}:${FORCE_MOCK ? 'm' : 'l'}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      let q;
      try {
        if (FORCE_MOCK) throw new Error('mock mode');
        q = await yahoo.quote(symbol);
      } catch (_) {
        const d = mock.generate(symbol, '5m', '1d');
        const price = d.meta.price;
        const prev = d.meta.previousClose;
        q = {
          symbol,
          name: d.meta.name,
          price,
          previousClose: prev,
          change: price - prev,
          changePercent: prev ? ((price - prev) / prev) * 100 : 0,
          source: 'mock',
          spark: d.candles.slice(-60).map((c) => c.c),
        };
      }
      cacheSet(key, q, 20e3);
      return q;
    })
  );
  sendJSON(res, 200, { quotes });
}

async function handleSearch(res, params) {
  const q = String(params.get('q') || '').trim();
  if (q.length < 1) return sendJSON(res, 200, { results: [] });
  const key = 's:' + q.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached);
  let out;
  try {
    if (FORCE_MOCK) throw new Error('mock mode');
    out = { results: await yahoo.search(q) };
  } catch (_) {
    const up = q.toUpperCase();
    out = {
      results: SYMBOL_RE.test(up)
        ? [{ symbol: up, name: up + ' (오프라인 추정)', exchange: '-', type: 'EQUITY' }]
        : [],
      offline: true,
    };
  }
  cacheSet(key, out, 600e3);
  sendJSON(res, 200, out);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  // 디렉터리 탈출 방지
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const { pathname, searchParams } = url;

  try {
    if (pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true, mode: FORCE_MOCK ? 'mock' : 'live', time: Date.now() });
    }
    // 한국 시장(KIS) 라우트는 별도 모듈에서 처리한다
    if (pathname.startsWith('/api/kr/')) {
      if (await krRoutes.handle(req, res, url, sendJSON)) return;
    }
    // AI 추천 종목 라우트
    if (pathname.startsWith('/api/ai/')) {
      if (await aiRoutes.handle(req, res, url, sendJSON)) return;
    }
    if (pathname === '/api/candles') return await handleCandles(res, searchParams);
    if (pathname === '/api/quotes') return await handleQuotes(res, searchParams);
    if (pathname === '/api/search') return await handleSearch(res, searchParams);
    if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res, pathname);
  } catch (err) {
    sendJSON(res, 500, { error: err.message || 'server error' });
  }
});

/** 같은 와이파이의 다른 기기가 쓸 수 있는 주소들 */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const openToLan = HOST === '0.0.0.0' || HOST === '::';

  console.log(`\n  📈  ScalpDesk  http://127.0.0.1:${PORT}`);
  console.log(`      미국: ${FORCE_MOCK ? '데모(오프라인)' : '실시간(Yahoo Finance) · 실패 시 데모 자동 전환'}`);
  console.log(`      한국: ${process.env.KIS_APP_KEY ? (process.env.KIS_PAPER === '0' ? '한국투자증권 실전' : '한국투자증권 모의투자') : '데모(KIS 키 없음)'}`);

  if (openToLan) {
    const addrs = lanAddresses();
    if (addrs.length) {
      console.log('\n  📱  휴대폰에서 보려면 (같은 와이파이에 연결한 뒤 아래 주소로 접속)');
      addrs.forEach((ip) => console.log(`      http://${ip}:${PORT}`));
    } else {
      console.log('\n  📱  네트워크 주소를 찾지 못했습니다. 와이파이 연결을 확인하세요.');
    }
    if (!process.env.KIS_UI_TOKEN) {
      console.warn('\n  ⚠️  외부 기기에 열려 있는데 KIS_UI_TOKEN 이 없습니다.');
      console.warn('      차트는 볼 수 있지만 주문·AI 분석 요청은 거부됩니다.');
      console.warn('      필요하면 .env 에 KIS_UI_TOKEN=원하는_암호 를 넣고 다시 실행하세요.');
    }
  } else {
    console.log(`\n  ⓘ  휴대폰에서도 보려면: HOST=0.0.0.0 으로 실행하세요 (같은 와이파이 필요)`);
  }
  console.log('');
});
