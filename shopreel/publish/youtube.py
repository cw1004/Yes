# -*- coding: utf-8 -*-
"""YouTube Shorts 업로드 (Data API v3 · 재개형 업로드).

필요 환경변수
  YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
    → refresh token 은 `python3 -m tools.youtube_auth` 로 한 번만 발급받으면 된다.
선택
  YOUTUBE_PRIVACY      public(기본) | unlisted | private
  YOUTUBE_CATEGORY_ID  기본 22 (People & Blogs)
  YOUTUBE_PUBLISH_AT   예약 발행 시각 (RFC3339, privacy=private 일 때만 유효)
  YOUTUBE_THUMBNAIL    0 이면 썸네일 업로드 생략 (채널 인증 전이면 실패한다)
  YOUTUBE_COMMENT      0 이면 상품 링크 댓글을 달지 않음 (기본 켬)

설명란은 '더보기'에 가려지지만 댓글은 항상 보이므로, 업로드 직후 상품 링크를
댓글로 남긴다. **댓글 고정(pin)은 YouTube API 가 지원하지 않아** 스튜디오에서
한 번 눌러 줘야 한다(영상당 3초). 댓글 작성에는 youtube.force-ssl 스코프가 필요하다.
  YOUTUBE_TOKEN_URL / YOUTUBE_API_BASE   테스트용 엔드포인트 교체

할당량 주의: 업로드 1건이 약 1,600 유닛을 쓴다. 기본 일일 할당량 10,000 유닛이면
하루 6건이 한계다. 할당량 초과는 오류가 아니라 '대기(queued)'로 기록해 다음 날
`shopreel publish` 로 재시도한다.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Optional, Tuple

from ..config import Config
from ..models import PostResult
from ..sources.base import SourceError, http, qs
from .base import Publisher

CHUNK = 8 * 1024 * 1024          # 256KB 배수여야 한다
MAX_RETRY = 5
UPLOAD_UNITS = 1600              # 업로드 1건당 소모 할당량(참고용)

# 할당량·일일 한도처럼 '나중에 다시 하면 되는' 오류
RETRIABLE_REASONS = {"quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded",
                     "uploadLimitExceeded", "backendError", "internalError"}


def token_url() -> str:
    return os.environ.get("YOUTUBE_TOKEN_URL") or "https://oauth2.googleapis.com/token"


def api_base() -> str:
    return os.environ.get("YOUTUBE_API_BASE") or "https://www.googleapis.com"


def access_token() -> str:
    body = qs({
        "client_id": os.environ["YOUTUBE_CLIENT_ID"],
        "client_secret": os.environ["YOUTUBE_CLIENT_SECRET"],
        "refresh_token": os.environ["YOUTUBE_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    raw = http(token_url(), method="POST", data=body,
               headers={"Content-Type": "application/x-www-form-urlencoded"})
    token = json.loads(raw.decode("utf-8")).get("access_token")
    if not token:
        raise SourceError("YouTube 액세스 토큰 발급 실패 (refresh token 을 확인하세요)")
    return token


def _request(url: str, *, method: str, headers: Dict[str, str],
             data: Optional[bytes] = None, timeout: int = 600
             ) -> Tuple[int, Dict[str, str], bytes]:
    """리다이렉트를 따라가지 않는 요청. (상태코드, 헤더, 본문) 을 그대로 돌려준다.

    재개형 업로드의 308 응답은 리다이렉트가 아니라 '이어서 보내라'는 신호다.
    """
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **kw):
            return None

    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()


def error_reason(body: bytes) -> str:
    """구글 오류 응답에서 reason 문자열을 뽑는다."""
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return ""
    err = data.get("error")
    if isinstance(err, dict):
        errors = err.get("errors") or []
        if errors and isinstance(errors[0], dict):
            return str(errors[0].get("reason", ""))
        return str(err.get("status", ""))
    return str(err or "")


class YouTubePublisher(Publisher):
    name = "youtube"
    needs = ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN")

    # ---------------------------------------------------------------- 메타데이터
    def snippet(self, meta: Dict, cfg: Config) -> Dict:
        title = self.title(meta)
        description = self.caption(meta)
        # 세로 숏폼은 제목이나 본문에 #Shorts 가 있어야 확실히 쇼츠로 분류된다
        if cfg.aspect == "9:16" and "#shorts" not in f"{title}{description}".lower():
            description = f"{description}\n\n#Shorts".strip()
        tags = [t.lstrip("#") for t in meta.get("hashtags", [])][:15]

        status: Dict[str, object] = {
            "privacyStatus": os.environ.get("YOUTUBE_PRIVACY", "public"),
            "selfDeclaredMadeForKids": False,
            "containsSyntheticMedia": True,          # AI 생성 고지
        }
        publish_at = os.environ.get("YOUTUBE_PUBLISH_AT")
        if publish_at:                               # 예약 발행은 private 상태에서만 동작
            status["privacyStatus"] = "private"
            status["publishAt"] = publish_at
        return {
            "snippet": {
                "title": title,
                "description": description,
                "tags": tags,
                "categoryId": os.environ.get("YOUTUBE_CATEGORY_ID", "22"),
            },
            "status": status,
        }

    # ---------------------------------------------------------------- 업로드
    def start_session(self, token: str, payload: Dict, size: int) -> str:
        url = (f"{api_base()}/upload/youtube/v3/videos"
               "?uploadType=resumable&part=snippet,status")
        status, headers, body = _request(url, method="POST", headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(size),
            "X-Upload-Content-Type": "video/mp4",
        }, data=json.dumps(payload).encode("utf-8"), timeout=60)
        if status not in (200, 201):
            raise SourceError(f"업로드 세션 생성 실패 (HTTP {status} "
                              f"{error_reason(body) or body[:200]!r})")
        location = headers.get("Location") or headers.get("location")
        if not location:
            raise SourceError("업로드 세션 URL(Location) 이 없습니다")
        return location

    def upload_file(self, session_url: str, path: Path, size: int,
                    on_log=lambda *_: None) -> Dict:
        """청크 단위로 올리고 308(이어서 보내기)·5xx(재시도)를 처리한다."""
        sent = 0
        attempt = 0
        with path.open("rb") as fh:
            while sent < size:
                fh.seek(sent)
                chunk = fh.read(CHUNK)
                end = sent + len(chunk) - 1
                status, headers, body = _request(
                    session_url, method="PUT",
                    headers={"Content-Type": "video/mp4",
                             "Content-Length": str(len(chunk)),
                             "Content-Range": f"bytes {sent}-{end}/{size}"},
                    data=chunk)

                if status in (200, 201):
                    return json.loads(body.decode("utf-8", "replace") or "{}")

                if status == 308:                     # 이어서 보내기
                    attempt = 0
                    rng = headers.get("Range") or headers.get("range") or ""
                    sent = int(rng.split("-")[-1]) + 1 if "-" in rng else sent + len(chunk)
                    on_log(f"    업로드 {sent * 100 // size}%")
                    continue

                if status >= 500 or status == 429:    # 일시적 오류 → 지수 백오프
                    attempt += 1
                    if attempt > MAX_RETRY:
                        raise SourceError(f"업로드 재시도 한도 초과 (HTTP {status})")
                    time.sleep(min(32, 2 ** attempt))
                    sent = self.resume_offset(session_url, size, fallback=sent)
                    continue

                raise SourceError(f"업로드 실패 (HTTP {status} "
                                  f"{error_reason(body) or body[:200]!r})")
        raise SourceError("업로드가 끝났는데 응답을 받지 못했습니다")

    def resume_offset(self, session_url: str, size: int, fallback: int = 0) -> int:
        """중단된 지점을 서버에 물어본다."""
        status, headers, _ = _request(session_url, method="PUT", timeout=60, headers={
            "Content-Length": "0", "Content-Range": f"bytes */{size}"})
        if status == 308:
            rng = headers.get("Range") or headers.get("range") or ""
            if "-" in rng:
                return int(rng.split("-")[-1]) + 1
            return 0
        return fallback

    def comment_text(self, meta: Dict, cfg: Config) -> str:
        """상품 링크 댓글. 광고 표기를 반드시 포함한다."""
        from .. import compliance
        link = meta.get("link") or ""
        product = meta.get("product") or {}
        title = str(product.get("title") or "")[:60]
        if cfg.lang == "ko":
            head = f"👉 상품 보기: {link}" if link else ""
            body = f"{title}\n{head}" if title else head
        else:
            head = f"👉 Get it here: {link}" if link else ""
            body = f"{title}\n{head}" if title else head
        return f"{body}\n\n{compliance.disclosure(cfg.lang, cfg.disclosure)}".strip()

    def post_comment(self, token: str, video_id: str, text: str) -> Tuple[bool, str]:
        """영상에 댓글을 단다. (성공 여부, 안내 메시지)"""
        if os.environ.get("YOUTUBE_COMMENT", "1") in ("0", "false", "no"):
            return False, ""
        if not text.strip():
            return False, ""
        payload = {"snippet": {"videoId": video_id,
                               "topLevelComment": {"snippet": {"textOriginal": text}}}}
        status, _, body = _request(f"{api_base()}/youtube/v3/commentThreads?part=snippet",
                                   method="POST", timeout=60, headers={
                                       "Authorization": f"Bearer {token}",
                                       "Content-Type": "application/json; charset=UTF-8",
                                   }, data=json.dumps(payload).encode("utf-8"))
        if status in (200, 201):
            return True, "링크 댓글 작성"
        reason = error_reason(body)
        if reason in ("insufficientPermissions", "forbidden", "authError"):
            return False, ("링크 댓글 실패: youtube.force-ssl 스코프가 필요합니다 "
                           "(python3 -m tools.youtube_auth 로 재발급)")
        return False, f"링크 댓글 실패: {reason or status}"

    def set_thumbnail(self, token: str, video_id: str, thumb: Path) -> bool:
        """썸네일 지정 (채널 인증 전이면 실패한다 — 실패해도 업로드는 성공)."""
        if os.environ.get("YOUTUBE_THUMBNAIL", "1") in ("0", "false", "no"):
            return False
        if not thumb or not Path(thumb).exists():
            return False
        url = (f"{api_base()}/upload/youtube/v3/thumbnails/set"
               f"?videoId={video_id}&uploadType=media")
        status, _, _ = _request(url, method="POST", headers={
            "Authorization": f"Bearer {token}", "Content-Type": "image/jpeg",
        }, data=Path(thumb).read_bytes(), timeout=120)
        return status in (200, 201)

    # ---------------------------------------------------------------- 진입점
    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        ok, why = self.available()
        if not ok:
            return self.skipped(why)
        video = Path(video)
        if not video.exists():
            return self.error(f"영상 파일 없음: {video}")

        size = video.stat().st_size
        try:
            token = access_token()
            session = self.start_session(token, self.snippet(meta, cfg), size)
            data = self.upload_file(session, video, size)
        except SourceError as e:
            message = str(e)
            # 할당량·속도 제한은 시간이 지나면 풀린다 → 대기열로 남겨 다음에 재시도
            if any(reason in message for reason in RETRIABLE_REASONS):
                return PostResult(platform=self.name, ok=False, status="queued",
                                  message=f"나중에 재시도: {message[:300]}")
            return self.error(message)
        except Exception as e:
            return self.error(f"{type(e).__name__}: {e}")

        video_id = str(data.get("id", ""))
        if not video_id:
            return self.error(f"업로드 응답에 video id 가 없습니다: {str(data)[:200]}")

        notes = []
        try:
            if self.set_thumbnail(token, video_id, Path(meta.get("thumbnail", ""))):
                notes.append("썸네일 적용")
        except Exception:
            notes.append("썸네일 적용 실패(채널 인증 필요)")
        try:
            ok_comment, note = self.post_comment(token, video_id,
                                                 self.comment_text(meta, cfg))
            if note:
                notes.append(note)
        except Exception as e:
            notes.append(f"링크 댓글 실패: {type(e).__name__}")

        return self.done(video_id, url=f"https://youtube.com/shorts/{video_id}",
                         message=" · ".join(notes))
