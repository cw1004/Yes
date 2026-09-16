# -*- coding: utf-8 -*-
"""요청 제한.

공개 서버에 올리면 가장 먼저 생기는 문제는 악의가 아니라 **비용**이다.
``/api/counsel`` 한 번이 Claude API 한 번이고, 그건 돈이다.
누군가 반복 호출하면 하룻밤에 요금이 크게 뛸 수 있다.

nginx 에서도 막지만, 서버 앞단이 바뀌어도 앱이 스스로를 지킬 수 있어야 한다.
그래서 여기서 한 번 더 막는다.

원칙
----
· 상담을 막는 것이 목적이 아니다. 진짜 사람이 쓰는 속도는 넉넉히 통과시킨다.
· 막을 때도 문은 닫지 않는다. "조금 천천히"라고 말하고 전화번호는 남긴다.
· 위기 상황은 제한하지 않는다 — 급한 사람을 막으면 안 된다(server.py 참고).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

# (최대 횟수, 기간 초). 사람이 쓰는 속도보다 넉넉하게 잡는다.
LIMITS: Dict[str, Tuple[int, int]] = {
    "counsel": (40, 3600),      # 상담 — 한 시간에 40번이면 충분히 긴 대화다
    "book": (12, 3600),         # 맞춤 책 생성 — 만들 때마다 부하가 있다
    "write": (60, 3600),        # 기도 지향·실천 기록 등
    "page": (600, 3600),        # 일반 페이지
}

# 너무 오래된 기록은 버린다. 메모리가 계속 자라면 그것도 장애다.
SWEEP_AFTER = 4 * 3600
SWEEP_EVERY = 600


@dataclass
class Decision:
    allowed: bool
    retry_after: int = 0        # 초


class RateLimiter:
    """창(window) 단위 계수기. 메모리에만 두고, 서버를 껐다 켜면 초기화된다.

    서버가 한 대일 때를 전제로 한다. 여러 대로 늘릴 때는 이 클래스만
    Redis 같은 공용 저장소로 바꾸면 된다(인터페이스는 ``check`` 하나뿐).
    """

    def __init__(self, limits: Optional[Dict[str, Tuple[int, int]]] = None):
        self.limits = dict(limits or LIMITS)
        self._hits: Dict[Tuple[str, str], list] = {}
        self._lock = threading.Lock()
        self._swept = 0.0

    def check(self, bucket: str, key: str, now: Optional[float] = None) -> Decision:
        """한 번 세고 통과 여부를 돌려준다."""
        limit, period = self.limits.get(bucket, self.limits["page"])
        now = now or time.time()
        ident = (bucket, key)

        with self._lock:
            self._sweep(now)
            hits = [t for t in self._hits.get(ident, []) if now - t < period]
            if len(hits) >= limit:
                oldest = min(hits)
                self._hits[ident] = hits
                return Decision(False, max(1, int(period - (now - oldest))))
            hits.append(now)
            self._hits[ident] = hits
            return Decision(True)

    def _sweep(self, now: float) -> None:
        if now - self._swept < SWEEP_EVERY:
            return
        self._swept = now
        for ident in list(self._hits):
            kept = [t for t in self._hits[ident] if now - t < SWEEP_AFTER]
            if kept:
                self._hits[ident] = kept
            else:
                del self._hits[ident]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def too_many_message(retry_after: int) -> Dict:
    """막을 때도 문은 닫지 않는다. 전화번호는 남긴다."""
    minutes = max(1, retry_after // 60)
    return {
        "error": "too_many_requests",
        "reply": {
            "text": (f"조금 쉬었다 이어 가시면 좋겠습니다. "
                     f"{minutes}분쯤 뒤에 다시 말씀해 주세요.\n\n"
                     "그 사이에 정말 힘드시면 사람에게 연락해 주십시오. "
                     "자살예방 상담전화 109. 24시간, 무료입니다."),
            "source": "limit",
            "topic": "",
            "topic_label": "",
            "risk": "none",
            "depth": 0,
            "hotlines": ["자살예방 상담전화 109 — 24시간 · 전화 무료",
                         "정신건강 상담전화 1577-0199 — 24시간"],
            "links": [],
            "verse_ref": "",
            "verse_gist": "",
            "follow_up": "",
            "note": "",
            "path_url": "",
            "book_url": "",
        },
    }
