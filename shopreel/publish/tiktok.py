# -*- coding: utf-8 -*-
"""TikTok 업로드 (Content Posting API).

필요 환경변수
  TIKTOK_ACCESS_TOKEN
선택
  TIKTOK_DIRECT_POST=1  → 바로 게시(심사 통과 앱만). 기본은 '초안함(inbox)' 업로드.
  TIKTOK_PRIVACY(기본 PUBLIC_TO_EVERYONE)

주의: 제휴 링크가 있는 게시물은 TikTok 브랜디드 콘텐츠 정책에 따라 공개 표기가 필요하다.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Dict

from ..config import Config
from ..models import PostResult
from ..sources.base import http
from .base import Publisher

INBOX_INIT = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
DIRECT_INIT = "https://open.tiktokapis.com/v2/post/publish/video/init/"


class TikTokPublisher(Publisher):
    name = "tiktok"
    needs = ("TIKTOK_ACCESS_TOKEN",)

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        video = Path(video)
        if not video.exists():
            return self.error(f"영상 파일 없음: {video}")

        token = os.environ["TIKTOK_ACCESS_TOKEN"]
        size = video.stat().st_size
        direct = os.environ.get("TIKTOK_DIRECT_POST", "").lower() in ("1", "true", "yes")

        body: Dict = {
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": size,
                "chunk_size": size,
                "total_chunk_count": 1,
            }
        }
        if direct:
            body["post_info"] = {
                "title": self.title(meta),
                "privacy_level": os.environ.get("TIKTOK_PRIVACY", "PUBLIC_TO_EVERYONE"),
                "disable_comment": False,
                "brand_content_toggle": True,      # 제휴/브랜디드 콘텐츠 표기
                "brand_organic_toggle": False,
            }

        try:
            raw = http(DIRECT_INIT if direct else INBOX_INIT, method="POST",
                       data=json.dumps(body).encode("utf-8"),
                       headers={"Authorization": f"Bearer {token}",
                                "Content-Type": "application/json; charset=UTF-8"})
            data = json.loads(raw.decode("utf-8"))
            info = data.get("data") or {}
            upload_url, publish_id = info.get("upload_url"), info.get("publish_id")
            if not upload_url:
                return self.error(f"업로드 URL 없음: {json.dumps(data)[:300]}")

            put = urllib.request.Request(upload_url, data=video.read_bytes(), method="PUT",
                                         headers={"Content-Type": "video/mp4",
                                                  "Content-Length": str(size),
                                                  "Content-Range": f"bytes 0-{size - 1}/{size}"})
            urllib.request.urlopen(put, timeout=900).read()
            status = "published" if direct else "queued"
            note = "" if direct else "TikTok 앱 초안함에서 확인 후 게시하세요"
            return self.done(str(publish_id or ""), message=note, status=status)
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")
