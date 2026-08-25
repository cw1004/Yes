'use strict';
/**
 * 두 모델이 똑같은 형식으로 답하도록 공유하는 출력 스키마와 프롬프트.
 * Claude 는 이 스키마를 tool(strict)로, Llama 는 OpenAI 호환 function 으로 받는다.
 */

const TOOL_NAME = 'submit_recommendations';

const TOOL_DESCRIPTION =
  '조사를 마친 뒤 최종 추천 종목 3개를 제출한다. 반드시 정확히 3개를 담고, ' +
  '각 종목은 후보 목록에 있던 심볼이어야 하며, 확인한 출처를 1개 이상 포함해야 한다.';

const INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['marketContext', 'picks'],
  properties: {
    marketContext: {
      type: 'string',
      description: '오늘 시장 전반의 상황과 분위기를 2~4문장으로. 제공된 뉴스나 검색으로 확인한 내용만.',
    },
    picks: {
      type: 'array',
      description: '추천 종목 3개.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'name', 'thesis', 'catalysts', 'risks', 'confidence', 'horizon', 'sources'],
        properties: {
          symbol: { type: 'string', description: '후보 목록에 있던 심볼/종목코드 그대로.' },
          name: { type: 'string', description: '종목명.' },
          thesis: { type: 'string', description: '왜 지금 이 종목인지 3~5문장. 기술적 지표와 뉴스 근거를 함께.' },
          catalysts: { type: 'array', description: '상승 촉매 2~4개. 각 항목은 한 문장.', items: { type: 'string' } },
          risks: { type: 'array', description: '이 판단이 틀릴 수 있는 리스크 2~3개. 각 항목은 한 문장.', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['높음', '중간', '낮음'], description: '근거의 확실성. 근거가 약하면 낮음.' },
          horizon: { type: 'string', enum: ['당일', '2~3일', '1~2주'], description: '이 아이디어가 유효한 기간.' },
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
**시장 정보를 확인해** 그 후보 중에서 지금 가장 매력적인 3종목을 고르는 것입니다.

반드시 지킬 것:
1. 제공된 뉴스 목록(또는 웹 검색 결과)에서 실제로 확인한 내용만 서술합니다.
   기억이나 추측으로 뉴스·실적·목표주가를 지어내지 마세요.
   확인되지 않으면 "확인되지 않음"이라고 쓰거나 그 근거를 아예 빼십시오.
2. 종목은 **반드시 제공된 후보 목록 안에서** 고릅니다. 목록에 없는 티커를 지어내지 마세요.
3. 제공된 기술적 지표 수치는 사용자 시스템이 실제로 계산한 값입니다. 사실로 취급하되,
   그 수치를 다시 지어내거나 바꾸지 마세요.
4. 수익을 보장하거나 단정하는 표현을 쓰지 마세요. "~할 가능성", "~라면"처럼 조건부로 씁니다.
   각 종목마다 이 판단이 틀릴 수 있는 리스크를 반드시 함께 적습니다.
5. 종목마다 출처 URL을 최소 1개 남깁니다. 제공된 목록에 실제로 있던 URL만 씁니다.
6. 기술적 신호와 뉴스가 같은 방향을 가리키는 종목을 우선합니다.
   지표는 좋은데 악재가 있으면 제외하거나 리스크에 명시하세요.
7. 조사가 끝나면 반드시 ${TOOL_NAME} 도구를 호출해 결과를 제출합니다.
   도구 호출 없이 글로만 답하지 마세요.

당신의 분석은 참고용이며 투자 권유가 아닙니다. 이 점을 전제로 균형 있게 서술하세요.`;

/** 후보·뉴스·조건을 하나의 사용자 메시지로 */
function buildUserPrompt({ market, horizon, risk, scan, newsText, canSearch }) {
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
${marketName}에서 지금 주목할 만한 **3종목**을 골라 주세요.

- 현재 시각: ${fmt('Asia/Seoul', 'ko-KR')} (한국) / ${fmt('America/New_York', 'en-US')} (뉴욕)
- 투자 기간: ${horizon}
- 리스크 성향: ${risk}
${scan.phase ? `- 한국 장 상태: ${scan.phase}` : ''}

# 후보 종목 (자체 지표 엔진 스캔 결과 ${scan.scanned}종목 중 상위 ${scan.candidates.length}개)
${dataNote}

점수(score)는 -100~+100 범위의 자체 기술적 신호 점수입니다. 이 목록 **안에서만** 3종목을 고르세요.

\`\`\`json
${JSON.stringify(scan.candidates, null, 1)}
\`\`\`
${newsText ? `\n# 수집된 뉴스 (공개 RSS 피드)\n${newsText}\n` : '\n(뉴스 수집에 실패했습니다. 지표와 확인 가능한 정보만으로 판단하고, 그 사실을 marketContext 에 밝히세요.)\n'}
# 해야 할 일
${research}
2. 기술적 신호와 뉴스가 **같은 방향을 가리키는** 종목을 우선하세요.
3. 조사가 끝나면 ${TOOL_NAME} 도구로 3종목을 제출하세요.`;
}

module.exports = { TOOL_NAME, TOOL_DESCRIPTION, INPUT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt };
