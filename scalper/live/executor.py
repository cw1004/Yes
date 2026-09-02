"""주문 실행기 — 브로커가 유일한 진실(source of truth)입니다.

시뮬레이션 엔진의 치명적 가정은 "내가 산 줄 알면 산 것"이었습니다. 실전은 다릅니다.

- 브래킷 손절이 거래소에서 체결되면 프로그램은 아무 통지도 못 받습니다
  → 매 틱 브로커 포지션을 조회해 사라진 포지션을 청산으로 확정합니다
- 진입가는 봉 종가가 아니라 실제 체결 평균가입니다
- 주문은 부분 체결되거나 거부됩니다
- 프로그램이 재시작되면 이미 보유 중인 포지션을 다시 인식해야 합니다

이 모든 걸 sync() 한 번에 정리합니다.
"""

from __future__ import annotations

import datetime as dt
import math
import time
from dataclasses import dataclass, field

from .client import AlpacaClient, AlpacaError, BrokerPosition, Order
from .state import StateStore, TradeRecord


@dataclass
class LivePosition:
    """브로커에서 읽어온 실제 보유 상태 + 우리가 의도한 손절/목표."""

    ticker: str
    qty: float
    entry: float           # 실제 체결 평균가
    price: float
    stop: float = 0.0
    target: float = 0.0
    opened_at: str = ""
    reasons: list[str] = field(default_factory=list)
    unrealized: float = 0.0

    @property
    def pnl_pct(self) -> float:
        return (self.price - self.entry) / self.entry * 100 if self.entry else 0.0

    def held_min(self, now: dt.datetime | None = None) -> float:
        start = _parse(self.opened_at)
        if start is None:
            return 0.0
        now = now or dt.datetime.now(dt.timezone.utc)
        return (now - start).total_seconds() / 60.0

    def as_dict(self) -> dict:
        return {
            "ticker": self.ticker, "qty": round(self.qty, 4),
            "entry": round(self.entry, 4), "price": round(self.price, 4),
            "stop": round(self.stop, 4), "target": round(self.target, 4),
            "pnl_pct": round(self.pnl_pct, 3),
            "pnl_cash": round(self.unrealized, 2),
            "held_min": round(self.held_min(), 1),
            "opened_at": self.opened_at, "reasons": self.reasons,
        }


@dataclass
class ExecEvent:
    kind: str              # ENTRY / EXIT / REJECT / ADOPT / ERROR
    ticker: str
    message: str
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"kind": self.kind, "ticker": self.ticker,
                "message": self.message, "detail": self.detail}


