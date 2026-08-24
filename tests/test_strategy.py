from __future__ import annotations

from datetime import date, timedelta

import pytest

from kis.models import Balance, Candle, Position, Quote
from kis.strategy import (
    Action,
    ExitPolicy,
    RsiReversalStrategy,
    SmaCrossStrategy,
    create_strategy,
    ema,
    rsi,
    sma,
)
from kis.strategy.base import StrategyContext


class FakeQuoteApi:
    """일봉/현재가를 메모리에서 돌려주는 시세 스텁."""

    def __init__(self, closes: list[int], *, price: int | None = None, volume: int = 1_000_000, halted: bool = False):
        self._closes = closes
        self._price = price if price is not None else closes[-1]
        self._volume = volume
        self._halted = halted

    def daily_candles(self, symbol, *, days=100, **_kwargs):
        start = date.today() - timedelta(days=len(self._closes))
        return [
            Candle(symbol=symbol, date=start + timedelta(days=i), open=c, high=c, low=c, close=c, volume=self._volume)
            for i, c in enumerate(self._closes)
        ]

    def price(self, symbol):
        return Quote(
            symbol=symbol, price=self._price, open=self._price, high=self._price, low=self._price,
            prev_close=self._price, change=0, change_rate=0.0, volume=self._volume, trade_value=0,
            upper_limit=0, lower_limit=0, market_cap=0, halted=self._halted,
        )


def make_ctx(closes, *, positions=None, **kwargs) -> StrategyContext:
    balance = Balance(positions=positions or [], cash=10_000_000, available_cash=10_000_000,
                      total_eval=10_000_000, total_purchase=0, total_pnl=0, net_asset=10_000_000)
    return StrategyContext(quotes=FakeQuoteApi(closes, **kwargs), balance=balance)


def position(symbol="005930", quantity=10, pnl_rate=0.0) -> Position:
    return Position(symbol=symbol, name="테스트", quantity=quantity, sellable=quantity, avg_price=70_000,
                    current_price=70_000, eval_amount=700_000, purchase_amount=700_000, pnl=0, pnl_rate=pnl_rate)


# ------------------------------------------------------------------- 지표
def test_sma_and_ema():
    assert sma([1, 2, 3, 4, 5], 5) == 3
    assert sma([1, 2], 5) is None
    assert ema([1] * 10, 5) == pytest.approx(1.0)


def test_rsi_bounds():
    assert rsi(list(range(1, 40))) == 100.0        # 계속 상승 → 100
    assert rsi(list(range(40, 1, -1))) == pytest.approx(0.0, abs=1e-9)
    assert rsi([1, 2], 14) is None


# --------------------------------------------------------------- SMA 크로스
#: 30봉 동안 보합(SMA5 == SMA20)이다가 마지막 봉에서 급등 → 마지막 봉에서 정확히 골든크로스
GOLDEN_CROSS_CLOSES = [1000] * 30 + [1500]
#: 반대로 마지막 봉에서 급락 → 데드크로스
DEAD_CROSS_CLOSES = [1000] * 30 + [500]


def test_golden_cross_generates_buy():
    closes = GOLDEN_CROSS_CLOSES
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20)
    signal = strategy.evaluate("005930", make_ctx(closes))
    assert signal.action is Action.BUY
    assert "골든크로스" in signal.reason


def test_dead_cross_generates_sell_only_when_holding():
    closes = DEAD_CROSS_CLOSES
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20)

    assert strategy.evaluate("005930", make_ctx(closes)).action is Action.HOLD
    held = make_ctx(closes, positions=[position()])
    assert strategy.evaluate("005930", held).action is Action.SELL


def test_no_signal_while_already_holding_on_golden_cross():
    closes = GOLDEN_CROSS_CLOSES
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20)
    ctx = make_ctx(closes, positions=[position()])
    assert strategy.evaluate("005930", ctx).action is Action.HOLD


def test_low_volume_blocks_entry():
    closes = GOLDEN_CROSS_CLOSES
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20, min_volume=10_000)
    ctx = make_ctx(closes, volume=100)
    signal = strategy.evaluate("005930", ctx)
    assert signal.action is Action.HOLD and "거래량" in signal.reason


def test_halted_stock_is_skipped():
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20)
    signal = strategy.evaluate("005930", make_ctx(GOLDEN_CROSS_CLOSES, halted=True))
    assert signal.action is Action.HOLD and "거래정지" in signal.reason


def test_insufficient_data_holds():
    strategy = SmaCrossStrategy(["005930"], short_period=5, long_period=20)
    signal = strategy.evaluate("005930", make_ctx([1000, 1010, 1020]))
    assert signal.action is Action.HOLD and "데이터 부족" in signal.reason


def test_short_must_be_less_than_long():
    with pytest.raises(ValueError):
        SmaCrossStrategy(["005930"], short_period=20, long_period=5)


# ------------------------------------------------------------------- RSI
def test_rsi_strategy_buys_on_recovery_from_oversold():
    closes = list(range(2000, 1000, -25))  # 지속 하락 → RSI 매우 낮음
    closes += [1010 + i * 60 for i in range(1, 8)]  # 급반등
    strategy = RsiReversalStrategy(["005930"], period=14, oversold=30, overbought=70)
    actions = []
    for cut in range(len(closes) - 6, len(closes) + 1):
        actions.append(strategy.evaluate("005930", make_ctx(closes[:cut])).action)
    assert Action.BUY in actions


def test_rsi_strategy_sells_when_overbought_and_holding():
    closes = list(range(1000, 2000, 25))  # 지속 상승 → RSI 높음
    strategy = RsiReversalStrategy(["005930"], period=14, overbought=70)
    ctx = make_ctx(closes, positions=[position()])
    assert strategy.evaluate("005930", ctx).action is Action.SELL


# ------------------------------------------------------------- 손절 / 익절
def test_exit_policy_stop_loss_and_take_profit():
    policy = ExitPolicy(stop_loss_pct=-5.0, take_profit_pct=10.0)
    assert policy.check(position(pnl_rate=-6.0)).action is Action.SELL
    assert policy.check(position(pnl_rate=12.0)).action is Action.SELL
    assert policy.check(position(pnl_rate=3.0)) is None


def test_registry_creates_strategies():
    assert isinstance(create_strategy("sma_cross", ["005930"]), SmaCrossStrategy)
    assert isinstance(create_strategy("rsi_reversal", ["005930"]), RsiReversalStrategy)
    with pytest.raises(KeyError):
        create_strategy("nope", ["005930"])


def test_duplicate_symbols_removed():
    assert SmaCrossStrategy(["005930", "005930", "000660"]).symbols == ["005930", "000660"]


def test_context_caches_quote_calls():
    ctx = make_ctx([1000] * 30)
    calls = {"n": 0}
    original = ctx.quotes.price

    def counting(symbol):
        calls["n"] += 1
        return original(symbol)

    ctx.quotes.price = counting
    ctx.quote("005930")
    ctx.quote("005930")
    assert calls["n"] == 1
