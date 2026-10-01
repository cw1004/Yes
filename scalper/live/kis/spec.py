"""한국투자증권 Open API 명세 — 엔드포인트·tr_id·필드명을 한곳에 모았습니다.

**왜 상수가 아니라 설정인가**

KIS 는 tr_id 와 응답 필드명이 개정됩니다. 코드 곳곳에 하드코딩하면 명세가
한 번 바뀔 때마다 코드를 고쳐야 합니다. 여기 모아두면 JSON 파일 하나로 덮어쓸 수
있고, 틀렸을 때 오류 메시지가 "spec 의 어느 키를 고치면 되는지"를 가리킵니다.

    export KIS_SPEC_FILE=my_spec.json      # 일부만 덮어쓰기 (깊은 병합)

아래 기본값은 공개 문서 기준으로 채운 것이며, 계좌 종류와 개정 시점에 따라
다를 수 있습니다. 처음 붙일 때는 반드시 `python3 -m scalper kis-probe` 로
실제 응답을 확인하세요.
"""

from __future__ import annotations

import copy
import json
import os
import pathlib

# ── 기본 명세 ─────────────────────────────────────────────────────────
DEFAULT: dict = {
    "base": {
        "real": "https://openapi.koreainvestment.com:9443",
        "paper": "https://openapivts.koreainvestment.com:29443",
    },
    "paths": {
        "token": "/oauth2/tokenP",
        "revoke": "/oauth2/revokeP",
        "hashkey": "/uapi/hashkey",
        "order": "/uapi/overseas-stock/v1/trading/order",
        "order_cancel": "/uapi/overseas-stock/v1/trading/order-rvsecncl",
        "balance": "/uapi/overseas-stock/v1/trading/inquire-balance",
        "open_orders": "/uapi/overseas-stock/v1/trading/inquire-nccs",
        "price": "/uapi/overseas-price/v1/quotations/price",
        "minute_bars": "/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice",
    },
    # tr_id 는 실전/모의가 다릅니다. 섞으면 조용히 거부당합니다.
    "tr_id": {
        "real": {
            "buy": "TTTT1002U",
            "sell": "TTTT1006U",
            "cancel": "TTTT1004U",
            "balance": "TTTS3012R",
            "open_orders": "TTTS3018R",
        },
        "paper": {
            "buy": "VTTT1002U",
            "sell": "VTTT1001U",
            "cancel": "VTTT1004U",
            "balance": "VTTS3012R",
            "open_orders": "VTTS3018R",
        },
        "price": "HHDFS00000300",
        "minute_bars": "HHDFS76950200",
    },
    # 주문용 거래소 코드와 시세용 거래소 코드가 다릅니다 (NASD vs NAS).
    "exchange": {
        "order": {"NASDAQ": "NASD", "NYSE": "NYSE", "AMEX": "AMEX"},
        "quote": {"NASDAQ": "NAS", "NYSE": "NYS", "AMEX": "AMS"},
        "default": "NASDAQ",
    },
    "order": {
        "division_limit": "00",       # 지정가
        "server_division": "0",
        "slippage_pct": 0.3,          # 지정가를 현재가보다 이만큼 유리하게 (체결 우선)
    },
    # 응답 필드명 — kis-probe 로 실제 응답을 보고 맞추세요.
    "fields": {
        "balance_rows": "output1",
        "balance_summary": "output2",
        "position_symbol": ["ovrs_pdno", "pdno"],
        "position_qty": ["ovrs_cblc_qty", "cblc_qty13", "ord_psbl_qty"],
        "position_avg": ["pchs_avg_pric", "avg_unpr3"],
        "position_price": ["now_pric2", "ovrs_now_pric1"],
        "position_eval": ["ovrs_stck_evlu_amt", "evlu_amt"],
        "position_pl": ["frcr_evlu_pfls_amt", "evlu_pfls_amt"],
        "summary_equity": ["tot_evlu_pfls_amt", "frcr_pchs_amt1", "tot_asst_amt"],
        "summary_cash": ["frcr_dncl_amt_2", "ord_psbl_frcr_amt"],
        "summary_buying_power": ["ord_psbl_frcr_amt", "frcr_ord_psbl_amt1"],
        "order_id": ["ODNO", "odno"],
        "order_rows": "output",
        "price_value": ["last", "ovrs_nmix_prpr"],
        "bar_rows": "output2",
        "bar_date": ["xymd", "stck_bsop_date"],
        "bar_time": ["xhms", "stck_cntg_hour"],
        "bar_open": ["open", "stck_oprc"],
        "bar_high": ["high", "stck_hgpr"],
        "bar_low": ["low", "stck_lwpr"],
        "bar_close": ["last", "stck_prpr"],
        "bar_volume": ["evol", "cntg_vol"],
    },
    "limits": {
        "calls_per_sec_real": 18,     # 공식 20/초. 여유를 둡니다.
        "calls_per_sec_paper": 2,
        "token_ttl_sec": 82800,       # 24시간보다 짧게 잡아 미리 갱신
    },
    "capabilities": {
        # 해외주식 브래킷/OCO 주문은 제공되지 않습니다.
        "bracket": False,
        # 미국주식 스톱 주문 지원 여부는 계좌·시점에 따라 다릅니다.
        # 실제로 되는 것을 확인했을 때만 true 로 바꾸세요. false 면 손절은
        # 프로그램이 살아 있는 동안에만 동작합니다.
        "protective_stop": False,
        "market_order": False,        # 해외주식은 지정가가 기본입니다
        "fractional": False,
    },
}


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load(path: str | None = None) -> dict:
    """기본 명세에 사용자 파일을 덮어씁니다 (깊은 병합)."""
    path = path or os.environ.get("KIS_SPEC_FILE", "")
    if not path:
        return copy.deepcopy(DEFAULT)
    f = pathlib.Path(path)
    if not f.exists():
        raise FileNotFoundError(f"KIS 명세 파일이 없습니다: {path}")
    return _deep_merge(DEFAULT, json.loads(f.read_text(encoding="utf-8")))


def pick(row: dict, keys: list[str] | str, default=None):
    """응답 필드명이 개정돼도 버티도록, 후보 키를 순서대로 찾습니다."""
    if isinstance(keys, str):
        keys = [keys]
    for k in keys:
        if k in row and row[k] not in ("", None):
            return row[k]
        # KIS 응답은 대소문자가 섞여 옵니다.
        for rk, rv in row.items():
            if rk.lower() == k.lower() and rv not in ("", None):
                return rv
    return default
