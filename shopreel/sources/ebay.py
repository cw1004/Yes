# -*- coding: utf-8 -*-
"""eBay Browse API (인기 검색 결과).

필요 환경변수
  EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
선택
  EBAY_EPN_CAMPAIGN(제휴), EBAY_KEYWORDS, EBAY_MARKETPLACE(기본 EBAY_US)
"""

from __future__ import annotations

import base64
import json
from typing import List

from ..config import Config
from ..models import Product
from .base import Source, SourceError, env, http, http_json, qs, to_float, to_int

TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"


def access_token() -> str:
    cid, secret = env("EBAY_CLIENT_ID"), env("EBAY_CLIENT_SECRET")
    basic = base64.b64encode(f"{cid}:{secret}".encode("utf-8")).decode()
    body = qs({"grant_type": "client_credentials",
               "scope": "https://api.ebay.com/oauth/api_scope"}).encode("utf-8")
    raw = http(TOKEN_URL, method="POST", data=body, headers={
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    token = json.loads(raw.decode("utf-8", "replace")).get("access_token")
    if not token:
        raise SourceError("eBay 토큰 발급 실패")
    return token


class EbaySource(Source):
    name = "ebay"
    network = "ebay"
    needs = ("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET")

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        token = access_token()
        params = {
            "q": env("EBAY_KEYWORDS") or "trending gadgets",
            "limit": min(100, max(1, limit)),
            "sort": "-watchCount",
            "filter": "buyingOptions:{FIXED_PRICE}",
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": env("EBAY_MARKETPLACE") or "EBAY_US",
        }
        data = http_json(f"{SEARCH_URL}?{qs(params)}", headers=headers)
        out: List[Product] = []
        for i, r in enumerate((data.get("itemSummaries") or [])[:limit], 1):
            price = r.get("price") or {}
            orig = (r.get("marketingPrice") or {}).get("originalPrice") or {}
            out.append(self.product(
                product_id=str(r.get("itemId", "")),
                title=str(r.get("title", "")),
                url=str(r.get("itemAffiliateWebUrl") or r.get("itemWebUrl") or ""),
                image_url=str((r.get("image") or {}).get("imageUrl", "")),
                price=to_float(price.get("value")),
                orig_price=to_float(orig.get("value")),
                currency=str(price.get("currency") or "USD"),
                rank=i,                              # watchCount 내림차순 정렬 결과
                highlights=([f"{to_int(r.get('watchCount')):,}명이 관심 등록"]
                            if r.get("watchCount") else []),
                category=str(((r.get("categories") or [{}])[0]).get("categoryName", "")),
                shop=str((r.get("seller") or {}).get("username", "")),
                raw=r,
            ))
        return out
