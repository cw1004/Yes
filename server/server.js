'use strict';
/**
 * 의존성 없는 정적 파일 서버 + 시세 프록시.
 *   node server/server.js            # 실시간(야후) 우선, 실패 시 데모 데이터
 *   MOCK=1 node server/server.js     # 항상 데모 데이터 (오프라인)
 *   PORT=8080 node server/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const yahoo = require('./providers/yahoo');
const mock = require('./providers/mock');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const FORCE_MOCK = process.env.MOCK === '1' || process.env.MOCK === 'true';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const VALID_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '1d'];
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'];
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;

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

function ttlFor(interval) {
  if (interval === '1m' || interval === '2m') return 15e3;
  if (interval === '5m') return 30e3;
  if (interval === '1d') return 300e3;
  return 60e3;
}

async function handleCandles(res, params) {
  const symbol = String(params.get('symbol') || 'AAPL').trim().toUpperCase();
  const interval = String(params.get('interval') || '5m');
  const range = String(params.get('range') || '5d');

  if (!SYMBOL_RE.test(symbol)) return sendJSON(res, 400, { error: '잘못된 심볼입니다.' });
  if (!VALID_INTERVALS.includes(interval)) return sendJSON(res, 400, { error: '지원하지 않는 봉 주기입니다.' });
  if (!VALID_RANGES.includes(range)) return sendJSON(res, 400, { error: '지원하지 않는 조회 기간입니다.' });

  const key = `c:${symbol}:${interval}:${range}:${FORCE_MOCK ? 'm' : 'l'}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached);

  let data;
  if (FORCE_MOCK) {
    data = mock.generate(symbol, interval, range);
  } else {
    try {
      data = await yahoo.chart(symbol, interval, range);
      if (!data.candles.length) throw new Error('empty series');
    } catch (err) {
      data = mock.generate(symbol, interval, range);
      data.notice = '실시간 시세를 가져오지 못해 데모 데이터로 대체했습니다. (' + err.message + ')';
    }
  }
  cacheSet(key, data, ttlFor(interval));
  sendJSON(res, 200, data);
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
    if (pathname === '/api/candles') return await handleCandles(res, searchParams);
    if (pathname === '/api/quotes') return await handleQuotes(res, searchParams);
    if (pathname === '/api/search') return await handleSearch(res, searchParams);
    if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res, pathname);
  } catch (err) {
    sendJSON(res, 500, { error: err.message || 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📈  ScalpDesk  http://${HOST}:${PORT}`);
  console.log(`      모드: ${FORCE_MOCK ? '데모(오프라인)' : '실시간(Yahoo Finance) · 실패 시 데모 자동 전환'}\n`);
});
