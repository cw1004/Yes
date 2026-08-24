from __future__ import annotations

from datetime import date

from kis.models import OrderResult, Side


def _ok(order_no="0001") -> OrderResult:
    return OrderResult(success=True, order_no=order_no, message="정상처리")


def test_record_order_and_count(storage):
    storage.record_order(symbol="005930", side=Side.BUY, quantity=1, price=70000,
                         order_type="LIMIT", result=_ok(), strategy="test")
    storage.record_order(symbol="005930", side=Side.SELL, quantity=1, price=71000,
                         order_type="LIMIT", result=OrderResult(success=False, message="거부"))
    assert storage.order_count() == 1                      # 성공 건만
    assert storage.order_count(only_success=False) == 2
    assert storage.symbol_order_count("005930") == 1
    assert storage.recent_orders(5)[0]["symbol"] == "005930"


def test_fills_are_deduplicated(storage):
    for _ in range(3):
        storage.record_fill(order_no="0001", symbol="005930", side=Side.BUY, quantity=5, price=70000)
    summary = storage.daily_fill_summary()
    assert summary["buy"] >= 350_000
    assert summary["sell"] == 0


def test_opening_equity_is_written_once(storage):
    storage.set_opening_equity(10_000_000)
    storage.set_opening_equity(9_000_000)  # 무시되어야 한다
    assert storage.opening_equity() == 10_000_000
    storage.update_closing_equity(9_500_000)
    assert storage.opening_equity(date.today()) == 10_000_000
