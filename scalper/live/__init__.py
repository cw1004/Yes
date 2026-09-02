"""실전 매매 계층 — 실제 브로커에 주문을 내는 코드.

scalper 본체가 "무엇을 살지"를 정한다면, 여기는 "실제로 살 수 있는지, 얼마나,
그리고 정말 샀는지"를 책임집니다.

- client.py   : Alpaca REST (재시도·레이트리밋·실시간가·주문상태)
- guards.py   : 시장시간 / PDT / 일일손실 / 킬스위치
- state.py    : 재시작해도 유지되는 하루 상태
- executor.py : 브로커를 유일한 진실로 삼는 주문 실행·대조
- runner.py   : 신호 × 안전장치 × 주문을 묶은 실전 루프

    python3 -m scalper live --tickers NVDA TSLA AAPL
"""

from .client import AlpacaClient, AlpacaError
from .executor import LiveExecutor
from .guards import GuardConfig, TradingGuards
from .runner import LiveRunner
from .state import StateStore

__all__ = ["AlpacaClient", "AlpacaError", "LiveExecutor", "GuardConfig",
           "TradingGuards", "LiveRunner", "StateStore"]
