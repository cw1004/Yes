"""사용자 정의 전략 예시 — 볼린저 밴드 하단 반등 매수.

실행:
    python examples/custom_strategy.py            # 1회 평가 (주문은 .env 설정에 따름)
"""

from __future__ import annotations

import statistics

from kis import KisTrader
from kis.engine import TradingEngine
from kis.logging_setup import setup_logging
from kis.strategy.base import Action, ExitPolicy, Signal, Strategy, StrategyContext, sma


class BollingerStrategy(Strategy):
    """종가가 볼린저 밴드 하단을 이탈했다가 복귀하면 매수, 상단을 넘으면 매도."""

    name = "bollinger"

    def __init__(self, symbols, *, period: int = 20, num_std: float = 2.0, **kwargs):
        super().__init__(symbols, **kwargs)
        self.period = period
        self.num_std = num_std

    def bands(self, closes: list[int]) -> tuple[float, float, float] | None:
        if len(closes) < self.period:
            return None
        window = closes[-self.period :]
        middle = sma(window, self.period)
        deviation = statistics.pstdev(window)
        return middle - self.num_std * deviation, middle, middle + self.num_std * deviation

    def evaluate(self, symbol: str, ctx: StrategyContext) -> Signal:
        closes = ctx.closes(symbol, days=self.period * 5)
        bands = self.bands(closes)
        prev_bands = self.bands(closes[:-1])
        if bands is None or prev_bands is None:
            return Signal(symbol, Action.HOLD, reason="데이터 부족")

        lower, middle, upper = bands
        prev_lower = prev_bands[0]
        price, prev_price = closes[-1], closes[-2]
        holding = ctx.holds(symbol)

        if prev_price < prev_lower <= price and not holding:
            return Signal(
                symbol, Action.BUY,
                reason=f"밴드 하단 복귀 ({price:,} > {lower:,.0f})",
                target_price=ctx.quote(symbol).price,
                size_ratio=0.15,
            )
        if price >= upper and holding:
            return Signal(symbol, Action.SELL, reason=f"밴드 상단 도달 ({price:,} >= {upper:,.0f})")
        return Signal(symbol, Action.HOLD, reason=f"밴드 {lower:,.0f} ~ {upper:,.0f}")


def main() -> None:
    setup_logging("INFO")
    trader = KisTrader.from_env()

    strategy = BollingerStrategy(
        ["005930", "000660"],
        period=20,
        exit_policy=ExitPolicy(stop_loss_pct=-4.0, take_profit_pct=8.0),
    )
    engine = TradingEngine(trader.settings, strategy, client=trader.client, storage=trader.storage)

    report = engine.run_once()
    for signal in report.signals:
        print(f"  {signal}")
    print(f"주문 {report.executed}건 / 당일손익 {report.daily_pnl:,}원")
    engine.shutdown()
    trader.close()


if __name__ == "__main__":
    main()
