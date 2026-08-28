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
    market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a, b],
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
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a, b] });
  const msft = out.picks.find((p) => p.symbol === 'MSFT');
  assert.strictEqual(msft.perProvider.length, 2);
  assert.deepStrictEqual(msft.perProvider.map((x) => x.thesis), ['A 관점', 'B 관점']);
  assert.deepStrictEqual(msft.perProvider.map((x) => x.confidence), ['높음', '낮음']);
});

test('합의: 한 엔진이 실패해도 나머지 결과로 진행하고 실패를 기록한다', async () => {
  const ok = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]);
  const bad = { name: 'llama', label: 'Llama', available: () => true, ready: async () => ({ ok: true }),
    analyze: async () => { throw new Error('연결 실패'); } };
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [ok, bad] });
  assert.strictEqual(out.engine, 'ai');
  assert.strictEqual(out.picks.length, 3);
  assert.strictEqual(out.failures.length, 1);
  assert.match(out.failures[0].error, /연결 실패/);
});

test('합의: 모든 엔진이 실패하면 지표 전용으로 내려가고 사유를 밝힌다', async () => {
  const bad = (n) => ({ name: n, label: n, available: () => true, ready: async () => ({ ok: true }),
    analyze: async () => { throw new Error(n + ' 오류'); } });
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [bad('claude'), bad('llama')] });
  assert.strictEqual(out.engine, 'rules');
  assert.match(out.marketContext, /모든 AI 엔진 호출이 실패/);
  assert.strictEqual(out.failures.length, 2);
  assert.strictEqual(out.picks.length, 3);
});

test('합의: 출처는 두 엔진 것을 합치되 중복 URL 은 제거한다', async () => {
  const same = { title: '같은 기사', url: 'https://example.com/same', publisher: 'Reuters' };
  const a = fakeProvider('claude', 'Claude', [samplePick('MSFT', 'MS', { sources: [same, { title: 'A', url: 'https://a.com' }] })]);
  const b = fakeProvider('llama', 'Llama', [samplePick('MSFT', 'MS', { sources: [same, { title: 'B', url: 'https://b.com' }] })]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a, b] });
  const urls = out.picks[0].sources.map((s) => s.url);
  assert.strictEqual(new Set(urls).size, urls.length, '중복 없음');
  assert.ok(urls.includes('https://a.com') && urls.includes('https://b.com'), '양쪽 출처 병합');
});

test('환각 방어: 후보에 없던 심볼은 아예 결과에서 빠지고, 왜 빠졌는지 남는다', async () => {
  const a = fakeProvider('claude', 'Claude', [samplePick('FAKE', '없는종목'), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV')]);
  const out = await recommender.recommend({
    market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a], _skipBudget: true,
  });
  assert.ok(!out.picks.some((p) => p.symbol === 'FAKE'), '지어낸 종목은 화면까지 오지 않는다');
  const d = (out.dropped || []).find((x) => x.symbol === 'FAKE');
  assert.ok(d, '버린 사실을 숨기지 않는다');
  assert.match(d.why, /후보 목록에 없는/);
  assert.strictEqual(d.provider, 'claude', '어느 엔진이 지어냈는지도 남는다');
  // 남은 추천은 전부 실제 후보 안의 종목이다
  assert.ok(out.picks.every((p) => p.inCandidates && p.snapshot));
});

test('환각 방어: 화면에 쓰이는 가격·점수는 AI 값이 아니라 우리 엔진 값이다', async () => {
  const scan = await scanFixture();
  const target = scan.candidates[0];
  const a = fakeProvider('claude', 'Claude', [
    samplePick(target.symbol, '엉뚱한이름'), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'),
  ]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a] });
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
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, force: true, _skipBudget: true, _providerImpls: [a] });
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

/* ------------------------------------------------ 실시간 단타 스캐너 */

const scanner = require('../server/ai/scanner.js');

/** 스캐너 테스트용 종목 행 */
function row(over = {}) {
  return Object.assign({
    symbol: 'AAPL', name: 'Apple', price: 200, changePercent: 1.0,
    score: 60, label: '매수',
    technicals: { atrPct: 0.8, volumeRatio: 2.0, breakevenTicks: 3 },
    plan: { side: 'long', entry: 200, stop: 198, target: 204, rr: 2.0, targetTicks: 9 },
  }, over);
}

