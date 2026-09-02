# -*- coding: utf-8 -*-
"""제품 숏폼 대본 생성기.

5단계 고정 구조:  HOOK → PROBLEM → PROOF → PRICE → CTA
API 키가 없어도 템플릿만으로 완결된 대본이 나오고, ANTHROPIC_API_KEY 가 있으면
Claude 가 상품별 카피를 써서 품질이 올라간다(실패 시 자동 템플릿 폴백).
"""

from __future__ import annotations

import random
import re
from typing import Dict, List, Optional

from . import compliance
from .config import BEAT_ORDER, Config
from .models import Beat, Product, Script

# 언어별 초당 글자 수 (내레이션 길이 상한 계산용)
CHARS_PER_SEC: Dict[str, float] = {"ko": 5.2, "en": 14.0}

HOOK_KO = [
    "이거 모르고 {cat} 사면 손해예요.",
    "{sold:,}명이 이미 샀습니다. 이유가 있어요.",
    "이 가격이 실화냐는 댓글이 계속 달립니다.",
    "책상 위 이거 하나 바꿨더니 끝났습니다.",
    "{disc}% 할인, 오늘 기준입니다.",
]
HOOK_EN = [
    "Stop buying {cat} before you see this.",
    "{sold:,} people already bought this. Here's why.",
    "The comments keep asking if this price is real.",
    "One swap and the problem was gone.",
    "{disc}% off — as of today.",
]
PROBLEM_KO = [
    "매번 불편했는데 참고 썼던 부분이죠.",
    "비싼 걸 사도 딱 이 부분이 아쉬웠습니다.",
    "쓸 때마다 신경 쓰이던 그 문제, 여기서 해결됩니다.",
]
PROBLEM_EN = [
    "You put up with it every single day.",
    "Even the expensive ones miss this one thing.",
    "That small annoyance? Solved right here.",
]
CTA_KO = [
    "링크는 화면 아래 프로필에 있습니다.",
    "가격은 링크에서 바로 확인하세요.",
    "재고가 빠르게 줄고 있습니다. 링크 확인.",
]
CTA_EN = [
    "Link is in the profile below.",
    "Check the live price at the link.",
    "Stock moves fast — link in bio.",
]

# 카테고리 → 해시태그
TAGS_BY_CAT: Dict[str, List[str]] = {
    "주방용품": ["#주방템", "#자취템", "#살림템"],
    "생활가전": ["#생활템", "#가성비", "#여름템"],
    "사무/PC": ["#데스크테리어", "#사무템", "#생산성"],
    "자동차용품": ["#차량용품", "#드라이브", "#카템"],
    "캠핑/아웃도어": ["#캠핑용품", "#차박", "#캠린이"],
    "반려동물": ["#댕댕이", "#냥스타그램", "#펫용품"],
}
BASE_TAGS_KO = ["#쇼핑추천", "#꿀템", "#해외직구", "#shorts", "#릴스추천"]
BASE_TAGS_EN = ["#amazonfinds", "#tiktokmademebuyit", "#gadgets", "#shorts", "#dealoftheday"]


def _fit(text: str, max_chars: int) -> str:
    """문장 단위로 자르되 최대 길이를 넘기지 않는다."""
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= max_chars:
        return text
    parts = re.split(r"(?<=[.!?。])\s+", text)
    out = ""
    for p in parts:
        if len(out) + len(p) + 1 > max_chars:
            break
        out = f"{out} {p}".strip()
    return out or text[:max_chars].rstrip()


def _caption(text: str, limit: int = 22) -> str:
    """화면 자막 — 짧을수록 좋다."""
    text = re.sub(r"\s+", " ", (text or "").strip())
    text = re.sub(r"[.。]$", "", text)
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def max_chars(seconds: float, lang: str) -> int:
    return max(8, int(seconds * CHARS_PER_SEC.get(lang, 12.0)))


def hashtags(p: Product, lang: str) -> List[str]:
    base = BASE_TAGS_KO if lang == "ko" else BASE_TAGS_EN
    tags = TAGS_BY_CAT.get(p.category, []) + base
    if p.shop:
        slug = re.sub(r"[^0-9A-Za-z가-힣]", "", p.shop)
        if slug:
            tags.append(f"#{slug}")
    seen, out = set(), []
    for t in tags:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return compliance.ensure_tags(out[:12], lang)


def _proof_text(p: Product, lang: str) -> str:
    bits: List[str] = []
    if lang == "ko":
        if p.rating:
            bits.append(f"평점 {p.rating:.1f}점")
        if p.reviews:
            bits.append(f"후기 {p.reviews:,}개")
        if p.sold_delta:
            bits.append(f"최근 {p.sold_delta:,}개 추가 판매")
        elif p.sold:
            bits.append(f"누적 {p.sold:,}개 판매")
        head = ", ".join(bits) + "." if bits else "후기가 빠르게 쌓이는 제품입니다."
        if p.highlights:
            head += " " + " ".join(h.rstrip(".") + "." for h in p.highlights[:2])
        return head
    if p.rating:
        bits.append(f"{p.rating:.1f} stars")
    if p.reviews:
        bits.append(f"{p.reviews:,} reviews")
    if p.sold_delta:
        bits.append(f"{p.sold_delta:,} sold just this cycle")
    elif p.sold:
        bits.append(f"{p.sold:,} sold")
    head = ", ".join(bits) + "." if bits else "Reviews are stacking up fast."
    if p.highlights:
        head += " " + " ".join(h.rstrip(".") + "." for h in p.highlights[:2])
    return head


