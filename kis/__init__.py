"""한국투자증권 KIS Open API 기반 개인 매매 시스템.

빠른 시작::

    from kis import KisTrader

    trader = KisTrader.from_env()
    print(trader.quotes.price("005930"))
    print(trader.trading.balance())
"""

from __future__ import annotations

from dataclasses import dataclass

from .auth import TokenManager
from .client import KisClient, KisResponse
from .config import RiskLimits, Settings, load_settings
from .errors import (
    ApiError,
    AuthError,
    ConfigError,
    HttpError,
    KisError,
    RateLimitError,
    RiskLimitError,
    TradingHaltedError,
)
from .models import (
    Balance,
    Candle,
    Execution,
    MinuteCandle,
    OrderBook,
    OrderResult,
    OrderType,
    Position,
    Quote,
    Side,
)
from .quotes import QuoteApi
from .realtime import RealtimeClient, RealtimeMessage
from .risk import RiskManager
from .storage import Storage
from .trading import TradingApi

__version__ = "0.1.0"


@dataclass
class KisTrader:
    """설정 · 인증 · 시세 · 주문 · 리스크를 한 번에 묶은 진입점."""

    settings: Settings
    client: KisClient
    quotes: QuoteApi
    trading: TradingApi
    storage: Storage
    risk: RiskManager

    @classmethod
    def from_env(cls, env_file: str | None = ".env") -> KisTrader:
        return cls.from_settings(load_settings(env_file))

    @classmethod
    def from_settings(cls, settings: Settings) -> KisTrader:
        client = KisClient(settings)
        storage = Storage(settings.db_path, env=settings.env)
        return cls(
            settings=settings,
            client=client,
            quotes=QuoteApi(client),
            trading=TradingApi(client),
            storage=storage,
            risk=RiskManager(settings, storage),
        )

    def realtime(self) -> RealtimeClient:
        """실시간 시세 클라이언트를 만든다(구독/시작은 호출자가 한다)."""
        return RealtimeClient(self.settings, self.client.tokens)

    def close(self) -> None:
        self.storage.close()


__all__ = [
    "ApiError",
    "AuthError",
    "Balance",
    "Candle",
    "ConfigError",
    "Execution",
    "HttpError",
    "KisClient",
    "KisError",
    "KisResponse",
    "KisTrader",
    "MinuteCandle",
    "OrderBook",
    "OrderResult",
    "OrderType",
    "Position",
    "Quote",
    "QuoteApi",
    "RateLimitError",
    "RealtimeClient",
    "RealtimeMessage",
    "RiskLimits",
    "RiskLimitError",
    "RiskManager",
    "Settings",
    "Side",
    "Storage",
    "TokenManager",
    "TradingApi",
    "TradingHaltedError",
    "__version__",
    "load_settings",
]
