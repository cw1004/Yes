# -*- coding: utf-8 -*-
"""한 편(60초)을 끝까지 만들어내는 파이프라인."""

from __future__ import annotations

import json
import random
import shutil
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from . import ffmpeg as ff
from . import video as vid
from .config import Config
from .episodes import Episode, get_episode
from .providers import image as imgprov
from .providers import tts as ttsprov
from .langs import get_pack
from .scriptgen import (VideoScript, _split_sentences, build_script,
                        load_script, save_script)


@dataclass
class EpisodeResult:
    no: int
    ok: bool
    video: Optional[Path] = None
    seconds: float = 0.0
    tts: str = ""
    elapsed: float = 0.0
    error: str = ""
    extras: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "no": self.no, "ok": self.ok,
            "video": str(self.video) if self.video else None,
            "seconds": round(self.seconds, 2), "tts": self.tts,
            "elapsed": round(self.elapsed, 1), "error": self.error, **self.extras,
        }


# ------------------------------------------------------------------ 자막(SRT)
def _ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(script: VideoScript, path: Path, use_caption: bool = False) -> Path:
    """내레이션(기본) 또는 자막 언어 기준 SRT 를 만든다."""
    lang = script.caption_lang if use_caption else script.lang
    ends = get_pack(lang)["sentence_end"]
    cues: List[tuple] = []
    t = 0.0
    for beat in script.beats:
        source = beat.caption if use_caption else beat.narration
        sentences = _split_sentences(source, ends)
        if not sentences:
            t += beat.seconds
            continue
        total_chars = sum(len(s) for s in sentences)
        start = t + vid.LEAD_IN
        span = beat.seconds - vid.LEAD_IN - 0.2
        for s in sentences:
            dur = span * (len(s) / total_chars)
            cues.append((start, start + dur, s))
            start += dur
        t += beat.seconds
    lines: List[str] = []
    for i, (a, b, text) in enumerate(cues, 1):
        lines += [str(i), f"{_ts(a)} --> {_ts(b)}", text, ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _write_subtitles(script: VideoScript, cfg: Config, no: int) -> None:
    """내레이션 언어 SRT + (다르면) 자막 언어 SRT 를 함께 만든다."""
    write_srt(script, cfg.script_dir / f"ep{no:03d}.{script.lang}.srt")
    if script.caption_lang != script.lang:
        write_srt(script, cfg.script_dir / f"ep{no:03d}.{script.caption_lang}.srt",
                  use_caption=True)


# ------------------------------------------------------------------ 소스 준비
def prepare_visuals(ep: Episode, script: VideoScript, cfg: Config,
                    workdir: Path) -> List[Dict[str, Path]]:
    """비트별 배경/오버레이 이미지를 만들고 경로를 돌려준다."""
    size = cfg.size
    font = cfg.resolved_font()
    stock = imgprov.stock_images(cfg, ep.no) if cfg.image_provider in ("auto", "stock") else []
    out: List[Dict[str, Path]] = []

    for i, beat in enumerate(script.beats):
        bg = workdir / f"bg_{i}_{beat.name.lower()}.jpg"
        if stock:
            imgprov.fit_to_canvas(stock[i % len(stock)], bg, size)
        else:
            scene = imgprov.pick_scene(f"{ep.title} {beat.visual} {beat.narration}", beat.name)
            imgprov.render_background(bg, size, ep.act.palette, ep.act.accent,
                                      scene, seed=cfg.seed + ep.no * 100 + i)
        ov = workdir / f"tx_{i}_{beat.name.lower()}.png"
        badge = get_pack(cfg.effective_caption_lang)["badge"].format(act=ep.act.no, no=ep.no)
        caption = beat.caption if cfg.subtitle else ""
        imgprov.render_text_overlay(
            ov, size, caption, badge, ep.act.accent, font,
            watermark=cfg.watermark, big=(beat.name == "MESSAGE"),
        )
        out.append({"bg": bg, "overlay": ov})
    return out


def prepare_audio(script: VideoScript, cfg: Config, workdir: Path) -> tuple:
    """비트별 내레이션 음성을 만들고 (경로목록, 사용된 엔진)을 돌려준다."""
    paths: List[Optional[Path]] = []
    used = ""
    for i, beat in enumerate(script.beats):
        target = workdir / f"na_{i}_{beat.name.lower()}.mp3"
        engine = ttsprov.synthesize(
            beat.narration, target, provider=cfg.tts_provider,
            voice=cfg.resolved_voice(), lang=cfg.resolved_tts_lang(),
            fallback_seconds=max(1.0, beat.seconds - vid.LEAD_IN - 0.2),
        )
        used = used or engine
        paths.append(target if target.exists() else None)
    return paths, used


# ------------------------------------------------------------------ 메인
def make_episode(no: int, cfg: Config, on_log=print) -> EpisodeResult:
    started = time.time()
    ep = get_episode(no)
    cfg.ensure_dirs()
    final = cfg.video_dir / f"ep{no:03d}_{ep.act.name}.mp4"

    if final.exists() and not cfg.overwrite:
        return EpisodeResult(no=no, ok=True, video=final, seconds=ff.duration(final),
                             tts="skip", elapsed=0.0, extras={"skipped": True})

    workdir = cfg.work_dir / f"ep{no:03d}"
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    try:
        # 1) 대본
        script = None if cfg.overwrite else load_script(no, cfg)
        if script is None:
            script = build_script(ep, cfg)
            save_script(script, cfg)
        on_log(f"[{no:3d}] 대본 준비 완료 ({script.provider}, {script.total_seconds:.0f}s)")

        if cfg.dry_run:
            _write_subtitles(script, cfg, no)
            return EpisodeResult(no=no, ok=True, video=None, seconds=script.total_seconds,
                                 tts="dry-run", elapsed=time.time() - started,
                                 extras={"dry_run": True})

        # 2) 이미지 / 음성
        visuals = prepare_visuals(ep, script, cfg, workdir)
        audios, engine = prepare_audio(script, cfg, workdir)
        on_log(f"[{no:3d}] 이미지 {len(visuals)}컷 · 음성({engine}) 준비 완료")

        # 3) 비트 클립
        rng = random.Random(cfg.seed + no)
        mode = cfg.transition if cfg.transition in vid.TRANSITIONS else "xfade"
        last = len(script.beats) - 1
        clips: List[Path] = []
        durations: List[float] = []
        for i, beat in enumerate(script.beats):
            clip = workdir / f"clip_{i}.mp4"
            # xfade 는 겹치는 만큼 클립을 길게 만들어야 총 60초가 유지된다
            seconds = beat.seconds + (vid.FADE if (mode == "xfade" and i < last) else 0.0)
            fade_in = (mode == "fade") or (mode != "fade" and i == 0)
            fade_out = (mode == "fade") or (mode != "fade" and i == last)
            vid.build_beat_clip(clip, visuals[i]["bg"], visuals[i]["overlay"],
                                audios[i], seconds, cfg, i, rng,
                                fade_in=fade_in, fade_out=fade_out)
            clips.append(clip)
            durations.append(seconds)

        # 4) 합치기 + 배경음악
        merged = workdir / "merged.mp4"
        if mode == "xfade":
            vid.crossfade_clips(merged, clips, durations, cfg)
        else:
            vid.concat_clips(merged, clips, workdir)
        bgm = vid.pick_bgm(cfg, no)
        if bgm:
            vid.mix_bgm(final, merged, bgm, script.total_seconds, cfg)
        else:
            shutil.copy2(merged, final)

        # 5) 부가물
        _write_subtitles(script, cfg, no)
        thumb = cfg.video_dir / f"ep{no:03d}_thumb.jpg"
        try:
            vid.make_thumbnail(thumb, final, at=min(3.0, script.total_seconds / 4))
        except ff.FFmpegError:
            thumb = None

        seconds = ff.duration(final) or script.total_seconds
        if not cfg.keep_workdir:
            shutil.rmtree(workdir, ignore_errors=True)

        return EpisodeResult(
            no=no, ok=True, video=final, seconds=seconds, tts=engine,
            elapsed=time.time() - started,
            extras={"title": script.title, "act": ep.act.name,
                    "thumb": str(thumb) if thumb else None,
                    "script": str(cfg.script_dir / f'ep{no:03d}.json'),
                    "bgm": str(bgm) if bgm else None},
        )
    except Exception as exc:
        return EpisodeResult(no=no, ok=False, elapsed=time.time() - started,
                             error=f"{type(exc).__name__}: {exc}",
                             extras={"traceback": traceback.format_exc(limit=3)})


def write_manifest(results: List[EpisodeResult], cfg: Config) -> Path:
    path = cfg.out_dir / "manifest.json"
    payload = {
        "config": cfg.to_dict(),
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "ok": sum(1 for r in results if r.ok),
        "failed": sum(1 for r in results if not r.ok),
        "episodes": [r.to_dict() for r in sorted(results, key=lambda r: r.no)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
