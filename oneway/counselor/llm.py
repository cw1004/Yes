# -*- coding: utf-8 -*-
"""Claude 로 상담 응답을 만드는 선택적 제공자.

키가 없거나 SDK 가 없거나 호출이 실패하면 ``None`` 을 돌려주고,
호출측(engine.py)이 규칙 엔진으로 조용히 폴백한다.
**방문자는 어느 쪽으로 답이 왔는지 몰라도 되게 하는 것이 목표다.**

안전 장치
---------
· 위기 상황(safety.assess)에서는 이 모듈을 아예 호출하지 않는다.
  긴급 안내는 모델 출력에 맡기지 않고 항상 규칙 기반으로 붙인다.
· 깊이(depth.py)에 따라 **쓸 수 있는 언어 자체를 제한한다.**
  깊이 0 에서는 하느님·성경·기도·교회라는 말을 쓰지 못하게 막는다.
· topics.py 의 자료를 참고용으로 넘겨 말투와 태도를 고정한다.
"""

from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

from ..config import Config
from ..content import verses as verses_mod
from . import depth as depth_mod
from . import persona
from . import topics as topics_mod

log = logging.getLogger("oneway.counselor.llm")

try:                                    # SDK 는 선택 의존성이다
    import anthropic
except ImportError:                     # pragma: no cover - 설치 안 된 환경
    anthropic = None


BASE_PROMPT = """당신은 어떤 사이트의 상담 동반자입니다. 이름은 '곁'입니다.
힘든 사람이 밤에 혼자 들어와 말을 겁니다. 당신이 할 일은 먼저 듣는 것입니다.

말투
- 담백한 존댓말. 과장하지 않고, 감탄사와 이모지를 쓰지 않습니다.
- 한 덩어리의 말로 씁니다. "①공감 ②질문" 같은 딱지나 소제목을 붙이지 마십시오.
- 전체 4~6문장. 길면 읽히지 않습니다.
- 매번 같은 문장으로 시작하지 마십시오. "많이 힘드셨겠습니다"를 반복하지 마십시오.
- 상대가 쓴 말을 그대로 받아 쓰십시오. 상대의 표현을 바꿔 부르지 마십시오.

반드시 지킬 것
1. 첫 문장은 상대의 말을 받아 주는 말입니다. "그래도", "하지만", "사실은"으로
   시작하지 마십시오.
2. 가르치지 말고, 판단하지 말고, 훈계하지 마십시오.
3. 값싼 위로 금지. "다 잘될 거예요", "시간이 약이에요", "긍정적으로 생각하세요"
   같은 말은 쓰지 마십시오.
4. 고통의 원인을 상대의 성격이나 노력 부족으로 돌리지 마십시오.
5. 의학·법률·재정 문제는 전문가를 권하십시오. 진단하거나 처방하지 마십시오.
   우울이 2주 이상 이어진다는 말이 나오면 진료를 권하되, 그것이 의지의 문제가
   아니라는 점을 분명히 하십시오.
6. 사람인 척하지 마십시오. 동시에 묻지도 않았는데 "저는 AI입니다"라고
   먼저 밝히지도 마십시오. 상대가 물으면 그때 정직하게 답합니다.
7. 마지막에는 오늘 안에 할 수 있는 아주 작은 행동 하나를 제안하십시오.
   거창한 것 말고, 오늘 끝낼 수 있는 것으로."""

# 깊이별로 '쓸 수 있는 언어'가 달라진다. 이것이 이 사이트의 핵심 설계다.
DEPTH_RULES = {
    depth_mod.OPEN: """지금은 **종교 언어를 한 단어도 쓰지 않습니다.**
금지어: 하느님, 하나님, 주님, 예수, 그리스도, 성경, 말씀, 기도, 교회, 성당,
신앙, 믿음, 축복, 은혜, 묵상, 종교.
상대는 아직 그런 이야기를 청하지 않았습니다. 지금은 그냥 사람 대 사람의
이야기입니다. 위로도 조언도 종교 없이 하십시오. 이것을 어기면 상대는 떠납니다.""",

    depth_mod.STORY: """상대가 '왜 사는가' 같은 큰 질문에 닿아 있습니다.
오래된 이야기 한 토막을 건네도 좋습니다. 다만 **출처를 밝히지 마십시오.**
"성경에", "예수님이" 같은 말을 쓰지 말고 "아주 오래된 글에", "옛 기록에"
정도로만 두십시오. 상대가 출처를 물으면 그때 답하면 됩니다.
여전히 기도·교회·신앙이라는 말은 쓰지 않습니다.""",

    depth_mod.FAITH: """상대가 먼저 신앙 언어를 썼습니다. 이제 같은 언어로 답해도 됩니다.
성경은 '주소'만 말하십시오(예: 마태 11,28). 어떤 번역본의 문장도 그대로
인용하지 마십시오. 직접 펴서 읽어 보시라고 권하십시오.
표기는 상대가 쓴 것을 따릅니다(하느님/하나님). 알 수 없으면 '하느님'을 씁니다.
**교파(가톨릭·개신교) 이야기는 먼저 꺼내지 마십시오.**""",

    depth_mod.TRADITION: """상대가 교파를 직접 물었습니다. 이제 답해도 됩니다.
가톨릭과 개신교를 **공정하게** 다루십시오. 어느 한쪽을 권하지 마십시오.
먼저 같은 것을 세고, 다른 것을 정확히 말하십시오. 흐리지 마십시오.
상대가 어느 쪽 신자인지 단정하지 마십시오.""",
}

BLOCKED_RULE = """이 사람은 종교 이야기를 원하지 않는다고 분명히 말했습니다.
어떤 경우에도 신앙·종교·성경·기도·교회를 꺼내지 마십시오. 암시도 하지 마십시오.
순수하게 상담으로만 도우십시오."""

