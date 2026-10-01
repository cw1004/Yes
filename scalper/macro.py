"""세계 정세·거시경제 판독기.

"오늘 시장이 위험을 사는 날인가, 파는 날인가"를 숫자로 만듭니다.
개별 종목 신호가 아무리 좋아도 매크로가 RISK_OFF 면 사이즈를 줄이고,
RISK_ON 이면 목표가를 늘리는 식으로 전략에 곱해집니다.

데이터는 FRED 공개 CSV(키 불필요)와 Stooq 지수 시세를 씁니다.
네트워크가 막혀 있으면 각 항목이 None 으로 남고, 판정은 있는 자료만으로 냅니다.
"""

from __future__ import annotations

import csv
import io
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from .news import _get, NewsPulse

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
STOOQ = "https://stooq.com/q/d/l/"

# 볼 지표: 코드 → (한글 이름, 높을수록 위험인가)
SERIES = {
    "VIXCLS": ("VIX 변동성", True),
    "DGS10": ("미 10년물", False),
    "DGS2": ("미 2년물", False),
    "T10Y2Y": ("장단기 금리차", False),
    "BAMLH0A0HYM2": ("하이일드 스프레드", True),
    "DTWEXBGS": ("달러지수", True),
    "DCOILWTICO": ("WTI 유가", True),
    "UNRATE": ("실업률", True),
    "CPIAUCSL": ("소비자물가", True),
    "DFF": ("연준 기준금리", True),
}

# 지정학·정책 리스크 키워드: (정규식 조각, 위험 가중치)
GEO_KEYWORDS: list[tuple[str, float]] = [
    ("war", 1.0), ("invasion", 1.0), ("전쟁", 1.0), ("침공", 1.0),
    ("missile", 0.8), ("strike on", 0.8), ("공습", 0.8),
    ("sanction", 0.7), ("제재", 0.7),
    ("tariff", 0.8), ("trade war", 0.9), ("관세", 0.8), ("무역분쟁", 0.9),
    ("export curb", 0.7), ("export ban", 0.8), ("수출규제", 0.8),
    ("shutdown", 0.5), ("default", 0.9), ("debt ceiling", 0.7), ("셧다운", 0.5),
    ("oil surge", 0.6), ("opec cut", 0.5), ("유가 급등", 0.6),
    ("bank failure", 1.0), ("credit crunch", 0.9), ("뱅크런", 1.0),
    ("hawkish", 0.5), ("rate hike", 0.6), ("금리 인상", 0.6),
    ("dovish", -0.5), ("rate cut", -0.6), ("금리 인하", -0.6),
    ("ceasefire", -0.7), ("휴전", -0.7), ("trade deal", -0.6), ("무역 합의", -0.6),
]


@dataclass
class MacroPulse:
    """거시 판독 결과."""

    regime: str = "NEUTRAL"                  # RISK_ON / NEUTRAL / RISK_OFF
    score: float = 0.0                       # -100(위험회피) ~ +100(위험선호)
    drivers: list[str] = field(default_factory=list)
    values: dict[str, float | None] = field(default_factory=dict)
    changes: dict[str, float | None] = field(default_factory=dict)
    geo_risk: float = 0.0                    # 0~100
    geo_tags: list[str] = field(default_factory=list)
    breadth: float | None = None             # SPY 5일 수익률(%)
    fetched_at: int = 0

    @property
    def size_multiplier(self) -> float:
        """포지션 크기 배수 0.3 ~ 1.3."""
        m = 1.0 + self.score / 250.0
        if self.regime == "RISK_OFF":
            m *= 0.6
        elif self.regime == "RISK_ON":
            m *= 1.1
        if self.geo_risk >= 60:
            m *= 0.65
        return max(0.3, min(1.3, m))

    @property
    def entry_bias(self) -> float:
        """매수 문턱 보정치(점). +면 더 깐깐하게 사라는 뜻."""
        bias = -self.score / 8.0              # 위험선호면 문턱을 낮춤
        if self.geo_risk >= 60:
            bias += 8
        elif self.geo_risk >= 35:
            bias += 4
        return max(-8.0, min(15.0, bias))

    @property
    def label(self) -> str:
        return {"RISK_ON": "위험선호", "RISK_OFF": "위험회피"}.get(self.regime, "중립")

    def as_dict(self) -> dict:
        return {
            "regime": self.regime,
            "label": self.label,
            "score": round(self.score, 1),
            "drivers": self.drivers,
            "values": {k: (None if v is None else round(v, 3)) for k, v in self.values.items()},
            "changes": {k: (None if v is None else round(v, 3)) for k, v in self.changes.items()},
            "geo_risk": round(self.geo_risk, 1),
            "geo_tags": self.geo_tags,
            "breadth": None if self.breadth is None else round(self.breadth, 2),
            "size_multiplier": round(self.size_multiplier, 2),
            "entry_bias": round(self.entry_bias, 1),
            "fetched_at": self.fetched_at,
        }


def fetch_fred(series_id: str, days: int = 120) -> list[tuple[str, float]]:
    """FRED 공개 CSV. API 키 없이 최근 구간만 잘라 받습니다."""
    import datetime as dt

    start = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    url = f"{FRED_CSV}?{urllib.parse.urlencode({'id': series_id, 'cosd': start})}"
    raw = _get(url, timeout=10)
    if not raw:
        return []
    out: list[tuple[str, float]] = []
    reader = csv.reader(io.StringIO(raw.decode("utf-8", "replace")))
    rows = list(reader)
    if not rows:
        return []
    for row in rows[1:]:
        if len(row) < 2:
            continue
        try:
            out.append((row[0], float(row[1])))
        except ValueError:
            continue          # FRED 결측치는 "." 로 옵니다
    return out


def fetch_stooq_closes(symbol: str, limit: int = 40) -> list[float]:
    """Stooq 일봉 종가 (키 불필요). 예: spy.us, ^spx."""
    url = f"{STOOQ}?{urllib.parse.urlencode({'s': symbol, 'i': 'd'})}"
    raw = _get(url, timeout=10)
    if not raw:
        return []
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8", "replace")))
    closes: list[float] = []
    for row in reader:
        try:
            closes.append(float(row["Close"]))
        except (KeyError, TypeError, ValueError):
            continue
    return closes[-limit:]


def geo_scan(pulse: NewsPulse | None) -> tuple[float, list[str]]:
    """시장 뉴스 헤드라인에서 지정학·정책 리스크를 뽑습니다."""
    if pulse is None or not pulse.top:
        return 0.0, []
    risk = 0.0
    tags: list[str] = []
    for h in pulse.top:
        low = h.title.lower()
        for kw, weight in GEO_KEYWORDS:
            if kw in low:
                risk += weight * 18
                label = kw if not kw.isascii() else kw.upper()
                if label not in tags:
                    tags.append(label)
    return max(0.0, min(100.0, risk)), tags[:6]


def _change(values: list[tuple[str, float]], lookback: int = 5) -> float | None:
    if len(values) < 2:
        return None
    latest = values[-1][1]
    ref = values[max(0, len(values) - 1 - lookback)][1]
    if ref == 0:
        return None
    return (latest - ref) / abs(ref) * 100.0


class MacroReader:
    """거시 지표를 모아 레짐을 판정합니다. TTL 은 길게(기본 15분) 잡습니다."""

    def __init__(self, ttl: int = 900, offline: bool | None = None):
        self.ttl = ttl
        self.offline = os.environ.get("SCALPER_OFFLINE") == "1" if offline is None else offline
        self._cache: tuple[int, MacroPulse] | None = None

    def pulse(self, market_news: NewsPulse | None = None, force: bool = False) -> MacroPulse:
        now = int(time.time())
        if self._cache and not force and now - self._cache[0] < self.ttl:
            cached = self._cache[1]
            if market_news is not None:
                cached.geo_risk, cached.geo_tags = geo_scan(market_news)
            return cached

        values: dict[str, float | None] = {}
        changes: dict[str, float | None] = {}
        if not self.offline:
            for sid in SERIES:
                series = fetch_fred(sid)
                values[sid] = series[-1][1] if series else None
                changes[sid] = _change(series)
        else:
            values = {sid: None for sid in SERIES}
            changes = dict(values)

        breadth = None
        if not self.offline:
            closes = fetch_stooq_closes("spy.us")
            if len(closes) >= 6:
                breadth = (closes[-1] - closes[-6]) / closes[-6] * 100.0

        geo_risk, geo_tags = geo_scan(market_news)
        pulse = self._judge(values, changes, breadth, geo_risk, geo_tags, market_news)
        pulse.fetched_at = now
        self._cache = (now, pulse)
        return pulse

    def _judge(self, values, changes, breadth, geo_risk, geo_tags,
               market_news: NewsPulse | None) -> MacroPulse:
        score = 0.0
        drivers: list[str] = []

        vix = values.get("VIXCLS")
        if vix is not None:
            if vix < 14:
                score += 22; drivers.append(f"VIX {vix:.1f} 안정")
            elif vix < 18:
                score += 10; drivers.append(f"VIX {vix:.1f}")
            elif vix < 24:
                score -= 8; drivers.append(f"VIX {vix:.1f} 경계")
            else:
                score -= 30; drivers.append(f"VIX {vix:.1f} 공포")

        hy = values.get("BAMLH0A0HYM2")
        hy_chg = changes.get("BAMLH0A0HYM2")
        if hy is not None:
            if hy < 3.5:
                score += 14; drivers.append(f"HY 스프레드 {hy:.2f}% 타이트")
            elif hy > 5.0:
                score -= 18; drivers.append(f"HY 스프레드 {hy:.2f}% 확대")
        if hy_chg is not None and hy_chg > 6:
            score -= 12; drivers.append("신용 스프레드 급확대")

        curve = values.get("T10Y2Y")
        if curve is not None:
            if curve < -0.2:
                score -= 10; drivers.append(f"장단기 역전 {curve:.2f}%p")
            elif curve > 0.3:
                score += 6; drivers.append(f"금리차 정상화 {curve:.2f}%p")

        r10_chg = changes.get("DGS10")
        if r10_chg is not None:
            if r10_chg > 5:
                score -= 12; drivers.append("10년물 금리 급등")
            elif r10_chg < -5:
                score += 8; drivers.append("10년물 금리 하락")

        usd_chg = changes.get("DTWEXBGS")
        if usd_chg is not None:
            if usd_chg > 1.2:
                score -= 10; drivers.append("달러 강세 (위험자산 부담)")
            elif usd_chg < -1.2:
                score += 8; drivers.append("달러 약세")

        oil_chg = changes.get("DCOILWTICO")
        if oil_chg is not None and abs(oil_chg) > 8:
            score += -10 if oil_chg > 0 else 4
            drivers.append(f"유가 {oil_chg:+.1f}%")

        if breadth is not None:
            if breadth > 1.5:
                score += 14; drivers.append(f"SPY 5일 {breadth:+.1f}%")
            elif breadth < -1.5:
                score -= 16; drivers.append(f"SPY 5일 {breadth:+.1f}%")
            else:
                score += breadth * 4

        if market_news is not None and market_news.count:
            score += max(-15.0, min(15.0, market_news.score * 0.2))
            if abs(market_news.score) >= 20:
                drivers.append(f"시장 뉴스 {market_news.label}")

        score -= geo_risk * 0.35
        if geo_tags:
            drivers.append("지정학 리스크: " + ", ".join(geo_tags[:3]))

        score = max(-100.0, min(100.0, score))
        if score >= 20:
            regime = "RISK_ON"
        elif score <= -20:
            regime = "RISK_OFF"
        else:
            regime = "NEUTRAL"

        if not drivers:
            drivers.append("거시 데이터 없음 — 기술적 신호만으로 판단")

        return MacroPulse(
            regime=regime, score=score, drivers=drivers[:8],
            values=values, changes=changes,
            geo_risk=geo_risk, geo_tags=geo_tags, breadth=breadth,
        )
