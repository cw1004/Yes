# -*- coding: utf-8 -*-
"""하나의 길 — ONE WAY 커맨드라인.

  python3 -m oneway serve                   # 홈페이지 띄우기 (기본 8000 포트)
  python3 -m oneway ask "요즘 너무 지칩니다"   # 터미널에서 상담사와 대화
  python3 -m oneway today                   # 오늘의 3분 보기
  python3 -m oneway check                   # 환경 점검
  python3 -m oneway build                   # 정적 사이트로 내보내기
  python3 -m oneway sitemap                 # sitemap.xml 출력
  python3 -m oneway purge --days 180        # 오래된 방문 기록 삭제
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

from . import BRAND, BRAND_EN, TAGLINE, __version__
from .config import Config
from .content import daily as daily_mod
from .content import entries, fifty, pages as pages_mod
from .counselor import llm
from .counselor.engine import Counselor
from .counselor.session import Store, Visitor
from .seo import all_urls, robots_txt, sitemap_xml
from .web import render


def build_config(args: argparse.Namespace) -> Config:
    cfg = Config.from_file(args.config) if getattr(args, "config", None) else Config()
    for arg, field in (("host", "host"), ("port", "port"), ("site_url", "site_url"),
                       ("model", "model"), ("counselor", "counselor"),
                       ("effort", "effort"), ("data", "data_dir"), ("out", "out_dir")):
        val = getattr(args, arg, None)
        if val is not None:
            setattr(cfg, field, Path(val) if field.endswith("_dir") else val)
    return cfg


# ------------------------------------------------------------------ serve
def cmd_serve(args: argparse.Namespace) -> int:
    from .web.server import serve
    serve(build_config(args))
    return 0


# ------------------------------------------------------------------ ask
def cmd_ask(args: argparse.Namespace) -> int:
    """터미널 상담. 대화 기록은 --data 아래에 남아 연속 방문이 계산된다."""
    cfg = build_config(args)
    store = Store(cfg.sessions_dir)
    visitor = store.get_or_create(args.session)
    counselor = Counselor(cfg)

    def one(message: str) -> None:
        reply = counselor.respond(message, visitor)
        store.save(visitor)
        print()
        print(reply.as_text())
        print()

    if args.message:
        one(" ".join(args.message))
        print(f"  (세션 id: {visitor.id} — 이어서 대화하려면 --session {visitor.id})")
        return 0

    print(f"  {BRAND} — {TAGLINE}")
    print("  무엇이든 편하게 말씀하십시오. 끝내려면 빈 줄에서 Enter 또는 Ctrl+C.\n")
    one("안녕하세요")
    while True:
        try:
            line = input("나 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  안녕히 가십시오.")
            return 0
        if not line:
            print("  안녕히 가십시오. 내일 또 오십시오.")
            return 0
        one(line)


# ------------------------------------------------------------------ today
def cmd_today(args: argparse.Namespace) -> int:
    on = date.fromisoformat(args.date) if args.date else date.today()
    card = daily_mod.build(on)
    print(f"\n  오늘의 3분 — {card.day}\n")
    print(f"  ① 오늘의 말씀   {card.verse_ref}  ({card.verse_ref_protestant})")
    print(f"                 {card.verse_gist}")
    print(f"  ② 오늘의 질문   {card.question}")
    print(f"  ③ 오늘의 기도   {card.prayer}")
    print(f"  ④ 오늘의 사랑   {card.love}")
    print(f"\n  이번 주의 질문  {card.weekly_question}")
    print(f"  {card.tomorrow_teaser}")
    print(f"  더 읽기 — {card.belief_title} {card.belief_url}\n")
    return 0


# ------------------------------------------------------------------ check
def cmd_check(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    key = cfg.api_key()
    sdk = "설치됨" if llm.anthropic is not None else "없음 (pip install anthropic)"
    mode = "Claude" if llm.available(cfg) else "오프라인 규칙 엔진"
    print()
    print(f"  {BRAND} {BRAND_EN}  v{__version__}")
    print(f"  파이썬        : {sys.version.split()[0]}")
    print(f"  anthropic SDK : {sdk}")
    print(f"  {cfg.api_key_env:<14}: {'있음' if key else '없음'}")
    print(f"  상담 엔진      : {mode}  (설정: {cfg.counselor})")
    print(f"  모델          : {cfg.model} / effort={cfg.effort}")
    print(f"  사이트 주소    : {cfg.site_url}")
    print(f"  데이터 폴더    : {cfg.data_dir.resolve()}")
    print()
    from .counselor import topics as topics_mod
    surface = sum(1 for t in topics_mod.TOPICS if not t.min_depth)
    print(f"  콘텐츠        : 50가지 {len(fifty.BELIEFS)}개 · "
          f"입구 {len(entries.ENTRIES)}개 · 고정 페이지 {len(pages_mod.PAGES)}개")
    print(f"  상담 주제      : {len(topics_mod.TOPICS)}개 "
          f"(종교 언어 없이 답할 수 있는 주제 {surface}개)")
    print(f"  색인 대상 URL  : {len(all_urls())}개")
    print()
    if not key:
        print("  ※ 키가 없어도 전부 동작합니다. 키를 넣으면 상담 품질이 올라갑니다:")
        print(f"     export {cfg.api_key_env}=sk-ant-...")
        print()
    return 0


# ------------------------------------------------------------------ build
def cmd_build(args: argparse.Namespace) -> int:
    """정적 사이트로 내보낸다 (검색 유입용 페이지 전부).

    상담사와 기도 지향은 서버가 필요하므로, 정적 배포는 보통
    'SEO 페이지는 정적 + 상담 API 만 서버' 형태로 쓴다.
    """
    cfg = build_config(args)
    out = cfg.out_dir
    if out.exists() and args.clean:
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    written: List[Path] = []

    def write(path: str, markup: str) -> None:
        rel = path.strip("/")
        # 첫 페이지는 out/index.html 이어야 한다. out/index/index.html 이 아니라.
        target = (out / "index.html") if not rel else (out / rel)
        if not target.suffix:
            target = target / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markup, encoding="utf-8")
        written.append(target)

    card = daily_mod.build()
    write("/", render.home(cfg, card))
    write("/today", render.today(cfg, card))
    write("/counsel", render.counsel_page(cfg))
    write("/believe", render.believe_index(cfg))
    write("/pray", render.pray_page(cfg))
    for b in fifty.BELIEFS:
        write(b.url, render.belief_page(cfg, b))
    for e in entries.ENTRIES:
        write(e.url, render.gate_page(cfg, e))
    for p in pages_mod.PAGES:
        write(p.url, render.static_page(cfg, p))

    (out / "404.html").write_text(render.not_found(cfg), encoding="utf-8")
    (out / "sitemap.xml").write_text(sitemap_xml(cfg), encoding="utf-8")
    (out / "robots.txt").write_text(robots_txt(cfg), encoding="utf-8")

    static_src = Path(render.__file__).parent / "static"
    shutil.copytree(static_src, out / "static", dirs_exist_ok=True)

    print(f"\n  {len(written)}개 페이지를 {out.resolve()} 에 내보냈습니다.")
    print("  sitemap.xml / robots.txt / 404.html / static/ 포함\n")
    print("  ※ AI 상담사와 기도 지향은 서버(API)가 필요합니다.")
    print("     `python3 -m oneway serve` 로 함께 띄우거나,")
    print("     정적 호스팅 + 상담 API 서버를 따로 두십시오.\n")
    return 0


# ------------------------------------------------------------------ sitemap
def cmd_sitemap(args: argparse.Namespace) -> int:
    print(sitemap_xml(build_config(args)))
    return 0


# ------------------------------------------------------------------ list
def cmd_list(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    base = cfg.site_url.rstrip("/")
    for g in fifty.GROUPS:
        print(f"\n  {g.no}. {g.name} — {g.subtitle}")
        for b in fifty.BELIEFS:
            if g.first <= b.no <= g.last:
                print(f"    {b.no:02d}  {b.title}")
                print(f"        검색 제목: {b.seo_title}")
                print(f"        {base}{b.url}")
    print()
    return 0


# ------------------------------------------------------------------ purge
def cmd_purge(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    removed = Store(cfg.sessions_dir).purge(days=args.days)
    print(f"  {args.days}일 넘게 방문이 없는 기록 {removed}건을 삭제했습니다.")
    return 0


# ------------------------------------------------------------------ 파서
def make_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="oneway",
        description=f"{BRAND} — {TAGLINE}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    p.add_argument("--version", action="version", version=f"oneway {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp):
        sp.add_argument("--config", help="설정 JSON 파일")
        sp.add_argument("--site-url", help="배포 도메인 (sitemap·canonical 에 쓰임)")
        sp.add_argument("--data", help="방문 기록 저장 폴더 (기본 data)")
        sp.add_argument("--model", help=f"상담 모델 (기본 {Config().model})")
        sp.add_argument("--counselor", choices=("auto", "offline", "claude"),
                        help="상담 엔진 선택 (기본 auto)")
        sp.add_argument("--effort", choices=("low", "medium", "high", "xhigh", "max"),
                        help="모델 응답 깊이 (기본 medium)")
        return sp

    s = common(sub.add_parser("serve", help="홈페이지 띄우기"))
    s.add_argument("--host", default=None, help="기본 127.0.0.1")
    s.add_argument("--port", type=int, default=None, help="기본 8000")
    s.set_defaults(func=cmd_serve)

    s = common(sub.add_parser("ask", help="터미널에서 상담사와 대화"))
    s.add_argument("message", nargs="*", help="비워 두면 대화형으로 시작")
    s.add_argument("--session", help="이어서 대화할 세션 id")
    s.set_defaults(func=cmd_ask)

    s = sub.add_parser("today", help="오늘의 3분 보기")
    s.add_argument("--date", help="YYYY-MM-DD (다른 날짜 미리 보기)")
    s.set_defaults(func=cmd_today)

    s = common(sub.add_parser("check", help="환경 점검"))
    s.set_defaults(func=cmd_check)

    s = common(sub.add_parser("build", help="정적 사이트로 내보내기"))
    s.add_argument("--out", help="출력 폴더 (기본 out/site)")
    s.add_argument("--clean", action="store_true", help="기존 출력 폴더를 지우고 다시")
    s.set_defaults(func=cmd_build)

    s = common(sub.add_parser("sitemap", help="sitemap.xml 출력"))
    s.set_defaults(func=cmd_sitemap)

    s = common(sub.add_parser("list", help="50가지 목록과 URL 보기"))
    s.set_defaults(func=cmd_list)

    s = common(sub.add_parser("purge", help="오래된 방문 기록 삭제"))
    s.add_argument("--days", type=int, default=180, help="기본 180일")
    s.set_defaults(func=cmd_purge)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = make_parser().parse_args(argv)
    return args.func(args)
