# -*- coding: utf-8 -*-
"""Instagram 릴스 업로드 (Graph API).

필요 환경변수
  IG_USER_ID / IG_ACCESS_TOKEN
선택
  PUBLIC_VIDEO_BASE   영상 공개 URL 베이스. 비우면 추적 서버의 /v 를 쓴다
                      (config.tracker_base + "/v" → https://내도메인/v/<key>.mp4)
  IG_THUMB_OFFSET     커버로 쓸 지점(밀리초, 기본 2000)
  IG_SHARE_TO_FEED    0 이면 릴스 탭에만 노출 (기본 1)
  IG_GRAPH_BASE       테스트용 엔드포인트 교체

Graph API 는 로컬 파일을 받지 않고 **공개 URL** 만 받는다. `shopreel serve` 로 띄운
추적 서버를 공개 도메인에 두면 별도 스토리지 없이 그 서버가 영상을 서빙한다.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from ..config import Config
from ..models import PostResult
from ..sources.base import SourceError, http
from .base import Publisher

# 잠시 뒤 다시 하면 되는 오류 (일일 게시 한도·속도 제한)
RETRIABLE_CODES = {4, 17, 32, 613, 80007}
MAX_WAIT = 300.0            # 인코딩 대기 상한(초)
POLL_START = 3.0            # 첫 폴링 간격 (이후 1.4배씩 늘어난다)
POLL_MAX = 15.0


def graph() -> str:
    return os.environ.get("IG_GRAPH_BASE") or "https://graph.facebook.com/v21.0"


def _post(url: str, params: Dict[str, str], timeout: int = 120) -> Dict:
    from urllib.parse import urlencode
    raw = http(url, method="POST", data=urlencode(params).encode("utf-8"),
               headers={"Content-Type": "application/x-www-form-urlencoded"},
               timeout=timeout)
    return json.loads(raw.decode("utf-8") or "{}")


def _get(url: str, params: Dict[str, str], timeout: int = 60) -> Dict:
    from urllib.parse import urlencode
    raw = http(f"{url}?{urlencode(params)}", timeout=timeout)
    return json.loads(raw.decode("utf-8") or "{}")


def error_code(message: str) -> Optional[int]:
    """SourceError 메시지에 실려 온 Graph API 오류 본문에서 코드를 뽑는다."""
    start = message.find("{")
    if start < 0:
        return None
    try:
        data = json.loads(message[start:message.rfind("}") + 1])
    except Exception:
        return None
    err = data.get("error") if isinstance(data, dict) else None
    return int(err.get("code")) if isinstance(err, dict) and err.get("code") else None


class InstagramPublisher(Publisher):
    name = "instagram"
    needs = ("IG_USER_ID", "IG_ACCESS_TOKEN")

    # ---------------------------------------------------------------- 영상 URL
    def public_url(self, video: Path, cfg: Config) -> str:
        base = (cfg.public_video_base or os.environ.get("PUBLIC_VIDEO_BASE") or "").rstrip("/")
        if not base:
            tracker = (cfg.tracker_base or "").rstrip("/")
            # 로컬 주소는 인스타그램 서버가 접근할 수 없다
            if tracker and not any(h in tracker for h in ("localhost", "127.0.0.1", "0.0.0.0")):
                base = f"{tracker}/v"
        return f"{base}/{Path(video).name}" if base else ""

    # ---------------------------------------------------------------- 컨테이너
    def create_container(self, user: str, token: str, video_url: str,
                         caption: str) -> str:
        params = {
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": "false" if os.environ.get("IG_SHARE_TO_FEED") in
                             ("0", "false", "no") else "true",
            "thumb_offset": os.environ.get("IG_THUMB_OFFSET", "2000"),
            "access_token": token,
        }
        data = _post(f"{graph()}/{user}/media", params)
        creation_id = str(data.get("id", ""))
        if not creation_id:
            raise SourceError(f"컨테이너 생성 실패: {json.dumps(data)[:300]}")
        return creation_id

    def wait_ready(self, creation_id: str, token: str,
                   on_log=lambda *_: None) -> None:
        """인코딩이 끝날 때까지 기다린다 (점점 간격을 늘려 가며)."""
        waited, delay = 0.0, POLL_START
        while waited < MAX_WAIT:
            data = _get(f"{graph()}/{creation_id}",
                        {"fields": "status_code,status", "access_token": token})
            code = str(data.get("status_code", ""))
            if code == "FINISHED":
                return
            if code == "ERROR":
                raise SourceError(f"미디어 인코딩 실패: {data.get('status', '')}"[:300])
            on_log(f"    인코딩 대기 {int(waited)}초 ({code or '...'})")
            time.sleep(delay)
            waited += delay
            delay = min(POLL_MAX, delay * 1.4)
        raise SourceError(f"인코딩이 {int(MAX_WAIT)}초 안에 끝나지 않았습니다")

    def publish_container(self, user: str, creation_id: str, token: str) -> str:
        data = _post(f"{graph()}/{user}/media_publish",
                     {"creation_id": creation_id, "access_token": token})
        return str(data.get("id", ""))

    def permalink(self, media_id: str, token: str) -> str:
        try:
            data = _get(f"{graph()}/{media_id}", {"fields": "permalink",
                                                  "access_token": token})
            return str(data.get("permalink", ""))
        except Exception:
            return ""

    # ---------------------------------------------------------------- 진입점
    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        video = Path(video)
        if not video.exists():
            return self.error(f"영상 파일 없음: {video}")

        seconds = float(meta.get("seconds") or 0)
        if 0 < seconds < 3:
            return self.error(f"릴스는 3초 이상이어야 합니다 (현재 {seconds:.1f}초)")

        url = self.public_url(video, cfg)
        if not url:
            return PostResult(
                platform=self.name, ok=False, status="queued",
                message=("공개 영상 URL 이 없습니다. 추적 서버를 공개 도메인에 두고 "
                         "tracker_base 를 그 주소로 설정하거나 PUBLIC_VIDEO_BASE 를 지정하세요"))

        user, token = os.environ["IG_USER_ID"], os.environ["IG_ACCESS_TOKEN"]
        try:
            creation_id = self.create_container(user, token, url, self.caption(meta))
            self.wait_ready(creation_id, token)
            media_id = self.publish_container(user, creation_id, token)
        except SourceError as e:
            code = error_code(str(e))
            if code in RETRIABLE_CODES:
                return PostResult(platform=self.name, ok=False, status="queued",
                                  message=f"나중에 재시도(code {code}): {str(e)[:250]}")
            return self.error(str(e))
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")

        if not media_id:
            return self.error("게시 응답에 media id 가 없습니다")
        link = self.permalink(media_id, token)
        return self.done(media_id, url=link or f"https://www.instagram.com/reel/{media_id}")
