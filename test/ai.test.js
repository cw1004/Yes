'use strict';
/** AI 추천 엔진 테스트:  node test/ai.test.js
 *
 * 이 환경에서는 Claude/Llama/뉴스 피드에 실제로 접속할 수 없으므로,
 * 가짜 클라이언트와 가짜 fetch 를 주입해
 *   (1) 요청이 각 공급자 규격대로 만들어지는지
 *   (2) 응답 처리·합의 계산·환각 방어·예외 경로가 맞는지
 * 를 검증한다.
 */

const os = require('os');
const fs = require('fs');
process.env.AI_LOG_DIR = fs.mkdtempSync(os.tmpdir() + '/ai-test-');
process.env.NEWS_ENABLED = '0';   // 테스트에서는 뉴스 수집을 끄고 필요한 곳에만 주입

const assert = require('assert');
const S = require('../server/ai/providers/schema.js');
const claude = require('../server/ai/providers/claude.js');
const llama = require('../server/ai/providers/llama.js');
const recommender = require('../server/ai/recommender.js');
const screener = require('../server/ai/screener.js');
const tracker = require('../server/ai/tracker.js');
const news = require('../server/ai/news.js');
const { parseFeed } = require('../server/ai/rss-parse.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const US_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY'];
const usage = { input_tokens: 1000, output_tokens: 500 };

const samplePick = (symbol, name, extra = {}) => ({
  symbol, name,
  thesis: `${name}는 최근 수급이 개선되고 있습니다.`,
  catalysts: ['실적 가이던스 상향', '섹터 자금 유입'],
  risks: ['금리 변동', '차익 실현 물량'],
  confidence: '중간',
  horizon: '2~3일',
  sources: [{ title: '기사', url: `https://example.com/${symbol}`, publisher: 'Reuters' }],
  ...extra,
});

/** Anthropic SDK 를 흉내내는 가짜 클라이언트 */
function fakeAnthropic(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const res = responses[Math.min(calls.length - 1, responses.length - 1)];
          return { finalMessage: async () => res };
        },
      },
    },
  };
}

function claudeToolResponse(picks) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'tool_use',
    usage,
    content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x' }] },
      { type: 'tool_use', name: S.TOOL_NAME, input: { marketContext: '혼조세입니다.', picks } },
    ],
  };
}

/** OpenAI 호환 서버를 흉내내는 가짜 fetch */
function fakeFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), init, body });
    return handler({ url: String(url), init, body });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(obj),
});

function llamaToolResponse(picks) {
  return jsonResponse({
    model: 'llama3.1',
    usage: { prompt_tokens: 800, completion_tokens: 400 },
    choices: [{
      message: {
        tool_calls: [{
          function: { name: S.TOOL_NAME, arguments: JSON.stringify({ marketContext: '요약', picks }) },
        }],
      },
    }],
  });
}

async function scanFixture() {
  return screener.screenUS({ symbols: US_SYMBOLS, limit: 6 });
}

/* ------------------------------------------------------------ 공유 스키마 */

test('스키마: strict 이고 모든 객체에 additionalProperties:false + required', () => {
  const walk = (schema, path) => {
    if (schema.type === 'object') {
      assert.strictEqual(schema.additionalProperties, false, `${path}: additionalProperties`);
      assert.ok(Array.isArray(schema.required) && schema.required.length, `${path}: required`);
      for (const key of schema.required) assert.ok(schema.properties[key], `${path}: required '${key}' 누락`);
      Object.entries(schema.properties).forEach(([k, v]) => walk(v, `${path}.${k}`));
    } else if (schema.type === 'array') walk(schema.items, `${path}[]`);
  };
  walk(S.INPUT_SCHEMA, 'input');
  assert.deepStrictEqual(S.INPUT_SCHEMA.properties.picks.items.properties.confidence.enum, ['높음', '중간', '낮음']);
});

test('스키마: 시스템 프롬프트가 환각·투자권유를 금지하고 출처를 요구한다', () => {
  assert.match(S.SYSTEM_PROMPT, /지어내지/);
  assert.match(S.SYSTEM_PROMPT, /후보 목록/);
  assert.match(S.SYSTEM_PROMPT, /출처 URL/);
  assert.match(S.SYSTEM_PROMPT, /투자 권유가 아/);
});

