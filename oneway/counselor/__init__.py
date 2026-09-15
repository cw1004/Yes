# -*- coding: utf-8 -*-
"""AI 상담사.

원칙
----
1. 안전이 먼저다. 위기 신호가 보이면 다른 이야기를 멈추고 전문 기관을 먼저 연결한다.
2. 처음 온 사람에게는 종교 언어를 쓰지 않는다. 깊이는 상대가 연다(depth.py).
3. 설교하지 않는다. 먼저 듣고, 되묻고, 아주 작은 한 걸음만 제안한다.
4. 사람인 척하지 않는다. 다만 먼저 밝히지도 않는다. 물으면 정직하게 답한다.
5. 키가 없어도 동작한다. Claude API 가 없으면 규칙 엔진으로 자동 폴백한다.
"""

from .depth import OPEN, STORY, FAITH, TRADITION      # noqa: F401
from .engine import Counselor, Reply                  # noqa: F401
from .safety import Risk, assess                      # noqa: F401
