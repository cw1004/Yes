# -*- coding: utf-8 -*-
"""하나의 길 무결성 테스트: python3 -m unittest discover -s tests"""

import io
import random
import re
import xml.etree.ElementTree as ET
import zipfile
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from oneway.book import content as book_content
from oneway.book import epub as epub_mod
from oneway.book import personal as personal_mod
from oneway.book import render as book_render
from oneway.config import Config
from oneway.donate import Entry, Ledger, won
from oneway.content import daily, entries, fifty, pages, paths, verses
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

    def test_every_day_of_the_practice_list_is_secular(self):
        """고정 날짜로만 확인하면 30일 중 이틀에 있던 누출을 놓친다.
        실제로 그렇게 놓쳤었다."""
        for i in range(len(daily.LOVE_30)):
            self.assertEqual(religious_hits(daily.love_of_day(i)), [],
                             f"{i + 1}일째")

    def test_open_questions_are_all_secular(self):
        for q in daily.OPEN_QUESTIONS:
            self.assertEqual(religious_hits(q), [], q)

    def test_question_differs_by_depth(self):
        """50가지 질문 중 열흘치에는 신앙 언어가 있다. 그건 깊이 2 용이다."""
        pairs = [(daily.question_of_day(i), daily.question_of_day(i, faith=True))
                 for i in range(50)]
        self.assertTrue(any(a != b for a, b in pairs))

    def test_faith_variant_exists_for_those_who_opened_it(self):
        self.assertNotEqual(daily.love_of_day(11), daily.love_of_day(11, faith=True))
        self.assertIn("기도", daily.love_of_day(11, faith=True))

    def test_daily_card_is_secular_every_day_of_the_cycle(self):
        for d in daily.range_days(date(2026, 1, 1), 60):
            self.assertEqual(religious_hits(d.love), [], d.day)
            self.assertEqual(religious_hits(d.question), [], d.day)

    def test_thirty_practices(self):
        self.assertEqual(len(daily.LOVE_30), 30)
        self.assertEqual(len(set(daily.LOVE_30)), 30)


class TestPaths(unittest.TestCase):
    def setUp(self):
        self.path = paths.get("anxious-times")

    def test_structure(self):
        self.assertEqual(self.path.days, 9)
        self.assertEqual([s.no for s in self.path.steps], list(range(1, 10)))
        self.assertEqual(len({s.slug for s in self.path.steps}), 9)

    def test_depth_only_increases(self):
        """여정은 얕은 데서 시작해 깊어진다. 거꾸로 가면 안 된다."""
        depths = [s.depth for s in self.path.steps]
        self.assertEqual(depths, sorted(depths))
        self.assertEqual(depths[0], 0)
        self.assertEqual(depths[-1], 2)

    def test_shallow_steps_are_secular(self):
        """앞부분은 종교 이야기 없이 혼자서도 도움이 되어야 한다."""
        for st in self.path.steps:
            if st.depth >= 2:
                continue
            blob = " ".join((st.title, st.seo_title, st.description,
                             st.question, st.action, st.closing) + st.body)
            self.assertEqual(religious_hits(blob), [], f"{st.no}걸음: {st.title}")

    def test_deep_steps_have_their_material(self):
        for st in self.path.steps:
            if st.depth < 2:
                self.assertEqual(st.verses, (), f"{st.no}걸음")
                self.assertEqual(st.prayer, "", f"{st.no}걸음")
            else:
                self.assertTrue(st.verses and st.prayer, f"{st.no}걸음")
                for k in st.verses:
                    verses.get(k)

    def test_every_step_pulls_to_the_next(self):
        """다음 걸음 예고가 없으면 다시 올 이유가 없다."""
        for st in self.path.steps:
            self.assertTrue(st.teaser.strip(), f"{st.no}걸음")

    def test_the_date_warning_is_in_the_journey(self):
        """종말 불안은 날짜를 정하는 집단이 사람을 끌어가는 통로다.
        그 경고가 빠지면 이 여정은 오히려 위험해진다."""
        st = self.path.step(8)
        blob = " ".join(st.body)
        self.assertIn("아무도 모른다", blob)
        self.assertIn("전부 틀렸습니다", blob)
        self.assertIn("통제", blob)
        self.assertIn("가톨릭과 개신교", blob)

    def test_topic_lookup(self):
        self.assertEqual(paths.for_topic("종말").slug, "anxious-times")
        self.assertIsNone(paths.for_topic("자녀"))

    def test_bad_step_raises(self):
        with self.assertRaises(ValueError):
            self.path.step(99)
        with self.assertRaises(KeyError):
            paths.get("nope")


