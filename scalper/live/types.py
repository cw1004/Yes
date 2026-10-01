"""브로커 공통 타입 — Alpaca 든 한국투자증권이든 같은 모양으로 다룹니다.

실행기(executor)와 루프(runner)는 이 타입만 알면 되고, 어느 증권사인지는
몰라도 됩니다. 증권사별 JSON 을 이 모양으로 번역하는 건 각 어댑터의 몫입니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class BrokerError(RuntimeError):
    """증권사 API 오류 공통 상위 타입. 재시도를 이미 소진한 뒤에 올라옵니다."""

    def __init__(self, message: str, status: int = 0, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _tick(price: float) -> float:
    """미국 주식 호가단위: 1달러 이상은 0.01, 미만은 0.0001."""
    return round(price, 2 if price >= 1.0 else 4)


OPEN_STATUSES = {"new", "accepted", "pending_new", "partially_filled",
                 "accepted_for_bidding", "held"}


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
        return self.status in OPEN_STATUSES

    @property
    def is_filled(self) -> bool:
        return self.status == "filled"

    @classmethod
    def parse(cls, d: dict) -> "Order":
        """Alpaca 주문 JSON 을 공통 형태로. 다른 증권사는 직접 생성자를 씁니다."""
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
        """미국 브로커의 패턴 데이트레이더 규정. 국내 증권사 경유는 해당 없음."""
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


@dataclass
class Capabilities:
    """증권사가 무엇을 할 수 있는지. 실행기가 이걸 보고 경로를 바꿉니다.

    bracket 이 False 면 '거래소에 걸어두는 손절'이 없다는 뜻이고, 그러면
    프로그램이 죽는 순간 포지션이 무방비가 됩니다. 이건 숨기면 안 되는 사실이라
    설정이 아니라 능력으로 드러냅니다.
    """

    bracket: bool = True              # 진입+손절+익절 동시 주문
    protective_stop: bool = True      # 진입 후 별도 손절 주문을 걸 수 있는가
    market_order: bool = True         # 시장가 주문
    fractional: bool = False          # 소수점 매수
    pdt: bool = True                  # 미국 패턴 데이트레이더 규정 대상인가
    name: str = "broker"

    @property
    def exchange_side_stop(self) -> bool:
        """프로그램이 죽어도 거래소에 손절이 남아 있는가."""
        return self.bracket or self.protective_stop
