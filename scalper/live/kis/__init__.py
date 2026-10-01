"""한국투자증권(KIS) Open API 어댑터.

    export KIS_APP_KEY="..." KIS_APP_SECRET="..." KIS_ACCOUNT="12345678"
    python3 -m scalper kis-probe        # 실제 응답으로 명세 확인
    python3 -m scalper preflight --broker kis
    python3 -m scalper live --broker kis

중요: 해외주식은 브래킷(OCO) 주문이 없습니다. 손절이 거래소에 걸리지 않으므로
프로그램이 꺼지면 포지션이 무방비가 됩니다. 자세한 내용은 scalper/README.md 참고.
"""

from .broker import KISBroker
from .client import KISClient, KISCredentials, KISError
from . import spec

__all__ = ["KISBroker", "KISClient", "KISCredentials", "KISError", "spec"]
