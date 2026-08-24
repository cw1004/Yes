from __future__ import annotations

import json
from dataclasses import replace

import pytest
import responses

from kis.client import KisClient
from kis.errors import ConfigError
from kis.models import OrderType, Side
from kis.ratelimit import RateLimiter
from kis.trading import TradingApi


@pytest.fixture
def api(settings):
    return TradingApi(KisClient(settings, limiter=RateLimiter(1000)))


def _register_order(settings, odno="0000117057"):
    responses.add(responses.POST, f"{settings.rest_base}/uapi/hashkey", json={"HASH": "H"}, status=200)
    responses.add(
        responses.POST,
        f"{settings.rest_base}/uapi/domestic-stock/v1/trading/order-cash",
        json={"rt_cd": "0", "msg_cd": "APBK0013", "msg1": "주문 전송 완료 되었습니다.",
              "output": {"KRX_FWDG_ORD_ORGNO": "91252", "ODNO": odno, "ORD_TMD": "121052"}},
        status=200,
    )


@responses.activate
def test_limit_buy_builds_expected_body(api, settings, token_response):
    token_response(responses)
    _register_order(settings)

    result = api.buy("005930", 3, price=70_000)

    assert result.success and result.order_no == "0000117057" and result.org_no == "91252"
    order_call = responses.calls[-1].request
    assert order_call.headers["tr_id"] == "VTTC0802U"  # 모의투자 매수
    assert json.loads(order_call.body.decode()) == {
        "CANO": "12345678", "ACNT_PRDT_CD": "01", "PDNO": "005930",
        "ORD_DVSN": "00", "ORD_QTY": "3", "ORD_UNPR": "70000",
    }


@responses.activate
def test_market_sell_uses_zero_price_and_sell_tr(api, settings, token_response):
    token_response(responses)
    _register_order(settings)

    api.sell_market("000660", 2)

    order_call = responses.calls[-1].request
    assert order_call.headers["tr_id"] == "VTTC0801U"  # 모의투자 매도
    body = json.loads(order_call.body.decode())
    assert body["ORD_DVSN"] == "01" and body["ORD_UNPR"] == "0"


@responses.activate
def test_api_error_returns_failed_result_not_exception(api, settings, token_response):
    token_response(responses)
    responses.add(responses.POST, f"{settings.rest_base}/uapi/hashkey", json={"HASH": "H"}, status=200)
    responses.add(
        responses.POST, f"{settings.rest_base}/uapi/domestic-stock/v1/trading/order-cash",
        json={"rt_cd": "1", "msg_cd": "APBK0919", "msg1": "주문가능금액이 부족합니다."}, status=200,
    )
    result = api.buy("005930", 100, price=70_000)
    assert result.success is False
    assert "주문가능금액" in result.message


def test_dry_run_does_not_call_api(settings):
    api = TradingApi(KisClient(replace(settings, dry_run=True), limiter=RateLimiter(1000)))
    result = api.buy("005930", 1, price=70_000)
    assert result.success and result.dry_run  # 네트워크 호출이 없으므로 responses 없이도 통과


def test_real_env_without_opt_in_is_blocked(real_settings):
    api = TradingApi(KisClient(real_settings, limiter=RateLimiter(1000)))
    with pytest.raises(ConfigError, match="KIS_ALLOW_REAL_TRADING"):
        api.buy("005930", 1, price=70_000)


def test_invalid_orders_rejected_locally(api):
    with pytest.raises(ValueError):
        api.buy("005930", 0, price=70_000)
    with pytest.raises(ValueError):
        api.order("005930", Side.BUY, 1, price=0, order_type=OrderType.LIMIT)


@responses.activate
def test_cancel_sets_cancel_division(api, settings, token_response):
    token_response(responses)
    responses.add(responses.POST, f"{settings.rest_base}/uapi/hashkey", json={"HASH": "H"}, status=200)
    responses.add(
        responses.POST, f"{settings.rest_base}/uapi/domestic-stock/v1/trading/order-rvsecncl",
        json={"rt_cd": "0", "msg1": "취소 완료", "output": {"ODNO": "0000117099", "KRX_FWDG_ORD_ORGNO": "91252"}},
        status=200,
    )
    result = api.cancel(org_no="91252", order_no="0000117057")
    body = json.loads(responses.calls[-1].request.body.decode())
    assert result.success
    assert body["RVSE_CNCL_DVSN_CD"] == "02" and body["QTY_ALL_ORD_YN"] == "Y"
    assert body["ORGN_ODNO"] == "0000117057"


@responses.activate
def test_balance_merges_paginated_holdings(api, settings, token_response):
    token_response(responses)
    url = f"{settings.rest_base}/uapi/domestic-stock/v1/trading/inquire-balance"
    responses.add(
        responses.GET, url,
        json={"rt_cd": "0",
              "output1": [{"pdno": "005930", "hldg_qty": "10", "ord_psbl_qty": "10", "pchs_avg_pric": "70000"}],
              "output2": [{"dnca_tot_amt": "1000000", "nass_amt": "1700000"}],
              "ctx_area_fk100": "F", "ctx_area_nk100": "N"},
        status=200, headers={"tr_cont": "F"},
    )
    responses.add(
        responses.GET, url,
        json={"rt_cd": "0",
              "output1": [{"pdno": "000660", "hldg_qty": "5", "ord_psbl_qty": "5", "pchs_avg_pric": "150000"}],
              "output2": [{"dnca_tot_amt": "1000000", "nass_amt": "1700000"}]},
        status=200, headers={"tr_cont": "D"},
    )
    balance = api.balance()
    assert {p.symbol for p in balance.positions} == {"005930", "000660"}
    assert balance.net_asset == 1_700_000
