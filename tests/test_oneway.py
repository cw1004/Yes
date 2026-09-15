# -*- coding: utf-8 -*-
"""하나의 길 무결성 테스트: python3 -m unittest discover -s tests"""

import tempfile
import unittest
from datetime import date
from pathlib import Path

from oneway.config import Config
from oneway.content import daily, entries, fifty, pages, verses
from oneway.counselor import safety, topics
from oneway.counselor.engine import Counselor
from oneway.counselor.session import Store, Visitor, valid_id
from oneway.seo import all_urls, robots_txt, sitemap_xml
from oneway.web import render


class TestVerses(unittest.TestCase):
    def test_keys_unique(self):
        keys = [v.key for v in verses.VERSES]
        self.assertEqual(len(keys), len(set(keys)))

    def test_both_notations(self):
        v = verses.get("rest")
        self.assertEqual(v.ref, "마태 11,28-30")
        self.assertEqual(v.ref_protestant, "마태복음 11:28-30")

    def test_no_translation_text(self):
        """번역본 문장을 그대로 싣지 않는다 — 저작권 원칙."""
        for v in verses.VERSES:
            self.assertTrue(v.gist.endswith("니다.") or v.gist.endswith("다."),
                            f"{v.key}: 풀어 쓴 설명이어야 합니다")
            self.assertNotIn('"', v.gist)


class TestFifty(unittest.TestCase):
    def test_exactly_50(self):
        self.assertEqual(len(fifty.BELIEFS), 50)
        self.assertEqual(sorted(b.no for b in fifty.BELIEFS), list(range(1, 51)))

    def test_slugs_unique_and_urlsafe(self):
        slugs = [b.slug for b in fifty.BELIEFS]
        self.assertEqual(len(slugs), len(set(slugs)))
        for s in slugs:
            self.assertRegex(s, r"^[a-z0-9\-]+$")

    def test_every_field_filled(self):
        for b in fifty.BELIEFS:
            for name in ("title", "seo_title", "description", "question",
                         "prayer", "practice"):
                self.assertTrue(getattr(b, name).strip(), f"{b.no}.{name} 비어 있음")
            self.assertTrue(b.body and b.keywords and b.verses)

    def test_verse_keys_exist(self):
        for b in fifty.BELIEFS:
            for k in b.verses:
                verses.get(k)          # 없으면 KeyError

    def test_groups_cover_all(self):
        covered = set()
        for g in fifty.GROUPS:
            covered |= set(range(g.first, g.last + 1))
        self.assertEqual(covered, set(range(1, 51)))

    def test_search(self):
        self.assertTrue(fifty.search("용서"))
        self.assertEqual(fifty.search(""), [])


class TestEntries(unittest.TestCase):
    def test_seven_gates(self):
        self.assertEqual(len(entries.ENTRIES), 7)

    def test_beliefs_and_topics_valid(self):
        for e in entries.ENTRIES:
            self.assertTrue(e.asks, f"{e.slug}: 상담 연결 질문이 없습니다")
            for n in e.beliefs:
                fifty.get(n)
            for t in e.topics:
                self.assertIn(t, set(topics.BY_KEY), f"{e.slug}: 없는 주제 {t}")

    def test_unknown_gate(self):
        with self.assertRaises(KeyError):
            entries.get("nope")


class TestDaily(unittest.TestCase):
    def test_deterministic(self):
        a = daily.build(date(2026, 9, 15))
        b = daily.build(date(2026, 9, 15))
        self.assertEqual(a.to_dict(), b.to_dict())

    def test_cycles_do_not_align(self):
        """50일·30일 두 바퀴가 겹쳐 150일 동안 같은 조합이 안 나온다."""
        seen = set()
        for d in daily.range_days(date(2026, 1, 1), 150):
            seen.add((d.belief_no, d.love))
        self.assertEqual(len(seen), 150)

    def test_teaser_points_to_tomorrow(self):
        today = daily.build(date(2026, 9, 15))
        tomorrow = daily.build(date(2026, 9, 16))
        self.assertIn(tomorrow.belief_title, today.tomorrow_teaser)

    def test_thirty_practices(self):
        self.assertEqual(len(daily.LOVE_30), 30)
        self.assertEqual(len(set(daily.LOVE_30)), 30)


