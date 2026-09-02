# -*- coding: utf-8 -*-
"""Claude 로 상품 숏폼 카피를 쓰는 선택적 제공자.

ANTHROPIC_API_KEY 가 있을 때만 동작하고, 실패하면 호출측에서 템플릿으로 폴백한다.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Dict, List, Optional

from .. import compliance
from ..config import BEAT_ORDER, Config
from ..models import Beat, Product, Script
from ..scriptgen import (_caption, _fit, build_description, build_script_template,
                         build_title, hashtags, max_chars)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

SYSTEM = """당신은 커머스 숏폼 광고 카피라이터다.
구조는 반드시 HOOK → PROBLEM → PROOF → PRICE → CTA 5단계다.
규칙:
- 첫 문장(HOOK)은 1~2초 안에 스크롤을 멈추게 하는 한 문장.
- 근거(PROOF)는 주어진 평점·후기 수·판매량 숫자만 사용한다. 숫자를 지어내지 않는다.
- 효능·치료·최저가 보장 같은 단정적 표현을 쓰지 않는다.
- CTA 에는 제휴 광고임을 알리는 표현을 반드시 포함한다.
- {lang_rule}
반드시 유효한 JSON 만 출력한다. 코드블록이나 설명을 덧붙이지 않는다."""

LANG_RULE = {
    "ko": "모든 문장은 한국어 구어체로 쓴다.",
    "en": "Write every line in natural spoken English.",
}

USER = """아래 상품으로 {seconds:.0f}초 숏폼 대본을 써라.

상품명: {title}
카테고리: {category}
가격: {price} (정가 {orig}, 할인 {discount}%)
평점: {rating} / 후기 {reviews}개 / 판매 {sold}개 (최근 증가 {delta}개)
셀링포인트: {highlights}

단계별 내레이션 길이 상한:
{limits}

아래 스키마의 JSON 만 출력:
{{
  "beats": [
    {{"name": "HOOK", "narration": "...", "caption": "화면 자막 20자 이내"}},
    ... PROBLEM, PROOF, PRICE, CTA 순서로 총 5개
  ],
  "title": "영상 제목 60자 이내",
  "thumbnail_text": "썸네일 문구 12자 이내"
}}"""


def _extract_json(text: str) -> Optional[Dict]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n|\n```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def call_claude(prompt: str, system: str, model: str, max_tokens: int = 1400) -> Optional[str]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    body = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return "".join(part.get("text", "") for part in data.get("content", []))
    except Exception:
        return None


def build_script_llm(p: Product, cfg: Config) -> Optional[Script]:
    secs = cfg.beat_seconds()
    limits = "\n".join(
        f"- {n}: {secs[n]:.1f}초 / 약 {max_chars(secs[n], cfg.lang)}자 이내" for n in BEAT_ORDER)
    prompt = USER.format(
        seconds=cfg.duration,
        title=p.title,
        category=p.category or "-",
        price=p.price_text(cfg.currency_symbol) or "-",
        orig=p.orig_price or "-",
        discount=f"{p.discount:.0f}",
        rating=f"{p.rating:.1f}" if p.rating else "-",
        reviews=f"{p.reviews:,}",
        sold=f"{p.sold:,}",
        delta=f"{p.sold_delta:,}",
        highlights=" / ".join(p.highlights) or "-",
        limits=limits,
    )
    system = SYSTEM.format(lang_rule=LANG_RULE.get(cfg.lang, LANG_RULE["en"]))
    text = call_claude(prompt, system, cfg.llm_model)
    data = _extract_json(text or "")
    if not data or not data.get("beats"):
        return None

    by_name = {str(b.get("name", "")).upper(): b for b in data["beats"] if isinstance(b, dict)}
    fallback = {b.name: b for b in build_script_template(p, cfg).beats}
    beats: List[Beat] = []
    for name in BEAT_ORDER:
        item = by_name.get(name, {})
        narration = compliance.scrub(str(item.get("narration") or fallback[name].narration))
        caption = compliance.scrub(str(item.get("caption") or fallback[name].caption))
        beats.append(Beat(
            name=name,
            seconds=secs[name],
            narration=_fit(narration, max_chars(secs[name], cfg.lang)),
            caption=_caption(caption) if cfg.subtitle else "",
            visual=fallback[name].visual,
        ))

    return Script(
        product_key=p.key,
        title=_fit(str(data.get("title") or build_title(p, cfg)), 95),
        beats=beats,
        hashtags=hashtags(p, cfg.lang),
        description=build_description(p, cfg, ""),
        thumbnail_text=_caption(str(data.get("thumbnail_text") or ""), 14)
                       or fallback["PRICE"].caption,
        lang=cfg.lang,
        provider="llm",
    )
