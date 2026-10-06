# -*- coding: utf-8 -*-
"""코디 채점 ↔ 커머스 연동.

원칙: "옷장 먼저, 구매는 점수를 올릴 때만"
  1) 지금 코디(또는 내 옷장으로 만들 수 있는 최고 코디)의 점수를 계산한다.
  2) 판매 상품을 하나씩 '입혀 보고' 다시 채점한다(가상 착용).
  3) 점수가 실제로 오르는 상품만, 오르는 만큼의 근거와 함께 보여 준다.
     예) "방수 트렌치코트를 더하면 73점 → 91점 (+18) · 내 옷 7벌과 어울림"
  4) 내 옷장만으로 충분하면 아무것도 팔지 않는다 → 신뢰가 쌓여야 장기 매출이 난다.

또한
  - 제휴/판매 링크는 화면에 '광고' 또는 '판매'로 반드시 표시한다(추천·보증 표시 지침).
  - 어린이 프로필에는 쇼핑 추천을 아예 하지 않는다.
  - 상품 클릭은 /go/<상품id> 를 거쳐 기록하고 UTM 을 붙여 판매처로 보낸다(전환 분석용).

상품 목록은 CSV 로 관리한다(스마트스토어·우커머스·위탁판매 상품을 엑셀에서 정리해 가져오기).
"""

from __future__ import annotations

import csv
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

from . import stylist
from .closet import CATEGORIES, STYLES, Closet, Garment
from .weather import Weather

