"""`안 열림` 을 구체적인 원인으로 바꿔주는 진단기.

화면이 안 뜨는 이유는 대부분 전략이 아니라 환경입니다.

- 파이썬이 너무 낮거나 아예 다른 파이썬이 실행됨
- 폴더 밖에서 실행해 scalper 를 못 찾음
- 포트가 이미 사용 중
- WSL·원격 서버라 127.0.0.1 이 브라우저에서 안 보임
- 방화벽이 로컬 서버를 막음

추측 대신 실제로 서버를 띄워 스스로 접속해 보고, 열어야 할 주소를 알려줍니다.
"""

from __future__ import annotations

import os
import pathlib
import platform
import socket
import sys
import urllib.request

OK, WARN, FAIL = "ok", "warn", "fail"
MARK = {OK: "✅", WARN: "⚠️ ", FAIL: "❌"}
MIN_PY = (3, 10)


class Report:
    def __init__(self) -> None:
        self.lines: list[tuple[str, str, str, str]] = []

    def add(self, level: str, title: str, detail: str = "", fix: str = "") -> None:
        self.lines.append((level, title, detail, fix))

    @property
    def failed(self) -> int:
        return sum(1 for l, *_ in self.lines if l == FAIL)

    def render(self) -> str:
        bar = "─" * 70
        out = [bar, "실행 환경 진단", bar]
        for level, title, detail, fix in self.lines:
            out.append(f"  {MARK[level]} {title}")
            if detail:
                out.append(f"       {detail}")
            if fix:
                out.append(f"       → {fix}")
        return "\n".join(out + [bar])


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def find_free_port(host: str, start: int, tries: int = 20) -> int | None:
    for p in range(start, start + tries):
        if port_free(host, p):
            return p
    return None


def lan_ip() -> str:
    """브라우저가 다른 기기에 있을 때 쓸 주소. 실제 연결은 하지 않습니다."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 53))
            return s.getsockname()[0]
    except OSError:
        return ""


def in_container_like() -> str:
    """WSL / 도커 등 '안에서 띄우면 밖 브라우저에서 안 보이는' 환경인지."""
    if "microsoft" in platform.release().lower():
        return "WSL"
    if pathlib.Path("/.dockerenv").exists():
        return "Docker"
    if os.environ.get("SSH_CONNECTION"):
        return "SSH 원격 접속"
    return ""


def run(host: str = "127.0.0.1", port: int = 8787) -> int:
    rep = Report()

    # 1. 파이썬
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) < MIN_PY:
        rep.add(FAIL, f"파이썬 {ver} — 3.10 이상이 필요합니다",
                sys.executable,
                "https://www.python.org/downloads/ 에서 최신 버전을 설치하세요. "
                "윈도우는 설치 중 'Add python.exe to PATH' 를 꼭 체크하세요.")
    else:
        rep.add(OK, f"파이썬 {ver}", sys.executable)

    # 2. 패키지를 찾을 수 있는가
    try:
        import scalper  # noqa: F401
        rep.add(OK, "scalper 패키지 인식", str(pathlib.Path.cwd()))
    except ImportError:
        rep.add(FAIL, "scalper 패키지를 찾을 수 없습니다",
                f"현재 폴더: {pathlib.Path.cwd()}",
                "코드를 받은 Yes 폴더 안에서 실행해야 합니다. cd Yes")
        print(rep.render())
        return 1

    # 3. 웹 화면 파일
    page = pathlib.Path(scalper.__file__).parent / "web" / "index.html"
    if page.exists():
        rep.add(OK, "화면 파일 있음", f"{page.name} ({page.stat().st_size:,} 바이트)")
    else:
        rep.add(FAIL, "화면 파일이 없습니다", str(page),
                "코드를 다시 받으세요 (ZIP 으로 받았다면 전체를 풀었는지 확인).")

    # 4. 포트
    if port_free(host, port):
        rep.add(OK, f"포트 {port} 사용 가능")
    else:
        alt = find_free_port(host, port + 1)
        rep.add(FAIL, f"포트 {port} 가 이미 사용 중입니다", "",
                (f"다른 번호로 실행하세요:  python3 -m scalper run --port {alt}"
                 if alt else "사용 중인 프로그램을 종료하세요."))
        port = alt or port

    # 5. 실제로 띄워서 접속해 보기 — 여기까지 통과하면 서버는 문제가 없습니다
    served = _self_test(host, port, rep)

    # 6. 브라우저에서 열 주소
    env = in_container_like()
    if served:
        urls = [f"http://127.0.0.1:{port}"]
        ip = lan_ip()
        if env:
            rep.add(WARN, f"{env} 환경으로 보입니다",
                    "이 안의 127.0.0.1 은 바깥 브라우저에서 보이지 않을 수 있습니다.",
                    f"python3 -m scalper run --host 0.0.0.0 --port {port} 로 띄우고 "
                    + (f"http://{ip}:{port} 로 접속하세요." if ip else
                       "호스트 IP 로 접속하세요."))
            if ip:
                urls.append(f"http://{ip}:{port}")
        rep.add(OK, "브라우저에서 열 주소", "  또는  ".join(urls),
                "주소창에 직접 입력하세요. 검색창이 아닙니다.")

    # 7. .env
    envp = pathlib.Path(".env")
    if envp.exists():
        from . import envfile
        keys = [k for k, val in envfile.parse(envp.read_text(encoding="utf-8")).items()
                if val]
        rep.add(OK, f".env 발견 — {len(keys)}개 설정",
                ", ".join(sorted(keys)[:6]) or "(값이 비어 있습니다)")
    else:
        rep.add(WARN, ".env 없음",
                "시뮬레이션은 키 없이 됩니다. 실제 매매에만 필요합니다.",
                "cp scalper/.env.example .env")

    print(rep.render())
    if rep.failed:
        print(f"\n해결할 것 {rep.failed}건이 있습니다. 위의 → 를 따라 하세요.")
        return 1
    print("\n환경에 문제가 없습니다. 이제 실행하세요:")
    print(f"  python3 -m scalper run --port {port}")
    return 0


def _self_test(host: str, port: int, rep: Report) -> bool:
    """서버를 실제로 띄우고 스스로 접속합니다. 추측을 없애는 단계."""
    from .engine import Engine
    from .server import serve

    httpd = None
    try:
        engine = Engine(offline=True)
        httpd = serve(engine, host=host, port=port, interval=5.0)
    except OSError as e:
        rep.add(FAIL, "서버를 띄우지 못했습니다", str(e),
                "포트를 바꾸거나 방화벽 설정을 확인하세요.")
        return False
    except Exception as e:                      # noqa: BLE001
        rep.add(FAIL, "엔진 시작 실패", f"{type(e).__name__}: {e}")
        return False

    try:
        url = f"http://127.0.0.1:{port}/api/health"
        with urllib.request.urlopen(url, timeout=5) as r:
            body = r.read().decode("utf-8", "replace")
        if '"ok"' in body or "true" in body:
            rep.add(OK, "서버 자체 접속 성공", url)
            return True
        rep.add(FAIL, "서버 응답이 이상합니다", body[:120])
        return False
    except Exception as e:                      # noqa: BLE001
        rep.add(FAIL, "서버에 접속하지 못했습니다", f"{type(e).__name__}: {e}",
                "백신·방화벽이 로컬 서버를 막고 있을 수 있습니다.")
        return False
    finally:
        try:
            engine.stop()
            if httpd:
                httpd.shutdown()
        except Exception:                       # noqa: BLE001, S110
            pass
