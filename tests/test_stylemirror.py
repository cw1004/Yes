# -*- coding: utf-8 -*-
"""STYLE MIRROR 테스트: python3 -m unittest discover -s tests"""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from stylemirror import stylist
from stylemirror.closet import SAMPLE_CLOSET, Closet, Garment
from stylemirror.coach import SCORE_ITEMS, Coach
from stylemirror.config import MirrorConfig
from stylemirror.server import MirrorApp, decode_data_url, make_handler
from stylemirror.weather import Weather

TINY_JPEG = ("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
             "HR8eHRocHCAkLicgIiwjHBwoNyksMDE0NDQfJzk9ODI8LjM0Mv/AAAsIAAEAAQEBEQD/xAAUAAEAAAAAAAAAAAAAAAAAAAAJ"
             "/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwBH/9k=")


def weather(feels=15.0, rain=0, cond="맑음", lo=10.0, hi=20.0):
    return Weather(city="테스트", temp=feels, feels_like=feels, temp_min=lo, temp_max=hi,
                   rain_chance=rain, condition=cond)


def sample_closet(tmp: str) -> Closet:
    c = Closet(Path(tmp) / "closet.db")
    for g in SAMPLE_CLOSET:
        c.add(Garment(**{**g.__dict__, "id": None}))
    return c


def by_name(closet: Closet, name: str) -> Garment:
    return next(g for g in closet.all() if g.name == name)


class TestCloset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.closet = sample_closet(self.tmp.name)

    def tearDown(self):
        self.closet.close()
        self.tmp.cleanup()

    def test_crud(self):
        g = self.closet.add(Garment("레드 스카프", "accessory", "레드", owner="엄마"))
        self.assertEqual(self.closet.get(g.id).name, "레드 스카프")
        self.assertEqual(self.closet.update(g.id, warmth=9).warmth, 5)  # 1~5 로 보정
        self.assertIn("엄마", self.closet.owners())
        # 주인 필터: 엄마 옷 + 공용 옷
        self.assertEqual(len(self.closet.all(owner="엄마")), len(SAMPLE_CLOSET) + 1)
        self.assertEqual(len(self.closet.all(owner="아빠")), len(SAMPLE_CLOSET))
        self.assertTrue(self.closet.delete(g.id))
        self.assertIsNone(self.closet.get(g.id))

    def test_bad_category(self):
        with self.assertRaises(ValueError):
            Garment("모자", "hat")

    def test_wear_log_and_scores(self):
        self.closet.mark_worn([1, 1, 2])
        self.assertEqual(self.closet.recently_worn(3), {1: 2, 2: 1})
        self.closet.log_score(88, "아빠", "office", "ai", "좋아요")
        self.closet.log_score(70, "엄마")
        self.assertEqual([h["total"] for h in self.closet.score_history("아빠")], [88])
        self.assertEqual(len(self.closet.score_history()), 2)


