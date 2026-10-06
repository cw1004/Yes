# -*- coding: utf-8 -*-
"""패션 코칭 두뇌 — Claude(Vision) + 규칙 엔진.

  register_from_photo : 옷 사진 → 옷장 DB 한 줄 (자동 태깅)
  evaluate_look       : 거울 앞 전신 사진 → "이렇게 입고 나가도 돼?" 평가
  recommend           : 날씨·일정·옷장 → 오늘의 코디 추천

ANTHROPIC_API_KEY 가 없거나 호출이 실패하면 규칙 엔진(stylist.py)으로 자동 폴백한다.
카메라 사진은 메모리에서만 처리하고 디스크에 저장하지 않는다(옷 등록 사진만 저장).
"""

from __future__ import annotations

import base64
import json
import os
from typing import List, Optional, Sequence

from . import stylist
from .closet import CATEGORIES, STYLES, Closet, Garment
from .config import MirrorConfig
from .weather import Weather

SYSTEM_PROMPT = """너는 가정용 스마트 거울 속 'AI 패션 코치'다.
가족 누구나(어린이~어르신) 외출 직전에 거울 앞에서 너에게 묻는다.
원칙:
- 한국어 존댓말, 거울 화면에 띄울 것이므로 짧고 구체적으로(2~3문장).
- 반드시 오늘 날씨(체감 기온·비·일교차·미세먼지)와 일정(TPO)을 근거로 말한다.
- 옷을 바꾸라고 할 때는 '옷장 목록'에 실제로 있는 옷만 #번호와 함께 제안한다. 없는 옷을 지어내지 않는다.
- 체형·외모·나이를 평가하거나 비하하지 않는다. 옷의 조합·두께·색·상황 적합성만 말한다.
- 사진 속 사람의 신원을 추측하지 않는다.
- 사진에 옷이 잘 안 보이면 솔직히 말하고 거울에서 한 걸음 물러서 달라고 안내한다."""

GARMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "name": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "color": {"type": "string"},
        "material": {"type": "string"},
        "pattern": {"type": "string"},
        "style": {"type": "string", "enum": STYLES},
        "warmth": {"type": "integer"},
        "waterproof": {"type": "boolean"},
    },
    "required": ["found", "name", "category", "color", "material", "pattern",
                 "style", "warmth", "waterproof"],
    "additionalProperties": False,
}

# 점수 항목(합계 100점). 외모·체형이 아니라 '옷차림'만 채점한다.
SCORE_ITEMS = [
    ("weather", "날씨 적합도", 30),
    ("tpo", "일정(TPO) 적합도", 25),
    ("color", "색·패턴 조화", 20),
    ("balance", "실루엣 밸런스", 15),
    ("finish", "완성도(신발·소품·정돈)", 10),
]

LOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "visible": {"type": "boolean"},
        "verdict": {"type": "string", "enum": ["good", "adjust", "change"]},
        "seen_items": {"type": "array", "items": {"type": "string"}},
        "scores": {
            "type": "object",
            "properties": {k: {"type": "integer"} for k, _, _ in SCORE_ITEMS},
            "required": [k for k, _, _ in SCORE_ITEMS],
            "additionalProperties": False,
        },
        "good_points": {"type": "array", "items": {"type": "string"}},
        "fixes": {"type": "array", "items": {"type": "string"}},
        "message": {"type": "string"},
        "suggest_ids": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["visible", "verdict", "seen_items", "scores", "good_points",
                 "fixes", "message", "suggest_ids"],
    "additionalProperties": False,
}

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "choice": {"type": "integer"},
        "message": {"type": "string"},
    },
    "required": ["choice", "message"],
    "additionalProperties": False,
}


