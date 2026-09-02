# -*- coding: utf-8 -*-
"""제품 숏폼 한 편을 mp4 로 조립한다.

ffmpeg 래퍼와 비트 합성 로직은 india2030 패키지의 검증된 구현을 그대로 재사용하고
(같은 저장소·같은 렌더링 엔진), 여기서는 커머스용 소스(제품 카드/가격 배지/광고 표기)
준비와 순서 제어만 담당한다.
"""

from __future__ import annotations

import random
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from india2030 import ffmpeg as ff
from india2030 import video as vid
from india2030.providers import tts as ttsprov

from .. import compliance
from ..config import Config
from ..models import Product, Script
from . import images as imgprov


def prepare_visuals(product: Product, script: Script, cfg: Config,
                    workdir: Path) -> List[Dict[str, Path]]:
    """비트별 배경 + 텍스트 오버레이를 만든다."""
    size = cfg.size
    font_path = cfg.resolved_font()
    _, accent = imgprov.palette_for(product)

    photo = imgprov.download_image(product.image_url, workdir / "photo.img")
    disclosure_short = compliance.short_disclosure(cfg.lang)
    badge = _badge_text(product, cfg)
    cta_text = "LINK IN BIO" if cfg.lang != "ko" else "링크는 프로필에"

    out: List[Dict[str, Path]] = []
    for i, beat in enumerate(script.beats):
        bg = workdir / f"bg_{i}_{beat.name.lower()}.jpg"
        imgprov.build_background(bg, product, photo, size, beat.name,
                                 seed=cfg.seed + i, font_path=font_path)
        ov = workdir / f"tx_{i}_{beat.name.lower()}.png"
        imgprov.render_overlay(
            ov, size,
            caption=beat.caption if cfg.subtitle else "",
            badge=badge,
            price=product.price_text(cfg.currency_symbol),
            discount=(f"-{product.discount:.0f}%" if product.discount else ""),
            rating=(f"★ {product.rating:.1f}" if product.rating else ""),
            accent=accent,
            font_path=font_path,
            watermark=cfg.watermark,
            disclosure=disclosure_short,
            beat=beat.name,
            cta=(cta_text if beat.name == "CTA" else ""),
        )
        out.append({"bg": bg, "overlay": ov})
    return out


def _badge_text(product: Product, cfg: Config) -> str:
    if cfg.lang == "ko":
        if product.sold_delta:
            return f"실시간 인기 · 최근 {product.sold_delta:,}개 판매"
        return f"실시간 인기 · {product.source.upper()}"
    if product.sold_delta:
        return f"TRENDING · {product.sold_delta:,} sold now"
    return f"TRENDING · {product.source.upper()}"


def prepare_audio(script: Script, cfg: Config, workdir: Path) -> Tuple[List[Optional[Path]], str]:
    """비트별 내레이션. TTS 엔진이 없으면 무음으로 대체된다."""
    if cfg.tts_provider == "none":
        return [None] * len(script.beats), "none"
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


def render(product: Product, script: Script, cfg: Config, out_path: Path,
           workdir: Path, on_log=lambda *_: None) -> Tuple[Path, str, float]:
    """(영상 경로, 사용된 TTS, 길이) 를 돌려준다."""
    workdir.mkdir(parents=True, exist_ok=True)
    visuals = prepare_visuals(product, script, cfg, workdir)
    audios, engine = prepare_audio(script, cfg, workdir)
    on_log(f"  소스 준비 완료 (컷 {len(visuals)} · 음성 {engine})")

    mode = cfg.transition if cfg.transition in vid.TRANSITIONS else "xfade"
    rng = random.Random(cfg.seed)
    last = len(script.beats) - 1
    clips: List[Path] = []
    durations: List[float] = []
    for i, beat in enumerate(script.beats):
        clip = workdir / f"clip_{i}.mp4"
        seconds = beat.seconds + (vid.FADE if (mode == "xfade" and i < last) else 0.0)
        vid.build_beat_clip(clip, visuals[i]["bg"], visuals[i]["overlay"], audios[i],
                            seconds, cfg, i, rng,
                            fade_in=(mode == "fade") or i == 0,
                            fade_out=(mode == "fade") or i == last)
        clips.append(clip)
        durations.append(seconds)

    merged = workdir / "merged.mp4"
    if mode == "xfade":
        vid.crossfade_clips(merged, clips, durations, cfg)
    else:
        vid.concat_clips(merged, clips, workdir)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bgm = vid.pick_bgm(cfg, 1)
    if bgm:
        vid.mix_bgm(out_path, merged, bgm, script.seconds, cfg)
    else:
        shutil.copy2(merged, out_path)

    seconds = ff.duration(out_path) or script.seconds
    return out_path, engine, seconds


def thumbnail(video: Path, out: Path, at: float = 2.0) -> Optional[Path]:
    try:
        return vid.make_thumbnail(out, video, at=at)
    except Exception:
        return None
