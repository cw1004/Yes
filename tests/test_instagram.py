# -*- coding: utf-8 -*-
"""인스타그램 릴스 게시 테스트.

목 서버가 우리가 넘긴 video_url 을 **실제로 내려받아 본다**. 추적 서버가 영상을
공개로 서빙하는 것까지 한 번에 검증된다.
"""

from __future__ import annotations

import os
import tempfile
import threading
import unittest
from pathlib import Path

from shopreel.config import Config
from shopreel.publish import instagram as ig
from shopreel.store import Store
from shopreel.tracker import serve
from tools.mock_instagram import env_for, start

META = {
    "code": "abc123",
    "title": "40% 할인 | 코시 접이식 LED 스탠드",
    "description": "이 영상은 제휴 링크를 포함합니다. #광고\n\n구매 링크: https://x.test/r/abc",
    "hashtags": ["#광고", "#쿠팡"],
    "seconds": 30.0,
}


class InstagramTestCase(unittest.TestCase):
    mode = "ok"

    def setUp(self):
        self.httpd, self.base, self.handler = start(self.mode)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config(out_dir=Path(self.tmp.name))
        self.cfg.ensure_dirs()
        self.video = self.cfg.video_dir / "abc123def456.mp4"
        self.video.write_bytes(b"\x00\x00\x00 ftypmp42" + os.urandom(20_000))

        # 추적 서버를 띄워 영상을 공개 URL 로 서빙한다
        self.store = Store(self.cfg.db)
        self.tracker, _ = serve(self.cfg, host="127.0.0.1", port=0, store=self.store)
        threading.Thread(target=self.tracker.serve_forever, daemon=True).start()
        self.tracker_base = f"http://127.0.0.1:{self.tracker.server_address[1]}"

        self._saved = {k: os.environ.get(k) for k in
                       ("IG_USER_ID", "IG_ACCESS_TOKEN", "IG_GRAPH_BASE",
                        "PUBLIC_VIDEO_BASE", "IG_THUMB_OFFSET", "IG_SHARE_TO_FEED")}
        os.environ.update(env_for(self.base))
        os.environ["PUBLIC_VIDEO_BASE"] = f"{self.tracker_base}/v"
        self._poll = ig.POLL_START
        ig.POLL_START = 0.05

    def tearDown(self):
        ig.POLL_START = self._poll
        for server in (self.httpd, self.tracker):
            server.shutdown()
            server.server_close()
        self.tmp.cleanup()
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class PublishTest(InstagramTestCase):
    def test_publishes_reel_and_returns_permalink(self):
        result = ig.InstagramPublisher().publish(self.video, META, self.cfg)
        self.assertTrue(result.ok, result.message)
        self.assertEqual(result.status, "published")
        self.assertTrue(result.url.startswith("https://www.instagram.com/reel/"))
        self.assertEqual(len(self.handler.published), 1)

    def test_instagram_could_actually_download_the_video(self):
        """가장 흔한 실패(접근 불가한 URL 전달)를 실제 다운로드로 검증한다."""
        ig.InstagramPublisher().publish(self.video, META, self.cfg)
        probe = self.handler.published[0]["probe"]
        self.assertTrue(probe["ok"], probe)
        self.assertEqual(probe["bytes"], self.video.stat().st_size)
        self.assertEqual(probe["content_type"], "video/mp4")

    def test_caption_and_reel_options(self):
        os.environ["IG_THUMB_OFFSET"] = "1500"
        ig.InstagramPublisher().publish(self.video, META, self.cfg)
        item = self.handler.published[0]
        self.assertIn("제휴 링크", item["caption"])
        self.assertEqual(item["share_to_feed"], "true")
        self.assertEqual(item["thumb_offset"], "1500")

    def test_waits_for_encoding_before_publishing(self):
        ig.InstagramPublisher().publish(self.video, META, self.cfg)
        polls = [c for c in self.handler.calls
                 if c["method"] == "GET" and "container_" in c["path"]]
        self.assertGreaterEqual(len(polls), 3)      # IN_PROGRESS 2회 후 FINISHED

    def test_tracker_url_used_when_public_base_missing(self):
        os.environ.pop("PUBLIC_VIDEO_BASE")
        self.cfg.tracker_base = "https://link.example.com"
        url = ig.InstagramPublisher().public_url(self.video, self.cfg)
        self.assertEqual(url, "https://link.example.com/v/abc123def456.mp4")

    def test_localhost_tracker_is_not_used_as_public_url(self):
        os.environ.pop("PUBLIC_VIDEO_BASE")
        self.cfg.tracker_base = "http://localhost:8787"
        result = ig.InstagramPublisher().publish(self.video, META, self.cfg)
        self.assertEqual(result.status, "queued")   # 인스타그램이 접근할 수 없다
        self.assertIn("공개 영상 URL", result.message)

    def test_too_short_video_is_rejected(self):
        result = ig.InstagramPublisher().publish(self.video, dict(META, seconds=2.0),
                                                 self.cfg)
        self.assertEqual(result.status, "error")
        self.assertIn("3초", result.message)


class RateLimitTest(InstagramTestCase):
    mode = "ratelimit"

    def test_daily_limit_is_queued_not_failed(self):
        result = ig.InstagramPublisher().publish(self.video, META, self.cfg)
        self.assertEqual(result.status, "queued")
        self.assertIn("code 4", result.message)


class EncodingFailureTest(InstagramTestCase):
    mode = "encfail"

    def test_encoding_error_is_reported(self):
        result = ig.InstagramPublisher().publish(self.video, META, self.cfg)
        self.assertEqual(result.status, "error")
        self.assertIn("인코딩", result.message)


class BadTokenTest(InstagramTestCase):
    mode = "badtoken"

    def test_expired_token_is_error(self):
        result = ig.InstagramPublisher().publish(self.video, META, self.cfg)
        self.assertEqual(result.status, "error")


class CredentialTest(unittest.TestCase):
    def test_missing_credentials_are_skipped(self):
        saved = {k: os.environ.pop(k, None) for k in ("IG_USER_ID", "IG_ACCESS_TOKEN")}
        try:
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)
            video = Path(tmp.name) / "v.mp4"
            video.write_bytes(b"x")
            result = ig.InstagramPublisher().publish(video, META, Config(out_dir=Path(tmp.name)))
            self.assertEqual(result.status, "skipped")
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
