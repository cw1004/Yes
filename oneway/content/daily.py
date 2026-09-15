# -*- coding: utf-8 -*-
"""하루 3분 — 이 사이트의 대표 콘텐츠이자 재방문 장치.

매일 딱 하나만 제공한다.

    ① 오늘의 말씀  ② 오늘의 질문  ③ 오늘의 기도  ④ 오늘의 사랑

주기가 서로 다른 두 바퀴(50일 콘텐츠 / 30일 사랑 실천)를 겹쳐 돌리기 때문에
같은 조합은 150일에 한 번만 돌아온다. 날짜만 알면 누구에게나 같은 화면이
나오므로 서버에 아무것도 저장하지 않아도 되고, 정적 빌드도 가능하다.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, timedelta
from typing import Dict, List, Optional

from . import fifty, verses

# 콘텐츠 순환의 기준일. 바꾸면 전체 순서가 밀리므로 고정한다.
EPOCH = date(2025, 1, 1)

# 30일 사랑의 실천 — 돈이 들지 않고, 오늘 안에 끝낼 수 있고,
# 결과가 남의 얼굴에 나타나는 것만 고른다.
LOVE_30: List[str] = [
    "오늘 만난 사람 한 명의 이름을 불러 인사하기",
    "고맙다는 말을 한 번 더 하기",
    "가족에게 평소보다 한 톤 낮춰 말하기",
    "연락이 끊긴 사람에게 안부 한 줄 보내기",
    "누군가의 말을 끝까지 자르지 않고 듣기",
    "오늘 하루 험담 한 번 참기",
    "집안일 하나를 말없이 대신 해 두기",
    "아픈 사람에게 '내일 또 연락할게' 말하기",
    "미안하다고 먼저 말하기",
    "식당이나 가게에서 일하는 분에게 눈 맞추며 인사하기",
    "잘한 일을 본 사람에게 그 자리에서 말해 주기",
    "오늘 한 사람을 위해 30초 기도하기",
    "버스나 지하철에서 자리 양보하기",
    "혼자 있는 사람 옆에 가서 앉기",
    "거절당해도 기분 나빠하지 않기",
    "가족의 이야기를 10분 동안 질문만 하며 듣기",
    "작은 금액이라도 남을 위해 쓰기",
    "오늘 누군가의 실수를 그냥 넘어가 주기",
    "부모님께 전화 한 통 하기",
    "좋아하는 것을 한 사람에게 나눠 주기",
    "내가 어려워하는 사람에게 먼저 인사하기",
    "동료 한 명에게 '고생했다'고 말하기",
    "쓰레기 하나 대신 줍기",
    "아이 눈높이에 맞춰 앉아 이야기하기",
    "오늘 하루 휴대폰 없이 한 끼 먹기",
    "누군가를 위해 문을 잡아 주기",
    "칭찬을 아끼지 않기",
    "생각만 해도 불편한 사람의 이름을 기도에 넣기",
    "오늘 도움받은 일을 기억해 두었다가 갚기",
    "가장 가까운 사람에게 사랑한다고 말하기",
]

# 이번 주의 질문 — 하루보다 조금 더 오래 머무는 질문.
WEEKLY_QUESTIONS: List[str] = [
    "나는 요즘 무엇 때문에 불안합니까?",
    "내가 가장 미루고 있는 관계는 누구입니까?",
    "지금 내 삶에서 감사한 것 세 가지는 무엇입니까?",
    "나는 어떤 사람으로 기억되고 싶습니까?",
    "내가 아직 용서하지 못한 사람은 누구입니까?",
    "요즘 내 시간은 주로 어디에 쓰이고 있습니까?",
    "내가 마지막으로 진심을 말한 것은 언제입니까?",
    "지금 내게 가장 필요한 한 마디는 무엇입니까?",
    "나는 무엇을 가장 두려워하고 있습니까?",
    "내가 도울 수 있는 사람은 지금 누구입니까?",
    "나는 무엇을 위해 이 하루를 살고 있습니까?",
    "내가 가장 나다웠던 순간은 언제였습니까?",
    "요즘 나를 가장 지치게 하는 것은 무엇입니까?",
]


def day_index(on: Optional[date] = None) -> int:
    """기준일로부터 며칠째인지. 음수도 그대로 순환하도록 처리한다."""
    on = on or date.today()
    return (on - EPOCH).days


@dataclass
class Daily:
    """하루치 카드 하나."""
    day: str                # YYYY-MM-DD
    index: int
    belief_no: int
    belief_title: str
    belief_url: str
    verse_ref: str
    verse_ref_protestant: str
    verse_gist: str
    question: str
    prayer: str
    love: str
    weekly_question: str
    tomorrow_teaser: str    # 내일 다시 올 이유

    def to_dict(self) -> Dict:
        return asdict(self)


def _teaser(b: fifty.Belief) -> str:
    return f"내일은 「{b.title}」 — {b.seo_title.split('?')[0].strip()}"


def build(on: Optional[date] = None) -> Daily:
    on = on or date.today()
    idx = day_index(on)
    b = fifty.of_the_day(idx)
    v = verses.get(b.verses[0])
    tomorrow = fifty.of_the_day(idx + 1)
    return Daily(
        day=on.isoformat(),
        index=idx,
        belief_no=b.no,
        belief_title=b.title,
        belief_url=b.url,
        verse_ref=v.ref,
        verse_ref_protestant=v.ref_protestant,
        verse_gist=v.gist,
        question=b.question,
        prayer=b.prayer,
        love=LOVE_30[idx % len(LOVE_30)],
        weekly_question=WEEKLY_QUESTIONS[(idx // 7) % len(WEEKLY_QUESTIONS)],
        tomorrow_teaser=_teaser(tomorrow),
    )


def range_days(start: date, days: int) -> List[Daily]:
    """정적 빌드/미리보기용 — 며칠치를 한 번에."""
    return [build(start + timedelta(days=i)) for i in range(days)]
