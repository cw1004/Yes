"""국내주식 시세 조회 API."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from .client import KisClient
from .models import Candle, MinuteCandle, OrderBook, Quote

log = logging.getLogger(__name__)

PATH_PRICE = "/uapi/domestic-stock/v1/quotations/inquire-price"
PATH_ORDERBOOK = "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn"
PATH_DAILY = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
PATH_MINUTE = "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice"
PATH_CCNL = "/uapi/domestic-stock/v1/quotations/inquire-ccnl"

MARKET_STOCK = "J"  # J: 주식/ETF/ETN, W: ELW, U: 업종


class QuoteApi:
    """현재가 / 호가 / 차트 조회.

    시세 API 는 모의투자 도메인에서 지원하지 않는 항목이 있으므로,
    모의 환경이라도 시세만 실전 도메인에서 받아오고 싶다면 별도 클라이언트를 쓰면 된다.
    """

    def __init__(self, client: KisClient) -> None:
        self.client = client

    # ------------------------------------------------------------- 현재가
    def price(self, symbol: str) -> Quote:
        """주식 현재가 시세."""
        res = self.client.get(
            PATH_PRICE,
            tr_id="FHKST01010100",  # 시세 조회는 실전/모의 tr_id 가 동일하다.
            params={"FID_COND_MRKT_DIV_CODE": MARKET_STOCK, "FID_INPUT_ISCD": symbol},
        )
        return Quote.from_api(symbol, res.get_output("output") or {})

    def prices(self, symbols: list[str]) -> dict[str, Quote]:
        """여러 종목의 현재가를 순차 조회한다(유량 제한은 클라이언트가 처리)."""
        return {symbol: self.price(symbol) for symbol in symbols}

    # --------------------------------------------------------------- 호가
    def orderbook(self, symbol: str) -> OrderBook:
        """호가 10단계 및 예상체결."""
        res = self.client.get(
            PATH_ORDERBOOK,
            tr_id="FHKST01010200",
            params={"FID_COND_MRKT_DIV_CODE": MARKET_STOCK, "FID_INPUT_ISCD": symbol},
        )
        return OrderBook.from_api(symbol, res.get_output("output1") or {})

    # --------------------------------------------------------------- 차트
    def daily_candles(
        self,
        symbol: str,
        *,
        days: int = 100,
        period: str = "D",
        adjusted: bool = True,
        end: date | None = None,
    ) -> list[Candle]:
        """기간별 시세(일/주/월/년봉). 과거 → 최근 순으로 정렬해 반환한다.

        Args:
            days: 조회할 달력 일수(영업일이 아니다). 한 번에 최대 100건까지 응답한다.
            period: D(일) / W(주) / M(월) / Y(년)
            adjusted: 수정주가 반영 여부
        """
        end_date = end or date.today()
        start_date = end_date - timedelta(days=max(days, 1))
        res = self.client.get(
            PATH_DAILY,
            tr_id="FHKST03010100",
            params={
                "FID_COND_MRKT_DIV_CODE": MARKET_STOCK,
                "FID_INPUT_ISCD": symbol,
                "FID_INPUT_DATE_1": start_date.strftime("%Y%m%d"),
                "FID_INPUT_DATE_2": end_date.strftime("%Y%m%d"),
                "FID_PERIOD_DIV_CODE": period,
                "FID_ORG_ADJ_PRC": "0" if adjusted else "1",
            },
        )
        rows = res.get_output("output2") or []
        candles = [c for c in (Candle.from_api(symbol, row) for row in rows) if c is not None]
        candles.sort(key=lambda c: c.date)
        return candles

    def minute_candles(
        self, symbol: str, *, at: datetime | None = None, include_past: bool = True
    ) -> list[MinuteCandle]:
        """당일 분봉(호출 1회당 최대 30건). 과거 → 최근 순."""
        hour = (at or datetime.now()).strftime("%H%M%S")
        res = self.client.get(
            PATH_MINUTE,
            tr_id="FHKST03010200",
            params={
                "FID_ETC_CLS_CODE": "",
                "FID_COND_MRKT_DIV_CODE": MARKET_STOCK,
                "FID_INPUT_ISCD": symbol,
                "FID_INPUT_HOUR_1": hour,
                "FID_PW_DATA_INCU_YN": "Y" if include_past else "N",
            },
        )
        rows = res.get_output("output2") or []
        candles = [c for c in (MinuteCandle.from_api(symbol, row) for row in rows) if c is not None]
        candles.sort(key=lambda c: c.timestamp)
        return candles

    def closes(self, symbol: str, *, days: int = 100) -> list[int]:
        """이동평균 계산 등에 쓰는 종가 배열(과거 → 최근)."""
        return [c.close for c in self.daily_candles(symbol, days=days)]
