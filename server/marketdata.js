'use strict';
/**
 * 미국 시세 조회 공용 모듈 — 짧은 TTL 캐시 + 실패 시 데모 데이터 대체.
 * server.js(차트 API)와 ai/screener.js(후보 스크리닝)가 같은 경로를 쓰도록 분리했다.
 */

const yahoo = require('./providers/yahoo');
const mock = require('./providers/mock');

const FORCE_MOCK = process.env.MOCK === '1' || process.env.MOCK === 'true';

const VALID_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '1d'];
const VALID_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'];
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,15}$/;

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

function ttlFor(interval) {
  if (interval === '1m' || interval === '2m') return 15e3;
  if (interval === '5m') return 30e3;
  if (interval === '1d') return 300e3;
  return 60e3;
}

/**
 * 캔들 조회. 실시간 실패 시 데모 데이터로 대체하고 notice 를 붙인다.
 * @returns {Promise<{symbol:string, source:string, meta:object, candles:Array, notice?:string}>}
 */
async function getCandles(symbol, interval = '5m', range = '5d') {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) throw new Error('잘못된 심볼입니다.');
  if (!VALID_INTERVALS.includes(interval)) throw new Error('지원하지 않는 봉 주기입니다.');
  if (!VALID_RANGES.includes(range)) throw new Error('지원하지 않는 조회 기간입니다.');

  const key = `c:${sym}:${interval}:${range}:${FORCE_MOCK ? 'm' : 'l'}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let data;
  if (FORCE_MOCK) {
    data = mock.generate(sym, interval, range);
  } else {
    try {
      data = await yahoo.chart(sym, interval, range);
      if (!data.candles.length) throw new Error('empty series');
    } catch (err) {
      data = mock.generate(sym, interval, range);
      data.notice = '실시간 시세를 가져오지 못해 데모 데이터로 대체했습니다. (' + err.message + ')';
    }
  }
  cacheSet(key, data, ttlFor(interval));
  return data;
}

module.exports = { getCandles, VALID_INTERVALS, VALID_RANGES, SYMBOL_RE, FORCE_MOCK };
