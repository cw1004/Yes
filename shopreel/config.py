# -*- coding: utf-8 -*-
"""SHOPREEL 전역 설정.

우선순위: CLI 인자 > 설정 파일(shopreel.config.json) > 환경변수 > 기본값
API 키 같은 비밀값은 설정 파일이 아니라 **환경변수**로만 읽는다.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

# 숏폼 5단계 구조 — 커머스용 (가중치 합 = 1.0)
BEAT_ORDER: List[str] = ["HOOK", "PROBLEM", "PROOF", "PRICE", "CTA"]
BEAT_WEIGHT: Dict[str, float] = {
    "HOOK": 0.14,      # 1~2초 안에 시선 고정
    "PROBLEM": 0.20,   # 이 제품이 해결하는 불편
    "PROOF": 0.26,     # 후기·판매량·평점 등 근거
    "PRICE": 0.22,     # 할인율/가격 임팩트
    "CTA": 0.18,       # 링크 유도 + 광고 표기
}
BEAT_LABEL_KO: Dict[str, str] = {
    "HOOK": "훅", "PROBLEM": "문제", "PROOF": "근거", "PRICE": "가격", "CTA": "행동유도",
}

ASPECTS: Dict[str, tuple] = {
    "9:16": (1080, 1920),   # 쇼츠/릴스/틱톡 (기본)
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

# 제휴 링크 템플릿 기본값. {url} {url_enc} {pid} {tag} 치환.
DEFAULT_AFFILIATE: Dict[str, Dict[str, str]] = {
    "amazon": {"tag_env": "AMAZON_ASSOC_TAG", "template": "{url}?tag={tag}"},
    "aliexpress": {"tag_env": "ALIEXPRESS_AFF_KEY",
                   "template": "https://s.click.aliexpress.com/deep_link.htm"
                               "?aff_short_key={tag}&dl_target_url={url_enc}"},
    # 쿠팡은 딥링크 API 가 이미 추적 링크를 주므로 URL 을 다시 만들지 않고 subId 만 붙인다
    "coupang": {"tag_env": "COUPANG_PARTNERS_ID", "template": "{url}", "tag_param": "lptag"},
    "ebay": {"tag_env": "EBAY_EPN_CAMPAIGN",
             "template": "https://www.ebay.com/sch/i.html?_nkw={pid}&mkcid=1&campid={tag}"},
    "rakuten": {"tag_env": "RAKUTEN_AFF_ID", "template": "{url}?scid={tag}"},
    "shopee": {"tag_env": "SHOPEE_AFF_ID", "template": "{url}?af_siteid={tag}"},
    "tiktokshop": {"tag_env": "TIKTOK_SHOP_AFF_ID", "template": "{url}?aff={tag}"},
    "generic": {"tag_env": "GENERIC_AFF_TAG", "template": "{url}"},
}

PLATFORMS: List[str] = ["youtube", "tiktok", "instagram", "facebook", "dryrun"]


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "y", "on")


@dataclass
class Config:
    # ---------- 출력 ----------
    out_dir: Path = Path("output/shopreel")
    assets_dir: Path = Path("assets")
    db_path: Optional[Path] = None          # 미지정 시 out_dir/shopreel.db

    # ---------- 영상 ----------
    aspect: str = "9:16"
    fps: int = 30
    duration: float = 30.0                  # 목표 길이(초). 10/15/30/45 권장
    preset: str = "medium"
    crf: int = 20
    font: Optional[str] = None
    subtitle: bool = True
    watermark: str = "SHOPREEL"
    bgm: Optional[Path] = None
    bgm_gain_db: float = -20.0
    narration_gain_db: float = 0.0
    transition: str = "xfade"       # 비트 전환: xfade | fade | cut

    # ---------- 언어/문구 ----------
    lang: str = "ko"                        # ko | en
    currency_symbol: str = ""               # 비우면 상품 통화 그대로
    disclosure: Optional[str] = None        # 비우면 언어별 기본 광고 표기

    # ---------- 대본 ----------
    script_provider: str = "template"       # template | llm
    llm_model: str = "claude-opus-5"

    # ---------- 음성 ----------
    tts_provider: str = "auto"              # auto | edge | gtts | elevenlabs | silent | none
    tts_voice: Optional[str] = None

    # ---------- 수집 ----------
    sources: List[str] = field(default_factory=lambda: ["demo"])
    source_limit: int = 40                  # 소스당 최대 수집 개수
    top_n: int = 3                          # 1회 실행당 영상 편수
    min_price: float = 0.0
    max_price: float = 1_000_000.0
    min_rating: float = 4.0
    min_reviews: int = 30
    min_commission: float = 0.0             # % 단위
    min_discount: float = 0.0               # % 단위
    deny_keywords: List[str] = field(default_factory=list)
    allow_categories: List[str] = field(default_factory=list)
    repost_after_days: int = 30             # 같은 상품 재제작 금지 기간

    # ---------- 제휴/추적 ----------
    tracker_base: str = "http://localhost:8787"
    affiliate: Dict[str, Dict[str, str]] = field(default_factory=dict)
    utm_source: str = "shopreel"

    # ---------- 업로드 ----------
    publish_to: List[str] = field(default_factory=lambda: ["dryrun"])
    # 유튜브는 업로드 1건이 약 1,600 유닛을 쓴다(기본 할당량 10,000 → 하루 6건).
    daily_limit: Dict[str, int] = field(default_factory=lambda: {
        "youtube": 5, "tiktok": 10, "instagram": 8, "facebook": 10, "dryrun": 999,
    })
    public_video_base: Optional[str] = None  # 인스타그램 등 URL 업로드용 공개 베이스 URL
    schedule_minutes: int = 180              # auto 모드 실행 간격(분)

    # ---------- 실행 ----------
    workers: int = 4
    overwrite: bool = False
    keep_workdir: bool = False
    seed: int = 20260101
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

    @property
    def report_dir(self) -> Path:
        return self.out_dir / "report"

    @property
    def db(self) -> Path:
        return self.db_path or (self.out_dir / "shopreel.db")

    def beat_seconds(self) -> Dict[str, float]:
        """목표 길이를 5단계로 배분한다 (합계 = duration)."""
        secs = {n: round(self.duration * BEAT_WEIGHT[n], 2) for n in BEAT_ORDER}
        drift = round(self.duration - sum(secs.values()), 2)
        secs[BEAT_ORDER[-1]] = round(secs[BEAT_ORDER[-1]] + drift, 2)
        return secs

    def affiliate_for(self, source: str) -> Dict[str, str]:
        """소스별 제휴 설정 (사용자 설정이 기본값을 덮어쓴다)."""
        conf = dict(DEFAULT_AFFILIATE.get(source, DEFAULT_AFFILIATE["generic"]))
        conf.update(self.affiliate.get(source, {}))
        if not conf.get("tag"):
            conf["tag"] = os.environ.get(conf.get("tag_env", ""), "") or ""
        return conf

    def resolved_font(self) -> Optional[str]:
        from india2030.config import find_font
        return find_font(self.font, "ko" if self.lang == "ko" else "en")

    def resolved_voice(self) -> str:
        if self.tts_voice:
            return self.tts_voice
        return "ko-KR-SunHiNeural" if self.lang == "ko" else "en-US-AriaNeural"

    def resolved_tts_lang(self) -> str:
        return "ko" if self.lang == "ko" else "en"

    def ensure_dirs(self) -> None:
        for d in (self.out_dir, self.video_dir, self.script_dir,
                  self.work_dir, self.report_dir):
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
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    @classmethod
    def from_dict(cls, data: Dict) -> "Config":
        known = set(cls.__dataclass_fields__)
        kwargs, extra = {}, {}
        for k, v in data.items():
            (kwargs if k in known else extra)[k] = v
        for key in ("out_dir", "assets_dir", "db_path", "bgm"):
            if kwargs.get(key) is not None:
                kwargs[key] = Path(kwargs[key])
        cfg = cls(**kwargs)
        cfg.extra.update(extra)
        return cfg

    @classmethod
    def load(cls, path: Optional[os.PathLike] = None) -> "Config":
        """설정 파일이 있으면 읽고, 없으면 기본값."""
        for cand in ([path] if path else []) + ["shopreel.config.json"]:
            if cand and Path(cand).exists():
                return cls.from_file(cand)
        return cls()
