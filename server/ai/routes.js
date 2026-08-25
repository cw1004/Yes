'use strict';
/**
 * AI 추천 라우트.
 *
 * 추천 1회는 웹 검색을 여러 번 돌기 때문에 수십 초가 걸릴 수 있다.
 * 같은 조건의 요청이 동시에 들어오면 하나의 실행을 공유하고(in-flight),
 * 결과는 짧게 캐시한다.
 */

const recommender = require('./recommender');
const screener = require('./screener');

const inFlight = new Map();

const MARKETS = ['US', 'KR'];
const HORIZONS = ['당일 단타', '당일~2일 단타', '2~3일 스윙', '1~2주 스윙'];
const RISKS = ['보수적', '중립', '공격적'];

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function handle(req, res, url, sendJSON) {
  const p = url.pathname;
  if (!p.startsWith('/api/ai/')) return false;
  const params = url.searchParams;

  try {
    switch (p) {
      case '/api/ai/health':
        sendJSON(res, 200, {
          ok: true,
          configured: recommender.hasCredentials(),
          model: recommender.MODEL,
          markets: MARKETS,
          horizons: HORIZONS,
          risks: RISKS,
        });
        return true;

      case '/api/ai/screen': {
        const market = pick(String(params.get('market') || 'US').toUpperCase(), MARKETS, 'US');
        const symbols = parseSymbols(params.get('symbols'));
        const scan = await screener.screen(market, {
          symbols: market === 'US' ? symbols : undefined,
          codes: market === 'KR' ? symbols : undefined,
          limit: Number(params.get('limit')) || 10,
        });
        sendJSON(res, 200, scan);
        return true;
      }

      case '/api/ai/recommend': {
        const market = pick(String(params.get('market') || 'US').toUpperCase(), MARKETS, 'US');
        const horizon = pick(params.get('horizon'), HORIZONS, '당일~2일 단타');
        const risk = pick(params.get('risk'), RISKS, '중립');
        const symbols = parseSymbols(params.get('symbols'));
        const force = params.get('force') === '1';

        const key = [market, horizon, risk, (symbols || []).join('|')].join(':');
        let job = inFlight.get(key);
        if (!job) {
          job = recommender.recommend({ market, horizon, risk, symbols, force })
            .finally(() => inFlight.delete(key));
          inFlight.set(key, job);
        }
        sendJSON(res, 200, await job);
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
  if (!raw) return undefined;
  const list = String(raw).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  return list.length ? list : undefined;
}

module.exports = { handle, HORIZONS, RISKS, MARKETS };
