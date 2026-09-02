"""Alpaca 주문 실행 — 기본은 페이퍼(모의) 계좌입니다.

실계좌 전환은 두 겹으로 잠가 뒀습니다:
1) paper=False 를 코드/설정에서 명시
2) 환경변수 SCALPER_ALLOW_LIVE=1

둘 다 없으면 실계좌 엔드포인트로는 아예 요청이 나가지 않습니다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

PAPER_BASE = "https://paper-api.alpaca.markets"
LIVE_BASE = "https://api.alpaca.markets"


class BrokerError(RuntimeError):
    pass


@dataclass
class OrderResult:
    ok: bool
    order_id: str = ""
    status: str = ""
    detail: str = ""
    raw: dict | None = None


class AlpacaBroker:
    def __init__(self, key: str = "", secret: str = "", paper: bool = True):
        self.key = key or os.environ.get("ALPACA_API_KEY", "")
        self.secret = secret or os.environ.get("ALPACA_API_SECRET", "")
        self.paper = paper
        if not paper and os.environ.get("SCALPER_ALLOW_LIVE") != "1":
            raise BrokerError(
                "실계좌 주문은 SCALPER_ALLOW_LIVE=1 환경변수까지 있어야 열립니다."
            )
        self.base = PAPER_BASE if paper else LIVE_BASE

    @property
    def configured(self) -> bool:
        return bool(self.key and self.secret)

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        if not self.configured:
            raise BrokerError("ALPACA_API_KEY / ALPACA_API_SECRET 이 설정되지 않았습니다.")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={
                "APCA-API-KEY-ID": self.key,
                "APCA-API-SECRET-KEY": self.secret,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                raw = r.read().decode("utf-8", "replace")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise BrokerError(f"HTTP {e.code}: {detail[:300]}") from e
        except Exception as e:
            raise BrokerError(str(e)) from e

    def account(self) -> dict:
        return self._request("GET", "/v2/account")

    def positions(self) -> list[dict]:
        out = self._request("GET", "/v2/positions")
        return out if isinstance(out, list) else []

    def clock(self) -> dict:
        return self._request("GET", "/v2/clock")

    def buy_bracket(self, ticker: str, qty: float, stop: float,
                    target: float, limit: float | None = None) -> OrderResult:
        """진입과 동시에 손절·익절을 걸어 둡니다 — 연결이 끊겨도 리스크가 남지 않게."""
        qty_i = max(1, int(qty))
        body = {
            "symbol": ticker.upper(),
            "qty": str(qty_i),
            "side": "buy",
            "type": "limit" if limit else "market",
            "time_in_force": "day",
            "order_class": "bracket",
            "take_profit": {"limit_price": round(target, 2)},
            "stop_loss": {"stop_price": round(stop, 2)},
        }
        if limit:
            body["limit_price"] = round(limit, 2)
        try:
            res = self._request("POST", "/v2/orders", body)
        except BrokerError as e:
            return OrderResult(ok=False, detail=str(e))
        return OrderResult(ok=True, order_id=str(res.get("id", "")),
                           status=str(res.get("status", "")), raw=res)

    def close(self, ticker: str) -> OrderResult:
        try:
            res = self._request("DELETE", f"/v2/positions/{ticker.upper()}")
        except BrokerError as e:
            return OrderResult(ok=False, detail=str(e))
        return OrderResult(ok=True, order_id=str(res.get("id", "")),
                           status=str(res.get("status", "")), raw=res)

    def cancel_all(self) -> OrderResult:
        try:
            self._request("DELETE", "/v2/orders")
        except BrokerError as e:
            return OrderResult(ok=False, detail=str(e))
        return OrderResult(ok=True, status="canceled")


class PaperBroker:
    """키가 없을 때 쓰는 내장 모의 체결기. 로직 검증용."""

    def __init__(self, equity: float = 10_000.0):
        self.equity = equity
        self.cash = equity
        self.fills: list[dict] = []

    @property
    def configured(self) -> bool:
        return True

    def buy_bracket(self, ticker: str, qty: float, stop: float,
                    target: float, limit: float | None = None) -> OrderResult:
        self.fills.append({"side": "buy", "ticker": ticker, "qty": qty,
                           "stop": stop, "target": target})
        return OrderResult(ok=True, order_id=f"sim-{len(self.fills)}", status="filled")

    def close(self, ticker: str) -> OrderResult:
        self.fills.append({"side": "sell", "ticker": ticker})
        return OrderResult(ok=True, order_id=f"sim-{len(self.fills)}", status="filled")
