# -*- coding: utf-8 -*-
"""사이트 전역 설정.

환경변수 또는 config 파일로 덮어쓸 수 있다. 아무것도 설정하지 않아도
오프라인 상담 엔진으로 전부 동작한다.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

# 상담사 응답 모델 (Claude). 키가 없으면 오프라인 엔진으로 자동 폴백한다.
DEFAULT_MODEL = "claude-opus-5"

# 상담 응답은 짧고 담백해야 한다. 길면 읽히지 않는다.
DEFAULT_MAX_TOKENS = 2000

# 응답 속도가 체감 품질을 좌우하므로 기본 effort 는 medium.
DEFAULT_EFFORT = "medium"


@dataclass
class Config:
    # --- 사이트 ---
    site_url: str = "https://oneway.example.com"   # 실제 도메인으로 바꾸세요
    site_name: str = "하나의 길 — ONE WAY"
    host: str = "127.0.0.1"
    port: int = 8000
    data_dir: Path = Path("data")                  # 세션·기도지향 저장 위치
    out_dir: Path = Path("out/site")               # 정적 빌드 결과

    # --- 상담사 ---
    counselor: str = "auto"        # auto | offline | claude
    model: str = DEFAULT_MODEL
    max_tokens: int = DEFAULT_MAX_TOKENS
    effort: str = DEFAULT_EFFORT
    api_key_env: str = "ANTHROPIC_API_KEY"

    # --- 운영 ---
    analytics_snippet: str = ""    # GA/네이버 애널리틱스 태그를 넣을 자리
    naver_verify: str = ""         # 네이버 서치어드바이저 소유확인 코드
    google_verify: str = ""        # 구글 서치콘솔 소유확인 코드
    contact_email: str = ""

    # --- 안전 ---
    crisis_region: str = "KR"      # 위기 상황 안내에 사용할 지역 코드

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"

    def api_key(self) -> Optional[str]:
        key = os.environ.get(self.api_key_env, "").strip()
        return key or None

    @classmethod
    def from_file(cls, path) -> "Config":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        cfg = cls()
        for k, v in data.items():
            if not hasattr(cfg, k):
                continue
            if k in ("data_dir", "out_dir"):
                v = Path(v)
            setattr(cfg, k, v)
        return cfg

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["data_dir"] = str(self.data_dir)
        d["out_dir"] = str(self.out_dir)
        return d
