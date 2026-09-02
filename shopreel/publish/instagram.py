# -*- coding: utf-8 -*-
"""Instagram 릴스 업로드 (Graph API).

필요 환경변수
  IG_USER_ID / IG_ACCESS_TOKEN
필수 조건
  Graph API 는 로컬 파일을 받지 않고 **공개 URL** 을 받는다.
  config 의 public_video_base 또는 PUBLIC_VIDEO_BASE 에 영상이 올라가는
  공개 베이스 URL(예: https://cdn.example.com/reels)을 지정해야 한다.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict

from ..config import Config
from ..models import PostResult
from ..sources.base import http, qs
from .base import Publisher

GRAPH = "https://graph.facebook.com/v21.0"


class InstagramPublisher(Publisher):
    name = "instagram"
    needs = ("IG_USER_ID", "IG_ACCESS_TOKEN")

    def public_url(self, video: Path, cfg: Config) -> str:
        base = (cfg.public_video_base or os.environ.get("PUBLIC_VIDEO_BASE") or "").rstrip("/")
        return f"{base}/{Path(video).name}" if base else ""

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        url = self.public_url(video, cfg)
        if not url:
            return PostResult(platform=self.name, ok=False, status="queued",
                              message="공개 영상 URL(public_video_base) 미설정 — 대기열에 보관")

        user, token = os.environ["IG_USER_ID"], os.environ["IG_ACCESS_TOKEN"]
        try:
            raw = http(f"{GRAPH}/{user}/media", method="POST",
                       data=qs({"media_type": "REELS", "video_url": url,
                                "caption": self.caption(meta),
                                "share_to_feed": "true",
                                "access_token": token}).encode("utf-8"),
                       headers={"Content-Type": "application/x-www-form-urlencoded"})
            creation_id = json.loads(raw.decode("utf-8")).get("id")
            if not creation_id:
                return self.error("컨테이너 생성 실패")

            # 인코딩이 끝날 때까지 대기 (최대 5분)
            for _ in range(30):
                status_raw = http(f"{GRAPH}/{creation_id}?"
                                  f"{qs({'fields': 'status_code', 'access_token': token})}")
                code = json.loads(status_raw.decode("utf-8")).get("status_code")
                if code == "FINISHED":
                    break
                if code == "ERROR":
                    return self.error("미디어 인코딩 실패")
                time.sleep(10)

            pub = http(f"{GRAPH}/{user}/media_publish", method="POST",
                       data=qs({"creation_id": creation_id,
                                "access_token": token}).encode("utf-8"),
                       headers={"Content-Type": "application/x-www-form-urlencoded"})
            post_id = json.loads(pub.decode("utf-8")).get("id", "")
            return self.done(post_id, url=f"https://www.instagram.com/reel/{post_id}"
                             if post_id else "")
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")
