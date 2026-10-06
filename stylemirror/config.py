# -*- coding: utf-8 -*-
"""거울 설정. mirror.config.json 이 있으면 그 값을 덮어쓴다."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Optional

DEFAULT_CONFIG_FILE = Path("mirror.config.json")


@dataclass
class MirrorConfig:
    # 데이터 저장 위치 (옷장 DB, 옷 사진)
    data_dir: Path = Path("mirror_data")
    # 거울이 놓인 위치 (날씨 조회용). 기본값: 서울
    city: str = "서울"
    latitude: float = 37.5665
    longitude: float = 126.9780
    # 로컬 웹서버
    host: str = "127.0.0.1"
    port: int = 8080
    # Claude 설정 (ANTHROPIC_API_KEY 가 없으면 규칙 기반 코치로 자동 동작)
    llm_model: str = "claude-opus-5-5"
    llm_effort: str = "low"          # 거울은 응답 속도가 중요 → low 권장
    use_ai: bool = True
    # 같은 옷을 연달아 추천하지 않도록 최근 n일 착용 옷은 감점
    recent_days: int = 3

    @property
    def db_path(self) -> Path:
        return self.data_dir / "closet.db"

    @property
    def photo_dir(self) -> Path:
        return self.data_dir / "photos"

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "MirrorConfig":
        cfg = cls()
        path = Path(path) if path else DEFAULT_CONFIG_FILE
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            names = {f.name for f in fields(cls)}
            for k, v in raw.items():
                if k in names:
                    setattr(cfg, k, Path(v) if k == "data_dir" else v)
        return cfg

    def to_dict(self) -> dict:
        d = asdict(self)
        d["data_dir"] = str(self.data_dir)
        return d
