# -*- coding: utf-8 -*-
"""Claude API 로 60초 대본을 생성하는 선택적 제공자.

ANTHROPIC_API_KEY 환경변수가 있을 때만 동작하며, 실패하면 호출측에서
템플릿 엔진으로 자동 폴백한다.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Dict, List, Optional

from ..config import BEAT_ORDER, BEAT_SECONDS, Config
from ..episodes import Episode
from ..scriptgen import (BASE_TAGS, Beat, VideoScript, SLOGAN, _caption, _clean,
                         _fit, build_script_template, detect_motif)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

SYSTEM_PROMPT = """당신은 60초 숏폼 다큐드라마 시리즈 'INDIA 2030'의 한국어 내레이션 작가다.
주인공은 인도 시골 마을의 맨발 소년으로, 2030 월드컵을 향해 나아간다.
모든 회차는 HOOK -> EMOTION -> ACTION -> DREAM -> MESSAGE 5단계로 구성된 60초 완결 서사다.
문체: 짧고 담백한 문장, 과장된 수식어 금지, 3인칭 관찰자 시점, 감정은 장면으로 보여줄 것.
반드시 유효한 JSON 만 출력한다. 코드블록이나 설명을 덧붙이지 않는다."""

USER_TEMPLATE = """다음 회차의 60초 내레이션 대본을 작성하라.

- 회차: {no}화 / 전체 100화
- ACT {act_no} · {act_name} ({act_sub}) — 무드: {mood}
- 소제목: {title}
- 핵심 소재: {motif}
{notes}

각 단계별 내레이션 글자 수 상한(한국어 기준):
{limits}

아래 스키마의 JSON 만 출력:
{{
  "logline": "한 줄 요약",
  "beats": [
    {{"name": "HOOK", "narration": "...", "caption": "화면 자막 20자 이내",
      "visual": "촬영 지시문 한국어", "image_prompt": "image generation prompt in English"}},
    ... EMOTION, ACTION, DREAM, MESSAGE 순서로 총 5개
  ]
}}"""


def _limits_text() -> str:
    return "\n".join(
        f"- {n}: {BEAT_SECONDS[n]:.0f}초 / 약 {int(BEAT_SECONDS[n] * 5)}자 이내"
        for n in BEAT_ORDER
    )


def _notes(ep: Episode) -> str:
    lines: List[str] = []
    if ep.director_note:
        lines.append(f"- 연출 메모: {ep.director_note}")
    if ep.no_spoiler:
        lines.append("- 중요: 경기 결과나 승패를 절대 드러내지 말 것. 여운만 남길 것.")
    if ep.cliffhanger:
        lines.append("- 마지막은 다음 화 예고처럼 이어지도록 끝낼 것.")
    return "\n".join(lines)


def _request(payload: Dict, api_key: str, timeout: int = 120) -> Dict:
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": API_VERSION,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_json(text: str) -> Dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n|\n```$", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("JSON 을 찾을 수 없습니다")
    return json.loads(text[start:end + 1])


def build_script_llm(ep: Episode, cfg: Config) -> Optional[VideoScript]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 가 설정되지 않았습니다")

    motif_ko, motif_en = detect_motif(ep.title)
    prompt = USER_TEMPLATE.format(
        no=ep.no, act_no=ep.act.no, act_name=ep.act.name, act_sub=ep.act.subtitle,
        mood=ep.act.mood, title=_clean(ep.title), motif=f"{motif_ko} / {motif_en}",
        notes=_notes(ep), limits=_limits_text(),
    )
    data = _request({
        "model": cfg.llm_model,
        "max_tokens": 2000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }, api_key)

    text = "".join(blk.get("text", "") for blk in data.get("content", []))
    parsed = _extract_json(text)

    by_name = {b.get("name", "").upper(): b for b in parsed.get("beats", [])}
    if not all(n in by_name for n in BEAT_ORDER):
        raise ValueError("5개 단계가 모두 포함되지 않았습니다")

    fallback = build_script_template(ep, cfg)
    beats: List[Beat] = []
    for name, tpl in zip(BEAT_ORDER, fallback.beats):
        b = by_name[name]
        narration = (b.get("narration") or "").strip() or tpl.narration
        beats.append(Beat(
            name=name,
            seconds=BEAT_SECONDS[name],
            narration=_fit(narration, BEAT_SECONDS[name]),
            caption=(b.get("caption") or "").strip() or _caption(narration),
            visual=(b.get("visual") or "").strip() or tpl.visual,
            image_prompt=(b.get("image_prompt") or "").strip() or tpl.image_prompt,
        ))

    logline = (parsed.get("logline") or "").strip() or fallback.logline
    tags = BASE_TAGS + [f"#ACT{ep.act.no}", f"#{ep.no}화"]
    description = (
        f"{fallback.hook_title}\n\nACT {ep.act.no} · {ep.act.name} ({ep.act.subtitle})\n"
        f"{logline}\n\n{SLOGAN}\n\n" + " ".join(tags)
    )
    return VideoScript(
        no=ep.no, title=_clean(ep.title), act_no=ep.act.no, act_name=ep.act.name,
        hook_title=fallback.hook_title, logline=logline, beats=beats,
        hashtags=tags, description=description,
        director_note=ep.director_note, provider=f"llm:{cfg.llm_model}",
    )
