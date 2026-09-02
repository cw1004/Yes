# -*- coding: utf-8 -*-
"""YouTube 업로드 테스트 (목 서버로 전 구간 검증).

실제 채널에 올리지 않고 토큰 갱신 → 재개형 세션 → 청크 전송 → 썸네일까지
같은 코드 경로를 태운다. 받은 바이트가 원본과 일치하는지도 확인한다.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
import unittest
from pathlib import Path

from shopreel.config import Config
from shopreel.publish import youtube as yt
from tools.mock_youtube import start, env_for


def make_video(path: Path, size: int) -> bytes:
    data = os.urandom(size)
    path.write_bytes(data)
    return data


class YouTubeUploadTestCase(unittest.TestCase):
    mode = "ok"

    def setUp(self):
        self.httpd, self.base, self.handler = start(self.mode)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config(out_dir=Path(self.tmp.name), aspect="9:16")
        self.video = Path(self.tmp.name) / "reel.mp4"
        self.data = make_video(self.video, 300_000)
        self._saved = {k: os.environ.get(k) for k in
                       ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN",
                        "YOUTUBE_TOKEN_URL", "YOUTUBE_API_BASE", "YOUTUBE_PRIVACY",
                        "YOUTUBE_PUBLISH_AT", "YOUTUBE_THUMBNAIL", "YOUTUBE_COMMENT")}
        os.environ.update(env_for(self.base))
        self._chunk = yt.CHUNK
        yt.CHUNK = 64 * 1024              # 여러 청크로 나뉘게 (재개 로직 검증)
        self.meta = {
            "code": "abc123",
            "title": "40% 할인 | 코시 접이식 LED 스탠드",
            "description": "이 영상은 제휴 링크를 포함합니다. #광고\n\n구매 링크: https://x.test/r/abc123",
            "hashtags": ["#광고", "#쿠팡", "#꿀템"],
            "thumbnail": "",
        }

    def tearDown(self):
        yt.CHUNK = self._chunk
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class UploadTest(YouTubeUploadTestCase):
    def test_upload_transfers_file_intact(self):
        result = yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        self.assertTrue(result.ok, result.message)
        self.assertEqual(result.status, "published")
        self.assertTrue(result.url.startswith("https://youtube.com/shorts/"))

        self.assertEqual(len(self.handler.uploads), 1)
        up = self.handler.uploads[0]
        self.assertEqual(up["size"], len(self.data))
        self.assertEqual(up["sha1"], hashlib.sha1(self.data).hexdigest())
        self.assertEqual(up["video_id"], result.post_id)

    def test_multiple_chunks_were_used(self):
        yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        puts = [c for c in self.handler.calls if c["method"] == "PUT"]
        self.assertGreater(len(puts), 1)          # 64KB 청크 × 300KB 파일

    def test_metadata_and_shorts_tag(self):
        yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        up = self.handler.uploads[0]
        self.assertEqual(up["title"], self.meta["title"])
        self.assertIn("#Shorts", up["description"])
        self.assertIn("제휴 링크", up["description"])
        self.assertEqual(up["tags"], ["광고", "쿠팡", "꿀템"])   # # 은 제거된다
        self.assertFalse(up["status"]["selfDeclaredMadeForKids"])
        self.assertTrue(up["status"]["containsSyntheticMedia"])  # AI 생성 고지
        self.assertEqual(up["status"]["privacyStatus"], "public")

    def test_title_is_clipped_to_platform_limit(self):
        meta = dict(self.meta, title="가" * 300)
        yt.YouTubePublisher().publish(self.video, meta, self.cfg)
        self.assertLessEqual(len(self.handler.uploads[0]["title"]), 100)

    def test_scheduled_publish_forces_private(self):
        os.environ["YOUTUBE_PUBLISH_AT"] = "2030-01-01T09:00:00Z"
        yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        status = self.handler.uploads[0]["status"]
        self.assertEqual(status["privacyStatus"], "private")
        self.assertEqual(status["publishAt"], "2030-01-01T09:00:00Z")

    def test_thumbnail_uploaded_when_present(self):
        thumb = Path(self.tmp.name) / "thumb.jpg"
        thumb.write_bytes(b"\xff\xd8\xff" + os.urandom(500))
        yt.YouTubePublisher().publish(self.video, dict(self.meta, thumbnail=str(thumb)),
                                      self.cfg)
        self.assertEqual(self.handler.uploads[0]["thumbnail_bytes"], thumb.stat().st_size)

    def test_thumbnail_can_be_disabled(self):
        thumb = Path(self.tmp.name) / "thumb.jpg"
        thumb.write_bytes(b"\xff\xd8\xff")
        os.environ["YOUTUBE_THUMBNAIL"] = "0"
        yt.YouTubePublisher().publish(self.video, dict(self.meta, thumbnail=str(thumb)),
                                      self.cfg)
        self.assertEqual(self.handler.uploads[0]["thumbnail_bytes"], 0)

    def test_link_comment_is_posted(self):
        meta = dict(self.meta, link="https://link.example.com/r/abc123",
                    product={"title": "코시 접이식 LED 스탠드"})
        result = yt.YouTubePublisher().publish(self.video, meta, self.cfg)
        self.assertTrue(result.ok)
        self.assertEqual(len(self.handler.comments), 1)
        comment = self.handler.comments[0]
        self.assertEqual(comment["video_id"], result.post_id)
        self.assertIn("https://link.example.com/r/abc123", comment["text"])
        self.assertIn("코시 접이식 LED 스탠드", comment["text"])
        self.assertIn("제휴 링크", comment["text"])      # 댓글에도 광고 표기
        self.assertIn("댓글", result.message)

    def test_comment_can_be_disabled(self):
        os.environ["YOUTUBE_COMMENT"] = "0"
        try:
            yt.YouTubePublisher().publish(
                self.video, dict(self.meta, link="https://x.test/r/a"), self.cfg)
        finally:
            os.environ.pop("YOUTUBE_COMMENT", None)
        self.assertEqual(self.handler.comments, [])

    def test_missing_file_is_error(self):
        result = yt.YouTubePublisher().publish(Path(self.tmp.name) / "없다.mp4",
                                               self.meta, self.cfg)
        self.assertEqual(result.status, "error")


class FlakyUploadTest(YouTubeUploadTestCase):
    mode = "flaky"        # 첫 청크에서 500 → 재시도 후 이어서 전송

    def test_retries_and_completes_without_corruption(self):
        result = yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        self.assertTrue(result.ok, result.message)
        up = self.handler.uploads[0]
        self.assertEqual(up["sha1"], hashlib.sha1(self.data).hexdigest())
        self.assertEqual(up["size"], len(self.data))


class NoCommentScopeTest(YouTubeUploadTestCase):
    mode = "noscope"      # 예전 토큰이라 youtube.force-ssl 스코프가 없는 상황

    def test_upload_succeeds_even_if_comment_fails(self):
        result = yt.YouTubePublisher().publish(
            self.video, dict(self.meta, link="https://x.test/r/a"), self.cfg)
        self.assertTrue(result.ok)                    # 업로드 자체는 성공
        self.assertEqual(result.status, "published")
        self.assertIn("force-ssl", result.message)    # 재발급 안내
        self.assertEqual(self.handler.comments, [])


class QuotaTest(YouTubeUploadTestCase):
    mode = "quota"        # 일일 할당량 소진

    def test_quota_error_is_queued_not_failed(self):
        result = yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        self.assertFalse(result.ok)
        self.assertEqual(result.status, "queued")     # 다음 실행에서 재시도된다
        self.assertIn("quotaExceeded", result.message)


class BadTokenTest(YouTubeUploadTestCase):
    mode = "badtoken"

    def test_invalid_refresh_token_is_error(self):
        result = yt.YouTubePublisher().publish(self.video, self.meta, self.cfg)
        self.assertEqual(result.status, "error")
        self.assertIn("400", result.message)


class CredentialTest(unittest.TestCase):
    def test_missing_credentials_are_skipped(self):
        saved = {k: os.environ.pop(k, None) for k in
                 ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN")}
        try:
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)
            video = Path(tmp.name) / "v.mp4"
            video.write_bytes(b"x")
            result = yt.YouTubePublisher().publish(video, {"title": "t", "description": "d"},
                                                   Config(out_dir=Path(tmp.name)))
            self.assertEqual(result.status, "skipped")
            self.assertIn("환경변수", result.message)
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
