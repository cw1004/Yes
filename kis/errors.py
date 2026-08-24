"""KIS API 예외 계층."""

from __future__ import annotations


class KisError(Exception):
    """모든 KIS 관련 예외의 최상위 타입."""


class ConfigError(KisError):
    """환경설정이 잘못되었거나 누락된 경우."""


class AuthError(KisError):
    """토큰 발급/갱신 실패."""


class ApiError(KisError):
    """API 가 rt_cd != '0' 으로 응답한 경우."""

    def __init__(self, message: str, *, rt_cd: str = "", msg_cd: str = "", path: str = "",
                 status: int | None = None, body: dict | None = None) -> None:
        super().__init__(message)
        self.rt_cd = rt_cd
        self.msg_cd = msg_cd
        self.path = path
        self.status = status
        self.body = body or {}

    def __str__(self) -> str:  # pragma: no cover - 표현용
        parts = [super().__str__()]
        if self.msg_cd:
            parts.append(f"msg_cd={self.msg_cd}")
        if self.rt_cd:
            parts.append(f"rt_cd={self.rt_cd}")
        if self.path:
            parts.append(f"path={self.path}")
        return " | ".join(parts)


class HttpError(KisError):
    """HTTP 레벨 오류(4xx/5xx, 재시도 소진 포함)."""

    def __init__(self, message: str, *, status: int | None = None, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class RateLimitError(HttpError):
    """유량(초당 호출수) 제한 초과."""


class RiskLimitError(KisError):
    """리스크 한도에 걸려 주문이 거부된 경우."""


class TradingHaltedError(KisError):
    """킬 스위치 또는 일일 손실 한도로 매매가 중단된 경우."""
