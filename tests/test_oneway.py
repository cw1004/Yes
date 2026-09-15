# -*- coding: utf-8 -*-
"""하나의 길 무결성 테스트: python3 -m unittest discover -s tests"""

import random
import re
import tempfile
import unittest
from datetime import date
from pathlib import Path

from oneway.config import Config
from oneway.content import daily, entries, fifty, pages, verses
from oneway.counselor import depth, persona, safety, topics
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


# 깊이 0~1 에서 새어 나오면 안 되는 말.
# "어렵기도", "이기도" 같은 부사형에 걸리지 않도록 '기도'는 조사까지 확인한다.
RELIGIOUS = [
    r"하느님", r"하나님", r"주님", r"예수", r"그리스도", r"성령",
    r"성경", r"성서", r"복음", r"성당", r"미사", r"목사", r"신부님",
    r"신앙", r"교회", r"묵상", r"찬양", r"은총", r"은혜",
    r"기도(가|를|은|는|에|로|문|와|할|해|합|했|도)",
]


# 라벨·제목처럼 짧고 다듬어진 문자열에는 '기도'가 홀로 있어도 잡는다.
RELIGIOUS_STRICT = RELIGIOUS[:-1] + [r"기도", r"믿음", r"말씀"]


def religious_hits(text):
    return [p for p in RELIGIOUS if re.search(p, text or "")]


def religious_hits_strict(text):
    return [p for p in RELIGIOUS_STRICT if re.search(p, text or "")]