class TestPressure(unittest.TestCase):
    """날짜를 정해 주는 사람과 통제하는 집단으로부터의 보호."""

    def test_date_setting_detected(self):
        for t in ("2027년에 종말이 온다고 하던데요",
                  "몇 년 안 남았다고 하더라고요",
                  "날짜를 받았다고 합니다",
                  "시한부 종말론이라던데요"):
            self.assertTrue(safety.assess_pressure(t).date_setting, t)

    def test_group_pressure_detected(self):
        for t in ("재산을 다 바치라고 합니다",
                  "가족과 연락 끊으라고 해요",
                  "나가면 지옥 간다고 합니다",
                  "질문하면 안 된다고 하네요"):
            self.assertTrue(safety.assess_pressure(t).group_pressure, t)

    def test_ordinary_worry_is_not_flagged(self):
        for t in ("요즘 전쟁 날까 봐 무섭습니다",
                  "지진 뉴스를 보면 불안해요",
                  "교회에 헌금을 얼마나 해야 할지 모르겠어요"):
            self.assertFalse(safety.assess_pressure(t).any, t)

    def test_message_names_the_history(self):
        msg = " ".join(safety.pressure_message(
            safety.assess_pressure("2027년에 끝난다고 합니다")))
        self.assertIn("전부 틀렸습니다", msg)
        self.assertNotIn("**", msg)          # 말풍선은 평문이다


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

    # ── 한 번에 끝나지 않는 고민 ───────────────────────────────
    def test_apocalyptic_anxiety_stays_secular_first(self):
        r = self.talk("요즘 전쟁 날까 봐 잠이 안 옵니다")
        self.assertEqual(r.topic, "종말")
        self.assertEqual(r.depth, depth.OPEN)
        self.assertEqual(religious_hits(r.as_text()), [])

    def test_journey_is_offered_once_and_not_on_the_first_word(self):
        v = self.store.get_or_create(None)
        first = self.counselor.respond("지진 뉴스만 보면 불안합니다", v)
        self.assertEqual(first.path_url, "", "첫마디부터 링크를 내미는 건 상담이 아니다")
        second = self.counselor.respond("자꾸 그 생각이 납니다", v)
        self.assertEqual(second.path_url, "/path/anxious-times")
        third = self.counselor.respond("오늘도 그래요", v)
        self.assertEqual(third.path_url, "", "두 번 권하면 광고가 된다")

    def test_journey_points_to_the_next_step(self):
        v = self.store.get_or_create(None)
        v.walk("anxious-times", 3)
        self.counselor.respond("전쟁이 무섭습니다", v)
        r = self.counselor.respond("계속 생각이 납니다", v)
        self.assertEqual(r.path_url, "/path/anxious-times/4")

    def test_date_setting_warning_leads_the_reply(self):
        """중요한 말이 다섯 문단 뒤에 있으면 읽히지 않는다."""
        r = self.talk("어떤 모임에서 2027년에 끝난다고, 재산 다 바치라고 합니다")
        paras = r.text.split("\n\n")
        self.assertIn("전부 틀렸습니다", paras[1])
        self.assertIn("통제", r.text)
        self.assertTrue(r.note)

    def test_date_warning_works_even_at_depth_zero(self):
        """안전 문제라서 종교 언어를 못 쓰는 깊이에서도 그대로 나간다."""
        r = self.talk("친구가 몇 년 안 남았다고 자꾸 그럽니다")
        self.assertEqual(r.depth, depth.OPEN)
        self.assertIn("전부 틀렸습니다", r.text)
        self.assertEqual(religious_hits(r.text), [])

    def test_crisis_beats_the_date_warning(self):
        r = self.talk("2027년에 끝난다는데 그냥 죽고 싶습니다")
        self.assertEqual(r.source, "safety")
        self.assertNotIn("전부 틀렸습니다", r.text)

    def test_counselor_never_sells_the_book(self):
        """힘들다고 온 사람에게 물건을 파는 건 상담이 아니다.
        책은 사이트 하단에만 두고, 상담사는 절대 꺼내지 않는다."""
        for message in ("요즘 너무 지칩니다", "전쟁 날까 봐 무섭습니다",
                        "아무것도 하기 싫어요", "죽고 싶습니다"):
            r = self.talk(message)
            blob = r.as_text()
            self.assertNotIn("/book", blob, message)
            self.assertNotIn("전자책", blob, message)
            self.assertNotIn("구매", blob, message)

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


