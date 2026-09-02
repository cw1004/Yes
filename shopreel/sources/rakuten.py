# -*- coding: utf-8 -*-
"""라쿠텐 이치바 랭킹 API (일본 실시간 인기 상품).

필요 환경변수
  RAKUTEN_APP_ID
선택
  RAKUTEN_AFF_ID(제휴 링크), RAKUTEN_GENRE_ID
"""

from __future__ import annotations

from typing import List

from ..config import Config
from ..models import Product
from .base import Source, env, http_json, qs, to_float, to_int

API = "https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20220601"


class RakutenSource(Source):
    name = "rakuten"
    network = "rakuten"
    needs = ("RAKUTEN_APP_ID",)

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        params = {
            "applicationId": env("RAKUTEN_APP_ID"),
            "affiliateId": env("RAKUTEN_AFF_ID"),
            "format": "json",
            "genreId": env("RAKUTEN_GENRE_ID") or "0",
        }
        data = http_json(f"{API}?{qs(params)}")
        out: List[Product] = []
        for wrap in (data.get("Items") or [])[:limit]:
            r = wrap.get("Item", wrap)
            images = [i.get("imageUrl", "") for i in (r.get("mediumImageUrls") or [])]
            rank = to_int(r.get("rank"), 100)
            out.append(self.product(
                product_id=str(r.get("itemCode", "")),
                title=str(r.get("itemName", "")),
                url=str(r.get("affiliateUrl") or r.get("itemUrl") or ""),
                image_url=(images[0].split("?")[0] if images else ""),
                images=[i.split("?")[0] for i in images[:4]],
                price=to_float(r.get("itemPrice")),
                currency="JPY",
                rating=to_float(r.get("reviewAverage")),
                reviews=to_int(r.get("reviewCount")),
                rank=rank,                           # 랭킹 API 가 주는 실제 순위
                category=str(r.get("genreId", "")),
                shop=str(r.get("shopName", "")),
                raw=r,
            ))
        return out
