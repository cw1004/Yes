# -*- coding: utf-8 -*-
"""'내 디지털 옷장' — SQLite 데이터베이스.

표준 라이브러리 sqlite3 만 사용하므로 라즈베리 파이에서도 추가 설치 없이 동작한다.

테이블
  garments : 옷 한 벌 = 한 줄
  wear_log : 언제 어떤 옷을 입었는지 (같은 옷 반복 추천 방지)
"""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional

CATEGORIES: Dict[str, str] = {
    "top": "상의",
    "bottom": "하의",
    "dress": "원피스",
    "outer": "아우터",
    "shoes": "신발",
    "accessory": "액세서리",
}

# 보온 정도: 1 = 아주 얇음(민소매·린넨) … 5 = 아주 두꺼움(패딩)
WARMTH_LABEL = {1: "아주 얇음", 2: "얇음", 3: "보통", 4: "두꺼움", 5: "아주 두꺼움"}

STYLES = ["casual", "formal", "business", "sporty", "street", "lovely", "minimal"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS garments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT '',
    material    TEXT    NOT NULL DEFAULT '',
    pattern     TEXT    NOT NULL DEFAULT 'solid',
    style       TEXT    NOT NULL DEFAULT 'casual',
    warmth      INTEGER NOT NULL DEFAULT 3,
    waterproof  INTEGER NOT NULL DEFAULT 0,
    owner       TEXT    NOT NULL DEFAULT '',
    photo       TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (date('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS wear_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    garment_id  INTEGER NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
    worn_on     TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS score_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner       TEXT    NOT NULL DEFAULT '',
    scored_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    occasion    TEXT    NOT NULL DEFAULT 'daily',
    total       INTEGER NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'rules',
    message     TEXT    NOT NULL DEFAULT ''
);
"""


@dataclass
class Garment:
    name: str
    category: str
    color: str = ""
    material: str = ""
    pattern: str = "solid"
    style: str = "casual"
    warmth: int = 3
    waterproof: bool = False
    owner: str = ""
    photo: str = ""
    note: str = ""
    id: Optional[int] = None
    created_at: str = ""

    def __post_init__(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(f"알 수 없는 카테고리: {self.category} "
                             f"(가능: {', '.join(CATEGORIES)})")
        self.warmth = max(1, min(5, int(self.warmth)))
        self.waterproof = bool(self.waterproof)

    @property
    def label(self) -> str:
        """화면·프롬프트에 쓰는 짧은 설명. 예) #3 네이비 슬랙스(하의, 울, 보통)"""
        bits = [CATEGORIES[self.category]]
        if self.material:
            bits.append(self.material)
        bits.append(WARMTH_LABEL[self.warmth])
        if self.waterproof:
            bits.append("방수")
        color = f"{self.color} " if self.color and self.color not in self.name else ""
        return f"#{self.id} {color}{self.name}({', '.join(bits)})"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["category_ko"] = CATEGORIES[self.category]
        d["label"] = self.label
        return d


class Closet:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    # ------------------------------------------------------------ CRUD
    def add(self, g: Garment) -> Garment:
        cur = self._conn.execute(
            "INSERT INTO garments (name, category, color, material, pattern, style,"
            " warmth, waterproof, owner, photo, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (g.name, g.category, g.color, g.material, g.pattern, g.style,
             g.warmth, int(g.waterproof), g.owner, g.photo, g.note),
        )
        self._conn.commit()
        return self.get(cur.lastrowid)

    def get(self, garment_id: int) -> Optional[Garment]:
        row = self._conn.execute("SELECT * FROM garments WHERE id = ?",
                                 (garment_id,)).fetchone()
        return _row_to_garment(row) if row else None

    def update(self, garment_id: int, **changes) -> Optional[Garment]:
        allowed = {"name", "category", "color", "material", "pattern", "style",
                   "warmth", "waterproof", "owner", "photo", "note"}
        changes = {k: v for k, v in changes.items() if k in allowed}
        if not changes:
            return self.get(garment_id)
        current = self.get(garment_id)
        if current is None:
            return None
        merged = Garment(**{**asdict(current), **changes})  # 값 검증
        sets = ", ".join(f"{k} = ?" for k in changes)
        vals = [getattr(merged, k) for k in changes]
        vals = [int(v) if isinstance(v, bool) else v for v in vals]
        self._conn.execute(f"UPDATE garments SET {sets} WHERE id = ?", (*vals, garment_id))
        self._conn.commit()
        return self.get(garment_id)

    def delete(self, garment_id: int) -> bool:
        cur = self._conn.execute("DELETE FROM garments WHERE id = ?", (garment_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def all(self, owner: Optional[str] = None,
            category: Optional[str] = None) -> List[Garment]:
        sql, args = "SELECT * FROM garments WHERE 1=1", []
        if owner:
            # 주인이 비어 있는 옷(가족 공용)은 누구에게나 추천한다
            sql += " AND (owner = ? OR owner = '')"
            args.append(owner)
        if category:
            sql += " AND category = ?"
            args.append(category)
        sql += " ORDER BY category, id"
        return [_row_to_garment(r) for r in self._conn.execute(sql, args)]

    def owners(self) -> List[str]:
        rows = self._conn.execute(
            "SELECT DISTINCT owner FROM garments WHERE owner != '' ORDER BY owner")
        return [r["owner"] for r in rows]

    # ------------------------------------------------------------ 착용 기록
    def mark_worn(self, garment_ids: Iterable[int], on: Optional[date] = None) -> None:
        day = (on or date.today()).isoformat()
        self._conn.executemany("INSERT INTO wear_log (garment_id, worn_on) VALUES (?, ?)",
                               [(int(i), day) for i in garment_ids])
        self._conn.commit()

    def recently_worn(self, days: int = 3, today: Optional[date] = None) -> Dict[int, int]:
        """최근 n일 동안의 {옷 id: 착용 횟수}."""
        since = ((today or date.today()) - timedelta(days=days)).isoformat()
        rows = self._conn.execute(
            "SELECT garment_id, COUNT(*) AS n FROM wear_log WHERE worn_on >= ?"
            " GROUP BY garment_id", (since,))
        return {r["garment_id"]: r["n"] for r in rows}

    # ------------------------------------------------------------ 점수 기록 (사진은 저장 안 함)
    def log_score(self, total: int, owner: str = "", occasion: str = "daily",
                  source: str = "rules", message: str = "") -> None:
        self._conn.execute(
            "INSERT INTO score_log (owner, occasion, total, source, message) VALUES (?,?,?,?,?)",
            (owner or "", occasion, int(total), source, message))
        self._conn.commit()

    def score_history(self, owner: Optional[str] = None, limit: int = 14) -> List[dict]:
        sql, args = "SELECT * FROM score_log", []
        if owner:
            sql += " WHERE owner = ?"
            args.append(owner)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        return [dict(r) for r in self._conn.execute(sql, args)]

    def as_prompt_text(self, owner: Optional[str] = None) -> str:
        """Claude 에 보낼 옷장 목록(텍스트)."""
        items = self.all(owner=owner)
        if not items:
            return "(옷장이 비어 있음)"
        return "\n".join(f"- {g.label} 색상={g.color or '?'} 스타일={g.style}"
                         for g in items)


def _row_to_garment(row: sqlite3.Row) -> Garment:
    d = dict(row)
    d["waterproof"] = bool(d["waterproof"])
    return Garment(**d)


SAMPLE_CLOSET: List[Garment] = [
    Garment("화이트 옥스포드 셔츠", "top", "화이트", "코튼", style="business", warmth=2),
    Garment("네이비 니트", "top", "네이비", "울", style="minimal", warmth=4),
    Garment("그레이 맨투맨", "top", "그레이", "코튼", style="casual", warmth=3),
    Garment("블랙 반팔 티셔츠", "top", "블랙", "코튼", style="casual", warmth=1),
    Garment("베이지 린넨 블라우스", "top", "베이지", "린넨", style="lovely", warmth=1),
    Garment("네이비 슬랙스", "bottom", "네이비", "울 혼방", style="business", warmth=3),
    Garment("연청 데님 팬츠", "bottom", "라이트블루", "데님", style="casual", warmth=3),
    Garment("블랙 와이드 팬츠", "bottom", "블랙", "폴리", style="minimal", warmth=2),
    Garment("카키 반바지", "bottom", "카키", "코튼", style="casual", warmth=1),
    Garment("플라워 롱 원피스", "dress", "아이보리", "쉬폰", pattern="floral",
            style="lovely", warmth=2),
    Garment("베이지 트렌치코트", "outer", "베이지", "코튼 개버딘", style="business",
            warmth=3, waterproof=True),
    Garment("블랙 롱패딩", "outer", "블랙", "다운", style="casual", warmth=5,
            waterproof=True),
    Garment("차콜 울 코트", "outer", "차콜", "울", style="formal", warmth=4),
    Garment("데님 재킷", "outer", "블루", "데님", style="street", warmth=2),
    Garment("화이트 스니커즈", "shoes", "화이트", "가죽", style="casual"),
    Garment("블랙 로퍼", "shoes", "블랙", "가죽", style="business"),
    Garment("레인부츠", "shoes", "네이비", "고무", style="casual", waterproof=True),
]
