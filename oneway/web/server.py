# -*- coding: utf-8 -*-
"""표준 라이브러리만으로 만든 HTTP 서버.

의존성이 하나도 없어서 ``python3 -m oneway serve`` 한 줄이면 바로 뜬다.
방문자 수가 늘어나면 이 파일 앞에 nginx 를 두거나 WSGI 로 옮기면 된다
(페이지 생성은 render.py, 상담은 counselor/ 가 담당하므로 이 파일만 바뀐다).
"""

from __future__ import annotations

import io
import json
import logging
import mimetypes
import re
from datetime import date
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

from .. import __version__
from ..book import content as book_content
from ..book import epub as epub_mod
from ..book import personal as personal_mod
from ..book import render as book_render
from ..config import Config
from ..donate import Ledger
from ..content import daily as daily_mod
from ..content import entries, fifty, pages as pages_mod
from ..content import paths as paths_mod
from ..counselor.engine import Counselor
from ..counselor.session import Store, Visitor
from ..seo import robots_txt, sitemap_xml
from . import render

log = logging.getLogger("oneway.web")

COOKIE = "ow_sid"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365
STATIC_DIR = Path(__file__).parent / "static"
BELIEF_RE = re.compile(r"^/believe/(\d{1,2})-([a-z0-9\-]+)$")
PATH_RE = re.compile(r"^/path/([a-z0-9\-]+)(?:/(\d{1,2}))?$")
MAX_BODY = 64 * 1024


