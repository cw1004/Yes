# -*- coding: utf-8 -*-
"""Amazon Product Advertising API 5.0 (SearchItems).

필요 환경변수
  AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_ASSOC_TAG
선택
  AMAZON_HOST(기본 webservices.amazon.com), AMAZON_REGION(기본 us-east-1),
  AMAZON_MARKETPLACE(기본 www.amazon.com), AMAZON_KEYWORDS, AMAZON_BROWSE_NODE
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import json
from typing import Dict, List

from ..config import Config
from ..models import Product
from .base import Source, env, http, to_float, to_int

SERVICE = "ProductAdvertisingAPI"
PATH = "/paapi5/searchitems"
TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"
RESOURCES = [
    "Images.Primary.Large", "ItemInfo.Title", "ItemInfo.Features",
    "ItemInfo.ByLineInfo", "Offers.Listings.Price",
    "Offers.Listings.SavingBasis", "CustomerReviews.StarRating",
    "CustomerReviews.Count", "BrowseNodeInfo.BrowseNodes",
]


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def sigv4_headers(host: str, region: str, access: str, secret: str, body: str) -> Dict[str, str]:
    """AWS SigV4 서명 헤더."""
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    stamp = now.strftime("%Y%m%d")

    headers = {
        "content-encoding": "amz-1.0",
        "content-type": "application/json; charset=utf-8",
        "host": host,
        "x-amz-date": amz_date,
        "x-amz-target": TARGET,
    }
    signed = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    payload_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    canonical = "\n".join(["POST", PATH, "", canonical_headers, signed, payload_hash])

    scope = f"{stamp}/{region}/{SERVICE}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                         hashlib.sha256(canonical.encode("utf-8")).hexdigest()])
    k = _sign(f"AWS4{secret}".encode("utf-8"), stamp)
    k = _sign(k, region)
    k = _sign(k, SERVICE)
    k = _sign(k, "aws4_request")
    signature = hmac.new(k, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
        f"SignedHeaders={signed}, Signature={signature}")
    return headers


class AmazonSource(Source):
    name = "amazon"
    network = "amazon"
    needs = ("AMAZON_ACCESS_KEY", "AMAZON_SECRET_KEY", "AMAZON_ASSOC_TAG")

    def fetch(self, cfg: Config, limit: int) -> List[Product]:
        host = env("AMAZON_HOST") or "webservices.amazon.com"
        region = env("AMAZON_REGION") or "us-east-1"
        payload = {
            "Keywords": env("AMAZON_KEYWORDS") or "best sellers",
            "PartnerTag": env("AMAZON_ASSOC_TAG"),
            "PartnerType": "Associates",
            "Marketplace": env("AMAZON_MARKETPLACE") or "www.amazon.com",
            "ItemCount": min(10, max(1, limit)),      # PA-API 는 호출당 최대 10개
            "SortBy": "Relevance",
            "Resources": RESOURCES,
        }
        node = env("AMAZON_BROWSE_NODE")
        if node:
            payload["BrowseNodeId"] = node
        body = json.dumps(payload)
        headers = sigv4_headers(host, region, env("AMAZON_ACCESS_KEY"),
                                env("AMAZON_SECRET_KEY"), body)
        raw = http(f"https://{host}{PATH}", method="POST", headers=headers,
                   data=body.encode("utf-8"))
        data = json.loads(raw.decode("utf-8", "replace"))

        out: List[Product] = []
        for item in (data.get("SearchResult", {}).get("Items", []) or [])[:limit]:
            info = item.get("ItemInfo", {}) or {}
            listing = ((item.get("Offers", {}) or {}).get("Listings") or [{}])[0]
            price = (listing.get("Price") or {})
            saving = (listing.get("SavingBasis") or {})
            reviews = item.get("CustomerReviews", {}) or {}
            nodes = (item.get("BrowseNodeInfo", {}) or {}).get("BrowseNodes") or [{}]
            features = ((info.get("Features") or {}).get("DisplayValues") or [])
            out.append(self.product(
                product_id=str(item.get("ASIN", "")),
                title=str(((info.get("Title") or {}).get("DisplayValue")) or ""),
                url=str(item.get("DetailPageURL", "")),
                image_url=str(((item.get("Images", {}) or {}).get("Primary", {})
                               .get("Large", {}) or {}).get("URL", "")),
                price=to_float(price.get("Amount")),
                orig_price=to_float(saving.get("Amount")),
                currency=str(price.get("Currency") or "USD"),
                rating=to_float((reviews.get("StarRating") or {}).get("Value")),
                reviews=to_int((reviews.get("Count") or {}).get("Value")),
                category=str(nodes[0].get("DisplayName", "")),
                shop=str(((info.get("ByLineInfo") or {}).get("Brand") or {})
                         .get("DisplayValue", "")),
                highlights=[str(f) for f in features[:3]],
                raw=item,
            ))
        return out
