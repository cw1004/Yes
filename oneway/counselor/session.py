# -*- coding: utf-8 -*-
"""방문자 세션 — 재방문을 만드는 장치.

이 파일이 하는 일은 '기억'이다. 상담이 매번 처음부터 시작되면
사람은 다시 오지 않는다. 다음을 기억한다.

  · 며칠 연속으로 오고 있는지 (streak)
  · 어떤 주제로 이야기했는지 (다음에 이어 물어볼 수 있게)
  · 어떤 기도를 맡겼는지 (다음 방문 때 "그 일은 어떻게 되었습니까?")
  · 「50가지」를 어디까지 읽었는지, 사랑 실천을 며칠 했는지

개인정보 원칙
-------------
이름·이메일·전화번호를 받지 않는다. 쿠키에 담기는 것은 무작위 ID 하나뿐이고,
저장 파일도 그 ID로만 구분된다. 어린이·청소년도 들어올 수 있는 사이트라
수집을 최소화하는 것이 기본이다.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

SESSION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_TURNS_KEPT = 40          # 파일이 무한정 커지지 않도록
MAX_INTENTIONS = 20


def new_id() -> str:
    return secrets.token_hex(16)


def valid_id(sid: Optional[str]) -> bool:
    return bool(sid and SESSION_ID_RE.match(sid))


@dataclass
class Turn:
    at: str
    role: str            # user | counselor
    text: str
    topic: str = ""
    risk: str = "none"

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Intention:
    """맡긴 기도 지향. 다음 방문 때 다시 물어보기 위한 것."""
    at: str
    text: str
    answered: bool = False
    note: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Visitor:
    id: str
    first_day: str
    last_day: str
    days: List[str] = field(default_factory=list)      # 방문한 날짜 (중복 없음)
    streak: int = 1
    turns: List[Turn] = field(default_factory=list)
    topics: Dict[str, int] = field(default_factory=dict)
    intentions: List[Intention] = field(default_factory=list)
    read_beliefs: List[int] = field(default_factory=list)
    done_practices: List[str] = field(default_factory=list)   # 사랑 실천을 한 날짜
    nickname: str = ""                                        # 본인이 원할 때만
    # 이 사람에게 어디까지 열렸는지 (counselor/depth.py)
    depth: int = 0
    # "종교 이야기는 하지 말아 달라"고 한 적이 있는가. 한 번 참이면 되돌리지 않는다.
    faith_blocked: bool = False

    # ---------------------------------------------------------------- 기록
    def touch(self, today: Optional[date] = None) -> None:
        """방문 기록 + 연속 방문 일수 계산."""
        today = today or date.today()
        iso = today.isoformat()
        if iso in self.days:
            return
        prev = date.fromisoformat(self.last_day) if self.last_day else None
        self.days.append(iso)
        self.days = sorted(set(self.days))[-400:]
        if not prev:
            self.streak = 1
        elif (today - prev).days == 1:
            self.streak += 1
        elif (today - prev).days > 1:
            self.streak = 1
        self.last_day = iso

    def add_turn(self, role: str, text: str, topic: str = "", risk: str = "none") -> None:
        self.turns.append(Turn(at=datetime.now().isoformat(timespec="seconds"),
                               role=role, text=text[:2000], topic=topic, risk=risk))
        self.turns = self.turns[-MAX_TURNS_KEPT:]
        if topic:
            self.topics[topic] = self.topics.get(topic, 0) + 1

    def add_intention(self, text: str) -> Intention:
        it = Intention(at=datetime.now().isoformat(timespec="seconds"), text=text[:500])
        self.intentions.append(it)
        self.intentions = self.intentions[-MAX_INTENTIONS:]
        return it

    def mark_read(self, no: int) -> None:
        if no not in self.read_beliefs:
            self.read_beliefs.append(no)

    def open_depth(self, level: int) -> None:
        """상대가 스스로 연 깊이를 기억한다. 우리가 올리지는 않는다.

        교파(3)는 기억하지 않는다. 물어본 그 순간에만 답하는 것이 맞다.
        """
        if self.faith_blocked:
            self.depth = 0
            return
        self.depth = max(self.depth, min(int(level), 2))

    def block_faith(self) -> None:
        """종교 이야기를 원하지 않는다고 말했다. 두 번 묻지 않는다."""
        self.faith_blocked = True
        self.depth = 0

    def mark_practice(self, on: Optional[date] = None) -> None:
        iso = (on or date.today()).isoformat()
        if iso not in self.done_practices:
            self.done_practices.append(iso)

    # ---------------------------------------------------------------- 조회
    @property
    def visit_count(self) -> int:
        return len(self.days)

    @property
    def returning(self) -> bool:
        return self.visit_count > 1

    @property
    def main_topic(self) -> str:
        if not self.topics:
            return ""
        return max(self.topics.items(), key=lambda kv: kv[1])[0]

    def recent_topics(self, n: int = 3) -> List[str]:
        seen: List[str] = []
        for t in reversed(self.turns):
            if t.topic and t.topic not in seen:
                seen.append(t.topic)
            if len(seen) >= n:
                break
        return seen

    def turn_no(self, topic: str) -> int:
        """이 주제로 몇 번째 이야기인지 (질문을 단계적으로 깊게 하기 위해)."""
        return sum(1 for t in self.turns if t.role == "user" and t.topic == topic)

    def open_intention(self) -> Optional[Intention]:
        for it in reversed(self.intentions):
            if not it.answered:
                return it
        return None

    def history_for_llm(self, limit: int = 8) -> List[Dict[str, str]]:
        """Claude 에 넘길 최근 대화. user/assistant 로만 변환한다."""
        out: List[Dict[str, str]] = []
        for t in self.turns[-limit:]:
            out.append({"role": "user" if t.role == "user" else "assistant",
                        "content": t.text})
        # 첫 메시지는 반드시 user 여야 한다
        while out and out[0]["role"] != "user":
            out.pop(0)
        return out

    def progress(self) -> Dict:
        """재방문 화면에 보여 줄 진행 상황."""
        return {
            "visits": self.visit_count,
            "streak": self.streak,
            "beliefs_read": len(self.read_beliefs),
            "beliefs_total": 50,
            "practices_done": len(self.done_practices),
            "practices_total": 30,
            "main_topic": self.main_topic,
        }

    # ---------------------------------------------------------------- 직렬화
    def to_dict(self) -> Dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: Dict) -> "Visitor":
        turns = [Turn(**t) for t in d.get("turns", [])]
        ints = [Intention(**i) for i in d.get("intentions", [])]
        return cls(
            id=d["id"], first_day=d["first_day"], last_day=d["last_day"],
            days=list(d.get("days", [])), streak=int(d.get("streak", 1)),
            turns=turns, topics=dict(d.get("topics", {})), intentions=ints,
            read_beliefs=list(d.get("read_beliefs", [])),
            done_practices=list(d.get("done_practices", [])),
            nickname=d.get("nickname", ""),
            depth=int(d.get("depth", 0)),
            faith_blocked=bool(d.get("faith_blocked", False)),
        )


class Store:
    """파일 기반 저장소.

    DB 없이 시작할 수 있게 JSON 파일 하나에 방문자 하나를 담는다.
    트래픽이 커지면 이 클래스만 교체하면 된다(인터페이스는 3개뿐).
    """

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, sid: str) -> Path:
        return self.root / f"{sid}.json"

    def load(self, sid: str) -> Optional[Visitor]:
        if not valid_id(sid):
            return None
        p = self._path(sid)
        if not p.exists():
            return None
        try:
            return Visitor.from_dict(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, KeyError, TypeError):
            return None

    def save(self, v: Visitor) -> None:
        with self._lock:
            tmp = self._path(v.id).with_suffix(".tmp")
            tmp.write_text(json.dumps(v.to_dict(), ensure_ascii=False, indent=1),
                           encoding="utf-8")
            os.replace(tmp, self._path(v.id))

    def get_or_create(self, sid: Optional[str],
                      today: Optional[date] = None) -> Visitor:
        today = today or date.today()
        v = self.load(sid) if sid else None
        if v is None:
            iso = today.isoformat()
            v = Visitor(id=new_id(), first_day=iso, last_day="", days=[], streak=0)
        v.touch(today)
        return v

    def purge(self, days: int = 180, today: Optional[date] = None) -> int:
        """오래된 세션 삭제 — 개인정보를 오래 들고 있지 않기 위한 것."""
        today = today or date.today()
        limit = today - timedelta(days=days)
        removed = 0
        for p in self.root.glob("*.json"):
            try:
                last = json.loads(p.read_text(encoding="utf-8")).get("last_day", "")
                if last and date.fromisoformat(last) < limit:
                    p.unlink()
                    removed += 1
            except (json.JSONDecodeError, ValueError, OSError):
                continue
        return removed
