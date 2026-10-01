"""로컬 대시보드 서버 — 표준 라이브러리만 씁니다 (설치 필요 없음).

GET  /                 3분할 실시간 화면
GET  /api/state        엔진 전체 상태 (슬롯 3개 + 뉴스 + 매크로 + 로그)
POST /api/command      {"cmd": "auto"|"ticker"|"flatten"|"refresh", ...}
"""

from __future__ import annotations

import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .engine import Engine

WEB_DIR = pathlib.Path(__file__).with_name("web")


class Handler(BaseHTTPRequestHandler):
    engine: Engine

    def log_message(self, fmt, *args):        # 콘솔 소음 제거
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj: object, code: int = 200) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(),
                   "application/json; charset=utf-8")

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            f = WEB_DIR / "index.html"
            if not f.exists():
                return self._send(404, b"index.html not found", "text/plain")
            return self._send(200, f.read_bytes(), "text/html; charset=utf-8")
        if path == "/api/state":
            return self._json(self.engine.state())
        if path == "/api/health":
            return self._json({"ok": True})
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/api/command":
            return self._send(404, b"not found", "text/plain")
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json({"ok": False, "error": "bad json"}, 400)

        cmd = str(payload.get("cmd", ""))
        eng = self.engine
        try:
            if cmd == "auto":
                idx = payload.get("slot")
                state = eng.set_auto(None if idx in (None, 0) else int(idx),
                                     payload.get("on"))
                return self._json({"ok": True, "auto": state})
            if cmd == "ticker":
                ok = eng.set_ticker(int(payload["slot"]), str(payload["ticker"]))
                return self._json({"ok": ok})
            if cmd == "flatten":
                evs = eng.flatten()
                return self._json({"ok": True, "closed": len(evs)})
            if cmd == "refresh":
                eng.refresh_context(force=True)
                return self._json({"ok": True})
            if cmd == "config":
                for k, v in (payload.get("values") or {}).items():
                    if hasattr(eng.cfg, k):
                        setattr(eng.cfg, k, type(getattr(eng.cfg, k))(v))
                return self._json({"ok": True, "config": eng.cfg.as_dict()})
        except (KeyError, ValueError, TypeError) as e:
            return self._json({"ok": False, "error": str(e)}, 400)
        self._json({"ok": False, "error": f"unknown cmd: {cmd}"}, 400)


def serve(engine: Engine, host: str = "127.0.0.1", port: int = 8787,
          interval: float = 1.5) -> ThreadingHTTPServer:
    """엔진을 백그라운드로 돌리면서 대시보드를 띄웁니다."""
    handler = type("BoundHandler", (Handler,), {"engine": engine})
    httpd = ThreadingHTTPServer((host, port), handler)
    engine.start(interval=interval)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
