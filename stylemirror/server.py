# -*- coding: utf-8 -*-
"""로컬 웹서버 — 휴대폰 앱 화면과 거울 화면을 같이 제공한다.

  http://<PC 또는 라즈베리파이 IP>:8080/            휴대폰 앱 (셀카 채점·추천·옷장)
  http://localhost:8080/?mode=mirror                 거울 화면 (검은 배경 + 큰 글씨)

표준 라이브러리만 사용 (Flask 불필요).
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import parse_qs, urlparse

from . import stylist
from .closet import CATEGORIES, STYLES, Closet, Garment
from .coach import Coach
from .config import MirrorConfig
from .weather import Weather, get_weather

WEB_DIR = Path(__file__).parent / "web"
MAX_BODY = 12 * 1024 * 1024          # 사진 업로드 상한 12MB
WEATHER_TTL = 600                    # 날씨 10분 캐시
DATA_URL_RE = re.compile(r"^data:(image/(?:jpeg|png|webp|gif));base64,(.+)$", re.S)


class MirrorApp:
    """서버가 공유하는 상태(옷장 DB, 코치, 날씨 캐시)."""

    def __init__(self, cfg: MirrorConfig):
        self.cfg = cfg
        self.closet = Closet(cfg.db_path)
        self.coach = Coach(cfg, self.closet)
        cfg.photo_dir.mkdir(parents=True, exist_ok=True)
        self._weather: Optional[Weather] = None
        self._weather_at = 0.0
        self.lock = threading.Lock()

    def weather(self) -> Weather:
        if self._weather is None or time.time() - self._weather_at > WEATHER_TTL:
            self._weather = get_weather(self.cfg.latitude, self.cfg.longitude, self.cfg.city)
            self._weather_at = time.time()
        return self._weather

    def save_photo(self, image: bytes, media_type: str) -> str:
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
               "image/gif": "gif"}[media_type]
        name = f"{uuid.uuid4().hex[:12]}.{ext}"
        (self.cfg.photo_dir / name).write_bytes(image)
        return name


def decode_data_url(value: Optional[str]) -> Tuple[Optional[bytes], str]:
    if not value:
        return None, ""
    m = DATA_URL_RE.match(value)
    if not m:
        raise ValueError("이미지는 data:image/...;base64 형식이어야 합니다")
    try:
        return base64.b64decode(m.group(2), validate=False), m.group(1)
    except binascii.Error as e:
        raise ValueError(f"이미지 디코딩 실패: {e}")


def make_handler(app: MirrorApp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "StyleMirror/0.1"

        def log_message(self, fmt, *args):  # 조용히 (사진 데이터가 로그에 남지 않도록)
            pass

        # ---------------------------------------------------------- 응답 도우미
        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data, status: int = 200) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def _error(self, msg: str, status: int = 400) -> None:
            self._json({"error": msg}, status)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("사진이 너무 큽니다")
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")

        # ---------------------------------------------------------- GET
        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            path = url.path
            try:
                if path in ("/", "/index.html"):
                    return self._send(200, (WEB_DIR / "app.html").read_bytes(),
                                      "text/html; charset=utf-8")
                if path.startswith("/photos/"):
                    name = Path(path).name
                    f = app.cfg.photo_dir / name
                    if not re.fullmatch(r"[0-9a-f]{12}\.(jpg|png|webp|gif)", name) or not f.exists():
                        return self._error("없는 사진", 404)
                    ctype = "image/jpeg" if name.endswith("jpg") else f"image/{name.rsplit('.', 1)[1]}"
                    return self._send(200, f.read_bytes(), ctype)
                if path == "/api/status":
                    return self._json({
                        "weather": app.weather().to_dict(),
                        "ai": app.coach.ai_enabled, "ai_error": app.coach.ai_error,
                        "owners": app.closet.owners(),
                        "occasions": {k: v["ko"] for k, v in stylist.OCCASIONS.items()},
                        "categories": CATEGORIES, "styles": STYLES,
                    })
                if path == "/api/closet":
                    items = app.closet.all(owner=q.get("owner") or None)
                    return self._json({"items": [g.to_dict() for g in items]})
                if path == "/api/history":
                    return self._json({"history": app.closet.score_history(q.get("owner") or None)})
                return self._error("없는 주소", 404)
            except Exception as e:
                return self._error(str(e), 500)

        # ---------------------------------------------------------- POST
        def do_POST(self):
            path = urlparse(self.path).path
            try:
                body = self._body()
                owner = (body.get("owner") or "").strip()
                occasion = body.get("occasion") or "daily"
                if occasion not in stylist.OCCASIONS:
                    occasion = "daily"

                if path == "/api/score":
                    image, mtype = decode_data_url(body.get("image"))
                    with app.lock:
                        result = app.coach.evaluate_look(
                            image, app.weather(), occasion, owner or None,
                            body.get("question", ""), mtype or "image/jpeg",
                            worn_ids=body.get("worn_ids") or [])
                        if result.get("total") is not None:
                            app.closet.log_score(result["total"], owner, occasion,
                                                 result.get("source", "rules"), result["message"])
                    return self._json(result)

                if path == "/api/recommend":
                    with app.lock:
                        result = app.coach.recommend(app.weather(), occasion, owner or None,
                                                     body.get("request", ""))
                    return self._json(result)

                if path == "/api/worn":
                    app.closet.mark_worn(int(i) for i in body.get("ids", []))
                    return self._json({"ok": True})

                if path == "/api/garment/tag":
                    image, mtype = decode_data_url(body.get("image"))
                    if image is None:
                        return self._error("사진이 없습니다")
                    with app.lock:
                        tag = app.coach.tag_garment(image, mtype)
                    return self._json({"tag": tag, "ai": app.coach.ai_enabled})

                if path == "/api/closet":
                    image, mtype = decode_data_url(body.pop("image", None))
                    fields = {k: body[k] for k in ("name", "category", "color", "material",
                                                   "pattern", "style", "warmth",
                                                   "waterproof", "note") if k in body}
                    fields["owner"] = owner
                    if image is not None:
                        fields["photo"] = app.save_photo(image, mtype)
                    g = app.closet.add(Garment(**fields))
                    return self._json({"item": g.to_dict()}, 201)

                return self._error("없는 주소", 404)
            except (ValueError, TypeError, KeyError) as e:
                return self._error(str(e))
            except Exception as e:
                return self._error(str(e), 500)

        # ---------------------------------------------------------- DELETE
        def do_DELETE(self):
            m = re.fullmatch(r"/api/closet/(\d+)", urlparse(self.path).path)
            if not m:
                return self._error("없는 주소", 404)
            g = app.closet.get(int(m.group(1)))
            if g and g.photo:
                (app.cfg.photo_dir / Path(g.photo).name).unlink(missing_ok=True)
            return self._json({"ok": app.closet.delete(int(m.group(1)))})

    return Handler


def serve(cfg: MirrorConfig) -> None:
    app = MirrorApp(cfg)
    httpd = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(app))
    mode = "Claude AI" if app.coach.ai_enabled else "규칙 기반(오프라인)"
    print(f"STYLE MIRROR 실행 중 — 코치 모드: {mode}")
    if app.coach.ai_error:
        print(f"  ※ {app.coach.ai_error}")
    print(f"  휴대폰 앱 : http://{cfg.host}:{cfg.port}/")
    print(f"  거울 화면 : http://{cfg.host}:{cfg.port}/?mode=mirror")
    print("  종료: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        app.closet.close()