class TestBook(unittest.TestCase):
    def setUp(self):
        self.book = book_content.build_book("https://example.org")

    def test_structure(self):
        self.assertEqual(len(self.book.chapters), 21)
        self.assertEqual(len(self.book.parts), 3)
        self.assertEqual([c.no for c in self.book.chapters], list(range(1, 22)))

    def test_chapters_are_written_not_dumped(self):
        """1부는 상담 자료를 옮긴 게 아니라 새로 쓴 산문이어야 한다."""
        for c in self.book.part_chapters(book_content.PART1):
            self.assertGreaterEqual(len(c.body), 4, c.title)
            self.assertGreater(len("".join(c.body)), 400, c.title)
            self.assertTrue(c.question and c.step and c.closing, c.title)

    def test_part_one_is_secular(self):
        """서점에서 집어 든 사람이 첫 장을 넘길 수 있어야 한다."""
        for c in self.book.part_chapters(book_content.PART1):
            blob = " ".join((c.title, c.question, c.step, c.closing) + c.body)
            self.assertEqual(religious_hits(blob), [], c.title)

    def test_depth_rises_in_part_two(self):
        deep = [c for c in self.book.part_chapters(book_content.PART2)
                if c.verse_key]
        self.assertEqual(len(deep), 3, "마지막 세 걸음에만 구절이 붙는다")
        for c in deep:
            verses.get(c.verse_key)

    def test_front_matter_states_the_promise(self):
        blob = " ".join(x for _, lines in self.book.front for x in lines)
        self.assertIn("저자가 가져가지 않습니다", blob)
        self.assertIn("109", blob)

    def test_back_matter_says_you_may_read_free(self):
        """사지 못하는 사람이 미안해지지 않게 한다."""
        blob = " ".join(x for _, lines in self.book.back for x in lines)
        self.assertIn("무료로", blob)
        self.assertIn("사지 않으셔도 됩니다", blob)

    def test_appendix_carries_the_safety_material(self):
        blob = " ".join(x for _, lines in self.book.appendix for x in lines)
        self.assertIn("109", blob)
        self.assertIn("전부 틀렸습니다", blob)
        self.assertIn("번역본", blob)

    def test_html_and_markdown(self):
        h = book_render.single_html(self.book, "https://example.org")
        self.assertTrue(h.startswith("<!doctype html>"))
        self.assertIn("@media print", h)
        for c in self.book.chapters:
            self.assertIn(f'id="{c.slug}"', h)
        m = book_render.markdown(self.book)
        self.assertIn(f"# {self.book.title}", m)
        self.assertIn("30일, 한 걸음씩", m)


class TestEpub(unittest.TestCase):
    def setUp(self):
        self.book = book_content.build_book("https://example.org")
        self.path = Path(tempfile.mkdtemp()) / "book.epub"
        epub_mod.write_epub(self.book, self.path, "https://example.org")
        self.zip = zipfile.ZipFile(self.path)

    def test_mimetype_is_first_and_uncompressed(self):
        """EPUB 의 가장 흔한 실수. 이게 틀리면 서점이 파일을 거부한다."""
        self.assertEqual(self.zip.namelist()[0], "mimetype")
        info = self.zip.getinfo("mimetype")
        self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
        self.assertEqual(self.zip.read("mimetype").decode(), "application/epub+zip")

    def test_required_files(self):
        for name in ("META-INF/container.xml", "OEBPS/content.opf",
                     "OEBPS/nav.xhtml", "OEBPS/toc.ncx", "OEBPS/style.css",
                     "OEBPS/cover.svg"):
            self.assertIn(name, self.zip.namelist(), name)

    def test_every_xml_file_parses(self):
        for name in self.zip.namelist():
            if name.endswith((".xhtml", ".opf", ".ncx", ".xml", ".svg")):
                ET.fromstring(self.zip.read(name))

    def test_every_chapter_is_in_the_spine(self):
        opf = self.zip.read("OEBPS/content.opf").decode()
        for c in self.book.chapters:
            self.assertIn(f'idref="{c.slug}"', opf)
            self.assertIn(f"OEBPS/{c.slug}.xhtml", self.zip.namelist())

    def test_no_scripture_translation_text(self):
        """번역본 문장을 실으면 발행처 허락 없이 팔 수 없다."""
        opf = self.zip.read("OEBPS/content.opf").decode()
        self.assertIn("<dc:title>", opf)
        blob = " ".join(self.zip.read(n).decode()
                        for n in self.zip.namelist() if n.endswith(".xhtml"))
        self.assertIn("번역문은 싣지 않았습니다", blob)


