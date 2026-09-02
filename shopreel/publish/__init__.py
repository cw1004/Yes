# -*- coding: utf-8 -*-
"""업로드 제공자 레지스트리."""

from __future__ import annotations

from typing import Dict, List, Tuple

from .base import Publisher
from .dryrun import DryRunPublisher
from .facebook import FacebookPublisher
from .instagram import InstagramPublisher
from .tiktok import TikTokPublisher
from .youtube import YouTubePublisher

REGISTRY: Dict[str, Publisher] = {
    p.name: p for p in (
        DryRunPublisher(), YouTubePublisher(), TikTokPublisher(),
        InstagramPublisher(), FacebookPublisher(),
    )
}


def names() -> List[str]:
    return list(REGISTRY)


def get(name: str) -> Publisher:
    if name not in REGISTRY:
        raise KeyError(f"알 수 없는 업로드 대상: {name} (가능: {', '.join(REGISTRY)})")
    return REGISTRY[name]


def status() -> List[Tuple[str, bool, str]]:
    return [(name, *pub.available()) for name, pub in REGISTRY.items()]
