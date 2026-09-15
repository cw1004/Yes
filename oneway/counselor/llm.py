# -*- coding: utf-8 -*-
"""Claude 로 상담 응답을 만드는 선택적 제공자.

키가 없거나 SDK 가 설치되어 있지 않거나 호출이 실패하면 ``None`` 을 돌려주고,
호출측(engine.py)이 규칙 기반 엔진으로 조용히 폴백한다.
**사용자는 어느 쪽으로 답이 왔는지 몰라도 되게 하는 것이 목표다.**

안전 장치
---------
· 위기 상황(safety.assess)에서는 이 모듈을 아예 호출하지 않는다.
  긴급 안내는 모델 출력에 맡기지 않고 항상 규칙 기반으로 붙인다.
· 모델에게는 topics.py 의 자료를 '참고용'으로 넘겨서 말투와 신학적 태도를 고정한다.
· 구조화 출력(output_config.format)으로 5단계 형식을 강제한다.
"""

from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

from ..config import Config
from . import topics as topics_mod
from ..content import verses as verses_mod

log = logging.getLogger("oneway.counselor.llm")

try:                                    # SDK 는 선택 의존성이다
    import anthropic
except ImportError:                     # pragma: no cover - 설치 안 된 환경
    anthropic = None


SYSTEM_PROMPT = """당신은 「하나의 길 — ONE WAY」의 상담 동반자입니다.
이 사이트는 신앙에 질문이 있는 사람이라면 누구나 들어올 수 있는 공간이며,
가톨릭·개신교·무종교인이 함께 이용합니다.

지켜야 할 것
1. 먼저 듣습니다. 첫 문장은 반드시 상대의 말을 받아 주는 말이어야 합니다.
   "그래도", "하지만", "사실은"으로 시작하지 마십시오.
2. 설교하지 않습니다. 가르치려 들지 말고, 판단하지 말고, 훈계하지 마십시오.
3. 짧게 말합니다. 각 항목은 1~3문장입니다. 길면 읽히지 않습니다.
4. 성경은 '주소'만 말합니다. 어떤 번역본의 문장도 그대로 인용하지 마십시오.
   직접 펴서 읽어 보시라고 권하십시오.
5. 교파로 끌어당기지 않습니다. 상대가 먼저 묻기 전에는 특정 교단·교파를
   권하지 마십시오. 가톨릭과 개신교의 차이를 물으면 양쪽을 공정하게 설명하십시오.
6. 값싼 위로를 하지 마십시오. "다 잘될 거예요", "기도하면 해결됩니다",
   "믿음이 부족해서 그렇습니다" 같은 말은 금지입니다.
7. 고통의 원인을 상대의 죄나 믿음 부족으로 돌리지 마십시오.
8. 의학·법률·재정 문제에서는 전문가를 권하십시오. 진단이나 처방을 하지 마십시오.
   우울이 2주 이상 이어진다는 말이 나오면 진료를 권하되, 그것이 믿음과
   무관하다는 점을 분명히 하십시오.
9. 당신은 AI입니다. 사제·목회자·의사·심리상담사인 척하지 마십시오.
10. 존댓말을 쓰고, 담백한 한국어로 씁니다. 감탄사와 이모지는 쓰지 않습니다.
    하느님/하나님 표기는 상대가 쓴 표기를 따르고, 알 수 없으면 '하느님'을 씁니다.

출력은 다섯 부분으로 나눕니다.
- listen  : 상대의 말을 받아 주는 공감 (1~2문장)
- insight : 왜 그런 마음이 드는지, 또는 관점 하나 (1~3문장)
- question: 상대가 스스로 답해 볼 질문 하나 (한 문장, 물음표로 끝)
- prayer  : 30초 안에 말할 수 있는 짧은 기도 한 줄
- step    : 오늘 안에 끝낼 수 있는 아주 작은 행동 하나
- verse_key: 아래 '참고 구절' 목록에서 고른 key 하나 (마땅한 것이 없으면 빈 문자열)
"""

RESPONSE_SCHEMA: Dict = {
    "type": "object",
    "properties": {
        "listen": {"type": "string"},
        "insight": {"type": "string"},
        "question": {"type": "string"},
        "prayer": {"type": "string"},
        "step": {"type": "string"},
        "verse_key": {"type": "string"},
    },
    "required": ["listen", "insight", "question", "prayer", "step", "verse_key"],
    "additionalProperties": False,
}


def available(cfg: Config) -> bool:
    return anthropic is not None and cfg.api_key() is not None


def _reference(topic: topics_mod.Topic, turn_no: int) -> str:
    """모델에게 넘길 참고 자료 — 말투와 신학적 태도를 고정하는 장치."""
    vs = [verses_mod.get(k) for k in topic.verses]
    lines = [
        f"[감지된 주제] {topic.label}",
        "",
        "[이 주제를 볼 때의 관점]",
        *(f"- {s}" for s in topic.insight),
        "",
        "[참고 구절 — 번역문을 인용하지 말고 key 만 고르십시오]",
        *(f"- {v.key}: {v.ref} / {v.gist}" for v in vs),
        "",
        "[이 주제에서 쓰던 질문의 깊이 순서]",
        *(f"{i+1}. {q}" for i, q in enumerate(topic.questions)),
        "",
        f"[이번이 이 주제로 {turn_no}번째 대화입니다. "
        "회차가 올라갈수록 더 깊은 질문을 하십시오. 같은 질문을 반복하지 마십시오.]",
    ]
    return "\n".join(lines)


def counsel(cfg: Config,
            message: str,
            topic: topics_mod.Topic,
            turn_no: int = 1,
            history: Optional[List[Dict[str, str]]] = None,
            memo: str = "") -> Optional[Dict[str, str]]:
    """Claude 에게 상담 응답을 청한다. 실패하면 None."""
    if not available(cfg):
        return None

    client = anthropic.Anthropic(api_key=cfg.api_key())
    messages: List[Dict[str, object]] = list(history or [])
    ask = message if not memo else f"{message}\n\n(참고: {memo})"
    messages.append({"role": "user", "content": ask})

    try:
        response = client.messages.create(
            model=cfg.model,
            max_tokens=cfg.max_tokens,
            system=[
                {"type": "text", "text": SYSTEM_PROMPT,
                 "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": _reference(topic, turn_no)},
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

    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        log.warning("응답을 해석하지 못했습니다. 오프라인 엔진으로 답합니다.")
        return None

    if not isinstance(data, dict) or not data.get("listen"):
        return None
    return {k: str(data.get(k, "")).strip() for k in
            ("listen", "insight", "question", "prayer", "step", "verse_key")}