test('스캐너: 적합도는 방향 점수가 아니라 단타 조건으로 매긴다', () => {
  // 방향 점수는 같지만 거래량·변동성이 다르면 적합도가 갈린다
  const good = scanner.fitness(row(), 'US');
  const thin = scanner.fitness(row({
    technicals: { atrPct: 0.05, volumeRatio: 0.2 },
  }), 'US');
  assert.ok(good.fit > thin.fit, `활발한 종목이 더 높아야 함 (${good.fit} vs ${thin.fit})`);
  assert.ok(thin.fit < 45, '거래도 없고 안 움직이면 단타 부적합: ' + thin.fit);
});

test('스캐너: 변동성이 과열이면 오히려 감점한다', () => {
  const sweet = scanner.fitness(row({ technicals: { atrPct: 0.9, volumeRatio: 2.0 } }), 'US');
  const wild = scanner.fitness(row({ technicals: { atrPct: 4.5, volumeRatio: 2.0 } }), 'US');
  assert.ok(sweet.breakdown.volatility > wild.breakdown.volatility,
    `적정 변동성이 과열보다 높아야 함 (${sweet.breakdown.volatility} vs ${wild.breakdown.volatility})`);
});

test('스캐너: 한국 종목은 본전 호가를 넘는 목표라야 가점을 받는다', () => {
  const worth = scanner.fitness(row({
    technicals: { atrPct: 1.0, volumeRatio: 2.0, breakevenTicks: 2 },
    plan: { targetTicks: 10, entry: 74800, stop: 74400, target: 75800 },
  }), 'KR');
  const notWorth = scanner.fitness(row({
    technicals: { atrPct: 1.0, volumeRatio: 2.0, breakevenTicks: 8 },
    plan: { targetTicks: 8, entry: 74800, stop: 74400, target: 75600 },
  }), 'KR');
  assert.ok(worth.breakdown.edge > 0, '본전보다 목표가 크면 가점');
  assert.strictEqual(notWorth.breakdown.edge, 0, '비용을 못 넘으면 가점 0');
});

test('스캐너: 하락 신호는 매도 방향으로 잡되 적합도는 그대로 잰다', () => {
  const f = scanner.fitness(row({ score: -55, label: '매도' }), 'US');
  assert.strictEqual(f.side, 'short');
  assert.ok(f.breakdown.conviction > 0, '방향이 선명하면 아래쪽도 가점');
});

test('스캐너: 직전 스캔 대비 움직임이 있으면 가점된다', () => {
  const hist = [
    { t: 1, score: 10, price: 198 },
    { t: 2, score: 20, price: 199 },
  ];
  const still = scanner.fitness(row({ score: 20, price: 199 }), 'US', hist);
  const moving = scanner.fitness(row({ score: 60, price: 202 }), 'US', hist);
  assert.ok(moving.breakdown.motion > still.breakdown.motion,
    `움직이는 쪽이 높아야 함 (${moving.breakdown.motion} vs ${still.breakdown.motion})`);
});

test('스캐너: 등급은 적합도 구간으로 갈린다', () => {
  assert.strictEqual(scanner.grade(80).grade, 'A');
  assert.strictEqual(scanner.grade(65).grade, 'B');
  assert.strictEqual(scanner.grade(50).grade, 'C');
  assert.strictEqual(scanner.grade(20).grade, 'D');
});

test('스캐너: 미국·한국을 각각 돌리고 적합도 순으로 정렬한다', async () => {
  const sc = new scanner.Scanner();
  try {
    await sc._tick('US');
    const view = sc.marketView('US');
    assert.ok(view.top.length > 0, '후보가 나와야 함');
    for (let i = 1; i < view.top.length; i++) {
      assert.ok(view.top[i - 1].fit >= view.top[i].fit, '적합도 내림차순');
    }
    assert.ok(view.top.every((r) => r.market === 'US' && r.grade), '시장·등급이 붙는다');
  } finally { sc.stop(); }
});

