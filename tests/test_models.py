from __future__ import annotations

from kis.models import Balance, Execution, OrderBook, Quote, Side, to_float, to_int


def test_to_int_handles_commas_and_junk():
    assert to_int("1,234") == 1234
    assert to_int("70000") == 70000
    assert to_int("") == 0
    assert to_int(None, default=-1) == -1
    assert to_float("-3.25") == -3.25


def test_quote_parsing():
    quote = Quote.from_api(
        "005930",
        {
            "stck_prpr": "71,500", "stck_oprc": "70800", "stck_hgpr": "71900", "stck_lwpr": "70500",
            "stck_sdpr": "70900", "prdy_vrss": "600", "prdy_ctrt": "0.85", "acml_vol": "12,345,678",
            "acml_tr_pbmn": "880000000000", "stck_mxpr": "92100", "stck_llam": "49700",
            "hts_avls": "4270000", "temp_stop_yn": "N",
        },
    )
    assert quote.price == 71_500
    assert quote.change_rate == 0.85
    assert quote.volume == 12_345_678
    assert quote.halted is False


def test_balance_filters_zero_holdings_and_finds_symbol():
    balance = Balance.from_api(
        output1=[
            {"pdno": "005930", "prdt_name": "삼성전자", "hldg_qty": "10", "ord_psbl_qty": "10",
             "pchs_avg_pric": "70000", "prpr": "71500", "evlu_amt": "715000",
             "pchs_amt": "700000", "evlu_pfls_amt": "15000", "evlu_pfls_rt": "2.14"},
            {"pdno": "000660", "prdt_name": "SK하이닉스", "hldg_qty": "0"},
        ],
        output2=[{"dnca_tot_amt": "5000000", "prvs_rcdl_excc_amt": "4900000",
                  "tot_evlu_amt": "5715000", "pchs_amt_smtl_amt": "700000",
                  "evlu_pfls_smtl_amt": "15000", "nass_amt": "5715000"}],
    )
    assert len(balance.positions) == 1
    assert balance.position("005930").quantity == 10
    assert balance.position("000660") is None
    assert balance.available_cash == 4_900_000
    assert balance.net_asset == 5_715_000


def test_execution_side_mapping():
    sell = Execution.from_api({"sll_buy_dvsn_cd": "01", "ord_qty": "10", "tot_ccld_qty": "10", "rmn_qty": "0"})
    buy = Execution.from_api({"sll_buy_dvsn_cd": "02", "ord_qty": "10", "tot_ccld_qty": "4", "rmn_qty": "6"})
    assert sell.side is Side.SELL and sell.is_filled
    assert buy.side is Side.BUY and not buy.is_filled and buy.remaining_qty == 6


def test_orderbook_best_prices_and_spread():
    raw = {f"askp{i}": str(70_000 + i * 100) for i in range(1, 11)}
    raw.update({f"bidp{i}": str(69_900 - i * 100) for i in range(1, 11)})
    raw.update({f"askp_rsqn{i}": "100" for i in range(1, 11)})
    raw.update({f"bidp_rsqn{i}": "200" for i in range(1, 11)})
    raw.update({"total_askp_rsqn": "1000", "total_bidp_rsqn": "2000"})
    book = OrderBook.from_api("005930", raw)
    assert book.best_ask == 70_100
    assert book.best_bid == 69_800
    assert book.spread == 300
    assert book.total_bid_qty == 2000
