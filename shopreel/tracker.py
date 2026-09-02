# -*- coding: utf-8 -*-
"""클릭 추적 리다이렉트 서버.

  GET  /                      → 링크인바이오 페이지 (프로필 링크에 거는 주소)
  GET  /shop?p=instagram      → 같은 페이지, 유입 플랫폼별로 추적 코드를 분리
  GET  /r/<code>              → 클릭 기록 후 제휴 링크로 302
  GET  /img/<key>.jpg         → 상품 썸네일
  GET  /v/<key>.mp4           → 영상 파일 (인스타그램 Graph API 가 공개 URL 을 요구한다)
  POST /postback              → 제휴 네트워크 전환 웹훅 (주문/수수료 기록)
  GET  /stats                 → 요약 JSON
  GET  /health                → 헬스체크

의존성 없이 표준 라이브러리만 쓴다. 실제 서비스에서는 앞단에 nginx/Cloudflare 를
두고 HTTPS 를 종단하는 것을 권장한다.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from . import landing
from .config import Config
from .store import Store

# 정적 파일 경로에 허용하는 이름 (경로 탈출 차단)
SAFE_NAME = re.compile(r"^[0-9a-zA-Z_-]{1,64}$")
MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
               ".mp4": "video/mp4"}

SALT = os.environ.get("SHOPREEL_IP_SALT", "shopreel")


def _ip_hash(ip: str) -> str:
    return hashlib.sha256(f"{SALT}{ip}".encode("utf-8")).hexdigest()[:32]


class Handler(BaseHTTPRequestHandler):
    store: Store
    cfg: Config
    server_version = "shopreel"

    # 기본 로그가 시끄러워서 요약만 남긴다
    def log_message(self, fmt: str, *args) -> None:  # noqa: D401
        if os.environ.get("SHOPREEL_ACCESS_LOG"):
            super().log_message(fmt, *args)

    # ---------------------------------------------------------------- 응답 도우미
    def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8",
              headers: Optional[Dict[str, str]] = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code: int, payload: Dict) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _serve_file(self, name: str, suffix: str) -> None:
        """output/shopreel/video/ 안의 파일만 내보낸다."""
        if not SAFE_NAME.match(name) or suffix not in MEDIA_TYPES:
            return self._send(404, b"not found")
        root = self.cfg.video_dir.resolve()
        path = (self.cfg.video_dir / f"{name}{suffix}").resolve()
        if suffix == ".jpg":
            # 카드에는 자막이 박힌 영상 썸네일 대신 상품 원본 사진을 우선 쓴다
            photo = (self.cfg.video_dir / f"{name}_photo.jpg").resolve()
            if root in photo.parents and photo.is_file():
                path = photo
        if root not in path.parents or not path.is_file():
            return self._send(404, b"not found")
        data = path.read_bytes()
        self._send(200, data, MEDIA_TYPES[suffix],
                   {"Cache-Control": "public, max-age=3600",
                    "Accept-Ranges": "none"})

    def _serve_shop(self, query: Dict[str, list]) -> None:
        platform = (query.get("p") or query.get("platform") or [""])[0][:24]
        items = self.store.shop_items(limit=24, platform=platform)
        page = landing.render(items, self.cfg, platform=platform)
        self._send(200, page.encode("utf-8"), "text/html; charset=utf-8",
                   {"Cache-Control": "public, max-age=120"})

    # ---------------------------------------------------------------- 라우팅
    def do_GET(self) -> None:            # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/health":
            return self._send(200, b"ok")

        if path == "/stats":
            return self._json(200, {
                "summary": self.store.summary(30),
                "platforms": self.store.platform_stats(30),
                "top": self.store.top_products(30, 10),
            })

        if path.startswith("/r/"):
            code = path[3:].split("/")[0]
            row = self.store.get_link(code)
            if not row:
                return self._send(404, "링크를 찾을 수 없습니다.".encode("utf-8"))
            client = self.client_address[0] if self.client_address else ""
            fwd = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            self.store.add_click(
                code,
                referrer=self.headers.get("Referer", ""),
                ua=self.headers.get("User-Agent", ""),
                ip_hash=_ip_hash(fwd or client),
            )
            return self._send(302, b"", headers={"Location": row["target"],
                                                 "Cache-Control": "no-store"})

        if path in ("/", "/shop"):
            return self._serve_shop(parse_qs(parsed.query))

        if path.startswith("/img/") or path.startswith("/v/"):
            name = path.split("/")[-1]
            stem, _, ext = name.rpartition(".")
            return self._serve_file(stem, f".{ext}" if ext else "")

        self._send(404, b"not found")

    def do_POST(self) -> None:           # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/") != "/postback":
            return self._send(404, b"not found")

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        params: Dict[str, str] = {}
        if raw.strip().startswith("{"):
            try:
                params = {k: str(v) for k, v in json.loads(raw).items()}
            except Exception:
                params = {}
        else:
            params = {k: v[0] for k, v in parse_qs(raw).items()}
        params.update({k: v[0] for k, v in parse_qs(parsed.query).items()})

        secret = os.environ.get("SHOPREEL_POSTBACK_SECRET")
        if secret and params.get("secret") != secret:
            return self._json(403, {"ok": False, "error": "secret 불일치"})

        code = params.get("code") or params.get("subid") or params.get("sub_id") or ""
        order_id = params.get("order_id") or params.get("orderId") or ""
        if not code or not order_id:
            return self._json(400, {"ok": False, "error": "code 와 order_id 가 필요합니다"})

        def num(name: str) -> float:
            try:
                return float(params.get(name, 0) or 0)
            except ValueError:
                return 0.0

        created = self.store.add_conversion(
            code=code, order_id=order_id, amount=num("amount"),
            commission=num("commission"), currency=params.get("currency", "USD"),
            network=params.get("network", ""), status=params.get("status", "pending"))
        return self._json(200, {"ok": True, "recorded": created})


def serve(cfg: Config, host: str = "0.0.0.0", port: int = 8787,
          store: Optional[Store] = None) -> Tuple[ThreadingHTTPServer, str]:
    """서버 객체와 주소를 돌려준다. 호출측에서 serve_forever() 를 부른다."""
    handler = type("BoundHandler", (Handler,), {
        "store": store or Store(cfg.db),
        "cfg": cfg,
    })
    httpd = ThreadingHTTPServer((host, port), handler)
    return httpd, f"http://{host}:{httpd.server_address[1]}"