RESPONSE_SCHEMA: Dict = {
    "type": "object",
    "properties": {
        "text": {
            "type": "string",
            "description": "상대에게 그대로 보여 줄 말. 4~6문장. 문단은 빈 줄로 구분.",
        },
        "verse_key": {
            "type": "string",
            "description": "참고 구절 목록에서 고른 key 하나. 깊이 2 미만이거나 "
                           "마땅한 것이 없으면 빈 문자열.",
        },
    },
    "required": ["text", "verse_key"],
    "additionalProperties": False,
}


def available(cfg: Config) -> bool:
    return anthropic is not None and cfg.api_key() is not None


def _reference(topic: topics_mod.Topic, turn_no: int, level: int) -> str:
    """모델에게 넘길 참고 자료 — 말투와 태도를 고정하는 장치."""
    lines = [
        f"[감지된 주제] {topic.label}",
        "",
        "[이 주제를 볼 때의 관점 — 그대로 베끼지 말고 참고만 하십시오]",
        *(f"- {s}" for s in topic.insight),
    ]
    if level == depth_mod.STORY and topic.story:
        lines += ["", "[출처를 밝히지 않고 쓸 수 있는 이야기]",
                  *(f"- {s}" for s in topic.story)]
    if level >= depth_mod.FAITH:
        lines += ["", "[신앙 언어로 쓸 수 있는 관점]",
                  *(f"- {s}" for s in topic.faith_insight)]
        lines += ["", "[참고 구절 — 번역문을 인용하지 말고 key 만 고르십시오]",
                  *(f"- {v.key}: {v.ref} / {v.gist}"
                    for v in (verses_mod.get(k) for k in topic.verses))]
    lines += [
        "",
        "[이 주제에서 쓰던 질문의 깊이 순서]",
        *(f"{i + 1}. {q}" for i, q in enumerate(topic.questions)),
        "",
        "[오늘의 한 걸음 예시]",
        *(f"- {s}" for s in topic.steps),
        "",
        f"[이번이 이 주제로 {turn_no}번째 대화입니다. "
        "회차가 올라갈수록 더 깊은 질문을 하고, 같은 질문을 반복하지 마십시오.]",
    ]
    return "\n".join(lines)


def counsel(cfg: Config,
            message: str,
            topic: topics_mod.Topic,
            turn_no: int = 1,
            level: int = depth_mod.OPEN,
            history: Optional[List[Dict[str, str]]] = None,
            memo: str = "") -> Optional[Dict[str, str]]:
    """Claude 에게 상담 응답을 청한다. 실패하면 None."""
    if not available(cfg):
        return None

    blocked = "종교 이야기를 원하지 않는다" in memo
    rule = BLOCKED_RULE if blocked else DEPTH_RULES.get(level, DEPTH_RULES[depth_mod.OPEN])
    system_now = f"{BASE_PROMPT}\n\n[지금 대화의 깊이 규칙]\n{rule}"

    client = anthropic.Anthropic(api_key=cfg.api_key())
    messages: List[Dict[str, object]] = list(history or [])
    messages.append({"role": "user",
                     "content": message if not memo else f"{message}\n\n(참고: {memo})"})

    try:
        response = client.messages.create(
            model=cfg.model,
            max_tokens=cfg.max_tokens,
            system=[
                # 고정 부분을 앞에 두고 캐시한다 (깊이 규칙은 자주 바뀌므로 뒤에)
                {"type": "text", "text": BASE_PROMPT,
                 "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": f"[지금 대화의 깊이 규칙]\n{rule}"},
                {"type": "text", "text": _reference(topic, turn_no, level)},
            ],
            messages=messages,
            output_config={
                "effort": cfg.effort,
                "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
            },
        )
    except anthropic.NotFoundError:
        log.warning("모델 이름을 찾을 수 없습니다: %s", cfg.model)
        return None
    except anthropic.AuthenticationError:
        log.warning("%s 가 올바르지 않습니다.", cfg.api_key_env)
        return None
    except anthropic.RateLimitError:
        log.warning("요청이 몰렸습니다. 오프라인 엔진으로 답합니다.")
        return None
    except anthropic.APIStatusError as e:
        log.warning("API 오류(%s). 오프라인 엔진으로 답합니다.", e.status_code)
        return None
    except anthropic.APIConnectionError:
        log.warning("네트워크 오류. 오프라인 엔진으로 답합니다.")
        return None

    if response.stop_reason == "refusal":
        log.info("모델이 응답을 거절했습니다. 오프라인 엔진으로 답합니다.")
        return None

    raw = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("응답을 해석하지 못했습니다. 오프라인 엔진으로 답합니다.")
        return None

    text = str(data.get("text", "")).strip() if isinstance(data, dict) else ""
    if not text:
        return None
    if level < depth_mod.FAITH and _leaks_faith(text):
        # 깊이 0~1 에서 종교어가 새어 나오면 쓰지 않는다. 규칙 엔진이 대신 답한다.
        log.info("깊이 %s 응답에 종교 언어가 섞여 폐기했습니다.", level)
        return None
    return {"text": text, "verse_key": str(data.get("verse_key", "")).strip()}


# 깊이 0~1 에서 새어 나오면 안 되는 말 — 모델 출력을 그대로 믿지 않는다
LEAK_WORDS = ("하느님", "하나님", "주님", "예수", "그리스도", "성령", "성경",
              "성서", "복음", "성당", "미사", "신앙", "교회", "묵상", "은총")


def _leaks_faith(text: str) -> bool:
    return any(w in text for w in LEAK_WORDS)
