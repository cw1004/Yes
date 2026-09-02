# -*- coding: utf-8 -*-
"""수집 소스 공통 뼈대.

모든 소스는 (1) 키가 없으면 스스로 '사용 불가'라고 알리고 (2) 실패해도 예외를
바깥으로 던지지 않는다. 한 소스가 죽어도 파이프라인 전체는 계속 돌아야 한다.
"""

from __future__ import annotations

import gzip
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..models import Product

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 20


class SourceError(RuntimeError):
    pass


def http(url: str, *, method: str = "GET", headers: Optional[Dict[str, str]] = None,
         data: Optional[bytes] = None, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept-Encoding", "gzip")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout,
                                    context=ssl.create_default_context()) as resp:
            body = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return body
    except urllib.error.HTTPError as e:
        detail = (e.read()[:400] or b"").decode("utf-8", "replace")
        raise SourceError(f"HTTP {e.code} {url.split('?')[0]} — {detail}") from e
    except Exception as e:                      # 네트워크 차단·타임아웃 등
        raise SourceError(f"요청 실패 {url.split('?')[0]} — {e}") from e


def http_json(url: str, **kw) -> Dict:
    raw = http(url, **kw)
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception as e:
        raise SourceError(f"JSON 파싱 실패 — {e}") from e


def env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return ""


def qs(params: Dict[str, object]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})


class Source:
    """수집 소스 인터페이스."""

    name = "base"
    network = "generic"        # 제휴 네트워크 키 (config.affiliate_for 에 사용)
    needs = ()                 # 필요한 환경변수 이름들

    def available(self) -> Tuple[bool, str]:
        missing = [n for n in self.needs if not os.environ.get(n)]
        if missing:
            return False, "환경변수 없음: " + ", ".join(missing)
        return True, "준비됨"

    def fetch(self, cfg: Config, limit: int) -> List[Product]:   # pragma: no cover - 인터페이스
        raise NotImplementedError

    # 편의 --------------------------------------------------------------
    def product(self, **kw) -> Product:
        kw.setdefault("source", self.network)
        return Product(**kw)


def to_float(v, default: float = 0.0) -> float:
    try:
        if isinstance(v, str):
            v = "".join(ch for ch in v if ch.isdigit() or ch in ".-")
        return float(v)
    except Exception:
        return default


def to_int(v, default: int = 0) -> int:
    return int(to_float(v, default))
