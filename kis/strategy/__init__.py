"""매매 전략 모음."""

from .base import (
    Action,
    ExitPolicy,
    Signal,
    Strategy,
    StrategyContext,
    ema,
    rsi,
    sma,
)
from .rsi_reversal import RsiReversalStrategy
from .sma_cross import SmaCrossStrategy

#: CLI 등에서 이름으로 전략을 고를 때 사용한다.
REGISTRY: dict[str, type[Strategy]] = {
    SmaCrossStrategy.name: SmaCrossStrategy,
    RsiReversalStrategy.name: RsiReversalStrategy,
}


def create_strategy(name: str, symbols: list[str], **kwargs) -> Strategy:
    """이름으로 전략 인스턴스를 만든다."""
    try:
        cls = REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"알 수 없는 전략입니다: {name!r} (사용 가능: {', '.join(REGISTRY)})") from exc
    return cls(symbols, **kwargs)


__all__ = [
    "Action",
    "ExitPolicy",
    "REGISTRY",
    "RsiReversalStrategy",
    "Signal",
    "SmaCrossStrategy",
    "Strategy",
    "StrategyContext",
    "create_strategy",
    "ema",
    "rsi",
    "sma",
]