class TestDepth(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(depth.detect("요즘 너무 지쳐요")[0], depth.OPEN)
        self.assertEqual(depth.detect("왜 사는지 모르겠어요")[0], depth.STORY)
        self.assertEqual(depth.detect("기도해도 응답이 없어요")[0], depth.FAITH)
        self.assertEqual(depth.detect("가톨릭과 개신교 차이가 뭔가요")[0], depth.TRADITION)

    def test_lookalike_words_do_not_open_the_door(self):
        """깊이를 잘못 올리면 종교 이야기를 원하지 않는 사람에게 종교 이야기를 하게 된다.
        한국어에는 종교어처럼 보이는 일상어가 많다."""
        for t in ("요즘 너무 지치고 사람 만나기도 싫습니다",
                  "부장님이 말씀하시길 그만두라고 하셨어요",
                  "결혼식 신부 화장 때문에 스트레스입니다",
                  "영세한 회사라 월급이 밀려요",
                  "은혜가 저한테 못되게 굴어요",
                  "오늘 좀 힘들기도 하고요"):
            self.assertEqual(depth.detect(t)[0], depth.OPEN, t)

    def test_real_faith_words_do_open_the_door(self):
        for t, expected in (("기도해도 응답이 없어요", depth.FAITH),
                            ("새벽기도를 나가고 있습니다", depth.FAITH),
                            ("성경을 읽어보려는데요", depth.FAITH),
                            ("가톨릭 성당에 가보려고요", depth.TRADITION),
                            ("세례를 받아야 할까요", depth.TRADITION)):
            self.assertEqual(depth.detect(t)[0], expected, t)

    def test_carried_depth_is_kept_but_tradition_is_not(self):
        """한 번 신앙 이야기를 나눈 사람에게 다음 날 남처럼 굴 필요는 없다.
        다만 교파 이야기는 물어본 그 순간에만 한다."""
        self.assertEqual(depth.resolve("오늘 힘들어요", carried=depth.FAITH)[0], depth.FAITH)
        self.assertEqual(depth.resolve("오늘 힘들어요", carried=depth.TRADITION)[0], depth.FAITH)

    def test_decline_is_permanent(self):
        self.assertTrue(depth.declines("종교 얘기는 빼주세요"))
        self.assertTrue(depth.declines("저는 무교입니다"))
        self.assertFalse(depth.declines("종교에 대해 궁금한 게 있어요"))
        self.assertEqual(
            depth.resolve("기도가 안 됩니다", carried=depth.FAITH, blocked=True)[0],
            depth.OPEN)

    def test_invitation_is_not_pushy(self):
        self.assertEqual(depth.invitation(depth.OPEN, turn_no=1, blocked=False), "")
        self.assertEqual(depth.invitation(depth.OPEN, turn_no=5, blocked=True), "")
        self.assertTrue(depth.invitation(depth.OPEN, turn_no=5, blocked=False))


class TestPersona(unittest.TestCase):
    def test_identity_question_detected(self):
        for t in ("사람이세요?", "혹시 AI인가요", "너 챗봇이야?", "누구세요",
                  "진짜 사람 맞나요?"):
            self.assertTrue(persona.asks_identity(t), t)

    def test_long_story_is_not_an_identity_question(self):
        """긴 사연 속의 '사람이' 를 질문으로 오해하면 대화가 망가진다."""
        for t in ("저는 사람 만나는 게 무서워서 밖에 안 나간 지 오래됐습니다",
                  "사람이 너무 싫어요", "기계처럼 일만 하고 있어요"):
            self.assertFalse(persona.asks_identity(t), t)

    def test_answer_never_claims_to_be_human(self):
        v = persona.Voice(random.Random(0))
        for _ in range(20):
            answer = v.identity()
            self.assertIn("사람", answer)
            self.assertNotIn("사람입니다", answer)
            self.assertTrue("아닙니다" in answer or "사람은 아닙니다" in answer)


class TestTopicLayers(unittest.TestCase):
    def test_open_layer_has_no_religious_words(self):
        """이 테스트가 이 사이트의 설계를 지킨다.
        처음 온 사람이 읽는 칸에 종교어가 한 단어라도 들어가면 안 된다."""
        for t in topics.TOPICS:
            if t.min_depth:
                continue
            for name in ("empathy", "insight", "questions", "steps", "closing"):
                for line in getattr(t, name):
                    self.assertEqual(religious_hits(line), [],
                                     f"{t.key}.{name}: {line}")

    def test_deep_layers_are_filled(self):
        for t in topics.TOPICS:
            self.assertTrue(t.story, f"{t.key}: 깊이 1 이야기가 없습니다")
            self.assertTrue(t.faith_insight and t.verses and t.prayer,
                            f"{t.key}: 깊이 2 자료가 없습니다")

    def test_story_layer_hides_its_source(self):
        """깊이 1 은 출처를 밝히지 않는다. '성경에' 라고 쓰면 깊이 2다."""
        for t in topics.TOPICS:
            for line in t.story:
                for word in ("성경", "예수님", "하느님", "하나님", "복음서"):
                    self.assertNotIn(word, line, f"{t.key}.story: {line}")


class TestCounselor(unittest.TestCase):
    def setUp(self):
        # 키가 있는 환경에서도 테스트가 네트워크를 타지 않게 고정한다
        self.counselor = Counselor(Config(counselor="offline"), rng=random.Random(0))
        self.store = Store(Path(tempfile.mkdtemp()))

    def talk(self, *messages, visitor=None):
        v = visitor or self.store.get_or_create(None)
        replies = [self.counselor.respond(m, v) for m in messages]
        return replies[-1] if len(replies) == 1 else replies

    # ── 깊이 0 — 누구나 ────────────────────────────────────────
    def test_first_contact_is_completely_secular(self):
        for message in ("요즘 너무 지치고 아무것도 하기 싫어요",
                        "아내랑 매일 싸웁니다",
                        "돈 때문에 막막합니다",
                        "아이가 말을 안 들어요"):
            r = self.talk(message)
            self.assertEqual(r.depth, depth.OPEN, message)
            self.assertEqual(religious_hits(r.as_text()), [], f"{message} → {r.text}")

    def test_first_reply_listens_instead_of_prescribing(self):
        """듣자마자 해결책을 내미는 것이 가장 상담답지 않은 행동이다."""
        r = self.talk("요즘 너무 외로워요")
        self.assertIn("?", r.text, "첫 답변에는 되묻는 말이 있어야 합니다")
        self.assertLessEqual(len(r.text.split("\n\n")), 3,
                             "첫 답변은 짧아야 합니다")

    def test_open_depth_links_have_no_faith_content(self):
        r = self.talk("요즘 너무 지칩니다")
        for link in r.links:
            self.assertNotEqual(link.kind, "belief", link.label)
            self.assertEqual(religious_hits_strict(link.label), [], link.label)

    def test_every_topic_stays_secular_at_the_surface(self):
        """한 주제만 새어도 그 사람은 돌아오지 않는다. 그래서 전수로 확인한다."""
        for t in topics.TOPICS:
            if t.min_depth:
                continue
            r = self.talk(t.cues[0] + " 때문에 힘듭니다")
            if r.depth != depth.OPEN:
                continue                      # 단서 자체가 신앙어인 주제는 건너뛴다
            for label in [l.label for l in r.links] + [r.follow_up]:
                self.assertEqual(religious_hits_strict(label), [],
                                 f"{t.key}: {label}")

    # ── 깊이는 상대가 연다 ─────────────────────────────────────
    def test_visitor_opens_the_door(self):
        v = self.store.get_or_create(None)
        first, second = self.talk("요즘 너무 외로워요", "기도를 해봐도 안 됩니다", visitor=v)
        self.assertEqual(first.depth, depth.OPEN)
        self.assertEqual(second.depth, depth.FAITH)
        self.assertTrue(second.verse_ref, "깊이 2에서는 구절 주소가 붙습니다")
        self.assertEqual(first.verse_ref, "", "깊이 0에서는 구절을 들이대지 않습니다")

    def test_tradition_only_when_asked(self):
        r = self.talk("가톨릭과 개신교는 뭐가 다릅니까?")
        self.assertEqual(r.depth, depth.TRADITION)
        self.assertIn("개신교 표기", r.verse_ref, "교파를 물었을 때만 표기를 밝힙니다")

    def test_decline_is_respected_forever(self):
        v = self.store.get_or_create(None)
        self.counselor.respond("종교 얘기는 빼주세요", v)
        self.assertTrue(v.faith_blocked)
        for message in ("회사 일 때문에 힘듭니다", "기도라도 해야 하나 싶어요"):
            r = self.counselor.respond(message, v)
            self.assertEqual(r.depth, depth.OPEN, message)
            self.assertEqual(religious_hits(r.as_text()), [], message)

    # ── 사람인 척하지 않는다 ───────────────────────────────────
    def test_identity_answered_honestly(self):
        r = self.talk("사람이세요?")
        self.assertEqual(r.source, "identity")
        self.assertIn("아닙니다", r.text)

    def test_no_notice_on_every_reply(self):
        """매 답변마다 붙는 고지문은 상담이 아니라 약관처럼 읽힌다."""
        r = self.talk("요즘 너무 외로워요")
        self.assertEqual(r.note, "")
        self.assertNotIn("AI", r.text)

    def test_notice_appears_when_it_matters(self):
        r = self.talk("사라지고 싶어요")
        self.assertEqual(r.risk, "watch")
        self.assertTrue(r.note, "위험 신호가 있을 때는 안내를 붙입니다")
        self.assertTrue(r.hotlines)

    def test_replies_do_not_repeat_themselves(self):
        v = self.store.get_or_create(None)
        replies = self.talk("너무 외로워요", "요즘 계속 그래요", "친구도 없어요", visitor=v)
        firsts = [r.text.split("\n")[0] for r in replies]
        self.assertEqual(len(set(firsts)), 3, "같은 말로 시작하면 기계처럼 읽힙니다")

    # ── 안전 ───────────────────────────────────────────────────
    def test_crisis_short_circuits(self):
        r = self.talk("죽고 싶습니다")
        self.assertEqual((r.source, r.risk), ("safety", "crisis"))
        self.assertTrue(r.hotlines)
        self.assertEqual(r.verse_ref, "", "위기 상황에서 성경 구절을 먼저 들이대지 않는다")
        self.assertIn("109", " ".join(r.hotlines))

    def test_crisis_discloses_it_is_not_a_person(self):
        """사람에게 연락해야 한다는 걸 알려면, 내가 사람이 아니라는 걸 알아야 한다."""
        r = self.talk("죽고 싶습니다")
        self.assertIn("곁에 실제로 있어 드릴 수 없", r.text)

    def test_abuse_routes_to_hotlines(self):
        r = self.talk("남편이 저를 때립니다")
        self.assertEqual(r.risk, "abuse")
        self.assertTrue(any("112" in h for h in r.hotlines))

    # ── 대화의 연속성 ──────────────────────────────────────────
    def test_topic_continuity(self):
        v = self.store.get_or_create(None)
        first, second = self.talk("교회에서 상처받고 안 나갑니다",
                                  "그때 생각만 하면 아직도 힘들어요", visitor=v)
        self.assertEqual(first.topic, "교회상처")
        self.assertEqual(second.topic, "교회상처", "이어지는 말에서 주제가 초기화되면 안 된다")
        self.assertNotEqual(first.text, second.text)

    def test_verse_rotation(self):
        v = self.store.get_or_create(None)
        refs = [self.counselor.respond("기도해도 너무 외로워요", v).verse_ref
                for _ in range(3)]
        self.assertEqual(len(set(refs)), 3, "같은 사람에게 같은 구절을 반복하지 않는다")

    def test_greeting_opens_instead_of_counseling(self):
        r = self.talk("안녕하세요")
        self.assertEqual(r.source, "opener")
        self.assertEqual(religious_hits(r.as_text()), [])

    def test_follow_up_remembers_intention(self):
        v = self.store.get_or_create(None)
        v.add_intention("아버지 수술이 잘 되게")
        seen = {self.counselor.respond("요즘 불안합니다", v).follow_up for _ in range(12)}
        self.assertTrue(any("아버지 수술" in f for f in seen))

    def test_returning_visitor_is_recognized(self):
        v = self.store.get_or_create(None, today=date(2026, 1, 1))
        v.touch(date(2026, 1, 2))
        r = self.counselor.respond("요즘 불안합니다", v, today=date(2026, 1, 2))
        self.assertIn("2일째", r.follow_up)


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

    @staticmethod
    def entry_area(markup):
        """처음 눈에 들어오는 영역만 남긴다.

        '더 깊이' 문(.quiet-links / .deeper)은 일부러 둔 것이고,
        그 문에는 정직한 이름을 붙인다. 다만 페이지 아래쪽에만 둔다.
        """
        body = markup[markup.index("<body>"):]
        body = re.sub(r'<section class="card quiet-links">.*?</section>', "",
                      body, flags=re.S)
        body = re.sub(r'<nav class="deeper">.*?</nav>', "", body, flags=re.S)
        return body

    def test_entry_screens_are_secular(self):
        """처음 보는 화면에 종교어가 있으면 거기서 끝난다."""
        card = daily.build(date(2026, 9, 15))
        for name, markup in (("홈", render.home(self.cfg, card)),
                             ("상담", render.counsel_page(self.cfg)),
                             ("하루 3분", render.today(self.cfg, card))):
            self.assertEqual(religious_hits(self.entry_area(markup)), [],
                             f"{name} 화면")

    def test_deeper_doors_exist_and_are_honest(self):
        """색깔을 지우는 것과 숨기는 것은 다르다.
        문은 있어야 하고, 그 문에는 정직한 이름이 붙어야 한다."""
        markup = render.home(self.cfg, daily.build(date(2026, 9, 15)))
        self.assertIn("더 깊은 질문이 있으시다면", markup)
        self.assertIn("/believe", markup)
        self.assertIn("/left-church", markup)

    def test_today_reveals_faith_only_when_opened(self):
        card = daily.build(date(2026, 9, 15))
        self.assertNotIn("오늘의 기도", render.today(self.cfg, card))
        self.assertIn("오늘의 기도", render.today(self.cfg, card, faith=True))

    def test_counsel_page_does_not_lecture_before_hello(self):
        """말을 걸기도 전에 읽는 고지문은 사람을 돌려보낸다."""
        markup = render.counsel_page(self.cfg)
        self.assertNotIn("이 상담사는 사람이 아니라", markup)
        self.assertIn("사람이 아닙니다", markup)      # 조용히, 그러나 분명히
        self.assertIn("109", markup)

    def test_deep_pages_still_label_traditions(self):
        """교파를 다루는 페이지에서는 표기를 정확히 밝힌다."""
        self.assertIn("개신교 표기", render.belief_page(self.cfg, fifty.get(41)))
        self.assertNotIn("개신교 표기", render.belief_page(self.cfg, fifty.get(10)))

    def test_home_title_is_not_doubled(self):
        markup = render.home(self.cfg, daily.build(date(2026, 9, 15)))
        title = re.search(r"<title>(.*?)</title>", markup).group(1)
        self.assertEqual(title.count("하나의 길"), 1, title)

    def test_crisis_line_in_every_footer(self):
        """어느 페이지에서 이탈하든 긴급 연락처는 보여야 한다."""
        self.assertIn("109", render.home(self.cfg, daily.build()))


if __name__ == "__main__":
    unittest.main()
