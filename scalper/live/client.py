"""Alpaca REST 클라이언트 — 실계좌에 실제로 붙는 계층.

기존 broker.py 는 "주문 한 번 던지기"까지였습니다. 실전에서는 그걸로 부족합니다.

- 네트워크는 끊깁니다 → 재시도 + 지수 백오프
- 레이트리밋(429)에 걸립니다 → Retry-After 를 지켜서 대기
- 주문은 즉시 체결되지 않습니다 → 주문 상태를 조회할 수 있어야 합니다
- 5분봉 종가는 지금 가격이 아닙니다 → 최신 호가/체결가가 필요합니다
- 장이 닫혀 있으면 주문은 의미가 없습니다 → clock 조회

표준 라이브러리만 사용합니다.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

PAPER_BASE = "https://paper-api.alpaca.markets"
LIVE_BASE = "https://api.alpaca.markets"
DATA_BASE = "https://data.alpaca.markets"

RETRY_STATUS = {408, 429, 500, 502, 503, 504}


class AlpacaError(RuntimeError):
    """복구 불가능한 API 오류. 재시도를 이미 소진한 뒤에 올라옵니다."""

    def __init__(self, message: str, status: int = 0, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass
class Order:
    id: str
    symbol: str
    side: str
    qty: float
    filled_qty: float
    filled_avg_price: float
    status: str
    order_type: str = ""
    legs: list[dict] = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    @property
    def is_open(self) -> bool:
        return self.status in {"new", "accepted", "pending_new", "partially_filled",
                               "accepted_for_bidding", "held"}

    @property
    def is_filled(self) -> bool:
        return self.status == "filled"

    @classmethod
    def parse(cls, d: dict) -> "Order":
        return cls(
            id=str(d.get("id", "")),
            symbol=str(d.get("symbol", "")).upper(),
            side=str(d.get("side", "")),
            qty=_f(d.get("qty")),
            filled_qty=_f(d.get("filled_qty")),
            filled_avg_price=_f(d.get("filled_avg_price")),
            status=str(d.get("status", "")),
            order_type=str(d.get("type", "")),
            legs=list(d.get("legs") or []),
            raw=d,
        )


@dataclass
class BrokerPosition:
    symbol: str
    qty: float
    avg_entry_price: float
    market_value: float
    unrealized_pl: float
    current_price: float

    @classmethod
    def parse(cls, d: dict) -> "BrokerPosition":
        return cls(
            symbol=str(d.get("symbol", "")).upper(),
            qty=_f(d.get("qty")),
            avg_entry_price=_f(d.get("avg_entry_price")),
            market_value=_f(d.get("market_value")),
            unrealized_pl=_f(d.get("unrealized_pl")),
            current_price=_f(d.get("current_price")),
        )


@dataclass
class Account:
    equity: float
    cash: float
    buying_power: float
    daytrade_count: int
    pattern_day_trader: bool
    trading_blocked: bool
    account_blocked: bool
    status: str
    currency: str = "USD"

    @property
    def pdt_restricted(self) -> bool:
        """자산 2.5만 달러 미만이면 5영업일 3회까지만 데이트레이딩이 안전합니다."""
        return self.equity < 25_000 and self.daytrade_count >= 3

    @classmethod
    def parse(cls, d: dict) -> "Account":
        return cls(
            equity=_f(d.get("equity")),
            cash=_f(d.get("cash")),
            buying_power=_f(d.get("buying_power")),
            daytrade_count=int(_f(d.get("daytrade_count"))),
            pattern_day_trader=bool(d.get("pattern_day_trader")),
            trading_blocked=bool(d.get("trading_blocked")),
            account_blocked=bool(d.get("account_blocked")),
            status=str(d.get("status", "")),
            currency=str(d.get("currency", "USD")),
        )


@dataclass
class Clock:
    is_open: bool
    timestamp: str
    next_open: str
    next_close: str


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


class AlpacaClient:
    """페이퍼가 기본. 실계좌는 호출부에서 명시적으로 열어야 합니다."""

    def __init__(self, key: str, secret: str, paper: bool = True,
                 max_retries: int = 4, timeout: int = 12):
        if not key or not secret:
            raise AlpacaError("ALPACA_API_KEY / ALPACA_API_SECRET 가 없습니다.")
        self.key = key
        self.secret = secret
        self.paper = paper
        self.base = PAPER_BASE if paper else LIVE_BASE
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_call = 0.0

    # ── 저수준 ──
    def _headers(self) -> dict:
        return {
            "APCA-API-KEY-ID": self.key,
            "APCA-API-SECRET-KEY": self.secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _throttle(self) -> None:
        """Alpaca 는 분당 200콜. 최소 간격을 둬서 스스로 429 를 만들지 않습니다."""
        gap = time.monotonic() - self._last_call
        if gap < 0.05:
            time.sleep(0.05 - gap)
        self._last_call = time.monotonic()

    def request(self, method: str, path: str, body: dict | None = None,
                base: str | None = None) -> object:
        url = (base or self.base) + path
        data = json.dumps(body).encode() if body is not None else None
        last_error = ""
        last_status = 0

        for attempt in range(self.max_retries + 1):
            self._throttle()
            req = urllib.request.Request(url, data=data, method=method,
                                         headers=self._headers())
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    raw = r.read().decode("utf-8", "replace")
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as e:
                last_status = e.code
                last_error = e.read().decode("utf-8", "replace")[:400]
                if e.code not in RETRY_STATUS or attempt == self.max_retries:
                    raise AlpacaError(f"HTTP {e.code}: {last_error}",
                                      status=e.code, body=last_error) from e
                wait = _retry_after(e) or (2 ** attempt)
                time.sleep(min(wait, 30))
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
                last_error = str(e)
                if attempt == self.max_retries:
                    raise AlpacaError(f"연결 실패: {last_error}") from e
                time.sleep(min(2 ** attempt, 30))

        raise AlpacaError(f"재시도 소진: {last_error}", status=last_status)

    # ── 계좌 / 시장 ──
    def account(self) -> Account:
        return Account.parse(self.request("GET", "/v2/account"))  # type: ignore[arg-type]

    def clock(self) -> Clock:
        d = self.request("GET", "/v2/clock")
        assert isinstance(d, dict)
        return Clock(is_open=bool(d.get("is_open")),
                     timestamp=str(d.get("timestamp", "")),
                     next_open=str(d.get("next_open", "")),
                     next_close=str(d.get("next_close", "")))

    # ── 포지션 ──
    def positions(self) -> dict[str, BrokerPosition]:
        rows = self.request("GET", "/v2/positions")
        if not isinstance(rows, list):
            return {}
        out = {}
        for r in rows:
            p = BrokerPosition.parse(r)
            out[p.symbol] = p
        return out

    def close_position(self, symbol: str) -> Order | None:
        """전량 시장가 청산. 이미 없으면 None (404 는 정상 상황으로 취급)."""
        try:
            d = self.request("DELETE", f"/v2/positions/{symbol.upper()}")
        except AlpacaError as e:
            if e.status == 404:
                return None
            raise
        return Order.parse(d) if isinstance(d, dict) and d.get("id") else None

    # ── 주문 ──
    def submit_bracket(self, symbol: str, qty: int, stop: float, target: float,
                       limit: float | None = None) -> Order:
        """진입 + 손절 + 익절을 한 번에. 프로그램이 죽어도 손절은 거래소에 남습니다."""
        body: dict = {
            "symbol": symbol.upper(),
            "qty": str(int(qty)),
            "side": "buy",
            "type": "limit" if limit else "market",
            "time_in_force": "day",
            "order_class": "bracket",
            "take_profit": {"limit_price": _tick(target)},
            "stop_loss": {"stop_price": _tick(stop)},
        }
        if limit:
            body["limit_price"] = _tick(limit)
        d = self.request("POST", "/v2/orders", body)
        assert isinstance(d, dict)
        return Order.parse(d)

    def get_order(self, order_id: str, nested: bool = True) -> Order:
        q = "?nested=true" if nested else ""
        d = self.request("GET", f"/v2/orders/{order_id}{q}")
        assert isinstance(d, dict)
        return Order.parse(d)

    def open_orders(self, symbol: str | None = None) -> list[Order]:
        params = {"status": "open", "nested": "true", "limit": "100"}
        if symbol:
            params["symbols"] = symbol.upper()
        rows = self.request("GET", "/v2/orders?" + urllib.parse.urlencode(params))
        return [Order.parse(r) for r in rows] if isinstance(rows, list) else []

    def cancel_order(self, order_id: str) -> None:
        try:
            self.request("DELETE", f"/v2/orders/{order_id}")
        except AlpacaError as e:
            if e.status not in (404, 422):     # 이미 체결/취소된 주문
                raise

    def cancel_all_orders(self) -> None:
        try:
            self.request("DELETE", "/v2/orders")
        except AlpacaError as e:
            if e.status != 404:
                raise

    # ── 시세 ──
    def latest_price(self, symbol: str) -> float:
        """지금 가격. 체결가 우선, 없으면 호가 중간값.

        5분봉 종가로 손절을 판단하면 최대 5분 늦습니다. 실전에서는 이 값을 씁니다.
        """
        sym = urllib.parse.quote(symbol.upper())
        try:
            d = self.request("GET", f"/v2/stocks/{sym}/trades/latest", base=DATA_BASE)
            if isinstance(d, dict):
                price = _f((d.get("trade") or {}).get("p"))
                if price > 0:
                    return price
        except AlpacaError:
            pass
        try:
            d = self.request("GET", f"/v2/stocks/{sym}/quotes/latest", base=DATA_BASE)
            if isinstance(d, dict):
                q = d.get("quote") or {}
                bid, ask = _f(q.get("bp")), _f(q.get("ap"))
                if bid > 0 and ask > 0:
                    return (bid + ask) / 2
        except AlpacaError:
            pass
        return 0.0

    def bars(self, symbol: str, timeframe: str = "5Min", limit: int = 200,
             feed: str = "iex") -> list[dict]:
        params = urllib.parse.urlencode({
            "symbols": symbol.upper(), "timeframe": timeframe,
            "limit": limit, "feed": feed, "sort": "asc",
        })
        d = self.request("GET", f"/v2/stocks/bars?{params}", base=DATA_BASE)
        if not isinstance(d, dict):
            return []
        return list((d.get("bars") or {}).get(symbol.upper()) or [])


def _tick(price: float) -> float:
    """미국 주식 호가단위: 1달러 이상은 0.01, 미만은 0.0001."""
    return round(price, 2 if price >= 1.0 else 4)


def _retry_after(e: urllib.error.HTTPError) -> float:
    try:
        return float(e.headers.get("Retry-After", "") or 0)
    except (TypeError, ValueError):
        return 0.0
