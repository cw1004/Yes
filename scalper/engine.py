"""3분할 독립 트래커 엔진.

SLOT 1 / 2 / 3 이 각자 티커·피드·지표·포지션·AUTO 토글을 갖습니다.
한 슬롯이 죽어도 나머지 둘은 계속 돕니다. 뉴스·매크로만 공유합니다
(같은 API 를 세 번 때릴 이유가 없으니까요).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from . import indicators
from .feeds import FeedCreds, MarketFeed
from .macro import MacroReader
from .news import NewsCollector
from .signals import buy_signal, sell_signal
from .strategy import Decision, Position, RiskConfig, decide_entry, decide_exit

DEFAULT_TICKERS = ["NVDA", "TSLA", "AAPL"]
WATCHLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "SPY", "AMD", "META", "AMZN", "GOOGL", "QQQ"]


@dataclass
class LogEvent:
    ts: int
    slot: int
    ticker: str
    kind: str            # BUY / SELL / SIGNAL / INFO / ERROR
    message: str
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"ts": self.ts, "slot": self.slot, "ticker": self.ticker,
                "kind": self.kind, "message": self.message, "detail": self.detail}


@dataclass
class SlotStats:
    trades: int = 0
    wins: int = 0
    realized: float = 0.0
    realized_pct: float = 0.0
    fees: float = 0.0

    @property
    def win_rate(self) -> float:
        return self.wins / self.trades * 100 if self.trades else 0.0

    def as_dict(self) -> dict:
        return {"trades": self.trades, "wins": self.wins,
                "realized": round(self.realized, 2),
                "realized_pct": round(self.realized_pct, 2),
                "fees": round(self.fees, 2),
                "win_rate": round(self.win_rate, 1)}


class Slot:
    """독립 트래커 하나."""

    def __init__(self, index: int, ticker: str, cfg: RiskConfig,
                 creds: FeedCreds | None = None, live: bool = False,
                 auto: bool = False, broker=None):
        self.index = index
        self.cfg = cfg
        self.creds = creds or FeedCreds.from_env()
        self.live = live
        self.auto = auto
        self.broker = broker
        self.position: Position | None = None
        self.stats = SlotStats()
        self.last_buy: Decision | None = None
        self.last_sell_score: float = 0.0
        self.last_signal_ts: int = 0
        self.last_exit_ts: int = 0
        self.error: str = ""
        self.set_ticker(ticker)

    # ── 설정 ──
    def set_ticker(self, ticker: str) -> None:
        self.ticker = ticker.upper().strip()
        self.feed = MarketFeed(self.ticker, self.creds, live=self.live)
        self.snapshot = indicators.compute(self.feed.candles)
        self.position = None

    def toggle_auto(self, on: bool | None = None) -> bool:
        self.auto = (not self.auto) if on is None else bool(on)
        return self.auto

    # ── 한 틱 ──
    def step(self, news, macro, open_positions: int, day_pnl_pct: float,
             now: int | None = None) -> list[LogEvent]:
        now = now or int(time.time())
        events: list[LogEvent] = []
        try:
            self.feed.refresh()
            self.snapshot = indicators.compute(self.feed.candles)
        except Exception as e:                      # 피드 문제로 엔진 전체가 멈추면 안 됩니다
            self.error = str(e)
            return [LogEvent(now, self.index, self.ticker, "ERROR", f"피드 오류: {e}")]
        self.error = ""
        snap = self.snapshot
        if snap.price <= 0:
            return events

        if self.position:
            self.position.peak = max(self.position.peak, snap.price)
            d = decide_exit(self.position, snap, news, macro, self.cfg, now=now)
            if d.action == "SELL":
                events.append(self._close(d, snap.price, now))
            return events

        cooldown = max(0.0, self.cfg.reentry_cooldown_sec - (now - self.last_exit_ts)) \
            if self.last_exit_ts else 0.0
        d = decide_entry(self.ticker, snap, news, macro, self.cfg,
                         open_positions=open_positions, day_pnl_pct=day_pnl_pct,
                         cooldown_left=cooldown)
        self.last_buy = d
        self.last_sell_score = sell_signal(snap, min_score=0).score

        if d.action == "BUY":
            if now - self.last_signal_ts >= 30:
                self.last_signal_ts = now
                events.append(LogEvent(
                    now, self.index, self.ticker, "SIGNAL",
                    f"매수 신호 {d.score:.0f}점 — " + ", ".join(d.reasons[:4]),
                    d.as_dict()))
            if self.auto:
                events.append(self._open(d, now))
        return events

    # ── 체결 ──
    def _open(self, d: Decision, now: int) -> LogEvent:
        if self.broker is not None:
            res = self.broker.buy_bracket(self.ticker, d.qty, d.stop, d.target)
            if not res.ok:
                return LogEvent(now, self.index, self.ticker, "ERROR",
                                f"주문 실패: {res.detail}")
        self.position = Position(
            ticker=self.ticker, qty=d.qty, entry=d.price, stop=d.stop,
            target=d.target, opened_at=now, reasons=d.reasons, peak=d.price)
        return LogEvent(now, self.index, self.ticker, "BUY",
                        f"매수 {d.qty:.2f}주 @ {d.price:.2f} "
                        f"(손절 {d.stop:.2f} / 목표 {d.target:.2f}) — "
                        + ", ".join(d.reasons[:4]),
                        d.as_dict())

    def _close(self, d: Decision, price: float, now: int) -> LogEvent:
        pos = self.position
        assert pos is not None
        if self.broker is not None:
            res = self.broker.close(self.ticker)
            if not res.ok:
                return LogEvent(now, self.index, self.ticker, "ERROR",
                                f"청산 실패: {res.detail}")
        fee = (pos.entry + price) * pos.qty * self.cfg.fee_bps / 10_000.0
        pnl_cash = pos.pnl_cash(price) - fee
        pnl_pct = (pnl_cash / (pos.entry * pos.qty) * 100) if pos.entry and pos.qty else 0.0
        self.last_exit_ts = now
        self.stats.trades += 1
        self.stats.fees += fee
        self.stats.realized += pnl_cash
        self.stats.realized_pct += pnl_pct
        if pnl_pct > 0:
            self.stats.wins += 1
        self.position = None
        return LogEvent(now, self.index, self.ticker, "SELL",
                        f"매도 @ {price:.2f} ({pnl_pct:+.2f}%, {pnl_cash:+.2f}$, "
                        f"수수료 {fee:.2f}$) — "
                        + ", ".join(d.reasons[:3]),
                        {"pnl_pct": round(pnl_pct, 3), "pnl_cash": round(pnl_cash, 2),
                         "reasons": d.reasons})

    def force_exit(self, now: int | None = None) -> LogEvent | None:
        if not self.position:
            return None
        now = now or int(time.time())
        d = Decision(action="SELL", ticker=self.ticker, reasons=["수동 청산"])
        return self._close(d, self.snapshot.price, now)

    # ── 직렬화 ──
    def state(self, news_map: dict, now: int | None = None) -> dict:
        now = now or int(time.time())
        snap = self.snapshot
        buy = self.last_buy
        news = news_map.get(self.ticker)
        candles = self.feed.candles[-160:]
        return {
            "index": self.index,
            "ticker": self.ticker,
            "auto": self.auto,
            "source": self.feed.source,
            "error": self.error,
            "price": round(snap.price, 4),
            "indicators": snap.as_dict(),
            "candles": [c.as_dict() for c in candles],
            "buy": buy.as_dict() if buy else None,
            "sell_score": round(self.last_sell_score, 1),
            "position": self.position.as_dict(snap.price, now) if self.position else None,
            "stats": self.stats.as_dict(),
            "news": news.as_dict() if news else None,
        }


class Engine:
    """세 슬롯 + 공유 뉴스/매크로를 묶어 돌립니다."""

    def __init__(self, tickers: list[str] | None = None, cfg: RiskConfig | None = None,
                 live: bool = False, auto: bool = False, broker=None,
                 offline: bool = False):
        self.cfg = cfg or RiskConfig()
        self.creds = FeedCreds.from_env()
        self.live = live
        self.offline = offline
        tickers = (tickers or DEFAULT_TICKERS)[:3]
        while len(tickers) < 3:
            tickers.append(DEFAULT_TICKERS[len(tickers)])
        self.slots = [Slot(i + 1, t, self.cfg, self.creds, live=live, auto=auto,
                           broker=broker) for i, t in enumerate(tickers)]
        self.news = NewsCollector()
        self.macro = MacroReader(offline=offline)
        self.news_map: dict[str, object] = {}
        self.market_news = None
        self.macro_pulse = None
        self.log: list[LogEvent] = []
        self.day_pnl = 0.0
        self.started_at = int(time.time())
        self._lock = threading.Lock()
        self._last_context = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ── 배경 정보 갱신 ──
    def refresh_context(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_context < 120:
            return
        self._last_context = now
        if self.offline:
            self.macro_pulse = self.macro.pulse(None)
            return
        try:
            self.market_news = self.news.market_pulse()
            for slot in self.slots:
                self.news_map[slot.ticker] = self.news.pulse(slot.ticker)
            self.macro_pulse = self.macro.pulse(self.market_news)
        except Exception as e:
            self._append(LogEvent(int(now), 0, "", "ERROR", f"배경 정보 갱신 실패: {e}"))

    # ── 루프 ──
    def step(self) -> list[LogEvent]:
        with self._lock:
            self.refresh_context()
            now = int(time.time())
            open_positions = sum(1 for s in self.slots if s.position)
            day_pnl_pct = self.day_pnl / self.cfg.equity * 100 if self.cfg.equity else 0.0
            events: list[LogEvent] = []
            for slot in self.slots:
                news = self.news_map.get(slot.ticker)
                evs = slot.step(news, self.macro_pulse, open_positions, day_pnl_pct, now=now)
                for e in evs:
                    if e.kind == "SELL":
                        self.day_pnl += float(e.detail.get("pnl_cash", 0.0))
                    if e.kind == "BUY":
                        open_positions += 1
                events.extend(evs)
            for e in events:
                self._append(e)
            return events

    def _append(self, event: LogEvent) -> None:
        self.log.append(event)
        if len(self.log) > 500:
            self.log = self.log[-500:]

    def run(self, interval: float = 1.5, iterations: int | None = None) -> None:
        i = 0
        while not self._stop.is_set():
            self.step()
            i += 1
            if iterations is not None and i >= iterations:
                return
            self._stop.wait(interval)

    def start(self, interval: float = 1.5) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, args=(interval,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # ── 제어 ──
    def set_ticker(self, index: int, ticker: str) -> bool:
        with self._lock:
            for s in self.slots:
                if s.index == index:
                    old = s.ticker
                    s.set_ticker(ticker)
                    self.news_map.pop(old, None)
                    self._last_context = 0
                    self._append(LogEvent(int(time.time()), index, s.ticker, "INFO",
                                          f"SLOT{index} 종목 변경: {old} → {s.ticker}"))
                    return True
        return False

    def set_auto(self, index: int | None, on: bool | None = None) -> dict:
        with self._lock:
            targets = self.slots if index in (None, 0) else [s for s in self.slots if s.index == index]
            for s in targets:
                s.toggle_auto(on)
                self._append(LogEvent(int(time.time()), s.index, s.ticker, "INFO",
                                      f"AUTO {'ON' if s.auto else 'OFF'}"))
            return {s.index: s.auto for s in self.slots}

    def flatten(self) -> list[LogEvent]:
        with self._lock:
            out = []
            for s in self.slots:
                e = s.force_exit()
                if e:
                    self.day_pnl += float(e.detail.get("pnl_cash", 0.0))
                    self._append(e)
                    out.append(e)
            return out

    # ── 상태 ──
    def state(self) -> dict:
        now = int(time.time())
        total_open = 0.0
        for s in self.slots:
            if s.position:
                total_open += s.position.pnl_cash(s.snapshot.price)
        return {
            "ts": now,
            "uptime": now - self.started_at,
            "live": self.live,
            "equity": self.cfg.equity,
            "day_pnl": round(self.day_pnl, 2),
            "day_pnl_pct": round(self.day_pnl / self.cfg.equity * 100, 3) if self.cfg.equity else 0,
            "open_pnl": round(total_open, 2),
            "config": self.cfg.as_dict(),
            "slots": [s.state(self.news_map, now) for s in self.slots],
            "macro": self.macro_pulse.as_dict() if self.macro_pulse else None,
            "market_news": self.market_news.as_dict() if self.market_news else None,
            "watchlist": WATCHLIST,
            "log": [e.as_dict() for e in self.log[-120:]],
        }