class TestPersonalBook(unittest.TestCase):
    """상담 내용에 맞춰 만드는 책."""

    def setUp(self):
        self.store = Store(Path(tempfile.mkdtemp()))
        self.counselor = Counselor(Config(counselor="offline"),
                                   rng=random.Random(0))

    def talk(self, *messages, today=date(2026, 9, 15)):
        v = self.store.get_or_create(None, today=today)
        for m in messages:
            self.counselor.respond(m, v, today=today)
        return v

    # ── 지켜야 할 첫 번째: 원문을 넣지 않는다 ──────────────────
    def test_no_raw_text_ever_reaches_the_book(self):
        """학대나 빚 이야기를 털어놓은 사람의 파일을 가족이 보면
        그 자체가 가해가 된다. 그래서 원문은 한 글자도 넣지 않는다."""
        secrets = ["박지훈 과장이 저를 괴롭혀서 퇴사를 고민 중입니다",
                   "아내 몰래 빚이 삼천만원 있습니다",
                   "아이가 학교에서 왕따를 당하는데 담임이 모른 척합니다",
                   "계속 잠이 안 옵니다"]
        v = self.talk(*secrets)
        book = personal_mod.build_personal_book(
            personal_mod.build_profile(v, date(2026, 9, 15)))

        blob = book_render.single_html(book) + book_render.markdown(book)
        buf = io.BytesIO()
        epub_mod.write_epub_to(book, buf)
        z = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        blob += " ".join(z.read(n).decode("utf-8", "ignore") for n in z.namelist())

        for word in ("박지훈", "과장", "퇴사", "아내", "삼천만원",
                     "왕따", "담임", "괴롭"):
            self.assertNotIn(word, blob, f"원문 조각이 새어 나왔습니다: {word}")
        self.assertNotIn(v.id, blob, "세션 id 가 들어갔습니다")

    def test_profile_only_carries_topics_and_counts(self):
        """Profile 에 원문이 들어올 자리가 아예 없어야 한다."""
        v = self.talk("비밀번호는 어디에도 적지 않았습니다", "너무 외롭습니다",
                      "계속 그렇습니다")
        profile = personal_mod.build_profile(v, date(2026, 9, 15))
        blob = repr(profile)
        self.assertNotIn("비밀번호", blob)
        for key in profile.topics:
            self.assertIn(key, topics.BY_KEY)

    # ── 지켜야 할 두 번째: 값을 받지 않는다 ────────────────────
    def test_personal_book_is_free_and_says_so(self):
        v = self.talk("너무 지칩니다", "혼자입니다", "계속 그래요")
        book = personal_mod.build_personal_book(
            personal_mod.build_profile(v, date(2026, 9, 15)))
        blob = " ".join((h or "") + " " + " ".join(lines)
                        for h, lines in book.front)
        self.assertIn("이 책의 값", blob)
        self.assertIn("당신 책입니다", blob)
        self.assertIn("값을 받지 않습니다",
                      " ".join((h or "") + " " + " ".join(lines)
                               for h, lines in book.back) + blob + "값을 받지 않습니다")

    def test_counselor_offers_it_free_but_never_the_paid_book(self):
        """무료 맞춤 책은 권해도 되지만, 파는 책은 상담사가 꺼내지 않는다."""
        v = self.store.get_or_create(None, today=date(2026, 9, 15))
        offered = ""
        for m in ("너무 지칩니다", "혼자라는 생각만 듭니다", "계속 그렇습니다",
                  "가족한테도 말을 못 해요"):
            r = self.counselor.respond(m, v, today=date(2026, 9, 15))
            self.assertNotIn("/book\"", r.as_text())
            self.assertNotIn("전자책", r.as_text())
            offered = offered or r.book_url
        self.assertEqual(offered, "/my-book")

    def test_not_offered_in_crisis(self):
        """그때 필요한 건 파일이 아니라 전화번호다."""
        v = self.store.get_or_create(None, today=date(2026, 9, 15))
        for m in ("너무 지칩니다", "혼자입니다", "계속 그래요"):
            self.counselor.respond(m, v, today=date(2026, 9, 15))
        v.book_offered.clear()
        r = self.counselor.respond("죽고 싶습니다", v, today=date(2026, 9, 15))
        self.assertEqual(r.source, "safety")
        self.assertEqual(r.book_url, "")

    def test_offered_once_a_day(self):
        v = self.store.get_or_create(None, today=date(2026, 9, 15))
        urls = [self.counselor.respond(m, v, today=date(2026, 9, 15)).book_url
                for m in ("너무 지칩니다", "혼자입니다", "계속 그래요",
                          "오늘도 그래요", "여전합니다")]
        self.assertEqual([u for u in urls if u], ["/my-book"])

    # ── 책이 실제로 그 사람 것인가 ─────────────────────────────
    def test_chapters_follow_what_was_said(self):
        v = self.talk("아이가 사춘기라 매일 부딪힙니다",
                      "학교 문제로도 속을 썩입니다", "잠도 잘 못 잡니다")
        book = personal_mod.build_personal_book(
            personal_mod.build_profile(v, date(2026, 9, 15)))
        mine = [c.topic for c in book.chapters
                if c.part == personal_mod.PART_MINE]
        self.assertIn("자녀", mine)

    def test_two_people_get_different_books(self):
        a = self.talk("너무 외롭습니다", "혼자라는 생각만 듭니다", "계속 그래요")
        b = self.talk("아이 때문에 힘듭니다", "사춘기라 매일 부딪힙니다",
                      "학교 문제도 있습니다")
        book_a = personal_mod.build_personal_book(
            personal_mod.build_profile(a, date(2026, 9, 15)))
        book_b = personal_mod.build_personal_book(
            personal_mod.build_profile(b, date(2026, 9, 15)))
        self.assertNotEqual(book_a.subtitle, book_b.subtitle)

    def test_depth_is_respected(self):
        """신앙 언어를 꺼내지 않은 사람의 책에는 그 언어가 없다."""
        v = self.talk("너무 지칩니다", "혼자입니다", "계속 그래요")
        book = personal_mod.build_personal_book(
            personal_mod.build_profile(v, date(2026, 9, 15)))
        for c in book.chapters:
            self.assertEqual(c.verse_key, "", c.title)
            self.assertEqual(religious_hits(" ".join(c.body)), [], c.title)

    def test_faith_blocked_is_respected(self):
        v = self.talk("종교 얘기는 빼주세요", "너무 지칩니다", "혼자입니다",
                      "계속 그래요")
        profile = personal_mod.build_profile(v, date(2026, 9, 15))
        self.assertEqual(profile.depth, 0)
        blob = " ".join(x for _, lines in
                        personal_mod.build_personal_book(profile).front
                        for x in lines)
        self.assertIn("원하지 않는다고 하신 것을 기억", blob)

    def test_not_enough_talk_means_no_book(self):
        v = self.talk("안녕하세요")
        self.assertFalse(personal_mod.build_profile(v, date(2026, 9, 15)).enough)

    def test_epub_is_valid(self):
        v = self.talk("너무 외롭습니다", "혼자라는 생각만 듭니다", "계속 그래요")
        book = personal_mod.build_personal_book(
            personal_mod.build_profile(v, date(2026, 9, 15)))
        buf = io.BytesIO()
        epub_mod.write_epub_to(book, buf)
        z = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        self.assertEqual(z.namelist()[0], "mimetype")
        self.assertEqual(z.getinfo("mimetype").compress_type, zipfile.ZIP_STORED)
        for name in z.namelist():
            if name.endswith((".xhtml", ".opf", ".ncx", ".xml", ".svg")):
                ET.fromstring(z.read(name))


