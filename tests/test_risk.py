from __future__ import annotations

import pytest

from kis.errors import TradingHaltedError
from kis.models import Balance, OrderType, Position, Side
from kis.risk import RiskManager


def make_balance(*, cash=10_000_000, positions=None, net_asset=10_000_000) -> Balance:
    return Balance(
        positions=positions or [],
        cash=cash,
        available_cash=cash,
        total_eval=net_asset,
        total_purchase=0,
        total_pnl=0,
        net_asset=net_asset,
    )


def make_position(symbol="005930", quantity=10, avg_price=70_000, sellable=None, pnl_rate=0.0) -> Position:
    return Position(
        symbol=symbol, name="테스트", quantity=quantity,
        sellable=quantity if sellable is None else sellable,
        avg_price=avg_price, current_price=int(avg_price),
        eval_amount=int(avg_price * quantity), purchase_amount=int(avg_price * quantity),
        pnl=0, pnl_rate=pnl_rate,
    )


@pytest.fixture
def risk(settings, storage) -> RiskManager:
    return RiskManager(settings, storage)


def test_buy_within_limits_is_approved(risk):
    decision = risk.validate_order(
        symbol="005930", side=Side.BUY, quantity=10, price=70_000, balance=make_balance()
    )
    assert decision and decision.quantity == 10


def test_order_amount_limit_shrinks_quantity(risk):
    # 1회 주문 한도 100만원 → 70,000원짜리는 14주까지
    decision = risk.validate_order(
        symbol="005930", side=Side.BUY, quantity=100, price=70_000, balance=make_balance()
    )
    assert decision.quantity == 14


def test_position_limit_considers_existing_holdings(risk):
    # 종목당 한도 300만원, 이미 280만원 보유 → 20만원(2주)만 추가 가능
    balance = make_balance(positions=[make_position(quantity=40, avg_price=70_000)])
    decision = risk.validate_order(
        symbol="005930", side=Side.BUY, quantity=10, price=70_000, balance=balance
    )
    assert decision.quantity == 2


def test_insufficient_cash_rejects(risk):
    decision = risk.validate_order(
        symbol="005930", side=Side.BUY, quantity=1, price=70_000, balance=make_balance(cash=1_000)
    )
    assert not decision and "현금" in decision.reason


def test_max_positions_blocks_new_symbol(risk):
    holdings = [make_position(symbol=code) for code in ("005930", "000660", "035420")]
    decision = risk.validate_order(
        symbol="005380", side=Side.BUY, quantity=1, price=10_000,
        balance=make_balance(positions=holdings),
    )
    assert not decision and "보유 종목 수" in decision.reason


def test_max_positions_allows_adding_to_existing(risk):
    holdings = [make_position(symbol=code, quantity=1, avg_price=10_000) for code in ("005930", "000660", "035420")]
    decision = risk.validate_order(
        symbol="005930", side=Side.BUY, quantity=1, price=10_000,
        balance=make_balance(positions=holdings),
    )
    assert decision


def test_sell_without_position_rejected(risk):
    decision = risk.validate_order(symbol="005930", side=Side.SELL, quantity=1, price=70_000,
                                   balance=make_balance())
    assert not decision


def test_sell_clamped_to_sellable_quantity(risk):
    balance = make_balance(positions=[make_position(quantity=10, sellable=4)])
    decision = risk.validate_order(symbol="005930", side=Side.SELL, quantity=10, price=70_000, balance=balance)
    assert decision.quantity == 4


def test_daily_order_limit(risk, storage):
    from kis.models import OrderResult

    for i in range(5):  # 한도 5건
        storage.record_order(symbol="005930", side=Side.BUY, quantity=1, price=1,
                             order_type="LIMIT", result=OrderResult(success=True, order_no=str(i)))
    decision = risk.validate_order(symbol="005930", side=Side.BUY, quantity=1, price=70_000,
                                   balance=make_balance())
    assert not decision and "일일 주문 한도" in decision.reason


def test_daily_loss_limit_halts_trading(risk, storage):
    storage.set_opening_equity(10_000_000)
    pnl = risk.update_daily_pnl(make_balance(net_asset=9_850_000))
    assert pnl == -150_000
    assert risk.halted
    with pytest.raises(TradingHaltedError):
        risk.check_trading_allowed()
    decision = risk.validate_order(symbol="005930", side=Side.BUY, quantity=1, price=70_000,
                                   balance=make_balance())
    assert not decision


def test_small_loss_does_not_halt(risk, storage):
    storage.set_opening_equity(10_000_000)
    assert risk.update_daily_pnl(make_balance(net_asset=9_950_000)) == -50_000
    assert not risk.halted


def test_kill_switch_file_blocks_orders(risk, settings):
    settings.kill_switch_path.write_text("stop")
    assert risk.halted
    decision = risk.validate_order(symbol="005930", side=Side.BUY, quantity=1, price=70_000,
                                   balance=make_balance())
    assert not decision and "킬 스위치" in decision.reason


def test_size_position_respects_order_limit(risk):
    # 자산의 50% = 500만원이지만 1회 한도가 100만원이므로 14주
    assert risk.size_position(price=70_000, balance=make_balance(), target_ratio=0.5) == 14


def test_size_position_zero_when_price_invalid(risk):
    assert risk.size_position(price=0, balance=make_balance()) == 0


def test_market_order_without_price_is_allowed(risk):
    decision = risk.validate_order(symbol="005930", side=Side.SELL, quantity=1, price=0,
                                   balance=make_balance(positions=[make_position()]),
                                   order_type=OrderType.MARKET)
    assert decision
