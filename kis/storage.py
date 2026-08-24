"""매매 기록 저장소 (SQLite).

주문/체결/일별 성과를 남겨 두면 리스크 한도 판단과 사후 분석에 쓸 수 있다.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .models import OrderResult, Side

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL,
    trade_date   TEXT    NOT NULL,
    env          TEXT    NOT NULL,
    symbol       TEXT    NOT NULL,
    side         TEXT    NOT NULL,
    quantity     INTEGER NOT NULL,
    price        INTEGER NOT NULL,
    order_type   TEXT    NOT NULL,
    order_no     TEXT,
    org_no       TEXT,
    success      INTEGER NOT NULL,
    dry_run      INTEGER NOT NULL DEFAULT 0,
    strategy     TEXT,
    reason       TEXT,
    message      TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(trade_date);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);

CREATE TABLE IF NOT EXISTS fills (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL,
    trade_date   TEXT    NOT NULL,
    order_no     TEXT,
    symbol       TEXT    NOT NULL,
    side         TEXT    NOT NULL,
    quantity     INTEGER NOT NULL,
    price        INTEGER NOT NULL,
    amount       INTEGER NOT NULL,
    UNIQUE(order_no, ts, quantity, price)
);
CREATE INDEX IF NOT EXISTS idx_fills_date ON fills(trade_date);

CREATE TABLE IF NOT EXISTS equity (
    trade_date   TEXT PRIMARY KEY,
    opening      INTEGER NOT NULL,
    closing      INTEGER NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    level        TEXT NOT NULL,
    kind         TEXT NOT NULL,
    detail       TEXT
);
"""


class Storage:
    """SQLite 기반 매매 저널."""

    def __init__(self, db_path: str | Path, env: str = "paper") -> None:
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.env = env
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        with self._cursor() as cur:
            cur.executescript(SCHEMA)

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------- 기록
    def record_order(
        self,
        *,
        symbol: str,
        side: Side,
        quantity: int,
        price: int,
        order_type: str,
        result: OrderResult,
        strategy: str = "",
        reason: str = "",
    ) -> int:
        now = datetime.now()
        with self._cursor() as cur:
            cur.execute(
                """INSERT INTO orders
                   (ts, trade_date, env, symbol, side, quantity, price, order_type,
                    order_no, org_no, success, dry_run, strategy, reason, message)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    now.isoformat(timespec="seconds"), now.date().isoformat(), self.env,
                    symbol, side.value, quantity, price, order_type,
                    result.order_no, result.org_no, int(result.success), int(result.dry_run),
                    strategy, reason, result.message,
                ),
            )
            return int(cur.lastrowid or 0)

    def record_fill(self, *, order_no: str, symbol: str, side: Side, quantity: int, price: int) -> None:
        now = datetime.now()
        with self._cursor() as cur:
            cur.execute(
                """INSERT OR IGNORE INTO fills
                   (ts, trade_date, order_no, symbol, side, quantity, price, amount)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (
                    now.isoformat(timespec="seconds"), now.date().isoformat(), order_no,
                    symbol, side.value, quantity, price, quantity * price,
                ),
            )

    def record_event(self, kind: str, detail: str = "", level: str = "INFO") -> None:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO events (ts, level, kind, detail) VALUES (?,?,?,?)",
                (datetime.now().isoformat(timespec="seconds"), level, kind, detail),
            )

    def set_opening_equity(self, value: int, *, day: date | None = None) -> None:
        """장 시작 시점의 순자산을 기록한다(일일 손실 한도 기준값)."""
        day = day or date.today()
        now = datetime.now().isoformat(timespec="seconds")
        with self._cursor() as cur:
            cur.execute(
                """INSERT INTO equity (trade_date, opening, closing, updated_at) VALUES (?,?,?,?)
                   ON CONFLICT(trade_date) DO NOTHING""",
                (day.isoformat(), value, value, now),
            )

    def update_closing_equity(self, value: int, *, day: date | None = None) -> None:
        day = day or date.today()
        now = datetime.now().isoformat(timespec="seconds")
        with self._cursor() as cur:
            cur.execute(
                """INSERT INTO equity (trade_date, opening, closing, updated_at) VALUES (?,?,?,?)
                   ON CONFLICT(trade_date) DO UPDATE SET closing=excluded.closing, updated_at=excluded.updated_at""",
                (day.isoformat(), value, value, now),
            )

    # ------------------------------------------------------------- 조회
    def opening_equity(self, day: date | None = None) -> int | None:
        day = day or date.today()
        with self._cursor() as cur:
            cur.execute("SELECT opening FROM equity WHERE trade_date = ?", (day.isoformat(),))
            row = cur.fetchone()
        return int(row["opening"]) if row else None

    def order_count(self, day: date | None = None, *, only_success: bool = True) -> int:
        day = day or date.today()
        query = "SELECT COUNT(*) AS n FROM orders WHERE trade_date = ?"
        if only_success:
            query += " AND success = 1"
        with self._cursor() as cur:
            cur.execute(query, (day.isoformat(),))
            return int(cur.fetchone()["n"])

    def symbol_order_count(self, symbol: str, day: date | None = None) -> int:
        day = day or date.today()
        with self._cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS n FROM orders WHERE trade_date = ? AND symbol = ? AND success = 1",
                (day.isoformat(), symbol),
            )
            return int(cur.fetchone()["n"])

    def recent_orders(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM orders ORDER BY id DESC LIMIT ?", (limit,))
            return [dict(row) for row in cur.fetchall()]

    def daily_fill_summary(self, day: date | None = None) -> dict[str, int]:
        """당일 체결 기준 매수/매도 금액 합계."""
        day = day or date.today()
        with self._cursor() as cur:
            cur.execute(
                "SELECT side, SUM(amount) AS total FROM fills WHERE trade_date = ? GROUP BY side",
                (day.isoformat(),),
            )
            rows = {row["side"]: int(row["total"] or 0) for row in cur.fetchall()}
        return {"buy": rows.get("buy", 0), "sell": rows.get("sell", 0)}