def _parse(text: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat((text or "").replace("Z", "+00:00"))
    except ValueError:
        return None


class LiveExecutor:
    def __init__(self, client: AlpacaClient, store: StateStore,
                 fee_bps: float = 1.0, fill_timeout: float = 20.0):
        self.client = client
        self.store = store
        self.fee_bps = fee_bps
        self.fill_timeout = fill_timeout
        self.positions: dict[str, LivePosition] = {}
        self.last_error: str = ""

    # ── 동기화 ────────────────────────────────────────────────────────
    def sync(self, prices: dict[str, float] | None = None) -> list[ExecEvent]:
        """브로커 실제 상태를 읽어와 내부 상태를 맞춥니다. 매 틱 첫 번째로 호출.

        여기서 나오는 EXIT 이벤트는 우리가 낸 청산이 아니라, 거래소에서
        브래킷 손절/익절이 체결된 것입니다.
        """
        events: list[ExecEvent] = []
        try:
            broker_positions = self.client.positions()
        except AlpacaError as e:
            self.last_error = str(e)
            return [ExecEvent("ERROR", "", f"포지션 조회 실패: {e}")]
        self.last_error = ""

        prices = prices or {}
        intents = dict(self.store.state.intents)

        # 1) 사라진 포지션 = 브로커에서 청산 완료
        for ticker in list(self.positions):
            if ticker not in broker_positions:
                events.append(self._settle_closed(ticker, prices.get(ticker, 0.0)))

        # 2) 현재 보유 중인 것들 반영 (재시작 후 인수인계 포함)
        for ticker, bp in broker_positions.items():
            if bp.qty <= 0:
                continue                      # 공매도 포지션은 이 전략의 대상이 아님
            known = ticker in self.positions
            intent = intents.get(ticker, {})
            pos = LivePosition(
                ticker=ticker,
                qty=bp.qty,
                entry=bp.avg_entry_price,
                price=prices.get(ticker) or bp.current_price,
                stop=float(intent.get("stop") or 0.0),
                target=float(intent.get("target") or 0.0),
                opened_at=str(intent.get("opened_at") or ""),
                reasons=list(intent.get("reasons") or []),
                unrealized=bp.unrealized_pl,
            )
            if not pos.stop or not pos.target:
                self._fill_levels_from_orders(pos)
            self.positions[ticker] = pos
            if not known:
                events.append(ExecEvent(
                    "ADOPT", ticker,
                    f"기존 포지션 인수: {pos.qty:g}주 @ {pos.entry:.2f}"
                    + (f" (손절 {pos.stop:.2f} / 목표 {pos.target:.2f})" if pos.stop else
                       " — 손절 주문이 확인되지 않습니다"),
                    pos.as_dict()))
        return events

    def _fill_levels_from_orders(self, pos: LivePosition) -> None:
        """의도 기록이 없으면 살아 있는 주문에서 손절/목표를 복원합니다."""
        try:
            orders = self.client.open_orders(pos.ticker)
        except AlpacaError:
            return
        for o in orders:
            for leg in ([o.raw] + list(o.legs)):
                if str(leg.get("side")) != "sell":
                    continue
                stop_price = leg.get("stop_price")
                limit_price = leg.get("limit_price")
                if stop_price and not pos.stop:
                    pos.stop = float(stop_price)
                elif limit_price and not pos.target:
                    pos.target = float(limit_price)

    def _settle_closed(self, ticker: str, last_price: float) -> ExecEvent:
        """브로커에서 이미 청산된 포지션을 장부에 확정합니다."""
        pos = self.positions.pop(ticker, None)
        intent = self.store.clear_intent(ticker)
        if pos is None:
            return ExecEvent("EXIT", ticker, "청산 확인 (내부 기록 없음)")

        exit_price = last_price or pos.price or pos.entry
        # 실제 체결가를 주문에서 찾아 씁니다. 없으면 마지막 가격으로 근사합니다.
        actual, why = self._find_exit_fill(ticker, intent.get("order_id", ""))
        if actual > 0:
            exit_price = actual

        fee = (pos.entry + exit_price) * pos.qty * self.fee_bps / 10_000.0
        pnl = (exit_price - pos.entry) * pos.qty - fee
        pnl_pct = pnl / (pos.entry * pos.qty) * 100 if pos.entry and pos.qty else 0.0

        self.store.record_trade(TradeRecord(
            ticker=ticker, qty=pos.qty, entry=pos.entry, exit=exit_price,
            pnl=pnl, pnl_pct=pnl_pct,
            opened_at=pos.opened_at,
            closed_at=dt.datetime.now(dt.timezone.utc).isoformat(),
            reason_in=pos.reasons, reason_out=[why or "브로커 청산"],
            entry_order_id=str(intent.get("order_id", "")),
        ))
        return ExecEvent("EXIT", ticker,
                         f"청산 확정 @ {exit_price:.2f} ({pnl_pct:+.2f}%, {pnl:+.2f}$) "
                         f"— {why or '브로커 체결'}",
                         {"pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 3),
                          "exit": round(exit_price, 4), "why": why})

    def _find_exit_fill(self, ticker: str, entry_order_id: str) -> tuple[float, str]:
        """브래킷의 어느 다리가 체결됐는지 확인해 체결가와 사유를 돌려줍니다."""
        if not entry_order_id:
            return 0.0, ""
        try:
            parent = self.client.get_order(entry_order_id)
        except AlpacaError:
            return 0.0, ""
        for leg in parent.legs:
            o = Order.parse(leg)
            if o.side == "sell" and o.is_filled and o.filled_avg_price > 0:
                why = "손절 체결" if "stop" in o.order_type else "목표 도달"
                return o.filled_avg_price, why
        return 0.0, ""

    # ── 진입 ──────────────────────────────────────────────────────────
    def enter(self, ticker: str, qty: float, stop: float, target: float,
              reasons: list[str], price_hint: float = 0.0) -> ExecEvent:
        ticker = ticker.upper()
        if ticker in self.positions:
            return ExecEvent("REJECT", ticker, "이미 보유 중")

        shares = int(math.floor(qty))
        if shares < 1:
            return ExecEvent("REJECT", ticker,
                             f"산정 수량 {qty:.3f}주 < 1주 — 브래킷 주문은 소수점 매수를 "
                             f"지원하지 않습니다. 계좌를 늘리거나 --risk-per-trade 를 높이세요.")
        if not (0 < stop < (price_hint or stop + 1)) or target <= stop:
            return ExecEvent("REJECT", ticker,
                             f"손절/목표 값이 올바르지 않습니다 (손절 {stop:.2f}, 목표 {target:.2f})")

        try:
            order = self.client.submit_bracket(ticker, shares, stop, target)
        except AlpacaError as e:
            return ExecEvent("REJECT", ticker, f"주문 거부: {e}", {"status": e.status})

        self.store.record_intent(ticker, order.id, stop, target, reasons)
        filled = self._await_fill(order)

        if filled is None or not filled.is_filled:
            status = filled.status if filled else "unknown"
            if filled is not None and filled.is_open:
                # 지정 시간 안에 안 붙으면 취소합니다. 늦은 체결은 신호와 무관해집니다.
                self.client.cancel_order(order.id)
                self.store.clear_intent(ticker)
                return ExecEvent("REJECT", ticker,
                                 f"{self.fill_timeout:.0f}초 내 미체결 — 주문 취소 ({status})")
            self.store.clear_intent(ticker)
            return ExecEvent("REJECT", ticker, f"체결 실패 ({status})")

        entry = filled.filled_avg_price or price_hint
        self.positions[ticker] = LivePosition(
            ticker=ticker, qty=filled.filled_qty, entry=entry, price=entry,
            stop=stop, target=target,
            opened_at=dt.datetime.now(dt.timezone.utc).isoformat(),
            reasons=reasons)
        return ExecEvent("ENTRY", ticker,
                         f"매수 체결 {filled.filled_qty:g}주 @ {entry:.2f} "
                         f"(손절 {stop:.2f} / 목표 {target:.2f}) — "
                         + ", ".join(reasons[:4]),
                         {"order_id": order.id, "entry": round(entry, 4),
                          "qty": filled.filled_qty})

    def _await_fill(self, order: Order) -> Order | None:
        """시장가라도 즉시 체결되지 않습니다. 상태가 확정될 때까지 폴링합니다."""
        deadline = time.monotonic() + self.fill_timeout
        current = order
        while time.monotonic() < deadline:
            if current.is_filled or not current.is_open:
                return current
            time.sleep(0.6)
            try:
                current = self.client.get_order(order.id)
            except AlpacaError:
                return current
        return current

    # ── 청산 ──────────────────────────────────────────────────────────
    def exit(self, ticker: str, reason: str) -> ExecEvent:
        """브래킷 잔여 주문을 먼저 취소해야 청산이 통과합니다.

        미체결 매도 주문이 물량을 잡고 있으면 포지션 청산이 거부됩니다.
        """
        ticker = ticker.upper()
        pos = self.positions.get(ticker)
        if pos is None:
            return ExecEvent("REJECT", ticker, "보유 포지션 없음")

        try:
            for o in self.client.open_orders(ticker):
                self.client.cancel_order(o.id)
        except AlpacaError as e:
            return ExecEvent("ERROR", ticker, f"잔여 주문 취소 실패: {e}")

        time.sleep(0.4)          # 취소가 반영될 짧은 여유
        try:
            self.client.close_position(ticker)
        except AlpacaError as e:
            return ExecEvent("ERROR", ticker, f"청산 주문 실패: {e}")

        # 실제 확정은 다음 sync() 의 _settle_closed 가 합니다. 여기서는 의도만 남깁니다.
        return ExecEvent("EXIT", ticker, f"청산 주문 전송 — {reason}",
                         {"requested": True, "reason": reason})

    def flatten_all(self, reason: str = "전량 청산") -> list[ExecEvent]:
        return [self.exit(t, reason) for t in list(self.positions)]
