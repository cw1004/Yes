'use strict';
/**
 * 글로벌 금융 뉴스 수집기 (RSS/Atom, 의존성 없음).
 *
 * Claude 는 서버측 웹 검색 도구를 쓸 수 있지만, Llama 같은 다른 모델에는 검색 기능이 없다.
 * 그래서 어떤 모델을 쓰든 같은 정보를 볼 수 있도록 뉴스를 우리가 직접 모아 넘긴다.
 *
 * 수집 대상은 공개 RSS 피드뿐이다. 로그인·유료 담벼락 뒤의 내용은 가져오지 않는다.
 */

const { XMLParserLite, decodeEntities } = require('./rss-parse');

/** 기본 피드 목록. NEWS_FEEDS 환경변수(콤마 구분 URL)로 덮어쓸 수 있다. */
const FEEDS = [
  // 미국·글로벌 시장 전반
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', name: 'CNBC Markets', region: 'US' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', name: 'CNBC Finance', region: 'US' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', name: 'MarketWatch', region: 'US' },
  { url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets', name: 'Nasdaq', region: 'US' },
  { url: 'https://www.investing.com/rss/news_25.rss', name: 'Investing.com', region: 'GLOBAL' },
  { url: 'https://www.investing.com/rss/news_1.rss', name: 'Investing.com 경제', region: 'GLOBAL' },
  { url: 'https://www.ft.com/rss/home', name: 'Financial Times', region: 'GLOBAL' },
  // 한국
  { url: 'https://www.hankyung.com/feed/finance', name: '한국경제', region: 'KR' },
  { url: 'https://rss.mt.co.kr/mt_news_stock.xml', name: '머니투데이 증시', region: 'KR' },
];

/** 종목별 헤드라인 (야후 파이낸스, 키 불필요) */
const symbolFeed = (symbol) =>
  `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;

const UA = 'Mozilla/5.0 (compatible; ScalpDesk/1.0; +news-reader)';
const cache = new Map();
const CACHE_TTL = Number(process.env.NEWS_CACHE_TTL_MS || 300000); // 5분

function configuredFeeds() {
  const raw = process.env.NEWS_FEEDS;
  if (!raw) return FEEDS;
  return raw.split(',').map((u) => u.trim()).filter(Boolean)
    .map((url) => ({ url, name: hostOf(url), region: 'CUSTOM' }));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

async function fetchText(url, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 피드 하나를 읽어 기사 배열로 */
async function fetchFeed(feed) {
  const key = 'f:' + feed.url;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;

  const xml = await fetchText(feed.url);
  const items = XMLParserLite.parseFeed(xml).map((it) => ({
    title: it.title,
    url: it.link,
    publisher: feed.name,
    region: feed.region,
    publishedAt: it.publishedAt,
    summary: it.summary,
  }));
  cache.set(key, { value: items, expires: Date.now() + CACHE_TTL });
  return items;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const v = await fn(items[i]);
        if (v) out.push(v);
      } catch (_) { /* 실패한 피드는 조용히 건너뛴다 */ }
    }
  }));
  return out;
}

/** 제목이 사실상 같은 기사를 하나로 */
function dedupe(articles) {
  const seen = new Map();
  for (const a of articles) {
    if (!a.title || !a.url) continue;
    const key = a.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 60);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev || (a.publishedAt || 0) > (prev.publishedAt || 0)) seen.set(key, a);
  }
  return Array.from(seen.values());
}

/**
 * 시장 전반 + 후보 종목별 뉴스를 모은다.
 * @param {{market:'US'|'KR', symbols?:string[], names?:string[], perSymbol?:number, marketMax?:number}} opts
 */
async function collect(opts = {}) {
  const market = opts.market === 'KR' ? 'KR' : 'US';
  const symbols = (opts.symbols || []).slice(0, 10);
  const started = Date.now();

  const feeds = configuredFeeds().filter((f) =>
    f.region === 'CUSTOM' || f.region === 'GLOBAL' || f.region === market);

  const feedResults = await mapLimit(feeds, 4, async (f) => ({ feed: f, items: await fetchFeed(f) }));
  const marketNews = dedupe(feedResults.flatMap((r) => r.items))
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, opts.marketMax || 25);

  // 종목별 뉴스는 미국 티커에만 붙는다 (야후 헤드라인 피드 기준)
  const perSymbol = {};
  if (market === 'US' && symbols.length) {
    const bySymbol = await mapLimit(symbols, 4, async (symbol) => {
      const items = await fetchFeed({ url: symbolFeed(symbol), name: 'Yahoo Finance', region: 'US' });
      return { symbol, items: dedupe(items).slice(0, opts.perSymbol || 5) };
    });
    for (const r of bySymbol) if (r.items.length) perSymbol[r.symbol] = r.items;
  }

  const failed = feeds.length - feedResults.length;
  return {
    market,
    collectedAt: Date.now(),
    elapsedMs: Date.now() - started,
    feedsTried: feeds.length,
    feedsOk: feedResults.length,
    feedsFailed: failed,
    marketNews,
    perSymbol,
    // 뉴스를 전혀 못 받아온 경우를 호출부가 알 수 있게
    empty: marketNews.length === 0 && Object.keys(perSymbol).length === 0,
  };
}

/** 모델에게 넘길 텍스트로 정리 (토큰 절약을 위해 요약은 잘라 쓴다) */
function toPromptText(news, limit = 30) {
  const lines = [];
  if (news.marketNews.length) {
    lines.push('## 시장 전반 뉴스 헤드라인');
    news.marketNews.slice(0, limit).forEach((a, i) => {
      lines.push(`${i + 1}. [${a.publisher}] ${a.title}${a.publishedAt ? ` (${new Date(a.publishedAt).toISOString().slice(0, 16).replace('T', ' ')}Z)` : ''}`);
      lines.push(`   ${a.url}`);
      if (a.summary) lines.push(`   ${a.summary.slice(0, 200)}`);
    });
  }
  for (const [symbol, items] of Object.entries(news.perSymbol)) {
    lines.push(`\n## ${symbol} 관련 뉴스`);
    items.forEach((a) => {
      lines.push(`- [${a.publisher}] ${a.title}`);
      lines.push(`  ${a.url}`);
    });
  }
  return lines.join('\n');
}

module.exports = { collect, toPromptText, fetchFeed, dedupe, FEEDS, symbolFeed, configuredFeeds };
