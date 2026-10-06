# -*- coding: utf-8 -*-
"""뷰티 위탁 셀러 도구 테스트: python3 -m unittest discover -s tests"""

import unittest
from pathlib import Path

from beauty_seller.economics import UnitEconomics, funnel
from beauty_seller.orders import convert, load_mapping, read_csv
from beauty_seller.quiz import QuizError, classify, score
from beauty_seller.recommend import build_routine, load_catalog

DATA = Path(__file__).resolve().parent.parent / "beauty_seller" / "data"
BASE = {"adult": "예", "tightness": "없음", "shine": "없음", "redness": "없음",
        "reaction": "없음", "concern": "dryness", "budget": "mid", "steps": "basic"}


class TestQuiz(unittest.TestCase):
    def test_classify(self):
        self.assertEqual(classify(2, 0), "dry")
        self.assertEqual(classify(0, 2), "oily")
        self.assertEqual(classify(1, 2), "combination")
        self.assertEqual(classify(1, 1), "combination")
        self.assertEqual(classify(0, 1), "normal")
        self.assertEqual(classify(0, 0), "normal")

    def test_sensitive_flag(self):
        self.assertTrue(score({**BASE, "redness": "조금", "reaction": "조금"}).sensitive)
        self.assertFalse(score({**BASE, "redness": "조금"}).sensitive)

    def test_minor_blocked(self):
        with self.assertRaises(QuizError):
            score({**BASE, "adult": "아니오"})

    def test_bad_answer(self):
        with self.assertRaises(QuizError):
            score({**BASE, "concern": "wrinkle"})


class TestRecommend(unittest.TestCase):
    catalog = load_catalog(DATA / "catalog.example.csv")

    def test_steps_and_slots(self):
        r = build_routine(score({**BASE, "steps": "full"}), self.catalog)
        self.assertEqual([p.slot for p in r.items],
                         ["cleanser", "toner", "serum", "moisturizer", "sunscreen"])
        self.assertEqual(r.missing, [])

    def test_sensitive_excludes_harsh_products(self):
        pf = score({**BASE, "shine": "많이", "redness": "많이", "concern": "pore"})
        r = build_routine(pf, self.catalog)
        self.assertTrue(all(p.sensitive_ok for p in r.items))

    def test_set_price_ends_with_900_and_below_list(self):
        r = build_routine(score(BASE), self.catalog)
        self.assertEqual(r.set_price % 1000, 900)
        self.assertLess(r.set_price, r.list_price)


class TestEconomics(unittest.TestCase):
    def test_profit(self):
        ue = UnitEconomics(50000, 30000, 0.06, shipping_cost=3000, other_cost=0, ad_cost=2000)
        self.assertEqual(ue.profit, 50000 - 30000 - 3000 - 3000 - 2000)
        self.assertEqual(ue.max_ad_cost, ue.profit + 2000)
        self.assertEqual(ue.orders_for(ue.profit * 10), 10)

    def test_loss_needs_infinite_orders(self):
        self.assertEqual(UnitEconomics(10000, 12000, 0.06).orders_for(1), float("inf"))

    def test_funnel(self):
        self.assertEqual(funnel(30, 0.03), 1000)


class TestOrders(unittest.TestCase):
    def test_sample_conversion(self):
        ok, bad = convert(read_csv(DATA / "sample_orders.csv"),
                          load_mapping(DATA / "order_mapping.example.json"))
        self.assertEqual(len(ok), 5)                     # 세트 4행 + 단품 1행
        self.assertEqual(ok[4]["주문수량"], "2")
        self.assertEqual(ok[4]["배송메시지"], "안전배송 부탁드립니다.")
        self.assertEqual([b["주문번호"] for b in bad], ["T-0003"])


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------- 시뮬레이션
import random

from beauty_seller.orders import FORMULA_PREFIX
from beauty_seller.simulate import (FIXED, UNCERTAIN, Strategy, ad_breakeven_cpq, evaluate,
                                    load_overrides, optimize, run, sample_scenarios)


def _flat_scenario(**kw):
    """잡음·재구매·환불·제휴 수익을 끈 단순 시나리오 (손계산 대조용)."""
    sc = {k: lo for k, (lo, hi, kind) in UNCERTAIN.items()}
    sc.update(organic_m1=1000, organic_growth=1.0, organic_cap=10**9, base_cr=0.03, elasticity=2.0,
              supply_ratio=0.5, refund_rate=0.0, repurchase_base=0.0, affiliate_per_nonbuyer=0,
              noise=[1.0] * FIXED["months"])
    sc.update(kw)
    return sc


