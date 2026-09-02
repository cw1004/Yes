# -*- coding: utf-8 -*-
"""YouTube 업로드용 refresh token 발급 도우미 (한 번만 하면 된다).

준비
  1) Google Cloud Console → 프로젝트 생성 → **YouTube Data API v3** 사용 설정
  2) OAuth 동의 화면 구성 (테스트 중이면 본인 계정을 테스트 사용자로 추가)
  3) 사용자 인증 정보 → OAuth 클라이언트 ID → **데스크톱 앱** 생성
  4) 클라이언트 ID/비밀번호를 환경변수로 넣고 이 스크립트 실행

사용
  export YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=...
  python3 -m tools.youtube_auth                 # 브라우저가 있는 PC
  python3 -m tools.youtube_auth --paste         # 원격 서버(브라우저는 다른 기기)
  python3 -m tools.youtube_auth --save shopreel.env
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = ("https://www.googleapis.com/auth/youtube.upload "
         "https://www.googleapis.com/auth/youtube.force-ssl")   # 업로드 + 댓글

PAGE = """<html><head><meta charset="utf-8"><title>SHOPREEL</title></head>
<body style="font-family:system-ui;padding:60px;text-align:center">
<h2>{title}</h2><p>{body}</p><p>이 창을 닫고 터미널로 돌아가세요.</p></body></html>"""


class CallbackHandler(BaseHTTPRequestHandler):
    code: Optional[str] = None
    error: Optional[str] = None

    def log_message(self, *a) -> None:
        pass

    def do_GET(self) -> None:            # noqa: N802
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        cls = type(self)
        cls.code = (params.get("code") or [None])[0]
        cls.error = (params.get("error") or [None])[0]
        ok = bool(cls.code)
        page = PAGE.format(title="인증 완료 ✓" if ok else "인증 실패",
                           body="터미널에 refresh token 이 출력됩니다." if ok
                                else f"오류: {cls.error}")
        body = page.encode("utf-8")
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def exchange(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    body = urllib.parse.urlencode({
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    }).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"토큰 교환 실패 (HTTP {e.code}): {detail}")


def save_to_env_file(path: Path, token: str) -> None:
    line = f"export YOUTUBE_REFRESH_TOKEN={token}"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = [l for l in text.splitlines() if not l.strip().startswith("export YOUTUBE_REFRESH_TOKEN")]
    lines.append(line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{path} 에 저장했습니다. 사용: source {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="YouTube refresh token 발급")
    ap.add_argument("--port", type=int, default=8788, help="로컬 콜백 포트")
    ap.add_argument("--paste", action="store_true",
                    help="브라우저가 다른 기기일 때: 리다이렉트된 주소를 붙여넣기")
    ap.add_argument("--save", help="발급받은 토큰을 이 env 파일에 저장 (예: shopreel.env)")
    args = ap.parse_args()

    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET 환경변수를 먼저 설정하세요.",
              file=sys.stderr)
        print("  Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID(데스크톱 앱)",
              file=sys.stderr)
        return 1

    redirect_uri = f"http://127.0.0.1:{args.port}/"
    url = f"{AUTH_URL}?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
    })

    print("아래 주소를 브라우저에서 열고 채널을 선택해 동의하세요:\n")
    print(f"  {url}\n")

    if args.paste:
        pasted = input("동의 후 이동한 주소를 그대로 붙여넣으세요:\n> ").strip()
        params = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query)
        code = (params.get("code") or [""])[0]
    else:
        httpd = HTTPServer(("127.0.0.1", args.port), CallbackHandler)
        threading.Thread(target=httpd.handle_request, daemon=True).start()
        try:
            webbrowser.open(url)
        except Exception:
            pass
        print(f"브라우저 인증을 기다리는 중... ({redirect_uri})")
        while CallbackHandler.code is None and CallbackHandler.error is None:
            threading.Event().wait(0.4)
        httpd.server_close()
        if CallbackHandler.error:
            print(f"인증 거부됨: {CallbackHandler.error}", file=sys.stderr)
            return 1
        code = CallbackHandler.code or ""

    if not code:
        print("인증 코드를 받지 못했습니다.", file=sys.stderr)
        return 1

    data = exchange(code, client_id, client_secret, redirect_uri)
    token = data.get("refresh_token")
    if not token:
        print("refresh token 이 없습니다. 같은 계정으로 이미 발급한 적이 있다면\n"
              "  https://myaccount.google.com/permissions 에서 앱 권한을 해제한 뒤\n"
              "  다시 시도하세요(prompt=consent 로 재요청합니다).", file=sys.stderr)
        return 1

    print("\n발급 완료. 아래 값을 환경변수로 넣으세요:\n")
    print(f"  export YOUTUBE_REFRESH_TOKEN={token}\n")
    if args.save:
        save_to_env_file(Path(args.save), token)
    print("확인:  python3 -m shopreel check   (업로드 대상에 youtube 가 ○ 로 표시됩니다)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
