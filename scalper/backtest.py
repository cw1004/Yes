"""워크포워드 백테스트 — 실전 투입 전에 로직이 돈을 버는지 먼저 확인합니다.

봉 단위로 과거를 재생하면서 진입/청산 규칙을 그대로 적용합니다. 미래 데이터를
쓰지 않도록 각 시점에서 그때까지의 캔들만 지표에 넘깁니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import indicators
from .indicators import Candle
from .macro import MacroPulse
from .news import NewsPulse
from .strategy import Position, RiskConfig, decide_entry, decide_exit


@dataclass
class Trade:
    ticker: str
    entry_ts: int
    exit_ts: int
    entry: float
    exit: float
    qty: float
    pnl: float
    pnl_pct: float
    reason_in: list[str] = field(default_factory=list)
    reason_out: list[str] = field(default_factory=list)


@dataclass
class BacktestResult:
    ticker: str
    trades: list[Trade] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)

    @property
    def net(self) -> float:
        return sum(t.pnl for t in self.trades)

    @property
    def wins(self) -> int:
        return sum(1 for t in self.trades if t.pnl > 0)

    @property
    def win_rate(self) -> float:
        return self.wins / len(self.trades) * 100 if self.trades else 0.0

    @property
    def profit_factor(self) -> float:
        gain = sum(t.pnl for t in self.trades if t.pnl > 0)
        loss = -sum(t.pnl for t in self.trades if t.pnl < 0)
        return gain / loss if loss > 0 else float("inf") if gain else 0.0

    @property
    def max_drawdown(self) -> float:
        peak = -1e18
        mdd = 0.0
        for v in self.equity_curve:
            peak = max(peak, v)
            mdd = min(mdd, v - peak)
        return mdd

    @property
    def expectancy(self) -> float:
        return self.net / len(self.trades) if self.trades else 0.0

    def summary(self) -> str:
        return (
            f"{self.ticker}: 매매 {len(self.trades)}회 · 승률 {self.win_rate:.1f}% · "
            f"순손익 {self.net:+.2f}$ · PF {self.profit_factor:.2f} · "
            f"기대값 {self.expectancy:+.2f}$/회 · MDD {self.max_drawdown:.2f}$"
        )


def run(ticker: str, candles: list[Candle], cfg: RiskConfig | None = None,
        news: NewsPulse | None = None, macro: MacroPulse | None = None,
        warmup: int = 30) -> BacktestResult:
    cfg = cfg or RiskConfig()
    res = BacktestResult(ticker=ticker)
    pos: Position | None = None
    equity = 0.0
    last_exit_ts = 0
    reason_in: list[str] = []

    for i in range(warmup, len(candles)):
        window = candles[: i + 1]
        snap = indicators.compute(window)
        now = window[-1].ts
        price = snap.price

        if pos:
            d = decide_exit(pos, snap, news, macro, cfg, now=now)
            if d.action == "SELL":
                fee = (pos.entry + price) * pos.qty * cfg.fee_bps / 10_000.0
                pnl = pos.pnl_cash(price) - fee
                equity += pnl
                res.trades.append(Trade(
                    ticker=ticker, entry_ts=pos.opened_at, exit_ts=now,
                    entry=pos.entry, exit=price, qty=pos.qty, pnl=pnl,
                    pnl_pct=pnl / (pos.entry * pos.qty) * 100 if pos.qty else 0.0,
                    reason_in=reason_in, reason_out=d.reasons))
                pos = None
                last_exit_ts = now
        else:
            cooldown = max(0.0, cfg.reentry_cooldown_sec - (now - last_exit_ts)) if last_exit_ts else 0.0
            d = decide_entry(ticker, snap, news, macro, cfg,
                             open_positions=0, day_pnl_pct=0.0, cooldown_left=cooldown)
            if d.action == "BUY":
                pos = Position(ticker=ticker, qty=d.qty, entry=d.price, stop=d.stop,
                               target=d.target, opened_at=now, reasons=d.reasons,
                               peak=d.price)
                reason_in = d.reasons
        res.equity_curve.append(equity)

    return res
