# -*- coding: utf-8 -*-
"""파이프라인 전역 설정."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

# 60초를 5단계로 배분 (초). 합계 = 60
BEAT_ORDER: List[str] = ["HOOK", "EMOTION", "ACTION", "DREAM", "MESSAGE"]
BEAT_SECONDS: Dict[str, float] = {
    "HOOK": 8.0,
    "EMOTION": 14.0,
    "ACTION": 16.0,
    "DREAM": 12.0,
    "MESSAGE": 10.0,
}

BEAT_LABEL_KO: Dict[str, str] = {
    "HOOK": "훅",
    "EMOTION": "감정",
    "ACTION": "행동",
    "DREAM": "꿈",
    "MESSAGE": "메시지",
}

ASPECTS: Dict[str, tuple] = {
    "9:16": (1080, 1920),   # 쇼츠/릴스/틱톡 (기본)
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

# 한글 폰트 후보 (앞에서부터 존재하는 것을 사용)
FONT_CANDIDATES: List[str] = [
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/malgun.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/unifont/unifont.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def find_font(explicit: Optional[str] = None) -> Optional[str]:
    """사용 가능한 한글 폰트 경로를 반환."""
    candidates = ([explicit] if explicit else []) + FONT_CANDIDATES
    for path in candidates:
        if path and Path(path).exists():
            return path
    # fontconfig 로 한 번 더 탐색
    try:
        import subprocess
        out = subprocess.run(
            ["fc-match", "-f", "%{file}", ":lang=ko"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if out and Path(out).exists():
            return out
    except Exception:
        pass
    return None


@dataclass
class Config:
    # 출력
    out_dir: Path = Path("output")
    assets_dir: Path = Path("assets")
    aspect: str = "9:16"
    fps: int = 30
    duration: float = 60.0
    preset: str = "medium"          # libx264 프리셋 (veryfast 로 두면 훨씬 빠름)
    crf: int = 20                   # 화질 (낮을수록 고화질/대용량)
    transition: str = "xfade"       # 비트 전환: xfade | fade | cut

    # 텍스트/자막
    font: Optional[str] = None
    title_font: Optional[str] = None
    subtitle: bool = True          # 자막 번인
    watermark: str = "INDIA 2030"

    # 스크립트 생성기: template | llm
    script_provider: str = "template"
    llm_model: str = "claude-opus-5"

    # 음성: auto | gtts | edge | elevenlabs | espeak | silent
    tts_provider: str = "auto"
    tts_voice: str = "ko-KR-InJoonNeural"
    tts_lang: str = "ko"
    narration_gain_db: float = 0.0

    # 이미지: auto | pillow | stock | none
    image_provider: str = "pillow"
    stock_dir: Optional[Path] = None   # assets/stock/ep001/*.jpg 를 우선 사용

    # 배경음악
    bgm: Optional[Path] = None         # 파일 또는 디렉터리
    bgm_gain_db: float = -20.0

    # 실행
    workers: int = 2
    overwrite: bool = False
    keep_workdir: bool = False
    seed: int = 20300101
    dry_run: bool = False

    extra: Dict = field(default_factory=dict)

    # ---------- 파생값 ----------
    @property
    def size(self) -> tuple:
        if self.aspect not in ASPECTS:
            raise ValueError(f"지원하지 않는 화면비: {self.aspect} (가능: {', '.join(ASPECTS)})")
        return ASPECTS[self.aspect]

    @property
    def width(self) -> int:
        return self.size[0]

    @property
    def height(self) -> int:
        return self.size[1]

    @property
    def video_dir(self) -> Path:
        return self.out_dir / "video"

    @property
    def script_dir(self) -> Path:
        return self.out_dir / "script"

    @property
    def work_dir(self) -> Path:
        return self.out_dir / "work"

    def resolved_font(self) -> Optional[str]:
        return find_font(self.font)

    def resolved_title_font(self) -> Optional[str]:
        return find_font(self.title_font or self.font)

    def ensure_dirs(self) -> None:
        for d in (self.out_dir, self.video_dir, self.script_dir, self.work_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ---------- 직렬화 ----------
    def to_dict(self) -> Dict:
        d = asdict(self)
        for k, v in list(d.items()):
            if isinstance(v, Path):
                d[k] = str(v)
        return d

    @classmethod
    def from_file(cls, path: os.PathLike) -> "Config":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Dict) -> "Config":
        known = {f for f in cls.__dataclass_fields__}
        kwargs, extra = {}, {}
        for k, v in data.items():
            if k in known:
                kwargs[k] = v
            else:
                extra[k] = v
        for key in ("out_dir", "assets_dir", "stock_dir", "bgm"):
            if kwargs.get(key) is not None:
                kwargs[key] = Path(kwargs[key])
        cfg = cls(**kwargs)
        cfg.extra.update(extra)
        return cfg
