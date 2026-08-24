from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest

from kis.models import Balance, Execution, OrderResult, OrderType, Position, Quote, Side
from kis.risk import RiskManager
from kis.web import DashboardService, TTLCache, WebConfig, create_app, generate_token

TOKEN = "test-token-abc"


class FakeTrading:
    def __init__(self):
        self.orders: list[tuple] = []
        self.cancelled: list[tuple] = []
        self._positions = [
            Position(symbol="005930", name="삼성전자", quantity=10, sellable=10, avg_price=70_000,
                     current_price=71_500, eval_amount=715_000, purchase_amount=700_000,
                     pnl=15_000, pnl_rate=2.14),
        ]

    def balance(self):
        return Balance(positions=list(self._positions), cash=5_000_000, available_cash=4_900_000,
                       total_eval=5_715_000, total_purchase=700_000, total_pnl=15_000,
                       net_asset=5_715_000)

    def open_orders(self):
        return [Execution(order_no="0000117057", org_no="91252", symbol="005930", name="삼성전자",
                          side=Side.BUY, order_qty=10, filled_qty=3, remaining_qty=7,
                          order_price=70_000, avg_fill_price=70_000.0, order_time="101530",
                          status="접수")]

    def order(self, symbol, side, quantity, *, price=0, order_type=OrderType.LIMIT):
        self.orders.append((symbol, side, quantity, price, order_type))
        return OrderResult(success=True, order_no="ORD0001", message="정상")

    def cancel(self, *, org_no, order_no):
        self.cancelled.append((org_no, order_no))
        return OrderResult(success=True, order_no=order_no, message="취소 완료")

    def cancel_all(self):
        return [self.cancel(org_no="91252", order_no="0000117057")]


class FakeQuotes:
    def price(self, symbol):
        return Quote(symbol=symbol, price=71_500, open=70_800, high=71_900, low=70_500,
                     prev_close=70_900, change=600, change_rate=0.85, volume=12_000_000,
                     trade_value=0, upper_limit=0, lower_limit=0, market_cap=0, name="삼성전자")


@pytest.fixture
def trader(settings, storage):
    return SimpleNamespace(
        settings=settings,
        storage=storage,
        trading=FakeTrading(),
        quotes=FakeQuotes(),
        risk=RiskManager(settings, storage),
    )


@pytest.fixture
def service(trader):
    return DashboardService(trader, watchlist=["005930"], cache_ttl=0.0)


def make_client(trader, **overrides):
    config = WebConfig(token=TOKEN, **overrides)
    app = create_app(trader, config)
    app.config.update(TESTING=True)
    return app.test_client()


def auth(**extra):
    return {"X-Auth-Token": TOKEN, **extra}


# ------------------------------------------------------------------ TTL 캐시
def test_ttl_cache_reuses_within_window():
    cache = TTLCache(ttl=60)
    calls = []
    factory = lambda: (calls.append(1), len(calls))[1]  # noqa: E731
    assert cache.get_or_call("k", factory) == 1
    assert cache.get_or_call("k", factory) == 1
    assert len(calls) == 1

    cache.invalidate("k")
    assert cache.get_or_call("k", factory) == 2


def test_ttl_cache_expires():
    cache = TTLCache(ttl=0.0)
    assert cache.get_or_call("k", lambda: 1) == 1
    assert cache.get_or_call("k", lambda: 2) == 2


# ------------------------------------------------------------------- 서비스
def test_summary_shapes_expected_fields(service, storage):
    storage.set_opening_equity(5_615_000)
    summary = service.summary()
    assert summary["net_asset"] == 5_715_000
    assert summary["daily_pnl"] == 100_000
    assert summary["position_count"] == 1
    assert summary["is_paper"] is True
    assert summary["limits"]["max_orders_per_day"] == 5


def test_summary_without_opening_equity_has_zero_daily_pnl(service):
    assert service.summary()["daily_pnl"] == 0


def test_summary_never_leaks_credentials(service, settings):
    text = str(service.summary())
    assert settings.app_key not in text and settings.app_secret not in text
    assert settings.account_no not in text  # 계좌번호는 마스킹된 형태만 노출


def test_snapshot_bundles_all_sections(service):
    snapshot = service.snapshot()
    assert set(snapshot) == {"summary", "positions", "orders", "journal", "quotes"}
    assert snapshot["positions"][0]["symbol"] == "005930"
    assert snapshot["orders"][0]["side_ko"] == "매수"
    assert snapshot["quotes"][0]["price"] == 71_500


def test_set_halt_toggles_kill_switch(service, settings, trader):
    service.set_halt(True)
    assert settings.kill_switch_path.exists() and trader.risk.halted
    service.set_halt(False)
    assert not settings.kill_switch_path.exists() and not trader.risk.halted


def test_place_order_goes_through_risk_and_tick_rounding(service, trader):
    result = service.place_order(symbol="005930", side="buy", quantity=100, price=70_123)
    symbol, side, quantity, price, _order_type = trader.trading.orders[0]
    assert result["success"] and symbol == "005930" and side is Side.BUY
    assert price == 70_200          # 매수는 호가 단위 올림
    assert quantity == 14           # 1회 한도 100만원으로 축소
    assert result["quantity"] == 14


def test_place_order_rejected_by_risk_limits(service, trader, settings):
    settings.kill_switch_path.write_text("stop")
    result = service.place_order(symbol="005930", side="buy", quantity=1, price=70_000)
    assert not result["success"] and "킬 스위치" in result["message"]
    assert trader.trading.orders == []


