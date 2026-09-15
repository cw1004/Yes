# -*- coding: utf-8 -*-
"""AI 상담사.

원칙
----
1. 안전이 먼저다. 위기 신호가 보이면 신앙 이야기를 하지 않고 전문 기관을 먼저 연결한다.
2. 설교하지 않는다. 먼저 듣고, 되묻고, 아주 작은 한 걸음만 제안한다.
3. 교파로 끌어당기지 않는다. 방문자가 먼저 물을 때만 전통 이야기를 꺼낸다.
4. 키가 없어도 동작한다. Claude API 가 없으면 규칙 기반 엔진으로 자동 폴백한다.
"""

from .engine import Counselor, Reply          # noqa: F401
from .safety import Risk, assess              # noqa: F401
