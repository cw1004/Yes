"""모니터링 · 비상제어 대시보드 (Flask).

설계 원칙 — 실계좌를 다루는 화면이므로 보안이 기능보다 앞선다.

* 모든 ``/api/*`` 요청은 토큰 인증을 통과해야 한다(상수시간 비교).
* 기본 바인딩은 127.0.0.1 이며, 폰에서 보려면 명시적으로 LAN 주소로 열어야 한다.
* 기본은 **읽기 전용**이다. 주문·취소·매매 재개는 ``--allow-control`` 이 있어야 동작한다.
* 매매 중단(킬 스위치 ON)만은 언제나 허용한다 — 위험을 줄이는 방향이라서다.
* 인증을 헤더로만 받으므로 브라우저가 자동으로 실어 보내는 쿠키가 없고, 따라서 CSRF 가 성립하지 않는다.
"""

from __future__ import annotations

import hmac
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from pathlib import Path
from typing import Any

from .service import DashboardService

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@dataclass
class WebConfig:
    """대시보드 실행 옵션."""

    token: str
    allow_control: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    watchlist: list[str] | None = None
    refresh_seconds: int = 10

    @property
    def is_local_only(self) -> bool:
        return self.host in LOOPBACK_HOSTS


def generate_token() -> str:
    return secrets.token_urlsafe(24)


def create_app(trader, config: WebConfig):
    """Flask 앱을 만든다. Flask 가 없으면 설치 안내와 함께 실패한다."""
    try:
        from flask import Flask, jsonify, request, send_from_directory
        from werkzeug.exceptions import HTTPException
    except ImportError as exc:  # pragma: no cover - 설치 안내 경로
        raise ImportError(
            "대시보드에는 Flask 가 필요합니다.  pip install 'kis-trader[web]'  또는  pip install flask"
        ) from exc

    service = DashboardService(trader, watchlist=config.watchlist)
    app = Flask(__name__, static_folder=None)
    app.config["JSON_AS_ASCII"] = False

    # ---------------------------------------------------------------- 인증
    def token_ok(supplied: str | None) -> bool:
        return bool(supplied) and hmac.compare_digest(str(supplied), config.token)

    def require_auth(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            supplied = request.headers.get("X-Auth-Token") or request.args.get("token")
            if not token_ok(supplied):
                log.warning("인증 실패: %s %s from %s", request.method, request.path, request.remote_addr)
                return jsonify({"error": "인증이 필요합니다"}), 401
            return view(*args, **kwargs)

        return wrapper

    def require_control(view: Callable) -> Callable:
        """제어 권한이 꺼져 있으면 거부한다."""
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            if not config.allow_control:
                return jsonify({
                    "error": "읽기 전용 모드입니다. 제어하려면 --allow-control 로 다시 실행하세요."
                }), 403
            return view(*args, **kwargs)

        return wrapper

    @app.after_request
    def secure_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    # ---------------------------------------------------------------- 화면
    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/api/config")
    @require_auth
    def api_config():
        """로그인 성공 확인 + 화면 동작 설정."""
        return jsonify({
            "allow_control": config.allow_control,
            "refresh_seconds": config.refresh_seconds,
            "env": trader.settings.env,
            "is_paper": trader.settings.is_paper,
            "dry_run": trader.settings.dry_run,
        })

    # ---------------------------------------------------------------- 조회
    @app.get("/api/snapshot")
    @require_auth
    def api_snapshot():
        return jsonify(service.snapshot())

    @app.get("/api/summary")
    @require_auth
    def api_summary():
        return jsonify(service.summary())

    @app.get("/api/positions")
    @require_auth
    def api_positions():
        return jsonify(service.positions())

    @app.get("/api/orders")
    @require_auth
    def api_orders():
        return jsonify(service.open_orders())

    @app.get("/api/journal")
    @require_auth
    def api_journal():
        limit = min(max(request.args.get("limit", 20, type=int), 1), 200)
        return jsonify(service.journal(limit))

    @app.get("/api/quotes")
    @require_auth
    def api_quotes():
        raw = request.args.get("symbols", "")
        symbols = [s.strip() for s in raw.replace(" ", ",").split(",") if s.strip()]
        return jsonify(service.quotes(symbols or None))

    # ---------------------------------------------------------------- 제어
    @app.post("/api/halt")
    @require_auth
    def api_halt():
        payload = request.get_json(silent=True) or {}
        turn_on = bool(payload.get("on", True))
        # 매매를 멈추는 방향은 항상 허용하고, 재개만 제어 권한을 요구한다.
        if not turn_on and not config.allow_control:
            return jsonify({"error": "읽기 전용 모드에서는 매매를 재개할 수 없습니다."}), 403
        return jsonify(service.set_halt(turn_on))

    @app.post("/api/cancel")
    @require_auth
    @require_control
    def api_cancel():
        payload = request.get_json(silent=True) or {}
        order_no = str(payload.get("order_no", "")).strip()
        org_no = str(payload.get("org_no", "")).strip()
        if not order_no or not org_no:
            return jsonify({"error": "order_no 와 org_no 가 필요합니다"}), 400
        return jsonify(service.cancel(org_no=org_no, order_no=order_no))

    @app.post("/api/cancel-all")
    @require_auth
    @require_control
    def api_cancel_all():
        return jsonify(service.cancel_all())

    @app.post("/api/order")
    @require_auth
    @require_control
    def api_order():
        payload = request.get_json(silent=True) or {}
        symbol = str(payload.get("symbol", "")).strip()
        if not symbol:
            return jsonify({"error": "symbol 이 필요합니다"}), 400
        result = service.place_order(
            symbol=symbol,
            side=str(payload.get("side", "")).strip().lower(),
            quantity=int(payload.get("quantity") or 0),
            price=int(payload.get("price") or 0),
            market=bool(payload.get("market")),
        )
        return jsonify(result), (200 if result.get("success") else 400)

    @app.errorhandler(Exception)
    def handle_unexpected(exc: Exception):
        # 404 같은 정상적인 HTTP 응답은 그대로 통과시킨다.
        if isinstance(exc, HTTPException):
            return exc
        log.exception("대시보드 처리 중 오류: %s %s", request.method, request.path)
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 500

    app.dashboard_service = service  # 테스트에서 접근할 수 있게 노출
    return app


def print_startup_banner(config: WebConfig, trader) -> None:
    """접속 주소와 주의사항을 출력한다."""
    settings = trader.settings
    mode = "모의투자" if settings.is_paper else "🔴 실전투자"
    control = "제어 허용(주문·취소·재개 가능)" if config.allow_control else "읽기 전용 + 비상정지만 허용"
    host = "127.0.0.1" if config.is_local_only else config.host
    url = f"http://{host}:{config.port}/?token={config.token}"

    print("=" * 66)
    print(f"  KIS 대시보드 시작 — {mode} / {control}")
    print("=" * 66)
    print(f"  주소: {url}")
    if not config.is_local_only:
        print()
        print("  ⚠ 같은 와이파이(LAN)에서만 접속하세요. 암호화되지 않은 HTTP 입니다.")
        print("    공유기 포트포워딩이나 외부 공개는 절대 하지 마세요.")
        print(f"    폰에서는 PC의 LAN IP 로 접속합니다:  http://<PC_IP>:{config.port}/?token={config.token}")
    print()
    print("  토큰은 브라우저에 저장되므로 첫 접속에만 필요합니다. Ctrl+C 로 종료.")
    print("=" * 66)
