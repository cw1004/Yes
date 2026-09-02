# -*- coding: utf-8 -*-
"""업로드 제공자 공통 뼈대.

모든 퍼블리셔는 자격증명이 없으면 예외 대신 status='skipped' 를 돌려준다.
업로드 실패는 status='error' 로 기록되고 `shopreel publish --retry` 로 재시도한다.
"""

from __future__ import annotations

import json
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..models import PostResult

# 플랫폼별 제목/본문 길이 상한
LIMITS: Dict[str, Dict[str, int]] = {
    "youtube": {"title": 100, "body": 4900},
    "tiktok": {"title": 150, "body": 2100},
    "instagram": {"title": 120, "body": 2100},
    "facebook": {"title": 120, "body": 4900},
    "dryrun": {"title": 200, "body": 9000},
}


def clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def multipart(fields: Dict[str, str], files: Dict[str, Path]) -> Tuple[str, bytes]:
    """multipart/form-data 본문 생성 (외부 의존성 없이)."""
    boundary = f"----shopreel{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()
    for name, path in files.items():
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        body += f"--{boundary}\r\n".encode()
        body += (f'Content-Disposition: form-data; name="{name}"; '
                 f'filename="{Path(path).name}"\r\n').encode()
        body += f"Content-Type: {ctype}\r\n\r\n".encode()
        body += Path(path).read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return f"multipart/form-data; boundary={boundary}", bytes(body)


class Publisher:
    """업로드 제공자 인터페이스."""

    name = "base"
    needs: Tuple[str, ...] = ()

    def available(self) -> Tuple[bool, str]:
        missing = [n for n in self.needs if not os.environ.get(n)]
        if missing:
            return False, "환경변수 없음: " + ", ".join(missing)
        return True, "준비됨"

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:  # pragma: no cover
        raise NotImplementedError

    # 편의 --------------------------------------------------------------
    def caption(self, meta: Dict) -> str:
        limits = LIMITS.get(self.name, LIMITS["dryrun"])
        return clip(meta.get("description", ""), limits["body"])

    def title(self, meta: Dict) -> str:
        limits = LIMITS.get(self.name, LIMITS["dryrun"])
        return clip(meta.get("title", ""), limits["title"])

    def skipped(self, why: str) -> PostResult:
        return PostResult(platform=self.name, ok=False, status="skipped", message=why)

    def error(self, why: str) -> PostResult:
        return PostResult(platform=self.name, ok=False, status="error", message=why[:500])

    def done(self, post_id: str, url: str = "", message: str = "",
             status: str = "published") -> PostResult:
        return PostResult(platform=self.name, ok=True, status=status,
                          post_id=post_id, url=url, message=message)