test('스키마: 검색 가능 여부에 따라 지시문이 달라진다', async () => {
  const scan = await scanFixture();
  const base = { market: 'US', horizon: '당일', risk: '중립', scan, newsText: '## 뉴스\n- 헤드라인' };
  const withSearch = S.buildUserPrompt({ ...base, canSearch: true });
  const noSearch = S.buildUserPrompt({ ...base, canSearch: false });
  assert.match(withSearch, /웹 검색으로/);
  assert.match(noSearch, /웹 검색 기능이 없으므로/);
  assert.match(noSearch, /수집된 뉴스/);
  assert.match(withSearch, /"rsi14"/, '지표 수치 포함');
});

test('스키마: 뉴스가 없으면 그 사실을 프롬프트에 명시한다', async () => {
  const prompt = S.buildUserPrompt({
    market: 'US', horizon: '당일', risk: '중립', scan: await scanFixture(), newsText: '', canSearch: false,
  });
  assert.match(prompt, /뉴스 수집에 실패/);
});

/* -------------------------------------------------------- Claude 프로바이더 */

test('Claude: 모델·적응형 사고·effort·폴백·웹검색 도구가 규격대로 실린다', async () => {
  const client = fakeAnthropic([claudeToolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')])]);
  const scan = await scanFixture();
  await claude.analyze({ scan, newsText: '', market: 'US', horizon: '당일', risk: '중립', client });

  const req = client.calls[0];
  assert.strictEqual(req.model, 'claude-opus-5');
  assert.strictEqual(req.thinking.type, 'adaptive');
  assert.ok(!('budget_tokens' in req.thinking), 'budget_tokens 는 Opus 5 에서 400');
  assert.ok(!('temperature' in req), 'temperature 는 Opus 5 에서 제거됨');
  assert.strictEqual(req.output_config.effort, 'high');
  assert.deepStrictEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(req.fallbacks, 'default');
  const web = req.tools.find((t) => t.name === 'web_search');
  assert.strictEqual(web.type, 'web_search_20260209');
  assert.strictEqual(req.tools.find((t) => t.name === S.TOOL_NAME).strict, true);
  assert.ok(req.system[0].cache_control, '시스템 프롬프트 캐시');
});

test('Claude: pause_turn 이면 대화를 이어받고 사용량을 누적한다', async () => {
  const client = fakeAnthropic([
    { model: 'claude-opus-5', stop_reason: 'pause_turn', usage, content: [{ type: 'text', text: '검색 중' }] },
    claudeToolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]),
  ]);
  const out = await claude.analyze({ scan: await scanFixture(), newsText: '', market: 'US', horizon: '당일', risk: '중립', client });
  assert.strictEqual(client.calls.length, 2);
  assert.strictEqual(client.calls[1].messages[1].role, 'assistant');
  assert.strictEqual(out.usage.input_tokens, 2000);
  assert.ok(out.usage.estimatedCostUsd > 0);
});

test('Claude: 도구를 안 부르면 다시 요청한다', async () => {
  const client = fakeAnthropic([
    { model: 'claude-opus-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '음...' }] },
    claudeToolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]),
  ]);
  await claude.analyze({ scan: await scanFixture(), newsText: '', market: 'US', horizon: '당일', risk: '중립', client });
  assert.match(client.calls[1].messages[2].content, new RegExp(S.TOOL_NAME));
});

test('Claude: 거절(refusal)은 content 를 읽기 전에 잡는다', async () => {
  const client = fakeAnthropic([{
    model: 'claude-opus-5', stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'cyber' }, usage, content: [],
  }]);
  const scan = await scanFixture();
  await assert.rejects(
    () => claude.analyze({ scan, newsText: '', market: 'US', horizon: '당일', risk: '중립', client }),
    /거절|cyber/
  );
});

/* --------------------------------------------------------- Llama 프로바이더 */

