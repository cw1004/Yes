# -*- coding: utf-8 -*-
"""INDIA 2030 자동 영상 생성기 커맨드라인.

  python -m india2030 make --range 1-100 --workers 4
  python -m india2030 make --range 1 --tts edge --bgm assets/bgm
  python -m india2030 script --range 1-10 --print
  python -m india2030 list
  python -m india2030 check
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import json
import sys
import time
from pathlib import Path
from typing import List

from . import __version__
from . import ffmpeg as ff
from .config import ASPECTS, Config, find_font
from .langs import LANGUAGES, get_pack
from .episodes import ACTS, all_episodes, get_episode, parse_range
from .pipeline import (EpisodeResult, _write_subtitles, make_episode,
                       write_manifest)
from .providers import tts as ttsprov
from .scriptgen import build_script, save_script


# ------------------------------------------------------------------ 설정 조립
def build_config(args: argparse.Namespace) -> Config:
    cfg = Config.from_file(args.config) if getattr(args, "config", None) else Config()
    m = {
        "out": "out_dir", "assets": "assets_dir", "aspect": "aspect", "fps": "fps",
        "font": "font", "watermark": "watermark", "script_provider": "script_provider",
        "llm_model": "llm_model", "tts": "tts_provider", "voice": "tts_voice",
        "images": "image_provider", "stock": "stock_dir", "bgm": "bgm",
        "bgm_gain": "bgm_gain_db", "workers": "workers", "seed": "seed",
        "transition": "transition", "preset": "preset", "crf": "crf",
        "lang": "lang", "caption_lang": "caption_lang",
    }
    for arg_name, field_name in m.items():
        val = getattr(args, arg_name, None)
        if val is not None:
            if field_name in ("out_dir", "assets_dir", "stock_dir", "bgm"):
                val = Path(val)
            setattr(cfg, field_name, val)
    for flag in ("overwrite", "keep_workdir", "dry_run"):
        if getattr(args, flag, False):
            setattr(cfg, flag, True)
    if getattr(args, "no_subtitle", False):
        cfg.subtitle = False
    return cfg


# ------------------------------------------------------------------ 서브커맨드
def cmd_list(args: argparse.Namespace) -> int:
    lang = getattr(args, "lang", None) or "ko"
    titles = get_pack(lang)["titles"]
    eps = all_episodes()
    if args.act:
        eps = [e for e in eps if e.act.no == args.act]
    for act in ACTS:
        rows = [e for e in eps if e.act.no == act.no]
        if not rows:
            continue
        print(f"\n■ ACT {act.no} — {act.name} ({act.subtitle})  [{act.first}~{act.last}화]")
        for e in rows:
            mark = " ⚑" if e.director_note else ""
            print(f"  {e.no:3d}. {titles[e.no - 1]}{mark}")
    print(f"\n총 {len(eps)}편")
    return 0


def cmd_script(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    cfg.ensure_dirs()
    numbers = parse_range(args.range)
    for no in numbers:
        ep = get_episode(no)
        script = build_script(ep, cfg)
        path = save_script(script, cfg)
        _write_subtitles(script, cfg, no)
        if args.print:
            print(f"\n=== {script.hook_title}  [{script.total_seconds:.0f}초 / {script.provider}]")
            for b in script.beats:
                print(f"  [{b.name:<7} {b.seconds:>4.0f}s] {b.narration}")
                print(f"           자막: {b.caption}")
        else:
            print(f"[{no:3d}] {path}")
    print(f"\n대본 {len(numbers)}편 저장 → {cfg.script_dir}")
    return 0


def cmd_make(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    cfg.ensure_dirs()
    numbers = parse_range(args.range)
    started = time.time()
    print(f"INDIA 2030 영상 생성 시작 — {len(numbers)}편 "
          f"({cfg.aspect} {cfg.width}x{cfg.height} @{cfg.fps}fps, 워커 {cfg.workers})")
    print(f"  내레이션 {get_pack(cfg.lang)['name']}({cfg.resolved_voice()}) · "
          f"자막 {get_pack(cfg.effective_caption_lang)['name']}")
    if not cfg.dry_run:
        ff.ffmpeg_bin()   # 없으면 여기서 친절한 에러

    results: List[EpisodeResult] = []
    lock_print = print

    def run_one(no: int) -> EpisodeResult:
        return make_episode(no, cfg, on_log=lock_print)

    if cfg.workers > 1 and len(numbers) > 1:
        with cf.ThreadPoolExecutor(max_workers=cfg.workers) as pool:
            for res in pool.map(run_one, numbers):
                results.append(res)
                _report(res)
    else:
        for no in numbers:
            res = run_one(no)
            results.append(res)
            _report(res)

    manifest = write_manifest(results, cfg)
    write_index_csv(results, cfg)
    ok = sum(1 for r in results if r.ok)
    fail = [r for r in results if not r.ok]
    print(f"\n완료: {ok}/{len(results)}편 · {time.time() - started:.0f}초 소요")
    print(f"영상: {cfg.video_dir}\n대본: {cfg.script_dir}\n매니페스트: {manifest}")
    if fail:
        print("\n실패한 회차:")
        for r in fail:
            print(f"  {r.no:3d}: {r.error}")
        return 1
    return 0


def _report(res: EpisodeResult) -> None:
    if not res.ok:
        print(f"[{res.no:3d}] ✗ 실패 — {res.error}")
    elif res.extras.get("skipped"):
        print(f"[{res.no:3d}] · 이미 존재하여 건너뜀 ({res.video})")
    elif res.extras.get("dry_run"):
        print(f"[{res.no:3d}] ✓ 대본만 생성 (dry-run)")
    else:
        print(f"[{res.no:3d}] ✓ {res.seconds:.1f}s · 음성 {res.tts} · "
              f"{res.elapsed:.0f}초 · {res.video}")


def write_index_csv(results: List[EpisodeResult], cfg: Config) -> Path:
    """업로드용 메타데이터 표 (제목/설명/해시태그/파일경로)."""
    path = cfg.out_dir / "upload_index.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["회차", "ACT", "제목", "영상파일", "썸네일", "길이(초)", "해시태그"])
        for r in sorted(results, key=lambda x: x.no):
            script_path = cfg.script_dir / f"ep{r.no:03d}.json"
            tags = ""
            title = r.extras.get("title", "")
            if script_path.exists():
                data = json.loads(script_path.read_text(encoding="utf-8"))
                tags = " ".join(data.get("hashtags", []))
                title = data.get("hook_title", title)
            w.writerow([r.no, r.extras.get("act", ""), title,
                        r.video or "", r.extras.get("thumb") or "",
                        f"{r.seconds:.1f}", tags])
    return path


def cmd_check(args: argparse.Namespace) -> int:
    cfg = build_config(args)
    print(f"INDIA 2030 generator v{__version__}\n")
    try:
        print(f"  ffmpeg      : {ff.ffmpeg_bin()}")
    except ff.FFmpegError as exc:
        print(f"  ffmpeg      : ✗ {exc}")
    print(f"  ffprobe     : {ff.ffprobe_bin() or '✗ (길이 측정 생략됨)'}")
    try:
        import PIL
        print(f"  Pillow      : {PIL.__version__}")
    except Exception:
        print("  Pillow      : ✗  pip install pillow")
    ko_font = find_font(cfg.font, "ko")
    hi_font = find_font(cfg.font, "hi")
    print(f"  한글 폰트    : {ko_font or '✗ (fonts-nanum 설치 권장)'}")
    print(f"  힌디 폰트    : {hi_font or '✗ (fonts-lohit-deva 또는 Noto Sans Devanagari 설치 권장)'}")
    print(f"  언어 설정    : 내레이션 {cfg.lang} / 자막 {cfg.effective_caption_lang} "
          f"· 보이스 {cfg.resolved_voice()}")
    print(f"  TTS 가능    : {', '.join(ttsprov.available_providers())}")
    print(f"  화면비 옵션  : {', '.join(ASPECTS)}")
    print(f"  출력 경로    : {cfg.out_dir.resolve()}")
    return 0


# ------------------------------------------------------------------ 파서
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="india2030",
        description="INDIA 2030 — 60초 영상 100편 자동 생성기",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="예)  python -m india2030 make --range 1-100 --workers 4 --bgm assets/bgm",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--config", help="설정 JSON 파일")
        sp.add_argument("--out", help="출력 폴더 (기본 output)")
        sp.add_argument("--assets", help="에셋 폴더 (기본 assets)")
        sp.add_argument("--aspect", choices=list(ASPECTS), help="화면비 (기본 9:16)")
        sp.add_argument("--fps", type=int, help="프레임레이트 (기본 30)")
        sp.add_argument("--font", help="자막용 폰트 파일 경로")
        sp.add_argument("--watermark", help="화면 하단 워터마크 문구")
        sp.add_argument("--script-provider", choices=["template", "llm"],
                        help="대본 생성 방식 (기본 template)")
        sp.add_argument("--llm-model", help="LLM 모델 이름")
        sp.add_argument("--lang", choices=list(LANGUAGES),
                        help="내레이션 언어: ko(한국어) | hi(힌디어). 기본 ko")
        sp.add_argument("--caption-lang", choices=list(LANGUAGES),
                        help="화면 자막 언어 (기본: 내레이션과 동일)")
        sp.add_argument("--seed", type=int, help="난수 시드")

    sp = sub.add_parser("list", help="100개 소제목 목록 보기")
    sp.add_argument("--act", type=int, choices=[1, 2, 3, 4, 5], help="특정 ACT 만 보기")
    sp.add_argument("--lang", choices=list(LANGUAGES), help="제목 언어 (기본 ko)")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("script", help="대본(JSON/SRT)만 생성")
    common(sp)
    sp.add_argument("--range", default="1-100", help="회차 범위 (예: 1-20,55)")
    sp.add_argument("--print", action="store_true", help="생성된 대본을 화면에 출력")
    sp.set_defaults(func=cmd_script)

    sp = sub.add_parser("make", help="영상 생성")
    common(sp)
    sp.add_argument("--range", default="1-100", help="회차 범위 (예: 1-100, 3, 5-9)")
    sp.add_argument("--workers", type=int, help="동시 처리 수 (기본 2)")
    sp.add_argument("--tts", dest="tts", help="음성 엔진: auto|edge|gtts|elevenlabs|silent")
    sp.add_argument("--voice", help="TTS 보이스 (기본: ko-KR-InJoonNeural / hi-IN-MadhurNeural)")
    sp.add_argument("--images", dest="images", choices=["auto", "pillow", "stock"],
                    help="이미지 소스 (기본 pillow)")
    sp.add_argument("--stock", help="스톡 이미지 폴더 (assets/stock)")
    sp.add_argument("--bgm", help="배경음악 파일 또는 폴더")
    sp.add_argument("--bgm-gain", type=float, help="배경음악 볼륨 dB (기본 -20)")
    sp.add_argument("--transition", choices=["xfade", "fade", "cut"],
                    help="비트 전환 방식 (기본 xfade)")
    sp.add_argument("--preset", help="libx264 프리셋 (기본 medium, 빠르게는 veryfast)")
    sp.add_argument("--crf", type=int, help="화질 (기본 20, 낮을수록 고화질)")
    sp.add_argument("--no-subtitle", action="store_true", help="자막 번인 끄기")
    sp.add_argument("--overwrite", action="store_true", help="이미 만든 영상도 다시 생성")
    sp.add_argument("--keep-workdir", action="store_true", help="중간 파일 보존")
    sp.add_argument("--dry-run", action="store_true", help="대본만 만들고 렌더링 생략")
    sp.set_defaults(func=cmd_make)

    sp = sub.add_parser("check", help="실행 환경 점검")
    common(sp)
    sp.set_defaults(func=cmd_check)
    return p


def main(argv: List[str] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\n중단되었습니다.")
        return 130
    except ff.FFmpegError as exc:
        print(f"\n오류: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
