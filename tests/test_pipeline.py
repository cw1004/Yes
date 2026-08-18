# -*- coding: utf-8 -*-
"""빠른 무결성 테스트: python3 -m unittest discover -s tests"""

import json
import tempfile
import unittest
from pathlib import Path

from india2030.config import BEAT_ORDER, BEAT_SECONDS, Config
from india2030.episodes import (ACTS, TITLES, all_episodes, get_episode,
                                parse_range)
from india2030.pipeline import make_episode, write_srt
from india2030.scriptgen import build_script_template, load_script, save_script


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
        for no in (91, 92, 93, 94, 95):
            s = build_script_template(get_episode(no), Config())
            text = s.narration
            for banned in ("승리", "패배했", "탈락", "본선에 진출"):
                self.assertNotIn(banned, text, f"{no}화에 결과가 노출되었습니다")

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
            p = write_srt(s, Path(tmp) / "ep007.srt")
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
            self.assertTrue((Path(tmp) / "script" / "ep003.srt").exists())


if __name__ == "__main__":
    unittest.main()