class TestSafety(unittest.TestCase):
    def test_crisis_detected(self):
        for t in ("죽고 싶습니다", "자살 생각이 납니다", "유서를 썼어요",
                  "다 그만두고 목숨을 끊고 싶어요"):
            self.assertEqual(safety.assess(t).level, "crisis", t)

    def test_idioms_not_flagged(self):
        """'힘들어 죽겠다'를 위기로 오인하면 신뢰를 잃는다."""
        for t in ("배고파 죽겠어요", "힘들어 죽겠다ㅋㅋ", "피곤해 죽겠네",
                  "죽도록 일만 했습니다"):
            self.assertEqual(safety.assess(t).level, "none", t)

    def test_watch_and_abuse(self):
        self.assertEqual(safety.assess("사라지고 싶어요").level, "watch")
        self.assertEqual(safety.assess("남편이 때려요").level, "abuse")
        self.assertTrue(safety.assess("남편이 때려요").urgent)

    def test_empty(self):
        self.assertEqual(safety.assess("").level, "none")

    def test_hotlines_present(self):
        lines = safety.hotline_lines()
        self.assertTrue(any("109" in x for x in lines))
        self.assertTrue(any("1577-0199" in x for x in lines))


class TestTopics(unittest.TestCase):
    def test_references_valid(self):
        for t in topics.TOPICS:
            for k in t.verses:
                verses.get(k)
            for n in t.beliefs:
                fifty.get(n)
            entries.get(t.gate)
            self.assertTrue(t.empathy and t.insight and t.questions and t.steps)

    def test_classification(self):
        cases = {
            "요즘 너무 지치고 힘들어요": ("지침", "우울"),
            "남편이랑 매일 싸웁니다": ("가족",),
            "기도해도 응답이 없습니다": ("응답없음",),
            "가톨릭이랑 개신교 차이가 뭔가요": ("교파",),
            "교회에서 상처받았습니다": ("교회상처",),
            "용서가 안 됩니다": ("용서",),
            "성경을 어디서부터 읽어야 하나요": ("성경",),
        }
        for text, expected in cases.items():
            self.assertIn(topics.best(text).key, expected, text)

    def test_fallback(self):
        self.assertEqual(topics.best("ㅁㄴㅇㄹ").key, topics.DEFAULT_KEY)


class TestSession(unittest.TestCase):
    def setUp(self):
        self.store = Store(Path(tempfile.mkdtemp()))

    def test_streak(self):
        v = self.store.get_or_create(None, today=date(2026, 1, 1))
        self.assertEqual(v.streak, 1)
        v.touch(date(2026, 1, 2))
        self.assertEqual(v.streak, 2)
        v.touch(date(2026, 1, 2))          # 같은 날 두 번 와도 1회
        self.assertEqual((v.streak, v.visit_count), (2, 2))
        v.touch(date(2026, 1, 10))         # 끊기면 다시 1
        self.assertEqual(v.streak, 1)

    def test_roundtrip(self):
        v = self.store.get_or_create(None)
        v.add_turn("user", "안녕하세요", "입문")
        v.add_intention("아버지 수술")
        v.mark_read(21)
        v.mark_practice()
        self.store.save(v)
        again = self.store.load(v.id)
        self.assertEqual(again.read_beliefs, [21])
        self.assertEqual(again.open_intention().text, "아버지 수술")
        self.assertEqual(again.progress()["practices_done"], 1)

    def test_id_validation(self):
        self.assertFalse(valid_id("../../etc/passwd"))
        self.assertFalse(valid_id(None))
        self.assertIsNone(self.store.load("nope"))
        self.assertTrue(valid_id(self.store.get_or_create(None).id))

    def test_purge(self):
        v = self.store.get_or_create(None, today=date(2020, 1, 1))
        self.store.save(v)
        self.assertEqual(self.store.purge(days=30, today=date(2026, 1, 1)), 1)

    def test_history_starts_with_user(self):
        v = self.store.get_or_create(None)
        v.add_turn("counselor", "안녕하세요")
        v.add_turn("user", "안녕하세요")
        self.assertEqual(v.history_for_llm()[0]["role"], "user")


