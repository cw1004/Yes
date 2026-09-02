# -*- coding: utf-8 -*-
"""제휴 링크 생성 + 추적 코드.

흐름:  상품 URL → (네트워크별 제휴 파라미터) → 제휴 링크 → 자체 추적 링크
       https://내도메인/r/<code>  →  302  →  제휴 링크

플랫폼별로 코드를 따로 발급하므로 "어느 SNS에서 몇 번 눌렀고 얼마 벌었는지"를
클릭 단위로 알 수 있다. 네트워크가 subid(sub_id/customid)를 지원하면 같은 코드를
subid 로 붙여 전환까지 연결한다.
"""

from __future__ import annotations

import hashlib
import re
from typing import Dict, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse

from .config import Config
from .models import Product

# 네트워크별 subid 파라미터 이름 (전환 리포트에서 code 를 되찾기 위한 열쇠)
SUBID_PARAM: Dict[str, str] = {
    "amazon": "ascsubtag",
    "aliexpress": "aff_sub",
    "coupang": "subId",
    "ebay": "customid",
    "rakuten": "u1",
    "shopee": "af_sub1",
    "tiktokshop": "sub_id",
    "generic": "subid",
}


def tracking_code(product_key: str, platform: str, salt: str = "") -> str:
    """상품 × 플랫폼당 하나의 짧은 코드."""
    raw = f"{product_key}|{platform}|{salt}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:10]


def add_params(url: str, params: Dict[str, str]) -> str:
    """기존 쿼리스트링을 지우지 않고 파라미터를 덧붙인다."""
    if not url:
        return url
    parts = urlparse(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({k: v for k, v in params.items() if v})
    return urlunparse(parts._replace(query=urlencode(query)))


def affiliate_url(product: Product, cfg: Config, code: str = "") -> str:
    """네트워크 템플릿을 적용한 제휴 링크. 태그가 없으면 원본 URL 그대로."""
    conf = cfg.affiliate_for(product.source)
    tag = (conf.get("tag") or "").strip()
    template = conf.get("template") or "{url}"

    if not tag:
        # 제휴 계정이 아직 없어도 파이프라인이 멈추지 않게 원본 링크를 쓴다.
        url = product.url
    else:
        url = template.format(
            url=product.url,
            url_enc=quote(product.url, safe=""),
            pid=product.product_id or "",
            tag=tag,
        )
        # 템플릿이 {tag} 를 쓰지 않는 형태(예: {url})면 파라미터로 보정
        if "{tag}" not in template and tag:
            url = add_params(url, {conf.get("tag_param", "tag"): tag})

    if code:
        url = add_params(url, {SUBID_PARAM.get(product.source, "subid"): code})
    return url


def tracking_url(cfg: Config, code: str) -> str:
    base = (cfg.tracker_base or "").rstrip("/")
    return f"{base}/r/{code}" if base else ""


def utm(cfg: Config, platform: str, code: str) -> Dict[str, str]:
    return {
        "utm_source": cfg.utm_source,
        "utm_medium": platform,
        "utm_campaign": "shopreel",
        "utm_content": code,
    }


def build_link(product: Product, cfg: Config, platform: str, store=None) -> Dict[str, str]:
    """플랫폼별 최종 링크 한 쌍을 만든다.

    반환: {"code", "target"(제휴 링크), "link"(사용자에게 보여줄 추적 링크)}
    """
    code = tracking_code(product.key, platform, salt=str(cfg.seed))
    target = affiliate_url(product, cfg, code)
    target = add_params(target, utm(cfg, platform, code))
    link = tracking_url(cfg, code) or target
    if store is not None:
        store.add_link(code, product.key, platform, target)
    return {"code": code, "target": target, "link": link}


_DOMAIN = re.compile(r"^(?:https?://)?(?:www\.)?([^/]+)")


def domain_of(url: str) -> str:
    m = _DOMAIN.match(url or "")
    return m.group(1).lower() if m else ""


def guess_source(url: str) -> str:
    """URL 로 네트워크를 추정 (사용자 정의 소스에서 사용)."""
    d = domain_of(url)
    for name, needle in (("amazon", "amazon."), ("aliexpress", "aliexpress."),
                         ("coupang", "coupang."), ("ebay", "ebay."),
                         ("rakuten", "rakuten."), ("shopee", "shopee."),
                         ("tiktokshop", "tiktok.")):
        if needle in d:
            return name
    return "generic"
