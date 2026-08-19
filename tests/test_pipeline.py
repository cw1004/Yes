# -*- coding: utf-8 -*-
"""빠른 무결성 테스트: python3 -m unittest discover -s tests"""

import json
import tempfile
import unittest
from pathlib import Path

from india2030.config import BEAT_ORDER, BEAT_SECONDS, Config
from india2030.episodes import (ACTS, TITLES, all_episodes, get_episode,
                                parse_range)
from india2030.langs import HI_TITLES, LANGUAGES, PACKS
from india2030.pipeline import make_episode, write_srt
from india2030.scriptgen import (build_script, build_script_template,
                                 load_script, save_script)


class TestEpisodes(unittest.TestCase):
    def test_100_titles(self):
        self.assertEqual(len(TITLES), 100)
        self.assertEqual(len(set(TITLES)), 100, "중복된 소제목이 있습니다")

    def test_acts_cover_all(self):
        covered = set()
        for act in ACTS:
            covered |= set(range(act.first, act.last + 1))
        self.assertEqual(covered, set(range(1, 101)))

    def test_episode_lookup(self):
        self.assertEqual(get_episode(1).act.no, 1)
        self.assertEqual(get_episode(100).act.no, 5)
        self.assertEqual(get_episode(20).slug, "ep020")
        with self.assertRaises(ValueError):
            get_episode(101)

    def test_parse_range(self):
        self.assertEqual(parse_range("1-3,7"), [1, 2, 3, 7])
        self.assertEqual(parse_range("5"), [5])
        self.assertEqual(parse_range("3-1"), [1, 2, 3])
        with self.assertRaises(ValueError):
            parse_range("0-2")


class TestLanguages(unittest.TestCase):
    def test_hindi_titles(self):
        self.assertEqual(len(HI_TITLES), 100)
        self.assertEqual(len(set(HI_TITLES)), 100, "중복된 힌디어 제목이 있습니다")
        for i, t in enumerate(HI_TITLES, 1):
            self.assertTrue(any("\u0900" <= ch <= "\u097f" for ch in t),
                            f"{i}화 힌디어 제목에 데바나가리 문자가 없습니다")

    def test_banks_are_parallel(self):
        """두 언어의 문장 뱅크 길이가 같아야 같은 시드에서 대응되는 문장이 뽑힌다."""
        ko, hi = PACKS["ko"], PACKS["hi"]
        for key in ("hook", "emotion", "action", "dream"):
            for act in range(1, 6):
                self.assertEqual(len(ko[key][act]), len(hi[key][act]), f"{key} ACT{act}")
        self.assertEqual(len(ko["message"]), len(hi["message"]))
        self.assertEqual(set(ko["hook_override"]), set(hi["hook_override"]))

    def test_hindi_narration_is_devanagari(self):
        cfg = Config(lang="hi")
        for no in (1, 40, 77, 100):
            s = build_script_template(get_episode(no), cfg, lang="hi")
            for b in s.beats:
                self.assertTrue(any("\u0900" <= ch <= "\u097f" for ch in b.narration),
                                f"{no}화 {b.name} 내레이션이 힌디어가 아닙니다")

    def test_hindi_voice_and_font_lang(self):
        cfg = Config(lang="hi")
        self.assertEqual(cfg.resolved_tts_lang(), "hi")
        self.assertTrue(cfg.resolved_voice().startswith("hi-"))
        self.assertEqual(Config(lang="hi", tts_voice="hi-IN-SwaraNeural").resolved_voice(),
                         "hi-IN-SwaraNeural")

    def test_mixed_narration_and_caption(self):
        """힌디어 내레이션 + 한국어 자막 조합."""
        cfg = Config(lang="hi", caption_lang="ko")
        ep = get_episode(16)
        s = build_script(ep, cfg)
        self.assertEqual(s.lang, "hi")
        self.assertEqual(s.caption_lang, "ko")
        for b in s.beats:
            self.assertTrue(any("\u0900" <= ch <= "\u097f" for ch in b.narration))
            self.assertTrue(any("\uac00" <= ch <= "\ud7a3" for ch in b.caption))

    def test_all_languages_build(self):
        for lang in LANGUAGES:
            cfg = Config(lang=lang)
            for ep in all_episodes():
                s = build_script_template(ep, cfg, lang=lang)
                self.assertAlmostEqual(s.total_seconds, 60.0, places=3)
                for b in s.beats:
                    self.assertTrue(b.narration.strip(), f"{lang} {ep.no}화 {b.name}")
                    self.assertTrue(b.caption.strip(), f"{lang} {ep.no}화 {b.name}")


class TestScript(unittest.TestCase):
    def test_all_scripts_are_60s_and_5_beats(self):
        for ep in all_episodes():
            s = build_script_template(ep, Config())
            self.assertEqual([b.name for b in s.beats], BEAT_ORDER, f"{ep.no}화 비트 구성 오류")
            self.assertAlmostEqual(s.total_seconds, 60.0, places=3, msg=f"{ep.no}화 길이 오류")
            for b in s.beats:
                self.assertTrue(b.narration.strip(), f"{ep.no}화 {b.name} 내레이션 비어있음")
                self.assertTrue(b.image_prompt.strip())
                self.assertLessEqual(
                    len(b.narration), int(BEAT_SECONDS[b.name] * 5 * 1.4) + 2,
                    f"{ep.no}화 {b.name} 내레이션이 너무 깁니다",
                )

    def test_no_spoiler_episodes(self):
        banned = {
            "ko": ("승리", "패배했", "탈락", "본선에 진출"),
            "hi": ("जीत गया", "हार गया", "बाहर हो गया", "क्वालिफ़ाई कर लिया"),
        }
        for lang, words in banned.items():
            for no in (91, 92, 93, 94, 95):
                s = build_script_template(get_episode(no), Config(lang=lang), lang=lang)
                for w in words:
                    self.assertNotIn(w, s.narration, f"[{lang}] {no}화에 결과가 노출되었습니다")

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(out_dir=Path(tmp))
            cfg.ensure_dirs()
            s = build_script_template(get_episode(42), cfg)
            path = save_script(s, cfg)
            self.assertTrue(path.exists())
            loaded = load_script(42, cfg)
            self.assertEqual(loaded.title, s.title)
            self.assertEqual(len(loaded.beats), 5)
            json.loads(path.read_text(encoding="utf-8"))

    def test_srt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(out_dir=Path(tmp))
            s = build_script_template(get_episode(7), cfg)
            p = write_srt(s, Path(tmp) / "ep007.ko.srt")
            body = p.read_text(encoding="utf-8")
            self.assertIn("-->", body)
            self.assertTrue(body.startswith("1\n"))


class TestPipelineDryRun(unittest.TestCase):
    def test_dry_run_makes_script_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(out_dir=Path(tmp), dry_run=True)
            res = make_episode(3, cfg, on_log=lambda *_: None)
            self.assertTrue(res.ok, res.error)
            self.assertIsNone(res.video)
            self.assertTrue((Path(tmp) / "script" / "ep003.json").exists())
            self.assertTrue((Path(tmp) / "script" / "ep003.ko.srt").exists())

    def test_dry_run_hindi_writes_both_srt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(out_dir=Path(tmp), dry_run=True, lang="hi", caption_lang="ko")
            res = make_episode(3, cfg, on_log=lambda *_: None)
            self.assertTrue(res.ok, res.error)
            self.assertTrue((Path(tmp) / "script" / "ep003.hi.srt").exists())
            self.assertTrue((Path(tmp) / "script" / "ep003.ko.srt").exists())


if __name__ == "__main__":
    unittest.main()