class TestCounselor(unittest.TestCase):
    def setUp(self):
        # 키가 있는 환경에서도 테스트가 네트워크를 타지 않게 고정한다
        self.counselor = Counselor(Config(counselor="offline"))
        self.store = Store(Path(tempfile.mkdtemp()))

    def test_offline_reply_is_complete(self):
        r = self.counselor.respond("요즘 너무 외롭습니다")
        self.assertEqual(r.source, "offline")
        for part in (r.listen, r.insight, r.question, r.prayer, r.step, r.verse_ref):
            self.assertTrue(part.strip())
        self.assertTrue(r.links and r.follow_up and r.disclaimer)

    def test_crisis_short_circuits(self):
        r = self.counselor.respond("죽고 싶습니다")
        self.assertEqual((r.source, r.risk), ("safety", "crisis"))
        self.assertTrue(r.hotlines)
        self.assertEqual(r.verse_ref, "", "위기 상황에서는 성경 구절을 먼저 들이대지 않는다")
        self.assertEqual(r.question, "", "위기 상황에서는 되묻지 않는다")

    def test_abuse_routes_to_hotlines(self):
        r = self.counselor.respond("남편이 저를 때립니다")
        self.assertEqual(r.risk, "abuse")
        self.assertTrue(any("112" in h for h in r.hotlines))

    def test_topic_continuity(self):
        v = self.store.get_or_create(None)
        first = self.counselor.respond("교회에서 상처받고 안 나갑니다", v)
        second = self.counselor.respond("그때 생각만 하면 아직도 힘들어요", v)
        self.assertEqual(first.topic, "교회상처")
        self.assertEqual(second.topic, "교회상처", "이어지는 말에서 주제가 초기화되면 안 된다")
        self.assertNotEqual(first.question, second.question, "질문이 깊어져야 한다")

    def test_verse_rotation(self):
        v = self.store.get_or_create(None)
        refs = [self.counselor.respond("너무 외로워요", v).verse_ref for _ in range(3)]
        self.assertEqual(len(set(refs)), 3, "같은 사람에게 같은 구절을 반복하지 않는다")

    def test_greeting_opens_instead_of_counseling(self):
        r = self.counselor.respond("안녕하세요")
        self.assertEqual(r.source, "opener")
        self.assertTrue(r.question)

    def test_follow_up_remembers_intention(self):
        v = self.store.get_or_create(None)
        v.add_intention("아버지 수술이 잘 되게")
        r = self.counselor.respond("요즘 불안합니다", v)
        self.assertIn("아버지 수술", r.follow_up)

    def test_returning_visitor_streak_message(self):
        v = self.store.get_or_create(None, today=date(2026, 1, 1))
        v.touch(date(2026, 1, 2))
        r = self.counselor.respond("요즘 불안합니다", v, today=date(2026, 1, 2))
        self.assertIn("2일째", r.follow_up)

    def test_no_denomination_push(self):
        """먼저 묻지 않았는데 특정 교파로 데려가지 않는다."""
        r = self.counselor.respond("요즘 너무 지칩니다")
        blob = r.as_text()
        for word in ("성당에 나오", "가톨릭으로", "개종", "등록하십시오"):
            self.assertNotIn(word, blob)


class TestSeo(unittest.TestCase):
    def test_urls_cover_content(self):
        paths = {p for p, _, _ in all_urls()}
        for b in fifty.BELIEFS:
            self.assertIn(b.url, paths)
        for e in entries.ENTRIES:
            self.assertIn(e.url, paths)
        for p in pages.PAGES:
            self.assertIn(p.url, paths)

    def test_sitemap_and_robots(self):
        cfg = Config(site_url="https://example.org")
        xml = sitemap_xml(cfg, date(2026, 9, 15))
        self.assertIn("https://example.org/believe/21-the-greatest-commandment", xml)
        self.assertIn("<urlset", xml)
        self.assertIn("Sitemap: https://example.org/sitemap.xml", robots_txt(cfg))


class TestRender(unittest.TestCase):
    def setUp(self):
        self.cfg = Config(site_url="https://example.org")

    def test_all_pages_render(self):
        card = daily.build(date(2026, 9, 15))
        markup = [render.home(self.cfg, card), render.today(self.cfg, card),
                  render.believe_index(self.cfg), render.counsel_page(self.cfg),
                  render.pray_page(self.cfg), render.not_found(self.cfg)]
        markup += [render.belief_page(self.cfg, b) for b in fifty.BELIEFS]
        markup += [render.gate_page(self.cfg, e) for e in entries.ENTRIES]
        markup += [render.static_page(self.cfg, p) for p in pages.PAGES]
        for m in markup:
            self.assertTrue(m.startswith("<!doctype html>"))
            self.assertIn("<title>", m)
            self.assertIn('name="description"', m)
            self.assertIn('rel="canonical"', m)

    def test_escapes_user_input(self):
        m = render.counsel_page(self.cfg, '<script>alert(1)</script>')
        self.assertNotIn("<script>alert(1)</script>", m)

    def test_belief_page_has_structured_data(self):
        m = render.belief_page(self.cfg, fifty.get(21))
        self.assertIn("application/ld+json", m)
        self.assertIn("https://example.org/believe/21-the-greatest-commandment", m)

    def test_crisis_line_in_every_footer(self):
        """어느 페이지에서 이탈하든 긴급 연락처는 보여야 한다."""
        self.assertIn("109", render.home(self.cfg, daily.build()))


if __name__ == "__main__":
    unittest.main()
