# -*- coding: utf-8 -*-
"""사진 없이 설문만으로 피부 타입을 추정한다.

얼굴 사진은 개인정보(민감정보 해석 여지)·외부 API 약관·국외이전 문제가 있어
MVP 단계에서는 받지 않는다. 결과는 '진단'이 아니라 '피부 타입 참고 정보'다.
"""

from dataclasses import dataclass

LEVEL = {"많이": 2, "조금": 1, "없음": 0}
CONCERNS = {
    "trouble": "트러블",
    "pore": "모공·피지",
    "dryness": "건조·당김",
    "dullness": "칙칙함",
    "firmness": "탄력",
}
BUDGETS = {"low": "3만원 이하", "mid": "3~6만원", "high": "6만원 이상"}
STEPS = {
    "simple": ["cleanser", "moisturizer", "sunscreen"],
    "basic": ["cleanser", "serum", "moisturizer", "sunscreen"],
    "full": ["cleanser", "toner", "serum", "moisturizer", "sunscreen"],
}
SKIN_LABEL = {"dry": "건성", "oily": "지성", "combination": "복합성", "normal": "중성"}

# (key, 질문, 선택지) — 대화형 quiz 와 카카오톡/구글폼 문항에 그대로 사용
QUESTIONS = [
    ("adult", "만 14세 이상인가요?", ["예", "아니오"]),
    ("tightness", "세안 후 아무것도 바르지 않고 30분 지나면 얼굴이 당기나요?", list(LEVEL)),
    ("shine", "오후가 되면 이마·코(T존)가 번들거리나요?", list(LEVEL)),
    ("redness", "온도 변화나 세안 후 얼굴이 쉽게 붉어지나요?", list(LEVEL)),
    ("reaction", "새 화장품을 쓰면 따갑거나 트러블이 올라오나요?", list(LEVEL)),
    ("concern", "가장 신경 쓰이는 고민 하나를 골라주세요.", list(CONCERNS)),
    ("budget", "루틴 전체 예산은?", list(BUDGETS)),
    ("steps", "원하는 단계 수는? (simple=3, basic=4, full=5)", list(STEPS)),
]


class QuizError(ValueError):
    pass


@dataclass
class Profile:
    skin_type: str
    sensitive: bool
    concern: str
    budget: str
    steps: str

    @property
    def label(self):
        s = SKIN_LABEL[self.skin_type]
        return f"{s}·민감" if self.sensitive else s


def _level(answers, key):
    v = answers.get(key)
    if isinstance(v, int) and 0 <= v <= 2:
        return v
    if v in LEVEL:
        return LEVEL[v]
    raise QuizError(f"'{key}' 답변이 올바르지 않습니다: {v!r} (많이/조금/없음 또는 0~2)")


def classify(tightness, shine):
    """당김(건조)·번들거림(유분) 점수 0~2 로 피부 타입을 고른다."""
    if shine >= 2:
        return "combination" if tightness >= 1 else "oily"
    if tightness >= 1:
        return "combination" if shine == 1 else "dry"
    return "normal"


def score(answers):
    if answers.get("adult") not in ("예", "yes", True):
        raise QuizError("만 14세 미만은 법정대리인 동의 절차 없이 상담·판매를 진행하지 않습니다.")
    tight, shine = _level(answers, "tightness"), _level(answers, "shine")
    sensitive = _level(answers, "redness") + _level(answers, "reaction") >= 2
    concern, budget, steps = answers.get("concern"), answers.get("budget", "mid"), answers.get("steps", "basic")
    if concern not in CONCERNS:
        raise QuizError(f"concern 은 {list(CONCERNS)} 중 하나여야 합니다: {concern!r}")
    if budget not in BUDGETS:
        raise QuizError(f"budget 은 {list(BUDGETS)} 중 하나여야 합니다: {budget!r}")
    if steps not in STEPS:
        raise QuizError(f"steps 는 {list(STEPS)} 중 하나여야 합니다: {steps!r}")
    return Profile(classify(tight, shine), sensitive, concern, budget, steps)
