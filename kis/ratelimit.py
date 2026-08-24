"""KIS 유량 제한(초당 호출 수)을 지키기 위한 토큰 버킷."""

from __future__ import annotations

import threading
import time


class RateLimiter:
    """스레드 안전한 토큰 버킷.

    초당 ``rate`` 개의 토큰이 채워지며, 버킷이 비면 채워질 때까지 블로킹한다.
    실시간 웹소켓 스레드와 전략 스레드가 같은 세션을 공유해도 안전하다.
    """

    def __init__(self, rate: float, burst: float | None = None) -> None:
        if rate <= 0:
            raise ValueError("rate 는 0보다 커야 합니다")
        self.rate = float(rate)
        self.capacity = float(burst if burst is not None else max(1.0, rate))
        self._tokens = self.capacity
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, tokens: float = 1.0, timeout: float | None = None) -> bool:
        """토큰을 소비한다. 확보하면 True, timeout 초과 시 False."""
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
                self._updated = now
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return True
                wait = (tokens - self._tokens) / self.rate
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                wait = min(wait, remaining)
            time.sleep(max(wait, 0.001))
