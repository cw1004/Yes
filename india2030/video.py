# -*- coding: utf-8 -*-
"""ffmpeg 으로 5단계 비트를 60초 영상 한 편으로 조립한다.

비트별로 (배경 이미지 + 텍스트 오버레이 + 내레이션) 클립을 만들고,
페이드로 이어 붙인 뒤 배경음악을 믹스한다. 각 비트 길이가 고정이므로
최종 길이는 항상 정확히 60초다.
"""

from __future__ import annotations

import random
import shutil
from pathlib import Path
from typing import List, Optional, Sequence

from . import ffmpeg as ff
from .config import Config

FADE = 0.5          # 비트 사이 전환 길이(초)
TRANSITIONS = ("xfade", "fade", "cut")
LEAD_IN = 0.25      # 내레이션 시작 전 여백(초)
MAX_TEMPO = 1.30    # 내레이션이 길 때 허용하는 최대 배속


def _kenburns(idx: int, w: int, h: int, fps: int, seconds: float, rng: random.Random) -> str:
    """켄번즈(줌/팬) 필터 문자열."""
    frames = max(2, int(round(seconds * fps)))
    zmax = 1.14 + rng.uniform(0.0, 0.06)
    rate = (zmax - 1.0) / frames
    zoom_in = idx % 2 == 0
    if zoom_in:
        z = f"min(zoom+{rate:.6f},{zmax:.3f})"
    else:
        z = f"if(lte(zoom,1.0),{zmax:.3f},max(1.0,zoom-{rate:.6f}))"
    drift = rng.choice(["center", "left", "right"])
    if drift == "left":
        x = "max(0,(iw-iw/zoom)*(1-on/{n}))".format(n=frames)
    elif drift == "right":
        x = "min(iw-iw/zoom,(iw-iw/zoom)*(on/{n}))".format(n=frames)
    else:
        x = "iw/2-(iw/zoom/2)"
    y = "ih/2-(ih/zoom/2)"
    pre = (f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
           f"crop={w * 2}:{h * 2}")
    return (f"{pre},zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={w}x{h}:fps={fps},"
            f"format=yuv420p,setsar=1")


def _audio_filter(src_seconds: float, beat_seconds: float) -> str:
    """내레이션을 비트 길이에 맞춘다 (길면 살짝 배속, 짧으면 무음 패딩)."""
    usable = max(0.5, beat_seconds - LEAD_IN - 0.15)
    chain: List[str] = ["aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"]
    if src_seconds > usable > 0:
        tempo = min(MAX_TEMPO, src_seconds / usable)
        if tempo > 1.01:
            chain.append(f"atempo={tempo:.4f}")
    chain.append(f"adelay={int(LEAD_IN * 1000)}|{int(LEAD_IN * 1000)}")
    chain.append("apad")
    chain.append(f"atrim=0:{beat_seconds:.3f}")
    chain.append("asetpts=N/SR/TB")
    chain.append(f"afade=t=out:st={max(0.0, beat_seconds - 0.25):.3f}:d=0.25")
    return ",".join(chain)


