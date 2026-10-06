# -*- coding: utf-8 -*-
"""STYLE MIRROR 커맨드라인.

  python3 -m stylemirror check                     실행 환경 점검
  python3 -m stylemirror init --sample             옷장 DB 만들기 (+예시 옷 17벌)
  python3 -m stylemirror serve --lan               앱/거울 서버 실행 (휴대폰 접속 허용)
  python3 -m stylemirror list                      옷장 목록
  python3 -m stylemirror add "네이비 니트" top --color 네이비 --warmth 4
  python3 -m stylemirror recommend --occasion office
  python3 -m stylemirror score 3 6 11 15           옷 번호로 채점
  python3 -m stylemirror score --photo me.jpg      사진으로 채점 (AI)
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import socket
import sys
from pathlib import Path

from . import __version__, stylist
from .closet import CATEGORIES, SAMPLE_CLOSET, STYLES, Closet, Garment
from .coach import Coach
from .config import MirrorConfig
from .weather import get_weather, offline_weather


def _cfg(args) -> MirrorConfig:
    cfg = MirrorConfig.load(Path(args.config) if args.config else None)
    if getattr(args, "data", None):
        cfg.data_dir = Path(args.data)
    if getattr(args, "no_ai", False):
        cfg.use_ai = False
    return cfg


def _weather(cfg: MirrorConfig, offline: bool):
    return offline_weather(cfg.city) if offline else get_weather(cfg.latitude, cfg.longitude, cfg.city)


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def cmd_check(args) -> int:
    cfg = _cfg(args)
    print(f"STYLE MIRROR {__version__}")
    print(f"  파이썬        : {sys.version.split()[0]}")
    print(f"  데이터 폴더   : {cfg.data_dir.resolve()}")
    try:
        import anthropic  # noqa: F401
        sdk = "설치됨"
    except ImportError:
        sdk = "없음 (pip install anthropic)"
    print(f"  anthropic SDK : {sdk}")
    print(f"  API 키        : {'설정됨' if os.environ.get('ANTHROPIC_API_KEY') else '없음 → 규칙 기반 코치로 동작'}")
    print(f"  AI 모델       : {cfg.llm_model} (effort={cfg.llm_effort})")
    w = get_weather(cfg.latitude, cfg.longitude, cfg.city)
    print(f"  날씨          : {w.summary()} [{w.source}]")
    return 0


def cmd_init(args) -> int:
    cfg = _cfg(args)
    closet = Closet(cfg.db_path)
    added = 0
    if args.sample and not closet.all():
        for g in SAMPLE_CLOSET:
            closet.add(Garment(**{**g.__dict__, "id": None}))
            added += 1
    print(f"옷장 DB: {cfg.db_path}  (예시 옷 {added}벌 추가, 전체 {len(closet.all())}벌)")
    return 0


def cmd_list(args) -> int:
    closet = Closet(_cfg(args).db_path)
    items = closet.all(owner=args.owner)
    for g in items:
        print(f"  {g.label}  [{g.style}]" + (f"  @{g.owner}" if g.owner else ""))
    print(f"총 {len(items)}벌")
    return 0


def cmd_add(args) -> int:
    closet = Closet(_cfg(args).db_path)
    g = closet.add(Garment(name=args.name, category=args.category, color=args.color,
                           material=args.material, style=args.style, warmth=args.warmth,
                           waterproof=args.waterproof, owner=args.owner or ""))
    print(f"추가됨: {g.label}")
    return 0


def cmd_recommend(args) -> int:
    cfg = _cfg(args)
    closet = Closet(cfg.db_path)
    coach = Coach(cfg, closet)
    r = coach.recommend(_weather(cfg, args.offline), args.occasion, args.owner, args.request or "")
    print(f"[날씨] {r['weather']['summary']}")
    print(f"[일정] {r['occasion_ko']}   [코치] {r['source']}")
    print(f"\n{r['message']}\n")
    for i, o in enumerate(r["outfits"]):
        star = "⭐" if i == r["choice"] else "  "
        print(f"{star} 코디 {i + 1}: " + " + ".join(g["label"] for g in o["items"]))
        for reason in o["reasons"]:
            print(f"      · {reason}")
    if r["outfits"]:
        for t in r["outfits"][0]["tips"]:
            print(f"  ☂ {t}")
    return 0


def cmd_score(args) -> int:
    cfg = _cfg(args)
    closet = Closet(cfg.db_path)
    coach = Coach(cfg, closet)
    image, mtype = None, "image/jpeg"
    if args.photo:
        image = Path(args.photo).read_bytes()
        mtype = mimetypes.guess_type(args.photo)[0] or "image/jpeg"
    r = coach.evaluate_look(image, _weather(cfg, args.offline), args.occasion, args.owner,
                            media_type=mtype, worn_ids=args.ids)
    if r.get("total") is None:
        print(r["message"])
        return 1
    closet.log_score(r["total"], args.owner or "", args.occasion, r["source"], r["message"])
    print(f"\n  ★ {r['total']}점  {r['grade']}   ({r['source']})\n")
    for s in r["scores"]:
        bar = "█" * round(10 * s["score"] / s["max"])
        print(f"  {s['label']:<14} {bar:<10} {s['score']:>2}/{s['max']}")
    print(f"\n{r['message']}")
    for x in r.get("good_points", []):
        print(f"  👍 {x}")
    for x in r.get("fixes", []):
        print(f"  ✏️  {x}")
    for g in r.get("suggestions", []):
        print(f"  → 추천: {g['label']}")
    return 0


def cmd_serve(args) -> int:
    from .server import serve
    cfg = _cfg(args)
    if args.lan:
        cfg.host = "0.0.0.0"
        print(f"같은 와이파이의 휴대폰에서 접속: http://{_lan_ip()}:{args.port or cfg.port}/")
    if args.port:
        cfg.port = args.port
    serve(cfg)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="stylemirror", description="가정용 AI 외출 코디 코치 거울")
    p.add_argument("--config", help="설정 파일 (기본: mirror.config.json)")
    p.add_argument("--data", help="데이터 폴더 (기본: mirror_data)")
    p.add_argument("--no-ai", action="store_true", help="Claude 를 쓰지 않고 규칙 기반으로만 동작")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="실행 환경 점검").set_defaults(fn=cmd_check)

    s = sub.add_parser("init", help="옷장 DB 만들기")
    s.add_argument("--sample", action="store_true", help="예시 옷 17벌 넣기")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("list", help="옷장 목록")
    s.add_argument("--owner")
    s.set_defaults(fn=cmd_list)

    s = sub.add_parser("add", help="옷 추가")
    s.add_argument("name")
    s.add_argument("category", choices=list(CATEGORIES))
    s.add_argument("--color", default="")
    s.add_argument("--material", default="")
    s.add_argument("--style", default="casual", choices=STYLES)
    s.add_argument("--warmth", type=int, default=3, help="1(아주 얇음)~5(아주 두꺼움)")
    s.add_argument("--waterproof", action="store_true")
    s.add_argument("--owner")
    s.set_defaults(fn=cmd_add)

    for name, fn, hlp in (("recommend", cmd_recommend, "오늘 코디 추천"),
                          ("score", cmd_score, "코디 채점 (옷 번호 또는 사진)")):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("--occasion", default="daily", choices=list(stylist.OCCASIONS))
        s.add_argument("--owner")
        s.add_argument("--offline", action="store_true", help="날씨를 계절 평균값으로")
        if name == "recommend":
            s.add_argument("--request", help='예) "오늘 결혼식 가는데 뭐 입지?"')
        else:
            s.add_argument("ids", nargs="*", type=int, help="오늘 입은 옷 번호")
            s.add_argument("--photo", help="전신 사진 파일 (AI 필요)")
        s.set_defaults(fn=fn)

    s = sub.add_parser("serve", help="앱·거울 서버 실행")
    s.add_argument("--port", type=int)
    s.add_argument("--lan", action="store_true", help="같은 와이파이의 휴대폰 접속 허용")
    s.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    return args.fn(args)
