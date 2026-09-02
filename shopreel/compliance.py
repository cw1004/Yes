# -*- coding: utf-8 -*-
"""광고 표기 · 금지 카테고리 · 과장 표현 정리.

제휴(어필리에이트) 영상은 각국 규제(공정위 추천·보증 심사지침, FTC Endorsement
Guides)와 플랫폼 정책에 따라 **대가성 표시가 의무**다. 자동 업로드 파이프라인은
사람이 매번 확인하지 않으므로, 표기를 코드로 강제한다.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

# 언어별 기본 광고 표기 (영상 화면 + 게시글 본문 양쪽에 들어간다)
DISCLOSURE: Dict[str, str] = {
    "ko": "이 영상은 제휴 링크를 포함하며, 구매 시 수수료를 받을 수 있습니다. #광고",
    "en": "#ad — As an affiliate, I may earn a commission from qualifying purchases.",
}
DISCLOSURE_SHORT: Dict[str, str] = {
    "ko": "광고 · 제휴 링크 포함",
    "en": "#ad · affiliate link",
}
DISCLOSURE_TAGS: Dict[str, List[str]] = {
    "ko": ["#광고", "#제휴링크"],
    "en": ["#ad", "#affiliate"],
}

# 자동 제작에서 제외하는 카테고리 (규제/플랫폼 정책 위험)
BANNED_KEYWORDS: List[str] = [
    # 의약품·건강 표방
    "의약품", "처방", "다이어트약", "발기", "prescription", "viagra", "cbd", "kratom",
    # 성인/무기/담배/도박
    "성인용품", "성기구", "총기", "실탄", "도검", "전자담배", "액상", "니코틴", "카지노",
    "adult toy", "sex toy", "firearm", "ammo", "gun", "vape", "nicotine", "casino", "betting",
    # 위조품/불법
    "짝퉁", "레플리카", "모조품", "replica", "counterfeit", "fake brand", "unlocked bypass",
    # 개인정보/해킹
    "몰카", "도청", "hidden camera spy", "hacking tool",
]

# 광고 심의상 위험한 단정 표현 → 완화 표현
CLAIM_FIXES: List[Tuple[str, str]] = [
    (r"최저가\s*보장", "가격 확인"),
    (r"100%\s*(효과|보장|정품)", "실사용 후기 기준"),
    (r"무조건", "대체로"),
    (r"완치|치료|의학적", "관리"),
    (r"부작용\s*없", "사용법 확인 필요"),
    (r"평생\s*무료", "기간 한정 혜택"),
    (r"\bguaranteed\b", "reported"),
    (r"\bcures?\b", "supports"),
    (r"\bmiracle\b", "popular"),
]

# 브랜드 사칭·상표 이슈를 부르는 표현
BRAND_PATTERNS = re.compile(r"(정품\s*아님|A급|SA급|1:1\s*퀄리티|오프화이트st|st\b)", re.I)


def is_allowed(title: str, category: str = "", extra_deny: Optional[List[str]] = None) -> bool:
    """자동 제작 가능한 상품인지 판정."""
    text = f"{title} {category}".lower()
    for kw in BANNED_KEYWORDS + list(extra_deny or []):
        if kw and kw.lower() in text:
            return False
    if BRAND_PATTERNS.search(text):
        return False
    return True


def scrub(text: str) -> str:
    """대본/문구에서 위험한 단정 표현을 완화한다."""
    out = text or ""
    for pattern, repl in CLAIM_FIXES:
        out = re.sub(pattern, repl, out, flags=re.I)
    return out


def disclosure(lang: str = "ko", custom: Optional[str] = None) -> str:
    return custom or DISCLOSURE.get(lang, DISCLOSURE["en"])


def short_disclosure(lang: str = "ko") -> str:
    return DISCLOSURE_SHORT.get(lang, DISCLOSURE_SHORT["en"])


def ensure_tags(tags: List[str], lang: str = "ko") -> List[str]:
    """광고 표기 해시태그가 항상 앞에 오도록 보정."""
    required = DISCLOSURE_TAGS.get(lang, DISCLOSURE_TAGS["en"])
    have = {t.lower() for t in tags}
    return [t for t in required if t.lower() not in have] + list(tags)


def caption_with_disclosure(body: str, lang: str = "ko", custom: Optional[str] = None) -> str:
    """게시글 본문 맨 앞에 표기를 넣는다 (플랫폼 정책상 '더보기' 뒤로 숨기면 안 됨)."""
    note = disclosure(lang, custom)
    if note.split()[0].lower() in body.lower()[:120]:
        return body
    return f"{note}\n\n{body}".strip()
