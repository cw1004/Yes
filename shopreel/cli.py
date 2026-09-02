# -*- coding: utf-8 -*-
"""SHOPREEL 명령줄 인터페이스."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import List, Optional

from . import __version__, publish, revenue, scriptgen, sources
from .config import Config
from .pipeline import collect_and_rank, make_video, retry_pending, run_once
from .store import Store

BANNER = f"SHOPREEL v{__version__} — 소셜커머스 인기상품 자동 영상·업로드·수익화"


# ------------------------------------------------------------------ 공통
def build_config(args: argparse.Namespace) -> Config:
    cfg = Config.load(getattr(args, "config", None))
    for attr, field in (("out", "out_dir"), ("lang", "lang"), ("duration", "duration"),
                        ("top", "top_n"), ("workers", "workers"), ("tts", "tts_provider"),
                        ("tracker", "tracker_base"), ("aspect", "aspect"),
                        ("preset", "preset"), ("crf", "crf"), ("script", "script_provider")):
        value = getattr(args, attr, None)
        if value is not None:
            setattr(cfg, field, Path(value) if field == "out_dir" else value)
    if getattr(args, "sources", None):
        cfg.sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    if getattr(args, "publish", None):
        cfg.publish_to = [s.strip() for s in args.publish.split(",") if s.strip()]
    if getattr(args, "bgm", None):
        cfg.bgm = Path(args.bgm)
    if getattr(args, "dry_run", False):
        cfg.dry_run = True
    if getattr(args, "overwrite", False):
        cfg.overwrite = True
    if getattr(args, "debug", False):
        cfg.extra["debug"] = True
    return cfg


def add_common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--config", help="설정 파일 경로 (기본 shopreel.config.json)")
    p.add_argument("--out", help="출력 디렉터리")
    p.add_argument("--lang", choices=["ko", "en"], help="대본/자막 언어")
    p.add_argument("--duration", type=float, help="영상 길이(초). 예 10 15 30 45")
    p.add_argument("--top", type=int, help="이번 실행에서 만들 편수")
    p.add_argument("--sources", help="수집 소스 (쉼표): demo,aliexpress,amazon,coupang,rakuten,ebay,custom")
    p.add_argument("--publish", help="업로드 대상 (쉼표): dryrun,youtube,tiktok,instagram,facebook")
    p.add_argument("--tts", help="음성 엔진: auto|edge|gtts|elevenlabs|silent|none")
    p.add_argument("--script", choices=["template", "llm"], help="대본 생성기")
    p.add_argument("--aspect", choices=["9:16", "1:1", "16:9"], help="화면비")
    p.add_argument("--preset", help="libx264 프리셋 (veryfast 로 빠르게)")
    p.add_argument("--crf", type=int, help="화질 (낮을수록 고화질)")
    p.add_argument("--bgm", help="배경음악 파일 또는 폴더")
    p.add_argument("--tracker", help="추적 서버 베이스 URL")
    p.add_argument("--workers", type=int, help="동시 처리 수")
    p.add_argument("--dry-run", action="store_true", help="렌더링/업로드 없이 계획만")
    p.add_argument("--overwrite", action="store_true", help="이미 만든 영상도 다시 생성")
    p.add_argument("--debug", action="store_true", help="오류 상세 출력")


# ------------------------------------------------------------------ check
def cmd_check(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    print(BANNER)
    print()
    print("■ 렌더링 환경")
    try:
        from india2030 import ffmpeg as ff
        print(f"  ffmpeg      : {ff.ffmpeg_bin()}")
        print(f"  ffprobe     : {ff.ffprobe_bin() or '없음 (길이 측정 생략)'}")
    except Exception as e:
        print(f"  ffmpeg      : 없음 — {e}")
    try:
        import PIL
        print(f"  Pillow      : {PIL.__version__}")
    except Exception:
        print("  Pillow      : 없음 (pip install pillow)")
    print(f"  폰트        : {cfg.resolved_font() or '없음 (자막이 깨질 수 있음)'}")
    try:
        from india2030.providers import tts as ttsprov
        print(f"  TTS 가능    : {', '.join(ttsprov.available_providers())}")
    except Exception:
        print("  TTS 가능    : 확인 불가")

    print()
    print("■ 수집 소스")
    for name, ok, why in sources.status():
        mark = "○" if ok else "×"
        use = " (사용중)" if name in cfg.sources else ""
        print(f"  {mark} {name:<12}{why}{use}")

    print()
    print("■ 업로드 대상")
    for name, ok, why in publish.status():
        mark = "○" if ok else "×"
        use = " (사용중)" if name in cfg.publish_to else ""
        print(f"  {mark} {name:<12}{why}{use}")

    print()
    print("■ 설정")
    print(f"  출력        : {cfg.out_dir}")
    print(f"  DB          : {cfg.db}")
    print(f"  영상        : {cfg.duration:.0f}초 · {cfg.aspect} · {cfg.fps}fps")
    print(f"  언어        : {cfg.lang} / 대본 {cfg.script_provider}")
    print(f"  추적 링크   : {cfg.tracker_base}/r/<code>")
    print(f"  링크인바이오: {cfg.tracker_base}/shop")
    print(f"  일일 한도   : {cfg.daily_limit}")

    warnings = readiness_warnings(cfg)
    if warnings:
        print()
        print("■ 확인이 필요합니다")
        for w in warnings:
            print(f"  ! {w}")
    return 0


def readiness_warnings(cfg: Config) -> List[str]:
    """운영 전에 걸리기 쉬운 설정을 미리 잡아 준다."""
    out: List[str] = []
    base = (cfg.tracker_base or "").rstrip("/")
    local = any(h in base for h in ("localhost", "127.0.0.1", "0.0.0.0")) or not base

    if "instagram" in cfg.publish_to and not (base.startswith("https://") and not local):
        out.append("인스타그램은 공개 영상 URL 이 필요합니다. tracker_base 를 공개 "
                   "https 도메인으로 두거나 PUBLIC_VIDEO_BASE 를 지정하세요")
    if local and cfg.publish_to != ["dryrun"]:
        out.append(f"tracker_base 가 외부에서 접근할 수 없는 주소입니다: {base or '(비어 있음)'} "
                   "— 링크인바이오와 클릭 추적이 동작하지 않습니다")
    if base.startswith("http://") and not local:
        out.append("추적 링크가 http 입니다. SNS 는 http 링크를 신뢰하지 않습니다 — "
                   "certbot 으로 https 를 붙이세요")
    if "youtube" in cfg.publish_to and cfg.daily_limit.get("youtube", 0) > 6:
        out.append(f"유튜브 일일 한도가 {cfg.daily_limit['youtube']}건입니다. 기본 할당량"
                   "(10,000 유닛)으로는 하루 6건이 한계라 초과분은 실패합니다")
    if not os.environ.get("SHOPREEL_POSTBACK_SECRET"):
        out.append("SHOPREEL_POSTBACK_SECRET 이 없습니다 — 전환 웹훅이 무방비로 열립니다")
    return out


# ------------------------------------------------------------------ sources / trends
def cmd_sources(args: argparse.Namespace) -> int:
    for name, ok, why in sources.status():
        print(f"{'○' if ok else '×'} {name:<12}{why}")
    return 0


def cmd_trends(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    cfg.ensure_dirs()
    store = Store(cfg.db)
    picks = collect_and_rank(cfg, store, log=(lambda m: None) if args.json else print)
    limit = args.limit or cfg.top_n * 5
    picks = picks[:limit]

    if args.json:
        print(json.dumps([p.to_dict() for p in picks], ensure_ascii=False, indent=2))
        return 0

    if not picks:
        print("조건에 맞는 상품이 없습니다. --sources 또는 필터를 확인하세요.")
        return 1
    print()
    print(f"{'#':>2} {'점수':>6} {'소스':<11}{'가격':>10} {'할인':>6} {'평점':>5} "
          f"{'최근판매':>9}  제목")
    for i, p in enumerate(picks, 1):
        print(f"{i:>2} {p.score:>6.1f} {p.source:<11}{p.price_text():>10} "
              f"{p.discount:>5.0f}% {p.rating:>5.1f} {p.sold_delta:>9,}  {p.title[:44]}")
    return 0


# ------------------------------------------------------------------ make / run / auto
def cmd_make(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    cfg.ensure_dirs()
    store = Store(cfg.db)
    picks = collect_and_rank(cfg, store, print)[:cfg.top_n]
    if not picks:
        print("조건에 맞는 상품이 없습니다.")
        return 1
    made = 0
    for i, product in enumerate(picks, 1):
        print(f"[{i}/{len(picks)}] {product.title[:46]}")
        try:
            asset, _ = make_video(product, cfg, store, print)
            store.add_video(asset)
            print(f"  → {asset.path}")
            print(f"  → 링크 {asset.link}")
            made += 1
        except Exception as e:
            print(f"  ! 실패: {type(e).__name__}: {e}")
            if cfg.extra.get("debug"):
                raise
    print(f"\n완료: {made}/{len(picks)}편")
    return 0 if made else 1


def cmd_run(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    result = run_once(cfg, log=print)
    print()
    print(f"영상 {len(result.videos)}편 · 업로드 {sum(1 for p in result.posts if p.ok)}건 "
          f"· 실패 {len(result.errors)}건 · {result.elapsed:.0f}초")
    for v in result.videos:
        print(f"  {Path(v.path).name}  {v.link}")
    return 0 if result.videos else 1


def cmd_auto(args: argparse.Namespace) -> int:
    from .scheduler import run_forever
    cfg = build_config(args)
    results = run_forever(cfg, every_minutes=args.every, runs=args.runs, log=print)
    total = sum(len(r.videos) for r in results)
    print(f"누적 {total}편 제작")
    return 0


# ------------------------------------------------------------------ publish / serve
def cmd_publish(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    done = retry_pending(cfg, log=print)
    print(f"재시도 완료: {done}건 성공")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import signal
    import threading

    from .tracker import serve
    cfg = build_config(args)
    cfg.ensure_dirs()
    httpd, addr = serve(cfg, host=args.host, port=args.port)
    public = (cfg.tracker_base or addr).rstrip("/")
    print(f"추적 서버 시작: {addr}")
    print(f"  링크인바이오 : {public}/shop      ← SNS 프로필 링크에 넣을 주소")
    print(f"  리다이렉트   : {public}/r/<code>")
    print(f"  영상 공개 URL: {public}/v/<key>.mp4")
    print(f"  전환 웹훅    : POST {public}/postback?code=&order_id=&commission=")
    print(f"  통계         : {addr}/stats")
    print("Ctrl+C 로 종료", flush=True)

    # systemd 는 정지·재시작 때 SIGTERM 을 보낸다 — 처리 중인 요청을 끝내고 닫는다
    def stop(signum, frame):                       # noqa: ANN001
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, stop)
        except ValueError:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    print("종료")
    return 0


# ------------------------------------------------------------------ report / revenue
def cmd_report(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    store = Store(cfg.db)
    data = revenue.report(store, days=args.days)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(revenue.format_report(data, cfg.lang))
    return 0


def cmd_import_revenue(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    store = Store(cfg.db)
    stats = revenue.import_csv(Path(args.csv), store, network=args.network or "")
    print(f"추가 {stats['added']}건 · 건너뜀 {stats['skipped']}건")
    return 0


def cmd_links(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    store = Store(cfg.db)
    rows = store.recent_videos(args.limit)
    if not rows:
        print("아직 만든 영상이 없습니다.")
        return 1
    for r in rows:
        when = time.strftime("%m-%d %H:%M", time.localtime(r["created_at"]))
        print(f"{when}  {Path(r['path']).name}  {r['link']}")
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    """오래된 영상·업로드 패키지를 지운다 (DB 기록과 수익 데이터는 유지)."""
    cfg = build_config(args)
    cutoff = time.time() - args.days * 86400
    targets: List[Path] = []
    for folder in (cfg.video_dir, cfg.out_dir / "upload", cfg.work_dir):
        if folder.exists():
            targets.extend(f for f in folder.rglob("*") if f.is_file()
                           and f.stat().st_mtime < cutoff)
    freed = sum(f.stat().st_size for f in targets)
    if args.dry_run or cfg.dry_run:
        print(f"삭제 대상 {len(targets)}개 · {freed / 1e6:.1f}MB (실제로 지우지 않음)")
        return 0
    for f in targets:
        try:
            f.unlink()
        except OSError:
            pass
    for folder in (cfg.out_dir / "upload", cfg.work_dir):
        for d in sorted((p for p in folder.rglob("*") if p.is_dir()), reverse=True) \
                if folder.exists() else []:
            try:
                d.rmdir()          # 빈 디렉터리만 정리된다
            except OSError:
                pass
    print(f"{len(targets)}개 삭제 · {freed / 1e6:.1f}MB 확보 ({args.days}일 이전)")
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    src = Path(__file__).resolve().parent.parent / "shopreel.config.example.json"
    dst = Path(args.path or "shopreel.config.json")
    if dst.exists() and not args.force:
        print(f"{dst} 이(가) 이미 있습니다. 덮어쓰려면 --force")
        return 1
    if src.exists():
        shutil.copy2(src, dst)
    else:
        dst.write_text(json.dumps(Config().to_dict(), ensure_ascii=False, indent=2),
                       encoding="utf-8")
    print(f"설정 파일 생성: {dst}")
    return 0


# ------------------------------------------------------------------ 엔트리포인트
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="shopreel", description=BANNER)
    parser.add_argument("--version", action="version", version=f"shopreel {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name: str, help_: str, func):
        p = sub.add_parser(name, help=help_)
        add_common(p)
        p.set_defaults(func=func)
        return p

    add("check", "실행 환경·키·설정 점검", cmd_check)
    add("sources", "수집 소스 상태 보기", cmd_sources)

    p = add("trends", "실시간 인기 상품 수집·순위", cmd_trends)
    p.add_argument("--limit", type=int, help="출력 개수")
    p.add_argument("--json", action="store_true", help="JSON 출력")

    add("make", "영상만 생성 (업로드 안 함)", cmd_make)
    add("run", "수집→영상→업로드 1회 실행", cmd_run)

    p = add("auto", "주기 실행 (자동화 루프)", cmd_auto)
    p.add_argument("--every", type=int, help="실행 간격(분)")
    p.add_argument("--runs", type=int, default=0, help="반복 횟수 (0=무한)")

    add("publish", "대기·실패한 업로드 재시도", cmd_publish)

    p = add("serve", "클릭 추적 리다이렉트 서버 실행", cmd_serve)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8787)

    p = add("report", "클릭·주문·수익 리포트", cmd_report)
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--json", action="store_true")

    p = add("import-revenue", "제휴 네트워크 전환 CSV 가져오기", cmd_import_revenue)
    p.add_argument("csv", help="CSV 파일 경로")
    p.add_argument("--network", help="네트워크 이름 (amazon, coupang ...)")

    p = add("links", "최근 만든 영상과 추적 링크", cmd_links)
    p.add_argument("--limit", type=int, default=20)

    p = add("prune", "오래된 영상·업로드 패키지 정리 (기록은 유지)", cmd_prune)
    p.add_argument("--days", type=int, default=30, help="이 일수보다 오래된 파일 삭제")

    p = add("init", "설정 파일 생성", cmd_init)
    p.add_argument("path", nargs="?", help="생성할 경로")
    p.add_argument("--force", action="store_true")

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("\n중단됨")
        return 130
    except Exception as e:
        print(f"오류: {type(e).__name__}: {e}", file=sys.stderr)
        if getattr(args, "debug", False):
            raise
        return 1
