"""도메인 모델.

KIS 응답은 모든 값이 문자열이고 필드명이 축약형이라 다루기 어렵다.
여기서 파싱/형변환을 한 번에 처리해 이후 코드가 깔끔해지도록 한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return default


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


class Side(str, Enum):
    """주문 방향."""

    BUY = "buy"
    SELL = "sell"

    @property
    def korean(self) -> str:
        return "매수" if self is Side.BUY else "매도"


class OrderType(str, Enum):
    """주문 구분(ORD_DVSN)."""

    LIMIT = "00"          # 지정가
    MARKET = "01"         # 시장가
    CONDITIONAL = "02"    # 조건부지정가
    BEST_LIMIT = "03"     # 최유리지정가
    PRIORITY_LIMIT = "04" # 최우선지정가
    AFTER_HOURS = "05"    # 장전 시간외
    AFTER_CLOSE = "06"    # 장후 시간외


@dataclass
class Quote:
    """현재가 시세."""

    symbol: str
    price: int                  # 현재가
    open: int
    high: int
    low: int
    prev_close: int             # 전일 종가
    change: int                 # 전일 대비
    change_rate: float          # 등락률(%)
    volume: int                 # 누적 거래량
    trade_value: int            # 누적 거래대금
    upper_limit: int            # 상한가
    lower_limit: int            # 하한가
    market_cap: int             # 시가총액(억원)
    name: str = ""
    halted: bool = False        # 거래정지 여부
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_api(cls, symbol: str, out: dict[str, Any]) -> Quote:
        return cls(
            symbol=symbol,
            price=to_int(out.get("stck_prpr")),
            open=to_int(out.get("stck_oprc")),
            high=to_int(out.get("stck_hgpr")),
            low=to_int(out.get("stck_lwpr")),
            prev_close=to_int(out.get("stck_sdpr")),
            change=to_int(out.get("prdy_vrss")),
            change_rate=to_float(out.get("prdy_ctrt")),
            volume=to_int(out.get("acml_vol")),
            trade_value=to_int(out.get("acml_tr_pbmn")),
            upper_limit=to_int(out.get("stck_mxpr")),
            lower_limit=to_int(out.get("stck_llam")),
            market_cap=to_int(out.get("hts_avls")),
            name=str(out.get("rprs_mrkt_kor_name") or out.get("bstp_kor_isnm") or "").strip(),
            halted=str(out.get("temp_stop_yn", "N")).upper() == "Y",
            raw=out,
        )


@dataclass
class Candle:
    """일/주/월봉 한 개."""

    symbol: str
    date: date
    open: int
    high: int
    low: int
    close: int
    volume: int

    @classmethod
    def from_api(cls, symbol: str, out: dict[str, Any]) -> Candle | None:
        raw_date = str(out.get("stck_bsop_date") or "").strip()
        if len(raw_date) != 8:
            return None
        return cls(
            symbol=symbol,
            date=datetime.strptime(raw_date, "%Y%m%d").date(),
            open=to_int(out.get("stck_oprc")),
            high=to_int(out.get("stck_hgpr")),
            low=to_int(out.get("stck_lwpr")),
            close=to_int(out.get("stck_clpr")),
            volume=to_int(out.get("acml_vol")),
        )


@dataclass
class OrderBookLevel:
    price: int
    quantity: int


@dataclass
class OrderBook:
    """호가 10단계."""

    symbol: str
    asks: list[OrderBookLevel]   # 매도호가 1~10 (1이 최우선)
    bids: list[OrderBookLevel]   # 매수호가 1~10
    total_ask_qty: int
    total_bid_qty: int

    @property
    def best_ask(self) -> int:
        return self.asks[0].price if self.asks else 0

    @property
    def best_bid(self) -> int:
        return self.bids[0].price if self.bids else 0

    @property
    def spread(self) -> int:
        return self.best_ask - self.best_bid if self.best_ask and self.best_bid else 0

    @classmethod
    def from_api(cls, symbol: str, out: dict[str, Any]) -> OrderBook:
        asks = [
            OrderBookLevel(to_int(out.get(f"askp{i}")), to_int(out.get(f"askp_rsqn{i}")))
            for i in range(1, 11)
        ]
        bids = [
            OrderBookLevel(to_int(out.get(f"bidp{i}")), to_int(out.get(f"bidp_rsqn{i}")))
            for i in range(1, 11)
        ]
        return cls(
            symbol=symbol,
            asks=asks,
            bids=bids,
            total_ask_qty=to_int(out.get("total_askp_rsqn")),
            total_bid_qty=to_int(out.get("total_bidp_rsqn")),
        )


@dataclass
class Position:
    """보유 종목."""

    symbol: str
    name: str
    quantity: int              # 보유수량
    sellable: int              # 주문가능수량
    avg_price: float           # 매입평균가
    current_price: int
    eval_amount: int           # 평가금액
    purchase_amount: int       # 매입금액
    pnl: int                   # 평가손익
    pnl_rate: float            # 수익률(%)

    @classmethod
    def from_api(cls, out: dict[str, Any]) -> Position:
        return cls(
            symbol=str(out.get("pdno", "")).strip(),
            name=str(out.get("prdt_name", "")).strip(),
            quantity=to_int(out.get("hldg_qty")),
            sellable=to_int(out.get("ord_psbl_qty")),
            avg_price=to_float(out.get("pchs_avg_pric")),
            current_price=to_int(out.get("prpr")),
            eval_amount=to_int(out.get("evlu_amt")),
            purchase_amount=to_int(out.get("pchs_amt")),
            pnl=to_int(out.get("evlu_pfls_amt")),
            pnl_rate=to_float(out.get("evlu_pfls_rt")),
        )


@dataclass
class Balance:
    """계좌 잔고 요약 + 보유 종목."""

    positions: list[Position]
    cash: int                  # 예수금 총금액
    available_cash: int        # 주문가능현금(D+2 예수금)
    total_eval: int            # 총평가금액
    total_purchase: int        # 매입금액 합계
    total_pnl: int             # 평가손익 합계
    net_asset: int             # 순자산금액

    def position(self, symbol: str) -> Position | None:
        return next((p for p in self.positions if p.symbol == symbol), None)

    @classmethod
    def from_api(cls, output1: list[dict], output2: list[dict]) -> Balance:
        summary = output2[0] if output2 else {}
        positions = [Position.from_api(row) for row in output1 if to_int(row.get("hldg_qty")) > 0]
        return cls(
            positions=positions,
            cash=to_int(summary.get("dnca_tot_amt")),
            available_cash=to_int(summary.get("prvs_rcdl_excc_amt") or summary.get("nxdy_excc_amt")),
            total_eval=to_int(summary.get("tot_evlu_amt")),
            total_purchase=to_int(summary.get("pchs_amt_smtl_amt")),
            total_pnl=to_int(summary.get("evlu_pfls_smtl_amt")),
            net_asset=to_int(summary.get("nass_amt")),
        )


@dataclass
class OrderResult:
    """주문 접수 결과."""

    success: bool
    order_no: str = ""         # 주문번호(ODNO)
    org_no: str = ""           # 한국거래소전송주문조직번호(KRX_FWDG_ORD_ORGNO)
    order_time: str = ""       # 주문시각(ORD_TMD)
    message: str = ""
    msg_cd: str = ""
    dry_run: bool = False

    def __str__(self) -> str:
        tag = "[모의체결]" if self.dry_run else ""
        state = "성공" if self.success else "실패"
        return f"{tag}주문 {state} no={self.order_no or '-'} {self.message}".strip()


@dataclass
class Execution:
    """체결/미체결 내역 한 건."""

    order_no: str
    org_no: str
    symbol: str
    name: str
    side: Side
    order_qty: int
    filled_qty: int
    remaining_qty: int
    order_price: int
    avg_fill_price: float
    order_time: str
    status: str

    @property
    def is_filled(self) -> bool:
        return self.remaining_qty == 0 and self.filled_qty > 0

    @classmethod
    def from_api(cls, out: dict[str, Any]) -> Execution:
        sell_buy = str(out.get("sll_buy_dvsn_cd", "")).strip()
        order_qty = to_int(out.get("ord_qty"))
        filled = to_int(out.get("tot_ccld_qty"))
        remaining = to_int(out.get("rmn_qty"), default=max(order_qty - filled, 0))
        return cls(
            order_no=str(out.get("odno", "")).strip(),
            org_no=str(out.get("krx_fwdg_ord_orgno", "")).strip(),
            symbol=str(out.get("pdno", "")).strip(),
            name=str(out.get("prdt_name", "")).strip(),
            # 01: 매도, 02: 매수
            side=Side.SELL if sell_buy == "01" else Side.BUY,
            order_qty=order_qty,
            filled_qty=filled,
            remaining_qty=remaining,
            order_price=to_int(out.get("ord_unpr")),
            avg_fill_price=to_float(out.get("avg_prvs")),
            order_time=str(out.get("ord_tmd", "")).strip(),
            status=str(out.get("ccld_dvsn_name") or out.get("ord_dvsn_name") or "").strip(),
        )


@dataclass
class MinuteCandle:
    """분봉 한 개."""

    symbol: str
    timestamp: datetime
    open: int
    high: int
    low: int
    close: int
    volume: int

    @classmethod
    def from_api(cls, symbol: str, out: dict[str, Any]) -> MinuteCandle | None:
        raw_date = str(out.get("stck_bsop_date") or "").strip()
        raw_time = str(out.get("stck_cntg_hour") or "").strip().zfill(6)
        if len(raw_date) != 8 or len(raw_time) != 6:
            return None
        return cls(
            symbol=symbol,
            timestamp=datetime.strptime(raw_date + raw_time, "%Y%m%d%H%M%S"),
            open=to_int(out.get("stck_oprc")),
            high=to_int(out.get("stck_hgpr")),
            low=to_int(out.get("stck_lwpr")),
            close=to_int(out.get("stck_prpr")),
            volume=to_int(out.get("cntg_vol")),
        )
