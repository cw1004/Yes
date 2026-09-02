# -*- coding: utf-8 -*-
"""쿠팡 파트너스 오픈 API (베스트 카테고리 상품).

필요 환경변수
  COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY
선택
  COUPANG_CATEGORY_ID(기본 1001 여성패션), COUPANG_PARTNERS_ID
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import List

from ..config import Config
from ..models import Product
from .base import Source, env, http_json, to_float, to_int

HOST = "https://api-gateway.coupang.com"
PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/bestcategories/{cat}"


def authorization(method: str, path: str, query: str, access: str, secret: str) -> str:
    """쿠팡 CEA HMAC 서명."""
    signed_date = time.strftime("%y%m%dT%H%M%SZ", time.gmtime())
    message = f"{signed_date}{method}{path}{query}"
    signature = hmac.new(secret.encode("utf-8"), message.encode("utf-8"),
                         hashlib.sha256).hexdigest()
    return (f"CEA algorithm=HmacSHA256, access-key={access}, "
            f"signed-date={signed_date}, signature={signature}")


class CoupangSource(Source):
    name = "coupang"
    network = "coupang"
    needs = ("COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY")

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        cat = env("COUPANG_CATEGORY_ID") or "1001"
        path = PATH.format(cat=cat)
        query = f"limit={min(100, max(1, limit))}"
        auth = authorization("GET", path, query,
                             env("COUPANG_ACCESS_KEY"), env("COUPANG_SECRET_KEY"))
        data = http_json(f"{HOST}{path}?{query}",
                         headers={"Authorization": auth, "Content-Type": "application/json"})
        rows = data.get("data") or []
        out: List[Product] = []
        for r in rows[:limit]:
            out.append(self.product(
                product_id=str(r.get("productId", "")),
                title=str(r.get("productName", "")),
                url=str(r.get("productUrl", "")),
                image_url=str(r.get("productImage", "")),
                price=to_float(r.get("productPrice")),
                currency="KRW",
                rating=to_float(r.get("rating")) or 4.5,
                reviews=to_int(r.get("reviewCount")),
                sold=to_int(r.get("rank") and (10000 - to_int(r.get("rank")) * 10)),
                category=str(r.get("categoryName", "")),
                raw=r,
            ))
        return out
