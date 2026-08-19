"""미국 증시 뉴스·공시 팩트 수집기.

- API 키가 없어도 동작합니다: 공개 RSS(야후 파이낸스/CNBC/나스닥) 로 폴백.
- Finnhub / Marketaux 키가 있으면 종목별 뉴스와 공식 감성 점수까지 받습니다.
- 헤드라인은 "사실 → 이벤트 분류 → 방향/강도" 순서로 계량화합니다.
  단어 하나로 매매하지 않도록, 이벤트 분류 가중치가 감성 점수보다 큽니다.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

UA = "Mozilla/5.0 (compatible; scalper/1.0; +https://example.invalid)"
TIMEOUT = 8


# ── 이벤트 분류: (정규식, 방향, 강도 0~1, 한글 태그) ─────────────────────
EVENT_RULES: list[tuple[str, int, float, str]] = [
    (r"beats?\s+(estimates|expectations)|earnings beat|tops estimates|어닝 서프라이즈", +1, 1.00, "실적 서프라이즈"),
    (r"misses?\s+(estimates|expectations)|earnings miss|어닝 쇼크", -1, 1.00, "어닝 쇼크"),
    (r"raises? (its )?(full[- ]year |fy )?(guidance|outlook|forecast)|가이던스 상향", +1, 0.95, "가이던스 상향"),
    (r"cuts? (its )?(guidance|outlook|forecast)|lowers? (guidance|outlook)|가이던스 하향", -1, 0.95, "가이던스 하향"),
    (r"\bupgrade[sd]?\b|raises? price target|price target (raised|hiked)|목표주가 상향", +1, 0.75, "목표주가 상향"),
    (r"\bdowngrade[sd]?\b|cuts? price target|목표주가 하향", -1, 0.75, "목표주가 하향"),
    (r"buyback|share repurchase|dividend (hike|increase)|자사주", +1, 0.60, "주주환원"),
    (r"secondary offering|stock offering|dilut(ion|ive)|유상증자", -1, 0.70, "희석 리스크"),
    (r"\bacquire[sd]?\b|acquisition|merger|takeover bid|인수|합병", +1, 0.65, "M&A"),
    (r"\bsec (probe|investigation)\b|lawsuit|antitrust|fine[sd]? \$|규제|소송|과징금", -1, 0.80, "규제·소송"),
    (r"recall|halt(s|ed)? production|defect|리콜|생산중단", -1, 0.85, "제품 리스크"),
    (r"layoffs?|job cuts|restructuring|감원|구조조정", -1, 0.45, "구조조정"),
    (r"record (revenue|quarter|sales)|all[- ]time high|사상 최대", +1, 0.70, "기록 실적"),
    (r"supply (chain )?(shortage|disruption)|공급망", -1, 0.55, "공급망 이슈"),
    (r"新?(new )?(contract|order|deal) win|wins? (a )?\$?\d+.{0,12}(contract|order)|수주", +1, 0.70, "수주"),
    (r"ceo (steps down|resigns|ousted)|cfo (resigns|departs)|경영진 사임", -1, 0.60, "경영진 리스크"),
    (r"chapter 11|bankrupt|default|파산|디폴트", -1, 1.00, "파산 리스크"),
    (r"stock split|액면분할", +1, 0.35, "액면분할"),
    (r"\bai (demand|boom|orders)\b|data ?center capex|AI 수요", +1, 0.55, "AI 수요"),
    (r"export (ban|curb|restriction)|tariff|sanction|수출규제|관세|제재", -1, 0.75, "수출규제·관세"),
]

# ── 보조 감성 어휘 (이벤트 규칙에 안 걸린 헤드라인용) ────────────────────
POSITIVE = {
    "surge": 3, "soar": 3, "rally": 2, "jump": 2, "gain": 1, "rise": 1, "climb": 1,
    "outperform": 2, "bullish": 2, "strong": 1, "growth": 1, "profit": 1,
    "optimistic": 1, "boost": 2, "expands": 1, "breakthrough": 2, "approval": 2,
    "급등": 3, "강세": 2, "상승": 1, "호조": 2, "기대": 1, "돌파": 2, "순매수": 1,
}
NEGATIVE = {
    "plunge": 3, "tumble": 3, "slump": 2, "sink": 2, "fall": 1, "drop": 1, "slide": 1,
    "underperform": 2, "bearish": 2, "weak": 1, "loss": 1, "warns": 2, "warning": 2,
    "concern": 1, "risk": 1, "probe": 2, "halt": 2, "delay": 1, "selloff": 3,
    "급락": 3, "약세": 2, "하락": 1, "부진": 2, "우려": 1, "이탈": 1, "순매도": 1,
}
NEGATORS = {"not", "no", "never", "without", "denies", "denied", "아니", "없", "부인"}


@dataclass
class Headline:
    """수집된 사실 하나."""

    title: str
    source: str
    url: str = ""
    ts: int = 0
    tickers: list[str] = field(default_factory=list)
    score: float = 0.0            # -100 ~ +100
    events: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "source": self.source,
            "url": self.url,
            "ts": self.ts,
            "tickers": self.tickers,
            "score": round(self.score, 1),
            "events": self.events,
        }


@dataclass
class NewsPulse:
    """한 종목(또는 시장 전체)의 뉴스 종합."""

    ticker: str
    score: float = 0.0            # -100 ~ +100, 최신성 가중 평균
    count: int = 0
    events: list[str] = field(default_factory=list)
    top: list[Headline] = field(default_factory=list)
    fetched_at: int = 0

    @property
    def label(self) -> str:
        if self.count == 0:
            return "뉴스 없음"
        if self.score >= 45:
            return "강한 호재"
        if self.score >= 15:
            return "호재 우위"
        if self.score <= -45:
            return "강한 악재"
        if self.score <= -15:
            return "악재 우위"
        return "중립"

    def as_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "score": round(self.score, 1),
            "label": self.label,
            "count": self.count,
            "events": self.events,
            "top": [h.as_dict() for h in self.top],
            "fetched_at": self.fetched_at,
        }


def _get(url: str, timeout: int = TIMEOUT) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None


def _get_json(url: str) -> object | None:
    raw = _get(url)
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").replace("&amp;", "&").strip()


def score_headline(title: str) -> tuple[float, list[str]]:
    """헤드라인 → (-100~100 점수, 이벤트 태그들).

    이벤트 규칙이 걸리면 그 강도가 점수의 뼈대가 되고, 어휘 감성은 ±25 범위의
    보정으로만 들어갑니다. '주가 하락' 같은 단어 한두 개로 뒤집히지 않게 하려는 것.
    """
    low = title.lower()
    events: list[str] = []
    base = 0.0
    for pattern, direction, weight, tag in EVENT_RULES:
        if re.search(pattern, low, re.IGNORECASE):
            events.append(tag)
            base += direction * weight * 70
    if len(events) > 1:
        base /= len(events) ** 0.5      # 여러 이벤트가 겹치면 과대평가 방지

    words = re.findall(r"[a-z가-힣]+", low)
    lex = 0.0
    for i, w in enumerate(words):
        val = POSITIVE.get(w, 0) - NEGATIVE.get(w, 0)
        if not val:
            continue
        window = words[max(0, i - 3): i]
        if any(any(n in x for n in NEGATORS) for x in window):
            val = -val
        lex += val
    lex = max(-25.0, min(25.0, lex * 6.0))

    return max(-100.0, min(100.0, base + lex)), events


def _parse_rss(raw: bytes, source: str) -> list[Headline]:
    out: list[Headline] = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    for item in root.iter():
        tag = item.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        title = ""
        link = ""
        ts = 0
        for child in item:
            ctag = child.tag.split("}")[-1]
            if ctag == "title":
                title = _strip_html(child.text or "")
            elif ctag == "link":
                link = (child.text or child.attrib.get("href", "")).strip()
            elif ctag in ("pubDate", "published", "updated"):
                ts = _parse_time(child.text or "")
        if title:
            out.append(Headline(title=title, source=source, url=link, ts=ts))
    return out


def _parse_time(text: str) -> int:
    text = text.strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            import datetime as dt
            parsed = dt.datetime.strptime(text, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return int(parsed.timestamp())
        except ValueError:
            continue
    return int(time.time())


# ── 수집 소스 ────────────────────────────────────────────────────────────

def fetch_yahoo(ticker: str) -> list[Headline]:
    url = ("https://feeds.finance.yahoo.com/rss/2.0/headline?s="
           + urllib.parse.quote(ticker) + "&region=US&lang=en-US")
    raw = _get(url)
    return _parse_rss(raw, "Yahoo Finance") if raw else []


def fetch_nasdaq(ticker: str) -> list[Headline]:
    url = f"https://www.nasdaq.com/feed/rssoutbound?symbol={urllib.parse.quote(ticker)}"
    raw = _get(url)
    return _parse_rss(raw, "Nasdaq") if raw else []


def fetch_market_rss() -> list[Headline]:
    """시장 전체 흐름용 — 종목 무관 헤드라인."""
    feeds = [
        ("https://www.cnbc.com/id/100003114/device/rss/rss.html", "CNBC"),
        ("https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch"),
        ("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "WSJ Markets"),
    ]
    out: list[Headline] = []
    for url, name in feeds:
        raw = _get(url)
        if raw:
            out.extend(_parse_rss(raw, name))
    return out


def fetch_finnhub(ticker: str, api_key: str, days: int = 3) -> list[Headline]:
    import datetime as dt

    today = dt.date.today()
    frm = (today - dt.timedelta(days=days)).isoformat()
    url = (f"https://finnhub.io/api/v1/company-news?symbol={urllib.parse.quote(ticker)}"
           f"&from={frm}&to={today.isoformat()}&token={urllib.parse.quote(api_key)}")
    data = _get_json(url)
    out: list[Headline] = []
    if isinstance(data, list):
        for row in data[:40]:
            if not isinstance(row, dict):
                continue
            out.append(Headline(
                title=_strip_html(str(row.get("headline", ""))),
                source=str(row.get("source", "Finnhub")),
                url=str(row.get("url", "")),
                ts=int(row.get("datetime", 0) or 0),
                tickers=[ticker.upper()],
            ))
    return [h for h in out if h.title]


def fetch_marketaux(ticker: str, api_key: str) -> list[Headline]:
    url = ("https://api.marketaux.com/v1/news/all?symbols="
           + urllib.parse.quote(ticker)
           + "&filter_entities=true&language=en&limit=20&api_token="
           + urllib.parse.quote(api_key))
    data = _get_json(url)
    out: list[Headline] = []
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        for row in data["data"]:
            out.append(Headline(
                title=_strip_html(str(row.get("title", ""))),
                source=str(row.get("source", "Marketaux")),
                url=str(row.get("url", "")),
                ts=_parse_time(str(row.get("published_at", ""))),
                tickers=[ticker.upper()],
            ))
    return [h for h in out if h.title]


class NewsCollector:
    """종목별 뉴스를 모으고 캐시합니다. 무료 API 쿼터를 아끼려 TTL 캐시 필수."""

    def __init__(self, finnhub_key: str = "", marketaux_key: str = "",
                 ttl: int = 180, max_age_hours: int = 36):
        self.finnhub_key = finnhub_key or os.environ.get("FINNHUB_API_KEY", "")
        self.marketaux_key = marketaux_key or os.environ.get("MARKETAUX_API_KEY", "")
        self.ttl = ttl
        self.max_age = max_age_hours * 3600
        self._cache: dict[str, tuple[int, NewsPulse]] = {}

    def _collect(self, ticker: str) -> list[Headline]:
        items: list[Headline] = []
        if self.finnhub_key:
            items += fetch_finnhub(ticker, self.finnhub_key)
        if self.marketaux_key:
            items += fetch_marketaux(ticker, self.marketaux_key)
        if not items:
            items += fetch_yahoo(ticker)
        if not items:
            items += fetch_nasdaq(ticker)
        return items

    def pulse(self, ticker: str, force: bool = False) -> NewsPulse:
        ticker = ticker.upper()
        now = int(time.time())
        hit = self._cache.get(ticker)
        if hit and not force and now - hit[0] < self.ttl:
            return hit[1]

        raw = self._collect(ticker)
        pulse = summarize(ticker, raw, now=now, max_age=self.max_age)
        self._cache[ticker] = (now, pulse)
        return pulse

    def market_pulse(self, force: bool = False) -> NewsPulse:
        """시장 전체 뉴스 톤. 개별 종목 신호의 배경으로 씁니다."""
        return self._market(force)

    def _market(self, force: bool) -> NewsPulse:
        now = int(time.time())
        hit = self._cache.get("__MARKET__")
        if hit and not force and now - hit[0] < self.ttl:
            return hit[1]
        pulse = summarize("MARKET", fetch_market_rss(), now=now, max_age=self.max_age)
        self._cache["__MARKET__"] = (now, pulse)
        return pulse


def summarize(ticker: str, items: list[Headline], now: int | None = None,
              max_age: int = 36 * 3600) -> NewsPulse:
    """헤드라인 묶음 → 최신성 가중 종합 점수.

    2시간 반감기로 오래된 뉴스의 영향력을 줄입니다. 장중 단타에서 어제 뉴스가
    지금 틱을 지배하면 안 되니까요.
    """
    now = now or int(time.time())
    seen: set[str] = set()
    scored: list[tuple[float, Headline]] = []
    events: list[str] = []

    for h in items:
        key = re.sub(r"\W+", "", h.title.lower())[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        age = max(0, now - (h.ts or now))
        if age > max_age:
            continue
        h.score, h.events = score_headline(h.title)
        events.extend(h.events)
        weight = 0.5 ** (age / 7200.0)          # 반감기 2시간
        if abs(h.score) >= 40:
            weight *= 1.3                        # 큰 이벤트는 더 오래 유효
        scored.append((weight, h))

    if not scored:
        return NewsPulse(ticker=ticker, score=0.0, count=0, fetched_at=now)

    total_w = sum(w for w, _ in scored)
    agg = sum(w * h.score for w, h in scored) / total_w if total_w else 0.0
    # 표본이 적으면 확신을 줄입니다 (5건에서 100% 반영)
    confidence = min(1.0, len(scored) / 5.0)
    # 가중평균만 쓰면 '8시간 전 기사 1건'이 '방금 기사 1건'과 같은 무게가 됩니다.
    # 가장 신선한 기사의 감쇠율을 따로 곱해 절대 영향력도 함께 낮춥니다.
    freshness = max(w for w, _ in scored)
    agg *= confidence * freshness

    top = [h for _, h in sorted(scored, key=lambda x: -abs(x[1].score) * x[0])][:6]
    uniq_events: list[str] = []
    for e in events:
        if e not in uniq_events:
            uniq_events.append(e)

    return NewsPulse(
        ticker=ticker,
        score=max(-100.0, min(100.0, agg)),
        count=len(scored),
        events=uniq_events[:6],
        top=top,
        fetched_at=now,
    )
