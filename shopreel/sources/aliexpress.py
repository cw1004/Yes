# -*- coding: utf-8 -*-
"""AliExpress 제휴 오픈 API (hot product query).

필요 환경변수
  ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET / ALIEXPRESS_TRACKING_ID
선택
  ALIEXPRESS_CATEGORY_IDS, ALIEXPRESS_CURRENCY(기본 USD), ALIEXPRESS_LOCALE(기본 EN)
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Dict, List

from ..config import Config
from ..models import Product
from .base import Source, env, http_json, qs, to_float, to_int

GATEWAY = "https://api-sg.aliexpress.com/sync"
METHOD = "aliexpress.affiliate.hotproduct.query"


def sign(secret: str, params: Dict[str, str]) -> str:
    """TOP 게이트웨이 서명 (정렬된 key+value 이어붙여 HMAC-SHA256, 대문자 hex)."""
    payload = "".join(f"{k}{params[k]}" for k in sorted(params))
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"),
                    hashlib.sha256).hexdigest().upper()


class AliExpressSource(Source):
    name = "aliexpress"
    network = "aliexpress"
    needs = ("ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_TRACKING_ID")

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        key, secret = env("ALIEXPRESS_APP_KEY"), env("ALIEXPRESS_APP_SECRET")
        params: Dict[str, str] = {
            "app_key": key,
            "method": METHOD,
            "sign_method": "sha256",
            "timestamp": str(int(time.time() * 1000)),
            "format": "json",
            "v": "2.0",
            "tracking_id": env("ALIEXPRESS_TRACKING_ID"),
            "target_currency": env("ALIEXPRESS_CURRENCY") or "USD",
            "target_language": env("ALIEXPRESS_LOCALE") or "EN",
            "page_no": "1",
            "page_size": str(min(50, max(1, limit))),
            "sort": "LAST_VOLUME_DESC",
        }
        cats = env("ALIEXPRESS_CATEGORY_IDS")
        if cats:
            params["category_ids"] = cats
        params["sign"] = sign(secret, params)

        data = http_json(f"{GATEWAY}?{qs(params)}")
        rows = (data.get("aliexpress_affiliate_hotproduct_query_response", {})
                    .get("resp_result", {}).get("result", {})
                    .get("products", {}).get("product", []))
        out: List[Product] = []
        for r in rows[:limit]:
            out.append(self.product(
                product_id=str(r.get("product_id", "")),
                title=str(r.get("product_title", "")),
                url=str(r.get("promotion_link") or r.get("product_detail_url") or ""),
                image_url=str(r.get("product_main_image_url", "")),
                images=[str(u) for u in (r.get("product_small_image_urls", {})
                                         .get("string", []) or [])][:4],
                price=to_float(r.get("target_sale_price") or r.get("sale_price")),
                orig_price=to_float(r.get("target_original_price") or r.get("original_price")),
                currency=str(r.get("target_sale_price_currency") or "USD"),
                rating=to_float(r.get("evaluate_rate", "").replace("%", "") or 0) / 20.0,
                reviews=to_int(r.get("lastest_volume")),
                sold=to_int(r.get("lastest_volume")),
                commission=to_float(str(r.get("hot_product_commission_rate", "")).replace("%", "")),
                category=str(r.get("second_level_category_name")
                             or r.get("first_level_category_name") or ""),
                shop=str(r.get("shop_name", "")),
                raw=r,
            ))
        return out
