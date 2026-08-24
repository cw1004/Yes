from __future__ import annotations

from dataclasses import replace

from kis.client import KisClient
from kis.engine import TradingEngine
from kis.models import Balance, OrderResult, OrderType, Position, Quote, Side
from kis.ratelimit import RateLimiter
from kis.realtime import NOTICE_FIELDS, RealtimeMessage
from kis.strategy.base import Action, ExitPolicy, Signal, Strategy


class StubStrategy(Strategy):
    name = "stub"

    def __init__(self, symbols, signals=None, **kwargs):
        super().__init__(symbols, **kwargs)
        self.signals = signals or {}
        self.started = False

    def evaluate(self, symbol, ctx):
        return self.signals.get(symbol, Signal(symbol, Action.HOLD))

    def on_start(self, ctx):
        self.started = True


class FakeQuotes:
    def __init__(self, price=70_123):
        self._price = price

    def price(self, symbol):
        return Quote(symbol=symbol, price=self._price, open=0, high=0, low=0, prev_close=0, change=0,
                     change_rate=0.0, volume=1_000_000, trade_value=0, upper_limit=0, lower_limit=0,
                     market_cap=0)

    def daily_candles(self, symbol, **_kwargs):
        return []


class FakeTrading:
    def __init__(self, balance):
        self._balance = balance
        self.orders: list[tuple] = []

    def balance(self):
        return self._balance

    def order(self, symbol, side, quantity, *, price=0, order_type=OrderType.LIMIT):
        self.orders.append((symbol, side, quantity, price, order_type))
        return OrderResult(success=True, order_no=f"ORD{len(self.orders):04d}", message="정상")


def make_balance(cash=10_000_000, positions=None, net_asset=10_000_000) -> Balance:
    return Balance(positions=positions or [], cash=cash, available_cash=cash, total_eval=net_asset,
                   total_purchase=0, total_pnl=0, net_asset=net_asset)


def make_position(symbol="005930", quantity=10, pnl_rate=0.0) -> Position:
    return Position(symbol=symbol, name="테스트", quantity=quantity, sellable=quantity, avg_price=70_000,
                    current_price=70_000, eval_amount=700_000, purchase_amount=700_000, pnl=0,
                    pnl_rate=pnl_rate)


def build_engine(settings, storage, strategy, balance, *, price=70_123, **kwargs) -> TradingEngine:
    engine = TradingEngine(
        settings, strategy,
        client=KisClient(settings, limiter=RateLimiter(1000)),
        storage=storage, **kwargs,
    )
    engine.quotes = FakeQuotes(price)
    engine.trading = FakeTrading(balance)
    return engine


def test_buy_signal_places_tick_aligned_order(settings, storage):
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "테스트 신호", size_ratio=0.2)})
    engine = build_engine(settings, storage, strategy, make_balance(), price=70_123)

    report = engine.run_once()

    assert report.executed == 1
    symbol, side, quantity, price, order_type = engine.trading.orders[0]
    assert symbol == "005930" and side is Side.BUY
    assert price == 70_200          # 매수는 호가 단위 올림(체결 가능성 확보)
    assert quantity == 14           # 1회 한도 100만원 / 70,200원
    assert order_type is OrderType.LIMIT
    assert strategy.started
    assert storage.order_count() == 1


def test_sell_signal_sells_entire_position(settings, storage):
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.SELL, "청산")})
    balance = make_balance(positions=[make_position(quantity=7)])
    engine = build_engine(settings, storage, strategy, balance, price=70_123)

    engine.run_once()

    _symbol, side, quantity, price, _ot = engine.trading.orders[0]
    assert side is Side.SELL and quantity == 7
    assert price == 70_100          # 매도는 내림


def test_hold_signal_places_no_order(settings, storage):
    engine = build_engine(settings, storage, StubStrategy(["005930"]), make_balance())
    report = engine.run_once()
    assert report.orders == [] and engine.trading.orders == []


