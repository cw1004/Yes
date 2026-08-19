# -*- coding: utf-8 -*-
"""60초 5단계(HOOK/EMOTION/ACTION/DREAM/MESSAGE) 대본 자동 생성기.

내레이션과 자막의 언어를 따로 고를 수 있다(`ko` 한국어 / `hi` 힌디어).
예) 힌디어 내레이션 + 한국어 자막:  --lang hi --caption-lang ko

기본은 오프라인 템플릿 엔진(외부 API 불필요)이며,
`--script-provider llm` 을 주면 Claude API 로 대본을 생성하고
실패 시 자동으로 템플릿 엔진으로 되돌아간다.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional

from .config import BEAT_ORDER, BEAT_SECONDS, Config
from .episodes import Episode
from .langs import get_pack

SLOGAN = "ONE BOY. ONE BALL. ONE DREAM. ONE NATION."

BASE_TAGS = ["#INDIA2030", "#인도축구", "#월드컵2030", "#shorts", "#football",
             "#축구스토리", "#OneBoyOneBall", "#감동실화"]
HI_TAGS = ["#INDIA2030", "#IndianFootball", "#WorldCup2030", "#shorts", "#football",
           "#फुटबॉल", "#OneBoyOneBall", "#हिंदी"]


@dataclass
class Beat:
    name: str                # HOOK / EMOTION / ACTION / DREAM / MESSAGE
    seconds: float
    narration: str           # TTS 로 읽을 문장 (내레이션 언어)
    caption: str             # 화면 자막 (자막 언어)
    visual: str              # 촬영/이미지 지시문 (한국어 제작 노트)
    image_prompt: str        # 이미지 생성용 프롬프트 (영어)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class VideoScript:
    no: int
    title: str               # 자막 언어 기준 제목
    act_no: int
    act_name: str
    hook_title: str          # 썸네일/영상 제목
    logline: str
    beats: List[Beat]
    hashtags: List[str]
    description: str
    director_note: Optional[str] = None
    provider: str = "template"
    lang: str = "ko"             # 내레이션 언어
    caption_lang: str = "ko"     # 자막 언어
    narration_title: str = ""    # 내레이션 언어 기준 제목

    @property
    def total_seconds(self) -> float:
        return sum(b.seconds for b in self.beats)

    @property
    def narration(self) -> str:
        return " ".join(b.narration for b in self.beats)

    def to_dict(self) -> Dict:
        return {
            "no": self.no,
            "title": self.title,
            "narration_title": self.narration_title or self.title,
            "act_no": self.act_no,
            "act_name": self.act_name,
            "hook_title": self.hook_title,
            "logline": self.logline,
            "lang": self.lang,
            "caption_lang": self.caption_lang,
            "total_seconds": self.total_seconds,
            "provider": self.provider,
            "director_note": self.director_note,
            "hashtags": self.hashtags,
            "description": self.description,
            "beats": [b.to_dict() for b in self.beats],
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "VideoScript":
        beats = [Beat(**b) for b in d["beats"]]
        return cls(
            no=d["no"], title=d["title"], act_no=d["act_no"], act_name=d["act_name"],
            hook_title=d["hook_title"], logline=d["logline"], beats=beats,
            hashtags=d.get("hashtags", []), description=d.get("description", ""),
            director_note=d.get("director_note"), provider=d.get("provider", "template"),
            lang=d.get("lang", "ko"), caption_lang=d.get("caption_lang", d.get("lang", "ko")),
            narration_title=d.get("narration_title", ""),
        )


# ---------------------------------------------------------------- 모티프 사전
# 제목에서 감지되는 키워드 -> (영상 소재, 영어 프롬프트 조각)
MOTIFS: List[tuple] = [
    (("코끼리",), "수호신처럼 나타나는 코끼리", "a majestic spirit elephant with glowing eyes"),
    (("부상", "발목", "핏방울", "쓰러진", "재활"), "다친 발과 붕대", "a bandaged ankle, dust and dried blood, close-up"),
    (("어머니",), "어머니의 얼굴", "a weathered Indian mother's face, warm lamplight"),
    (("아버지",), "아버지의 뒷모습", "a stern Indian father silhouetted in a field"),
    (("트로피", "우승", "리본"), "손에 쥔 트로피", "a small battered trophy held up high"),
    (("유니폼", "대표팀", "국가대표"), "가슴의 국가 엠블럼", "a national team jersey crest, close-up"),
    (("월드컵", "2030", "예선", "본선"), "2030 월드컵을 향한 여정", "a World Cup 2030 qualifier stadium at night"),
    (("골", "그물", "동점골", "데뷔골"), "그물이 흔들리는 순간", "a football hitting the back of the net, net rippling"),
    (("훈련", "새벽", "연습"), "새벽 훈련", "a boy training alone at dawn, long shadows"),
    (("관중", "함성", "광장", "인파", "스크린"), "함성으로 가득 찬 관중", "a roaring crowd waving orange flags"),
    (("기차", "버스", "떠나"), "떠나는 길", "an Indian train leaving a small station at sunrise"),
    (("비", "진흙"), "빗속의 진흙탕", "a muddy field in monsoon rain, one boy still playing"),
    (("잔디", "구장", "그라운드"), "초록 잔디 구장", "a floodlit green football pitch"),
    (("벽", "골목", "골대"), "골목 벽의 낡은 골대", "a chalk goal drawn on a cracked village wall"),
    (("맨발", "신발", "축구화"), "맨발과 낡은 축구화", "bare dusty feet beside worn football boots"),
    (("공",), "바람 빠진 낡은 축구공", "a deflated old football in red dust"),
]

DEFAULT_MOTIF = ("먼지 날리는 흙바닥 경기장", "a dusty Indian village football ground at golden hour")

SLOGAN_TAIL = SLOGAN


# ---------------------------------------------------------------- 유틸
def _clean(text: str) -> str:
    """제목을 나레이션에 넣기 좋게 다듬는다."""
    t = text.replace("\u201c", "\"").replace("\u201d", "\"")
    t = re.sub(r"\s*\u2014\s*", ", ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t.rstrip(".\u0964")


def _split_sentences(text: str, ends: str = ".!?") -> List[str]:
    pattern = f"(?<=[{re.escape(ends)}])\\s+"
    return [s for s in re.split(pattern, text.strip()) if s]


def _first_clause(title: str) -> str:
    t = _clean(title)
    parts = [p.strip() for p in t.split(",") if p.strip()]
    return parts[0] if parts else t


def _last_clause(title: str) -> str:
    t = _clean(title)
    parts = [p.strip() for p in t.split(",") if p.strip()]
    return parts[-1] if parts else t


def _fit(text: str, seconds: float, chars_per_sec: float = 5.0,
         ends: str = ".!?", tolerance: float = 1.35) -> str:
    """나레이션이 배정된 초를 크게 넘지 않도록 문장 단위로 자른다."""
    limit = int(seconds * chars_per_sec * tolerance)
    if len(text) <= limit:
        return text
    out = ""
    for s in _split_sentences(text, ends):
        if not out:
            out = s
        elif len(out) + len(s) + 1 <= limit:
            out = f"{out} {s}"
        else:
            break
    return out or text[:limit].rstrip() + "\u2026"


def _caption(text: str, max_len: int = 26, ends: str = ".!?") -> str:
    """화면 자막용 짧은 문구."""
    parts = _split_sentences(_clean(text), ends)
    t = (parts[0] if parts else _clean(text)).rstrip(".\u0964")
    if len(t) <= max_len:
        return t
    cut = t[:max_len]
    if " " in cut[max_len // 2:]:
        cut = cut[:cut.rfind(" ")]
    return cut + "\u2026"


def detect_motif(title: str) -> tuple:
    """제목에서 핵심 소재를 찾아 (촬영 지시문, 영어 프롬프트 조각)을 반환."""
    for keys, ko, en in MOTIFS:
        if any(k in title for k in keys):
            return ko, en
    return DEFAULT_MOTIF


# ---------------------------------------------------------------- 템플릿 엔진
def build_script_template(ep: Episode, cfg: Optional[Config] = None,
                          lang: Optional[str] = None) -> VideoScript:
    """한 회차의 대본을 한 언어로 생성한다.

    같은 시드에서 언어만 바꾸면 서로 대응되는 문장이 선택되므로,
    내레이션과 자막의 언어를 다르게 조합해도 내용이 어긋나지 않는다.
    """
    cfg = cfg or Config()
    lang = lang or cfg.lang
    pack = get_pack(lang)
    ends = pack["sentence_end"]
    cps = pack["chars_per_sec"]
    cap_len = 26 if lang == "ko" else 34

    rng = random.Random(cfg.seed + ep.no * 7919)
    motif_ko, motif_en = detect_motif(ep.title)     # 모티프 판별은 원본(한국어) 제목 기준
    act = ep.act
    title = pack["titles"][ep.no - 1]
    scene = _first_clause(title)
    tail = _last_clause(title)

    # HOOK
    hook = pack["hook_override"].get(ep.no) or rng.choice(pack["hook"][act.no]).format(scene=scene)

    # EMOTION
    emotion = rng.choice(pack["emotion"][act.no])
    max_tail = 28 if lang == "ko" else 46
    if tail != scene and len(tail) <= max_tail and tail not in hook:
        joiner = "." if lang == "ko" else "\u0964"
        emotion = f"{tail}{joiner} {emotion}"

    action = rng.choice(pack["action"][act.no])
    dream = rng.choice(pack["dream"][act.no])

    # MESSAGE
    if ep.no == 100:
        message = pack["finale"].format(slogan=SLOGAN)
    elif ep.no_spoiler:
        message = f"{pack['spoiler_tail']} {rng.choice(pack['message'])}"
    else:
        message = rng.choice(pack["message"])

    if ep.cliffhanger and ep.no != 95:
        dream = f"{dream} {pack['cliff_tail']}"

    raw = {
        "HOOK": (hook, motif_ko, f"cinematic close-up, {motif_en}, dust in the air"),
        "EMOTION": (emotion, f"{motif_ko} 위로 스치는 감정 (클로즈업)",
                    f"emotional close-up portrait of a young Indian footballer, {motif_en}"),
        "ACTION": (action, f"{motif_ko} — 역동적인 움직임 (트래킹 샷)",
                   f"dynamic action shot, young footballer sprinting, {motif_en}, motion blur"),
        "DREAM": (dream, "지평선을 바라보는 소년의 실루엣 (와이드)",
                  "wide silhouette of a boy looking at the horizon, warm dream-like haze"),
        "MESSAGE": (message, f"{act.mood} — 슬로건 타이포그래피",
                    "epic wide shot, Indian flag colors, typography end card"),
    }

    beats: List[Beat] = []
    for name in BEAT_ORDER:
        text, visual, prompt = raw[name]
        secs = BEAT_SECONDS[name]
        beats.append(Beat(
            name=name,
            seconds=secs,
            narration=_fit(text, secs, cps, ends),
            caption=_caption(text, cap_len, ends),
            visual=visual,
            image_prompt=f"{prompt}, {act.mood}, cinematic lighting, 35mm, high detail",
        ))

    label = pack["episode_label"].format(no=ep.no)
    hook_title = f"[{label}] {_clean(title)}"
    logline = f"ACT {act.no} {act.name} \u2014 {_clean(title)}"
    tags = (BASE_TAGS if lang == "ko" else HI_TAGS) + [f"#ACT{act.no}", f"#{ep.no}"]
    description = (
        f"{hook_title}\n\n"
        f"ACT {act.no} \u00b7 {act.name} ({act.subtitle})\n"
        f"{logline}\n\n"
        f"{SLOGAN}\n\n" + " ".join(tags)
    )

    return VideoScript(
        no=ep.no, title=_clean(title), act_no=act.no, act_name=act.name,
        hook_title=hook_title, logline=logline, beats=beats,
        hashtags=tags, description=description,
        director_note=ep.director_note, provider="template",
        lang=lang, caption_lang=lang, narration_title=_clean(title),
    )


def apply_caption_lang(script: VideoScript, ep: Episode, cfg: Config,
                       caption_lang: str) -> VideoScript:
    """자막만 다른 언어로 교체한다 (예: 힌디어 내레이션 + 한국어 자막)."""
    if caption_lang == script.lang:
        return script
    other = build_script_template(ep, cfg, lang=caption_lang)
    for beat, ref in zip(script.beats, other.beats):
        beat.caption = ref.caption
    script.caption_lang = caption_lang
    script.narration_title = script.title
    script.title = other.title
    script.hook_title = other.hook_title
    script.logline = other.logline
    script.hashtags = other.hashtags
    script.description = other.description
    return script


# ---------------------------------------------------------------- 진입점
def build_script(ep: Episode, cfg: Optional[Config] = None) -> VideoScript:
    cfg = cfg or Config()
    caption_lang = cfg.effective_caption_lang
    if cfg.script_provider == "llm":
        try:
            from .providers.llm import build_script_llm
            script = build_script_llm(ep, cfg)
            if script:
                return apply_caption_lang(script, ep, cfg, caption_lang)
        except Exception as exc:      # LLM 실패 시 템플릿으로 폴백
            print(f"  [script] LLM 생성 실패 \u2192 템플릿 사용 ({exc})")
    script = build_script_template(ep, cfg, lang=cfg.lang)
    return apply_caption_lang(script, ep, cfg, caption_lang)


def save_script(script: VideoScript, cfg: Config) -> Path:
    cfg.script_dir.mkdir(parents=True, exist_ok=True)
    path = cfg.script_dir / f"ep{script.no:03d}.json"
    path.write_text(json.dumps(script.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_script(no: int, cfg: Config) -> Optional[VideoScript]:
    path = cfg.script_dir / f"ep{no:03d}.json"
    if not path.exists():
        return None
    script = VideoScript.from_dict(json.loads(path.read_text(encoding="utf-8")))
    # 언어 설정이 바뀌었으면 캐시된 대본을 쓰지 않는다
    if script.lang != cfg.lang or script.caption_lang != cfg.effective_caption_lang:
        return None
    return script