class TestSimulation(unittest.TestCase):
    def test_matches_hand_calculation(self):
        f = FIXED
        r = run(Strategy(discount=0.0, mode="bulk"), _flat_scenario())
        unit = f["list_price"] * (1 - f["fee_rate"]) - f["list_price"] * 0.5 - f["shipping"] - f["other"]
        orders = 1000 * 0.03
        err = orders * MODES_ERR * (f["list_price"] * 0.5 + f["shipping"])
        expect = f["months"] * (orders * unit - err - f["fixed_monthly"]) - f["startup_cost"]
        self.assertAlmostEqual(r["profit"], expect, places=3)
        self.assertAlmostEqual(r["orders"], orders * f["months"], places=6)

    def test_unit_profit_matches_margin_calculator(self):
        f = FIXED
        price = f["list_price"]
        ue = UnitEconomics(price, round(price * 0.5), f["fee_rate"], f["shipping"], f["other"])
        unit = price * (1 - f["fee_rate"]) - price * 0.5 - f["shipping"] - f["other"]
        self.assertLessEqual(abs(ue.profit - unit), 1)  # 반올림 차이만 허용

    def test_monotonic(self):
        sc = sample_scenarios(50, 1)
        st = Strategy()
        lo = evaluate(st, [{**s, "base_cr": 0.02} for s in sc])["mean_profit"]
        hi = evaluate(st, [{**s, "base_cr": 0.04} for s in sc])["mean_profit"]
        self.assertGreater(hi, lo)
        bulk = evaluate(Strategy(mode="bulk"), sc)["mean_adj"]
        agent = evaluate(Strategy(mode="agent"), sc)["mean_adj"]
        self.assertGreater(bulk, agent)
        with_ads = evaluate(Strategy(ad_budget=600_000), [{**s, "cpq": 10**9} for s in sc])
        no_ads = evaluate(Strategy(), sc)
        self.assertAlmostEqual(no_ads["mean_profit"] - with_ads["mean_profit"],
                               600_000 * FIXED["months"], delta=100)  # 효과 없는 광고 = 광고비만큼 손해

    def test_repurchase_adds_orders(self):
        sc = _flat_scenario(repurchase_base=0.1)
        self.assertGreater(run(Strategy(), sc)["orders"], run(Strategy(), _flat_scenario())["orders"])

    def test_deterministic_and_holdout(self):
        a = optimize(20, seed=3, strategies=[Strategy(), Strategy(mode="bulk")])
        b = optimize(20, seed=3, strategies=[Strategy(), Strategy(mode="bulk")])
        self.assertEqual([x[1]["mean_adj"] for x in a[0]], [x[1]["mean_adj"] for x in b[0]])
        self.assertEqual(a[0][0][0].mode, "bulk")
        self.assertIn("mean_adj", a[2])

    def test_ad_breakeven_positive(self):
        self.assertGreater(ad_breakeven_cpq(Strategy(), sample_scenarios(20, 2)), 0)

    def test_overrides_validation(self):
        import json, tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as t:
            json.dump({"uncertain": {"base_cr": [0.05, 0.01]}}, t)
        with self.assertRaises(ValueError):
            load_overrides(t.name)


from beauty_seller.simulate import MODES
MODES_ERR = MODES["bulk"][0]


class TestOrdersFuzz(unittest.TestCase):
    """무작위로 망가뜨린 주문 1,000건: 예외 없이, 한 주문은 정확히 한 번만, 수식은 무력화."""

    def test_fuzz(self):
        rng = random.Random(42)
        mapping = load_mapping(DATA / "order_mapping.example.json")
        products = list(mapping["product_map"]) + ["없는 상품"]
        rows = []
        for i in range(1000):
            prod = rng.choice(products)
            name, opt = (prod.split(" / ") + [""])[:2]
            rows.append({
                "상품주문번호": rng.choice([f"N{i}", f"N{rng.randrange(i + 1)}", ""]),
                "상품명": name, "옵션정보": opt,
                "수량": rng.choice(["1", "2", "0", "-1", "a", "", "3"]),
                "수취인명": rng.choice(["홍길동", "", "=1+1", "@SUM(A1)", "-2"]),
                "수취인연락처1": rng.choice(["010-1234-5678", "01012345678", "010 1234 5678",
                                       "+82 10-1234-5678", "02-123-4567", "123", ""]),
                "우편번호": rng.choice(["04524", "4524", "123", "", "abcde"]),
                "통합배송지": rng.choice(["서울시", "", "=cmd"]),
                "배송메세지": rng.choice(["", "문앞", "+보관"]),
            })
        ok, bad = convert(rows, mapping, already_ordered={"N0"})
        ordered = {r["참조주문번호"] for r in ok}
        self.assertNotIn("N0", ordered)
        self.assertNotIn("", ordered)
        # 같은 주문번호가 두 번 발주되지 않음: 주문번호별 행 수 = 그 주문 한 건의 구성품 수
        pmap = mapping["product_map"]
        for oid in ordered:
            sizes = set()
            for r in rows:
                if r["상품주문번호"] == oid:
                    key = r["상품명"] + (f" / {r['옵션정보']}" if r["옵션정보"] else "")
                    comps = pmap.get(key) or pmap.get(r["상품명"])
                    if comps:
                        sizes.add(len(comps))
            self.assertIn(sum(1 for x in ok if x["참조주문번호"] == oid), sizes)
        for r in ok:
            for v in r.values():
                self.assertFalse(v.startswith(FORMULA_PREFIX), v)
            self.assertRegex(r["우편번호"], r"^\d{5}$")
            self.assertGreaterEqual(int(r["주문수량"]), 1)
        # 모든 입력 행이 '발주 1회' 또는 '오류'로 정확히 한 번 설명됨
        self.assertEqual(len(rows), len(bad) + len(ordered))