test('스캐너: 두 시장을 섞어 지금 가장 좋은 것만 뽑는다', async () => {
  const sc = new scanner.Scanner();
  try {
    await Promise.all([sc._tick('US'), sc._tick('KR')]);
    const best = sc.best(5);
    assert.ok(best.length > 0);
    assert.ok(best.length <= 5);
    for (let i = 1; i < best.length; i++) assert.ok(best[i - 1].fit >= best[i].fit);
    const markets = new Set(sc.snapshot().US.top.concat(sc.snapshot().KR.top).map((r) => r.market));
    assert.ok(markets.has('US') && markets.has('KR'), '두 시장이 모두 스캔됐다');
  } finally { sc.stop(); }
});

/** 구독을 붙이면 곧바로 첫 스캔이 시작된다 — 그 스캔이 끝날 때까지 기다린다 */
function firstScan(sc, market = 'US') {
  return new Promise((resolve) => {
    const on = (view) => { if (view.market === market) { sc.off('scan', on); resolve(view); } };
    sc.on('scan', on);
  });
}

test('스캐너: 구독자를 붙이면 스캔이 저절로 시작된다', async () => {
  const sc = new scanner.Scanner();
  try {
    const done = firstScan(sc);
    const client = sc.addClient({ write() {} });
    assert.strictEqual(sc.snapshot().clients, 1);
    await done;
    assert.ok(sc.marketView('US').top.length > 0, '구독만으로 결과가 채워진다');
    sc.removeClient(client);
    assert.strictEqual(sc.snapshot().clients, 0);
    assert.ok(sc.marketView('US').top.length > 0, '떠나도 마지막 결과는 남아 있다');
  } finally { sc.stop(); }
});

test('스캐너: 스캔 결과는 구독자에게 그대로 전달된다', async () => {
  const sc = new scanner.Scanner();
  const sent = [];
  try {
    const done = firstScan(sc);
    const client = sc.addClient({ write: (s) => sent.push(s) });
    await done;
    sc.removeClient(client);
    assert.ok(sent.length > 0, '한 건 이상 전송');
    const msg = JSON.parse(sent[sent.length - 1].replace(/^data: /, ''));
    assert.strictEqual(msg.type, 'scan');
    assert.ok(Array.isArray(msg.data.top));
  } finally { sc.stop(); }
});

test('스캐너: 첫 스캔에서는 NEW 를 붙이지 않는다', async () => {
  const sc = new scanner.Scanner();
  try {
    await sc._tick('KR');
    assert.ok(sc.marketView('KR').top.every((r) => !r.isNew), '처음엔 전부 처음 보는 종목이라 NEW 가 의미 없다');
  } finally { sc.stop(); }
});

test('스캐너: 스캔이 실패해도 엔진은 죽지 않고 사유를 남긴다', async () => {
  const sc = new scanner.Scanner();
  const screenerMod = require('../server/ai/screener.js');
  const real = screenerMod.screenUS;
  screenerMod.screenUS = async () => { throw new Error('상방 API 장애'); };
  try {
    await sc._tick('US');
    assert.match(sc.marketView('US').error, /상방 API 장애/);
    // 다음 스캔이 성공하면 오류는 지워진다
    screenerMod.screenUS = real;
    await sc._tick('US');
    assert.strictEqual(sc.marketView('US').error, null);
  } finally {
    screenerMod.screenUS = real;
    sc.stop();
  }
});

/* --------------------------------------------- 검증: 환각·규격 위반 차단 */

const validate = require('../server/ai/validate.js');
const reliability = require('../server/ai/reliability.js');

const CANDS = [
  { symbol: 'AAPL', name: 'Apple', price: 200 },
  { symbol: 'MSFT', name: 'Microsoft', price: 400 },
];

test('검증: 후보에 없는 종목은 떨어뜨리고 이유를 남긴다', () => {
  const r = validate.validatePicks([
    { symbol: 'AAPL', confidence: '높음', horizon: '당일', sources: [] },
    { symbol: 'NVDA', confidence: '높음', horizon: '당일', sources: [] },   // 후보에 없음
  ], { candidates: CANDS, allowedUrls: [], market: 'US' });

  assert.strictEqual(r.picks.length, 1);
  assert.strictEqual(r.picks[0].symbol, 'AAPL');
  assert.strictEqual(r.dropped.length, 1);
  assert.strictEqual(r.dropped[0].symbol, 'NVDA');
  assert.match(r.dropped[0].why, /후보 목록에 없는/);
});

