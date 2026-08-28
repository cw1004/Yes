'use strict';
/**
 * 두 모델이 똑같은 형식으로 답하도록 공유하는 출력 스키마와 프롬프트.
 * Claude 는 이 스키마를 tool(strict)로, Llama 는 OpenAI 호환 function 으로 받는다.
 */

const TOOL_NAME = 'submit_recommendations';

const TOOL_DESCRIPTION =
  '조사를 마친 뒤 최종 추천 종목을 제출한다. **최대 3개**이며, 기준을 넘는 종목이 없으면 ' +
  '0개를 제출해도 된다(그 이유를 passReason 에 적는다). 억지로 채우지 않는다. ' +
  '각 종목은 후보 목록에 있던 심볼이어야 하며, 확인한 출처를 1개 이상 포함해야 한다.';

const INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['marketContext', 'picks', 'passReason'],
  properties: {
    marketContext: {
      type: 'string',
      description: '오늘 시장 전반의 상황과 분위기를 2~4문장으로. 제공된 뉴스나 검색으로 확인한 내용만.',
    },
    passReason: {
      type: 'string',
      description:
        '3개를 채우지 않았다면 그 이유를 한두 문장으로. 3개를 모두 골랐으면 빈 문자열.' +
        ' 예: "오늘은 지수 전체가 이벤트 대기 중이고 후보 중 뉴스로 뒷받침되는 종목이 없습니다."',
    },
    picks: {
      type: 'array',
      maxItems: 3,
      description:
        '추천 종목 최대 3개. **기준을 넘는 종목만** 담는다. 하나도 없으면 빈 배열([])을 제출하고 passReason 에 이유를 적는다.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'name', 'thesis', 'catalysts', 'risks', 'confidence', 'horizon', 'expectedMovePct', 'invalidation', 'sources'],
        properties: {
          symbol: { type: 'string', description: '후보 목록에 있던 심볼/종목코드 그대로.' },
          name: { type: 'string', description: '종목명.' },
          thesis: { type: 'string', description: '왜 지금 이 종목인지 3~5문장. 기술적 지표와 뉴스 근거를 함께.' },
          catalysts: { type: 'array', description: '상승 촉매 2~4개. 각 항목은 한 문장.', items: { type: 'string' } },
          risks: { type: 'array', description: '이 판단이 틀릴 수 있는 리스크 2~3개. 각 항목은 한 문장.', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['높음', '중간', '낮음'], description: '근거의 확실성. 근거가 약하면 낮음.' },
          horizon: { type: 'string', enum: ['당일', '2~3일', '1~2주'], description: '이 아이디어가 유효한 기간.' },
          expectedMovePct: {
            type: 'number',
            description:
              '이 기간 안에 예상하는 가격 변동폭(%). 상승이면 양수, 하락이면 음수. ' +
              '근거 없이 크게 부르지 말 것 — 이 값은 기대값 계산에 쓰이고 나중에 실제 결과와 대조됩니다.',
          },
          invalidation: {
            type: 'string',
            description:
              '이 판단이 틀렸다고 인정할 구체적 조건 한 문장. 관찰 가능한 것으로. ' +
              '예: "지지선 182달러가 종가 기준으로 깨지면" / "실적 발표에서 가이던스가 하향되면".',
          },
          sources: {
            type: 'array',
            description: '근거로 삼은 출처. 최소 1개. 제공된 뉴스 목록이나 검색 결과에 실제로 있던 URL만.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                publisher: { type: 'string', description: '매체명. 모르면 빈 문자열.' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `당신은 한국어로 보고하는 주식 리서치 애널리스트입니다.
사용자는 이미 자체 기술적 지표 엔진으로 후보 종목을 추려 두었고, 당신의 역할은
**시장 정보를 확인해** 그 후보 중에서 지금 정말 매력적인 종목만 골라 내는 것입니다.

**가장 중요한 원칙: 억지로 채우지 않습니다.**
좋은 기회가 없는 날이 좋은 기회가 있는 날보다 많습니다. 기준을 넘는 종목이 1개면 1개만,
하나도 없으면 0개를 제출하고 passReason 에 왜 없는지 적으세요.
"아무거나 3개"는 사용자의 돈을 잃게 만듭니다. **거래하지 않는 것도 하나의 판단입니다.**

반드시 지킬 것:
1. 제공된 뉴스 목록(또는 웹 검색 결과)에서 실제로 확인한 내용만 서술합니다.
   기억이나 추측으로 뉴스·실적·목표주가를 지어내지 마세요.
   확인되지 않으면 "확인되지 않음"이라고 쓰거나 그 근거를 아예 빼십시오.
2. 종목은 **반드시 제공된 후보 목록 안에서** 고릅니다. 목록에 없는 티커를 지어내지 마세요.
   (목록 밖 종목은 시스템이 자동으로 버리고, 그 사실이 사용자에게 표시됩니다.)
3. 제공된 기술적 지표 수치는 사용자 시스템이 실제로 계산한 값입니다. 사실로 취급하되,
   그 수치를 다시 지어내거나 바꾸지 마세요.
4. 수익을 보장하거나 단정하는 표현을 쓰지 마세요. "~할 가능성", "~라면"처럼 조건부로 씁니다.
   각 종목마다 이 판단이 틀릴 수 있는 리스크와, 틀렸다고 인정할 조건(invalidation)을 함께 적습니다.
5. 종목마다 출처 URL을 최소 1개 남깁니다. 제공된 목록에 실제로 있던 URL만 씁니다.
   (목록에 없는 URL은 '미확인'으로 표시되어 사용자에게 그대로 보입니다.)
6. 기술적 신호와 뉴스가 같은 방향을 가리키는 종목을 우선합니다.
   지표는 좋은데 악재가 있으면 제외하거나 리스크에 명시하세요.
7. **매매비용을 넘는 움직임만 의미가 있습니다.** 아래 '비용' 항목에 종목별 왕복 비용이 적혀 있습니다.
   예상 변동폭(expectedMovePct)이 그 비용을 못 넘는 종목은 맞혀도 손해이므로 고르지 마세요.
8. expectedMovePct 는 근거 있는 숫자만 씁니다. 이 값은 나중에 실제 결과와 대조되어
   당신의 과대예측 여부가 사용자에게 그대로 드러납니다.
9. 조사가 끝나면 반드시 ${TOOL_NAME} 도구를 호출해 결과를 제출합니다.
   도구 호출 없이 글로만 답하지 마세요. 고를 종목이 없어도 빈 배열로 제출합니다.

당신의 분석은 참고용이며 투자 권유가 아닙니다. 이 점을 전제로 균형 있게 서술하세요.`;

/**
 * 후보·뉴스·조건·실적을 하나의 사용자 메시지로.
 *
 * 예전 버전과 달라진 점 두 가지:
 *  - 종목마다 **왕복 매매비용과 본전 변동폭**을 함께 준다. 비용을 못 넘는 아이디어를
 *    애초에 고르지 않게 하기 위해서다.
 *  - **모델 자신의 과거 적중률**을 준다. "높음이라고 한 게 실제로는 38%밖에 안 맞았다"를
 *    보여 주면 신뢰도를 과장하지 않는다.
 */
function buildUserPrompt({ market, horizon, risk, scan, newsText, canSearch, costs, trackRecord }) {
  const now = new Date();
  const fmt = (tz, locale) => new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(now);
  const marketName = market === 'KR' ? '한국 주식시장(KOSPI/KOSDAQ)' : '미국 주식시장';

  const dataNote = scan.source === 'mock'
    ? '⚠️ 아래 지표는 실시간 시세 연결이 안 되어 데모 데이터로 계산된 값입니다. 이 점을 marketContext 에 반드시 밝히세요.'
    : '아래 지표는 실시간(지연) 시세로 계산된 실제 값입니다.';

  const research = canSearch
    ? `1. 웹 검색으로 각 후보의 최신 뉴스·실적·애널리스트 의견을 확인하고,
   오늘 시장 전반(지수, 금리, 환율, 주요 이벤트)과 글로벌 동향도 함께 조사하세요.
   아래에 수집된 뉴스 목록도 함께 참고하세요.`
    : `1. 아래 수집된 뉴스 목록만을 근거로 삼으세요. 목록에 없는 내용은 쓸 수 없습니다.
   당신에게는 웹 검색 기능이 없으므로, 확인되지 않은 사실은 적지 마세요.`;

  return `# 요청
${marketName}에서 지금 살 만한 종목을 **최대 3개** 골라 주세요.
기준을 넘는 종목이 없으면 **0개도 정답입니다.** 억지로 채우지 마세요.

- 현재 시각: ${fmt('Asia/Seoul', 'ko-KR')} (한국) / ${fmt('America/New_York', 'en-US')} (뉴욕)
- 투자 기간: ${horizon}
- 리스크 성향: ${risk}
${scan.phase ? `- 한국 장 상태: ${scan.phase}` : ''}

# 후보 종목 (자체 지표 엔진 스캔 결과 ${scan.scanned}종목 중 상위 ${scan.candidates.length}개)
${dataNote}

점수(score)는 -100~+100 범위의 자체 기술적 신호 점수입니다. 이 목록 **안에서만** 고르세요.
${scan.fitNote || ''}

\`\`\`json
${JSON.stringify(scan.candidates, null, 1)}
\`\`\`
${costsBlock(costs)}${trackBlock(trackRecord)}${newsText ? `\n# 수집된 뉴스 (공개 RSS 피드)\n${newsText}\n` : '\n(뉴스 수집에 실패했습니다. 지표와 확인 가능한 정보만으로 판단하고, 그 사실을 marketContext 에 밝히세요.)\n'}
# 해야 할 일
${research}
2. 기술적 신호와 뉴스가 **같은 방향을 가리키는** 종목만 남기세요.
3. 예상 변동폭이 **본전 변동폭보다 작은** 종목은 버리세요. 맞혀도 손해입니다.
4. 남은 것 중 근거가 확실한 것만 최대 3개까지 ${TOOL_NAME} 도구로 제출하세요.
   남은 게 없으면 빈 배열과 passReason 을 제출하세요.`;
}

/** 종목별 왕복 비용과 "이만큼은 움직여야 본전" 표 */
function costsBlock(costs) {
  if (!costs || !costs.length) return '';
  const rows = costs.map((c) =>
    `| ${c.symbol} | ${fmtNum(c.price)} | ${fmtNum(c.costPerShare)} | ${c.breakevenMovePct.toFixed(2)}% |`).join('\n');
  return `
# 매매비용 — 이만큼은 움직여야 본전입니다

수수료·세금·스프레드를 왕복으로 계산한 값입니다. **예상 변동폭이 본전 변동폭보다 작으면
목표를 맞혀도 손해입니다.** 그런 종목은 고르지 마세요.

| 종목 | 현재가 | 왕복 비용(주당) | 본전 변동폭 |
| --- | --- | --- | --- |
${rows}
`;
}

/** 이 시스템이 과거에 실제로 얼마나 맞혔는지 — 모델의 과신을 억제한다 */
function trackBlock(tr) {
  if (!tr || !tr.overall || !tr.overall.n) {
    return `
# 과거 적중률
아직 채점된 추천이 없습니다. 실적이 없으므로 **신뢰도를 높게 부르지 마세요.**
근거가 아주 확실할 때만 '높음'을 쓰고, 애매하면 '낮음'을 쓰세요.
`;
  }
  const line = (name, b) => b && b.n
    ? `- ${name}: ${b.n}건 중 목표 도달 ${b.targetRate}% · 손절 ${b.stopRate}% · 평균 ${b.avgPnlPct > 0 ? '+' : ''}${b.avgPnlPct}%`
    : null;
  const rows = [
    line('전체', tr.overall),
    line("신뢰도 '높음'", tr.byConfidence && tr.byConfidence['높음']),
    line("신뢰도 '중간'", tr.byConfidence && tr.byConfidence['중간']),
    line("신뢰도 '낮음'", tr.byConfidence && tr.byConfidence['낮음']),
  ].filter(Boolean).join('\n');

  const warn = tr.byConfidence && tr.byConfidence['높음'] && tr.byConfidence['높음'].n >= 5
    && tr.byConfidence['높음'].targetRate < 50
    ? `\n⚠️ **'높음'이라고 한 추천이 실제로는 ${tr.byConfidence['높음'].targetRate}% 밖에 맞지 않았습니다.**\n` +
      '신뢰도를 보수적으로 매기세요.\n'
    : '';

  return `
# 이 시스템의 과거 적중률 (실제 채점 결과)

당신이 매기는 신뢰도가 실제로 어땠는지입니다. 이 숫자를 보고 **신뢰도를 정직하게** 매기세요.

${rows}
${warn}${tr.overall.n < 20 ? '\n(표본이 적어 참고용입니다.)\n' : ''}`;
}

const fmtNum = (v) => (v == null || !isFinite(v) ? '—'
  : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2));

module.exports = { TOOL_NAME, TOOL_DESCRIPTION, INPUT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt };
