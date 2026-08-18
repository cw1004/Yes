# -*- coding: utf-8 -*-
"""60초 5단계(HOOK/EMOTION/ACTION/DREAM/MESSAGE) 대본 자동 생성기.

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

# 한국어 TTS 평균 속도(초당 글자수) — 길이 추정용
CHARS_PER_SEC = 5.0


@dataclass
class Beat:
    name: str                # HOOK / EMOTION / ACTION / DREAM / MESSAGE
    seconds: float
    narration: str           # TTS 로 읽을 문장
    caption: str             # 화면 상단 자막(짧게)
    visual: str              # 촬영/이미지 지시문 (한국어)
    image_prompt: str        # 이미지 생성용 프롬프트 (영어)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class VideoScript:
    no: int
    title: str
    act_no: int
    act_name: str
    hook_title: str          # 썸네일/영상 제목
    logline: str
    beats: List[Beat]
    hashtags: List[str]
    description: str
    director_note: Optional[str] = None
    provider: str = "template"

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
            "act_no": self.act_no,
            "act_name": self.act_name,
            "hook_title": self.hook_title,
            "logline": self.logline,
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

# ---------------------------------------------------------------- 문장 뱅크
HOOK_BANK: Dict[int, List[str]] = {
    1: [
        "{scene}. 그 순간, 소년의 심장이 크게 뛰었다.",
        "{scene}. 인도의 이름 없는 마을에서 벌어진 일이다.",
        "{scene}. 세상은 아직 이 아이를 모른다.",
        "{scene}. 모든 것은 여기서 시작됐다.",
    ],
    2: [
        "{scene}. 아무도 보지 않는 곳에서 하루가 시작된다.",
        "{scene}. 재능이 아니라 버티는 힘이 시험받는 시간이다.",
        "{scene}. 이 하루가 그를 다른 사람으로 만든다.",
        "{scene}. 여기서 무너지면, 거기서 끝이었다.",
    ],
    3: [
        "{scene}. 무대가 달라지자, 모든 것이 달라졌다.",
        "{scene}. 그의 이름이 처음으로 종이 위에 적힌다.",
        "{scene}. 여기서부터는 실력만이 말을 한다.",
        "{scene}. 이 한 경기가 다음 문을 연다.",
    ],
    4: [
        "{scene}. 이제 그의 등 뒤에는 나라 이름이 있다.",
        "{scene}. 카메라가 처음으로 그를 향한다.",
        "{scene}. 한 사람의 경기가 아니었다.",
        "{scene}. 2030이 조금씩 가까워지고 있었다.",
    ],
    5: [
        "{scene}. 인도 전체가 이 한 장면을 지켜본다.",
        "{scene}. 이 순간을 위해 십오 년을 달려왔다.",
        "{scene}. 지금부터는 되돌릴 수 없다.",
        "{scene}. 온 나라가 숨을 멈춘다.",
    ],
}

# 특정 회차 전용 훅 (제작 메모 반영)
HOOK_OVERRIDE: Dict[int, str] = {
    1: "쓰레기 더미 옆, 바람 빠진 공 하나. 맨발의 소년이 그것을 집어 들었다.",
    88: "TV 앞에 앉은 또 한 명의 맨발 소년. 1화의 그 장면과 똑같은 눈빛이다.",
    95: "심판이 호루라기를 입에 무는 순간. 모든 것이 여기서 결정된다.",
    99: "노을 속에 나란히 선 소년과 코끼리. 긴 이야기가 여기서 하나로 모인다.",
    100: "수많은 아이들이 저마다의 공을 찬다. 이 이야기는 끝이 아니라 시작이다.",
}

EMOTION_BANK: Dict[int, List[str]] = {
    1: [
        "가진 것은 낡은 공 하나와 맨발뿐이었다. 그래도 소년은 웃었다.",
        "먹고 사는 일이 먼저인 마을에서, 꿈을 말하는 건 사치였다.",
        "누구도 그를 응원하지 않았지만, 그의 눈빛만은 뜨거웠다.",
    ],
    2: [
        "재능만으로는 아무것도 증명할 수 없다는 걸, 소년은 처음 알았다.",
        "포기하고 싶은 밤이 셀 수 없이 찾아왔다. 그때마다 공이 그를 붙잡았다.",
        "실패는 아팠다. 그러나 그 아픔이 그를 조금씩 단단하게 만들었다.",
    ],
    3: [
        "더 큰 무대는 더 큰 벽이었다. 소년은 그 벽 앞에서 처음으로 작아졌다.",
        "이름조차 불리지 않던 아이가, 이제 명단 위에서 자신을 찾는다.",
        "낯선 도시, 낯선 말, 낯선 눈빛. 기댈 것은 자기 발끝뿐이었다.",
    ],
    4: [
        "가슴에 국기를 다는 순간, 무게가 달라졌다. 이제 혼자가 아니었다.",
        "카메라 플래시가 쏟아졌다. 환호 뒤에는 언제나 두려움이 있었다.",
        "마을의 낡은 TV 앞에 사람들이 모였다. 그들이 부르는 이름은 하나였다.",
    ],
    5: [
        "십사 억의 심장이 같은 리듬으로 뛰기 시작했다.",
        "여기까지 오는 데 인생 전부가 걸렸다. 그리고 남은 시간은 짧다.",
        "한 사람의 꿈이 어느새 한 나라의 꿈이 되어 있었다.",
    ],
}

ACTION_BANK: Dict[int, List[str]] = {
    1: [
        "해가 뜨기 전에 일어나 흙바닥을 달렸고, 해가 지고도 홀로 공을 찼다.",
        "야단을 맞으면서도 소년은 매일 같은 자리로 돌아왔다. 공을 놓지 않았다.",
        "벽에 그린 골대를 향해 수백 번, 수천 번 같은 슛을 반복했다.",
    ],
    2: [
        "코치도 장비도 없었다. 돌멩이를 세워 코스를 만들고 스스로를 몰아붙였다.",
        "넘어지면 일어나 다시 뛰었다. 같은 실수를 두 번 하지 않기 위해서.",
        "몸이 작다면 더 빨라지면 된다. 소년은 자기만의 답을 찾아 나갔다.",
    ],
    3: [
        "첫 터치, 첫 돌파, 첫 슈팅. 소년은 모든 것을 그 한 경기에 쏟아부었다.",
        "기회는 단 한 번이었고, 그는 그 한 번을 위해 모든 걸 준비해 왔다.",
        "숨이 턱까지 차올라도 발을 멈추지 않았다. 여기서 물러설 수 없었다.",
    ],
    4: [
        "세계 최고의 선수들 사이에서, 그는 자신의 방식으로 증명하기 시작했다.",
        "누구보다 먼저 훈련장에 나왔고, 가장 늦게까지 남아 슈팅을 반복했다.",
        "그의 발끝이 향한 곳은 언제나 골문, 그리고 그 너머의 2030이었다.",
    ],
    5: [
        "휘슬이 울리고, 온 나라가 숨을 멈춘 채 그 발끝을 바라보았다.",
        "쓰러져도 다시 일어섰다. 이 경기만큼은 끝까지 뛰어야 했다.",
        "동료의 손을 맞잡고, 그들은 다시 한번 앞으로 나아갔다.",
    ],
}

DREAM_BANK: Dict[int, List[str]] = {
    1: ["\"나는 언젠가 이 나라를 대표해 뛸 거예요.\" 소년의 목소리는 작았지만 분명했다."],
    2: ["언젠가 저 큰 경기장에서 뛰는 자신을, 소년은 매일 밤 그렸다."],
    3: ["가슴에 국기를 단 자신의 모습. 이제 그 꿈은 손에 닿을 만큼 가까워졌다."],
    4: ["2030년, 월드컵 무대 위의 인도. 그 그림이 점점 선명해지고 있었다."],
    5: ["인도가 월드컵을 누비는 날. 그 하루를 위해 모두가 여기까지 왔다."],
}

MESSAGE_BANK: List[str] = [
    "꿈은 가진 것에서 시작되지 않는다. 포기하지 않는 마음에서 시작된다.",
    "누구도 믿어주지 않아도, 스스로를 믿는 사람은 끝내 나아간다.",
    "한 명의 소년, 하나의 공. 그것으로 충분했다.",
    "오늘의 한 걸음이 2030년의 기적을 만든다.",
    "가장 낮은 곳에서 시작한 꿈이, 가장 높은 곳에 닿는다.",
    "재능은 시작이고, 끝까지 남는 것은 마음이다.",
]

SLOGAN = "ONE BOY. ONE BALL. ONE DREAM. ONE NATION."

CLIFF_TAIL = "그리고 다음 순간, 아무도 예상하지 못한 일이 벌어진다."
SPOILER_TAIL = "결과는… 아직 말할 수 없다."

BASE_TAGS = ["#INDIA2030", "#인도축구", "#월드컵2030", "#shorts", "#football",
             "#축구스토리", "#OneBoyOneBall", "#감동실화"]


# ---------------------------------------------------------------- 유틸
def _clean(text: str) -> str:
    """제목을 나레이션에 넣기 좋게 다듬는다."""
    t = text.replace("“", "\"").replace("”", "\"")
    t = re.sub(r"\s*—\s*", ", ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t.rstrip(".")


def _first_clause(title: str) -> str:
    t = _clean(title)
    parts = [p.strip() for p in t.split(",") if p.strip()]
    return parts[0] if parts else t


def _last_clause(title: str) -> str:
    t = _clean(title)
    parts = [p.strip() for p in t.split(",") if p.strip()]
    return parts[-1] if parts else t


def _fit(text: str, seconds: float, tolerance: float = 1.35) -> str:
    """나레이션이 배정된 초를 크게 넘지 않도록 문장 단위로 자른다."""
    limit = int(seconds * CHARS_PER_SEC * tolerance)
    if len(text) <= limit:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for s in sentences:
        if not out:
            out = s
        elif len(out) + len(s) + 1 <= limit:
            out = f"{out} {s}"
        else:
            break
    return out or text[:limit].rstrip() + "…"


def _caption(text: str, max_len: int = 26) -> str:
    """화면 자막용 짧은 문구."""
    t = re.split(r"(?<=[.!?])\s", _clean(text))[0]
    t = t.rstrip(".")
    if len(t) <= max_len:
        return t
    cut = t[:max_len]
    if " " in cut[max_len // 2:]:
        cut = cut[:cut.rfind(" ")]
    return cut + "…"


def detect_motif(title: str) -> tuple:
    for keys, ko, en in MOTIFS:
        if any(k in title for k in keys):
            return ko, en
    return DEFAULT_MOTIF


# ---------------------------------------------------------------- 템플릿 엔진
def build_script_template(ep: Episode, cfg: Optional[Config] = None) -> VideoScript:
    rng = random.Random((cfg.seed if cfg else 0) + ep.no * 7919)
    motif_ko, motif_en = detect_motif(ep.title)
    act = ep.act
    scene = _first_clause(ep.title)
    tail = _last_clause(ep.title)

    # HOOK
    hook = HOOK_OVERRIDE.get(ep.no) or rng.choice(HOOK_BANK[act.no]).format(scene=scene)

    # EMOTION
    emotion = rng.choice(EMOTION_BANK[act.no])
    if tail != scene and len(tail) <= 28 and tail not in hook:
        emotion = f"{tail}. {emotion}"

    # ACTION
    action = rng.choice(ACTION_BANK[act.no])

    # DREAM
    dream = rng.choice(DREAM_BANK[act.no])

    # MESSAGE
    if ep.no == 100:
        message = f"수많은 아이들이 저마다의 공을 찬다. {SLOGAN}"
    elif ep.no_spoiler:
        message = f"{SPOILER_TAIL} {rng.choice(MESSAGE_BANK)}"
    else:
        message = rng.choice(MESSAGE_BANK)

    if ep.cliffhanger and ep.no != 95:
        dream = f"{dream} {CLIFF_TAIL}"

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
            narration=_fit(text, secs),
            caption=_caption(text),
            visual=visual,
            image_prompt=f"{prompt}, {act.mood}, cinematic lighting, 35mm, high detail",
        ))

    hook_title = f"[{ep.no}화] {_clean(ep.title)}"
    logline = f"ACT {act.no} {act.name} — {_clean(ep.title)}"
    tags = BASE_TAGS + [f"#ACT{act.no}", f"#{ep.no}화"]
    description = (
        f"{hook_title}\n\n"
        f"ACT {act.no} · {act.name} ({act.subtitle})\n"
        f"{logline}\n\n"
        f"{SLOGAN}\n\n" + " ".join(tags)
    )

    return VideoScript(
        no=ep.no, title=_clean(ep.title), act_no=act.no, act_name=act.name,
        hook_title=hook_title, logline=logline, beats=beats,
        hashtags=tags, description=description,
        director_note=ep.director_note, provider="template",
    )


# ---------------------------------------------------------------- 진입점
def build_script(ep: Episode, cfg: Optional[Config] = None) -> VideoScript:
    cfg = cfg or Config()
    if cfg.script_provider == "llm":
        try:
            from .providers.llm import build_script_llm
            script = build_script_llm(ep, cfg)
            if script:
                return script
        except Exception as exc:      # LLM 실패 시 템플릿으로 폴백
            print(f"  [script] LLM 생성 실패 → 템플릿 사용 ({exc})")
    return build_script_template(ep, cfg)


def save_script(script: VideoScript, cfg: Config) -> Path:
    cfg.script_dir.mkdir(parents=True, exist_ok=True)
    path = cfg.script_dir / f"ep{script.no:03d}.json"
    path.write_text(json.dumps(script.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_script(no: int, cfg: Config) -> Optional[VideoScript]:
    path = cfg.script_dir / f"ep{no:03d}.json"
    if not path.exists():
        return None
    return VideoScript.from_dict(json.loads(path.read_text(encoding="utf-8")))
