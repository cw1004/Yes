# -*- coding: utf-8 -*-
"""주문 1건당 손익과 월 목표 역산. 수수료율 등 기본값은 '가정치'이므로 판매자센터에서 확인 후 덮어쓸 것."""

import math
from dataclasses import dataclass

# 가정치(2026-10 기준 확인 필요): 채널별 수수료 합계 비율
CHANNEL_FEE = {"smartstore": 0.06, "coupang": 0.11, "own": 0.035}


@dataclass
class UnitEconomics:
    sale_price: int
    supply_cost: int
    fee_rate: float
    shipping_cost: int = 3000   # 무료배송 시 셀러가 공급사에 내는 배송비(묶음 1회)
    other_cost: int = 300       # 사은품·샘플·CS 등
    ad_cost: int = 0            # 주문 1건당 광고비(CPA)

    @property
    def fee(self):
        return round(self.sale_price * self.fee_rate)

    @property
    def profit(self):
        return (self.sale_price - self.supply_cost - self.fee
                - self.shipping_cost - self.other_cost - self.ad_cost)

    @property
    def margin_rate(self):
        return self.profit / self.sale_price if self.sale_price else 0.0

    @property
    def max_ad_cost(self):
        """광고비를 이 금액보다 쓰면 적자(손익분기 CPA)."""
        return self.profit + self.ad_cost

    def orders_for(self, monthly_target):
        if self.profit <= 0:
            return math.inf
        return math.ceil(monthly_target / self.profit)


def funnel(orders, conversion_rate):
    """목표 주문 수를 맞추려면 설문 완료가 몇 건 필요한지."""
    return math.ceil(orders / conversion_rate)


def report(ue, monthly_target=3_000_000, conversion_rate=0.03):
    n = ue.orders_for(monthly_target)
    rows = [
        ("판매가", ue.sale_price), ("공급가 합계", -ue.supply_cost),
        (f"채널 수수료({ue.fee_rate:.1%})", -ue.fee), ("배송비", -ue.shipping_cost),
        ("기타", -ue.other_cost), ("광고비/건", -ue.ad_cost), ("순이익/건", ue.profit),
    ]
    out = [f"{k:<16}{v:>10,}원" for k, v in rows]
    out.append(f"{'순이익률':<16}{ue.margin_rate:>10.1%}")
    out.append(f"{'손익분기 광고비':<14}{ue.max_ad_cost:>10,}원/건")
    if math.isinf(n):
        out.append("→ 건당 적자: 가격·공급가·광고비를 먼저 조정하세요.")
    else:
        out.append(f"→ 월 순이익 {monthly_target:,}원: 월 {n:,}건(하루 약 {math.ceil(n / 30)}건), "
                   f"전환율 {conversion_rate:.0%} 가정 시 설문 완료 월 {funnel(n, conversion_rate):,}건 필요")
    return "\n".join(out)
