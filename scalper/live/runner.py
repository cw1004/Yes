"""실전 매매 루프 — 신호(기존 엔진) × 안전장치 × 실제 주문을 하나로 묶습니다.

시뮬레이션 엔진(engine.py)과 다른 점:
- 가격이 5분봉 종가가 아니라 실시간 체결가입니다
- 포지션은 우리가 아니라 브로커가 알고 있습니다
- 매 틱 안전장치를 통과해야 주문이 나갑니다
- API 호출 예산을 지킵니다 (Alpaca 분당 200콜)
"""

from __future__ import annotations

import datetime as dt
import time
from dataclasses import dataclass, field

from .. import indicators
from ..indicators import Candle
from ..macro import MacroReader
from ..news import NewsCollector
from ..signals import sell_signal
from ..strategy import Position, RiskConfig, decide_entry, decide_exit
from .client import AlpacaClient, AlpacaError
from .executor import ExecEvent, LiveExecutor
from .guards import GuardConfig, GuardResult, TradingGuards
from .state import StateStore

# 호출 예산: 이 주기보다 자주 부르지 않습니다 (초)
BARS_TTL = 60.0
CONTEXT_TTL = 300.0
GUARD_TTL = 30.0


@dataclass
class LiveSlot:
    """실전 슬롯 하나. 티커와 그 티커의 봉 데이터만 들고 있습니다."""

    index: int
    ticker: str
    candles: list[Candle] = field(default_factory=list)
    price: float = 0.0
    last_bars_at: float = 0.0
    last_exit_at: float = 0.0
    last_signal_at: float = 0.0
    blocked_by: str = ""
    score: float = 0.0

    def as_dict(self) -> dict:
        return {"index": self.index, "ticker": self.ticker,
                "price": round(self.price, 4), "score": round(self.score, 1),
                "blocked_by": self.blocked_by, "bars": len(self.candles)}


@dataclass
class LogLine:
    ts: str
    slot: int
    ticker: str
    kind: str
    message: str

    def render(self) -> str:
        tag = f"SLOT{self.slot}" if self.slot else "SYS"
        return f"[{self.ts}] {tag:<6} {self.ticker:<6} {self.kind:<7} {self.message}"