test('Llama: OpenAI 호환 규격으로 함수 호출을 강제한다', async () => {
  const stub = fakeFetch(() => llamaToolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]));
  try {
    const out = await llama.analyze({ scan: await scanFixture(), newsText: '## 뉴스', market: 'US', horizon: '당일', risk: '중립' });
    const call = stub.calls[0];
    assert.match(call.url, /\/chat\/completions$/);
    assert.strictEqual(call.body.tools[0].type, 'function');
    assert.strictEqual(call.body.tools[0].function.name, S.TOOL_NAME);
    assert.strictEqual(call.body.tool_choice.function.name, S.TOOL_NAME, '도구 호출 강제');
    assert.strictEqual(call.body.messages[0].role, 'system');
    assert.match(call.body.messages[1].content, /웹 검색 기능이 없으므로/, '검색 불가 모델용 지시');
    assert.strictEqual(out.provider, 'llama');
    assert.strictEqual(out.picks.length, 3);
    assert.strictEqual(out.webSearches, 0);
    assert.strictEqual(out.usage.estimatedCostUsd, null, '요금 체계가 서비스마다 달라 추정하지 않는다');
  } finally { stub.restore(); }
});

test('Llama: 함수 호출을 지원하지 않고 본문에 JSON 을 담아 줘도 처리한다', async () => {
  const payload = { marketContext: 'ctx', picks: [samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')] };
  const stub = fakeFetch(() => jsonResponse({
    model: 'llama3.1',
    choices: [{ message: { content: '결과입니다:\n```json\n' + JSON.stringify(payload) + '\n```' } }],
  }));
  try {
    const out = await llama.analyze({ scan: await scanFixture(), newsText: '', market: 'US', horizon: '당일', risk: '중립' });
    assert.strictEqual(out.picks.length, 3);
  } finally { stub.restore(); }
});

test('Llama: 엔드포인트 오류는 상태코드와 본문을 담아 알린다', async () => {
  const scan = await scanFixture();
  const stub = fakeFetch(() => ({ ok: false, status: 404, text: async () => 'model not found' }));
  try {
    await assert.rejects(
      () => llama.analyze({ scan, newsText: '', market: 'US', horizon: '당일', risk: '중립' }),
      /404|model not found/
    );
  } finally { stub.restore(); }
});

test('Llama: 로컬 주소는 키 없이 허용, 원격 주소는 키가 있어야 한다', () => {
  const saved = { url: process.env.LLAMA_BASE_URL, key: process.env.LLAMA_API_KEY };
  try {
    // available() 은 모듈 로드시 읽은 상수를 쓰므로 순수 함수로 규칙만 검증한다
    const localRule = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i;
    assert.ok(localRule.test('http://localhost:11434/v1'));
    assert.ok(localRule.test('http://127.0.0.1:8080/v1'));
    assert.ok(!localRule.test('https://api.llama.com/compat/v1'));
    assert.strictEqual(llama.available(), true, '기본 설정(로컬)에서는 사용 가능으로 본다');
  } finally {
    process.env.LLAMA_BASE_URL = saved.url;
    process.env.LLAMA_API_KEY = saved.key;
  }
});

/* ------------------------------------------------------------- 합의 계산 */

function fakeProvider(name, label, picks, extra = {}) {
  return {
    name, label,
    available: () => true,
    ready: async () => ({ ok: true }),
    analyze: async () => ({
      provider: name, label, model: name + '-model',
      marketContext: `${label} 관점의 시장 요약`,
      picks, webSearches: extra.webSearches || 0,
      usage: { input_tokens: 100, output_tokens: 50, estimatedCostUsd: extra.cost || 0 },
    }),
  };
}

test('합의: 두 엔진이 겹쳐 고른 종목이 앞으로 온다', async () => {
  const a = fakeProvider('claude', 'Claude', [samplePick('AMD', 'AMD'), samplePick('MSFT', 'MS'), samplePick('SPY', 'SPY')]);
  const b = fakeProvider('llama', 'Llama', [samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('TSLA', 'TSLA')]);
  const out = await recommender.recommend({
    market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a, b],
  });
  assert.strictEqual(out.picks[0].symbol, 'MSFT', '양쪽이 고른 종목이 1위');
  assert.strictEqual(out.picks[0].consensus.votes, 2);
  assert.strictEqual(out.picks[0].consensus.agreed, true);
  assert.deepStrictEqual(out.picks[0].consensus.providers.sort(), ['claude', 'llama']);
  assert.strictEqual(out.picks.length, 3);
  const solo = out.picks.slice(1);
  solo.forEach((p) => assert.strictEqual(p.consensus.agreed, false, '한 엔진만 고른 종목은 합의 아님'));
  assert.strictEqual(out.engines.length, 2, '엔진별 결과 보존');
});

test('합의: 엔진별 서술을 나란히 보관해 의견 차이를 볼 수 있다', async () => {
  const a = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS', { thesis: 'A 관점', confidence: '높음' })]);
  const b = fakeProvider('llama', 'Llama', [samplePick('MSFT', 'MS', { thesis: 'B 관점', confidence: '낮음' })]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a, b] });
  const msft = out.picks.find((p) => p.symbol === 'MSFT');
  assert.strictEqual(msft.perProvider.length, 2);
  assert.deepStrictEqual(msft.perProvider.map((x) => x.thesis), ['A 관점', 'B 관점']);
  assert.deepStrictEqual(msft.perProvider.map((x) => x.confidence), ['높음', '낮음']);
});

