from __future__ import annotations

from datetime import datetime

import pytest

from kis.market import KST, estimate_fees, is_market_open, round_to_tick, seconds_until_open, tick_size


@pytest.mark.parametrize(
    "price,expected",
    [(500, 1), (1_999, 1), (2_000, 5), (4_995, 5), (5_000, 10), (19_999, 10),
     (20_000, 50), (49_950, 50), (50_000, 100), (199_900, 100), (200_000, 500),
     (499_500, 500), (500_000, 1_000), (1_000_000, 1_000)],
)
def test_tick_size_table(price, expected):
    assert tick_size(price) == expected


def test_kosdaq_tick_above_50k():
    assert tick_size(60_000, kosdaq=True) == 100
    assert tick_size(60_000, kosdaq=False) == 100


def test_round_to_tick_modes():
    assert round_to_tick(12_345, mode="down") == 12_340   # 매수: 낮게
    assert round_to_tick(12_345, mode="up") == 12_350     # 매도: 높게
    assert round_to_tick(12_345, mode="nearest") == 12_340
    assert round_to_tick(12_340, mode="up") == 12_340     # 이미 호가 단위면 그대로


def test_round_to_tick_never_returns_zero():
    assert round_to_tick(0) >= 1


def test_market_hours():
    monday_open = datetime(2026, 8, 24, 10, 0, tzinfo=KST)
    monday_closed = datetime(2026, 8, 24, 16, 30, tzinfo=KST)
    saturday = datetime(2026, 8, 22, 10, 0, tzinfo=KST)
    assert is_market_open(monday_open)
    assert not is_market_open(monday_closed)
    assert not is_market_open(saturday)


def test_seconds_until_open_skips_weekend():
    friday_evening = datetime(2026, 8, 21, 18, 0, tzinfo=KST)
    wait = seconds_until_open(friday_evening)
    reopen = friday_evening.timestamp() + wait
    assert datetime.fromtimestamp(reopen, KST).weekday() == 0  # 월요일


def test_seconds_until_open_zero_during_session():
    assert seconds_until_open(datetime(2026, 8, 24, 11, 0, tzinfo=KST)) == 0.0


def test_sell_fees_include_tax():
    assert estimate_fees(1_000_000, is_sell=True) > estimate_fees(1_000_000, is_sell=False)
