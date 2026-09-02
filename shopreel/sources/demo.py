# -*- coding: utf-8 -*-
"""오프라인 데모 소스.

API 키가 하나도 없어도 전체 파이프라인(수집→영상→업로드 매니페스트)을
끝까지 돌려볼 수 있게 하는 샘플 데이터. 실행할 때마다 판매량이 조금씩 늘어나
'실시간 인기 상승'을 흉내 낸다.
"""

from __future__ import annotations

import random
import time
from typing import List, Tuple

from ..config import Config
from ..models import Product
from .base import Source

CATALOG = [
    dict(product_id="D1001", title="접이식 무선 미니 선풍기 5000mAh 목걸이형",
         price=18.9, orig_price=39.0, rating=4.8, reviews=12840, sold=63120,
         commission=12.0, category="생활가전", shop="Sunlit Home",
         highlights=["3단 풍량 · 최대 14시간", "목·책상·유모차 겸용", "USB-C 급속충전"]),
    dict(product_id="D1002", title="초경량 노트북 스탠드 알루미늄 각도조절",
         price=23.5, orig_price=45.0, rating=4.9, reviews=8210, sold=41230,
         commission=9.5, category="사무/PC", shop="DeskLab",
         highlights=["7단계 각도 · 목 통증 완화", "260g 초경량", "17인치까지 지원"]),
    dict(product_id="D1003", title="스마트 온도표시 텀블러 보온보냉 500ml",
         price=15.2, orig_price=32.0, rating=4.7, reviews=15920, sold=88740,
         commission=14.0, category="주방용품", shop="KeepCup",
         highlights=["뚜껑에 현재 온도 표시", "12시간 보온 · 24시간 보냉", "식품용 스테인리스 304"]),
    dict(product_id="D1004", title="차량용 자석 무선충전 거치대 15W 급속",
         price=21.0, orig_price=42.0, rating=4.6, reviews=6350, sold=29410,
         commission=11.0, category="자동차용품", shop="DriveGear",
         highlights=["한 손 탈부착 마그네틱", "15W 급속 무선충전", "송풍구·대시보드 겸용"]),
    dict(product_id="D1005", title="휴대용 미니 라벨프린터 감열식 블루투스",
         price=29.9, orig_price=59.0, rating=4.8, reviews=9930, sold=35870,
         commission=13.5, category="사무/PC", shop="PrintPop",
         highlights=["잉크 없이 감열 인쇄", "앱으로 폰트·아이콘 선택", "정리·수납 필수템"]),
    dict(product_id="D1006", title="실리콘 주방 집게 스크래치 방지 3종 세트",
         price=9.9, orig_price=19.9, rating=4.7, reviews=4120, sold=18730,
         commission=8.0, category="주방용품", shop="KeepCup",
         highlights=["코팅팬 안 긁힘", "230도 내열", "식기세척기 사용 가능"]),
    dict(product_id="D1007", title="캠핑용 LED 랜턴 방수 3000루멘 충전식",
         price=27.4, orig_price=52.0, rating=4.9, reviews=7640, sold=44210,
         commission=10.5, category="캠핑/아웃도어", shop="NightTrail",
         highlights=["3000루멘 · 최대 40시간", "IPX6 생활방수", "보조배터리 겸용"]),
    dict(product_id="D1008", title="반려동물 자동 급수기 정수필터 2.5L 무소음",
         price=25.8, orig_price=48.0, rating=4.8, reviews=10250, sold=52380,
         commission=12.5, category="반려동물", shop="PawFlow",
         highlights=["4중 정수필터", "무소음 펌프", "물 부족 자동 알림"]),
]


class DemoSource(Source):
    name = "demo"
    network = "demo"
    needs = ()

    def available(self) -> Tuple[bool, str]:
        return True, "오프라인 샘플 (키 불필요)"

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        rng = random.Random(int(time.time() // 60))     # 1분마다 값이 바뀐다
        out: List[Product] = []
        for item in CATALOG[:limit]:
            data = dict(item)
            bump = rng.randint(80, 1400)
            data["sold"] = int(data["sold"] + bump)
            data["url"] = f"https://example-shop.test/item/{data['product_id']}"
            data["currency"] = "USD"
            data["images"] = []
            out.append(self.product(**data))
        return out
