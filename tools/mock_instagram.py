# -*- coding: utf-8 -*-
"""Instagram Graph API 목(mock) 서버 (릴스 게시).

컨테이너 생성 → 인코딩 대기 → 게시 → 퍼머링크 조회까지 실제 흐름을 흉내 낸다.
**video_url 을 실제로 내려받아 본다**. 즉 우리가 넘긴 공개 URL 이 정말 바깥에서
접근 가능한지까지 확인되므로, 인스타그램 연동에서 가장 흔한 실패(로컬 주소를 넘김)를
여기서 잡을 수 있다.

  mode="ratelimit" : 컨테이너 생성 시 code 4 (일일 한도)
  mode="encfail"   : 인코딩 실패(status_code=ERROR)
  mode="badtoken"  : code 190 (토큰 만료)
"""

from __future__ import annotations

import json
import re
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

TOKEN = "mock-ig-token"
USER_ID = "17841400000000000"
ENCODING_POLLS = 2          # 이 횟수만큼 IN_PROGRESS 를 돌려준 뒤 FINISHED


class MockInstagramHandler(BaseHTTPRequestHandler):
    token = TOKEN
    user_id = USER_ID
    mode = "ok"
    containers: Dict[str, Dict] = {}
    published: List[Dict] = []
    calls: List[Dict] = []
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        pass

    # -------------------------------------------------------------- 도우미
    def _json(self, code: int, payload: Dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: int, message: str, api_code: int) -> None:
        self._json(code, {"error": {"message": message, "type": "OAuthException",
                                    "code": api_code, "fbtrace_id": "trace"}})

    def _form(self) -> Dict[str, str]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        return {k: v[0] for k, v in parse_qs(raw).items()}

    def _check_token(self, token: str) -> bool:
        if self.mode == "badtoken" or token != self.token:
            self._error(400, "Error validating access token", 190)
            return False
        return True

    @staticmethod
    def _probe(url: str) -> Dict:
        """인스타그램 서버가 하듯 실제로 영상 URL 을 받아 본다."""
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = resp.read()
            return {"ok": True, "bytes": len(data),
                    "content_type": resp.headers.get("Content-Type", "")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # -------------------------------------------------------------- POST
    def do_POST(self) -> None:            # noqa: N802
        parsed = urlparse(self.path)
        form = self._form()
        type(self).calls.append({"method": "POST", "path": parsed.path, "form": form})

        if not self._check_token(form.get("access_token", "")):
            return

        if re.match(rf"^/{self.user_id}/media$", parsed.path):
            if self.mode == "ratelimit":
                return self._error(400, "Application request limit reached", 4)
            probe = self._probe(form.get("video_url", ""))
            cid = "container_" + uuid.uuid4().hex[:8]
            type(self).containers[cid] = {
                "polls": 0, "caption": form.get("caption", ""),
                "video_url": form.get("video_url", ""),
                "share_to_feed": form.get("share_to_feed", ""),
                "thumb_offset": form.get("thumb_offset", ""),
                "probe": probe,
            }
            return self._json(200, {"id": cid})

        if re.match(rf"^/{self.user_id}/media_publish$", parsed.path):
            cid = form.get("creation_id", "")
            container = type(self).containers.get(cid)
            if container is None:
                return self._error(400, "Invalid creation_id", 100)
            media_id = "media_" + uuid.uuid4().hex[:8]
            type(self).published.append({"media_id": media_id, **container})
            return self._json(200, {"id": media_id})

        self._error(404, f"Unknown path {parsed.path}", 100)

    # -------------------------------------------------------------- GET
    def do_GET(self) -> None:             # noqa: N802
        parsed = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        type(self).calls.append({"method": "GET", "path": parsed.path, "query": query})

        if not self._check_token(query.get("access_token", "")):
            return

        node = parsed.path.strip("/")
        if node.startswith("container_"):
            container = type(self).containers.get(node)
            if container is None:
                return self._error(400, "Invalid container", 100)
            if self.mode == "encfail":
                return self._json(200, {"status_code": "ERROR",
                                        "status": "Video format not supported"})
            container["polls"] += 1
            if container["polls"] <= ENCODING_POLLS:
                return self._json(200, {"status_code": "IN_PROGRESS", "status": "encoding"})
            return self._json(200, {"status_code": "FINISHED", "status": "done"})

        if node.startswith("media_"):
            return self._json(200, {"permalink": f"https://www.instagram.com/reel/{node}/"})

        self._error(404, f"Unknown node {node}", 100)


def start(mode: str = "ok", port: int = 0) -> Tuple[ThreadingHTTPServer, str, type]:
    handler = type("BoundInstagramHandler", (MockInstagramHandler,), {
        "mode": mode, "containers": {}, "published": [], "calls": [],
    })
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}", handler


def env_for(base: str) -> Dict[str, str]:
    return {"IG_USER_ID": USER_ID, "IG_ACCESS_TOKEN": TOKEN, "IG_GRAPH_BASE": base}


def main() -> int:
    import os
    httpd, base, _ = start(os.environ.get("MOCK_IG_MODE", "ok"),
                           port=int(os.environ.get("PORT", "8792")))
    print(f"인스타그램 목 서버 시작: {base}")
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