test('합의: 한 엔진이 실패해도 나머지 결과로 진행하고 실패를 기록한다', async () => {
  const ok = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]);
  const bad = { name: 'llama', label: 'Llama', available: () => true, ready: async () => ({ ok: true }),
    analyze: async () => { throw new Error('연결 실패'); } };
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [ok, bad] });
  assert.strictEqual(out.engine, 'ai');
  assert.strictEqual(out.picks.length, 3);
  assert.strictEqual(out.failures.length, 1);
  assert.match(out.failures[0].error, /연결 실패/);
});

test('합의: 모든 엔진이 실패하면 지표 전용으로 내려가고 사유를 밝힌다', async () => {
  const bad = (n) => ({ name: n, label: n, available: () => true, ready: async () => ({ ok: true }),
    analyze: async () => { throw new Error(n + ' 오류'); } });
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [bad('claude'), bad('llama')] });
  assert.strictEqual(out.engine, 'rules');
  assert.match(out.marketContext, /모든 AI 엔진 호출이 실패/);
  assert.strictEqual(out.failures.length, 2);
  assert.strictEqual(out.picks.length, 3);
});

test('합의: 출처는 두 엔진 것을 합치되 중복 URL 은 제거한다', async () => {
  const same = { title: '같은 기사', url: 'https://example.com/same', publisher: 'Reuters' };
  const a = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS', { sources: [same, { title: 'A', url: 'https://a.com' }] })]);
  const b = fakeProvider('llama', 'Llama', [samplePick('MSFT', 'MS', { sources: [same, { title: 'B', url: 'https://b.com' }] })]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a, b] });
  const urls = out.picks[0].sources.map((s) => s.url);
  assert.strictEqual(new Set(urls).size, urls.length, '중복 없음');
  assert.ok(urls.includes('https://a.com') && urls.includes('https://b.com'), '양쪽 출처 병합');
});

test('환각 방어: 후보에 없던 심볼은 inCandidates=false 이고 스냅샷이 비어 있다', async () => {
  const a = fakeProvider('claude', 'Claude', [samplePick('FAKE', '없는종목'), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV')]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a] });
  const fake = out.picks.find((p) => p.symbol === 'FAKE');
  assert.strictEqual(fake.inCandidates, false);
  assert.strictEqual(fake.snapshot, null);
});

test('환각 방어: 화면에 쓰이는 가격·점수는 AI 값이 아니라 우리 엔진 값이다', async () => {
  const scan = await scanFixture();
  const target = scan.candidates[0];
  const a = fakeProvider('claude', 'Claude', [
    samplePick(target.symbol, '엉뚱한이름'), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'),
  ]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a] });
  const p = out.picks.find((x) => x.symbol === target.symbol);
  assert.strictEqual(p.snapshot.score, target.score);
  assert.strictEqual(p.snapshot.price, target.price);
});

/* ---------------------------------------------------------------- 뉴스 */

test('뉴스: RSS/Atom 을 파싱하고 CDATA·엔티티·guid 링크를 처리한다', () => {
  const rss = `<rss><channel>
    <item><title><![CDATA[Fed holds rates & signals patience]]></title><link>https://a.com/1</link>
      <pubDate>Mon, 25 Aug 2026 12:30:00 GMT</pubDate><description>&lt;p&gt;Markets rallied&lt;/p&gt;</description></item>
    <item><title>Guid link</title><guid isPermaLink="true">https://a.com/2</guid></item>
    <item><title>링크 없음</title></item>
  </channel></rss>`;
  const items = parseFeed(rss);
  assert.strictEqual(items.length, 2, '링크 없는 기사는 버린다');
  assert.strictEqual(items[0].title, 'Fed holds rates & signals patience');
  assert.strictEqual(items[0].summary, 'Markets rallied', '인코딩된 마크업 제거');
  assert.ok(items[0].publishedAt > 0);
  assert.strictEqual(items[1].link, 'https://a.com/2');

  const atom = `<feed><entry><title>Atom</title><link rel="alternate" href="https://b.com/1"/><updated>2026-08-25T09:00:00Z</updated></entry></feed>`;
  assert.strictEqual(parseFeed(atom)[0].link, 'https://b.com/1');
});

