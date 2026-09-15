# -*- coding: utf-8 -*-
"""위기 감지 — 상담사에서 가장 먼저 실행되고, 가장 중요한 모듈.

새벽 세 시에 아무에게도 말하지 못하는 사람이 찾아오는 서비스다.
그런 사람에게 성경 구절부터 들이미는 것은 위험하다.

이 모듈은 다음 순서를 강제한다.

    위기 신호 감지 → 전문 기관 연결 → (그 다음에야) 곁에 있겠다는 말

AI 응답 생성보다 **앞에서** 실행되며, Claude 를 쓰든 안 쓰든
위기 상황의 안내문은 항상 규칙 기반으로 붙는다. 모델 출력에 맡기지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

# 긴급 연락처 (대한민국 기준).
# 번호는 바뀔 수 있으므로 운영 전 반드시 최신 정보를 확인할 것.
HOTLINES_KR: List[Tuple[str, str, str]] = [
    ("자살예방 상담전화", "109", "24시간 · 전화 무료"),
    ("정신건강 상담전화", "1577-0199", "24시간 · 지역 정신건강복지센터 연결"),
    ("생명의전화", "1588-9191", "24시간"),
    ("청소년 상담전화", "1388", "24시간 · 청소년 본인/보호자"),
    ("여성긴급전화", "1366", "24시간 · 폭력 피해"),
    ("긴급신고", "112 / 119", "지금 위험하다면 바로"),
]

# --- 즉시 위기 (crisis) ---
CRISIS_PATTERNS: List[str] = [
    r"자살", r"자해", r"죽고\s*싶", r"죽어\s*버리", r"목숨을?\s*끊",
    r"스스로\s*목숨", r"극단적\s*선택", r"유서", r"손목을?\s*긋",
    r"뛰어\s*내리", r"목을?\s*매", r"번개탄", r"약을?\s*모으",
    r"이번\s*주에\s*끝내", r"오늘\s*밤에\s*끝",
]

# --- 경고 신호 (watch) ---
WATCH_PATTERNS: List[str] = [
    r"사라지고\s*싶", r"없어지고\s*싶", r"살기\s*싫", r"그만\s*살",
    r"태어나지\s*말았", r"내가\s*없으면\s*(다들|모두)?\s*(나을|편할)",
    r"아무\s*의미\s*없", r"살\s*이유가\s*없",
]

# --- 폭력·학대 (abuse) — 다른 기관으로 연결해야 한다 ---
ABUSE_PATTERNS: List[str] = [
    r"때려", r"때리", r"때립", r"때렸", r"맞고\s*있", r"맞았", r"폭행",
    r"폭력", r"학대", r"감금",
    r"성폭력", r"성추행", r"강간", r"협박", r"스토킹",
]

# 관용 표현 — "힘들어 죽겠다"를 위기로 오인하면 신뢰를 잃는다.
IDIOMS: List[str] = [
    r"(힘들|배고파|배고프|피곤해|졸려|더워|추워|아파|좋아|웃겨|귀여워|미치)\w*\s*죽겠",
    r"죽겠\w*\s*(네|다|어요|습니다)?\s*[ㅋㅎ]",
    r"죽도록\s*(일|공부|사랑)",
]

LEVELS = ("none", "watch", "crisis", "abuse")


@dataclass
class Risk:
    level: str                  # none | watch | crisis | abuse
    matched: tuple = ()         # 어떤 표현에 걸렸는지 (로그·검수용)

    @property
    def urgent(self) -> bool:
        """신앙 이야기를 멈추고 기관 연결을 먼저 해야 하는 상태."""
        return self.level in ("crisis", "abuse")

    def to_dict(self) -> Dict:
        return asdict(self)


def _hits(text: str, patterns: List[str]) -> List[str]:
    return [p for p in patterns if re.search(p, text)]


def _strip_idioms(text: str) -> str:
    out = text
    for p in IDIOMS:
        out = re.sub(p, " ", out)
    return out


def assess(text: str) -> Risk:
    """사용자 입력 한 줄의 위험도를 판정한다."""
    if not text:
        return Risk("none")
    cleaned = _strip_idioms(text)

    hit = _hits(cleaned, CRISIS_PATTERNS)
    if hit:
        return Risk("crisis", tuple(hit))

    hit = _hits(cleaned, ABUSE_PATTERNS)
    if hit:
        return Risk("abuse", tuple(hit))

    hit = _hits(cleaned, WATCH_PATTERNS)
    if hit:
        return Risk("watch", tuple(hit))

    return Risk("none")


def hotline_lines(region: str = "KR") -> List[str]:
    return [f"{name} {number} — {note}" for name, number, note in HOTLINES_KR]


def crisis_message(risk: Risk, region: str = "KR") -> List[str]:
    """위기 상황에서 **모델 출력보다 먼저** 보여 줄 문단들."""
    if risk.level == "abuse":
        head = [
            "지금 누군가에게 해를 입고 있다면, 그건 당신 잘못이 아닙니다.",
            "먼저 안전을 확보하는 것이 가장 중요합니다. 지금 위험하다면 112에 신고하십시오.",
        ]
    else:
        head = [
            "지금 많이 힘드신 것 같습니다. 그 말을 꺼내 주셔서 고맙습니다.",
            "저는 AI라서 지금 당신 곁에 실제로 있어 드릴 수 없습니다. "
            "그래서 사람에게 먼저 연결해 드리고 싶습니다.",
        ]
    tail = [
        "아래 번호는 24시간 열려 있고, 무료이며, 이름을 밝히지 않아도 됩니다.",
    ]
    closing = [
        "전화가 어렵다면 지금 옆에 있는 사람 한 명에게 “조금 힘들다”고만 말해 주십시오.",
        "그리고 원하신다면, 그 다음에 저와 이야기를 더 이어 가도 좋습니다. 여기 있겠습니다.",
    ]
    return head + tail + closing


def disclaimer() -> str:
    return ("이 상담은 AI가 드리는 것으로, 의료·심리 치료나 사제·목회자의 상담을 "
            "대신하지 않습니다.")
