# -*- coding: utf-8 -*-
"""YouTube Shorts 업로드 (Data API v3, resumable upload).

필요 환경변수
  YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
선택
  YOUTUBE_PRIVACY(기본 public), YOUTUBE_CATEGORY_ID(기본 22)

refresh token 발급은 한 번만 하면 된다 (OAuth 동의 화면 → youtube.upload 범위).
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Dict

from ..config import Config
from ..models import PostResult
from ..sources.base import SourceError, http, qs
from .base import Publisher

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = ("https://www.googleapis.com/upload/youtube/v3/videos"
              "?uploadType=resumable&part=snippet,status")


def access_token() -> str:
    body = qs({
        "client_id": os.environ["YOUTUBE_CLIENT_ID"],
        "client_secret": os.environ["YOUTUBE_CLIENT_SECRET"],
        "refresh_token": os.environ["YOUTUBE_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    raw = http(TOKEN_URL, method="POST", data=body,
               headers={"Content-Type": "application/x-www-form-urlencoded"})
    token = json.loads(raw.decode("utf-8")).get("access_token")
    if not token:
        raise SourceError("YouTube 액세스 토큰 발급 실패")
    return token


class YouTubePublisher(Publisher):
    name = "youtube"
    needs = ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN")

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        video = Path(video)
        if not video.exists():
            return self.error(f"영상 파일 없음: {video}")

        try:
            token = access_token()
            payload = json.dumps({
                "snippet": {
                    "title": self.title(meta),
                    "description": self.caption(meta),
                    "tags": [t.lstrip("#") for t in meta.get("hashtags", [])][:15],
                    "categoryId": os.environ.get("YOUTUBE_CATEGORY_ID", "22"),
                },
                "status": {
                    "privacyStatus": os.environ.get("YOUTUBE_PRIVACY", "public"),
                    "selfDeclaredMadeForKids": False,
                    "containsSyntheticMedia": True,   # AI 생성 고지
                },
            }).encode("utf-8")

            size = video.stat().st_size
            req = urllib.request.Request(UPLOAD_URL, data=payload, method="POST", headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Length": str(size),
                "X-Upload-Content-Type": "video/mp4",
            })
            with urllib.request.urlopen(req, timeout=60) as resp:
                session_url = resp.headers.get("Location")
            if not session_url:
                return self.error("업로드 세션 생성 실패")

            put = urllib.request.Request(session_url, data=video.read_bytes(), method="PUT",
                                         headers={"Content-Type": "video/mp4",
                                                  "Content-Length": str(size)})
            with urllib.request.urlopen(put, timeout=900) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            vid = data.get("id", "")
            return self.done(vid, url=f"https://youtube.com/shorts/{vid}" if vid else "")
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")
