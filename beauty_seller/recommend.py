# -*- coding: utf-8 -*-
"""피부 프로필 + 상품 카탈로그 → 단일 공급사 루틴 세트."""

import csv
from dataclasses import dataclass
from pathlib import Path

from .quiz import CONCERNS, STEPS, Profile

SLOT_LABEL = {"cleanser": "클렌저", "toner": "토너", "serum": "세럼",
              "moisturizer": "보습크림", "sunscreen": "선크림"}
TIER_RANK = {"low": 0, "mid": 1, "high": 2}
DISCLAIMER = ("※ 설문 기반 피부 타입 참고 정보이며 의학적 진단이 아닙니다. "
              "새 제품은 귀 뒤·팔 안쪽에 하루 패치테스트 후 사용하시고, "
              "피부 질환이 의심되면 피부과 전문의와 상담하세요.")


@dataclass
class Product:
    sku: str
    slot: str
    name: str
    supplier: str
    supplier_code: str
    skin_types: set
    concerns: set
    sensitive_ok: bool
    tier: str
    supply_price: int
    sale_price: int
    affiliate_url: str = ""

    @property
    def margin(self):
        return self.sale_price - self.supply_price


def load_catalog(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [Product(
            sku=r["sku"], slot=r["slot"], name=r["name"], supplier=r["supplier"],
            supplier_code=r["supplier_code"],
            skin_types=set(r["skin_types"].split("|")),
            concerns=set(filter(None, r["concerns"].split("|"))),
            sensitive_ok=r["sensitive_ok"].strip().upper() == "Y",
            tier=r["tier"], supply_price=int(r["supply_price"]),
            sale_price=int(r["sale_price"]), affiliate_url=r.get("affiliate_url", ""),
        ) for r in csv.DictReader(f)]


def _score(p, profile):
    s = 0
    s += 2 if profile.skin_type in p.skin_types else 0
    s += 2 if profile.concern in p.concerns else 0
    s -= abs(TIER_RANK[p.tier] - TIER_RANK[profile.budget])
    return (s, p.margin)  # 동점이면 마진 높은 상품


def _eligible(p, profile):
    if profile.skin_type not in p.skin_types and "all" not in p.skin_types:
        return False
    return p.sensitive_ok or not profile.sensitive


@dataclass
class Routine:
    profile: Profile
    items: list
    missing: list
    supplier: str
    bundle_discount: float

    @property
    def list_price(self):
        return sum(p.sale_price for p in self.items)

    @property
    def set_price(self):
        # 1,000원 단위 내림 후 100원 빼서 끝자리 900 (예: 52,430 → 51,900)
        raw = int(self.list_price * (1 - self.bundle_discount))
        return max(raw // 1000 * 1000 - 100, 0)

    @property
    def supply_cost(self):
        return sum(p.supply_price for p in self.items)


def build_routine(profile, catalog, bundle_discount=0.1):
    """묶음배송이 되도록 공급사 하나에서만 고른다. 빠진 단계가 가장 적은 공급사를 선택."""
    best = None
    for supplier in sorted({p.supplier for p in catalog}):
        items, missing = [], []
        for slot in STEPS[profile.steps]:
            cands = [p for p in catalog if p.supplier == supplier and p.slot == slot
                     and _eligible(p, profile)]
            if cands:
                items.append(max(cands, key=lambda p: _score(p, profile)))
            else:
                missing.append(slot)
        cand = Routine(profile, items, missing, supplier, bundle_discount)
        if best is None or (len(cand.missing), -cand.list_price) < (len(best.missing), -best.list_price):
            best = cand
    if best is None:
        raise ValueError("카탈로그가 비어 있습니다.")
    return best


def render_message(routine, store_url="[스마트스토어 세트 상품 링크]"):
    pf = routine.profile
    lines = [
        f"피부 타입 체크 결과: {pf.label} 타입 / 주요 고민: {CONCERNS[pf.concern]}",
        "",
        "추천 루틴 (아침·저녁 순서대로)",
    ]
    for i, p in enumerate(routine.items, 1):
        lines.append(f"{i}. {SLOT_LABEL[p.slot]} — {p.name}")
    if pf.sensitive:
        lines.append("· 자극에 예민한 편으로 응답하셔서 무향·저자극 제품 위주로 골랐어요.")
    if routine.missing:
        lines.append("· 조건에 맞는 상품이 없어 빠진 단계: "
                     + ", ".join(SLOT_LABEL[s] for s in routine.missing))
    lines += [
        "",
        f"개별 구매가 {routine.list_price:,}원 → 루틴 세트 {routine.set_price:,}원",
        f"세트 구매: {store_url}",
        "",
        DISCLAIMER,
    ]
    return "\n".join(lines)