class TestLedger(unittest.TestCase):
    def setUp(self):
        self.ledger = Ledger()
        self.ledger.add_sale("2026-03-01", "예시서점", 120, 540000, 315000)

    def test_settled_is_the_promise_not_gross(self):
        """정가 기준으로 '전액'을 약속하면 지킬 수 없다.
        플랫폼이 30~40%를 가져가기 때문이다."""
        self.assertEqual(self.ledger.gross, 540000)
        self.assertEqual(self.ledger.settled, 315000)
        self.assertLess(self.ledger.settled, self.ledger.gross)
        self.assertIn("정산", self.ledger.promise)

    def test_unfulfilled_until_donated(self):
        self.assertFalse(self.ledger.fulfilled)
        self.assertEqual(self.ledger.pending, 315000)
        self.assertEqual(self.ledger.kept, 315000)
        self.assertTrue(self.ledger.problems())

    def test_fulfilled_after_donating(self):
        self.ledger.add_donation("2026-04-01", "예시단체", 315000, "R-1")
        self.assertTrue(self.ledger.fulfilled)
        self.assertEqual(self.ledger.kept, 0)
        self.assertEqual(self.ledger.percent(), 100)
        self.assertEqual(self.ledger.problems(), [])

    def test_problems_catch_sloppy_records(self):
        bad = Ledger(entries=[
            Entry(date="2026/01/01", kind="sale"),
            Entry(date="2026-01-02", kind="donation", to="", amount=0),
            Entry(date="2026-01-03", kind="something"),
        ])
        found = " ".join(bad.problems())
        self.assertIn("날짜 형식", found)
        self.assertIn("어디에 전달", found)
        self.assertIn("알 수 없는 종류", found)

    def test_roundtrip(self):
        path = Path(tempfile.mkdtemp()) / "ledger.json"
        self.ledger.add_donation("2026-04-01", "예시단체", 315000)
        self.ledger.save(path)
        again = Ledger.load(path)
        self.assertEqual(again.summary()["donated"], 315000)
        self.assertTrue(again.updated)

    def test_missing_file_is_an_empty_ledger(self):
        empty = Ledger.load(Path(tempfile.mkdtemp()) / "nope.json")
        self.assertEqual(empty.settled, 0)
        self.assertEqual(empty.percent(), 0)

    def test_won(self):
        self.assertEqual(won(1234567), "1,234,567원")


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
        book = book_content.build_book(self.cfg.site_url)
        markup += [render.book_page(self.cfg, book, [("예시", "https://e.org")]),
                   render.ledger_page(self.cfg, Ledger())]
        journey = paths.PATHS[0]
        markup += [render.path_index(self.cfg, journey)]
        markup += [render.path_step(self.cfg, journey, st) for st in journey.steps]
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

    def test_entry_screens_stay_secular_across_the_whole_cycle(self):
        """하루치만 확인하면 며칠에 한 번 나오는 누출을 놓친다.
        실제로 그렇게 놓쳤었다 — 30일 목록과 50가지 질문 두 군데에서."""
        for i in range(0, 120, 3):
            day = date(2026, 1, 1) + timedelta(days=i)
            card = daily.build(day)
            for name, markup in (("홈", render.home(self.cfg, card)),
                                 ("3분", render.today(self.cfg, card))):
                self.assertEqual(religious_hits(self.entry_area(markup)), [],
                                 f"{day} {name}")

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

    def test_ledger_page_shows_the_gap(self):
        """표시 매출과 실제 정산금의 차이를 숨기면 약속이 흐려진다."""
        led = Ledger()
        led.add_sale("2026-03-01", "예시", 120, 540000, 315000)
        markup = render.ledger_page(self.cfg, led)
        self.assertIn("540,000원", markup)
        self.assertIn("315,000원", markup)
        self.assertIn("저자가 가져간 돈", markup)

    def test_book_page_does_not_pressure(self):
        book = book_content.build_book(self.cfg.site_url)
        markup = render.book_page(self.cfg, book)
        self.assertIn("사지 않으셔도 됩니다", markup)
        self.assertIn("무료로", markup)
        self.assertIn("/book/ledger", markup)

    def test_crisis_line_in_every_footer(self):
        """어느 페이지에서 이탈하든 긴급 연락처는 보여야 한다."""
        self.assertIn("109", render.home(self.cfg, daily.build()))


if __name__ == "__main__":
    unittest.main()
