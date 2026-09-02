#!/usr/bin/env python3
"""SKY GOAL 2.0 빌드 스크립트.

src/ 의 template.html, style.css, engine.js, game.js 를 하나의 실행 가능한
단일 HTML 파일로 합치고(07_MVP_Code/sky_goal_2_0.html), 배포용 zip 을 만든다.

    python3 build.py            # 단일 HTML 생성
    python3 build.py --zip      # HTML + 10_Release/SKY_GOAL_2_0_v1.zip
    python3 build.py --check    # 생성 후 node 로 문법 검사 (node 가 있을 때)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "07_MVP_Code" / "src"
OUT_HTML = ROOT / "07_MVP_Code" / "sky_goal_2_0.html"
ZIP_PATH = ROOT / "10_Release" / "SKY_GOAL_2_0_v1.zip"

MARKERS = {
    "/* __STYLE__ */": SRC / "style.css",
    "/* __ENGINE__ */": SRC / "engine.js",
    "/* __GAME__ */": SRC / "game.js",
}


def build() -> Path:
    html = (SRC / "template.html").read_text(encoding="utf-8")
    for marker, path in MARKERS.items():
        if marker not in html:
            raise SystemExit(f"템플릿에 {marker} 자리표시자가 없습니다: {path.name}")
        html = html.replace(marker, path.read_text(encoding="utf-8"))
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(html, encoding="utf-8")
    print(f"[build] {OUT_HTML.relative_to(ROOT)}  ({len(html):,} bytes)")
    return OUT_HTML


def check() -> None:
    node = shutil.which("node")
    if not node:
        print("[check] node 를 찾을 수 없어 문법 검사를 건너뜁니다.")
        return
    for js in (SRC / "engine.js", SRC / "game.js"):
        subprocess.run([node, "--check", str(js)], check=True)
        print(f"[check] {js.name} 문법 OK")


def make_zip() -> Path:
    ZIP_PATH.parent.mkdir(parents=True, exist_ok=True)
    skip_parts = {"__pycache__", ".git"}
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ROOT.rglob("*")):
            if not f.is_file() or f == ZIP_PATH:
                continue
            if skip_parts & set(f.parts):
                continue
            z.write(f, Path("SKY_GOAL_2_0") / f.relative_to(ROOT))
    print(f"[zip]   {ZIP_PATH.relative_to(ROOT)}  ({ZIP_PATH.stat().st_size:,} bytes)")
    return ZIP_PATH


def main() -> int:
    ap = argparse.ArgumentParser(description="SKY GOAL 2.0 빌드")
    ap.add_argument("--zip", action="store_true", help="배포용 zip 생성")
    ap.add_argument("--check", action="store_true", help="node 문법 검사 실행")
    args = ap.parse_args()

    if args.check:
        check()
    build()
    if args.zip:
        make_zip()
    print("[done]  브라우저에서 07_MVP_Code/sky_goal_2_0.html 을 열면 바로 플레이할 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