test('뉴스: 제목이 사실상 같은 기사는 하나로 합친다', () => {
  const merged = news.dedupe([
    { title: 'Fed Holds Rates!', url: 'https://a.com/1', publishedAt: 1000 },
    { title: 'fed holds rates', url: 'https://b.com/2', publishedAt: 2000 },
    { title: 'Nvidia beats', url: 'https://c.com/3', publishedAt: 1500 },
  ]);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged.find((m) => /fed/i.test(m.title)).publishedAt, 2000, '최신 것을 남긴다');
});

test('뉴스: 일부 피드가 죽어도 나머지로 진행한다', async () => {
  const stub = fakeFetch(async ({ url }) => {
    if (url.includes('cnbc')) throw new Error('네트워크 오류');
    return { ok: true, status: 200, text: async () => `<rss><channel><item><title>기사 ${url.slice(-6)}</title><link>${url}#a</link></item></channel></rss>` };
  });
  try {
    const collected = await news.collect({ market: 'US', symbols: ['AAPL'] });
    assert.ok(collected.feedsOk > 0, '살아 있는 피드는 수집');
    assert.ok(collected.feedsFailed > 0, '죽은 피드는 실패로 집계');
    assert.ok(collected.marketNews.length > 0);
    assert.strictEqual(collected.empty, false);
    const text = news.toPromptText(collected);
    assert.match(text, /시장 전반 뉴스 헤드라인/);
  } finally { stub.restore(); }
});

test('뉴스: 전부 실패하면 empty 로 표시해 호출부가 알 수 있다', async () => {
  // 앞선 테스트가 캐시해 둔 피드를 피하려고 전용 주소를 쓴다 (성공한 응답만 캐시된다)
  const saved = process.env.NEWS_FEEDS;
  process.env.NEWS_FEEDS = 'https://blocked.example.com/feed-' + Date.now();
  const stub = fakeFetch(async () => { throw new Error('차단'); });
  try {
    const collected = await news.collect({ market: 'KR' });
    assert.strictEqual(collected.empty, true, '수집 결과 없음');
    assert.strictEqual(collected.feedsOk, 0);
    assert.ok(collected.feedsFailed > 0);
    assert.strictEqual(news.toPromptText(collected), '', '프롬프트에 넣을 내용도 없다');
  } finally {
    stub.restore();
    if (saved === undefined) delete process.env.NEWS_FEEDS; else process.env.NEWS_FEEDS = saved;
  }
});

test('뉴스: NEWS_FEEDS 환경변수로 피드 목록을 바꿀 수 있다', () => {
  const saved = process.env.NEWS_FEEDS;
  try {
    process.env.NEWS_FEEDS = 'https://a.com/rss, https://b.com/atom';
    const feeds = news.configuredFeeds();
    assert.strictEqual(feeds.length, 2);
    assert.strictEqual(feeds[0].name, 'a.com', '호스트명을 매체명으로');
    assert.strictEqual(feeds[0].region, 'CUSTOM');
  } finally {
    if (saved === undefined) delete process.env.NEWS_FEEDS; else process.env.NEWS_FEEDS = saved;
  }
});

/* ---------------------------------------------------------------- 성과 */

