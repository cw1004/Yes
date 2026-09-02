# -*- coding: utf-8 -*-
"""수집 소스 레지스트리."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple

from ..config import Config
from ..models import Product
from .aliexpress import AliExpressSource
from .amazon import AmazonSource
from .base import Source, SourceError
from .coupang import CoupangSource
from .custom import CustomSource
from .demo import DemoSource
from .ebay import EbaySource
from .rakuten import RakutenSource

REGISTRY: Dict[str, Source] = {
    s.name: s for s in (
        DemoSource(), AliExpressSource(), AmazonSource(), CoupangSource(),
        RakutenSource(), EbaySource(), CustomSource(),
    )
}


def names() -> List[str]:
    return list(REGISTRY)


def get(name: str) -> Source:
    if name not in REGISTRY:
        raise KeyError(f"알 수 없는 소스: {name} (가능: {', '.join(REGISTRY)})")
    return REGISTRY[name]


def status() -> List[Tuple[str, bool, str]]:
    out = []
    for name, src in REGISTRY.items():
        ok, why = src.available()
        out.append((name, ok, why))
    return out


def collect(cfg: Config, on_error=None) -> List[Product]:
    """설정된 소스를 동시에 긁어 상품 목록을 합친다. 실패한 소스는 건너뛴다."""
    wanted = [n for n in cfg.sources if n in REGISTRY]
    products: List[Product] = []
    if not wanted:
        return products

    with ThreadPoolExecutor(max_workers=max(1, min(len(wanted), cfg.workers))) as pool:
        futures = {pool.submit(_fetch_one, get(n), cfg): n for n in wanted}
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                products.extend(fut.result())
            except Exception as e:                 # 소스 하나가 죽어도 계속
                if on_error:
                    on_error(name, str(e))
    return products


def _fetch_one(src: Source, cfg: Config) -> List[Product]:
    ok, why = src.available()
    if not ok:
        raise SourceError(why)
    return src.fetch(cfg, cfg.source_limit)