test('검증: 같은 종목을 두 번 추천하면 하나만 남는다', () => {
  const r = validate.validatePicks([
    { symbol: 'AAPL', confidence: '높음', horizon: '당일', sources: [] },
    { symbol: 'aapl', confidence: '중간', horizon: '당일', sources: [] },
  ], { candidates: CANDS, allowedUrls: [], market: 'US' });
  assert.strictEqual(r.picks.length, 1);
  assert.match(r.dropped[0].why, /중복/);
});

test('검증: 열거형 밖의 신뢰도·기간은 가장 보수적인 값으로 내려간다', () => {
  const r = validate.validatePicks([
    { symbol: 'AAPL', confidence: '매우 높음', horizon: '3개월', sources: [] },
  ], { candidates: CANDS, allowedUrls: [], market: 'US' });
  assert.strictEqual(r.picks[0].confidence, '낮음');
  assert.strictEqual(r.picks[0].horizon, '당일');
});

test('검증: 출처는 우리가 준 목록에 있었는지 표시한다 (지우지는 않는다)', () => {
  const given = 'https://example.com/real';
  const r = validate.validatePicks([{
    symbol: 'AAPL', confidence: '높음', horizon: '당일',
    sources: [
      { title: '진짜', url: given },
      { title: '검색으로 찾음', url: 'https://other.com/x' },
      { title: '주소 아님', url: 'javascript:alert(1)' },
    ],
  }], { candidates: CANDS, allowedUrls: [given], market: 'US' });

  const s = r.picks[0].sources;
  assert.strictEqual(s.length, 2, 'http(s) 아닌 주소는 제거');
  assert.strictEqual(s[0].verified, true);
  assert.strictEqual(s[1].verified, false, '검색 결과는 확인 불가로 표시');
  assert.strictEqual(r.picks[0].sourcesVerified, 1);
});

/* ------------------------------------------------------- 기대값 계산 */

test('기대값: 목표가 비용도 못 넘으면 확률과 무관하게 거절한다', () => {
  // 한국: 74,800원에서 목표 74,900원 → 100원 벌자고 왕복 비용이 그보다 크다
  const e = validate.edgeOf({ entry: 74800, stop: 74400, target: 74900, side: 'LONG', market: 'KR' });
  assert.strictEqual(e.verdict, 'reject');
  assert.match(e.reason, /비용.*넘지 못/);
});

test('기대값: 필요 승률은 확률 추정 없이도 계산된다', () => {
  // 위험 2, 순보상 약 3 → 본전 승률 = 2 / (2+3) ≈ 40%
  const e = validate.edgeOf({ entry: 100, stop: 98, target: 103, side: 'LONG', market: 'US' });
  assert.ok(e.breakevenWinRate > 0.39 && e.breakevenWinRate < 0.42, '본전 승률 ' + e.breakevenWinRate);
  assert.strictEqual(e.hitProb, null, '실적을 안 주면 승률은 비어 있다');
  assert.strictEqual(e.verdict, 'hold');
});

test('기대값: 실측 승률이 필요 승률을 넘으면 take, 못 넘으면 hold', () => {
  const plan = { entry: 100, stop: 98, target: 103, side: 'LONG', market: 'US' };
  const good = validate.edgeOf(plan, { prob: 0.55, basis: '실적', measured: true, n: 40 });
  const bad = validate.edgeOf(plan, { prob: 0.30, basis: '실적', measured: true, n: 40 });
  assert.strictEqual(good.verdict, 'take');
  assert.ok(good.evPerShare > 0);
  assert.strictEqual(bad.verdict, 'hold');
  assert.ok(bad.evPerShare < 0);
});

