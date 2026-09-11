#!/usr/bin/env python3
"""세 친구의 여행 — src/ 를 단일 HTML 로 합친다. 의존성 없음."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "07_MVP_Code" / "src"
OUT_HTML = ROOT / "07_MVP_Code" / "three_friends.html"

MARKERS = {
    "/* __STYLE__ */": SRC / "style.css",
    "/* __ENGINE__ */": SRC / "engine.js",
    "/* __GAME__ */": SRC / "game.js",
}


def render() -> str:
    html = (SRC / "template.html").read_text(encoding="utf-8")
    for marker, path in MARKERS.items():
        if marker not in html:
            raise SystemExit(f"템플릿에 {marker} 자리표시자가 없습니다: {path.name}")
        html = html.replace(marker, path.read_text(encoding="utf-8"))
    return html


def build() -> Path:
    html = render()
    OUT_HTML.write_text(html, encoding="utf-8")
    print(f"[build] {OUT_HTML.relative_to(ROOT)}  ({len(html):,} bytes)")
    return OUT_HTML


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="빌드만 확인")
    args = ap.parse_args()
    build()
    if not args.check:
        print("[done]  브라우저에서 07_MVP_Code/three_friends.html 을 열면 바로 플레이할 수 있습니다.")
