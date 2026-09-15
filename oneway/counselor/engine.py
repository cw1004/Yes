# -*- coding: utf-8 -*-
"""상담 엔진 — 한 번의 대화를 조립하는 곳.

  입력 → ① 안전 점검 → ② 주제 분류 → ③ 응답 생성(Claude 또는 규칙)
       → ④ 콘텐츠 연결 → ⑤ 다시 올 이유

③ 이 실패해도 ①②④⑤ 는 항상 동작한다. 그래서 키가 없어도 서비스가 된다.
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
from ..content import verses as verses_mod
from . import llm, safety, topics as topics_mod
from .session import Visitor

GREETINGS = ("안녕", "하이", "ㅎㅇ", "hello", "hi", "반갑")

# 인사만 왔을 때 — 바로 상담하지 않고 말을 걸어 준다.
OPENERS: List[str] = [
    "안녕하세요. 여기서는 먼저 듣습니다.",
    "오셨군요. 편하게 말씀하셔도 됩니다.",
    "안녕하세요. 정리되지 않은 문장이어도 괜찮습니다.",
]

OPENER_HINTS: List[str] = [
    "요즘 마음이 어떠십니까?",
    "지금 가장 마음에 걸리는 일은 무엇입니까?",
    "무엇 때문에 여기까지 오셨습니까?",
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
    """상담사 한 번의 응답."""
    source: str                       # claude | offline | safety | opener
    topic: str
    topic_label: str
    risk: str
    listen: str
    insight: str = ""
    verse_ref: str = ""
    verse_ref_protestant: str = ""
    verse_gist: str = ""
    question: str = ""
    prayer: str = ""
    step: str = ""
    hotlines: List[str] = field(default_factory=list)
    links: List[Link] = field(default_factory=list)
    follow_up: str = ""               # 다시 올 이유
    disclaimer: str = ""

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["links"] = [l.to_dict() if isinstance(l, Link) else l for l in self.links]
        return d

    def as_text(self) -> str:
        """CLI 출력용."""
        out: List[str] = [self.listen]
        if self.hotlines:
            out += ["", *(f"  · {h}" for h in self.hotlines)]
        if self.insight:
            out += ["", self.insight]
        if self.verse_ref:
            out += ["", f"📖 {self.verse_ref}  ({self.verse_ref_protestant})",
                    f"   {self.verse_gist}",
                    "   직접 펴서 읽어 보십시오."]
        if self.question:
            out += ["", f"❓ {self.question}"]
        if self.prayer:
            out += ["", f"🙏 {self.prayer}"]
        if self.step:
            out += ["", f"👣 오늘의 한 걸음 — {self.step}"]
        if self.links:
            out += ["", "함께 읽어 보세요:"]
            out += [f"   - {l.label}  {l.url}" for l in self.links]
        if self.follow_up:
            out += ["", self.follow_up]
        if self.disclaimer:
            out += ["", f"({self.disclaimer})"]
        return "\n".join(out)


class Counselor:
    """상담사. 서버·CLI 양쪽에서 같은 객체를 쓴다."""

    def __init__(self, cfg: Optional[Config] = None, rng: Optional[random.Random] = None):
        self.cfg = cfg or Config()
        self.rng = rng or random.Random()

    # ------------------------------------------------------------ 진입점
    def respond(self, message: str, visitor: Optional[Visitor] = None,
                today: Optional[date] = None) -> Reply:
        message = (message or "").strip()
        today = today or date.today()

        risk = safety.assess(message)
        topic = self._pick_topic(message, visitor)
        turn_no = (visitor.turn_no(topic.key) + 1) if visitor else 1

        if visitor:
            visitor.add_turn("user", message, topic.key, risk.level)

        if risk.urgent:
            reply = self._safety_reply(risk, topic)
        elif self._is_greeting(message):
            reply = self._opener(visitor)
        else:
            reply = (self._claude_reply(message, topic, turn_no, visitor, risk)
                     or self._offline_reply(message, topic, turn_no, visitor, risk))

        self._attach_links(reply, topic, risk)
        reply.follow_up = self._follow_up(visitor, today)
        reply.disclaimer = safety.disclaimer()

        if visitor:
            visitor.add_turn("counselor", reply.listen, topic.key, risk.level)
        return reply

    # ------------------------------------------------------------ 각 경로
    def _pick_topic(self, message: str, visitor: Optional[Visitor]) -> topics_mod.Topic:
        """주제를 고른다.

        두 번째 발화부터는 보통 앞말을 이어받는다("그때 그 사람이…").
        그런 문장에는 단서가 없으므로, 분류에 실패하면 **직전 주제를 유지**한다.
        이것이 없으면 대화가 한 번 주고받을 때마다 처음으로 돌아간다.
        """
        hits = topics_mod.classify(message, limit=1)
        if hits:
            return hits[0][0]
        if visitor:
            for key in visitor.recent_topics(1):
                if key in topics_mod.BY_KEY:
                    return topics_mod.get(key)
        return topics_mod.get(topics_mod.DEFAULT_KEY)

    def _is_greeting(self, message: str) -> bool:
        if len(message) > 12:
            return False
        low = message.lower()
        return any(g in low for g in GREETINGS) or not message

    def _opener(self, visitor: Optional[Visitor]) -> Reply:
        listen = self.rng.choice(OPENERS)
        if visitor and visitor.returning:
            listen = f"다시 오셨군요. 반갑습니다. ({visitor.streak}일째 함께 걷고 있습니다.)"
        return Reply(source="opener", topic="입문", topic_label="처음",
                     risk="none", listen=listen,
                     question=self.rng.choice(OPENER_HINTS))

    def _safety_reply(self, risk: safety.Risk, topic: topics_mod.Topic) -> Reply:
        lines = safety.crisis_message(risk, self.cfg.crisis_region)
        return Reply(
            source="safety", topic=topic.key, topic_label=topic.label,
            risk=risk.level,
            listen="\n\n".join(lines[:3]),
            insight="\n\n".join(lines[3:]),
            hotlines=safety.hotline_lines(self.cfg.crisis_region),
            question="",
            prayer="하느님, 지금 이 사람 곁에 있어 주십시오.",
            step="지금 옆에 있는 사람 한 명에게 “조금 힘들다”고만 말해 보세요.",
        )

    def _claude_reply(self, message: str, topic: topics_mod.Topic, turn_no: int,
                      visitor: Optional[Visitor], risk: safety.Risk) -> Optional[Reply]:
        if self.cfg.counselor == "offline":
            return None
        if not llm.available(self.cfg):
            return None

        memo = self._memo(visitor, risk)
        history = visitor.history_for_llm() if visitor else None
        # 방금 넣은 이번 발화는 llm.counsel 이 다시 붙이므로 제거한다
        if history and history[-1]["content"] == message:
            history = history[:-1]

        data = llm.counsel(self.cfg, message, topic, turn_no, history, memo)
        if not data:
            return None

        reply = Reply(source="claude", topic=topic.key, topic_label=topic.label,
                      risk=risk.level, listen=data["listen"],
                      insight=data["insight"], question=data["question"],
                      prayer=data["prayer"], step=data["step"])
        key = data.get("verse_key") or (topic.verses[0] if topic.verses else "")
        self._set_verse(reply, key, topic, turn_no)
        return reply

    def _offline_reply(self, message: str, topic: topics_mod.Topic, turn_no: int,
                       visitor: Optional[Visitor], risk: safety.Risk) -> Reply:
        i = max(0, turn_no - 1)
        listen = topic.empathy[i % len(topic.empathy)]
        if risk.level == "watch":
            listen = ("그 말을 꺼내 주셔서 고맙습니다. 지금 많이 힘드신 것 같습니다.\n\n"
                      + listen)
        insight = " ".join(topic.insight[: 2 if turn_no == 1 else 3])
        reply = Reply(
            source="offline", topic=topic.key, topic_label=topic.label,
            risk=risk.level, listen=listen, insight=insight,
            question=topic.questions[min(i, len(topic.questions) - 1)],
            prayer=topic.prayer,
            step=topic.steps[i % len(topic.steps)],
        )
        if risk.level == "watch":
            reply.hotlines = safety.hotline_lines(self.cfg.crisis_region)[:3]
        self._set_verse(reply, "", topic, turn_no)
        return reply

    # ------------------------------------------------------------ 보조
    def _set_verse(self, reply: Reply, key: str, topic: topics_mod.Topic,
                   turn_no: int = 1) -> None:
        """같은 사람에게 같은 구절을 반복하지 않도록 회차마다 돌려 가며 고른다."""
        candidates = ([key] if key else []) + list(topic.verses)
        candidates = [c for c in candidates if c in verses_mod.BY_KEY]
        if not candidates:
            return
        v = verses_mod.get(candidates[0] if key else
                           candidates[(turn_no - 1) % len(candidates)])
        reply.verse_ref = v.ref
        reply.verse_ref_protestant = v.ref_protestant
        reply.verse_gist = v.gist

    def _memo(self, visitor: Optional[Visitor], risk: safety.Risk) -> str:
        if not visitor:
            return ""
        bits: List[str] = []
        if visitor.returning:
            bits.append(f"{visitor.visit_count}번째 방문, {visitor.streak}일 연속")
        recent = [t for t in visitor.recent_topics(3)]
        if recent:
            bits.append("최근 주제: " + ", ".join(recent))
        it = visitor.open_intention()
        if it:
            bits.append(f"지난번 맡긴 기도: {it.text}")
        if risk.level == "watch":
            bits.append("주의: 무기력·소진 신호가 보입니다. 밝은 말로 서두르지 마십시오.")
        return " / ".join(bits)

    def _attach_links(self, reply: Reply, topic: topics_mod.Topic,
                      risk: safety.Risk) -> None:
        """대화를 콘텐츠로 연결한다 — 상담이 일회성으로 끝나지 않게 하는 장치."""
        links: List[Link] = []
        if risk.urgent:
            links.append(Link("마음의 쉼", "/gate/heart", "gate"))
            reply.links = links
            return
        for no in topic.beliefs[:2]:
            b = fifty.get(no)
            links.append(Link(f"{b.no}. {b.title}", b.url, "belief"))
        try:
            gate = entries_mod.get(topic.gate)
            links.append(Link(gate.title, gate.url, "gate"))
        except KeyError:
            pass
        if topic.key in ("교회상처", "돌아옴"):
            links.append(Link("나는 교회를 떠났습니다", "/left-church", "page"))
        if topic.key == "교파":
            links.append(Link("각 전통을 직접 알아보기", "/traditions", "page"))
        links.append(Link("오늘의 하루 3분", "/today", "action"))
        reply.links = links

    def _follow_up(self, visitor: Optional[Visitor], today: date) -> str:
        """다시 올 이유를 매번 하나씩 남긴다."""
        card = daily_mod.build(today)
        if visitor and visitor.streak >= 2:
            return (f"{visitor.streak}일째 함께 걷고 있습니다. {card.tomorrow_teaser}")
        it = visitor.open_intention() if visitor else None
        if it:
            return f"지난번 맡기신 기도를 기억하고 있습니다 — “{it.text}”. 다음에 어떻게 되었는지 들려주십시오."
        return f"{card.tomorrow_teaser} 내일 다시 만나요."
