# -*- coding: utf-8 -*-
"""상담 엔진 — 한 번의 대화를 조립하는 곳.

  입력 → ① 안전 점검 → ② 깊이 판정 → ③ 주제 분류
       → ④ 응답 생성(Claude 또는 규칙) → ⑤ 콘텐츠 연결 → ⑥ 다시 올 이유

③④ 가 실패해도 ①②⑤⑥ 은 항상 동작한다. 그래서 키가 없어도 서비스가 된다.

응답은 **한 덩어리의 말**로 나간다. "①공감 ②말씀 ③질문" 같은 딱지를 붙이지 않는다.
사람은 딱지가 붙은 말을 상담으로 받아들이지 않는다.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Dict, List, Optional

from ..config import Config
from ..content import daily as daily_mod
from ..content import entries as entries_mod
from ..content import fifty
from ..book import personal as personal_mod
from ..content import paths as paths_mod
from ..content import verses as verses_mod
from . import depth as depth_mod
from . import llm, persona, safety, topics as topics_mod
from .session import Visitor


# 날짜·집단 압박 신호를 받았을 때 되묻는 말.
# 이럴 때는 일반적인 상담 질문보다 이쪽이 먼저다.
PRESSURE_QUESTION = {
    "date": "그 말을 들었을 때 어떤 기분이 드셨습니까? 안심이 되던가요, 더 조급해지던가요?",
    "group": "그 모임 밖에, 지금 상황을 그대로 말할 수 있는 사람이 한 명이라도 있습니까?",
}


# 신앙 색을 띈 입구들. 깊이 0 에서는 이쪽으로 안내하지 않는다.
# ('믿음의 질문', '교회와 전통' 같은 링크 이름 자체가 이미 신호다.)
DEEP_GATES = {"faith", "bible", "church"}
SURFACE_GATE = "heart"


# 깊이 0~1 에서 쓰는 '다시 올 이유'.
# 「50가지」 예고는 제목 자체가 신앙 언어라서 여기서는 쓰지 않는다.
NEUTRAL_FOLLOW_UP: List[str] = [
    "내일 이 시간에 또 오셔도 됩니다. 오늘 하신 이야기는 기억해 두겠습니다.",
    "오늘 한 걸음이 어떻게 됐는지 다음에 알려 주셔도 좋고요.",
    "여기는 늘 열려 있습니다. 급할 것 없습니다.",
    "다음에 오시면 오늘 이야기부터 이어 가겠습니다.",
    "하루에 3분이면 충분합니다. 내일도 그 정도만.",
]


@dataclass
class Link:
    label: str
    url: str
    kind: str = "belief"     # belief | gate | page | action

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Reply:
    """상담사 한 번의 응답.

    ``text`` 가 실제로 화면에 나가는 말이다. 나머지 필드는 화면 구성과
    로그·검수를 위해 따로 들고 있는 것이다.
    """
    text: str                          # 화면에 나가는 말 (문단 구분은 빈 줄)
    source: str                        # claude | offline | safety | opener | identity
    topic: str = ""
    topic_label: str = ""
    risk: str = "none"
    depth: int = 0
    hotlines: List[str] = field(default_factory=list)
    links: List[Link] = field(default_factory=list)
    verse_ref: str = ""                # 깊이 2 이상에서만 채워진다
    verse_gist: str = ""
    follow_up: str = ""                # 다시 올 이유
    note: str = ""                     # 필요할 때만 붙는 안내 (매번 붙이지 않는다)
    path_url: str = ""                 # 여러 날에 걸쳐 갈 길을 권할 때
    book_url: str = ""                 # 그 사람을 위한 책 (무료)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["links"] = [l.to_dict() if isinstance(l, Link) else l for l in self.links]
        return d

    def as_text(self) -> str:
        """CLI 출력용."""
        out = [self.text]
        if self.hotlines:
            out += ["", *(f"  · {h}" for h in self.hotlines)]
        if self.links:
            out += ["", *(f"  → {l.label}  {l.url}" for l in self.links)]
        if self.follow_up:
            out += ["", self.follow_up]
        if self.note:
            out += ["", f"({self.note})"]
        return "\n".join(out)


class Counselor:
    """상담사. 서버·CLI 양쪽에서 같은 객체를 쓴다."""

    def __init__(self, cfg: Optional[Config] = None, rng: Optional[random.Random] = None):
        self.cfg = cfg or Config()
        self.rng = rng or random.Random()
        self.voice = persona.Voice(self.rng)

    # ------------------------------------------------------------ 진입점
    def respond(self, message: str, visitor: Optional[Visitor] = None,
                today: Optional[date] = None) -> Reply:
        message = (message or "").strip()
        today = today or date.today()

        risk = safety.assess(message)

        # 종교 이야기를 원하지 않는다고 한 번이라도 말했다면 영구히 기억한다
        if visitor and depth_mod.declines(message):
            visitor.block_faith()
        blocked = visitor.faith_blocked if visitor else False
        carried = visitor.depth if visitor else depth_mod.OPEN
        level, _ = depth_mod.resolve(message, carried, blocked)

        topic = self._pick_topic(message, visitor, level)
        turn_no = (visitor.turn_no(topic.key) + 1) if visitor else 1

        if visitor:
            visitor.add_turn("user", message, topic.key, risk.level)
            visitor.open_depth(level)

        if risk.urgent:
            reply = self._safety_reply(risk, level)
        elif persona.asks_identity(message):
            reply = self._identity_reply(level, topic)
        elif self._is_greeting(message):
            reply = self._opener(visitor, level, turn_no)
        else:
            reply = (self._claude_reply(message, topic, turn_no, level, visitor, risk)
                     or self._offline_reply(topic, turn_no, level, risk))

        reply.depth = level
        # 날짜를 정해 주거나 통제하는 집단의 신호는 깊이와 무관하게 다룬다.
        # 안전 문제라서 깊이 0 에서도 그대로 나간다.
        self._warn_about_pressure(reply, message, level)
        self._attach_links(reply, topic, risk, level, blocked)
        self._offer_path(reply, topic, turn_no, visitor, risk)
        self._offer_personal_book(reply, visitor, risk, today)
        reply.follow_up = self._follow_up(visitor, today, level, turn_no, blocked)

        if visitor:
            visitor.add_turn("counselor", reply.text, topic.key, risk.level)
        return reply

    # ------------------------------------------------------------ 선택
    def _pick_topic(self, message: str, visitor: Optional[Visitor],
                    level: int) -> topics_mod.Topic:
        """주제를 고른다.

        두 번째 발화부터는 보통 앞말을 이어받는다("그때 그 사람이…").
        그런 문장에는 단서가 없으므로, 분류에 실패하면 **직전 주제를 유지**한다.
        이것이 없으면 대화가 한 번 주고받을 때마다 처음으로 돌아간다.

        아직 열리지 않은 깊이를 요구하는 주제는 고르지 않는다.
        """
        for t, _ in topics_mod.classify(message, limit=3):
            if t.min_depth <= level:
                return t
        if visitor:
            for key in visitor.recent_topics(2):
                t = topics_mod.BY_KEY.get(key)
                if t and t.min_depth <= level:
                    return t
        return topics_mod.get(topics_mod.DEFAULT_KEY)

    def _is_greeting(self, message: str) -> bool:
        if len(message) > 12:
            return False
        low = message.lower()
        return (not message) or any(
            g in low for g in ("안녕", "하이", "ㅎㅇ", "hello", "hi", "반갑"))

    # ------------------------------------------------------------ 각 경로
    def _opener(self, visitor: Optional[Visitor], level: int, turn_no: int) -> Reply:
        returning = bool(visitor and visitor.returning)
        line = self.voice.opener(returning, turn_no)
        if returning and visitor.streak >= 3:
            line = f"{line} {visitor.streak}일째네요."
        return Reply(text=persona.join([line, self.rng.choice([
            "오늘은 어떤 이야기가 있으셨습니까.",
            "지금 가장 마음에 걸리는 일이 뭔가요.",
            "무엇 때문에 오셨는지 편하게 쓰셔도 됩니다."])]),
            source="opener", topic="입문", topic_label="처음", depth=level)

    def _identity_reply(self, level: int, topic: topics_mod.Topic) -> Reply:
        """정체를 물으면 즉시, 정직하게 답한다. 얼버무리지 않는다."""
        return Reply(text=self.voice.identity(), source="identity",
                     topic=topic.key, topic_label=topic.label, depth=level)

    def _safety_reply(self, risk: safety.Risk, level: int) -> Reply:
        lines = safety.crisis_message(risk, self.cfg.crisis_region)
        return Reply(
            text=persona.join(lines),
            source="safety", topic="위기", topic_label="지금 위험할 때",
            risk=risk.level, depth=level,
            hotlines=safety.hotline_lines(self.cfg.crisis_region),
        )

    def _claude_reply(self, message: str, topic: topics_mod.Topic, turn_no: int,
                      level: int, visitor: Optional[Visitor],
                      risk: safety.Risk) -> Optional[Reply]:
        if self.cfg.counselor == "offline" or not llm.available(self.cfg):
            return None

        history = visitor.history_for_llm() if visitor else None
        if history and history[-1]["content"] == message:
            history = history[:-1]        # 이번 발화는 llm 쪽에서 붙인다

        data = llm.counsel(self.cfg, message, topic, turn_no, level,
                           history, self._memo(visitor, risk))
        if not data:
            return None

        reply = Reply(text=data["text"], source="claude", topic=topic.key,
                      topic_label=topic.label, risk=risk.level, depth=level)
        if level >= depth_mod.FAITH:
            self._set_verse(reply, data.get("verse_key", ""), topic, turn_no, level)
        if risk.level == "watch":
            reply.hotlines = safety.hotline_lines(self.cfg.crisis_region)[:3]
            reply.note = persona.SOFT_NOTE
        return reply

    def _offline_reply(self, topic: topics_mod.Topic, turn_no: int,
                       level: int, risk: safety.Risk) -> Reply:
        """규칙 기반 응답 — 조각을 문단으로 이어 한 덩어리의 말로 만든다."""
        i = max(0, turn_no - 1)
        v = self.voice
        parts: List[str] = [v.pick(list(topic.empathy), turn_no)]

        if risk.level == "watch":
            parts.insert(0, "그 말을 꺼내 주셔서 고맙습니다. 많이 힘드신 것 같습니다.")

        # 관점 — 회차가 올라갈수록 다른 각도를 꺼낸다
        parts.append(topic.insight[i % len(topic.insight)])

        if level >= depth_mod.FAITH and topic.faith_insight:
            parts.append(topic.faith_insight[i % len(topic.faith_insight)])
        elif level == depth_mod.STORY and topic.story:
            parts.append(v.pick(persona.BEFORE_STORY) + " "
                         + topic.story[i % len(topic.story)])

        # 질문 — 매번 같은 자리에서 시작하지 않게 한다
        q = topic.questions[min(i, len(topic.questions) - 1)]
        lead = v.pick(persona.BEFORE_QUESTION, turn_no)
        parts.append((lead + " " + q).strip())

        # 첫 마디에는 처방하지 않는다.
        # 듣자마자 해결책을 내미는 것이 가장 상담답지 않은 행동이다.
        if turn_no >= 2:
            steps = list(topic.steps)
            if level >= depth_mod.FAITH and topic.faith_steps:
                steps = steps + list(topic.faith_steps)
            step = steps[i % len(steps)]
            lead = v.pick(persona.BEFORE_STEP, turn_no)
            parts.append((lead + " " + step).strip())

        # 들고 갈 한 줄 — 대화가 좀 쌓였을 때만. 매번 붙이면 상투적으로 읽힌다.
        if turn_no >= 3:
            if level >= depth_mod.FAITH:
                parts.append(f"오늘 이 한 줄만 들고 가셔도 됩니다. “{topic.prayer}”")
            else:
                parts.append(topic.closing[i % len(topic.closing)])

        reply = Reply(text=persona.join(parts), source="offline", topic=topic.key,
                      topic_label=topic.label, risk=risk.level, depth=level)
        if level >= depth_mod.FAITH:
            self._set_verse(reply, "", topic, turn_no, level)
        if risk.level == "watch":
            reply.hotlines = safety.hotline_lines(self.cfg.crisis_region)[:3]
            reply.note = persona.SOFT_NOTE
        return reply

    # ------------------------------------------------------------ 보조
    def _warn_about_pressure(self, reply: Reply, message: str, level: int) -> None:
        """날짜를 정해 주는 사람, 통제하는 집단에 대한 경고.

        이 사이트는 두려움으로 사람을 모으지 않는다. 그래서 반대로 경고한다.
        위기 응답에는 덧붙이지 않는다. 그때는 다른 것이 먼저다.
        """
        if reply.source == "safety":
            return
        pressure = safety.assess_pressure(message)
        if not pressure.any:
            return
        lines = safety.pressure_message(pressure)
        if pressure.date_setting and level >= depth_mod.FAITH:
            lines.append(
                "성경 자체가 그날과 그 시간은 아무도 모른다고 못 박습니다. "
                "천사도 모르고 아들도 모른다고 합니다. "
                "가톨릭도 개신교도 이 점에서는 갈리지 않습니다.")
        lines.append(PRESSURE_QUESTION[
            "group" if pressure.group_pressure else "date"])

        # 일반 상담 내용 뒤에 붙이면 정작 중요한 말이 다섯 문단 뒤로 밀린다.
        # 받아 주는 첫 문단만 남기고 곧바로 이 이야기를 한다.
        opening = reply.text.split("\n\n")[0] if reply.text else ""
        reply.text = persona.join([opening] + lines)
        reply.note = persona.SOFT_NOTE

    def _offer_path(self, reply: Reply, topic: topics_mod.Topic, turn_no: int,
                    visitor: Optional[Visitor], risk: safety.Risk) -> None:
        """한 번에 정리되지 않는 고민에는 여러 날에 걸쳐 갈 길을 권한다.

        한 번만 권한다. 두 번 권하면 광고가 된다.
        대화가 한 번은 오간 뒤에 권한다. 첫마디부터 링크를 내미는 건 상담이 아니다.
        """
        if risk.urgent or turn_no < 2:
            return
        path = paths_mod.for_topic(topic.key)
        if not path:
            return
        if visitor:
            walked = visitor.path_step(path.slug)
            if walked:
                # 이미 걷고 있는 사람에게는 다음 걸음을 가리킨다
                if walked < path.days:
                    nxt = walked + 1
                    reply.path_url = path.step_url(nxt)
                    reply.links.insert(0, Link(
                        f"{nxt}번째 걸음 — {path.step(nxt).title}",
                        reply.path_url, "path"))
                return
            if not visitor.offer_path(path.slug):
                return
        reply.path_url = path.url
        reply.text = persona.join([reply.text,
            f"이건 한 번에 정리되는 이야기가 아닙니다. "
            f"「{path.title}」이라고, 하루에 한 걸음씩 가는 길을 만들어 뒀습니다. "
            f"하루 3분이면 되고, 중간에 멈추셔도 됩니다."])
        reply.links.insert(0, Link(path.title, path.url, "path"))

    def _offer_personal_book(self, reply: Reply, visitor: Optional[Visitor],
                             risk: safety.Risk, today: date) -> None:
        """이야기가 쌓이면 그 사람을 위한 책을 만들어 준다.

        위기 상황에서는 권하지 않는다. 그때 필요한 건 파일이 아니라 전화번호다.
        값은 받지 않는다. 마음을 쏟아낸 직후에 값을 붙이는 건 상담이 아니다.
        """
        if risk.urgent or not visitor:
            return
        profile = personal_mod.build_profile(visitor, today)
        if not profile.enough:
            return
        if not visitor.offer_book(today):
            return
        reply.book_url = "/my-book"
        reply.text = persona.join([reply.text,
            "여기까지 하신 이야기로 책을 한 권 묶어 두었습니다. "
            "당신이 꺼낸 이야기만 골라 담았고, 당신이 쓴 문장은 "
            "한 글자도 넣지 않았습니다. 값은 없습니다."])
        reply.links.insert(0, Link("당신을 위한 책 (무료)", "/my-book", "book"))

    def _set_verse(self, reply: Reply, key: str, topic: topics_mod.Topic,
                   turn_no: int, level: int) -> None:
        """성경 주소는 **깊이 2 이상에서만** 붙는다.

        같은 사람에게 같은 구절을 반복하지 않도록 회차마다 돌려 가며 고른다.
        교파 표기를 둘 다 보여 주는 것은 상대가 교파를 물었을 때(깊이 3)뿐이다.
        """
        if level < depth_mod.FAITH:
            return
        candidates = ([key] if key else []) + list(topic.verses)
        candidates = [c for c in candidates if c in verses_mod.BY_KEY]
        if not candidates:
            return
        v = verses_mod.get(candidates[0] if key
                           else candidates[(turn_no - 1) % len(candidates)])
        reply.verse_ref = v.both if level >= depth_mod.TRADITION else v.ref
        reply.verse_gist = v.gist
        lead = self.voice.pick(persona.BEFORE_VERSE, turn_no)
        reply.text = persona.join([reply.text,
                                   f"{lead} {reply.verse_ref} — {v.gist}"])

    def _memo(self, visitor: Optional[Visitor], risk: safety.Risk) -> str:
        if not visitor:
            return ""
        bits: List[str] = []
        if visitor.returning:
            bits.append(f"{visitor.visit_count}번째 방문, {visitor.streak}일 연속")
        recent = visitor.recent_topics(3)
        if recent:
            bits.append("최근 주제: " + ", ".join(recent))
        it = visitor.open_intention()
        if it:
            bits.append(f"지난번 맡긴 바람: {it.text}")
        if risk.level == "watch":
            bits.append("주의: 무기력·소진 신호가 보입니다. 밝은 말로 서두르지 마십시오.")
        if visitor.faith_blocked:
            bits.append("이 사람은 종교 이야기를 원하지 않는다고 말했습니다. 절대 꺼내지 마십시오.")
        return " / ".join(bits)

    def _attach_links(self, reply: Reply, topic: topics_mod.Topic,
                      risk: safety.Risk, level: int, blocked: bool) -> None:
        """대화를 콘텐츠로 연결한다 — 상담이 일회성으로 끝나지 않게 하는 장치.

        깊이 0 에서는 신앙 콘텐츠를 걸지 않는다. 마음에 대한 것만 건다.
        """
        links: List[Link] = []
        if risk.urgent:
            reply.links = [Link("마음의 쉼", "/gate/heart", "gate")]
            return

        if level >= depth_mod.FAITH and not blocked:
            for no in topic.beliefs[:2]:
                b = fifty.get(no)
                links.append(Link(f"{b.no}. {b.title}", b.url, "belief"))
            if topic.key in ("교회상처", "돌아옴"):
                links.append(Link("나는 교회를 떠났습니다", "/left-church", "page"))
            if topic.key == "교파" or level >= depth_mod.TRADITION:
                links.append(Link("각 전통을 직접 알아보기", "/traditions", "page"))
        else:
            slug = SURFACE_GATE if topic.gate in DEEP_GATES else topic.gate
            try:
                gate = entries_mod.get(slug)
                links.append(Link(gate.title, gate.url, "gate"))
            except KeyError:
                pass

        links.append(Link("오늘의 하루 3분", "/today", "action"))
        reply.links = links

    def _follow_up(self, visitor: Optional[Visitor], today: date, level: int,
                   turn_no: int, blocked: bool) -> str:
        """다시 올 이유를 하나 남긴다. 매번 같은 말을 하지 않는다."""
        it = visitor.open_intention() if visitor else None
        if it and self.rng.random() < 0.5:
            return f"지난번에 “{it.text}” 하고 남기셨지요. 그 뒤로 좀 어떻게 되었습니까."
        if visitor and visitor.streak >= 2:
            return f"{visitor.streak}일째 함께 걷고 있습니다. 내일도 여기 있겠습니다."
        invite = depth_mod.invitation(level, turn_no, blocked)
        if invite:
            return invite
        if level >= depth_mod.FAITH and not blocked:
            card = daily_mod.build(today)
            return f"{card.tomorrow_teaser} 내일 또 오셔도 됩니다."
        return self.rng.choice(NEUTRAL_FOLLOW_UP)
