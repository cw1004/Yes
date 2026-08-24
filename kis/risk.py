"""리스크 관리.

주문을 내기 전 통과해야 하는 검사들을 한 곳에 모았다.
전략이 아무리 강한 신호를 내도 여기서 막히면 주문은 나가지 않는다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from .config import Settings
from .errors import TradingHaltedError
from .models import Balance, OrderType, Side
from .storage import Storage

log = logging.getLogger(__name__)


@dataclass
class RiskDecision:
    """검사 결과. ``approved`` 가 False 면 주문하지 않는다."""

    approved: bool
    quantity: int = 0
    reason: str = ""

    def __bool__(self) -> bool:
        return self.approved


class RiskManager:
    """한도 검사 + 포지션 사이징."""

    def __init__(self, settings: Settings, storage: Storage) -> None:
        self.settings = settings
        self.limits = settings.risk
        self.storage = storage
        self._halted_reason: str | None = None

    # ------------------------------------------------------------ 매매 중단
    @property
    def kill_switch_active(self) -> bool:
        """파일 하나로 즉시 매매를 멈출 수 있게 한다(`touch data/KILL_SWITCH`)."""
        return self.settings.kill_switch_path.exists()

    def halt(self, reason: str) -> None:
        """이후 모든 주문을 거부한다."""
        if self._halted_reason is None:
            log.critical("매매 중단: %s", reason)
            self.storage.record_event("HALT", reason, level="CRITICAL")
        self._halted_reason = reason

    def resume(self) -> None:
        self._halted_reason = None

    @property
    def halted(self) -> bool:
        return self._halted_reason is not None or self.kill_switch_active

    def check_trading_allowed(self) -> None:
        """매매 가능 상태인지 확인한다. 아니면 예외를 던진다."""
        if self.kill_switch_active:
            raise TradingHaltedError(
                f"킬 스위치가 켜져 있습니다: {self.settings.kill_switch_path} (파일을 지우면 재개됩니다)"
            )
        if self._halted_reason:
            raise TradingHaltedError(f"매매가 중단된 상태입니다: {self._halted_reason}")

    # ------------------------------------------------------- 일일 손실 한도
    def update_daily_pnl(self, balance: Balance, *, day: date | None = None) -> int:
        """현재 순자산으로 일일 손익을 갱신하고, 한도 초과 시 매매를 중단한다.

        Returns:
            당일 손익(원). 기준 순자산이 없으면 0.
        """
        day = day or date.today()
        net_asset = balance.net_asset or (balance.total_eval + balance.cash)
        opening = self.storage.opening_equity(day)
        if opening is None:
            self.storage.set_opening_equity(net_asset, day=day)
            log.info("당일 기준 순자산 등록: %s원", f"{net_asset:,}")
            return 0

        self.storage.update_closing_equity(net_asset, day=day)
        pnl = net_asset - opening
        if pnl < 0 and abs(pnl) >= self.limits.max_daily_loss:
            self.halt(f"일일 손실 한도 초과 (손실 {abs(pnl):,}원 >= 한도 {self.limits.max_daily_loss:,}원)")
        return pnl

    # ------------------------------------------------------------ 주문 검증
    def validate_order(
        self,
        *,
        symbol: str,
        side: Side,
        quantity: int,
        price: int,
        balance: Balance,
        order_type: OrderType = OrderType.LIMIT,
    ) -> RiskDecision:
        """주문 가능 여부를 판정하고, 필요하면 수량을 줄여 돌려준다."""
        try:
            self.check_trading_allowed()
        except TradingHaltedError as exc:
            return RiskDecision(False, reason=str(exc))

        if quantity <= 0:
            return RiskDecision(False, reason="주문 수량이 0 이하입니다")
        if price <= 0 and order_type is OrderType.LIMIT:
            return RiskDecision(False, reason="지정가 주문에 유효한 가격이 없습니다")

        if self.storage.order_count() >= self.limits.max_orders_per_day:
            return RiskDecision(False, reason=f"일일 주문 한도 {self.limits.max_orders_per_day}건 도달")

        return (
            self._validate_buy(symbol, quantity, price, balance)
            if side is Side.BUY
            else self._validate_sell(symbol, quantity, balance)
        )

    def _validate_buy(self, symbol: str, quantity: int, price: int, balance: Balance) -> RiskDecision:
        limits = self.limits
        position = balance.position(symbol)

        # 신규 종목이면 보유 종목 수 한도를 확인한다.
        if position is None and len(balance.positions) >= limits.max_positions:
            return RiskDecision(False, reason=f"보유 종목 수 한도 {limits.max_positions}개 도달")

        # 1회 주문 금액 한도
        max_qty_by_order = limits.max_order_amount // price if price else 0
        # 종목당 보유 금액 한도
        held_amount = int(position.avg_price * position.quantity) if position else 0
        remaining_room = max(limits.max_position_amount - held_amount, 0)
        max_qty_by_position = remaining_room // price if price else 0
        # 주문가능 현금 (여유분 1% 남김)
        max_qty_by_cash = int(balance.available_cash * 0.99) // price if price else 0

        allowed = min(quantity, max_qty_by_order, max_qty_by_position, max_qty_by_cash)
        if allowed <= 0:
            reasons = []
            if max_qty_by_order <= 0:
                reasons.append(f"1회 주문 한도 {limits.max_order_amount:,}원")
            if max_qty_by_position <= 0:
                reasons.append(f"종목당 보유 한도 {limits.max_position_amount:,}원")
            if max_qty_by_cash <= 0:
                reasons.append(f"주문가능현금 부족({balance.available_cash:,}원)")
            return RiskDecision(False, reason="매수 불가: " + ", ".join(reasons or ["수량 계산 결과 0주"]))

        if allowed < quantity:
            log.info("%s 매수 수량 축소: %d주 → %d주 (리스크 한도)", symbol, quantity, allowed)
        return RiskDecision(True, quantity=allowed, reason="")

    def _validate_sell(self, symbol: str, quantity: int, balance: Balance) -> RiskDecision:
        position = balance.position(symbol)
        if position is None or position.quantity <= 0:
            return RiskDecision(False, reason=f"{symbol} 보유 수량이 없습니다")
        sellable = position.sellable if position.sellable > 0 else position.quantity
        allowed = min(quantity, sellable)
        if allowed <= 0:
            return RiskDecision(False, reason=f"{symbol} 매도가능 수량이 없습니다")
        if allowed < quantity:
            log.info("%s 매도 수량 축소: %d주 → %d주 (보유/가능 수량)", symbol, quantity, allowed)
        return RiskDecision(True, quantity=allowed)

    # ----------------------------------------------------------- 포지션 사이징
    def size_position(self, *, price: int, balance: Balance, target_ratio: float = 0.2) -> int:
        """자산의 일정 비율만큼 매수할 수량을 계산한다.

        1회 주문 한도와 주문가능현금 중 더 작은 값을 넘지 않는다.
        """
        if price <= 0:
            return 0
        total_asset = balance.net_asset or (balance.total_eval + balance.cash)
        budget = min(
            total_asset * max(min(target_ratio, 1.0), 0.0),
            float(self.limits.max_order_amount),
            balance.available_cash * 0.99,
        )
        return max(int(budget // price), 0)