def _price_text(p: Product, cfg: Config) -> str:
    now = p.price_text(cfg.currency_symbol)
    was = ""
    if p.orig_price > p.price > 0:
        tmp = Product(source=p.source, product_id="", title="", url="",
                      price=p.orig_price, currency=p.currency)
        was = tmp.price_text(cfg.currency_symbol)
    if cfg.lang == "ko":
        if was and p.discount:
            return f"정가 {was}에서 지금 {now}. {p.discount:.0f}퍼센트 할인입니다."
        return f"지금 가격은 {now} 입니다. 변동될 수 있으니 링크에서 확인하세요." if now else \
            "가격은 링크에서 확인하세요."
    if was and p.discount:
        return f"Was {was}, now {now}. That's {p.discount:.0f} percent off."
    return f"It is {now} right now. Price can change, so check the link." if now else \
        "Check the live price at the link."


def build_script_template(p: Product, cfg: Config) -> Script:
    """오프라인 템플릿 대본."""
    lang = cfg.lang
    rng = random.Random(f"{p.key}{cfg.seed}")
    secs = cfg.beat_seconds()
    cat = p.category or ("아이템" if lang == "ko" else "gadgets")

    hook_pool = HOOK_KO if lang == "ko" else HOOK_EN
    hook = rng.choice(hook_pool).format(cat=cat, sold=p.sold or p.reviews,
                                        disc=int(p.discount or 20))
    problem_pool = PROBLEM_KO if lang == "ko" else PROBLEM_EN
    problem = rng.choice(problem_pool)
    if p.highlights:
        problem += " " + p.highlights[0].rstrip(".") + "."
    proof = _proof_text(p, lang)
    price = _price_text(p, cfg)
    cta_pool = CTA_KO if lang == "ko" else CTA_EN
    cta = rng.choice(cta_pool) + " " + compliance.short_disclosure(lang) + "."

    raw = {"HOOK": hook, "PROBLEM": problem, "PROOF": proof, "PRICE": price, "CTA": cta}
    captions = {
        "HOOK": _caption(hook),
        "PROBLEM": _caption(p.highlights[0] if p.highlights else problem),
        "PROOF": _caption(f"★{p.rating:.1f} · {p.reviews:,}" if p.rating else proof, 24),
        "PRICE": _caption(
            (f"{p.discount:.0f}% ↓ {p.price_text(cfg.currency_symbol)}"
             if p.discount else p.price_text(cfg.currency_symbol)) or price, 24),
        "CTA": compliance.short_disclosure(lang),
    }
    visuals = {
        "HOOK": "제품 클로즈업 · 빠른 줌인",
        "PROBLEM": "사용 전 상황 · 손 동작",
        "PROOF": "평점/후기 그래픽 오버레이",
        "PRICE": "가격 배지 강조 · 할인율 스탬프",
        "CTA": "링크 유도 · 워터마크",
    }

    beats: List[Beat] = []
    for name in BEAT_ORDER:
        text = compliance.scrub(raw[name])
        beats.append(Beat(
            name=name,
            seconds=secs[name],
            narration=_fit(text, max_chars(secs[name], lang)),
            caption=compliance.scrub(captions[name]) if cfg.subtitle else "",
            visual=visuals[name],
        ))

    title = build_title(p, cfg)
    return Script(
        product_key=p.key,
        title=title,
        beats=beats,
        hashtags=hashtags(p, lang),
        description=build_description(p, cfg, ""),
        thumbnail_text=captions["PRICE"] or captions["HOOK"],
        lang=lang,
        provider="template",
    )


def build_title(p: Product, cfg: Config) -> str:
    """플랫폼 공통 제목 (100자 이내)."""
    short = _fit(p.title, 46)
    if cfg.lang == "ko":
        head = f"{p.discount:.0f}% 할인" if p.discount else "지금 인기"
        return _fit(f"{head} | {short} #shorts", 95)
    head = f"{p.discount:.0f}% OFF" if p.discount else "Trending now"
    return _fit(f"{head} | {short} #shorts", 95)


def build_description(p: Product, cfg: Config, link: str) -> str:
    """게시글 본문 — 맨 앞에 광고 표기, 그다음 링크와 스펙."""
    lines: List[str] = []
    if link:
        lines.append(("구매 링크: " if cfg.lang == "ko" else "Get it here: ") + link)
    lines.append(_fit(p.title, 90))
    if p.price:
        lines.append(("가격: " if cfg.lang == "ko" else "Price: ")
                     + p.price_text(cfg.currency_symbol)
                     + (f" ({p.discount:.0f}%↓)" if p.discount else ""))
    if p.rating:
        lines.append(("평점: " if cfg.lang == "ko" else "Rating: ")
                     + f"{p.rating:.1f} / 5 ({p.reviews:,})")
    for h in p.highlights[:3]:
        lines.append(f"· {h}")
    lines.append("")
    lines.append(" ".join(hashtags(p, cfg.lang)))
    body = "\n".join(lines)
    return compliance.caption_with_disclosure(body, cfg.lang, cfg.disclosure)


def build_script(p: Product, cfg: Config) -> Script:
    """설정에 따라 LLM 또는 템플릿으로 대본을 만든다."""
    if cfg.script_provider == "llm":
        try:
            from .providers.llm import build_script_llm
            script = build_script_llm(p, cfg)
            if script:
                return script
        except Exception:
            pass                      # 키 없음/네트워크 실패 → 템플릿 폴백
    return build_script_template(p, cfg)