class Site:
    """요청 처리에 필요한 것들을 한 곳에 모아 둔다."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.store = Store(cfg.sessions_dir)
        self.counselor = Counselor(cfg)
        self.pray_counts = cfg.data_dir / "pray_counts.json"
        self.book = book_content.build_book(cfg.site_url, cfg.book_isbn)
        cfg.data_dir.mkdir(parents=True, exist_ok=True)

    def ledger(self) -> Ledger:
        """매번 새로 읽는다 — 서버를 다시 띄우지 않고도 장부를 갱신할 수 있게."""
        return Ledger.load(self.cfg.ledger_file)

    # 오늘 맡겨진 지향 수 — 내용이 아니라 '개수'만 공개한다
    def bump_pray_count(self, today: Optional[date] = None) -> int:
        iso = (today or date.today()).isoformat()
        data: Dict[str, int] = {}
        if self.pray_counts.exists():
            try:
                data = json.loads(self.pray_counts.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
        data[iso] = int(data.get(iso, 0)) + 1
        data = {k: v for k, v in sorted(data.items())[-90:]}
        self.pray_counts.write_text(json.dumps(data, ensure_ascii=False),
                                    encoding="utf-8")
        return data[iso]

    def pray_count(self, today: Optional[date] = None) -> int:
        iso = (today or date.today()).isoformat()
        if not self.pray_counts.exists():
            return 0
        try:
            return int(json.loads(self.pray_counts.read_text(encoding="utf-8")).get(iso, 0))
        except (json.JSONDecodeError, ValueError):
            return 0


class Handler(BaseHTTPRequestHandler):
    site: Site = None           # serve() 에서 주입
    server_version = f"OneWay/{__version__}"

    # ------------------------------------------------------------ 응답 유틸
    def _send(self, code: int, body: bytes, ctype: str,
              sid: Optional[str] = None, cache: str = "no-store") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if sid:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE}={sid}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
                "HttpOnly; SameSite=Lax")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def html(self, markup: str, code: int = 200, sid: Optional[str] = None) -> None:
        self._send(code, markup.encode("utf-8"), "text/html; charset=utf-8", sid)

    def json_out(self, data: Dict, code: int = 200, sid: Optional[str] = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8", sid)

    def text(self, body: str, ctype: str = "text/plain; charset=utf-8") -> None:
        self._send(200, body.encode("utf-8"), ctype, cache="public, max-age=3600")

    # ------------------------------------------------------------ 세션
    def read_sid(self) -> Optional[str]:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            return SimpleCookie(raw).get(COOKIE).value        # type: ignore[union-attr]
        except (AttributeError, KeyError):
            return None

    def visitor(self) -> Tuple[Visitor, Optional[str]]:
        """방문자를 불러오고, 쿠키를 새로 심어야 하면 sid 를 함께 돌려준다."""
        sid = self.read_sid()
        v = self.site.store.get_or_create(sid)
        return v, (None if sid == v.id else v.id)

    def body_json(self) -> Dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if length <= 0 or length > MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # ------------------------------------------------------------ 라우팅
    def do_GET(self) -> None:          # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path).rstrip("/") or "/"
        query = parse_qs(parsed.query)
        cfg = self.site.cfg

        if path.startswith("/static/"):
            return self.serve_static(path)
        if path == "/robots.txt":
            return self.text(robots_txt(cfg))
        if path == "/sitemap.xml":
            return self.text(sitemap_xml(cfg), "application/xml; charset=utf-8")
        if path == "/healthz":
            return self.json_out({"ok": True, "version": __version__})

        if path in ("/my-book.epub", "/my-book.html"):
            return self.serve_my_book(path)

        if path.startswith("/api/"):
            return self.api_get(path)

        v, new_sid = self.visitor()
        try:
            markup = self.page(path, query, v)
        except (KeyError, ValueError):
            self.site.store.save(v)
            return self.html(render.not_found(cfg), 404, new_sid)
        self.site.store.save(v)
        self.html(markup, 200, new_sid)

    do_HEAD = do_GET

    def page(self, path: str, query: Dict, v: Visitor) -> str:
        cfg = self.site.cfg
        if path == "/":
            return render.home(cfg, daily_mod.build())
        if path == "/today":
            # 아직 신앙 언어를 꺼내지 않은 사람에게는 말씀·기도 칸은 물론
            # '오늘의 한 걸음' 에서도 종교 언어가 나오지 않게 한다
            faith = v.depth >= 2 and not v.faith_blocked
            return render.today(cfg, daily_mod.build(faith=faith), faith=faith)
        if path == "/counsel":
            return render.counsel_page(cfg, (query.get("q") or [""])[0][:300])
        if path == "/believe":
            return render.believe_index(cfg)
        if path == "/pray":
            return render.pray_page(cfg, self.site.pray_count())
        if path == "/book":
            return render.book_page(cfg, self.site.book, cfg.book_stores)
        if path == "/book/ledger":
            return render.ledger_page(cfg, self.site.ledger())
        if path == "/my-book":
            profile = personal_mod.build_profile(v)
            book = (personal_mod.build_personal_book(profile, cfg.site_url)
                    if profile.enough else None)
            return render.my_book_page(cfg, profile, book)

        m = PATH_RE.match(path)
        if m:
            journey = paths_mod.get(m.group(1))
            if m.group(2) is None:
                return render.path_index(cfg, journey, v.path_step(journey.slug))
            step = journey.step(int(m.group(2)))     # 범위 밖이면 ValueError
            v.walk(journey.slug, step.no)
            # 여정 뒷부분은 신앙의 언어를 쓴다. 거기까지 걸어온 것이 곧 동의다.
            if step.depth >= 2 and not v.faith_blocked:
                v.open_depth(step.depth)
            return render.path_step(cfg, journey, step)

        m = BELIEF_RE.match(path)
        if m:
            b = fifty.get(int(m.group(1)))
            if b.slug != m.group(2):
                raise KeyError(path)
            v.mark_read(b.no)
            return render.belief_page(cfg, b)

        if path.startswith("/gate/"):
            return render.gate_page(cfg, entries.get(path[len("/gate/"):]))

        return render.static_page(cfg, pages_mod.get(path.lstrip("/")))

    # ------------------------------------------------------------ API
    def api_get(self, path: str) -> None:
        v, new_sid = self.visitor()
        if path == "/api/me":
            self.site.store.save(v)
            return self.json_out({"progress": v.progress(),
                                  "daily": daily_mod.build().to_dict()}, sid=new_sid)
        if path == "/api/daily":
            return self.json_out({"daily": daily_mod.build().to_dict()})
        if path == "/api/intentions":
            self.site.store.save(v)
            return self.json_out({"intentions": [i.to_dict() for i in v.intentions],
                                  "today_count": self.site.pray_count()}, sid=new_sid)
        self.json_out({"error": "not_found"}, 404)

    def do_POST(self) -> None:         # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        data = self.body_json()
        v, new_sid = self.visitor()

        if path == "/api/counsel":
            message = str(data.get("message", ""))[:2000]
            reply = self.site.counselor.respond(message, v)
            self.site.store.save(v)
            return self.json_out({"reply": reply.to_dict(),
                                  "progress": v.progress()}, sid=new_sid)

        if path == "/api/intention":
            text = str(data.get("text", "")).strip()[:500]
            if not text:
                return self.json_out({"error": "empty"}, 400, sid=new_sid)
            v.add_intention(text)
            self.site.store.save(v)
            count = self.site.bump_pray_count()
            return self.json_out({"intentions": [i.to_dict() for i in v.intentions],
                                  "today_count": count}, sid=new_sid)

        if path == "/api/practice":
            v.mark_practice()
            self.site.store.save(v)
            return self.json_out({"progress": v.progress()}, sid=new_sid)

        if path == "/api/read":
            try:
                no = int(data.get("belief", 0))
            except (TypeError, ValueError):
                no = 0
            if 1 <= no <= 50:
                v.mark_read(no)
            self.site.store.save(v)
            return self.json_out({"progress": v.progress()}, sid=new_sid)

        self.json_out({"error": "not_found"}, 404)

    def serve_my_book(self, path: str) -> None:
        """맞춤 책 내려받기.

        요청할 때마다 그 자리에서 만든다. 서버에 파일로 남기지 않는다.
        남기면 그 파일이 곧 개인정보가 된다.
        """
        cfg = self.site.cfg
        v, new_sid = self.visitor()
        profile = personal_mod.build_profile(v)
        if not profile.enough:
            self.site.store.save(v)
            return self.html(render.my_book_page(cfg, profile, None), 200, new_sid)

        book = personal_mod.build_personal_book(profile, cfg.site_url)
        self.site.store.save(v)

        if path.endswith(".html"):
            body = book_render.single_html(book, cfg.site_url).encode("utf-8")
            return self._send(200, body, "text/html; charset=utf-8", new_sid)

        buf = io.BytesIO()
        epub_mod.write_epub_to(book, buf, cfg.site_url)
        data = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/epub+zip")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition",
                         'attachment; filename="my-book.epub"; '
                         "filename*=UTF-8''%EB%8B%B9%EC%8B%A0%EC%9D%84-"
                         "%EC%9C%84%ED%95%9C-%EC%B1%85.epub")
        self.send_header("Cache-Control", "no-store")
        if new_sid:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE}={new_sid}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
                "HttpOnly; SameSite=Lax")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ------------------------------------------------------------ 정적 파일
    def serve_static(self, path: str) -> None:
        name = path[len("/static/"):]
        target = (STATIC_DIR / name).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.is_file():
            return self.json_out({"error": "not_found"}, 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype, cache="public, max-age=3600")

    def log_message(self, fmt: str, *args) -> None:   # 조용한 로그
        log.info("%s %s", self.address_string(), fmt % args)


def serve(cfg: Config) -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    Handler.site = Site(cfg)
    httpd = ThreadingHTTPServer((cfg.host, cfg.port), Handler)
    print(f"  하나의 길 — ONE WAY  가 떴습니다")
    print(f"  http://{cfg.host}:{cfg.port}  (Ctrl+C 로 종료)")
    print(f"  상담 엔진: {Handler.site.counselor.cfg.counselor} "
          f"/ 모델: {cfg.model}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  안녕히 가십시오.")
    finally:
        httpd.server_close()
