# -*- coding: utf-8 -*-
"""대화의 깊이 — 이 사이트에서 가장 중요한 설계.

처음 온 사람에게 교파 이야기는 물론이고 신앙 언어조차 꺼내지 않는다.
사람은 '설득당하러' 오지 않는다. 힘들어서 온다.

    깊이 0 · 열림   순수한 상담. 하느님·성경·기도·교회라는 말을 쓰지 않는다.
    깊이 1 · 이야기 출처를 밝히지 않고 오래된 이야기 한 토막을 건넨다.
    깊이 2 · 신앙   상대가 신앙 언어를 먼저 썼을 때. 성경의 '주소'가 등장한다.
    깊이 3 · 전통   상대가 교파를 직접 물었을 때만. 가톨릭·개신교를 공정하게.

깊이는 **상대가 연다**. 우리가 끌어올리지 않는다.
다만 문은 보이게 둔다(``invitation``). 문을 여는 것은 상대의 몫이다.

깊이를 내리는 신호(종교 이야기는 하지 말아 달라)는 영구히 기억한다.
한 번 거절한 사람에게 두 번 권하지 않는다.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

OPEN, STORY, FAITH, TRADITION = 0, 1, 2, 3

NAMES = {OPEN: "열림", STORY: "이야기", FAITH: "신앙", TRADITION: "전통"}

# 깊이 2 — 상대가 이 말을 먼저 썼다면 신앙 언어로 답해도 된다.
#
# 단순 포함 검사를 쓰면 안 되는 말들이 있다.
#   "사람 만나기도 싫다"  → '기도' 가 들어 있지만 기도 이야기가 아니다
#   "부장님이 말씀하시길" → '말씀' 은 높임말일 뿐이다
#   "결혼식 신부"         → '신부' 는 사제가 아니다
#   "영세한 기업"         → '영세' 는 세례가 아니다
# 깊이를 잘못 올리면 종교 이야기를 원하지 않는 사람에게 종교 이야기를 하게 된다.
# 그래서 애매한 말은 형태까지 확인한다. (말씀·은혜·축복은 아예 뺐다.)
FAITH_CUES: List[str] = [
    r"하느님", r"하나님", r"주님", r"예수", r"그리스도", r"성령",
    r"성경", r"성서", r"복음", r"신앙", r"믿음",
    r"교회", r"성당", r"예배", r"미사", r"묵상", r"찬양", r"은총",
    r"종교", r"신을\s*믿", r"신이\s*있", r"신은\s*있", r"신이\s*계",
    # 기도: 앞이 한글이 아니거나(문장 첫머리·띄어쓰기 뒤),
    #       뒤에 조사·어미가 붙은 경우만 (→ '만나기도 싫다' 는 걸리지 않는다)
    r"(?<![가-힣])기도", r"기도(를|가|는|에|로|문|해|하|할|합|했|와)",
]

# 깊이 3 — 교파를 직접 물었을 때만
TRADITION_CUES: List[str] = [
    r"가톨릭", r"천주교", r"개신교", r"기독교", r"교파", r"교단",
    r"성공회", r"정교회", r"장로교", r"감리교", r"순복음",
    r"신부님", r"목사", r"수녀", r"전도사", r"장로", r"권사",
    r"성체", r"성찬", r"세례", r"침례", r"교리", r"고해",
    r"영세(를|성사|\s*받)", r"미사", r"주일학교", r"구역예배",
]

# 깊이 1 — 종교어는 아니지만 '더 큰 질문'에 닿아 있는 말
STORY_CUES: List[str] = [
    r"왜\s*사는", r"사는\s*이유", r"삶의\s*의미", r"인생이\s*뭔", r"죽으면",
    r"영혼", r"운명", r"이\s*모든\s*게", r"허무", r"공허",
]

# 종교 이야기를 원하지 않는다는 신호 — 한 번 나오면 영구히 깊이 0
DECLINE_PATTERNS: List[str] = [
    r"종교\s*(는|얘기|이야기|말)?\s*(는)?\s*(빼|말|사양|싫|관심\s*없|필요\s*없)",
    r"(신앙|교회|성경|기도)\s*(얘기|이야기|말)\s*(은|는)?\s*(빼|말|사양|싫|그만)",
    r"전도\s*(는)?\s*(하지|말|사양|싫)",
    r"저는?\s*무교", r"무신론", r"종교\s*없", r"안\s*믿습니다",
    r"설교\s*(는)?\s*(하지|말|듣고\s*싶지)",
]

# 상대가 먼저 열어 달라고 하는 신호
INVITE_PATTERNS: List[str] = [
    r"더\s*얘기", r"더\s*듣고\s*싶", r"알려\s*주", r"어떻게\s*생각", r"궁금",
]


def declines(text: str) -> bool:
    """종교 이야기를 원하지 않는다고 말했는가."""
    return any(re.search(p, text or "") for p in DECLINE_PATTERNS)


def _hit(text: str, cues: List[str]) -> Optional[str]:
    for c in cues:
        m = re.search(c, text)
        if m:
            return m.group(0)
    return None


def detect(text: str) -> Tuple[int, str]:
    """이번 발화 하나가 요구하는 깊이. (깊이, 근거가 된 말)"""
    text = text or ""
    hit = _hit(text, TRADITION_CUES)
    if hit:
        return TRADITION, hit
    hit = _hit(text, FAITH_CUES)
    if hit:
        return FAITH, hit
    hit = _hit(text, STORY_CUES)
    if hit:
        return STORY, hit
    return OPEN, ""


def resolve(text: str, carried: int = OPEN, blocked: bool = False) -> Tuple[int, str]:
    """이번 대화에서 쓸 깊이를 정한다.

    · 거절한 적이 있으면 무조건 0. 예외 없다.
    · 지난 대화에서 열린 깊이(``carried``)는 유지한다.
      한 번 신앙 이야기를 나눈 사람에게 다음 날 다시 남처럼 굴 필요는 없다.
    · 다만 **교파(3)는 유지하지 않는다.** 물어본 그 순간에만 답한다.
    """
    if blocked:
        return OPEN, ""
    now, why = detect(text)
    if now == TRADITION:
        return TRADITION, why
    return max(now, min(carried, FAITH)), why


def invitation(level: int, turn_no: int, blocked: bool) -> str:
    """문을 보여 주는 한 줄. 권유가 아니라 안내다.

    같은 사람에게 매번 띄우지 않는다. 대화가 좀 쌓였을 때 한 번만.
    """
    if blocked or turn_no < 3:
        return ""
    if level == OPEN:
        return "이런 이야기를 조금 다른 각도에서 오래 들여다본 글들이 있습니다. 궁금하시면 말씀해 주세요."
    if level == STORY:
        return "이 이야기가 어디서 온 것인지 궁금하시면 물어보셔도 됩니다."
    return ""
