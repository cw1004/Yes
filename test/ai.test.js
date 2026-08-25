'use strict';
/** AI 추천 엔진 테스트:  node test/ai.test.js
 *
 * 이 세션에서는 실제 Claude API를 호출할 수 없으므로,
 * 가짜 클라이언트를 주입해 (1) 요청이 규격대로 만들어지는지,
 * (2) 응답 처리·환각 방어·예외 경로가 맞는지를 검증한다.
 */

process.env.AI_LOG_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/ai-test-');

const assert = require('assert');
const recommender = require('../server/ai/recommender.js');
const screener = require('../server/ai/screener.js');

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

/** Claude 응답을 흉내내는 가짜 클라이언트 */
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const res = responses[Math.min(calls.length - 1, responses.length - 1)];
          if (typeof res === 'function') return { finalMessage: async () => res(params) };
          return { finalMessage: async () => res };
        },
      },
    },
  };
}

const usage = { input_tokens: 1000, output_tokens: 500 };

function toolResponse(picks, extra = {}) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'tool_use',
    usage,
    content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/a' }] },
      { type: 'text', text: '조사 완료' },
      {
        type: 'tool_use',
        name: 'submit_recommendations',
        input: { marketContext: '시장은 혼조세입니다.', picks },
        ...extra,
      },
    ],
  };
}

const samplePick = (symbol, name) => ({
  symbol, name,
  thesis: `${name}는 최근 수급이 개선되고 있습니다.`,
  catalysts: ['실적 가이던스 상향', '섹터 자금 유입'],
  risks: ['금리 변동', '차익 실현 물량'],
  confidence: '중간',
  horizon: '2~3일',
  sources: [{ title: '기사', url: 'https://example.com/news', publisher: 'Reuters' }],
});

const US_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY'];

/* --------------------------------------------------------- 도구 스키마 */

test('도구 스키마: strict 이고 모든 객체에 additionalProperties:false + required', () => {
  const tool = recommender.SUBMIT_TOOL;
  assert.strictEqual(tool.strict, true, 'strict tool use');
  const walk = (schema, path) => {
    if (schema.type === 'object') {
      assert.strictEqual(schema.additionalProperties, false, `${path}: additionalProperties`);
      assert.ok(Array.isArray(schema.required) && schema.required.length, `${path}: required`);
      // required 에 적힌 키는 properties 에 실제로 있어야 한다
      for (const key of schema.required) {
        assert.ok(schema.properties[key], `${path}: required '${key}' 가 properties 에 없음`);
      }
      Object.entries(schema.properties).forEach(([k, v]) => walk(v, `${path}.${k}`));
    } else if (schema.type === 'array') {
      walk(schema.items, `${path}[]`);
    }
  };
  walk(tool.input_schema, 'input');
});

test('도구 스키마: confidence/horizon 은 enum 으로 값이 고정된다', () => {
  const item = recommender.SUBMIT_TOOL.input_schema.properties.picks.items;
  assert.deepStrictEqual(item.properties.confidence.enum, ['높음', '중간', '낮음']);
  assert.deepStrictEqual(item.properties.horizon.enum, ['당일', '2~3일', '1~2주']);
});

/* ----------------------------------------------------------- 요청 규격 */

test('요청 규격: 모델·적응형 사고·effort·폴백·웹검색 도구가 규격대로 실린다', async () => {
  const client = fakeClient([toolResponse([samplePick('MSFT', 'Microsoft'), samplePick('NVDA', 'NVIDIA'), samplePick('AMD', 'AMD')])]);
  await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });

  const req = client.calls[0];
  assert.strictEqual(req.model, 'claude-opus-5');
  assert.strictEqual(req.thinking.type, 'adaptive', '적응형 사고');
  assert.strictEqual(req.output_config.effort, 'high');
  assert.ok(!('budget_tokens' in req.thinking), 'budget_tokens 는 Opus 5 에서 400 이므로 없어야 한다');
  assert.ok(!('temperature' in req), 'temperature 는 Opus 5 에서 제거됨');
  assert.deepStrictEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(req.fallbacks, 'default');
  assert.ok(req.max_tokens >= 16000, '충분한 출력 토큰');

  const web = req.tools.find((t) => t.name === 'web_search');
  assert.ok(web, '웹 검색 도구 포함');
  assert.strictEqual(web.type, 'web_search_20260209', '동적 필터링 버전');
  assert.ok(web.max_uses > 0);
  assert.ok(req.tools.some((t) => t.name === 'submit_recommendations'));

  assert.ok(Array.isArray(req.system) && req.system[0].cache_control, '시스템 프롬프트 캐시');
  assert.strictEqual(req.messages[0].role, 'user');
});