def test_stop_loss_triggers_before_strategy_signal(settings, storage):
    strategy = StubStrategy(["005930"], exit_policy=ExitPolicy(stop_loss_pct=-5.0, take_profit_pct=10.0))
    balance = make_balance(positions=[make_position(pnl_rate=-7.5)])
    engine = build_engine(settings, storage, strategy, balance)

    report = engine.run_once()

    assert engine.trading.orders[0][1] is Side.SELL
    assert "손절" in report.signals[0].reason


def test_take_profit_triggers(settings, storage):
    strategy = StubStrategy(["005930"], exit_policy=ExitPolicy(take_profit_pct=10.0))
    engine = build_engine(settings, storage, strategy, make_balance(positions=[make_position(pnl_rate=15.0)]))
    report = engine.run_once()
    assert "익절" in report.signals[0].reason
    assert engine.trading.orders[0][1] is Side.SELL


def test_risk_rejection_blocks_order(settings, storage):
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "신호")})
    engine = build_engine(settings, storage, strategy, make_balance(cash=1_000))
    report = engine.run_once()
    assert engine.trading.orders == [] and report.executed == 0


def test_kill_switch_blocks_orders(settings, storage):
    settings.kill_switch_path.write_text("stop")
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "신호")})
    engine = build_engine(settings, storage, strategy, make_balance())
    engine.run_once()
    assert engine.trading.orders == []


def test_daily_loss_halts_engine(settings, storage):
    storage.set_opening_equity(10_000_000)
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "신호")})
    engine = build_engine(settings, storage, strategy, make_balance(net_asset=9_800_000))

    engine.run_once()

    assert engine.risk.halted
    assert engine.trading.orders == []


def test_market_order_mode_sends_zero_price(settings, storage):
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "신호")})
    engine = build_engine(settings, storage, strategy, make_balance(), order_type=OrderType.MARKET)
    engine.run_once()
    assert engine.trading.orders[0][3] == 0


def test_dry_run_still_records_journal(settings, storage):
    dry = replace(settings, dry_run=True)
    strategy = StubStrategy(["005930"], {"005930": Signal("005930", Action.BUY, "신호")})
    engine = build_engine(dry, storage, strategy, make_balance())
    engine.run_once()
    assert storage.recent_orders(1)[0]["symbol"] == "005930"


def test_fill_notice_is_journaled(settings, storage):
    engine = build_engine(settings, storage, StubStrategy(["005930"]), make_balance())
    data = dict.fromkeys(NOTICE_FIELDS, "")
    data.update({"STCK_SHRN_ISCD": "005930", "CNTG_QTY": "3", "CNTG_UNPR": "70500",
                 "CNTG_YN": "2", "SELN_BYOV_CLS": "02", "ODER_NO": "0000117057"})
    engine._on_fill_notice(RealtimeMessage(tr_id="H0STCNI9", tr_key="005930", data=data))

    assert storage.daily_fill_summary()["buy"] == 3 * 70_500


def test_order_notice_without_fill_is_ignored(settings, storage):
    engine = build_engine(settings, storage, StubStrategy(["005930"]), make_balance())
    data = dict.fromkeys(NOTICE_FIELDS, "")
    data.update({"STCK_SHRN_ISCD": "005930", "CNTG_QTY": "3", "CNTG_UNPR": "70500", "CNTG_YN": "1"})
    engine._on_fill_notice(RealtimeMessage(tr_id="H0STCNI9", tr_key="005930", data=data))
    assert storage.daily_fill_summary()["buy"] == 0


def test_run_stops_after_max_cycles(settings, storage):
    engine = build_engine(settings, storage, StubStrategy(["005930"]), make_balance(), interval=1.0)
    engine.run(max_cycles=2, only_market_hours=False)
    # 종료 경로까지 예외 없이 통과하면 성공
    assert engine._started
