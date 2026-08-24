from __future__ import annotations

import pytest
import responses

from kis import KisTrader
from kis.cli import build_parser, main
from kis.ratelimit import RateLimiter


@pytest.fixture
def trader(settings):
    trader = KisTrader.from_settings(settings)
    trader.client.limiter = RateLimiter(1000)
    yield trader
    trader.close()


def test_parser_requires_a_subcommand():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])


def test_parser_defaults_for_run():
    args = build_parser().parse_args(["run", "--symbols", "005930,000660"])
    assert args.strategy == "sma_cross" and args.interval == 60.0 and not args.market


@responses.activate
def test_price_command_prints_quote(trader, settings, token_response, capsys):
    from kis.cli import cmd_price

    token_response(responses)
    responses.add(
        responses.GET,
        f"{settings.rest_base}/uapi/domestic-stock/v1/quotations/inquire-price",
        json={"rt_cd": "0", "output": {"stck_prpr": "71500", "prdy_vrss": "600", "prdy_ctrt": "0.85",
                                       "acml_vol": "1000000", "stck_hgpr": "72000", "stck_lwpr": "70000"}},
        status=200,
    )
    args = build_parser().parse_args(["price", "005930"])
    assert cmd_price(trader, args) == 0
    assert "71,500원" in capsys.readouterr().out


@responses.activate
def test_balance_command_lists_positions(trader, settings, token_response, capsys):
    from kis.cli import cmd_balance

    token_response(responses)
    responses.add(
        responses.GET,
        f"{settings.rest_base}/uapi/domestic-stock/v1/trading/inquire-balance",
        json={"rt_cd": "0",
              "output1": [{"pdno": "005930", "prdt_name": "삼성전자", "hldg_qty": "10", "ord_psbl_qty": "10",
                           "pchs_avg_pric": "70000", "prpr": "71500", "evlu_amt": "715000",
                           "pchs_amt": "700000", "evlu_pfls_amt": "15000", "evlu_pfls_rt": "2.14"}],
              "output2": [{"dnca_tot_amt": "1000000", "nass_amt": "1715000", "tot_evlu_amt": "1715000"}]},
        status=200,
    )
    assert cmd_balance(trader, build_parser().parse_args(["balance"])) == 0
    out = capsys.readouterr().out
    assert "삼성전자" in out and "2.14" in out


def test_halt_creates_and_removes_kill_switch(trader, settings, capsys):
    from kis.cli import cmd_halt

    cmd_halt(trader, build_parser().parse_args(["halt"]))
    assert settings.kill_switch_path.exists()
    assert trader.risk.halted

    cmd_halt(trader, build_parser().parse_args(["halt", "--off"]))
    assert not settings.kill_switch_path.exists()
    assert not trader.risk.halted


def test_buy_requires_price_or_market(trader, capsys):
    from kis.cli import cmd_buy

    args = build_parser().parse_args(["buy", "005930", "-q", "1"])
    assert cmd_buy(trader, args) == 2
    assert "--price" in capsys.readouterr().err


def test_main_reports_config_error_without_traceback(monkeypatch, capsys):
    for key in ("KIS_APP_KEY", "KIS_APP_SECRET", "KIS_ACCOUNT_NO"):
        monkeypatch.delenv(key, raising=False)
    assert main(["--env-file", "does-not-exist.env", "balance"]) == 1