test('요청 규격: 프롬프트에 후보 지표와 시각·시장이 담긴다', async () => {
  const client = fakeClient([toolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')])]);
  await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  const prompt = client.calls[0].messages[0].content;
  assert.match(prompt, /미국 주식시장/);
  assert.match(prompt, /후보 종목/);
  assert.match(prompt, /submit_recommendations/);
  assert.match(prompt, /"rsi14"/, '실제 지표 수치가 포함');
});

test('요청 규격: 시스템 프롬프트가 환각·투자권유를 금지한다', () => {
  const sp = recommender.SYSTEM_PROMPT;
  assert.match(sp, /웹 검색/);
  assert.match(sp, /지어내지/);
  assert.match(sp, /후보 목록/);
  assert.match(sp, /투자 권유가 아/);
  assert.match(sp, /리스크/);
});

/* ----------------------------------------------------------- 응답 처리 */

test('응답 처리: 도구 결과에 우리 지표 스냅샷이 결합된다', async () => {
  const client = fakeClient([toolResponse([
    samplePick('MSFT', 'Microsoft'), samplePick('NVDA', 'NVIDIA'), samplePick('AMD', 'AMD'),
  ])]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });

  assert.strictEqual(out.engine, 'ai');
  assert.strictEqual(out.picks.length, 3);
  assert.strictEqual(out.model, 'claude-opus-5');
  assert.ok(out.marketContext.length > 0);
  for (const p of out.picks) {
    assert.ok(p.inCandidates, `${p.symbol} 은 후보 목록에 있어야 한다`);
    assert.ok(p.snapshot, '지표 스냅샷 결합');
    assert.ok(typeof p.snapshot.score === 'number', '점수는 우리 엔진 값');
    assert.ok(p.sources.length >= 1, '출처 포함');
    assert.ok(p.risks.length >= 1, '리스크 포함');
  }
  assert.ok(out.disclaimer.includes('투자 권유가 아'));
  assert.strictEqual(out.usage.input_tokens, 1000);
  assert.ok(out.usage.estimatedCostUsd > 0, '예상 비용 계산');
  assert.strictEqual(out.webSearches, 1, '웹 검색 횟수 집계');
});

test('응답 처리: 3개를 넘겨도 3개로 잘린다', async () => {
  const five = ['MSFT', 'NVDA', 'AMD', 'AAPL', 'TSLA'].map((s) => samplePick(s, s));
  const client = fakeClient([toolResponse(five)]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  assert.strictEqual(out.picks.length, 3);
});

test('환각 방어: 후보에 없던 심볼은 inCandidates=false 로 표시되고 스냅샷이 비었다', async () => {
  const client = fakeClient([toolResponse([
    samplePick('FAKE', '존재하지않는종목'), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'),
  ])]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  const fake = out.picks.find((p) => p.symbol === 'FAKE');
  assert.strictEqual(fake.inCandidates, false);
  assert.strictEqual(fake.snapshot, null);
  assert.strictEqual(out.picks.find((p) => p.symbol === 'MSFT').inCandidates, true);
});

test('응답 처리: pause_turn 이면 대화를 이어서 진행한다', async () => {
  const client = fakeClient([
    { model: 'claude-opus-5', stop_reason: 'pause_turn', usage, content: [{ type: 'text', text: '검색 중' }] },
    toolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]),
  ]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  assert.strictEqual(client.calls.length, 2, '두 번째 호출로 이어짐');
  assert.strictEqual(client.calls[1].messages.length, 2, '이전 응답을 그대로 되돌려줌');
  assert.strictEqual(client.calls[1].messages[1].role, 'assistant');
  assert.strictEqual(out.picks.length, 3);
  assert.strictEqual(out.usage.input_tokens, 2000, '토큰 사용량 누적');
});

test('응답 처리: 도구를 안 부르고 글로만 끝내면 다시 요청한다', async () => {
  const client = fakeClient([
    { model: 'claude-opus-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '제 생각에는...' }] },
    toolResponse([samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'), samplePick('AMD', 'AMD')]),
  ]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  assert.strictEqual(client.calls.length, 2);
  const nudge = client.calls[1].messages[2];
  assert.strictEqual(nudge.role, 'user');
  assert.match(nudge.content, /submit_recommendations/);
  assert.strictEqual(out.picks.length, 3);
});

test('예외 처리: 거절(refusal)은 content 를 읽기 전에 잡아 사유를 알린다', async () => {
  const client = fakeClient([{
    model: 'claude-opus-5',
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: 'cyber' },
    usage,
    content: [],
  }]);
  await assert.rejects(
    () => recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true }),
    /거절|cyber/
  );
});

test('예외 처리: 끝내 도구를 안 부르면 명확한 오류', async () => {
  const client = fakeClient([
    { model: 'claude-opus-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '음...' }] },
  ]);
  await assert.rejects(
    () => recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true }),
    /제출하지 않았습니다/
  );
});

test('상반 감지: 지표가 매도 신호인 종목도 스냅샷 점수를 그대로 보존한다', async () => {
  // 화면은 snapshot.score 로 상반 여부를 경고한다 — 엔진이 점수를 왜곡하지 않아야 한다
  const scan = await screener.screenUS({ symbols: US_SYMBOLS, limit: 10 });
  const worst = scan.candidates[scan.candidates.length - 1];
  const client = fakeClient([toolResponse([
    samplePick(worst.symbol, worst.name), samplePick('MSFT', 'MS'), samplePick('NVDA', 'NV'),
  ])]);
  const out = await recommender.recommend({ market: 'US', symbols: US_SYMBOLS, client, force: true });
  const picked = out.picks.find((p) => p.symbol === worst.symbol);
  assert.ok(picked, '추천에 포함');
  assert.strictEqual(picked.snapshot.score, worst.score, 'AI가 아니라 우리 엔진 점수가 그대로');
  assert.ok(picked.snapshot.plan.side === 'LONG' || picked.snapshot.plan.side === 'SHORT', '플랜 방향 포함');
});

/* ------------------------------------------------------- 키 없는 경로 */

test('키 없음: AI 없이 지표 기반 3종목을 내고 그 사실을 명시한다', async () => {
  const scan = await screener.screenUS({ symbols: US_SYMBOLS, limit: 5 });
  const out = recommender.fallbackPicks(scan, 'US', '당일 단타');
  assert.strictEqual(out.engine, 'rules');
  assert.strictEqual(out.picks.length, 3);
  assert.strictEqual(out.model, null);
  assert.match(out.marketContext, /ANTHROPIC_API_KEY/);
  assert.ok(out.picks.every((p) => p.confidence === '낮음'), 'AI 근거가 없으니 신뢰도 낮음');
  assert.ok(out.picks.every((p) => p.risks.length >= 1));
});

/* ------------------------------------------------------------ 스크리너 */

test('스크리너: 점수 내림차순으로 정렬되고 측정값만 담는다', async () => {
  const scan = await screener.screenUS({ symbols: US_SYMBOLS, limit: 6 });
  assert.ok(scan.candidates.length >= 3);
  for (let i = 1; i < scan.candidates.length; i++) {
    assert.ok(scan.candidates[i - 1].score >= scan.candidates[i].score, '점수 내림차순');
  }
  const c = scan.candidates[0];
  assert.ok(typeof c.technicals.rsi14 === 'number');
  assert.ok(typeof c.price === 'number');
  assert.ok(Array.isArray(c.topReasons));
});

test('스크리너: 한국 종목은 호가단위·본전 호가까지 포함한다', async () => {
  const scan = await screener.screenKR({ codes: ['005930', '000660', '035720'], limit: 3 });
  assert.strictEqual(scan.market, 'KR');
  const c = scan.candidates[0];
  assert.ok(c.technicals.tickSize > 0, '호가단위');
  assert.ok(c.technicals.breakevenTicks >= 1, '본전 호가');
  assert.ok(c.plan && c.plan.stopTicks > 0, '호가 단위 플랜');
});

test('스크리너: 조회에 실패한 종목은 건너뛰고 나머지로 진행한다', async () => {
  const scan = await screener.screenUS({ symbols: ['AAPL', '!!!bad', 'MSFT'], limit: 5 });
  assert.ok(scan.candidates.length >= 2, '유효 종목만 남는다');
  assert.ok(!scan.candidates.some((c) => c.symbol.includes('!')), '잘못된 심볼 제외');
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
