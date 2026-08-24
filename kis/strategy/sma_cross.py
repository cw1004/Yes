"""이동평균 골든/데드크로스 전략."""

from __future__ import annotations

import logging

from .base import Action, Signal, Strategy, StrategyContext, sma

log = logging.getLogger(__name__)


class SmaCrossStrategy(Strategy):
    """단기 이동평균이 장기 이동평균을 상향 돌파하면 매수, 하향 돌파하면 매도.

    직전 봉과 현재 봉의 이동평균 관계를 비교해 '교차가 방금 일어난' 시점에만
    신호를 낸다(이미 정배열인 구간에서 계속 매수하지 않는다).
    """

    name = "sma_cross"

    def __init__(
        self,
        symbols: list[str],
        *,
        short_period: int = 5,
        long_period: int = 20,
        min_volume: int = 10_000,
        size_ratio: float = 0.2,
        **kwargs,
    ) -> None:
        super().__init__(symbols, **kwargs)
        if short_period >= long_period:
            raise ValueError("short_period 는 long_period 보다 작아야 합니다")
        self.short_period = short_period
        self.long_period = long_period
        self.min_volume = min_volume
        self.size_ratio = size_ratio

    def evaluate(self, symbol: str, ctx: StrategyContext) -> Signal:
        closes = ctx.closes(symbol, days=self.long_period * 4)
        if len(closes) < self.long_period + 1:
            return Signal(symbol, Action.HOLD, reason="데이터 부족")

        short_now = sma(closes, self.short_period)
        long_now = sma(closes, self.long_period)
        short_prev = sma(closes[:-1], self.short_period)
        long_prev = sma(closes[:-1], self.long_period)
        if None in (short_now, long_now, short_prev, long_prev):
            return Signal(symbol, Action.HOLD, reason="지표 계산 불가")

        golden_cross = short_prev <= long_prev and short_now > long_now
        dead_cross = short_prev >= long_prev and short_now < long_now
        holding = ctx.holds(symbol)

        if golden_cross and not holding:
            quote = ctx.quote(symbol)
            if quote.volume < self.min_volume:
                return Signal(symbol, Action.HOLD, reason=f"거래량 부족({quote.volume:,})")
            if quote.halted:
                return Signal(symbol, Action.HOLD, reason="거래정지")
            return Signal(
                symbol,
                Action.BUY,
                reason=f"골든크로스 SMA{self.short_period}({short_now:,.0f}) > SMA{self.long_period}({long_now:,.0f})",
                target_price=quote.price,
                size_ratio=self.size_ratio,
            )

        if dead_cross and holding:
            return Signal(
                symbol,
                Action.SELL,
                reason=f"데드크로스 SMA{self.short_period}({short_now:,.0f}) < SMA{self.long_period}({long_now:,.0f})",
                sell_ratio=1.0,
            )

        reason = f"SMA{self.short_period}={short_now:,.0f} SMA{self.long_period}={long_now:,.0f}"
        return Signal(symbol, Action.HOLD, reason=reason)
