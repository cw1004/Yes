# -*- coding: utf-8 -*-
"""ffmpeg / ffprobe 래퍼."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional


class FFmpegError(RuntimeError):
    pass


def ffmpeg_bin() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:                                  # pip install imageio-ffmpeg 대안
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise FFmpegError(
            "ffmpeg 을 찾을 수 없습니다. 설치 후 다시 실행하세요.\n"
            "  Ubuntu: sudo apt-get install ffmpeg\n"
            "  macOS : brew install ffmpeg\n"
            "  또는  : pip install imageio-ffmpeg"
        )


def ffprobe_bin() -> Optional[str]:
    return shutil.which("ffprobe")


def run(args: List[str], quiet: bool = True) -> subprocess.CompletedProcess:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y"] + args
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-15:])
        raise FFmpegError(f"ffmpeg 실행 실패:\n$ {' '.join(cmd[:6])} ...\n{tail}")
    return proc


def duration(path: Path) -> float:
    """미디어 길이(초). ffprobe 가 없으면 0.0."""
    probe = ffprobe_bin()
    if not probe:
        return 0.0
    proc = subprocess.run(
        [probe, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return 0.0
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def make_silence(path: Path, seconds: float, sample_rate: int = 44100) -> Path:
    run(["-f", "lavfi", "-i", f"anullsrc=r={sample_rate}:cl=stereo",
         "-t", f"{seconds:.3f}", "-c:a", "aac", "-b:a", "128k", str(path)])
    return path


def has_encoder(name: str) -> bool:
    try:
        out = subprocess.run([ffmpeg_bin(), "-hide_banner", "-encoders"],
                             capture_output=True, text=True).stdout
        return name in out
    except Exception:
        return False
