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


# 컨테이너에서는 설정 파일 대신 환경변수를 쓰는 편이 편하다.
# ONEWAY_SITE_URL, ONEWAY_DATA … 식으로 이름이 붙는다.
ENV_MAP: Dict[str, str] = {
    "ONEWAY_SITE_URL": "site_url",
    "ONEWAY_SITE_NAME": "site_name",
    "ONEWAY_HOST": "host",
    "ONEWAY_PORT": "port",
    "ONEWAY_DATA": "data_dir",
    "ONEWAY_OUT": "out_dir",
    "ONEWAY_COUNSELOR": "counselor",
    "ONEWAY_MODEL": "model",
    "ONEWAY_EFFORT": "effort",
    "ONEWAY_RATE_LIMIT": "rate_limit",
    "ONEWAY_TRUST_PROXY": "trust_proxy",
    "ONEWAY_NAVER_VERIFY": "naver_verify",
    "ONEWAY_GOOGLE_VERIFY": "google_verify",
    "ONEWAY_CONTACT_EMAIL": "contact_email",
    "ONEWAY_BOOK_ISBN": "book_isbn",
}


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

    # --- 전자책 ---
    # 판매처 [(이름, 주소), ...]. 준비되는 대로 채워 넣으세요.
    book_stores: List[tuple] = field(default_factory=list)
    book_isbn: str = ""

    # --- 운영/보호 ---
    rate_limit: bool = True        # 요청 제한 (Claude API 비용 폭주 방지)
    trust_proxy: bool = False      # nginx 등 신뢰하는 프록시 뒤에 있을 때만 켠다

    # --- 안전 ---
    crisis_region: str = "KR"      # 위기 상황 안내에 사용할 지역 코드

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"

    @property
    def ledger_file(self) -> Path:
        """판매·기부 장부. 공개 페이지가 이 파일을 그대로 읽는다."""
        return self.data_dir / "ledger.json"

    def api_key(self) -> Optional[str]:
        key = os.environ.get(self.api_key_env, "").strip()
        return key or None

    def apply_env(self, env: Optional[Dict[str, str]] = None) -> "Config":
        """환경변수를 덮어쓴다. 설정 파일보다 환경변수가 우선이다."""
        env = os.environ if env is None else env
        for name, field_name in ENV_MAP.items():
            raw = env.get(name)
            if raw is None or raw == "":
                continue
            current = getattr(self, field_name)
            if isinstance(current, bool):
                value = raw.strip().lower() in ("1", "true", "yes", "on")
            elif isinstance(current, int):
                try:
                    value = int(raw)
                except ValueError:
                    continue
            elif isinstance(current, Path):
                value = Path(raw)
            else:
                value = raw
            setattr(self, field_name, value)
        return self

    @classmethod
    def load(cls, path=None, env: Optional[Dict[str, str]] = None) -> "Config":
        """설정을 읽는다.

        순서는 기본값 → 설정 파일 → 환경변수다.
        경로를 주지 않으면 ONEWAY_CONFIG 를 보고, 그것도 없으면 기본값으로 간다.
        **파일이 없다고 죽지 않는다.** 컨테이너 첫 실행이 설정 파일 하나 때문에
        실패하면 안 되기 때문이다.
        """
        env = os.environ if env is None else env
        path = path or env.get("ONEWAY_CONFIG") or None
        cfg = cls()
        if path and Path(path).exists():
            cfg = cls.from_file(path)
        return cfg.apply_env(env)

    @classmethod
    def from_file(cls, path) -> "Config":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        cfg = cls()
        for k, v in data.items():
            if not hasattr(cfg, k):
                continue
            if k in ("data_dir", "out_dir"):
                v = Path(v)
            if k == "book_stores":
                v = [tuple(x) for x in v]
            setattr(cfg, k, v)
        return cfg

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["data_dir"] = str(self.data_dir)
        d["out_dir"] = str(self.out_dir)
        return d
