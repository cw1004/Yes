"""`.env` 파일 읽기 — 터미널 종류와 운영체제에 상관없이 키를 설정하기 위한 것.

환경변수만 읽으면 실행 방법이 OS 마다 갈립니다.

    export KIS_APP_KEY=...        # macOS / Linux
    set KIS_APP_KEY=...           # Windows cmd
    $env:KIS_APP_KEY="..."        # Windows PowerShell

게다가 터미널을 닫으면 사라져서 매번 다시 입력해야 합니다. `.env` 파일 하나를
두면 어디서든 똑같이 동작합니다.

이미 설정된 환경변수는 덮어쓰지 않습니다. 파일은 기본값이고, 환경변수가
우선입니다 — 서버에 올릴 때 파일을 지우지 않고도 실제 값을 주입할 수 있게.
"""

from __future__ import annotations

import os
import pathlib
import stat

DEFAULT_NAME = ".env"


def parse(text: str) -> dict[str, str]:
    """`.env` 본문 → 키/값. `export KEY=value` 형태도 그대로 받습니다."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        out[key] = _value(value.strip())
    return out


def _value(value: str) -> str:
    """따옴표로 감싼 값은 닫는 따옴표까지만 취하고, 그 뒤 주석은 버립니다.

        KEY="비밀 #값"   # 설명   →   비밀 #값
        KEY=평문         # 설명   →   평문
    """
    quote = value[:1]
    if quote in ("'", '"'):
        end = value.find(quote, 1)
        return value[1:end] if end != -1 else value[1:]
    return value.split(" #", 1)[0].split("\t#", 1)[0].strip()


def find(path: str | None = None) -> pathlib.Path | None:
    """명시한 경로 → SCALPER_ENV_FILE → 현재 폴더의 .env 순으로 찾습니다."""
    for candidate in (path, os.environ.get("SCALPER_ENV_FILE"), DEFAULT_NAME):
        if not candidate:
            continue
        p = pathlib.Path(candidate).expanduser()
        if p.is_file():
            return p
    return None


def is_world_readable(p: pathlib.Path) -> bool:
    try:
        return bool(p.stat().st_mode & (stat.S_IRGRP | stat.S_IROTH))
    except OSError:
        return False


def load(path: str | None = None, override: bool = False) -> tuple[list[str], str]:
    """`.env` 를 환경변수로 올립니다.

    돌려주는 값은 (새로 설정된 키 이름들, 사용한 파일 경로) 입니다.
    값은 돌려주지 않습니다 — 로그나 화면에 비밀값이 남지 않게.
    """
    p = find(path)
    if p is None:
        return [], ""
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return [], ""

    applied: list[str] = []
    for key, value in parse(text).items():
        if not override and key in os.environ and os.environ[key] != "":
            continue
        if value == "":
            continue          # 빈 값은 '설정 안 함'으로 둡니다 (.env.example 대비)
        os.environ[key] = value
        applied.append(key)
    return applied, str(p)
