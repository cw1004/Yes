# -*- coding: utf-8 -*-
"""인기도 점수화 · 필터 · 중복 제거.

"실시간 인기"는 절대 판매량이 아니라 **증가 속도**가 핵심이다.
직전 수집 대비 판매량 증가분(sold_delta)에 가장 큰 가중치를 준다.
수익 데이터가 쌓이면 카테고리별 EPC(클릭당 수익)로 점수를 보정한다.
"""

from __future__ import annotations

import math
import time
from difflib import SequenceMatcher
from typing import Dict, Iterable, List, Optional

from .compliance import is_allowed
from .config import Config
from .models import Product, norm_title

WEIGHTS: Dict[str, float] = {
    "velocity": 3.0,     # 판매량 증가 속도
    "volume": 1.2,       # 누적 판매량
    "social": 1.5,       # 평점 × 리뷰 수
    "discount": 1.3,     # 할인율
    "commission": 1.6,   # 제휴 수수료
    "freshness": 0.8,    # 신선도
    "epc": 2.0,          # 카테고리 실적 피드백
}


def _log(x: float) -> float:
    return math.log10(max(1.0, x))


def score(p: Product, epc: Optional[Dict[str, float]] = None, now: Optional[float] = None) -> float:
    """0~100 정규화 점수."""
    now = now or time.time()
    epc = epc or {}

    velocity = _log(p.sold_delta * 10) / 4.0                      # 0~1
    volume = _log(p.sold) / 5.0                                   # 0~1
    social = (min(p.rating, 5.0) / 5.0) * (_log(p.reviews) / 4.0)  # 0~1
    discount = min(p.discount, 70.0) / 70.0                       # 0~1
    commission = min(p.commission, 30.0) / 30.0                   # 0~1
    age_h = max(0.0, (now - p.collected_at) / 3600.0)
    freshness = 1.0 / (1.0 + age_h / 12.0)                        # 12시간 반감

    cat_epc = epc.get(p.category, 0.0)
    epc_boost = min(cat_epc / 0.5, 1.0) if cat_epc > 0 else 0.0

    total = (WEIGHTS["velocity"] * velocity + WEIGHTS["volume"] * volume
             + WEIGHTS["social"] * social + WEIGHTS["discount"] * discount
             + WEIGHTS["commission"] * commission + WEIGHTS["freshness"] * freshness
             + WEIGHTS["epc"] * epc_boost)
    return round(total / sum(WEIGHTS.values()) * 100, 2)


def passes_filter(p: Product, cfg: Config) -> bool:
    if not is_allowed(p.title, p.category, cfg.deny_keywords):
        return False
    if p.price and not (cfg.min_price <= p.price <= cfg.max_price):
        return False
    if p.rating and p.rating < cfg.min_rating:
        return False
    if p.reviews and p.reviews < cfg.min_reviews:
        return False
    if cfg.min_commission and p.commission < cfg.min_commission:
        return False
    if cfg.min_discount and p.discount < cfg.min_discount:
        return False
    if cfg.allow_categories and p.category not in cfg.allow_categories:
        return False
    if not p.url or not p.title:
        return False
    return True


def dedupe(products: Iterable[Product], threshold: float = 0.82) -> List[Product]:
    """같은 상품(제목 유사)은 점수가 높은 것만 남긴다."""
    kept: List[Product] = []
    seen_keys: set = set()
    for p in sorted(products, key=lambda x: x.score, reverse=True):
        if p.key in seen_keys or p.dedupe_key in seen_keys:
            continue
        title = norm_title(p.title)[:60]
        if any(SequenceMatcher(None, title, norm_title(k.title)[:60]).ratio() >= threshold
               for k in kept):
            continue
        kept.append(p)
        seen_keys.update({p.key, p.dedupe_key})
    return kept


def rank(products: Iterable[Product], cfg: Config,
         epc: Optional[Dict[str, float]] = None,
         exclude: Optional[Dict[str, float]] = None) -> List[Product]:
    """필터 → 점수 → 중복 제거 → 최근 제작분 제외 → 정렬."""
    exclude = exclude or {}
    picked: List[Product] = []
    for p in products:
        if not passes_filter(p, cfg):
            continue
        p.score = score(p, epc)
        picked.append(p)
    ordered = dedupe(picked)
    return [p for p in ordered if p.key not in exclude]
