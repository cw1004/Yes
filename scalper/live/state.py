"""상태 영속화 — 프로그램이 재시작해도 오늘 무슨 일이 있었는지 잊지 않게.

메모리에만 있으면 컨테이너 재시작 한 번에 일일 손실 한도가 리셋됩니다.
그건 안전장치가 아니라 안전장치처럼 보이는 것입니다.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import tempfile
from dataclasses import asdict, dataclass, field


@dataclass
class TradeRecord:
    ticker: str
    qty: float
    entry: float
    exit: float
    pnl: float
    pnl_pct: float
    opened_at: str
    closed_at: str
    reason_in: list[str] = field(default_factory=list)
    reason_out: list[str] = field(default_factory=list)
    entry_order_id: str = ""


@dataclass
class DayState:
    """하루 단위 상태. 날짜가 바뀌면 자동으로 새로 시작합니다."""

    trade_date: str = ""
    start_equity: float = 0.0
    realized_pnl: float = 0.0
    trades: list[dict] = field(default_factory=list)
    # ticker -> {"order_id","stop","target","opened_at","reasons"}
    intents: dict[str, dict] = field(default_factory=dict)

    @property
    def day_pnl_pct(self) -> float:
        return self.realized_pnl / self.start_equity * 100 if self.start_equity else 0.0

    @property
    def wins(self) -> int:
        return sum(1 for t in self.trades if t.get("pnl", 0) > 0)


class StateStore:
    """원자적 쓰기로 저장합니다. 쓰다가 죽어도 파일이 깨지지 않게."""

    def __init__(self, path: str = ".scalper_state.json"):
        self.path = pathlib.Path(path)
        self.state = DayState()

    def load(self, equity: float, today: str | None = None) -> DayState:
        today = today or dt.date.today().isoformat()
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                self.state = DayState(**raw)
            except (json.JSONDecodeError, TypeError, ValueError, OSError):
                self.state = DayState()      # 손상된 파일은 버리고 새로 시작

        if self.state.trade_date != today:
            self.state = DayState(trade_date=today, start_equity=equity)
            self.save()
        elif not self.state.start_equity:
            self.state.start_equity = equity
            self.save()
        return self.state

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(asdict(self.state), ensure_ascii=False, indent=2)
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent or "."), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            pathlib.Path(tmp).unlink(missing_ok=True)
            raise

    # ── 편의 ──
    def record_intent(self, ticker: str, order_id: str, stop: float, target: float,
                      reasons: list[str]) -> None:
        self.state.intents[ticker.upper()] = {
            "order_id": order_id,
            "stop": round(stop, 4),
            "target": round(target, 4),
            "opened_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "reasons": reasons,
        }
        self.save()

    def clear_intent(self, ticker: str) -> dict:
        intent = self.state.intents.pop(ticker.upper(), {})
        self.save()
        return intent

    def record_trade(self, trade: TradeRecord) -> None:
        self.state.trades.append(asdict(trade))
        self.state.realized_pnl += trade.pnl
        self.save()
