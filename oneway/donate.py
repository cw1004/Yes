# -*- coding: utf-8 -*-
"""판매·기부 장부.

"수익금 전액 기부"는 말로 하면 아무 의미가 없다. 확인할 방법이 없기 때문이다.
그래서 **판매액과 전달한 금액을 공개된 장부에 적는다.**

용어를 흐리지 않는다
--------------------
"전액"이라는 말은 다음 중 무엇인지 반드시 밝혀야 한다.

  · 정가 × 부수      = 표시 매출 (실제로 들어오지 않는 돈)
  · 플랫폼 정산금     = 실제로 통장에 들어온 돈   ← 이 금액을 기준으로 한다
  · 기부액           = 실제로 전달한 돈

전자책 플랫폼은 보통 30~40%를 가져간다. 그래서 정가 기준으로 "전액"이라고
말하면 지킬 수 없는 약속이 된다. 이 장부는 **정산금 전액**을 약속으로 삼고,
세 숫자를 모두 공개해 차이를 숨기지 않는다.

법적으로 확인할 것 (운영 전 필수)
---------------------------------
· 「기부금품의 모집 및 사용에 관한 법률」 — 남에게서 기부금을 '모집'하면
  일정 금액 이상일 때 등록 의무가 생긴다. 이 구조는 **내 판매 수입을 내가
  기부하는 것**이라 모집에 해당하지 않는 것이 일반적이지만, 판매 문구를
  "기부금을 모읍니다"로 쓰면 해석이 달라질 수 있다. 문구를 정하기 전에
  확인할 것.
· 「표시·광고의 공정화에 관한 법률」 — "전액 기부"는 광고 문구다.
  증명하지 못하면 허위·과장 광고가 된다. 그래서 이 장부가 필요하다.
· 기부금 영수증이 필요하면 받는 쪽이 지정기부금단체인지 확인할 것.
· 판매 수입은 일단 **내 소득**이다. 기부해도 소득 신고 의무는 남는다.
  세무 처리는 세무사에게 확인할 것.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

# 약속의 기준. 바꾸려면 공개 페이지 문구도 함께 바꿔야 한다.
PROMISE = "플랫폼 수수료와 세금을 제외하고 실제로 정산된 금액 전부"

# 받는 곳. 실제 운영 전에 단체를 정하고 사업자 확인을 거칠 것.
# 여기에 적힌 이름이 그대로 공개 페이지에 나간다.
DEFAULT_CAUSES: List[str] = [
    "전쟁으로 부모를 잃은 아이들",
    "전쟁으로 남겨진 가족들",
    "가난한 이웃",
]


@dataclass
class Entry:
    """장부의 한 줄."""
    date: str                 # YYYY-MM-DD
    kind: str                 # sale | donation
    note: str = ""
    # 판매
    channel: str = ""         # 판매처
    copies: int = 0
    gross: int = 0            # 정가 기준 표시 매출 (원)
    settled: int = 0          # 실제 정산금 (원)
    # 기부
    to: str = ""              # 전달한 단체
    amount: int = 0           # 전달 금액 (원)
    receipt: str = ""         # 영수증·증빙 번호나 링크

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Ledger:
    """공개 장부."""
    currency: str = "KRW"
    promise: str = PROMISE
    causes: List[str] = field(default_factory=lambda: list(DEFAULT_CAUSES))
    entries: List[Entry] = field(default_factory=list)
    updated: str = ""

    # ---------------------------------------------------------------- 집계
    @property
    def sales(self) -> List[Entry]:
        return [e for e in self.entries if e.kind == "sale"]

    @property
    def donations(self) -> List[Entry]:
        return [e for e in self.entries if e.kind == "donation"]

    @property
    def copies(self) -> int:
        return sum(e.copies for e in self.sales)

    @property
    def gross(self) -> int:
        return sum(e.gross for e in self.sales)

    @property
    def settled(self) -> int:
        return sum(e.settled for e in self.sales)

    @property
    def donated(self) -> int:
        return sum(e.amount for e in self.donations)

    @property
    def pending(self) -> int:
        """아직 전달하지 않은 금액. 음수가 나오면 더 보낸 것이다."""
        return self.settled - self.donated

    @property
    def kept(self) -> int:
        """저자가 가져간 돈. 약속대로라면 항상 0이어야 한다."""
        return max(0, self.pending)

    @property
    def fulfilled(self) -> bool:
        return self.settled > 0 and self.donated >= self.settled

    def percent(self) -> int:
        if self.settled <= 0:
            return 100 if self.donated > 0 else 0
        return min(100, round(self.donated / self.settled * 100))

    def by_cause(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for e in self.donations:
            out[e.to or "미기재"] = out.get(e.to or "미기재", 0) + e.amount
        return out

    def summary(self) -> Dict:
        return {
            "copies": self.copies,
            "gross": self.gross,
            "settled": self.settled,
            "donated": self.donated,
            "pending": self.pending,
            "percent": self.percent(),
            "fulfilled": self.fulfilled,
            "promise": self.promise,
            "causes": list(self.causes),
            "updated": self.updated,
            "by_cause": self.by_cause(),
        }

    def problems(self) -> List[str]:
        """약속을 지키고 있는지 스스로 점검한다. 공개 전에 돌려 볼 것."""
        out: List[str] = []
        for e in self.entries:
            try:
                date.fromisoformat(e.date)
            except ValueError:
                out.append(f"날짜 형식이 잘못되었습니다: {e.date!r}")
            if e.kind not in ("sale", "donation"):
                out.append(f"알 수 없는 종류입니다: {e.kind!r}")
            if e.kind == "sale" and e.settled > e.gross > 0:
                out.append(f"{e.date}: 정산금이 표시 매출보다 큽니다")
            if e.kind == "donation" and not e.to:
                out.append(f"{e.date}: 어디에 전달했는지 적혀 있지 않습니다")
            if e.kind == "donation" and e.amount <= 0:
                out.append(f"{e.date}: 전달 금액이 0입니다")
        if self.pending > 0:
            out.append(f"아직 전달하지 않은 금액이 {self.pending:,}원 있습니다")
        return out

    # ---------------------------------------------------------------- 저장
    @classmethod
    def load(cls, path) -> "Ledger":
        p = Path(path)
        if not p.exists():
            return cls()
        data = json.loads(p.read_text(encoding="utf-8"))
        return cls(
            currency=data.get("currency", "KRW"),
            promise=data.get("promise", PROMISE),
            causes=list(data.get("causes", DEFAULT_CAUSES)),
            entries=[Entry(**e) for e in data.get("entries", [])],
            updated=data.get("updated", ""),
        )

    def save(self, path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        self.updated = date.today().isoformat()
        p.write_text(json.dumps({
            "currency": self.currency,
            "promise": self.promise,
            "causes": self.causes,
            "updated": self.updated,
            "entries": [e.to_dict() for e in
                        sorted(self.entries, key=lambda x: x.date)],
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def add_sale(self, on: str, channel: str, copies: int,
                 gross: int, settled: int, note: str = "") -> Entry:
        e = Entry(date=on, kind="sale", channel=channel, copies=copies,
                  gross=gross, settled=settled, note=note)
        self.entries.append(e)
        return e

    def add_donation(self, on: str, to: str, amount: int,
                     receipt: str = "", note: str = "") -> Entry:
        e = Entry(date=on, kind="donation", to=to, amount=amount,
                  receipt=receipt, note=note)
        self.entries.append(e)
        return e


def won(amount: int) -> str:
    return f"{amount:,}원"


SAMPLE = """{
  "promise": "플랫폼 수수료와 세금을 제외하고 실제로 정산된 금액 전부",
  "causes": ["전쟁으로 부모를 잃은 아이들", "전쟁으로 남겨진 가족들", "가난한 이웃"],
  "entries": [
    {"date": "2026-01-31", "kind": "sale", "channel": "예시 서점",
     "copies": 0, "gross": 0, "settled": 0, "note": "판매가 시작되면 여기에 적습니다"}
  ]
}
"""
