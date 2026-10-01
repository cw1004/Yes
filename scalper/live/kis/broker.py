"""한국투자증권 어댑터 — 실행기가 보는 인터페이스는 Alpaca 와 똑같습니다.

바꿔 끼우기만 하면 신호·안전장치·상태·실행기는 전부 그대로 재사용됩니다.
다만 능력(Capabilities)이 다르고, 그 차이가 리스크에 직결됩니다.

  브래킷 주문 없음 → 진입과 동시에 손절을 거래소에 걸 수 없습니다.
  손절은 이 프로그램이 살아 있는 동안에만 동작합니다.

이 사실은 capabilities 로 드러나고, 실행기가 진입할 때마다 로그에 적습니다.
"""

from __future__ import annotations

import datetime as dt
import time
from zoneinfo import ZoneInfo

from ..types import Account, BrokerPosition, Capabilities, Clock, Order, _f, _tick  # noqa: F401
from . import spec as spec_mod
from .client import KISClient, KISError

NY = ZoneInfo("America/New_York")
RTH_OPEN = dt.time(9, 30)
RTH_CLOSE = dt.time(16, 0)


class KISBroker:
    """KISClient 를 감싸 공통 브로커 인터페이스로 노출합니다."""

    def __init__(self, client: KISClient, exchange: str | None = None):
        self.client = client
        self.spec = client.spec
        caps = self.spec["capabilities"]
        self.caps = Capabilities(
            bracket=bool(caps["bracket"]),
            protective_stop=bool(caps["protective_stop"]),
            market_order=bool(caps["market_order"]),
            fractional=bool(caps["fractional"]),
            pdt=False,      # 국내 증권사 경유 — 미국 PDT 규정 대상이 아닙니다
            name="kis-paper" if client.paper else "kis",
        )
        self.market = (exchange or self.spec["exchange"]["default"]).upper()
        self._orders: dict[str, Order] = {}
        # 주문 직전 보유 수량. 체결 판정의 기준선입니다.
        self._baseline: dict[str, float] = {}

    # ── 공통 속성 ──
    @property
    def paper(self) -> bool:
        return self.client.paper

    @property
    def _ord_exc(self) -> str:
        return self.spec["exchange"]["order"].get(self.market, "NASD")

    @property
    def _qte_exc(self) -> str:
        return self.spec["exchange"]["quote"].get(self.market, "NAS")

    def _pick(self, row: dict, key: str, default=None):
        return spec_mod.pick(row, self.spec["fields"][key], default)

    # ── 계좌 / 시장 ───────────────────────────────────────────────────
    def _balance(self) -> dict:
        return self.client.call(
            "GET", self.spec["paths"]["balance"], self.client.tr["balance"],
            params={**self.client.account_body(),
                    "OVRS_EXCG_CD": self._ord_exc,
                    "TR_CRCY_CD": "USD", "CTX_AREA_FK200": "", "CTX_AREA_NK200": ""})

    def account(self) -> Account:
        d = self._balance()
        summary = d.get(self.spec["fields"]["balance_summary"]) or {}
        if isinstance(summary, list):
            summary = summary[0] if summary else {}

        cash = _f(self._pick(summary, "summary_cash", 0))
        power = _f(self._pick(summary, "summary_buying_power", 0)) or cash
        equity = _f(self._pick(summary, "summary_equity", 0))

        if equity <= 0:
            # 요약 필드를 못 읽으면 보유 평가액 + 현금으로 역산합니다.
            holdings = sum(p.market_value for p in self._positions_from(d).values())
            equity = holdings + cash

        return Account(
            equity=equity, cash=cash, buying_power=power,
            daytrade_count=0,            # 국내 증권사 경유는 미국 PDT 규정 대상이 아닙니다
            pattern_day_trader=False,
            trading_blocked=False, account_blocked=False,
            status="ACTIVE", currency="USD")

    def clock(self) -> Clock:
        """KIS 는 미국장 시계를 주지 않아 뉴욕 시간으로 계산합니다.

        미국 공휴일은 반영되지 않습니다. 공휴일에는 주문이 거부되는 것으로
        드러나며, 그때도 preflight 가 먼저 막습니다.
        """
        now = dt.datetime.now(NY)
        is_weekday = now.weekday() < 5
        is_open = is_weekday and RTH_OPEN <= now.time() < RTH_CLOSE

        today_close = now.replace(hour=16, minute=0, second=0, microsecond=0)
        today_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
        nxt_open = today_open if (is_weekday and now.time() < RTH_OPEN) else None
        if nxt_open is None:
            probe = now + dt.timedelta(days=1)
            while probe.weekday() >= 5:
                probe += dt.timedelta(days=1)
            nxt_open = probe.replace(hour=9, minute=30, second=0, microsecond=0)

        return Clock(is_open=is_open,
                     timestamp=now.astimezone(dt.timezone.utc).isoformat(),
                     next_open=nxt_open.astimezone(dt.timezone.utc).isoformat(),
                     next_close=today_close.astimezone(dt.timezone.utc).isoformat())

    # ── 포지션 ────────────────────────────────────────────────────────
    def _positions_from(self, d: dict) -> dict[str, BrokerPosition]:
        rows = d.get(self.spec["fields"]["balance_rows"]) or []
        out: dict[str, BrokerPosition] = {}
        for row in rows if isinstance(rows, list) else []:
            sym = str(self._pick(row, "position_symbol", "")).upper().strip()
            qty = _f(self._pick(row, "position_qty", 0))
            if not sym or qty <= 0:
                continue
            price = _f(self._pick(row, "position_price", 0))
            out[sym] = BrokerPosition(
                symbol=sym, qty=qty,
                avg_entry_price=_f(self._pick(row, "position_avg", 0)),
                market_value=_f(self._pick(row, "position_eval", 0)) or qty * price,
                unrealized_pl=_f(self._pick(row, "position_pl", 0)),
                current_price=price)
        return out

    def positions(self) -> dict[str, BrokerPosition]:
        return self._positions_from(self._balance())

    # ── 시세 ──────────────────────────────────────────────────────────
    def latest_price(self, symbol: str) -> float:
        d = self.client.call("GET", self.spec["paths"]["price"],
                             self.spec["tr_id"]["price"],
                             params={"AUTH": "", "EXCD": self._qte_exc,
                                     "SYMB": symbol.upper()})
        out = d.get("output") or {}
        return _f(self._pick(out, "price_value", 0))

    def bars(self, symbol: str, timeframe: str = "5Min", limit: int = 200,
             feed: str = "") -> list[dict]:
        minutes = "".join(ch for ch in timeframe if ch.isdigit()) or "5"
        d = self.client.call("GET", self.spec["paths"]["minute_bars"],
                             self.spec["tr_id"]["minute_bars"],
                             params={"AUTH": "", "EXCD": self._qte_exc,
                                     "SYMB": symbol.upper(), "NMIN": minutes,
                                     "PINC": "1", "NEXT": "", "NREC": str(min(limit, 120)),
                                     "FILL": "", "KEYB": ""})
        rows = d.get(self.spec["fields"]["bar_rows"]) or []
        out: list[dict] = []
        for row in rows if isinstance(rows, list) else []:
            ts = self._bar_time(row)
            close = _f(self._pick(row, "bar_close", 0))
            if ts is None or close <= 0:
                continue
            out.append({"t": ts, "o": _f(self._pick(row, "bar_open", close)),
                        "h": _f(self._pick(row, "bar_high", close)),
                        "l": _f(self._pick(row, "bar_low", close)),
                        "c": close, "v": _f(self._pick(row, "bar_volume", 0))})
        out.sort(key=lambda b: b["t"])        # KIS 는 최신순으로 주기도 합니다
        return out[-limit:]

    def _bar_time(self, row: dict) -> str | None:
        ymd = str(self._pick(row, "bar_date", "")).strip()
        hms = str(self._pick(row, "bar_time", "")).strip().zfill(6)
        if len(ymd) != 8 or not ymd.isdigit():
            return None
        try:
            naive = dt.datetime.strptime(ymd + hms[:6], "%Y%m%d%H%M%S")
        except ValueError:
            return None
        return naive.replace(tzinfo=NY).astimezone(dt.timezone.utc).isoformat()

    # ── 주문 ──────────────────────────────────────────────────────────
    def _order_body(self, symbol: str, qty: int, price: float) -> dict:
        o = self.spec["order"]
        return {**self.client.account_body(),
                "OVRS_EXCG_CD": self._ord_exc,
                "PDNO": symbol.upper(),
                "ORD_QTY": str(int(qty)),
                "OVRS_ORD_UNPR": f"{_tick(price):.2f}",
                "ORD_SVR_DVSN_CD": o["server_division"],
                "ORD_DVSN": o["division_limit"]}

    def _submit(self, symbol: str, qty: int, price: float, side: str) -> Order:
        tr = self.client.tr["buy" if side == "buy" else "sell"]
        body = self._order_body(symbol, qty, price)
        d = self.client.call("POST", self.spec["paths"]["order"], tr,
                             body=body, use_hashkey=True)
        out = d.get("output") or {}
        oid = str(spec_mod.pick(out, self.spec["fields"]["order_id"], "")).strip()
        if not oid:
            raise KISError("주문번호를 받지 못했습니다.",
                           body=str(d)[:400],
                           hint="spec 의 fields.order_id 를 실제 응답에 맞추세요 "
                                "(python3 -m scalper kis-probe 로 확인).")
        order = Order(id=oid, symbol=symbol.upper(), side=side, qty=float(qty),
                      filled_qty=0.0, filled_avg_price=0.0, status="new",
                      order_type="limit", raw=d)
        self._orders[oid] = order
        return order

    def submit_entry(self, symbol: str, qty: int, limit: float | None = None) -> Order:
        """해외주식은 지정가가 기본입니다. 체결을 놓치지 않도록 현재가보다
        약간 위에 겁니다 (spec.order.slippage_pct)."""
        price = limit or self.latest_price(symbol)
        if price <= 0:
            raise KISError(f"{symbol} 현재가를 받지 못해 주문가를 정할 수 없습니다.")
        if limit is None:
            price *= 1 + self.spec["order"]["slippage_pct"] / 100.0
        # 기준선은 반드시 주문을 내기 **전에** 찍어야 합니다. 주문 뒤에 재면
        # 그 사이에 체결된 수량이 기준선에 포함돼 영영 체결을 감지하지 못합니다.
        self._baseline[symbol.upper()] = self._held(symbol)
        return self._submit(symbol, qty, price, "buy")

    def _held(self, symbol: str) -> float:
        try:
            pos = self.positions().get(symbol.upper())
        except KISError:
            return 0.0
        return pos.qty if pos else 0.0

    def submit_protective(self, symbol: str, qty: float, stop: float) -> Order | None:
        if not self.caps.protective_stop:
            return None
        return self._submit(symbol, int(qty), stop, "sell")

    def submit_bracket(self, *a, **kw):
        raise KISError("한국투자증권 해외주식은 브래킷(OCO) 주문을 지원하지 않습니다.",
                       hint="실행기가 capabilities 를 보고 자동으로 다른 경로를 씁니다. "
                            "이 오류가 보이면 capabilities.bracket 설정이 잘못된 것입니다.")

    def open_orders(self, symbol: str | None = None) -> list[Order]:
        d = self.client.call("GET", self.spec["paths"]["open_orders"],
                             self.client.tr["open_orders"],
                             params={**self.client.account_body(),
                                     "OVRS_EXCG_CD": self._ord_exc,
                                     "SORT_SQN": "DS",
                                     "CTX_AREA_FK200": "", "CTX_AREA_NK200": ""})
        rows = d.get(self.spec["fields"]["order_rows"]) or []
        out: list[Order] = []
        for row in rows if isinstance(rows, list) else []:
            sym = str(spec_mod.pick(row, self.spec["fields"]["position_symbol"],
                                    "")).upper().strip()
            if symbol and sym != symbol.upper():
                continue
            oid = str(spec_mod.pick(row, self.spec["fields"]["order_id"], "")).strip()
            if not oid:
                continue
            out.append(Order(id=oid, symbol=sym, side="", qty=0.0, filled_qty=0.0,
                             filled_avg_price=0.0, status="new", raw=row))
        return out

    def cancel_order(self, order_id: str) -> None:
        order = self._orders.get(order_id)
        body = {**self.client.account_body(),
                "OVRS_EXCG_CD": self._ord_exc,
                "PDNO": order.symbol if order else "",
                "ORGN_ODNO": order_id,
                "RVSE_CNCL_DVSN_CD": "02",            # 02 = 취소
                "ORD_QTY": str(int(order.qty)) if order else "0",
                "OVRS_ORD_UNPR": "0",
                "ORD_SVR_DVSN_CD": self.spec["order"]["server_division"]}
        try:
            self.client.call("POST", self.spec["paths"]["order_cancel"],
                             self.client.tr["cancel"], body=body, use_hashkey=True)
        except KISError as e:
            # 이미 체결/취소된 주문은 취소할 수 없습니다. 정상 상황입니다.
            if "없" not in str(e) and "체결" not in str(e):
                raise

    def get_order(self, order_id: str, nested: bool = True) -> Order:
        """미체결 목록에 없으면 더 이상 살아 있지 않은 주문으로 봅니다."""
        order = self._orders.get(order_id) or Order(
            id=order_id, symbol="", side="", qty=0.0, filled_qty=0.0,
            filled_avg_price=0.0, status="new")
        still_open = any(o.id == order_id for o in self.open_orders())
        order.status = "new" if still_open else "filled"
        return order

    def await_fill(self, order: Order, timeout: float = 20.0) -> Order:
        """체결 확인은 잔고로 합니다.

        KIS 체결내역 조회는 응답 형식이 계좌별로 달라 깨지기 쉽습니다. 잔고에
        수량이 잡히는지 보는 쪽이 훨씬 단단하고, 덤으로 **실제 평균 매입가**를
        바로 얻습니다.
        """
        deadline = time.monotonic() + timeout
        before = self._baseline.get(order.symbol.upper(), 0.0)

        while True:
            try:
                pos = self.positions().get(order.symbol)
            except KISError:
                pos = None
            if pos and pos.qty > before:
                order.filled_qty = pos.qty - before
                order.filled_avg_price = pos.avg_entry_price
                order.status = "filled"
                self._baseline.pop(order.symbol.upper(), None)
                return order
            if time.monotonic() >= deadline:
                break
            time.sleep(1.0)
        order.status = "new"          # 아직 미체결 → 실행기가 취소합니다
        return order

    def close_position(self, symbol: str) -> Order | None:
        """KIS 에는 '포지션 청산' 이 없어서 보유 수량만큼 매도 주문을 냅니다."""
        pos = self.positions().get(symbol.upper())
        if pos is None or pos.qty <= 0:
            return None
        price = self.latest_price(symbol) or pos.current_price
        if price <= 0:
            raise KISError(f"{symbol} 현재가를 받지 못해 청산가를 정할 수 없습니다.")
        price *= 1 - self.spec["order"]["slippage_pct"] / 100.0   # 체결 우선
        return self._submit(symbol, int(pos.qty), price, "sell")

    def cancel_all_orders(self) -> None:
        for o in self.open_orders():
            self.cancel_order(o.id)