class TestStylist(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.closet = sample_closet(self.tmp.name)
        self.items = self.closet.all()

    def tearDown(self):
        self.closet.close()
        self.tmp.cleanup()

    def test_guess_occasion(self):
        self.assertEqual(stylist.guess_occasion("오늘 결혼식 가는데 뭐 입지?"), "wedding")
        self.assertEqual(stylist.guess_occasion("내일 면접이야"), "meeting")
        self.assertEqual(stylist.guess_occasion("그냥 나가"), "daily")

    def test_hot_day_no_outer(self):
        best = stylist.recommend(self.items, weather(28, lo=24, hi=31))[0]
        self.assertFalse(any(g.category == "outer" for g in best.items))
        self.assertTrue(all(g.warmth <= 2 for g in best.items if g.category in ("top", "dress")))

    def test_cold_day_warm_outer(self):
        best = stylist.recommend(self.items, weather(-6, lo=-10, hi=-2))[0]
        outer = [g for g in best.items if g.category == "outer"]
        self.assertTrue(outer and outer[0].warmth >= 4)

    def test_rain_prefers_waterproof(self):
        best = stylist.recommend(self.items, weather(14, rain=80, cond="비"))[0]
        self.assertTrue(any(g.waterproof for g in best.items))

    def test_meeting_avoids_casual(self):
        best = stylist.recommend(self.items, weather(18, lo=15, hi=21), "meeting")[0]
        self.assertTrue(all(g.style not in ("sporty", "street") for g in best.items))

    def test_recently_worn_rotates(self):
        w = weather(15)
        first = stylist.recommend(self.items, w, "office")[0]
        recent = {g.id: 3 for g in first.items if g.category in ("top", "bottom")}
        second = stylist.recommend(self.items, w, "office", recent)[0]
        self.assertNotEqual({g.id for g in first.items}, {g.id for g in second.items})

    def test_score_good_vs_bad(self):
        w = weather(8, lo=4, hi=12)
        good = [by_name(self.closet, n) for n in ("네이비 니트", "네이비 슬랙스", "차콜 울 코트", "블랙 로퍼")]
        bad = [by_name(self.closet, n) for n in ("블랙 반팔 티셔츠", "카키 반바지")]
        g, b = stylist.score_items(good, w, "office"), stylist.score_items(bad, w, "office")
        self.assertGreaterEqual(g["total"], 80)
        self.assertLess(b["total"], 60)
        self.assertTrue(b["fixes"])
        self.assertEqual(sum(s["max"] for s in g["scores"]), 100)
        for s in g["scores"] + b["scores"]:
            self.assertTrue(0 <= s["score"] <= s["max"])

    def test_grade(self):
        self.assertTrue(stylist.grade(95).startswith("S"))
        self.assertTrue(stylist.grade(40).startswith("D"))


class FakeClient:
    """Claude 응답을 흉내내는 가짜 클라이언트 (API 비용 없이 AI 경로 검증)."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason="end_turn",
                               content=[SimpleNamespace(type="text", text=json.dumps(self.payload))])


class TestCoach(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = MirrorConfig(data_dir=Path(self.tmp.name), use_ai=False)
        self.closet = sample_closet(self.tmp.name)
        self.coach = Coach(self.cfg, self.closet)

    def tearDown(self):
        self.closet.close()
        self.tmp.cleanup()

    def test_offline_photo_needs_ai(self):
        r = self.coach.evaluate_look(b"x", weather())
        self.assertIsNone(r["total"])
        self.assertIn("AI", r["message"])

    def test_offline_score_by_ids(self):
        r = self.coach.evaluate_look(None, weather(15), worn_ids=[4, 9])
        self.assertEqual(r["source"], "rules")
        self.assertIsInstance(r["total"], int)
        self.assertTrue(any(g["category"] == "outer" for g in r["suggestions"]))

    def test_ai_score_is_clamped_and_ids_checked(self):
        fake = FakeClient({
            "visible": True, "verdict": "adjust", "seen_items": ["흰 셔츠", "청바지"],
            "scores": {"weather": 99, "tpo": 20, "color": 18, "balance": 12, "finish": -3},
            "good_points": ["색 조합이 깔끔해요"], "fixes": ["트렌치코트를 걸치세요"],
            "message": "좋아요! 겉옷만 추가하세요.", "suggest_ids": [11, 999],
        })
        self.coach._client = fake
        r = self.coach.evaluate_look(b"img", weather(), "office")
        self.assertEqual(r["source"], "ai")
        self.assertEqual(r["total"], 30 + 20 + 18 + 12 + 0)  # 항목별 상한·하한 보정
        self.assertEqual([g["id"] for g in r["suggestions"]], [11])  # 없는 옷(#999)은 제외
        req = fake.calls[0]
        self.assertEqual(req["model"], "claude-opus-5-5")
        self.assertEqual(req["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(set(req["output_config"]["format"]["schema"]["properties"]["scores"]["required"]),
                         {k for k, _, _ in SCORE_ITEMS})
        self.assertEqual(req["messages"][0]["content"][0]["type"], "image")

    def test_ai_not_visible(self):
        self.coach._client = FakeClient({
            "visible": False, "verdict": "change", "seen_items": [],
            "scores": {k: 0 for k, _, _ in SCORE_ITEMS}, "good_points": [], "fixes": [],
            "message": "", "suggest_ids": []})
        r = self.coach.evaluate_look(b"img", weather())
        self.assertIsNone(r["total"])
        self.assertIn("물러서", r["message"])

    def test_ai_failure_falls_back(self):
        def boom(**kw):
            raise ConnectionError("offline")
        self.coach._client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=boom)))
        r = self.coach.evaluate_look(b"img", weather(), worn_ids=[1, 6])
        self.assertEqual(r["source"], "rules")
        self.assertIsInstance(r["total"], int)

    def test_ai_recommend_picks_candidate(self):
        self.coach._client = FakeClient({"choice": 1, "message": "두 번째가 좋아요"})
        r = self.coach.recommend(weather(), request="회사 출근")
        self.assertEqual((r["occasion"], r["choice"], r["source"]), ("office", 1, "ai"))


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cfg = MirrorConfig(data_dir=Path(cls.tmp.name), use_ai=False, port=0)
        cls.app = MirrorApp(cfg)
        cls.app._weather, cls.app._weather_at = weather(15), 1e18  # 네트워크 없이
        for g in SAMPLE_CLOSET[:8]:
            cls.app.closet.add(Garment(**{**g.__dict__, "id": None}))
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.app))
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.app.closet.close()
        cls.tmp.cleanup()

    def call(self, path, body=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_page_and_status(self):
        with urllib.request.urlopen(self.base + "/") as r:
            self.assertIn("STYLE MIRROR", r.read().decode())
        status, data = self.call("/api/status")
        self.assertEqual(status, 200)
        self.assertFalse(data["ai"])
        self.assertIn("wedding", data["occasions"])

    def test_score_and_history(self):
        status, r = self.call("/api/score", {"worn_ids": [1, 6], "occasion": "office", "owner": "아빠"})
        self.assertEqual(status, 200)
        self.assertIsInstance(r["total"], int)
        _, h = self.call("/api/history?owner=" + urllib.parse.quote("아빠"))
        self.assertEqual(h["history"][0]["total"], r["total"])

    def test_add_with_photo_and_delete(self):
        status, r = self.call("/api/closet", {"name": "테스트 셔츠", "category": "top", "image": TINY_JPEG})
        self.assertEqual(status, 201)
        photo = r["item"]["photo"]
        with urllib.request.urlopen(f"{self.base}/photos/{photo}") as resp:
            self.assertEqual(resp.headers["Content-Type"], "image/jpeg")
        _, d = self.call(f"/api/closet/{r['item']['id']}", method="DELETE")
        self.assertTrue(d["ok"])
        self.assertFalse((self.app.cfg.photo_dir / photo).exists())

    def test_bad_input(self):
        self.assertEqual(self.call("/api/closet", {"name": "x", "category": "hat"})[0], 400)
        self.assertEqual(self.call("/api/score", {"image": "not-an-image"})[0], 400)
        self.assertEqual(self.call("/photos/../closet.db")[0], 404)

    def test_decode_data_url(self):
        img, mtype = decode_data_url(TINY_JPEG)
        self.assertEqual(mtype, "image/jpeg")
        self.assertTrue(img.startswith(b"\xff\xd8"))


if __name__ == "__main__":
    unittest.main()
