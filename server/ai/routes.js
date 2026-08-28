'use strict';
/**
 * AI 추천 라우트.
 *
 * 추천 1회는 뉴스 수집 + 모델 호출(웹 검색 포함)이라 수십 초가 걸릴 수 있다.
 * 같은 조건의 요청이 동시에 들어오면 하나의 실행을 공유하고, 결과는 짧게 캐시한다.
 */

const recommender = require('./recommender');
const screener = require('./screener');
const scanner = require('./scanner');
const providers = require('./providers');
const tracker = require('./tracker');
const news = require('./news');
const marketdata = require('../marketdata');
const { allowSensitive } = require('../access');

const inFlight = new Map();

const MARKETS = ['US', 'KR'];
const HORIZONS = ['당일 단타', '당일~2일 단타', '2~3일 스윙', '1~2주 스윙'];
const RISKS = ['보수적', '중립', '공격적'];

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 성과 채점에 쓸 현재가 조회 */
async function getPrice(market, symbol) {
  if (market === 'KR') {
    const { init } = require('../kr/routes');
    const { client } = init();
    const q = await client.price(symbol);
    return q && q.price ? q.price : null;
  }
  const data = await marketdata.getCandles(symbol, '5m', '1d');
  if (data.meta && data.meta.price) return data.meta.price;
  const last = data.candles[data.candles.length - 1];
  return last ? last.c : null;
}

async function handle(req, res, url, sendJSON) {
  const p = url.pathname;
  if (!p.startsWith('/api/ai/')) return false;
  const params = url.searchParams;

  try {
    switch (p) {
      case '/api/ai/health': {
        const status = await providers.status();
        sendJSON(res, 200, {
          ok: true,
          providers: status,
          configured: status.some((s) => s.ready),
          newsEnabled: process.env.NEWS_ENABLED !== '0',
          feeds: news.configuredFeeds().length,
          markets: MARKETS,
          horizons: HORIZONS,
          risks: RISKS,
        });
        return true;
      }

      case '/api/ai/providers':
        sendJSON(res, 200, { providers: await providers.status() });
        return true;

      case '/api/ai/news': {
        const market = pick(String(params.get('market') || 'US').toUpperCase(), MARKETS, 'US');
        sendJSON(res, 200, await news.collect({ market, marketMax: 20 }));
        return true;
      }

      case '/api/ai/screen': {
        const market = pick(String(params.get('market') || 'US').toUpperCase(), MARKETS, 'US');
        const symbols = parseSymbols(params.get('symbols'));
        sendJSON(res, 200, await screener.screen(market, {
          symbols: market === 'US' ? symbols : undefined,
          codes: market === 'KR' ? symbols : undefined,
          limit: Number(params.get('limit')) || 10,
        }));
        return true;
      }

      case '/api/ai/scan': {
        // 실시간 단타 후보 — 구독자가 없으면 여기서 한 번 돌려서 씨앗을 만든다
        const sc = scanner.get();
        const limit = clamp(Number(params.get('limit')) || 8, 3, 20);
        if (params.get('start') === '1') sc.start();
        sendJSON(res, 200, Object.assign(sc.snapshot(limit), { best: sc.best(limit) }));
        return true;
      }

      case '/api/ai/scan/stream': {
        const sc = scanner.get();
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const client = sc.addClient(res);
        // 붙자마자 지금까지 모아 둔 결과를 먼저 보낸다 (첫 스캔까지 기다리지 않게)
        res.write(`data: ${JSON.stringify({ type: 'snapshot', data: sc.snapshot() })}\n\n`);
        const ping = setInterval(() => {
          try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
        }, 15000);
        req.on('close', () => {
          clearInterval(ping);
          sc.removeClient(client);
        });
        return true;
      }

      case '/api/ai/scan/stop': {
        sendJSON(res, 200, scanner.get().stop('사용자 정지'));
        return true;
      }

      case '/api/ai/recommend': {
        // 모델 호출은 요금이 발생하므로 외부 기기에서는 토큰을 요구한다
        const gate = allowSensitive(req);
        if (!gate.ok) {
          sendJSON(res, 403, { error: gate.reason });
          return true;
        }
        const market = pick(String(params.get('market') || 'US').toUpperCase(), MARKETS, 'US');
        const horizon = pick(params.get('horizon'), HORIZONS, '당일~2일 단타');
        const risk = pick(params.get('risk'), RISKS, '중립');
        const symbols = parseSymbols(params.get('symbols'));
        const only = parseList(params.get('providers'));
        const force = params.get('force') === '1';

        const key = [market, horizon, risk, (symbols || []).join('|'), (only || []).join('|')].join(':');
        let job = inFlight.get(key);
        if (!job) {
          job = recommender.recommend({ market, horizon, risk, symbols, providers: only, force })
            .finally(() => inFlight.delete(key));
          inFlight.set(key, job);
        }
        sendJSON(res, 200, await job);
        return true;
      }

      case '/api/ai/performance': {
        if (params.get('score') !== '0') {
          // 열려 있는 추천을 현재가로 채점한 뒤 성적표를 낸다
          await tracker.scoreAll({ getPrice }).catch(() => {});
        }
        sendJSON(res, 200, tracker.summary());
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

function parseSymbols(raw) {
  return parseList(raw, 30);
}

function parseList(raw, max = 10) {
  if (!raw) return undefined;
  const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean).slice(0, max);
  return list.length ? list : undefined;
}

module.exports = { handle, HORIZONS, RISKS, MARKETS, getPrice };
