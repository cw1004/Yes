"""국내주식 주문 / 잔고 / 체결조회 API."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from .client import KisClient
from .errors import ApiError
from .models import Balance, Execution, OrderResult, OrderType, Side, to_int

log = logging.getLogger(__name__)

PATH_ORDER = "/uapi/domestic-stock/v1/trading/order-cash"
PATH_REVISE = "/uapi/domestic-stock/v1/trading/order-rvsecncl"
PATH_BALANCE = "/uapi/domestic-stock/v1/trading/inquire-balance"
PATH_BUYABLE = "/uapi/domestic-stock/v1/trading/inquire-psbl-order"
PATH_OPEN_ORDERS = "/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl"
PATH_DAILY_CCLD = "/uapi/domestic-stock/v1/trading/inquire-daily-ccld"

# 실전 거래ID (모의는 KisClient.tr 이 앞글자를 V 로 바꿔준다)
TR_BUY = "TTTC0802U"
TR_SELL = "TTTC0801U"
TR_REVISE_CANCEL = "TTTC0803U"
TR_BALANCE = "TTTC8434R"
TR_BUYABLE = "TTTC8908R"
TR_OPEN_ORDERS = "TTTC8036R"
TR_DAILY_CCLD = "TTTC8001R"


class TradingApi:
    """주문 및 계좌 조회.

    ``settings.dry_run`` 이 True 이면 주문 API 를 호출하지 않고 로그만 남긴다.
    실전 환경에서는 ``settings.ensure_orderable()`` 로 한 번 더 확인한다.
    """

    def __init__(self, client: KisClient) -> None:
        self.client = client
        self.settings = client.settings

    # ------------------------------------------------------------ 공통 파라미터
    @property
    def _account(self) -> dict[str, str]:
        return {
            "CANO": self.settings.account_no,
            "ACNT_PRDT_CD": self.settings.account_product_code,
        }

    # ----------------------------------------------------------------- 주문
    def order(
        self,
        symbol: str,
        side: Side,
        quantity: int,
        *,
        price: int = 0,
        order_type: OrderType = OrderType.LIMIT,
    ) -> OrderResult:
        """현금 매수/매도 주문.

        Args:
            price: 지정가일 때 주문단가. 시장가면 0 을 보낸다.
        """
        if quantity <= 0:
            raise ValueError("주문 수량은 1 이상이어야 합니다")
        if order_type is OrderType.LIMIT and price <= 0:
            raise ValueError("지정가 주문에는 price 가 필요합니다")

        unit_price = 0 if order_type is OrderType.MARKET else price
        body = {
            **self._account,
            "PDNO": symbol,
            "ORD_DVSN": order_type.value,
            "ORD_QTY": str(int(quantity)),
            "ORD_UNPR": str(int(unit_price)),
        }

        if self.settings.dry_run:
            log.info(
                "[DRY-RUN] %s %s %d주 @ %s (%s) — 실제 주문을 보내지 않습니다",
                symbol, side.korean, quantity, unit_price or "시장가", order_type.name,
            )
            return OrderResult(
                success=True,
                order_no=f"DRY{date.today():%m%d}{symbol}",
                message="dry-run 모의 접수",
                dry_run=True,
            )

        self.settings.ensure_orderable()
        tr_id = self.client.tr(TR_BUY if side is Side.BUY else TR_SELL)

        try:
            res = self.client.post(PATH_ORDER, tr_id=tr_id, body=body, use_hashkey=True)
        except ApiError as exc:
            log.error("주문 실패: %s %s %d주 — %s", symbol, side.korean, quantity, exc)
            return OrderResult(success=False, message=str(exc), msg_cd=exc.msg_cd)

        out = res.get_output("output") or {}
        result = OrderResult(
            success=True,
            order_no=str(out.get("ODNO", "")).strip(),
            org_no=str(out.get("KRX_FWDG_ORD_ORGNO", "")).strip(),
            order_time=str(out.get("ORD_TMD", "")).strip(),
            message=res.msg1,
            msg_cd=res.msg_cd,
        )
        log.info(
            "주문 접수: %s %s %d주 @%s → %s",
            symbol, side.korean, quantity, unit_price or "시장가", result.order_no,
        )
        return result

    def buy(
        self, symbol: str, quantity: int, *, price: int = 0, order_type: OrderType = OrderType.LIMIT
    ) -> OrderResult:
        return self.order(symbol, Side.BUY, quantity, price=price, order_type=order_type)

    def sell(
        self, symbol: str, quantity: int, *, price: int = 0, order_type: OrderType = OrderType.LIMIT
    ) -> OrderResult:
        return self.order(symbol, Side.SELL, quantity, price=price, order_type=order_type)

    def buy_market(self, symbol: str, quantity: int) -> OrderResult:
        return self.order(symbol, Side.BUY, quantity, order_type=OrderType.MARKET)

    def sell_market(self, symbol: str, quantity: int) -> OrderResult:
        return self.order(symbol, Side.SELL, quantity, order_type=OrderType.MARKET)

    # ------------------------------------------------------------ 정정 / 취소
    def _revise_cancel(
        self,
        *,
        org_no: str,
        order_no: str,
        division: str,
        quantity: int,
        price: int,
        order_type: OrderType,
        all_remaining: bool,
    ) -> OrderResult:
        body = {
            **self._account,
            "KRX_FWDG_ORD_ORGNO": org_no,
            "ORGN_ODNO": order_no,
            "ORD_DVSN": order_type.value,
            "RVSE_CNCL_DVSN_CD": division,  # 01: 정정, 02: 취소
            "ORD_QTY": str(int(quantity)),
            "ORD_UNPR": str(int(price)),
            "QTY_ALL_ORD_YN": "Y" if all_remaining else "N",
        }
        action = "정정" if division == "01" else "취소"

        if self.settings.dry_run:
            log.info("[DRY-RUN] 주문 %s: %s %d주", action, order_no, quantity)
            return OrderResult(success=True, order_no=order_no, message=f"dry-run {action}", dry_run=True)

        self.settings.ensure_orderable()
        try:
            res = self.client.post(PATH_REVISE, tr_id=self.client.tr(TR_REVISE_CANCEL), body=body, use_hashkey=True)
        except ApiError as exc:
            log.error("주문 %s 실패: %s — %s", action, order_no, exc)
            return OrderResult(success=False, message=str(exc), msg_cd=exc.msg_cd)

        out = res.get_output("output") or {}
        log.info("주문 %s 접수: 원주문 %s → 신주문 %s", action, order_no, out.get("ODNO"))
        return OrderResult(
            success=True,
            order_no=str(out.get("ODNO", "")).strip(),
            org_no=str(out.get("KRX_FWDG_ORD_ORGNO", "")).strip(),
            order_time=str(out.get("ORD_TMD", "")).strip(),
            message=res.msg1,
            msg_cd=res.msg_cd,
        )

    def cancel(self, *, org_no: str, order_no: str, quantity: int = 0, all_remaining: bool = True) -> OrderResult:
        """미체결 주문 취소. ``all_remaining=True`` 면 잔량 전부 취소한다."""
        return self._revise_cancel(
            org_no=org_no,
            order_no=order_no,
            division="02",
            quantity=quantity,
            price=0,
            order_type=OrderType.LIMIT,
            all_remaining=all_remaining,
        )

    def modify(self, *, org_no: str, order_no: str, quantity: int, price: int,
               order_type: OrderType = OrderType.LIMIT) -> OrderResult:
        """미체결 주문의 수량/단가 정정."""
        return self._revise_cancel(
            org_no=org_no,
            order_no=order_no,
            division="01",
            quantity=quantity,
            price=price,
            order_type=order_type,
            all_remaining=False,
        )

    def cancel_all(self) -> list[OrderResult]:
        """정정/취소 가능한 모든 미체결 주문을 취소한다(비상 정리용)."""
        results = []
        for order in self.open_orders():
            results.append(self.cancel(org_no=order.org_no, order_no=order.order_no))
        return results

    # ----------------------------------------------------------------- 조회
    def balance(self) -> Balance:
        """주식 잔고 조회(연속조회로 전체 종목 수집)."""
        params = {
            **self._account,
            "AFHR_FLPR_YN": "N",       # 시간외단일가 반영 여부
            "OFL_YN": "",
            "INQR_DVSN": "02",         # 01: 대출일별, 02: 종목별
            "UNPR_DVSN": "01",
            "FUND_STTL_ICLD_YN": "N",
            "FNCG_AMT_AUTO_RDPT_YN": "N",
            "PRCS_DVSN": "00",         # 00: 전일매매포함
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
        }
        holdings: list[dict] = []
        summary: list[dict] = []
        for res in self.client.paginate(PATH_BALANCE, tr_id=self.client.tr(TR_BALANCE), params=params):
            holdings.extend(res.get_output("output1") or [])
            summary = res.get_output("output2") or summary
        return Balance.from_api(holdings, summary)

    def buyable(self, symbol: str, *, price: int = 0, order_type: OrderType = OrderType.MARKET) -> tuple[int, int]:
        """매수가능 조회. ``(주문가능금액, 최대주문가능수량)`` 을 반환한다."""
        res = self.client.get(
            PATH_BUYABLE,
            tr_id=self.client.tr(TR_BUYABLE),
            params={
                **self._account,
                "PDNO": symbol,
                "ORD_UNPR": str(int(price)),
                "ORD_DVSN": order_type.value,
                "CMA_EVLU_AMT_ICLD_YN": "N",
                "OVRS_ICLD_YN": "N",
            },
        )
        out = res.get_output("output") or {}
        return to_int(out.get("ord_psbl_cash")), to_int(out.get("nrcvb_buy_qty") or out.get("max_buy_qty"))

    def open_orders(self) -> list[Execution]:
        """정정/취소 가능한 미체결 주문 목록."""
        params = {
            **self._account,
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
            "INQR_DVSN_1": "0",  # 0: 조회순서, 1: 주문순, 2: 종목순
            "INQR_DVSN_2": "0",  # 0: 전체, 1: 매도, 2: 매수
        }
        orders: list[Execution] = []
        try:
            for res in self.client.paginate(PATH_OPEN_ORDERS, tr_id=self.client.tr(TR_OPEN_ORDERS), params=params):
                orders.extend(Execution.from_api(row) for row in (res.get_output("output") or []))
        except ApiError as exc:
            # 모의투자에서는 미지원인 계정이 있다. 이 경우 일별 체결조회로 대체한다.
            log.warning("미체결 조회 실패(%s) → 일별 체결조회로 대체", exc)
            orders = [e for e in self.executions() if e.remaining_qty > 0]
        return orders

    def executions(self, *, start: date | None = None, end: date | None = None) -> list[Execution]:
        """일별 주문체결 조회(최근 3개월 이내)."""
        end_date = end or date.today()
        start_date = start or (end_date - timedelta(days=7))
        params = {
            **self._account,
            "INQR_STRT_DT": start_date.strftime("%Y%m%d"),
            "INQR_END_DT": end_date.strftime("%Y%m%d"),
            "SLL_BUY_DVSN_CD": "00",   # 00: 전체
            "INQR_DVSN": "00",         # 00: 역순
            "PDNO": "",
            "CCLD_DVSN": "00",         # 00: 전체, 01: 체결, 02: 미체결
            "ORD_GNO_BRNO": "",
            "ODNO": "",
            "INQR_DVSN_3": "00",
            "INQR_DVSN_1": "",
            "CTX_AREA_FK100": "",
            "CTX_AREA_NK100": "",
        }
        rows: list[Execution] = []
        for res in self.client.paginate(PATH_DAILY_CCLD, tr_id=self.client.tr(TR_DAILY_CCLD), params=params):
            rows.extend(Execution.from_api(row) for row in (res.get_output("output1") or []))
        return rows
