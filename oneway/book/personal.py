# -*- coding: utf-8 -*-
"""그 사람을 위해 만드는 책.

상담이 끝나면, 그 사람이 한 이야기에 맞춰 책 한 권을 만들어 준다.
27개 주제 중 그 사람이 실제로 꺼낸 것만 골라 묶고, 그 사람이 열어 둔
깊이까지만 담는다. 같은 사이트에서 두 사람이 서로 다른 책을 받는다.

절대 지키는 두 가지
-------------------
**1. 그 사람이 쓴 문장은 한 글자도 넣지 않는다.**
   이 사이트는 이름도 연락처도 받지 않는다. 그런데 책에 "당신은 남편의
   폭력에 대해 말씀하셨습니다" 같은 문장이 들어가면, 그 파일을 가족이
   보는 순간 그 자체가 가해가 된다.
   그래서 쓰는 것은 **주제 키·깊이·횟수뿐**이다. 원문은 읽지도 않는다.
   ``build_profile`` 이 Visitor 에서 뽑아 가는 값을 보면 확인할 수 있다.

**2. 이 책은 무료다.**
   마음을 쏟아낸 직후에 값을 붙이는 것은 상담이 아니라 영업이다.
   판매·기부용 책(content.py)은 따로 있고, 그쪽은 아무 때나 사면 된다.
   맞춤 책은 그 사람 것이고, 값을 받지 않는다.

그리고 위기 상황에서는 만들지 않는다. 그때 필요한 건 파일이 아니라
전화번호다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional

from ..content import daily as daily_mod
from ..content import paths as paths_mod
from ..content import verses as verses_mod
from ..counselor import depth as depth_mod
from ..counselor import topics as topics_mod
from .content import (APPENDIX, ESSAYS, PART3, PART_INTROS, Book, Chapter,
                      _practice_chapter, part_intro)

# 책 한 권에 담을 주제 수. 너무 많으면 '내 이야기'가 아니라 사전이 된다.
MAX_TOPICS = 6
MIN_TOPICS = 2

PART_MINE = "1부 · 당신이 꺼낸 이야기"
PART_WALK = "2부 · 조금 더 걸어 본다면"
PART_DO = "3부 · 30일, 한 걸음씩"

ESSAY_BY_TOPIC: Dict[str, Chapter] = {c.topic: c for c in ESSAYS if c.topic}


@dataclass
class Profile:
    """책을 만드는 데 쓰는 전부. 여기 없는 것은 쓰지 않는다.

    원문(Turn.text)은 이 구조체에 들어오지 않는다. 일부러 그렇게 두었다.
    """
    topics: List[str] = field(default_factory=list)   # 많이 이야기한 순서
    depth: int = 0
    faith_blocked: bool = False
    visits: int = 1
    streak: int = 1
    turns: int = 0
    path_steps: Dict[str, int] = field(default_factory=dict)
    made_on: str = ""

    @property
    def enough(self) -> bool:
        """책을 만들 만큼 이야기가 쌓였는가."""
        return len(self.topics) >= MIN_TOPICS and self.turns >= 3


def build_profile(visitor, today: Optional[date] = None) -> Profile:
    """Visitor 에서 **주제·깊이·횟수만** 뽑는다. 원문은 건드리지 않는다."""
    counted = sorted(visitor.topics.items(), key=lambda kv: (-kv[1], kv[0]))
    picked = [k for k, _ in counted
              if k in topics_mod.BY_KEY and k != topics_mod.DEFAULT_KEY]
    return Profile(
        topics=picked[:MAX_TOPICS],
        depth=0 if visitor.faith_blocked else min(int(visitor.depth), 2),
        faith_blocked=bool(visitor.faith_blocked),
        visits=visitor.visit_count,
        streak=visitor.streak,
        turns=sum(1 for t in visitor.turns if t.role == "user"),
        path_steps=dict(visitor.paths),
        made_on=(today or date.today()).isoformat(),
    )


# ══════════════════════════════════════════════════════════════════════
# 주제 하나를 한 장으로
# ══════════════════════════════════════════════════════════════════════
def chapter_for_topic(no: int, key: str, level: int) -> Chapter:
    """주제 하나를 책의 한 장으로 만든다.

    에세이가 있는 주제는 에세이를 쓴다(1부의 10편). 없는 주제는
    topics.py 의 층에서 만든다 — 상담사가 쓰는 것과 같은 자료다.
    """
    topic = topics_mod.get(key)
    essay = ESSAY_BY_TOPIC.get(key)
    if essay:
        body = list(essay.body)
        title = essay.title
        question, step, closing = essay.question, essay.step, essay.closing
    else:
        title = topic.label
        body = [topic.empathy[0]] + list(topic.insight)
        question = topic.questions[0]
        step = topic.steps[0]
        closing = topic.closing[0]

    verse_key = ""
    if level >= depth_mod.FAITH:
        if topic.faith_insight:
            body.append(topic.faith_insight[0])
        verse_key = topic.verses[0] if topic.verses else ""
        if topic.prayer:
            closing = topic.prayer
    elif level == depth_mod.STORY and topic.story:
        body.append(topic.story[0])

    return Chapter(no=no, part=PART_MINE, title=title, body=tuple(body),
                   question=question, step=step, closing=closing,
                   verse_key=verse_key, topic=key)


def _next_topics(profile: Profile, taken: List[str], limit: int = 3) -> List[str]:
    """꺼내지 않았지만 곁에 있을 만한 주제. 함께 자주 오는 것들로 고른다."""
    NEIGHBOURS = {
        "지침": ["우울", "자존감", "진로"],
        "외로움": ["자존감", "의미", "관계"],
        "불안": ["미래", "지침", "돈"],
        "우울": ["지침", "의미", "자존감"],
        "상실": ["의미", "고통", "외로움"],
        "가족": ["관계", "용서", "자녀"],
        "자녀": ["가족", "불안", "자존감"],
        "관계": ["용서", "자존감", "가족"],
        "용서": ["분노", "관계", "죄책감"],
        "분노": ["용서", "관계", "지침"],
        "고통": ["의미", "상실", "불안"],
        "사랑": ["관계", "가족", "의미"],
        "죄책감": ["자존감", "용서", "의미"],
        "자존감": ["외로움", "우울", "의미"],
        "돈": ["불안", "진로", "미래"],
        "진로": ["불안", "의미", "지침"],
        "질병": ["고통", "불안", "상실"],
        "미래": ["불안", "종말", "의미"],
        "종말": ["불안", "미래", "고통"],
        "의미": ["외로움", "우울", "고통"],
        "의심": ["의미", "고통", "응답없음"],
        "응답없음": ["의심", "고통", "기도"],
        "교회상처": ["관계", "돌아옴", "의심"],
        "돌아옴": ["죄책감", "교회상처", "의미"],
    }
    out: List[str] = []
    for key in profile.topics:
        for n in NEIGHBOURS.get(key, []):
            if n in topics_mod.BY_KEY and n not in taken and n not in out:
                t = topics_mod.get(n)
                if t.min_depth <= profile.depth:
                    out.append(n)
    return out[:limit]


# ══════════════════════════════════════════════════════════════════════
# 여는 글 · 닫는 글  (그 사람의 문장은 쓰지 않는다)
# ══════════════════════════════════════════════════════════════════════
def _front(profile: Profile, labels: List[str]) -> tuple:
    listed = ", ".join(f"「{x}」" for x in labels)
    visit_line = (f"{profile.visits}번 오셨고, 지금까지 {profile.turns}번 "
                  f"말을 걸어 주셨습니다.") if profile.visits > 1 else \
                 "오늘 처음 오셨는데 꽤 많은 이야기를 해 주셨습니다."
    depth_line = {
        0: "종교 이야기는 넣지 않았습니다. 꺼내지 않으셨으니까요.",
        1: "중간에 오래된 이야기를 한두 편 넣었습니다. 출처는 적지 않았습니다.",
        2: "뒷부분에는 믿음의 언어로 쓴 대목이 있습니다. "
           "그 이야기를 먼저 꺼내 주셨기 때문입니다.",
    }[profile.depth]
    if profile.faith_blocked:
        depth_line = ("종교 이야기는 넣지 않았습니다. "
                      "원하지 않는다고 하신 것을 기억하고 있습니다.")

    return (
        (None, (
            "이 책은 당신을 위해 만들었습니다.",
            f"{profile.made_on} 에 만들었습니다.",
        )),
        ("어떻게 고른 책인가", (
            visit_line,
            f"그중 {listed} 에 대한 이야기가 가장 많았습니다. "
            "그래서 그 장부터 담았습니다.",
            depth_line,
        )),
        ("적지 않은 것", (
            "당신이 쓴 문장은 이 책에 한 글자도 들어 있지 않습니다.",
            "무엇에 대해 이야기했는지만 남기고, 무슨 말을 했는지는 "
            "가져오지 않았습니다. 이 파일을 다른 사람이 열어도 "
            "당신의 이야기는 알 수 없습니다.",
            "이름도, 연락처도, 아이디도 없습니다. 원래 받지 않았습니다.",
        )),
        ("이 책의 값", (
            "없습니다. 당신 책입니다.",
            "이 사이트에는 파는 책이 따로 하나 있고, 그 수익은 전쟁으로 "
            "부모를 잃은 아이들과 남겨진 가족들에게 전액 전달됩니다. "
            "마음이 생기시면 그때 보시면 됩니다. 지금은 아닙니다.",
        )),
        ("한 가지 부탁", (
            "이 책은 치료가 아닙니다. 많이 위험하다고 느끼시면 "
            "책을 덮고 먼저 사람에게 연락해 주십시오.",
            "자살예방 상담전화 109. 24시간, 무료입니다.",
        )),
    )


def _back(profile: Profile, site_url: str) -> tuple:
    base = site_url.rstrip("/") if site_url else ""
    again = (f"{base}/counsel",) if base else ()
    streak = (f"{profile.streak}일째 함께 걷고 있습니다."
              if profile.streak >= 2 else "내일 또 오셔도 됩니다.")
    return (
        ("다 읽으셨다면", (
            "이 책이 문제를 해결해 주지는 못했을 겁니다.",
            "다만 오늘 혼자가 아니셨으면 합니다.",
            streak,
        )),
        ("또 오셔도 됩니다", (
            "이야기가 쌓이면 이 책도 달라집니다. "
            "다음에 만들면 다른 장이 들어올 겁니다.",
            "이름도 연락처도 묻지 않습니다. 아무 때나 오십시오.",
        ) + again),
    )


# ══════════════════════════════════════════════════════════════════════
# 조립
# ══════════════════════════════════════════════════════════════════════
def build_personal_book(profile: Profile, site_url: str = "") -> Book:
    """그 사람을 위한 책 한 권."""
    chapters: List[Chapter] = []
    no = 1

    # 1부 — 실제로 꺼낸 주제
    labels: List[str] = []
    for key in profile.topics:
        topic = topics_mod.get(key)
        if topic.min_depth > profile.depth:
            continue
        ch = chapter_for_topic(no, key, profile.depth)
        chapters.append(ch)
        labels.append(topic.label)
        no += 1

    if not labels:                       # 주제를 못 고른 경우의 안전망
        for key in ("지침", "외로움", "의미"):
            chapters.append(chapter_for_topic(no, key, profile.depth))
            labels.append(topics_mod.get(key).label)
            no += 1

    taken = [c.topic for c in chapters]

    # 2부 — 아직 꺼내지 않았지만 곁에 있을 만한 이야기
    for key in _next_topics(profile, taken):
        ch = chapter_for_topic(no, key, profile.depth)
        chapters.append(Chapter(
            no=ch.no, part=PART_WALK, title=ch.title, body=ch.body,
            question=ch.question, step=ch.step, closing=ch.closing,
            verse_key=ch.verse_key, topic=ch.topic))
        no += 1

    # 걷고 있는 여정이 있으면 다음 걸음을 함께 넣는다
    for slug, walked in profile.path_steps.items():
        try:
            journey = paths_mod.get(slug)
        except KeyError:
            continue
        if walked >= journey.days:
            continue
        st = journey.step(walked + 1)
        if st.depth > profile.depth:
            continue
        chapters.append(Chapter(
            no=no, part=PART_WALK,
            title=f"{journey.title} · {st.no}걸음 — {st.title}",
            body=st.body, question=st.question, step=st.action,
            closing=st.closing,
            verse_key=st.verses[0] if st.verses else ""))
        no += 1

    # 3부 — 실천
    practice = _practice_chapter(no, faith=profile.depth >= depth_mod.FAITH)
    chapters.append(Chapter(
        no=no, part=PART_DO, title=practice.title, body=practice.body,
        question=practice.question, step=practice.step,
        closing=practice.closing))

    return Book(
        title="당신을 위한 책",
        subtitle=f"{', '.join(labels[:3])}에 대하여",
        author="하나의 길",
        language="ko",
        identifier=f"urn:uuid:oneway-personal-{profile.made_on}",
        description="상담에서 나눈 이야기에 맞춰 만든 책입니다. "
                    "당신이 쓴 문장은 들어 있지 않습니다.",
        keywords=tuple(labels[:6]),
        front=_front(profile, labels),
        chapters=chapters,
        back=_back(profile, site_url),
        appendix=APPENDIX[:2],          # 긴급 연락처 + 날짜 경고
    )


PART_INTROS.update({
    PART_MINE: (
            "여기 담긴 것은 당신이 실제로 꺼낸 이야기들입니다.",
        "많이 이야기한 순서대로 두었습니다. 처음부터 읽지 않으셔도 됩니다.",
    ),
    PART_WALK: (
        "아직 꺼내지 않으셨지만, 대체로 앞의 이야기와 같이 오는 것들입니다.",
        "해당되지 않으면 넘기셔도 됩니다.",
    ),
    PART_DO: part_intro(PART3),
})