def test_place_order_validates_inputs(service):
    assert not service.place_order(symbol="005930", side="hold", quantity=1, price=100)["success"]
    assert not service.place_order(symbol="005930", side="buy", quantity=0, price=100)["success"]
    assert not service.place_order(symbol="005930", side="buy", quantity=1, price=0)["success"]


# -------------------------------------------------------------------- 인증
def test_api_requires_token(trader):
    client = make_client(trader)
    assert client.get("/api/snapshot").status_code == 401
    assert client.get("/api/snapshot", headers={"X-Auth-Token": "wrong"}).status_code == 401
    assert client.get("/api/snapshot", headers=auth()).status_code == 200


def test_index_is_served_without_token(trader):
    response = make_client(trader).get("/")
    assert response.status_code == 200
    assert b"KIS \xeb\x8c\x80\xec\x8b\x9c\xeb\xb3\xb4\xeb\x93\x9c" in response.data  # "KIS 대시보드"


def test_security_headers_present(trader):
    response = make_client(trader).get("/api/config", headers=auth())
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cache-Control"] == "no-store"


def test_generated_tokens_are_unique_and_long():
    a, b = generate_token(), generate_token()
    assert a != b and len(a) >= 20


# --------------------------------------------------------------- 제어 게이팅
def test_readonly_mode_blocks_control_endpoints(trader):
    client = make_client(trader)
    assert client.post("/api/cancel", json={"order_no": "1", "org_no": "2"}, headers=auth()).status_code == 403
    assert client.post("/api/cancel-all", headers=auth()).status_code == 403
    assert client.post("/api/order", json={"symbol": "005930", "side": "buy", "quantity": 1,
                                           "price": 70000}, headers=auth()).status_code == 403
    assert trader.trading.orders == [] and trader.trading.cancelled == []


def test_halt_on_allowed_even_in_readonly(trader, settings):
    client = make_client(trader)
    response = client.post("/api/halt", json={"on": True}, headers=auth())
    assert response.status_code == 200 and response.get_json()["halted"] is True
    assert settings.kill_switch_path.exists()


def test_halt_off_requires_control(trader, settings):
    settings.kill_switch_path.write_text("stop")
    client = make_client(trader)
    assert client.post("/api/halt", json={"on": False}, headers=auth()).status_code == 403
    assert settings.kill_switch_path.exists()  # 여전히 중단 상태

    client = make_client(trader, allow_control=True)
    assert client.post("/api/halt", json={"on": False}, headers=auth()).status_code == 200
    assert not settings.kill_switch_path.exists()


def test_control_mode_allows_cancel_and_order(trader):
    client = make_client(trader, allow_control=True)
    assert client.post("/api/cancel", json={"order_no": "0000117057", "org_no": "91252"},
                       headers=auth()).status_code == 200
    assert trader.trading.cancelled == [("91252", "0000117057")]

    response = client.post("/api/order", json={"symbol": "005930", "side": "buy",
                                               "quantity": 1, "price": 70000}, headers=auth())
    assert response.status_code == 200 and response.get_json()["success"]


def test_order_endpoint_reports_risk_rejection_as_400(trader, settings):
    settings.kill_switch_path.write_text("stop")
    client = make_client(trader, allow_control=True)
    response = client.post("/api/order", json={"symbol": "005930", "side": "buy",
                                               "quantity": 1, "price": 70000}, headers=auth())
    assert response.status_code == 400 and not response.get_json()["success"]


def test_cancel_requires_both_numbers(trader):
    client = make_client(trader, allow_control=True)
    assert client.post("/api/cancel", json={"order_no": "1"}, headers=auth()).status_code == 400


def test_config_endpoint_reports_mode(trader):
    payload = make_client(trader, allow_control=True).get("/api/config", headers=auth()).get_json()
    assert payload["allow_control"] is True and payload["is_paper"] is True


def test_real_env_badge_flows_through(trader, settings):
    trader.settings = replace(settings, env="real")
    payload = make_client(trader).get("/api/config", headers=auth()).get_json()
    assert payload["is_paper"] is False


def test_quotes_endpoint_accepts_symbol_filter(trader):
    rows = make_client(trader).get("/api/quotes?symbols=005930,000660", headers=auth()).get_json()
    assert [r["symbol"] for r in rows] == ["005930", "000660"]


def test_journal_limit_is_clamped(trader):
    client = make_client(trader)
    assert client.get("/api/journal?limit=99999", headers=auth()).status_code == 200
    assert client.get("/api/journal?limit=-5", headers=auth()).status_code == 200


def test_unknown_path_returns_404_not_500(trader):
    """catch-all 예외 핸들러가 정상적인 404 를 500 으로 바꾸지 않아야 한다."""
    assert make_client(trader).get("/favicon.ico").status_code == 404
    assert make_client(trader).get("/api/nope", headers=auth()).status_code == 404


def test_health_needs_no_token_and_leaks_nothing(trader, settings):
    """health 는 토큰 없이 열려 있으므로 계좌 정보가 새면 안 된다."""
    response = make_client(trader).get("/api/health")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["service"] == "kis-trader" and payload["version"]

    text = str(payload)
    for secret in (settings.app_key, settings.app_secret, settings.account_no):
        assert secret not in text
    assert "cash" not in text and "net_asset" not in text
