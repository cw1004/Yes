"""RSI 과매도/과매수 역추세 전략."""

from __future__ import annotations

import logging

from .base import Action, Signal, Strategy, StrategyContext, rsi

log = logging.getLogger(__name__)


class RsiReversalStrategy(Strategy):
    """RSI 가 과매도 구간을 벗어나면 매수, 과매수 구간에 들어가면 매도."""

    name = "rsi_reversal"

    def __init__(
        self,
        symbols: list[str],
        *,
        period: int = 14,
        oversold: float = 30.0,
        overbought: float = 70.0,
        size_ratio: float = 0.2,
        **kwargs,
    ) -> None:
        super().__init__(symbols, **kwargs)
        self.period = period
        self.oversold = oversold
        self.overbought = overbought
        self.size_ratio = size_ratio

    def evaluate(self, symbol: str, ctx: StrategyContext) -> Signal:
        closes = ctx.closes(symbol, days=self.period * 8)
        value = rsi(closes, self.period)
        prev = rsi(closes[:-1], self.period)
        if value is None or prev is None:
            return Signal(symbol, Action.HOLD, reason="데이터 부족")

        holding = ctx.holds(symbol)

        # 과매도 구간에서 위로 빠져나오는 순간 진입
        if prev < self.oversold <= value and not holding:
            quote = ctx.quote(symbol)
            if quote.halted:
                return Signal(symbol, Action.HOLD, reason="거래정지")
            return Signal(
                symbol,
                Action.BUY,
                reason=f"RSI 반등 {prev:.1f} → {value:.1f}",
                target_price=quote.price,
                size_ratio=self.size_ratio,
            )

        if value >= self.overbought and holding:
            return Signal(symbol, Action.SELL, reason=f"RSI 과매수 {value:.1f}")

        return Signal(symbol, Action.HOLD, reason=f"RSI {value:.1f}")
