# -*- coding: utf-8 -*-
"""규칙 기반 코디 엔진 (오프라인·무료).

AI 가 없어도 '날씨 + 일정(TPO) + 내 옷장 + 최근 착용 기록'으로 코디를 계산한다.
AI 를 쓸 때도 이 엔진이 먼저 후보를 뽑고, Claude 는 설명·미세조정을 맡는다
→ API 비용이 줄고, 옷장에 없는 옷을 지어내는 실수도 막을 수 있다.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from .closet import Garment
from .weather import Weather

# ------------------------------------------------------------------ 일정(TPO)
OCCASIONS: Dict[str, dict] = {
    "daily":    {"ko": "가벼운 외출",   "like": {"casual", "minimal", "street", "lovely"}, "avoid": set()},
    "office":   {"ko": "출근",          "like": {"business", "minimal"}, "avoid": {"sporty"}},
    "meeting":  {"ko": "중요한 미팅",   "like": {"business", "formal"}, "avoid": {"sporty", "street"}},
    "wedding":  {"ko": "결혼식 하객",   "like": {"formal", "business", "lovely", "minimal"},
                 "avoid": {"sporty", "street"}},
    "date":     {"ko": "데이트",        "like": {"lovely", "minimal", "street", "casual"}, "avoid": {"sporty"}},
    "school":   {"ko": "등교·학원",     "like": {"casual", "sporty", "street"}, "avoid": {"formal"}},
    "exercise": {"ko": "운동·산책",     "like": {"sporty", "casual"}, "avoid": {"formal", "business"}},
}

# 문장 속 키워드로 일정 추정 ("오늘 결혼식 가는데 뭐 입지?" → wedding)
OCCASION_KEYWORDS: List[Tuple[str, Tuple[str, ...]]] = [
    ("wedding", ("결혼식", "하객", "웨딩")),
    ("meeting", ("미팅", "면접", "발표", "회의", "상견례")),
    ("office", ("출근", "회사", "직장", "사무실")),
    ("date", ("데이트", "소개팅")),
    ("exercise", ("운동", "산책", "등산", "헬스", "러닝")),
    ("school", ("학교", "등교", "학원", "수업")),
]

NEUTRALS = ("화이트", "흰", "블랙", "검정", "그레이", "회색", "네이비", "베이지",
            "아이보리", "차콜", "카키", "브라운", "라이트블루", "블루", "데님", "크림")


def guess_occasion(text: str) -> str:
    for key, words in OCCASION_KEYWORDS:
        if any(w in (text or "") for w in words):
            return key
    return "daily"


def is_neutral(color: str) -> bool:
    return any(n in (color or "") for n in NEUTRALS)


# ------------------------------------------------------------------ 기온 → 옷차림
def layer_plan(w: Weather) -> dict:
    """체감 기온으로 필요한 보온 수준을 정한다."""
    t = w.feels_like
    if t >= 23:
        plan = {"band": "더움", "top": (1, 2), "outer": None}
    elif t >= 17:
        plan = {"band": "선선", "top": (1, 3), "outer": (1, 2) if w.daily_swing >= 8 else None}
    elif t >= 12:
        plan = {"band": "쌀쌀", "top": (2, 3), "outer": (2, 3)}
    elif t >= 5:
        plan = {"band": "추움", "top": (3, 4), "outer": (3, 4)}
    else:
        plan = {"band": "한파", "top": (3, 5), "outer": (4, 5)}
    plan["need_outer"] = plan["outer"] is not None
    return plan


@dataclass
class Outfit:
    items: List[Garment]
    score: float
    reasons: List[str] = field(default_factory=list)
    tips: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"items": [g.to_dict() for g in self.items], "score": round(self.score, 2),
                "reasons": self.reasons, "tips": self.tips}

    def describe(self) -> str:
        return " + ".join(g.label for g in self.items)


def _range_score(value: int, rng: Optional[Tuple[int, int]]) -> float:
    if rng is None:
        return 0.0
    lo, hi = rng
    if lo <= value <= hi:
        return 2.0
    return -1.5 * min(abs(value - lo), abs(value - hi))


def _style_score(g: Garment, occ: dict) -> float:
    if g.style in occ["like"]:
        return 1.5
    if g.style in occ["avoid"]:
        return -3.0
    return 0.0


def _harmony(items: Sequence[Garment]) -> Tuple[float, Optional[str]]:
    """색·패턴 조화. 포인트 컬러는 1개, 패턴은 1개까지가 무난하다."""
    loud = {g.color for g in items if g.color and not is_neutral(g.color)}
    patterns = [g for g in items if g.pattern not in ("", "solid")]
    score, note = 0.0, None
    if len(loud) <= 1:
        score += 1.0
        if loud:
            note = f"포인트 컬러({next(iter(loud))})를 하나로 정리해 깔끔합니다"
        else:
            note = "무채색·뉴트럴 톤으로 실패 없는 조합입니다"
    else:
        score -= 1.5 * (len(loud) - 1)
    if len(patterns) >= 2:
        score -= 2.0
    return score, note


def recommend(closet_items: Sequence[Garment], w: Weather, occasion: str = "daily",
              recent: Optional[Dict[int, int]] = None, top_n: int = 3) -> List[Outfit]:
    occ = OCCASIONS.get(occasion, OCCASIONS["daily"])
    plan = layer_plan(w)
    recent = recent or {}
    by_cat: Dict[str, List[Garment]] = {}
    for g in closet_items:
        by_cat.setdefault(g.category, []).append(g)

    def item_score(g: Garment, rng=None) -> float:
        s = _style_score(g, occ) - 1.2 * recent.get(g.id, 0)
        return s + _range_score(g.warmth, rng)

    # 1) 몸통: 상의+하의 또는 원피스
    bases: List[Tuple[float, List[Garment]]] = []
    for top, bottom in itertools.product(by_cat.get("top", []), by_cat.get("bottom", [])):
        s = item_score(top, plan["top"]) + item_score(bottom)
        if plan["band"] == "더움":
            s += 1.0 if bottom.warmth <= 2 else -1.0
        elif plan["band"] in ("추움", "한파"):
            s += -2.0 if bottom.warmth <= 1 else 0.0
        bases.append((s, [top, bottom]))
    for dress in by_cat.get("dress", []):
        bases.append((item_score(dress, plan["top"]) + 0.5, [dress]))
    if not bases:
        return []
    bases.sort(key=lambda x: -x[0])

    outfits: List[Outfit] = []
    for base_score, base in bases[: max(top_n * 4, 8)]:
        items, score = list(base), base_score

        # 2) 아우터
        if plan["need_outer"] and by_cat.get("outer"):
            def outer_score(o: Garment) -> float:
                s = item_score(o, plan["outer"]) + _harmony(items + [o])[0]
                if w.is_rainy or w.is_snowy:
                    s += 2.5 if o.waterproof else -0.5
                return s
            best = max(by_cat["outer"], key=outer_score)
            items.append(best)
            score += outer_score(best)
        elif plan["need_outer"]:
            score -= 3.0

        # 3) 신발
        if by_cat.get("shoes"):
            def shoe_score(s_: Garment) -> float:
                s = item_score(s_)
                if w.is_rainy:
                    s += 2.0 if s_.waterproof else 0.0
                return s
            shoes = max(by_cat["shoes"], key=shoe_score)
            items.append(shoes)
            score += shoe_score(shoes) * 0.5

        h_score, h_note = _harmony(items)
        score += h_score
        outfits.append(Outfit(items, score, _reasons(items, w, occ, plan, h_note),
                              weather_tips(w, items)))

    # 같은 몸통 조합 중복 제거 후 상위 n개
    outfits.sort(key=lambda o: -o.score)
    seen, unique = set(), []
    for o in outfits:
        key = tuple(sorted(g.id or 0 for g in o.items))
        if key not in seen:
            seen.add(key)
            unique.append(o)
    return unique[:top_n]


def _reasons(items: List[Garment], w: Weather, occ: dict, plan: dict,
             harmony_note: Optional[str]) -> List[str]:
    reasons = [f"체감 {w.feels_like:.0f}°C({plan['band']})에 맞춘 두께입니다"]
    outer = next((g for g in items if g.category == "outer"), None)
    if outer and (w.is_rainy or w.is_snowy) and outer.waterproof:
        reasons.append(f"{outer.name}은(는) 비·눈에도 강합니다")
    elif outer and w.daily_swing >= 8:
        reasons.append(f"일교차가 {w.daily_swing:.0f}°C라 {outer.name}을(를) 걸쳤다 벗기 좋습니다")
    styles = {g.style for g in items} & occ["like"]
    if styles:
        reasons.append(f"'{occ['ko']}' 자리에 어울리는 스타일입니다")
    if harmony_note:
        reasons.append(harmony_note)
    return reasons


def weather_tips(w: Weather, items: Sequence[Garment] = ()) -> List[str]:
    tips: List[str] = []
    if w.is_rainy:
        tips.append(f"강수확률 {w.rain_chance}% — 우산을 챙기세요")
    if w.is_snowy:
        tips.append("눈 소식 — 미끄럼 방지 신발을 추천합니다")
    if w.daily_swing >= 10:
        tips.append(f"일교차 {w.daily_swing:.0f}°C — 저녁엔 쌀쌀해요")
    if w.dust_level in ("나쁨", "매우 나쁨"):
        tips.append(f"미세먼지 {w.dust_level} — 마스크를 챙기세요")
    if w.temp_max >= 30:
        tips.append("무더위 — 통기성 좋은 소재와 모자를 추천합니다")
    if w.feels_like <= -5:
        tips.append("한파 — 목도리·장갑을 꼭 챙기세요")
    return tips


def grade(total: Optional[int]) -> str:
    """100점 만점 → 거울에 띄울 한 줄 등급."""
    if total is None:
        return ""
    if total >= 90:
        return "S · 완벽해요!"
    if total >= 80:
        return "A · 그대로 나가도 좋아요"
    if total >= 65:
        return "B · 한 가지만 손보면 완벽"
    if total >= 50:
        return "C · 몇 가지 바꿔 볼까요?"
    return "D · 오늘 날씨·일정엔 다른 코디를 추천해요"


def score_items(items: Sequence[Garment], w: Weather, occasion: str = "daily") -> dict:
    """옷장에서 고른 옷 조합을 100점 만점으로 채점한다(AI 없이 동작).

    항목: 날씨 30 / TPO 25 / 색·패턴 20 / 실루엣 15 / 완성도 10
    실루엣은 사진 없이는 정확히 알 수 없어서 '구성 완결성'으로 대신 채점한다.
    """
    occ = OCCASIONS.get(occasion, OCCASIONS["daily"])
    plan = layer_plan(w)
    good: List[str] = []
    fixes: List[str] = []
    body = [g for g in items if g.category in ("top", "dress")]
    bottoms = [g for g in items if g.category == "bottom"]
    outer = [g for g in items if g.category == "outer"]
    shoes = [g for g in items if g.category == "shoes"]

    # 1) 날씨 30
    weather_s = 30
    if body:
        warm = max(g.warmth for g in body)
        lo, hi = plan["top"]
        if warm < lo and not outer:
            weather_s -= 8
            fixes.append(f"체감 {w.feels_like:.0f}°C에는 상의가 얇아요. 겉옷을 걸치세요")
        elif warm > hi and plan["band"] == "더움":
            weather_s -= 8
            fixes.append("오늘은 더워요. 더 얇은 상의로 바꿔 보세요")
    if plan["need_outer"]:
        if not outer:
            weather_s -= 12
            fixes.append("아우터가 필요한 날씨예요")
        else:
            o_warm = max(g.warmth for g in outer)
            lo, hi = plan["outer"]
            if o_warm < lo:
                weather_s -= 6
                fixes.append(f"{outer[0].name}은(는) 오늘 기온엔 얇아요")
            elif o_warm > hi + 1:
                weather_s -= 4
                fixes.append(f"{outer[0].name}은(는) 오늘 기온엔 더울 수 있어요")
    elif outer and max(g.warmth for g in outer) >= 4:
        weather_s -= 8
        fixes.append("오늘은 두꺼운 아우터가 필요 없어요")
    if plan["band"] in ("추움", "한파") and any(g.warmth <= 1 for g in bottoms):
        weather_s -= 6
        fixes.append("추운 날엔 하의도 따뜻한 소재가 좋아요")
    if (w.is_rainy or w.is_snowy) and not any(g.waterproof for g in items):
        weather_s -= 8
        fixes.append("비·눈 대비가 부족해요(방수 아우터나 신발)")
    if weather_s >= 26:
        good.append(f"체감 {w.feels_like:.0f}°C 날씨에 딱 맞는 두께예요")
    weather_s = max(0, weather_s)

    # 2) TPO 25
    tpo_s = 15
    for g in items:
        if g.category in ("shoes", "accessory"):
            continue
        if g.style in occ["like"]:
            tpo_s += 4
        elif g.style in occ["avoid"]:
            tpo_s -= 7
            fixes.append(f"{g.name}은(는) '{occ['ko']}' 자리엔 어울리지 않아요")
    tpo_s = max(0, min(25, tpo_s))
    if tpo_s >= 22:
        good.append(f"'{occ['ko']}' 자리에 잘 어울려요")

    # 3) 색·패턴 20
    h, h_note = _harmony(items)
    color_s = max(0, min(20, int(16 + 4 * h)))
    if h > 0 and h_note:
        good.append(h_note)
    elif h < 0:
        fixes.append("포인트 컬러/패턴이 많아요. 하나는 무채색으로 바꿔 보세요")

    # 4) 실루엣(구성) 15
    if body and (bottoms or any(g.category == "dress" for g in body)):
        balance_s = 12
    else:
        balance_s = 5
        fixes.append("상의·하의(또는 원피스)를 모두 골라 주세요")

    # 5) 완성도 10
    finish_s = 4
    if shoes:
        finish_s += 4
        if w.is_rainy and any(g.waterproof for g in shoes):
            finish_s += 1
    else:
        fixes.append("신발까지 맞추면 완성도가 올라가요")
    if any(g.category == "accessory" for g in items):
        finish_s += 2
    finish_s = min(10, finish_s)

    scores = [
        {"key": "weather", "label": "날씨 적합도", "score": weather_s, "max": 30},
        {"key": "tpo", "label": "일정(TPO) 적합도", "score": tpo_s, "max": 25},
        {"key": "color", "label": "색·패턴 조화", "score": color_s, "max": 20},
        {"key": "balance", "label": "실루엣 밸런스", "score": balance_s, "max": 15},
        {"key": "finish", "label": "완성도(신발·소품·정돈)", "score": finish_s, "max": 10},
    ]
    total = sum(x["score"] for x in scores)
    verdict = "good" if total >= 80 else "adjust" if total >= 55 else "change"
    if fixes:
        message = f"{total}점! " + fixes[0] + "."
    else:
        message = f"{total}점! 오늘 날씨와 일정에 잘 맞는 코디예요."
    return {"total": total, "grade": grade(total), "verdict": verdict, "scores": scores,
            "good_points": good[:3], "fixes": fixes[:3], "message": message,
            "tips": weather_tips(w, items)}
