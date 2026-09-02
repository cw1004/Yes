# -*- coding: utf-8 -*-
"""파이프라인이 주고받는 데이터 구조."""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

SYMBOL: Dict[str, str] = {"USD": "$", "KRW": "₩", "EUR": "€", "JPY": "¥",
                          "GBP": "£", "INR": "₹"}

# 내레이션에서 읽어 주는 통화 단어
CURRENCY_WORD: Dict[str, Dict[str, str]] = {
    "KRW": {"ko": "원", "en": "won"},
    "USD": {"ko": "달러", "en": "dollars"},
    "JPY": {"ko": "엔", "en": "yen"},
    "EUR": {"ko": "유로", "en": "euros"},
    "GBP": {"ko": "파운드", "en": "pounds"},
    "INR": {"ko": "루피", "en": "rupees"},
}

# 화면·문구에 쓰는 소스 표시 이름
SOURCE_LABEL: Dict[str, Dict[str, str]] = {
    "coupang": {"ko": "쿠팡", "en": "Coupang"},
    "aliexpress": {"ko": "알리익스프레스", "en": "AliExpress"},
    "amazon": {"ko": "아마존", "en": "Amazon"},
    "rakuten": {"ko": "라쿠텐", "en": "Rakuten"},
    "ebay": {"ko": "이베이", "en": "eBay"},
    "shopee": {"ko": "쇼피", "en": "Shopee"},
    "tiktokshop": {"ko": "틱톡샵", "en": "TikTok Shop"},
    "demo": {"ko": "샘플", "en": "DEMO"},
    "generic": {"ko": "쇼핑몰", "en": "Shop"},
}


def source_label(source: str, lang: str = "ko") -> str:
    return SOURCE_LABEL.get(source, {}).get(lang, source.upper())


_WS = re.compile(r"\s+")
_NON = re.compile(r"[^0-9a-z가-힣 ]+")


def norm_title(title: str) -> str:
    """중복 판정을 위한 제목 정규화."""
    t = _NON.sub(" ", (title or "").lower())
    return _WS.sub(" ", t).strip()


@dataclass
class Product:
    """소셜커머스에서 수집한 상품 하나."""

    source: str                       # aliexpress | amazon | coupang | demo ...
    product_id: str
    title: str
    url: str
    price: float = 0.0
    currency: str = "USD"
    orig_price: float = 0.0
    discount_pct: float = 0.0         # 소스가 직접 준 할인율 (있으면 계산값보다 우선)
    rating: float = 0.0
    reviews: int = 0
    sold: int = 0                     # 최근 판매량(있으면)
    sold_delta: int = 0               # 직전 수집 대비 증가분 → 실시간 인기 신호
    rank: int = 0                     # 플랫폼 인기 순위 (1위가 가장 인기, 0=정보 없음)
    commission: float = 0.0           # 제휴 수수료 %
    category: str = ""
    shop: str = ""
    image_url: str = ""
    images: List[str] = field(default_factory=list)
    highlights: List[str] = field(default_factory=list)   # 셀링포인트 3줄
    collected_at: float = field(default_factory=time.time)
    score: float = 0.0
    raw: Dict = field(default_factory=dict)

    # ---------- 파생값 ----------
    @property
    def key(self) -> str:
        """소스 간 중복까지 잡는 안정적인 키."""
        base = f"{self.source}:{self.product_id}" if self.product_id else norm_title(self.title)
        return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]

    @property
    def dedupe_key(self) -> str:
        """서로 다른 소스의 같은 상품을 묶기 위한 제목 기반 키."""
        return hashlib.sha1(norm_title(self.title)[:60].encode("utf-8")).hexdigest()[:16]

    @property
    def discount(self) -> float:
        if self.discount_pct > 0:      # 쇼핑몰이 표시하는 값과 화면 표시를 일치시킨다
            return round(self.discount_pct, 1)
        if self.orig_price > 0 and self.price > 0 and self.orig_price > self.price:
            return round((1 - self.price / self.orig_price) * 100, 1)
        return 0.0

    def amount_text(self, value: float) -> str:
        if value <= 0:
            return ""
        if self.currency in ("KRW", "JPY"):
            return f"{int(round(value)):,}"
        return f"{value:,.2f}".rstrip("0").rstrip(".")

    def price_text(self, symbol: str = "", value: Optional[float] = None) -> str:
        """화면 표시용 (₩23,900)."""
        amount = self.price if value is None else value
        body = self.amount_text(amount)
        if not body:
            return ""
        sym = symbol or SYMBOL.get(self.currency, "")
        return f"{sym}{body}" if sym else f"{body} {self.currency}"

    def spoken_price(self, lang: str = "ko", value: Optional[float] = None) -> str:
        """내레이션용 (23,900원) — TTS 는 통화 기호를 제대로 읽지 못한다."""
        amount = self.price if value is None else value
        body = self.amount_text(amount)
        if not body:
            return ""
        unit = CURRENCY_WORD.get(self.currency, {}).get(lang)
        if not unit:
            return f"{body} {self.currency}"
        return f"{body}{unit}" if lang == "ko" else f"{body} {unit}"

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["discount"] = self.discount
        d["key"] = self.key
        return d

    @classmethod
    def from_dict(cls, data: Dict) -> "Product":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class Beat:
    """영상 한 단계(비트)."""

    name: str
    seconds: float
    narration: str
    caption: str
    visual: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Script:
    """한 편의 대본 + 플랫폼 문구."""

    product_key: str
    title: str
    beats: List[Beat]
    hashtags: List[str] = field(default_factory=list)
    description: str = ""
    thumbnail_text: str = ""
    lang: str = "ko"
    provider: str = "template"

    @property
    def seconds(self) -> float:
        return round(sum(b.seconds for b in self.beats), 2)

    def narration_text(self) -> str:
        return " ".join(b.narration for b in self.beats if b.narration)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["seconds"] = self.seconds
        return d

    @classmethod
    def from_dict(cls, data: Dict) -> "Script":
        beats = [Beat(**b) for b in data.get("beats", [])]
        known = set(cls.__dataclass_fields__) - {"beats"}
        return cls(beats=beats, **{k: v for k, v in data.items() if k in known})


@dataclass
class VideoAsset:
    """렌더링 결과물."""

    product_key: str
    path: str
    thumbnail: str = ""
    seconds: float = 0.0
    link: str = ""            # 추적 링크 (사용자에게 노출)
    target: str = ""          # 최종 제휴 링크
    tts: str = ""
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class PostResult:
    """업로드 결과 한 건."""

    platform: str
    ok: bool
    status: str = ""          # published | queued | skipped | error
    post_id: str = ""
    url: str = ""
    message: str = ""
    at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class RunResult:
    """1회 실행 요약."""

    started_at: float = field(default_factory=time.time)
    collected: int = 0
    candidates: int = 0
    videos: List[VideoAsset] = field(default_factory=list)
    posts: List[PostResult] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    elapsed: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "started_at": self.started_at,
            "collected": self.collected,
            "candidates": self.candidates,
            "videos": [v.to_dict() for v in self.videos],
            "posts": [p.to_dict() for p in self.posts],
            "errors": self.errors,
            "elapsed": round(self.elapsed, 1),
        }
