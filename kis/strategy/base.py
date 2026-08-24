"""전략 인터페이스.

전략은 "무엇을 살지/팔지"만 판단한다. 수량 산정과 한도 검사는
:mod:`kis.risk`, 실제 주문 전송은 :mod:`kis.engine` 이 담당한다.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from ..models import Balance, Candle, Position, Quote
from ..quotes import QuoteApi

log = logging.getLogger(__name__)


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class Signal:
    """전략이 내놓는 매매 신호."""

    symbol: str
    action: Action = Action.HOLD
    reason: str = ""
    target_price: int = 0          # 0 이면 현재가/시장가로 처리
    size_ratio: float = 0.2        # 총자산 대비 투입 비율 (매수 시)
    sell_ratio: float = 1.0        # 보유 수량 대비 매도 비율 (매도 시)

    @property
    def is_actionable(self) -> bool:
        return self.action is not Action.HOLD

    def __str__(self) -> str:
        return f"{self.symbol} {self.action.value}" + (f" ({self.reason})" if self.reason else "")


@dataclass
class ExitPolicy:
    """전략과 무관하게 적용되는 보호 청산 규칙."""

    stop_loss_pct: float = -5.0    # 손절 수익률(%)
    take_profit_pct: float = 10.0  # 익절 수익률(%)

    def check(self, position: Position) -> Signal | None:
        if self.stop_loss_pct and position.pnl_rate <= self.stop_loss_pct:
            return Signal(
                position.symbol,
                Action.SELL,
                reason=f"손절 ({position.pnl_rate:.2f}% <= {self.stop_loss_pct}%)",
                sell_ratio=1.0,
            )
        if self.take_profit_pct and position.pnl_rate >= self.take_profit_pct:
            return Signal(
                position.symbol,
                Action.SELL,
                reason=f"익절 ({position.pnl_rate:.2f}% >= {self.take_profit_pct}%)",
                sell_ratio=1.0,
            )
        return None


@dataclass
class StrategyContext:
    """전략이 판단에 사용하는 재료 묶음."""

    quotes: QuoteApi
    balance: Balance
    now: datetime = field(default_factory=datetime.now)
    _candle_cache: dict[tuple[str, int], list[Candle]] = field(default_factory=dict, repr=False)
    _quote_cache: dict[str, Quote] = field(default_factory=dict, repr=False)

    def quote(self, symbol: str) -> Quote:
        """현재가(사이클 내 캐시)."""
        if symbol not in self._quote_cache:
            self._quote_cache[symbol] = self.quotes.price(symbol)
        return self._quote_cache[symbol]

    def candles(self, symbol: str, *, days: int = 120) -> list[Candle]:
        """일봉(사이클 내 캐시)."""
        key = (symbol, days)
        if key not in self._candle_cache:
            self._candle_cache[key] = self.quotes.daily_candles(symbol, days=days)
        return self._candle_cache[key]

    def closes(self, symbol: str, *, days: int = 120) -> list[int]:
        return [c.close for c in self.candles(symbol, days=days)]

    def position(self, symbol: str) -> Position | None:
        return self.balance.position(symbol)

    def holds(self, symbol: str) -> bool:
        pos = self.position(symbol)
        return pos is not None and pos.quantity > 0

    def reset_cache(self) -> None:
        self._candle_cache.clear()
        self._quote_cache.clear()


class Strategy(ABC):
    """모든 전략의 기반 클래스."""

    name: str = "base"

    def __init__(self, symbols: list[str], *, exit_policy: ExitPolicy | None = None) -> None:
        self.symbols = list(dict.fromkeys(symbols))  # 중복 제거, 순서 유지
        self.exit_policy = exit_policy or ExitPolicy()

    @abstractmethod
    def evaluate(self, symbol: str, ctx: StrategyContext) -> Signal:
        """종목 하나에 대한 매매 신호를 만든다."""

    def on_start(self, ctx: StrategyContext) -> None:
        """엔진 시작 시 1회 호출(워밍업 등)."""

    def on_cycle_end(self, ctx: StrategyContext) -> None:
        """매 사이클 종료 시 호출."""

    def describe(self) -> str:
        return f"{self.name} (종목 {len(self.symbols)}개)"


# ------------------------------------------------------------------ 지표 helper
def sma(values: list[int] | list[float], period: int) -> float | None:
    """단순이동평균. 데이터가 부족하면 None."""
    if period <= 0 or len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema(values: list[int] | list[float], period: int) -> float | None:
    """지수이동평균."""
    if period <= 0 or len(values) < period:
        return None
    k = 2 / (period + 1)
    result = float(sum(values[:period]) / period)
    for value in values[period:]:
        result = value * k + result * (1 - k)
    return result


def rsi(values: list[int] | list[float], period: int = 14) -> float | None:
    """Wilder 방식 RSI."""
    if len(values) < period + 1:
        return None
    diffs = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = sum(d for d in diffs[:period] if d > 0) / period
    losses = -sum(d for d in diffs[:period] if d < 0) / period
    for d in diffs[period:]:
        gains = (gains * (period - 1) + max(d, 0)) / period
        losses = (losses * (period - 1) + max(-d, 0)) / period
    if losses == 0:
        return 100.0
    rs = gains / losses
    return 100 - (100 / (1 + rs))