test('성과: 목표·손절·기간만료를 구분해 채점한다', async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + '/tk-');
  const saved = process.env.AI_LOG_DIR;
  process.env.AI_LOG_DIR = dir;
  delete require.cache[require.resolve('../server/ai/tracker.js')];
  const tk = require('../server/ai/tracker.js');
  try {
    const t0 = Date.now() - 100 * 3600e3;
    tk.record({
      generatedAt: t0, market: 'US', engine: 'ai',
      picks: [
        { symbol: 'WIN', name: 'W', confidence: '높음', horizon: '2~3일', consensus: { providers: ['claude', 'llama'] },
          snapshot: { price: 100, score: 40, plan: { side: 'LONG', stop: 98, target: 104 } } },
        { symbol: 'LOSE', name: 'L', confidence: '중간', horizon: '당일', consensus: { providers: ['llama'] },
          snapshot: { price: 200, score: 20, plan: { side: 'LONG', stop: 196, target: 208 } } },
        { symbol: 'FLAT', name: 'F', confidence: '낮음', horizon: '1~2주', consensus: { providers: ['claude'] },
          snapshot: { price: 50, score: 10, plan: { side: 'LONG', stop: 47, target: 55 } } },
      ],
    });
    const prices = { WIN: 105, LOSE: 195, FLAT: 50.5 };
    await tk.scoreAll({ getPrice: async (m, s) => prices[s] });
    const sum = tk.summary();
    assert.strictEqual(sum.byOutcome.target, 1, '목표 도달');
    assert.strictEqual(sum.byOutcome.stop, 1, '손절');
    assert.strictEqual(sum.open, 1, '1~2주짜리는 아직 열려 있다');
    assert.strictEqual(sum.overall.n, 2);
    assert.strictEqual(sum.overall.winRate, 50);
    assert.ok(sum.byProvider.claude && sum.byProvider.llama, '엔진별 성적 분리');
    assert.match(sum.note, /표본이/, '표본이 적으면 경고');
  } finally {
    process.env.AI_LOG_DIR = saved;
    delete require.cache[require.resolve('../server/ai/tracker.js')];
  }
});

test('성과: 숏 추천은 하락했을 때 수익으로 계산한다', async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + '/tk2-');
  const saved = process.env.AI_LOG_DIR;
  process.env.AI_LOG_DIR = dir;
  delete require.cache[require.resolve('../server/ai/tracker.js')];
  const tk = require('../server/ai/tracker.js');
  try {
    tk.record({
      generatedAt: Date.now() - 10 * 3600e3, market: 'US', engine: 'ai',
      picks: [{ symbol: 'SHRT', name: 'S', confidence: '중간', horizon: '당일', consensus: { providers: ['claude'] },
        snapshot: { price: 100, score: -50, plan: { side: 'SHORT', stop: 103, target: 95 } } }],
    });
    await tk.scoreAll({ getPrice: async () => 94 });
    const sum = tk.summary();
    assert.strictEqual(sum.overall.n, 1);
    assert.ok(sum.overall.avgPnlPct > 0, `숏 하락은 수익 (${sum.overall.avgPnlPct}%)`);
    assert.strictEqual(sum.byOutcome.target, 1);
  } finally {
    process.env.AI_LOG_DIR = saved;
    delete require.cache[require.resolve('../server/ai/tracker.js')];
  }
});

test('성과: 추천이 나오면 자동으로 기록된다', async () => {
  const a = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _providerImpls: [a] });
  assert.strictEqual(out.tracked, 3, '3건 기록');
});

/* ------------------------------------------------------------- 스크리너 */

test('스크리너: 점수 내림차순 정렬 + 측정값만 담는다', async () => {
  const scan = await scanFixture();
  for (let i = 1; i < scan.candidates.length; i++) {
    assert.ok(scan.candidates[i - 1].score >= scan.candidates[i].score);
  }
  const c = scan.candidates[0];
  assert.ok(typeof c.technicals.rsi14 === 'number');
  assert.ok(c.plan.side === 'LONG' || c.plan.side === 'SHORT');
});

test('스크리너: 한국 종목은 호가단위·본전 호가까지 포함한다', async () => {
  const scan = await screener.screenKR({ codes: ['005930', '000660', '035720'], limit: 3 });
  const c = scan.candidates[0];
  assert.ok(c.technicals.tickSize > 0);
  assert.ok(c.technicals.breakevenTicks >= 1);
});

test('스크리너: 조회 실패 종목은 건너뛴다', async () => {
  const scan = await screener.screenUS({ symbols: ['AAPL', '!!!bad', 'MSFT'], limit: 5 });
  assert.ok(scan.candidates.length >= 2);
  assert.ok(!scan.candidates.some((c) => c.symbol.includes('!')));
});

/* ------------------------------------------------------------------ 실행 */

(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log('  ✓ ' + name);
    } catch (err) {
      console.error('  ✗ ' + name + '\n    ' + err.message);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${cases.length} 통과`);
  process.exit(process.exitCode || 0);
})();
