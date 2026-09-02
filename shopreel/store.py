# -*- coding: utf-8 -*-
"""SQLite 상태 저장소.

수집한 상품 / 만든 영상 / 업로드 기록 / 클릭 / 전환(수익)을 한 파일에 담는다.
같은 상품을 반복 제작하지 않게 하고, 수익 리포트와 랭킹 피드백의 근거가 된다.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .models import PostResult, Product, VideoAsset

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    key         TEXT PRIMARY KEY,
    dedupe_key  TEXT,
    source      TEXT,
    product_id  TEXT,
    title       TEXT,
    url         TEXT,
    price       REAL,
    currency    TEXT,
    rating      REAL,
    reviews     INTEGER,
    sold        INTEGER,
    commission  REAL,
    category    TEXT,
    score       REAL,
    first_seen  REAL,
    last_seen   REAL,
    payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_dedupe ON products(dedupe_key);

CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_key TEXT,
    path        TEXT,
    thumbnail   TEXT,
    seconds     REAL,
    link        TEXT,
    target      TEXT,
    created_at  REAL,
    payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_product ON videos(product_key);

CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id    INTEGER,
    product_key TEXT,
    platform    TEXT,
    status      TEXT,
    post_id     TEXT,
    url         TEXT,
    message     TEXT,
    created_at  REAL,
    payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform, created_at);

CREATE TABLE IF NOT EXISTS links (
    code        TEXT PRIMARY KEY,
    product_key TEXT,
    platform    TEXT,
    target      TEXT,
    created_at  REAL
);

CREATE TABLE IF NOT EXISTS clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT,
    at          REAL,
    referrer    TEXT,
    ua          TEXT,
    ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(code, at);

CREATE TABLE IF NOT EXISTS conversions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT,
    order_id    TEXT UNIQUE,
    at          REAL,
    amount      REAL,
    commission  REAL,
    currency    TEXT,
    network     TEXT,
    status      TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_code ON conversions(code, at);
"""