class Coach:
    def __init__(self, cfg: MirrorConfig, closet: Closet):
        self.cfg = cfg
        self.closet = closet
        self._client = None
        self.ai_error: Optional[str] = None
        if cfg.use_ai and os.environ.get("ANTHROPIC_API_KEY"):
            try:
                import anthropic  # 선택 의존성: pip install anthropic
                self._client = anthropic.Anthropic()
            except ImportError:
                self.ai_error = "anthropic 패키지가 없습니다 (pip install anthropic)"

    @property
    def ai_enabled(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------ Claude 호출
    def _ask(self, content: list, schema: dict, max_tokens: int = 2000) -> dict:
        response = self._client.beta.messages.create(
            model=self.cfg.llm_model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": self.cfg.llm_effort,
                           "format": {"type": "json_schema", "schema": schema}},
            # 안전 분류기가 거절하면 서버가 권장 모델로 자동 재시도
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("AI 가 이 요청을 처리하지 않았습니다")
        text = next(b.text for b in response.content if b.type == "text")
        return json.loads(text)

    @staticmethod
    def _image_block(image: bytes, media_type: str) -> dict:
        return {"type": "image", "source": {
            "type": "base64", "media_type": media_type,
            "data": base64.standard_b64encode(image).decode("ascii")}}

    # ------------------------------------------------------------ 1) 옷 등록
    def tag_garment(self, image: bytes, media_type: str = "image/jpeg") -> Optional[dict]:
        if not self.ai_enabled:
            return None
        data = self._ask([
            self._image_block(image, media_type),
            {"type": "text", "text": (
                "사진 속 옷 한 벌을 옷장 DB 에 등록하려 한다. found 는 옷이 보이면 true. "
                "name 은 '네이비 울 니트'처럼 색+소재+종류의 짧은 한국어 이름, "
                "color/material/pattern 은 한국어(무지면 pattern='solid'), "
                "warmth 는 1(민소매·린넨)~5(패딩) 보온 정도.")},
        ], GARMENT_SCHEMA, max_tokens=1000)
        if not data.get("found"):
            return None
        data["warmth"] = max(1, min(5, int(data.get("warmth", 3))))
        data.pop("found", None)
        return data

    # ------------------------------------------------------------ 2) 지금 옷 평가 + 점수
    def evaluate_look(self, image: Optional[bytes], weather: Weather, occasion: str = "daily",
                      owner: Optional[str] = None, question: str = "",
                      media_type: str = "image/jpeg",
                      worn_ids: Sequence[int] = ()) -> dict:
        """옷차림을 100점 만점으로 채점하고 코칭한다.

        image    : 셀프 카메라/거울 카메라 사진 (AI 모드)
        worn_ids : 오늘 입은 옷장 #번호 (사진 없이 / AI 없이 채점할 때)
        """
        occ_ko = stylist.OCCASIONS.get(occasion, stylist.OCCASIONS["daily"])["ko"]
        tips = stylist.weather_tips(weather)
        worn = self._existing(worn_ids)

        if image is not None and self.ai_enabled:
            try:
                return self._evaluate_with_ai(image, media_type, weather, occasion,
                                              occ_ko, owner, question, tips)
            except Exception as e:  # 네트워크·키 오류 등 → 규칙 채점으로 폴백
                self.ai_error = str(e)

        if worn:
            r = stylist.score_items(worn, weather, occasion)
            fix = self._fix_suggestions(worn, weather, occasion, owner) if r["fixes"] else []
            r.update(source="rules", seen_items=[g.name for g in worn],
                     suggestions=[g.to_dict() for g in fix], ai_error=self.ai_error)
            return r

        reason = ("AI 연결에 실패했습니다" if self.ai_error and self.ai_enabled
                  else "사진 채점은 AI 연결(ANTHROPIC_API_KEY)이 필요합니다")
        return {"source": "rules", "verdict": "unknown", "total": None, "scores": [],
                "seen_items": [], "good_points": [], "fixes": [],
                "message": (f"{reason}. 오늘 입은 옷을 옷장 목록에서 고르면 점수를 매겨 드릴게요. "
                            + " / ".join(tips)),
                "suggestions": [], "tips": tips, "ai_error": self.ai_error}

    def _evaluate_with_ai(self, image: bytes, media_type: str, weather: Weather,
                          occasion: str, occ_ko: str, owner: Optional[str],
                          question: str, tips: List[str]) -> dict:
        rubric = "\n".join(f"- {k}: {label} (0~{mx}점)" for k, label, mx in SCORE_ITEMS)
        data = self._ask([
            self._image_block(image, media_type),
            {"type": "text", "text": (
                f"[오늘 날씨] {weather.summary()}\n"
                f"[일정] {occ_ko}\n"
                f"[질문] {question or '이렇게 입고 나가도 될까요?'}\n"
                f"[옷장 목록]\n{self.closet.as_prompt_text(owner)}\n\n"
                "사진 속 옷차림(셀카 또는 거울 사진)을 아래 기준으로 채점하고 코칭하라.\n"
                f"{rubric}\n"
                "채점은 옷의 두께·조합·색·길이 비율·정돈 상태만 본다. 얼굴·체형·나이는 채점하지 않는다.\n"
                "visible: 옷이 판단 가능할 만큼 보이는지(안 보이면 점수는 모두 0). "
                "verdict: good(그대로 OK) / adjust(한두 개 추가·교체) / change(전체 교체 권장). "
                "seen_items: 보이는 옷(한국어). good_points: 잘한 점 1~3개. "
                "fixes: 고칠 점 0~3개(구체적 행동으로). message: 거울에 띄울 2~3문장 총평. "
                "suggest_ids: 추가·교체할 옷장 #번호(없으면 빈 배열).")},
        ], LOOK_SCHEMA)
        if not data["visible"]:
            return {"source": "ai", "verdict": "unknown", "total": None, "scores": [],
                    "seen_items": [], "good_points": [], "fixes": [],
                    "message": data["message"] or "옷이 잘 보이지 않아요. 한 걸음 물러서 전신이 나오게 찍어 주세요.",
                    "suggestions": [], "tips": tips}
        scores = []
        for key, label, mx in SCORE_ITEMS:
            val = max(0, min(mx, int(data["scores"].get(key, 0))))
            scores.append({"key": key, "label": label, "score": val, "max": mx})
        suggestions = [g.to_dict() for g in self._existing(data.get("suggest_ids", []))]
        return {"source": "ai", "verdict": data["verdict"],
                "total": sum(s["score"] for s in scores), "scores": scores,
                "grade": stylist.grade(sum(s["score"] for s in scores)),
                "seen_items": data.get("seen_items", []),
                "good_points": data.get("good_points", []), "fixes": data.get("fixes", []),
                "message": data["message"], "suggestions": suggestions, "tips": tips}

    def _fix_suggestions(self, worn: Sequence[Garment], weather: Weather,
                         occasion: str, owner: Optional[str]) -> List[Garment]:
        """규칙 채점 때: 추천 1순위 코디 중 지금 안 입은 옷을 제안."""
        best = stylist.recommend(self.closet.all(owner=owner), weather, occasion, top_n=1)
        if not best:
            return []
        worn_cats = {g.category for g in worn}
        if "dress" in worn_cats:
            worn_cats |= {"top", "bottom"}
        return [g for g in best[0].items if g.category not in worn_cats][:2]

    # ------------------------------------------------------------ 3) 코디 추천
    def recommend(self, weather: Weather, occasion: str = "daily",
                  owner: Optional[str] = None, request: str = "") -> dict:
        if request and stylist.guess_occasion(request) != "daily":
            occasion = stylist.guess_occasion(request)  # 말한 일정이 선택값보다 우선
        items = self.closet.all(owner=owner)
        recent = self.closet.recently_worn(self.cfg.recent_days)
        outfits = stylist.recommend(items, weather, occasion, recent, top_n=3)
        occ_ko = stylist.OCCASIONS[occasion]["ko"]
        result = {"source": "rules", "occasion": occasion, "occasion_ko": occ_ko,
                  "weather": weather.to_dict(),
                  "outfits": [o.to_dict() for o in outfits], "choice": 0}
        if not outfits:
            result["message"] = ("옷장에 등록된 옷이 부족합니다. 상의·하의(또는 원피스)를 "
                                 "먼저 등록해 주세요.")
            return result
        best = outfits[0]
        result["message"] = (f"오늘 {occ_ko} 코디로 {', '.join(g.name for g in best.items)} 조합을 "
                             f"추천합니다. " + ". ".join(best.reasons[:2]) + ".")

        if self.ai_enabled:  # 규칙 엔진 후보 중에서 Claude 가 고르고 설명
            listing = "\n".join(f"{i}. {o.describe()}" for i, o in enumerate(outfits))
            try:
                data = self._ask([{"type": "text", "text": (
                    f"[오늘 날씨] {weather.summary()}\n[일정] {occ_ko}\n"
                    f"[요청] {request or '오늘 뭐 입지?'}\n[후보 코디]\n{listing}\n\n"
                    "후보 중 가장 좋은 하나의 번호를 choice 로 고르고, message 에는 "
                    "거울에 띄울 2~3문장 추천 이유를 써라(옷 이름 그대로 사용).")}],
                    PICK_SCHEMA, max_tokens=1000)
                choice = int(data.get("choice", 0))
                if 0 <= choice < len(outfits):
                    result.update(source="ai", choice=choice, message=data["message"])
            except Exception as e:
                self.ai_error = str(e)
        return result

    def _existing(self, ids: Sequence[int]) -> List[Garment]:
        out = []
        for i in ids:
            try:
                g = self.closet.get(int(i))
            except (TypeError, ValueError):
                g = None
            if g:
                out.append(g)
        return out
