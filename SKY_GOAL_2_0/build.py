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
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "07_MVP_Code" / "src"
OUT_HTML = ROOT / "07_MVP_Code" / "sky_goal_2_0.html"
PWA_DIR = ROOT / "07_MVP_Code" / "pwa"
ICON_DIR = ROOT / "10_Release" / "store" / "icons"
ZIP_PATH = ROOT / "10_Release" / "SKY_GOAL_2_0_v1.zip"

# PWA(설치형 웹앱) 전용 head 태그. 단일 HTML 배포본에는 넣지 않는다
# (manifest/sw 파일이 없는 곳에서 404 콘솔 에러가 나기 때문).
PWA_HEAD = """<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#07111f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 캐시 없이도 동작 */ });
  });
}
</script>"""

MANIFEST = {
    "name": "SKY GOAL 2.0",
    "short_name": "SKY GOAL",
    "description": "탭 한 번으로 즐기는 원버튼 축구 아케이드. 플레이할수록 AI가 난이도를 맞춰줍니다.",
    "start_url": "./index.html",
    "scope": "./",
    "display": "fullscreen",
    "orientation": "portrait",
    "background_color": "#07111f",
    "theme_color": "#07111f",
    "categories": ["games", "sports"],
    "lang": "ko",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/adaptive-foreground-432.png", "sizes": "432x432", "type": "image/png",
         "purpose": "maskable"},
    ],
}

SERVICE_WORKER = """/* SKY GOAL 2.0 — 오프라인 캐시 */
const CACHE = 'sky-goal-{version}';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {{
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
}});

self.addEventListener('activate', (e) => {{
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
}});

// 캐시 우선 — 게임이 통째로 한 파일이라 오프라인에서 완전히 동작한다.
self.addEventListener('fetch', (e) => {{
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
}});
"""

MARKERS = {
    "/* __STYLE__ */": SRC / "style.css",
    "/* __ENGINE__ */": SRC / "engine.js",
    "/* __AUDIO__ */": SRC / "audio.js",
    "/* __SCENERY__ */": SRC / "scenery.js",
    "/* __GAME__ */": SRC / "game.js",
}


def render(pwa: bool = False) -> str:
    html = (SRC / "template.html").read_text(encoding="utf-8")
    for marker, path in MARKERS.items():
        if marker not in html:
            raise SystemExit(f"템플릿에 {marker} 자리표시자가 없습니다: {path.name}")
        html = html.replace(marker, path.read_text(encoding="utf-8"))
    if pwa:
        html = html.replace("</head>", PWA_HEAD + "\n</head>", 1)
    return html


def build() -> Path:
    html = render()
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(html, encoding="utf-8")
    print(f"[build] {OUT_HTML.relative_to(ROOT)}  ({len(html):,} bytes)")
    return OUT_HTML


def build_pwa() -> Path:
    """설치형 웹앱(PWA)을 만든다. 스토어 없이도 홈 화면에 추가해 오프라인 실행된다."""
    version = "1.0.0"
    (PWA_DIR / "icons").mkdir(parents=True, exist_ok=True)
    (PWA_DIR / "index.html").write_text(render(pwa=True), encoding="utf-8")
    (PWA_DIR / "manifest.webmanifest").write_text(
        json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding="utf-8")
    (PWA_DIR / "sw.js").write_text(SERVICE_WORKER.format(version=version), encoding="utf-8")

    copied = 0
    for name in ("icon-192.png", "icon-512.png", "adaptive-foreground-432.png"):
        src = ICON_DIR / name
        if src.exists():
            shutil.copyfile(src, PWA_DIR / "icons" / name)
            copied += 1
    print(f"[pwa]   {PWA_DIR.relative_to(ROOT)}  (아이콘 {copied}개)")
    if copied < 3:
        print("        ! 아이콘이 부족합니다. 10_Release/store/tools/make_assets.mjs 를 먼저 실행하세요.")
    return PWA_DIR


def check() -> None:
    node = shutil.which("node")
    if not node:
        print("[check] node 를 찾을 수 없어 문법 검사를 건너뜁니다.")
        return
    for js in (SRC / "engine.js", SRC / "audio.js", SRC / "scenery.js", SRC / "game.js"):
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
    ap.add_argument("--pwa", action="store_true", help="설치형 웹앱(PWA) 생성")
    ap.add_argument("--check", action="store_true", help="node 문법 검사 실행")
    args = ap.parse_args()

    if args.check:
        check()
    build()
    if args.pwa:
        build_pwa()
    if args.zip:
        make_zip()
    print("[done]  브라우저에서 07_MVP_Code/sky_goal_2_0.html 을 열면 바로 플레이할 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