test('기대값: 표본이 부족하면 승률이 높아도 take 로 올리지 않는다', () => {
  const e = validate.edgeOf(
    { entry: 100, stop: 98, target: 103, side: 'LONG', market: 'US' },
    { prob: 0.9, basis: '표본 부족', measured: false, n: 3 }
  );
  assert.strictEqual(e.verdict, 'hold');
  assert.match(e.reason, /근거가 약해/);
});

test('기대값: 방향과 앞뒤가 안 맞는 계획은 거절한다', () => {
  // 매수인데 손절이 진입보다 위
  const e = validate.edgeOf({ entry: 100, stop: 102, target: 105, side: 'LONG', market: 'US' });
  assert.strictEqual(e.verdict, 'reject');
  assert.match(e.reason, /방향과 맞지 않/);
});

test('기대값: 매도(숏)도 같은 규칙으로 계산된다', () => {
  const e = validate.edgeOf(
    { entry: 100, stop: 102, target: 96, side: 'SHORT', market: 'US' },
    { prob: 0.6, basis: '실적', measured: true, n: 40 }
  );
  assert.strictEqual(e.verdict, 'take');
  assert.strictEqual(e.side, 'SHORT');
});

/* ------------------------------------------------- 신뢰성: 재시도·차단 */

test('신뢰성: 네트워크 오류는 재시도하고, 모델 거절은 재시도하지 않는다', () => {
  assert.strictEqual(reliability.isTransient(new Error('fetch failed')), true);
  assert.strictEqual(reliability.isTransient(Object.assign(new Error('busy'), { status: 429 })), true);
  assert.strictEqual(reliability.isTransient(Object.assign(new Error('nope'), { status: 500 })), true);
  assert.strictEqual(reliability.isTransient(new Error('모델이 요청을 거절했습니다 (policy).')), false);
  assert.strictEqual(reliability.isTransient(Object.assign(new Error('bad'), { status: 400 })), false);
});

test('신뢰성: 일시적 오류는 다시 걸어 성공하면 그대로 통과시킨다', async () => {
  reliability.reset();
  let calls = 0;
  const p = {
    name: 'test', label: '테스트',
    analyze: async () => {
      calls++;
      if (calls === 1) throw new Error('fetch failed');
      return { picks: [], marketContext: '' };
    },
  };
  const out = await reliability.guardedAnalyze(p, {});
  assert.strictEqual(calls, 2);
  assert.strictEqual(out.attempts, 2);
  reliability.reset();
});

test('신뢰성: 거절은 한 번만 부르고 끝낸다 (요금 낭비 방지)', async () => {
  reliability.reset();
  let calls = 0;
  const p = {
    name: 'test2', label: '테스트',
    analyze: async () => { calls++; throw new Error('모델이 요청을 거절했습니다.'); },
  };
  await assert.rejects(() => reliability.guardedAnalyze(p, {}));
  assert.strictEqual(calls, 1, '거절에는 재시도하지 않는다');
  reliability.reset();
});

test('신뢰성: 응답이 없으면 시간 제한에 걸린다', async () => {
  reliability.reset();
  process.env.AI_TIMEOUT_MS = '50';
  delete require.cache[require.resolve('../server/ai/reliability.js')];
  const R = require('../server/ai/reliability.js');
  const p = { name: 'slow', label: '느림', analyze: () => new Promise(() => {}) };
  await assert.rejects(() => R.guardedAnalyze(p, {}), /시간이 초과/);
  delete process.env.AI_TIMEOUT_MS;
  delete require.cache[require.resolve('../server/ai/reliability.js')];
});

test('신뢰성: 연속 실패하면 잠시 호출을 끊는다 (서킷 브레이커)', async () => {
  reliability.reset();
  let calls = 0;
  const p = {
    name: 'dead', label: '죽음',
    analyze: async () => { calls++; throw new Error('그냥 실패'); },
  };
  for (let i = 0; i < reliability.BREAKER_THRESHOLD; i++) {
    await assert.rejects(() => reliability.guardedAnalyze(p, {}));
  }
  const before = calls;
  await assert.rejects(() => reliability.guardedAnalyze(p, {}), /호출을 멈춘 상태/);
  assert.strictEqual(calls, before, '차단된 동안에는 아예 부르지 않는다');
  assert.strictEqual(reliability.status().dead.open, true);
  reliability.reset();
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