SHOP_SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT '',
    material    TEXT    NOT NULL DEFAULT '',
    pattern     TEXT    NOT NULL DEFAULT 'solid',
    style       TEXT    NOT NULL DEFAULT 'casual',
    warmth      INTEGER NOT NULL DEFAULT 3,
    waterproof  INTEGER NOT NULL DEFAULT 0,
    price       INTEGER NOT NULL DEFAULT 0,
    sale_price  INTEGER NOT NULL DEFAULT 0,
    shop        TEXT    NOT NULL DEFAULT '',
    url         TEXT    NOT NULL,
    image_url   TEXT    NOT NULL DEFAULT '',
    sponsored   INTEGER NOT NULL DEFAULT 1,
    in_stock    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shop_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL,              -- impression | click | wish
    product_id  TEXT    NOT NULL,
    owner       TEXT    NOT NULL DEFAULT '',
    source      TEXT    NOT NULL DEFAULT '',   -- score | today | shop | mirror
    gain        INTEGER NOT NULL DEFAULT 0,
    at          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS wishlist (
    owner       TEXT    NOT NULL DEFAULT '',
    product_id  TEXT    NOT NULL,
    added_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (owner, product_id)
);
CREATE TABLE IF NOT EXISTS profiles (
    owner       TEXT    PRIMARY KEY,
    is_child    INTEGER NOT NULL DEFAULT 0
);
"""

AD_NOTICE = ("일부 상품은 제휴·판매 링크로, 구매 시 운영자가 수수료나 판매 수익을 받을 수 있습니다. "
             "점수가 오르는 상품만 추천합니다.")

CSV_FIELDS = ["id", "name", "category", "color", "material", "pattern", "style", "warmth",
              "waterproof", "price", "sale_price", "shop", "url", "image_url", "sponsored",
              "in_stock"]


@dataclass
class Product:
    id: str
    name: str
    category: str
    url: str
    color: str = ""
    material: str = ""
    pattern: str = "solid"
    style: str = "casual"
    warmth: int = 3
    waterproof: bool = False
    price: int = 0
    sale_price: int = 0
    shop: str = ""
    image_url: str = ""
    sponsored: bool = True      # 제휴(광고) 링크면 True, 내 쇼핑몰 직판이면 False → '판매' 표시
    in_stock: bool = True

    def __post_init__(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(f"상품 {self.id}: 알 수 없는 카테고리 {self.category}")
        if self.style not in STYLES:
            self.style = "casual"
        if not urlparse(self.url).scheme in ("http", "https"):
            raise ValueError(f"상품 {self.id}: url 은 http(s) 주소여야 합니다")
        self.warmth = max(1, min(5, int(self.warmth or 3)))
        self.waterproof = _truthy(self.waterproof)
        self.sponsored = _truthy(self.sponsored)
        self.in_stock = _truthy(self.in_stock)
        self.price = int(self.price or 0)
        self.sale_price = int(self.sale_price or 0)

    @property
    def final_price(self) -> int:
        return self.sale_price if 0 < self.sale_price < self.price else self.price

    def as_garment(self) -> Garment:
        """채점 엔진에 넣기 위한 '가상 착용' 옷."""
        return Garment(name=self.name, category=self.category, color=self.color,
                       material=self.material, pattern=self.pattern, style=self.style,
                       warmth=self.warmth, waterproof=self.waterproof)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update(category_ko=CATEGORIES[self.category], final_price=self.final_price,
                 discount=(round(100 * (1 - self.final_price / self.price))
                           if self.price and self.final_price < self.price else 0),
                 label="광고" if self.sponsored else "판매")
        return d


def _truthy(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "y", "yes", "o", "예", "방수")
    return bool(v)


def tracked_url(url: str, source: str, campaign: str = "stylemirror") -> str:
    """판매처 URL 에 UTM 을 붙인다(기존 쿼리·제휴 코드는 유지)."""
    parts = urlparse(url)
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    q.setdefault("utm_source", campaign)
    q.setdefault("utm_medium", "outfit_coach")
    q.setdefault("utm_campaign", source or "app")
    return urlunparse(parts._replace(query=urlencode(q)))


class Shop:
    def __init__(self, closet: Closet):
        self.closet = closet
        self._conn: sqlite3.Connection = closet._conn
        self._conn.executescript(SHOP_SCHEMA)

    # ------------------------------------------------------------ 상품
    def upsert(self, p: Product) -> None:
        d = asdict(p)
        cols = ", ".join(d)
        marks = ", ".join("?" for _ in d)
        vals = [int(v) if isinstance(v, bool) else v for v in d.values()]
        self._conn.execute(f"INSERT OR REPLACE INTO products ({cols}) VALUES ({marks})", vals)
        self._conn.commit()

    def import_csv(self, path: Path) -> int:
        """엑셀에서 'CSV UTF-8'로 저장한 상품 목록을 가져온다(같은 id 는 덮어쓰기)."""
        n = 0
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                row = {k: (v or "").strip() for k, v in row.items() if k in CSV_FIELDS}
                if not row.get("id") or not row.get("url"):
                    continue
                self.upsert(Product(**row))
                n += 1
        return n

    def get(self, product_id: str) -> Optional[Product]:
        row = self._conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        return _row_to_product(row) if row else None

    def all(self, in_stock_only: bool = True) -> List[Product]:
        sql = "SELECT * FROM products" + (" WHERE in_stock = 1" if in_stock_only else "")
        return [_row_to_product(r) for r in self._conn.execute(sql + " ORDER BY id")]

    # ------------------------------------------------------------ 프로필 (어린이 보호)
    def set_child(self, owner: str, is_child: bool) -> None:
        self._conn.execute("INSERT OR REPLACE INTO profiles (owner, is_child) VALUES (?, ?)",
                           (owner, int(is_child)))
        self._conn.commit()

    def is_child(self, owner: Optional[str]) -> bool:
        if not owner:
            return False
        row = self._conn.execute("SELECT is_child FROM profiles WHERE owner = ?",
                                 (owner,)).fetchone()
        return bool(row and row["is_child"])

    # ------------------------------------------------------------ 이벤트·찜
    def log(self, kind: str, product_id: str, owner: str = "", source: str = "",
            gain: int = 0) -> None:
        self._conn.execute("INSERT INTO shop_events (kind, product_id, owner, source, gain)"
                           " VALUES (?,?,?,?,?)", (kind, product_id, owner or "", source, gain))
        self._conn.commit()

    def wish(self, owner: str, product_id: str, on: bool = True) -> None:
        if on:
            self._conn.execute("INSERT OR IGNORE INTO wishlist (owner, product_id) VALUES (?, ?)",
                               (owner or "", product_id))
            self.log("wish", product_id, owner, "wish")
        else:
            self._conn.execute("DELETE FROM wishlist WHERE owner = ? AND product_id = ?",
                               (owner or "", product_id))
        self._conn.commit()

    def wishlist(self, owner: str = "") -> List[Product]:
        rows = self._conn.execute(
            "SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id"
            " WHERE w.owner = ? ORDER BY w.added_at DESC", (owner or "",))
        return [_row_to_product(r) for r in rows]

    def stats(self) -> List[dict]:
        """상품별 노출·클릭·찜·클릭률(CTR). 어떤 상품이 실제로 반응이 있는지 본다."""
        rows = self._conn.execute("""
            SELECT p.id, p.name, p.shop, p.sponsored,
                   SUM(e.kind = 'impression') AS impressions,
                   SUM(e.kind = 'click')      AS clicks,
                   SUM(e.kind = 'wish')       AS wishes,
                   ROUND(AVG(CASE WHEN e.kind = 'impression' THEN e.gain END), 1) AS avg_gain
            FROM products p LEFT JOIN shop_events e ON e.product_id = p.id
            GROUP BY p.id ORDER BY clicks DESC, impressions DESC""")
        out = []
        for r in rows:
            d = dict(r)
            for k in ("impressions", "clicks", "wishes"):
                d[k] = d[k] or 0
            d["ctr"] = round(100 * d["clicks"] / d["impressions"], 1) if d["impressions"] else 0.0
            out.append(d)
        return out

    # ------------------------------------------------------------ 핵심: 점수 기반 추천
    def suggest(self, weather: Weather, occasion: str = "daily", owner: Optional[str] = None,
                worn: Sequence[Garment] = (), top_n: int = 3, source: str = "shop",
                min_gain: int = 5) -> dict:
        """점수를 올려 주는 상품만 골라서 근거와 함께 돌려준다.

        상품은 '내 옷장에서 같은 종류의 옷으로 바꿨을 때'보다 min_gain 점 이상 더 올라야 추천된다.
        옷장에 이미 해결책이 있으면 그 옷을 먼저 알려 준다(closet_fixes).
        """
        if self.is_child(owner):
            return {"items": [], "blocked": "child",
                    "message": "어린이 프로필에는 쇼핑 추천을 표시하지 않아요."}

        closet_items = self.closet.all(owner=owner)
        if worn:
            base = list(worn)
            base_label = "지금 코디"
        else:
            best = stylist.recommend(closet_items, weather, occasion, top_n=1)
            base = best[0].items if best else []
            base_label = "내 옷장 최고 코디"
        before = stylist.score_items(base, weather, occasion) if base else None
        before_total = before["total"] if before else 0
        before_fixes = set(before["fixes"]) if before else set()

        # 옷장 옷으로 바꿔 입었을 때 종류별 최고 상승폭
        worn_ids = {g.id for g in base}
        closet_best: Dict[str, int] = {}
        closet_fix: Dict[str, Garment] = {}
        for g in closet_items:
            if g.id in worn_ids:
                continue
            gain = stylist.score_items(_try_on(base, g), weather, occasion)["total"] - before_total
            if gain > closet_best.get(g.category, 0):
                closet_best[g.category], closet_fix[g.category] = gain, g
        closet_fixes = sorted(
            ({"item": g.to_dict(), "gain": closet_best[cat]} for cat, g in closet_fix.items()
             if closet_best[cat] >= min_gain), key=lambda x: -x["gain"])

        scored = []
        for p in self.all():
            trial = _try_on(base, p.as_garment())
            after = stylist.score_items(trial, weather, occasion)
            gain = after["total"] - before_total
            if gain - closet_best.get(p.category, 0) < min_gain:
                continue  # 옷장 옷으로도 충분하거나 효과가 미미하면 팔지 않는다
            solved = [f for f in before_fixes if f not in set(after["fixes"])]
            matches = _closet_matches(p.as_garment(), closet_items)
            # 점수 상승이 1순위, 내 옷과 많이 어울릴수록(활용도) 2순위, 할인은 마지막 동점 처리
            rank = gain * 3 + min(matches, 10) - p.final_price / 100000
            scored.append((rank, p, gain, after["total"], solved, matches, trial))

        scored.sort(key=lambda x: -x[0])
        items = []
        used_categories = set()
        for rank, p, gain, after_total, solved, matches, trial in scored:
            if p.category in used_categories:  # 같은 종류만 3개 나오지 않게
                continue
            used_categories.add(p.category)
            reason = solved[0] if solved else f"'{stylist.OCCASIONS[occasion]['ko']}' 코디 완성도가 올라가요"
            items.append({
                "product": p.to_dict(), "gain": gain, "before": before_total,
                "after": after_total, "matches": matches, "reason": reason,
                "outfit": [g.name for g in trial],
            })
            self.log("impression", p.id, owner or "", source, gain)
            if len(items) >= top_n:
                break

        if not items:
            if closet_fixes:
                g = closet_fixes[0]
                msg = (f"새로 살 필요 없어요. 옷장의 {g['item']['name']}을(를) 입으면 "
                       f"+{g['gain']}점이에요.")
            elif base:
                msg = "내 옷장만으로 충분해요! 오늘은 살 필요가 없어요."
            else:
                msg = "옷장에 옷을 등록하면 꼭 필요한 아이템만 골라 드려요."
        else:
            top = items[0]
            msg = (f"{base_label} {top['before']}점 → {top['product']['name']}을(를) 더하면 "
                   f"{top['after']}점 (+{top['gain']})")
        return {"items": items, "message": msg, "base_total": before_total,
                "closet_fixes": closet_fixes,
                "notice": AD_NOTICE if items else ""}


def _try_on(base: Sequence[Garment], new: Garment) -> List[Garment]:
    """기존 코디에서 같은 자리의 옷을 상품으로 바꾸거나 없으면 더한다."""
    if new.category == "dress":
        kept = [g for g in base if g.category not in ("top", "bottom", "dress")]
    elif new.category in ("top", "bottom"):
        kept = [g for g in base if g.category not in (new.category, "dress")]
        if not any(g.category in ("top", "bottom") for g in kept) and any(g.category == "dress" for g in base):
            # 원피스를 상의/하의 하나로 바꾸면 반쪽 코디가 되므로 원피스를 유지하고 비교하지 않는다
            return list(base)
    elif new.category == "accessory":
        kept = list(base)
    else:
        kept = [g for g in base if g.category != new.category]
    return kept + [new]


PAIRS = {
    "top": ("bottom", "outer"), "bottom": ("top", "outer"), "dress": ("outer", "shoes"),
    "outer": ("top", "bottom", "dress"), "shoes": ("bottom", "dress"),
    "accessory": ("top", "dress", "outer"),
}


def _closet_matches(item: Garment, closet_items: Sequence[Garment]) -> int:
    """내 옷장에서 이 상품과 색이 어울리는 옷 수 = 활용도."""
    n = 0
    for g in closet_items:
        if g.category in PAIRS[item.category] and stylist._harmony([item, g])[0] > 0:
            n += 1
    return n


def _row_to_product(row: sqlite3.Row) -> Product:
    return Product(**dict(row))