class LiveRunner:
    def __init__(self, client: AlpacaClient, tickers: list[str],
                 cfg: RiskConfig | None = None,
                 guard_cfg: GuardConfig | None = None,
                 state_path: str = ".scalper_state.json",
                 use_context: bool = True,
                 on_log=None):
        self.client = client
        self.cfg = cfg or RiskConfig()
        self.guards = TradingGuards(guard_cfg or GuardConfig())
        self.store = StateStore(state_path)
        self.executor = LiveExecutor(client, self.store, fee_bps=self.cfg.fee_bps)
        self.slots = [LiveSlot(i + 1, t.upper()) for i, t in enumerate(tickers[:3])]
        self.use_context = use_context
        self.news = NewsCollector()
        self.macro = MacroReader()
        self.news_map: dict[str, object] = {}
        self.macro_pulse = None
        self.market_news = None
        self._last_context = 0.0
        self._last_guard = 0.0
        self._guard: GuardResult = GuardResult(can_enter=False, reasons=["미평가"])
        self.log: list[LogLine] = []
        self.on_log = on_log
        self.stopped = False

    # ── 로그 ──
    def _log(self, slot: int, ticker: str, kind: str, message: str) -> None:
        line = LogLine(dt.datetime.now().strftime("%H:%M:%S"), slot, ticker, kind, message)
        self.log.append(line)
        if len(self.log) > 500:
            self.log = self.log[-500:]
        if self.on_log:
            self.on_log(line)
        else:
            print(line.render(), flush=True)

    # ── 초기화 ──
    def start(self) -> None:
        acct = self.client.account()
        self.store.load(acct.equity)
        self.cfg.equity = acct.equity
        mode = "페이퍼" if self.client.paper else "⚠ 실계좌"
        self._log(0, "", "INFO",
                  f"{mode} 연결 · 자산 {acct.equity:,.2f} {acct.currency} · "
                  f"당일매매 {acct.daytrade_count}회 · 종목 "
                  + "/".join(s.ticker for s in self.slots))
        if self.store.state.trades:
            self._log(0, "", "INFO",
                      f"오늘 기록 복원: {len(self.store.state.trades)}건, "
                      f"실현손익 {self.store.state.realized_pnl:+.2f}$")
        for e in self.executor.sync():
            self._emit(e, 0)

    # ── 배경 정보 ──
    def _refresh_context(self) -> None:
        if not self.use_context:
            return
        now = time.monotonic()
        if now - self._last_context < CONTEXT_TTL:
            return
        self._last_context = now
        try:
            self.market_news = self.news.market_pulse()
            for slot in self.slots:
                self.news_map[slot.ticker] = self.news.pulse(slot.ticker)
            self.macro_pulse = self.macro.pulse(self.market_news)
            if self.macro_pulse:
                self._log(0, "", "INFO",
                          f"매크로 {self.macro_pulse.label}({self.macro_pulse.score:+.0f}) "
                          f"· 사이즈 ×{self.macro_pulse.size_multiplier:.2f} "
                          f"· 문턱 {self.macro_pulse.entry_bias:+.1f}점")
        except Exception as e:                 # 배경 정보 실패로 매매가 멈추면 안 됩니다
            self._log(0, "", "WARN", f"뉴스/매크로 갱신 실패 (기술 신호로 계속): {e}")

    def _refresh_bars(self, slot: LiveSlot) -> None:
        now = time.monotonic()
        if slot.candles and now - slot.last_bars_at < BARS_TTL:
            return
        slot.last_bars_at = now
        try:
            rows = self.client.bars(slot.ticker, "5Min", 200)
        except AlpacaError as e:
            self._log(slot.index, slot.ticker, "WARN", f"봉 조회 실패: {e}")
            return
        if rows:
            slot.candles = [Candle(ts=_epoch(b.get("t", "")), open=float(b.get("o", 0)),
                                   high=float(b.get("h", 0)), low=float(b.get("l", 0)),
                                   close=float(b.get("c", 0)), volume=float(b.get("v", 0)))
                            for b in rows]

    # ── 한 틱 ──
    def step(self) -> None:
        now = time.monotonic()
        if now - self._last_guard >= GUARD_TTL or not self.log:
            prev = self._guard.reason
            self._guard = self.guards.evaluate(
                self.client, day_pnl_pct=self.store.state.day_pnl_pct)
            self._last_guard = now
            if self._guard.reason != prev:
                if self._guard.reason:
                    self._log(0, "", "GUARD", self._guard.reason)
                else:
                    self._log(0, "", "GUARD", "모든 조건 통과 — 진입 가능")

        if self._guard.halted:
            self._log(0, "", "HALT", "킬 스위치 감지 — 보유 포지션을 청산하고 정지합니다")
            for e in self.executor.flatten_all("킬 스위치"):
                self._emit(e, 0)
            self.stopped = True
            return

        self._refresh_context()

        # 실시간 가격 (손절 판단은 이 값으로 합니다)
        prices: dict[str, float] = {}
        for slot in self.slots:
            try:
                p = self.client.latest_price(slot.ticker)
            except AlpacaError:
                p = 0.0
            if p > 0:
                slot.price = p
                prices[slot.ticker] = p

        for e in self.executor.sync(prices):
            self._emit(e, self._slot_index(e.ticker))

        open_count = len(self.executor.positions)
        for slot in self.slots:
            self._step_slot(slot, open_count)
            open_count = len(self.executor.positions)

    def _step_slot(self, slot: LiveSlot, open_count: int) -> None:
        self._refresh_bars(slot)
        if len(slot.candles) < 30:
            slot.blocked_by = "봉 데이터 부족"
            return

        snap = indicators.compute(slot.candles)
        if slot.price > 0:
            snap.price = slot.price            # 지표는 봉 기준, 판단은 실시간가 기준
        news = self.news_map.get(slot.ticker)
        pos = self.executor.positions.get(slot.ticker)

        if pos is not None:
            if not self._guard.can_exit:
                slot.blocked_by = "장 마감 — 청산 불가"
                return
            sp = Position(ticker=pos.ticker, qty=pos.qty, entry=pos.entry,
                          stop=pos.stop or pos.entry * (1 - self.cfg.stop_pct),
                          target=pos.target or pos.entry * (1 + self.cfg.target_min_pct),
                          opened_at=int(time.time() - pos.held_min() * 60),
                          reasons=pos.reasons, peak=max(pos.entry, snap.price))
            d = decide_exit(sp, snap, news, self.macro_pulse, self.cfg)
            slot.blocked_by = ""
            if d.action == "SELL":
                self._emit(self.executor.exit(slot.ticker, ", ".join(d.reasons[:2])),
                           slot.index)
            return

        if not self._guard.can_enter:
            slot.blocked_by = self._guard.reason or "진입 차단"
            return

        cooldown = max(0.0, self.cfg.reentry_cooldown_sec -
                       (time.monotonic() - slot.last_exit_at)) if slot.last_exit_at else 0.0
        d = decide_entry(slot.ticker, snap, news, self.macro_pulse, self.cfg,
                         open_positions=open_count,
                         day_pnl_pct=self.store.state.day_pnl_pct,
                         cooldown_left=cooldown)
        slot.score = d.score
        slot.blocked_by = d.blocked_by

        if d.action != "BUY":
            return

        now = time.monotonic()
        if now - slot.last_signal_at >= 30:
            slot.last_signal_at = now
            self._log(slot.index, slot.ticker, "SIGNAL",
                      f"매수 신호 {d.score:.0f}점 (매도압력 {sell_signal(snap, 0).score:.0f}) — "
                      + ", ".join(d.reasons[:4]))
        self._emit(self.executor.enter(slot.ticker, d.qty, d.stop, d.target,
                                       d.reasons, price_hint=snap.price),
                   slot.index)

    def _emit(self, e: ExecEvent, slot_index: int) -> None:
        if e.kind in ("EXIT",) and e.detail.get("pnl") is not None:
            for s in self.slots:
                if s.ticker == e.ticker:
                    s.last_exit_at = time.monotonic()
        self._log(slot_index, e.ticker, e.kind, e.message)

    def _slot_index(self, ticker: str) -> int:
        for s in self.slots:
            if s.ticker == ticker.upper():
                return s.index
        return 0

    # ── 루프 ──
    def run(self, interval: float = 5.0, iterations: int | None = None) -> None:
        self.start()
        i = 0
        try:
            while not self.stopped:
                try:
                    self.step()
                except AlpacaError as e:
                    self._log(0, "", "ERROR", f"API 오류 (계속 시도): {e}")
                    time.sleep(min(interval * 4, 30))
                i += 1
                if iterations is not None and i >= iterations:
                    break
                time.sleep(interval)
        except KeyboardInterrupt:
            self._log(0, "", "INFO", "중단 요청 — 보유 포지션은 브래킷 주문으로 남습니다")
        finally:
            self.summary()

    def summary(self) -> None:
        st = self.store.state
        n = len(st.trades)
        wins = st.wins
        self._log(0, "", "INFO",
                  f"오늘 결산: {n}건 · 승률 {(wins / n * 100 if n else 0):.1f}% · "
                  f"실현손익 {st.realized_pnl:+.2f}$ ({st.day_pnl_pct:+.2f}%) · "
                  f"보유 {len(self.executor.positions)}건")

    def state(self) -> dict:
        st = self.store.state
        return {
            "paper": self.client.paper,
            "guard": self._guard.as_dict(),
            "day": {"date": st.trade_date, "realized": round(st.realized_pnl, 2),
                    "pct": round(st.day_pnl_pct, 3), "trades": len(st.trades),
                    "wins": st.wins},
            "slots": [s.as_dict() for s in self.slots],
            "positions": [p.as_dict() for p in self.executor.positions.values()],
            "macro": self.macro_pulse.as_dict() if self.macro_pulse else None,
            "log": [l.render() for l in self.log[-60:]],
        }


def _epoch(text: str) -> int:
    try:
        return int(dt.datetime.fromisoformat((text or "").replace("Z", "+00:00")).timestamp())
    except ValueError:
        return int(time.time())