def build_beat_clip(out: Path, bg: Path, overlay: Optional[Path], audio: Optional[Path],
                    seconds: float, cfg: Config, idx: int, rng: random.Random,
                    fade_in: bool = True, fade_out: bool = True) -> Path:
    """비트 하나를 클립으로 렌더링한다 (배경 켄번즈 + 텍스트 오버레이 + 내레이션)."""
    w, h, fps = cfg.width, cfg.height, cfg.fps
    args: List[str] = ["-loop", "1", "-t", f"{seconds:.3f}", "-i", str(bg)]
    inputs = 1
    ov_idx = None
    if overlay and overlay.exists():
        args += ["-loop", "1", "-t", f"{seconds:.3f}", "-i", str(overlay)]
        ov_idx = inputs
        inputs += 1
    au_idx = None
    if audio and audio.exists():
        args += ["-i", str(audio)]
        au_idx = inputs
        inputs += 1

    vf = f"[0:v]{_kenburns(idx, w, h, fps, seconds, rng)}[bgv];"
    if ov_idx is not None:
        # 전환 구간에 자막이 겹쳐 보이지 않도록 텍스트만 먼저 사라지게 한다
        tx_out = max(0.4, seconds - (FADE if not fade_out else 0.0) - 0.55)
        vf += (f"[{ov_idx}:v]scale={w}:{h},format=rgba,"
               f"fade=t=in:st=0.15:d=0.35:alpha=1,"
               f"fade=t=out:st={tx_out:.3f}:d=0.4:alpha=1[ov];"
               f"[bgv][ov]overlay=0:0:format=auto[vo];")
    else:
        vf += "[bgv]null[vo];"

    fades = []
    if fade_in:
        fades.append(f"fade=t=in:st=0:d={FADE}")
    if fade_out:
        fades.append(f"fade=t=out:st={max(0.0, seconds - FADE):.3f}:d={FADE}")
    vf += f"[vo]{','.join(fades) if fades else 'null'}[v]"

    maps = ["-map", "[v]"]
    if au_idx is not None:
        src_dur = ff.duration(audio) or seconds
        vf += f";[{au_idx}:a]{_audio_filter(src_dur, seconds)}[a]"
        maps += ["-map", "[a]"]
    else:
        args += ["-f", "lavfi", "-t", f"{seconds:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
        maps += ["-map", f"{inputs}:a"]

    args += ["-filter_complex", vf] + maps + [
        "-t", f"{seconds:.3f}",
        "-c:v", "libx264", "-preset", cfg.preset, "-crf", str(cfg.crf),
        "-pix_fmt", "yuv420p", "-r", str(fps),
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        "-movflags", "+faststart", str(out),
    ]
    ff.run(args)
    return out


def crossfade_clips(out: Path, clips: Sequence[Path], durations: Sequence[float],
                    cfg: Config) -> Path:
    """클립들을 xfade/acrossfade 로 부드럽게 이어 붙인다.

    각 클립은 전환 길이(FADE)만큼 더 길게 만들어져 있으므로
    겹치는 만큼 줄어들어 최종 길이가 정확히 맞는다.
    """
    if len(clips) == 1:
        shutil.copy2(clips[0], out)
        return out

    args: List[str] = []
    for c in clips:
        args += ["-i", str(c)]

    parts: List[str] = []
    vlab, alab = "0:v", "0:a"
    offset = 0.0
    for i in range(1, len(clips)):
        offset += durations[i - 1] - FADE
        nv, na = f"v{i}", f"a{i}"
        parts.append(f"[{vlab}][{i}:v]xfade=transition=fade:duration={FADE}:"
                     f"offset={offset:.3f}[{nv}]")
        parts.append(f"[{alab}][{i}:a]acrossfade=d={FADE}:c1=tri:c2=tri[{na}]")
        vlab, alab = nv, na

    args += ["-filter_complex", ";".join(parts),
             "-map", f"[{vlab}]", "-map", f"[{alab}]",
             "-c:v", "libx264", "-preset", cfg.preset, "-crf", str(cfg.crf),
             "-pix_fmt", "yuv420p", "-r", str(cfg.fps),
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
    ff.run(args)
    return out


def concat_clips(out: Path, clips: Sequence[Path], workdir: Path) -> Path:
    listfile = workdir / "concat.txt"
    listfile.write_text("".join(f"file '{c.resolve()}'\n" for c in clips), encoding="utf-8")
    try:
        ff.run(["-f", "concat", "-safe", "0", "-i", str(listfile), "-c", "copy", str(out)])
    except ff.FFmpegError:      # 파라미터가 달라 copy 가 안 되면 재인코딩
        ff.run(["-f", "concat", "-safe", "0", "-i", str(listfile),
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(out)])
    return out


def pick_bgm(cfg: Config, ep_no: int) -> Optional[Path]:
    if not cfg.bgm:
        return None
    p = Path(cfg.bgm)
    if p.is_file():
        return p
    if p.is_dir():
        tracks = sorted(x for x in p.iterdir()
                        if x.suffix.lower() in (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"))
        if tracks:
            return tracks[(ep_no - 1) % len(tracks)]
    return None


def mix_bgm(out: Path, video: Path, bgm: Path, seconds: float, cfg: Config) -> Path:
    """배경음악을 루프로 깔고 내레이션 아래로 낮춰 믹스."""
    filt = (
        f"[1:a]aloop=loop=-1:size=2e+09,atrim=0:{seconds:.3f},"
        f"volume={cfg.bgm_gain_db}dB,"
        f"afade=t=in:st=0:d=1.5,afade=t=out:st={max(0.0, seconds - 2.0):.3f}:d=2.0[bg];"
        f"[0:a]volume={cfg.narration_gain_db}dB[na];"
        f"[na][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    )
    ff.run(["-i", str(video), "-i", str(bgm), "-filter_complex", filt,
            "-map", "0:v", "-map", "[a]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
    return out


def make_thumbnail(out: Path, video: Path, at: float = 2.0) -> Path:
    ff.run(["-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(out)])
    return out
