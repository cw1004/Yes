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
