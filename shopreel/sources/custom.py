# -*- coding: utf-8 -*-
"""사용자 정의 JSON 엔드포인트 소스.

공식 API 가 없는 플랫폼(틱톡샵·쇼피·인스타 샵 등)은 직접 만든 수집기나
n8n/Apify 같은 외부 워크플로가 뱉는 JSON 을 그대로 받아 쓴다.

  SHOPREEL_CUSTOM_URL=https://내서버/trending.json
  SHOPREEL_CUSTOM_HEADERS='{"Authorization":"Bearer ..."}'

기대 형식: 배열 또는 {"items": [...]} / {"data": [...]}
필드는 title, url, price, image ... 처럼 흔한 이름을 넓게 인식한다.
"""

from __future__ import annotations

import json
from typing import Dict, List, Tuple

from ..affiliate import guess_source
from ..config import Config
from ..models import Product
from .base import Source, env, http_json, to_float, to_int

ALIASES: Dict[str, tuple] = {
    "product_id": ("product_id", "id", "itemId", "item_id", "sku", "asin"),
    "title": ("title", "name", "product_name", "itemTitle"),
    "url": ("url", "link", "product_url", "itemUrl", "detail_url"),
    "image_url": ("image_url", "image", "thumbnail", "img", "picture", "imageUrl"),
    "price": ("price", "sale_price", "current_price", "final_price"),
    "orig_price": ("orig_price", "original_price", "list_price", "was_price"),
    "currency": ("currency", "currency_code"),
    "rating": ("rating", "score", "stars", "evaluate_rate"),
    "reviews": ("reviews", "review_count", "ratings_total", "comments"),
    "sold": ("sold", "orders", "sales", "sold_count", "volume"),
    "commission": ("commission", "commission_rate", "commission_pct"),
    "category": ("category", "category_name", "cat"),
    "shop": ("shop", "store", "seller", "brand"),
}


def _pick(row: Dict, field: str):
    for key in ALIASES[field]:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def normalize(row: Dict) -> Product:
    url = str(_pick(row, "url") or "")
    highlights = row.get("highlights") or row.get("features") or []
    if isinstance(highlights, str):
        highlights = [h.strip() for h in highlights.split("|") if h.strip()]
    return Product(
        source=row.get("source") or guess_source(url),
        product_id=str(_pick(row, "product_id") or ""),
        title=str(_pick(row, "title") or "").strip(),
        url=url,
        image_url=str(_pick(row, "image_url") or ""),
        price=to_float(_pick(row, "price")),
        orig_price=to_float(_pick(row, "orig_price")),
        currency=str(_pick(row, "currency") or "USD"),
        rating=to_float(_pick(row, "rating")),
        reviews=to_int(_pick(row, "reviews")),
        sold=to_int(_pick(row, "sold")),
        commission=to_float(_pick(row, "commission")),
        category=str(_pick(row, "category") or ""),
        shop=str(_pick(row, "shop") or ""),
        highlights=[str(h) for h in highlights][:3],
        raw=row,
    )


class CustomSource(Source):
    name = "custom"
    network = "generic"
    needs = ("SHOPREEL_CUSTOM_URL",)

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        url = env("SHOPREEL_CUSTOM_URL")
        headers = {}
        raw_headers = env("SHOPREEL_CUSTOM_HEADERS")
        if raw_headers:
            try:
                headers = json.loads(raw_headers)
            except Exception:
                headers = {}
        data = http_json(url, headers=headers)
        rows = data if isinstance(data, list) else (
            data.get("items") or data.get("data") or data.get("products") or [])
        return [normalize(r) for r in rows[:limit] if isinstance(r, dict)]
