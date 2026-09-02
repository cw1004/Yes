# -*- coding: utf-8 -*-
"""Facebook 페이지 릴스/동영상 업로드 (Graph API, 파일 직접 전송).

필요 환경변수
  FB_PAGE_ID / FB_PAGE_TOKEN
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict

from ..config import Config
from ..models import PostResult
from ..sources.base import http
from .base import Publisher, multipart

GRAPH = "https://graph-video.facebook.com/v21.0"


class FacebookPublisher(Publisher):
    name = "facebook"
    needs = ("FB_PAGE_ID", "FB_PAGE_TOKEN")

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        video = Path(video)
        if not video.exists():
            return self.error(f"영상 파일 없음: {video}")

        page, token = os.environ["FB_PAGE_ID"], os.environ["FB_PAGE_TOKEN"]
        try:
            ctype, body = multipart(
                {"description": self.caption(meta), "title": self.title(meta),
                 "access_token": token},
                {"source": video})
            raw = http(f"{GRAPH}/{page}/videos", method="POST", data=body,
                       headers={"Content-Type": ctype}, timeout=900)
            data = json.loads(raw.decode("utf-8"))
            post_id = str(data.get("id", ""))
            return self.done(post_id,
                             url=f"https://www.facebook.com/{post_id}" if post_id else "")
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")
