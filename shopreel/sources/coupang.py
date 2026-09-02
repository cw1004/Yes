# -*- coding: utf-8 -*-
"""쿠팡 파트너스 오픈 API.

필요 환경변수
  COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY
선택
  COUPANG_ENDPOINT   : bestcategories(기본) | goldbox | search
  COUPANG_CATEGORY_ID: 베스트 카테고리 ID (기본 1001)
  COUPANG_KEYWORD    : search 엔드포인트용 검색어
  COUPANG_SUBID      : 성과 구분용 기본 subId
  COUPANG_API_HOST   : 테스트용 호스트 교체

쿠팡 응답에는 평점·판매량이 없다. 없는 값을 지어내지 않고 **인기 순위(rank)** 만
신호로 쓴다. 상품 URL 은 딥링크 API 로 파트너스 추적 링크로 변환한다.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Dict, List, Optional

from ..config import Config
from ..models import Product
from .base import Source, SourceError, env, http, http_json, to_float, to_int

HOST = "https://api-gateway.coupang.com"
BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1"
PATHS = {
    "bestcategories": BASE + "/products/bestcategories/{cat}",
    "goldbox": BASE + "/products/goldbox",
    "search": BASE + "/products/search",
}
DEEPLINK_PATH = BASE + "/deeplink"


def host() -> str:
    return os.environ.get("COUPANG_API_HOST") or HOST


def authorization(method: str, path: str, query: str, access: str, secret: str,
                  now: Optional[time.struct_time] = None) -> str:
    """쿠팡 CEA HMAC 서명.

    서명 대상 = signed-date + HTTP 메서드 + 경로(쿼리 제외) + 쿼리스트링('?' 없이)
    """
    signed_date = time.strftime("%y%m%dT%H%M%SZ", now or time.gmtime())
    message = f"{signed_date}{method}{path}{query}"
    signature = hmac.new(secret.encode("utf-8"), message.encode("utf-8"),
                         hashlib.sha256).hexdigest()
    return (f"CEA algorithm=HmacSHA256, access-key={access}, "
            f"signed-date={signed_date}, signature={signature}")


def _headers(method: str, path: str, query: str) -> Dict[str, str]:
    return {
        "Authorization": authorization(method, path, query,
                                       env("COUPANG_ACCESS_KEY"), env("COUPANG_SECRET_KEY")),
        "Content-Type": "application/json;charset=UTF-8",
    }


def deeplink(urls: List[str], sub_id: str = "") -> Dict[str, str]:
    """상품 URL 을 파트너스 추적 링크로 변환한다. 실패하면 빈 dict (원본 URL 사용)."""
    if not urls:
        return {}
    body: Dict[str, object] = {"coupangUrls": urls[:50]}
    if sub_id:
        body["subId"] = sub_id
    try:
        raw = http(f"{host()}{DEEPLINK_PATH}", method="POST",
                   data=json.dumps(body).encode("utf-8"),
                   headers=_headers("POST", DEEPLINK_PATH, ""))
        rows = json.loads(raw.decode("utf-8")).get("data") or []
        return {str(r.get("originalUrl", "")): str(r.get("shortenUrl")
                                                   or r.get("landingUrl") or "")
                for r in rows if r.get("originalUrl")}
    except Exception:
        return {}


class CoupangSource(Source):
    name = "coupang"
    network = "coupang"
    needs = ("COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY")

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        endpoint = (env("COUPANG_ENDPOINT") or "bestcategories").lower()
        if endpoint not in PATHS:
            raise SourceError(f"COUPANG_ENDPOINT 값이 잘못됨: {endpoint} "
                              f"(가능: {', '.join(PATHS)})")

        path = PATHS[endpoint].format(cat=env("COUPANG_CATEGORY_ID") or "1001")
        query = f"limit={min(100, max(1, limit))}"
        if endpoint == "search":
            keyword = env("COUPANG_KEYWORD") or "인기상품"
            from urllib.parse import quote
            query = f"keyword={quote(keyword)}&{query}"

        data = http_json(f"{host()}{path}?{query}", headers=_headers("GET", path, query))
        payload = data.get("data")
        rows = payload.get("productData") if isinstance(payload, dict) else (payload or [])
        rows = list(rows or [])[:limit]

        # 파트너스 추적 링크로 변환 (실패해도 원본 URL 로 진행)
        originals = [str(r.get("productUrl", "")) for r in rows if r.get("productUrl")]
        converted = deeplink(originals, env("COUPANG_SUBID"))

        out: List[Product] = []
        for i, r in enumerate(rows, 1):
            url = str(r.get("productUrl", ""))
            price = to_float(r.get("productPrice"))
            base = to_float(r.get("basePrice")) or to_float(r.get("originalPrice"))
            highlights: List[str] = []
            if r.get("isRocket"):
                highlights.append("로켓배송")
            if r.get("isFreeShipping"):
                highlights.append("무료배송")
            # 할인율은 PRICE 단계에서 따로 크게 보여 주므로 하이라이트에 넣지 않는다

            out.append(self.product(
                product_id=str(r.get("productId", "")),
                title=str(r.get("productName", "")),
                url=converted.get(url, url),
                image_url=str(r.get("productImage", "")),
                price=price,
                orig_price=base if base > price else 0.0,
                discount_pct=to_float(r.get("discountRate")),
                currency="KRW",
                rank=to_int(r.get("rank"), i),      # 쿠팡은 평점·판매량을 주지 않는다
                category=str(r.get("categoryName", "")),
                highlights=highlights[:3],
                raw=r,
            ))
        return out