class Store:
    """스레드마다 커넥션을 새로 여는 얇은 래퍼."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._conn()) as con:
            con.executescript(SCHEMA)
            con.commit()

    def _conn(self) -> sqlite3.Connection:
        con = sqlite3.connect(str(self.path), timeout=30)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        return con

    # ------------------------------------------------------------ 상품
    def upsert_product(self, p: Product) -> int:
        """상품을 저장하고 직전 판매량 대비 증가분(sold_delta)을 채워 돌려준다."""
        now = time.time()
        with closing(self._conn()) as con:
            row = con.execute("SELECT sold, first_seen FROM products WHERE key=?",
                              (p.key,)).fetchone()
            prev_sold = int(row["sold"]) if row else 0
            first_seen = float(row["first_seen"]) if row else now
            if row and p.sold > prev_sold:
                p.sold_delta = p.sold - prev_sold
            con.execute(
                """INSERT INTO products
                   (key, dedupe_key, source, product_id, title, url, price, currency,
                    rating, reviews, sold, commission, category, score, first_seen,
                    last_seen, payload)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(key) DO UPDATE SET
                     price=excluded.price, rating=excluded.rating,
                     reviews=excluded.reviews, sold=excluded.sold,
                     score=excluded.score, last_seen=excluded.last_seen,
                     payload=excluded.payload""",
                (p.key, p.dedupe_key, p.source, p.product_id, p.title, p.url, p.price,
                 p.currency, p.rating, p.reviews, p.sold, p.commission, p.category,
                 p.score, first_seen, now, json.dumps(p.to_dict(), ensure_ascii=False)),
            )
            con.commit()
        return p.sold_delta

    def product_first_seen(self, key: str) -> Optional[float]:
        with closing(self._conn()) as con:
            row = con.execute("SELECT first_seen FROM products WHERE key=?", (key,)).fetchone()
        return float(row["first_seen"]) if row else None

    def recently_made(self, days: int) -> Dict[str, float]:
        """최근 N일 안에 영상으로 만든 상품 key → 제작 시각."""
        since = time.time() - days * 86400
        with closing(self._conn()) as con:
            rows = con.execute(
                "SELECT product_key, MAX(created_at) AS t FROM videos "
                "WHERE created_at>=? GROUP BY product_key", (since,)).fetchall()
        return {r["product_key"]: float(r["t"]) for r in rows}

    # ------------------------------------------------------------ 영상/업로드
    def add_video(self, v: VideoAsset) -> int:
        with closing(self._conn()) as con:
            cur = con.execute(
                """INSERT INTO videos
                   (product_key, path, thumbnail, seconds, link, target, created_at, payload)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (v.product_key, v.path, v.thumbnail, v.seconds, v.link, v.target,
                 v.created_at, json.dumps(v.to_dict(), ensure_ascii=False)),
            )
            con.commit()
            return int(cur.lastrowid)

    def add_post(self, video_id: int, product_key: str, r: PostResult,
                 payload: Optional[Dict] = None) -> int:
        with closing(self._conn()) as con:
            cur = con.execute(
                """INSERT INTO posts
                   (video_id, product_key, platform, status, post_id, url, message,
                    created_at, payload)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (video_id, product_key, r.platform, r.status, r.post_id, r.url,
                 r.message, r.at, json.dumps(payload or {}, ensure_ascii=False)),
            )
            con.commit()
            return int(cur.lastrowid)

    def posted_today(self, platform: str) -> int:
        since = time.time() - 86400
        with closing(self._conn()) as con:
            row = con.execute(
                "SELECT COUNT(*) AS n FROM posts WHERE platform=? AND status='published'"
                " AND created_at>=?", (platform, since)).fetchone()
        return int(row["n"])

    def pending_posts(self, limit: int = 50) -> List[sqlite3.Row]:
        """업로드에 실패했거나 대기 중인 건 (재시도 대상)."""
        with closing(self._conn()) as con:
            return con.execute(
                "SELECT p.*, v.path AS video_path FROM posts p "
                "LEFT JOIN videos v ON v.id=p.video_id "
                "WHERE p.status IN ('queued','error') ORDER BY p.created_at DESC LIMIT ?",
                (limit,)).fetchall()

    def update_post(self, post_id_row: int, r: PostResult) -> None:
        with closing(self._conn()) as con:
            con.execute("UPDATE posts SET status=?, post_id=?, url=?, message=? WHERE id=?",
                        (r.status, r.post_id, r.url, r.message, post_id_row))
            con.commit()

    # ------------------------------------------------------------ 링크/클릭/수익
    def add_link(self, code: str, product_key: str, platform: str, target: str) -> None:
        with closing(self._conn()) as con:
            con.execute("INSERT OR REPLACE INTO links VALUES (?,?,?,?,?)",
                        (code, product_key, platform, target, time.time()))
            con.commit()

    def get_link(self, code: str) -> Optional[sqlite3.Row]:
        with closing(self._conn()) as con:
            return con.execute("SELECT * FROM links WHERE code=?", (code,)).fetchone()

    def add_click(self, code: str, referrer: str = "", ua: str = "", ip_hash: str = "") -> None:
        with closing(self._conn()) as con:
            con.execute("INSERT INTO clicks (code, at, referrer, ua, ip_hash) VALUES (?,?,?,?,?)",
                        (code, time.time(), referrer[:300], ua[:300], ip_hash[:64]))
            con.commit()

    def add_conversion(self, code: str, order_id: str, amount: float, commission: float,
                       currency: str = "USD", network: str = "", status: str = "pending",
                       at: Optional[float] = None) -> bool:
        """중복 주문번호는 무시하고 새로 들어온 건만 True."""
        with closing(self._conn()) as con:
            try:
                con.execute(
                    """INSERT INTO conversions
                       (code, order_id, at, amount, commission, currency, network, status)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (code, order_id, at or time.time(), amount, commission, currency,
                     network, status))
                con.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    # ------------------------------------------------------------ 집계
    def summary(self, days: int = 30) -> Dict:
        since = time.time() - days * 86400
        with closing(self._conn()) as con:
            q = lambda sql, *a: con.execute(sql, a).fetchone()[0]  # noqa: E731
            return {
                "days": days,
                "products": q("SELECT COUNT(*) FROM products WHERE last_seen>=?", since),
                "videos": q("SELECT COUNT(*) FROM videos WHERE created_at>=?", since),
                "posts": q("SELECT COUNT(*) FROM posts WHERE status='published'"
                           " AND created_at>=?", since),
                "clicks": q("SELECT COUNT(*) FROM clicks WHERE at>=?", since),
                "orders": q("SELECT COUNT(*) FROM conversions WHERE at>=?", since),
                "revenue": round(q("SELECT COALESCE(SUM(commission),0) FROM conversions"
                                   " WHERE at>=?", since), 2),
            }

    def top_products(self, days: int = 30, limit: int = 20) -> List[Dict]:
        """수익 기여 순 상품 (클릭·주문·수수료)."""
        since = time.time() - days * 86400
        with closing(self._conn()) as con:
            rows = con.execute(
                """SELECT l.product_key AS product_key,
                          COALESCE(p.title,'?') AS title,
                          COALESCE(p.category,'') AS category,
                          COUNT(DISTINCT c.id) AS clicks,
                          COUNT(DISTINCT v.id) AS orders,
                          COALESCE(SUM(v.commission),0) AS revenue
                   FROM links l
                   LEFT JOIN products p ON p.key=l.product_key
                   LEFT JOIN clicks c ON c.code=l.code AND c.at>=?
                   LEFT JOIN conversions v ON v.code=l.code AND v.at>=?
                   GROUP BY l.product_key
                   HAVING clicks>0 OR orders>0
                   ORDER BY revenue DESC, clicks DESC LIMIT ?""",
                (since, since, limit)).fetchall()
        return [dict(r) for r in rows]

    def platform_stats(self, days: int = 30) -> List[Dict]:
        since = time.time() - days * 86400
        with closing(self._conn()) as con:
            rows = con.execute(
                """SELECT l.platform AS platform,
                          COUNT(DISTINCT c.id) AS clicks,
                          COUNT(DISTINCT v.id) AS orders,
                          COALESCE(SUM(v.commission),0) AS revenue
                   FROM links l
                   LEFT JOIN clicks c ON c.code=l.code AND c.at>=?
                   LEFT JOIN conversions v ON v.code=l.code AND v.at>=?
                   GROUP BY l.platform ORDER BY revenue DESC""",
                (since, since)).fetchall()
        return [dict(r) for r in rows]

    def category_performance(self, days: int = 60) -> Dict[str, float]:
        """카테고리별 클릭당 수익(EPC) — 랭킹 피드백에 사용."""
        since = time.time() - days * 86400
        with closing(self._conn()) as con:
            rows = con.execute(
                """SELECT COALESCE(p.category,'') AS category,
                          COUNT(DISTINCT c.id) AS clicks,
                          COALESCE(SUM(v.commission),0) AS revenue
                   FROM links l
                   JOIN products p ON p.key=l.product_key
                   LEFT JOIN clicks c ON c.code=l.code AND c.at>=?
                   LEFT JOIN conversions v ON v.code=l.code AND v.at>=?
                   GROUP BY category""", (since, since)).fetchall()
        out: Dict[str, float] = {}
        for r in rows:
            clicks = int(r["clicks"])
            if r["category"] and clicks >= 5:
                out[r["category"]] = round(float(r["revenue"]) / clicks, 4)
        return out

    def recent_videos(self, limit: int = 20) -> List[Dict]:
        with closing(self._conn()) as con:
            rows = con.execute("SELECT * FROM videos ORDER BY created_at DESC LIMIT ?",
                               (limit,)).fetchall()
        return [dict(r) for r in rows]
