# -*- coding: utf-8 -*-
"""YouTube Data API v3 목(mock) 서버.

실제 채널에 올리지 않고 업로드 전 구간(토큰 갱신 → 재개형 세션 → 청크 전송 →
썸네일 지정)을 검증한다. 받은 바이트를 이어 붙여 **원본 파일과 동일한지**까지 확인하므로,
청크·재시도 로직이 파일을 망가뜨리면 여기서 잡힌다.

장애 상황도 재현한다.
  mode="flaky" : 첫 청크에서 한 번 500 을 던져 재시도·이어보내기를 시험
  mode="quota" : 세션 생성 시 403 quotaExceeded (할당량 소진)
  mode="badtoken" : refresh token 거부
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

ACCESS_TOKEN = "mock-access-token"


class MockYouTubeHandler(BaseHTTPRequestHandler):
    client_id = "mock-client-id"
    client_secret = "mock-client-secret"
    refresh_token = "mock-refresh-token"
    mode = "ok"
    sessions: Dict[str, Dict] = {}
    uploads: List[Dict] = []
    calls: List[Dict] = []
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        pass

    # -------------------------------------------------------------- 도우미
    def _send(self, code: int, body: bytes = b"", ctype: str = "application/json",
              extra: Optional[Dict[str, str]] = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code: int, payload: Dict, extra: Optional[Dict[str, str]] = None) -> None:
        self._send(code, json.dumps(payload).encode("utf-8"), "application/json", extra)

    def _error(self, code: int, reason: str, message: str) -> None:
        self._json(code, {"error": {"code": code, "message": message,
                                    "errors": [{"reason": reason, "message": message}]}})

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or 0)
        return self.rfile.read(length) if length else b""

    def _authorized(self) -> bool:
        if self.headers.get("Authorization") == f"Bearer {ACCESS_TOKEN}":
            return True
        self._error(401, "authError", "Invalid Credentials")
        return False

    def _base(self) -> str:
        return f"http://{self.headers.get('Host', '127.0.0.1')}"

    # -------------------------------------------------------------- POST
    def do_POST(self) -> None:            # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        type(self).calls.append({"method": "POST", "path": path})

        if path == "/token":
            form = {k: v[0] for k, v in parse_qs(self._body().decode("utf-8")).items()}
            if self.mode == "badtoken" or form.get("refresh_token") != self.refresh_token \
                    or form.get("client_id") != self.client_id \
                    or form.get("client_secret") != self.client_secret:
                return self._json(400, {"error": "invalid_grant",
                                        "error_description": "Token has been expired or revoked."})
            return self._json(200, {"access_token": ACCESS_TOKEN, "expires_in": 3599,
                                    "token_type": "Bearer"})

        if path == "/upload/youtube/v3/videos":
            if not self._authorized():
                return
            if self.mode == "quota":
                return self._error(403, "quotaExceeded",
                                   "The request cannot be completed because you have "
                                   "exceeded your quota.")
            meta = json.loads(self._body().decode("utf-8") or "{}")
            size = int(self.headers.get("X-Upload-Content-Length", "0") or 0)
            sid = uuid.uuid4().hex[:12]
            type(self).sessions[sid] = {"meta": meta, "size": size, "data": bytearray(),
                                        "failed_once": False}
            return self._send(200, b"", "application/json",
                              {"Location": f"{self._base()}/resumable/{sid}"})

        if path == "/upload/youtube/v3/thumbnails/set":
            if not self._authorized():
                return
            video_id = (parse_qs(parsed.query).get("videoId") or [""])[0]
            body = self._body()
            for up in type(self).uploads:
                if up["video_id"] == video_id:
                    up["thumbnail_bytes"] = len(body)
            return self._json(200, {"items": [{"default": {"url": "https://i.ytimg.com/x.jpg"}}]})

        self._error(404, "notFound", f"no such endpoint: {path}")

    # -------------------------------------------------------------- PUT
    def do_PUT(self) -> None:             # noqa: N802
        parsed = urlparse(self.path)
        m = re.match(r"^/resumable/([0-9a-f]+)$", parsed.path)
        if not m:
            return self._error(404, "notFound", "unknown upload session")
        sid = m.group(1)
        session = type(self).sessions.get(sid)
        if session is None:
            return self._error(404, "notFound", "expired upload session")

        content_range = self.headers.get("Content-Range", "")
        received = len(session["data"])
        type(self).calls.append({"method": "PUT", "path": parsed.path,
                                 "range": content_range})

        # 진행 상황 조회: "bytes */total"
        if content_range.startswith("bytes */"):
            if received == 0:
                return self._send(308, b"", "text/plain")
            return self._send(308, b"", "text/plain",
                              {"Range": f"bytes=0-{received - 1}"})

        body = self._body()
        m = re.match(r"bytes (\d+)-(\d+)/(\d+)", content_range)
        if not m:
            return self._error(400, "badRequest", f"bad Content-Range: {content_range}")
        start, end, total = (int(x) for x in m.groups())

        if self.mode == "flaky" and not session["failed_once"]:
            session["failed_once"] = True
            return self._error(500, "backendError", "일시적 서버 오류(테스트)")

        if start != received:            # 중복/누락 청크는 서버가 거부한다
            return self._send(308, b"", "text/plain",
                              {"Range": f"bytes=0-{max(0, received - 1)}"})

        session["data"].extend(body)
        received = len(session["data"])
        if received < total:
            return self._send(308, b"", "text/plain", {"Range": f"bytes=0-{received - 1}"})

        video_id = "vid_" + hashlib.sha1(bytes(session["data"])).hexdigest()[:8]
        snippet = session["meta"].get("snippet", {})
        type(self).uploads.append({
            "video_id": video_id,
            "bytes": bytes(session["data"]),
            "size": received,
            "sha1": hashlib.sha1(bytes(session["data"])).hexdigest(),
            "title": snippet.get("title", ""),
            "description": snippet.get("description", ""),
            "tags": snippet.get("tags", []),
            "status": session["meta"].get("status", {}),
            "thumbnail_bytes": 0,
        })
        type(self).sessions.pop(sid, None)
        return self._json(200, {"id": video_id, "kind": "youtube#video",
                                "snippet": snippet,
                                "status": session["meta"].get("status", {})})


def start(mode: str = "ok", client_id: str = "mock-client-id",
          client_secret: str = "mock-client-secret",
          refresh_token: str = "mock-refresh-token", port: int = 0
          ) -> Tuple[ThreadingHTTPServer, str, type]:
    handler = type("BoundYouTubeHandler", (MockYouTubeHandler,), {
        "mode": mode, "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh_token, "sessions": {}, "uploads": [], "calls": [],
    })
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}", handler


def env_for(base: str) -> Dict[str, str]:
    """이 목 서버를 바라보게 하는 환경변수 묶음."""
    return {
        "YOUTUBE_CLIENT_ID": "mock-client-id",
        "YOUTUBE_CLIENT_SECRET": "mock-client-secret",
        "YOUTUBE_REFRESH_TOKEN": "mock-refresh-token",
        "YOUTUBE_TOKEN_URL": f"{base}/token",
        "YOUTUBE_API_BASE": base,
    }


def main() -> int:
    import os
    httpd, base, _ = start(os.environ.get("MOCK_YOUTUBE_MODE", "ok"),
                           port=int(os.environ.get("PORT", "8791")))
    print(f"유튜브 목 서버 시작: {base}")
    for k, v in env_for(base).items():
        print(f"  export {k}={v}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
