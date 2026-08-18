# -*- coding: utf-8 -*-
"""내레이션 음성 합성.

우선순위(auto): edge-tts → gTTS → ElevenLabs → 무음(silent)
어떤 엔진도 없으면 무음 트랙을 만들어 파이프라인이 끊기지 않게 한다.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import urllib.request
import json
from pathlib import Path
from typing import List

from ..ffmpeg import make_silence

ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def available_providers() -> List[str]:
    out = []
    if shutil.which("edge-tts"):
        out.append("edge")
    if _module_available("gtts"):
        out.append("gtts")
    if os.environ.get("ELEVENLABS_API_KEY"):
        out.append("elevenlabs")
    out.append("silent")
    return out


# ------------------------------------------------------------------ 엔진별 구현
def _tts_edge(text: str, out: Path, voice: str) -> bool:
    exe = shutil.which("edge-tts")
    if not exe:
        return False
    proc = subprocess.run(
        [exe, "--voice", voice, "--text", text, "--write-media", str(out)],
        capture_output=True, text=True,
    )
    return proc.returncode == 0 and out.exists() and out.stat().st_size > 0


def _tts_gtts(text: str, out: Path, lang: str) -> bool:
    try:
        from gtts import gTTS
    except Exception:
        return False
    try:
        gTTS(text=text, lang=lang).save(str(out))
        return out.exists() and out.stat().st_size > 0
    except Exception:
        return False


def _tts_elevenlabs(text: str, out: Path, voice_id: str) -> bool:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return False
    body = json.dumps({
        "text": text,
        "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.75},
    }).encode("utf-8")
    req = urllib.request.Request(
        ELEVEN_URL.format(voice_id=voice_id),
        data=body,
        headers={"xi-api-key": key, "content-type": "application/json",
                 "accept": "audio/mpeg"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
        return out.stat().st_size > 0
    except Exception:
        return False


# ------------------------------------------------------------------ 진입점
def synthesize(text: str, out: Path, provider: str = "auto",
               voice: str = "ko-KR-InJoonNeural", lang: str = "ko",
               fallback_seconds: float = 6.0) -> str:
    """`text` 를 음성 파일로 만들고 실제 사용된 provider 이름을 반환."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    order = [provider]
    if provider == "auto":
        order = ["edge", "gtts", "elevenlabs", "silent"]

    for name in order:
        if name == "edge" and _tts_edge(text, out, voice):
            return "edge"
        if name == "gtts" and _tts_gtts(text, out, lang):
            return "gtts"
        if name == "elevenlabs":
            vid = os.environ.get("ELEVENLABS_VOICE_ID", voice)
            if _tts_elevenlabs(text, out, vid):
                return "elevenlabs"
        if name == "silent":
            make_silence(out.with_suffix(".m4a"), fallback_seconds)
            if out.suffix != ".m4a":
                shutil.move(str(out.with_suffix(".m4a")), str(out))
            return "silent"

    # 지정한 엔진이 실패한 경우에도 파이프라인은 계속되도록 무음 처리
    make_silence(out.with_suffix(".m4a"), fallback_seconds)
    if out.suffix != ".m4a":
        shutil.move(str(out.with_suffix(".m4a")), str(out))
    return "silent"
