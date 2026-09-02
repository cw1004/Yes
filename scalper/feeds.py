"""시세 피드 — 실 데이터가 없어도 앱 전체가 돌아가도록 시뮬레이터를 기본으로 둡니다.

우선순위: Alpaca → Finnhub → Stooq(일봉) → 시뮬레이터
"""

from __future__ import annotations

import json
import math
import os
import random
import zlib
import time
import urllib.parse
from dataclasses import dataclass

from .indicators import Candle
from .news import _get, _get_json


# ── 시뮬레이터 ───────────────────────────────────────────────────────────

BASE_PRICES = {
    "NVDA": 128.4, "TSLA": 246.8, "AAPL": 227.5, "MSFT": 421.3, "SPY": 561.2,
    "AMD": 158.7, "META": 512.4, "AMZN": 186.9, "GOOGL": 168.2, "QQQ": 482.6,
}


class TickSimulator:
    """추세 + 평균회귀 + 가끔 튀는 이벤트를 섞은 5분봉 생성기.

    실제와 비슷하게 '움직이는' 데이터를 만드는 게 목적이지, 예측용이 아닙니다.
    """

    def __init__(self, ticker: str, bars: int = 180, seed: int | None = None,
                 interval_sec: int = 300):
        self.ticker = ticker.upper()
        self.interval = interval_sec
        # PYTHONHASHSEED 에 흔들리지 않도록 crc32 로 고정 — 같은 티커는 항상 같은 경로.
        salt = zlib.crc32(self.ticker.encode())
        self.rng = random.Random(salt if seed is None else (seed * 1_000_003) ^ salt)
        self.price = BASE_PRICES.get(self.ticker, 100 + self.rng.random() * 300)
        self.vol_base = 40_000 + self.rng.random() * 120_000
        self.drift = self.rng.uniform(-0.00006, 0.00010)
        self.candles: list[Candle] = []
        now = int(time.time())
        start = now - bars * self.interval
        for i in range(bars):
            self.candles.append(self._next_candle(start + i * self.interval))

    def _next_candle(self, ts: int) -> Candle:
        r = self.rng
        vol_regime = 1.0 + 0.6 * math.sin(ts / 3600.0)
        sigma = 0.0016 * vol_regime
        o = self.price
        steps = [r.gauss(self.drift, sigma) for _ in range(5)]
        if r.random() < 0.03:                       # 3% 확률로 이벤트 캔들
            steps[r.randrange(5)] += r.choice([-1, 1]) * r.uniform(0.004, 0.012)
        path = [o]
        for s in steps:
            path.append(max(0.5, path[-1] * (1 + s)))
        c = path[-1]
        h, l = max(path), min(path)
        self.price = c
        move = abs(c - o) / o if o else 0
        volume = self.vol_base * (0.6 + r.random() * 0.8) * (1 + move * 90)
        return Candle(ts=ts, open=o, high=h, low=l, close=c, volume=volume)

    def tick(self) -> Candle:
        """마지막 봉을 갱신하거나, 시간이 지났으면 새 봉을 엽니다."""
        last = self.candles[-1]
        now = int(time.time())
        if now - last.ts >= self.interval:
            self.candles.append(self._next_candle(last.ts + self.interval))
            if len(self.candles) > 400:
                self.candles = self.candles[-400:]
            return self.candles[-1]
        step = self.rng.gauss(self.drift, 0.0011)
        new_close = max(0.5, last.close * (1 + step))
        last.close = new_close
        last.high = max(last.high, new_close)
        last.low = min(last.low, new_close)
        last.volume += self.vol_base * 0.05 * (0.5 + self.rng.random())
        self.price = new_close
        return last

    def history(self) -> list[Candle]:
        return list(self.candles)


# ── 실 데이터 어댑터 ─────────────────────────────────────────────────────

@dataclass
class FeedCreds:
    alpaca_key: str = ""
    alpaca_secret: str = ""
    finnhub_key: str = ""

    @classmethod
    def from_env(cls) -> "FeedCreds":
        return cls(
            alpaca_key=os.environ.get("ALPACA_API_KEY", ""),
            alpaca_secret=os.environ.get("ALPACA_API_SECRET", ""),
            finnhub_key=os.environ.get("FINNHUB_API_KEY", ""),
        )

    @property
    def has_alpaca(self) -> bool:
        return bool(self.alpaca_key and self.alpaca_secret)


def fetch_alpaca_bars(ticker: str, creds: FeedCreds, limit: int = 200,
                      timeframe: str = "5Min") -> list[Candle]:
    import urllib.request

    params = urllib.parse.urlencode({
        "symbols": ticker.upper(), "timeframe": timeframe,
        "limit": limit, "feed": "iex", "sort": "asc",
    })
    url = f"https://data.alpaca.markets/v2/stocks/bars?{params}"
    req = urllib.request.Request(url, headers={
        "APCA-API-KEY-ID": creds.alpaca_key,
        "APCA-API-SECRET-KEY": creds.alpaca_secret,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return []
    bars = (data.get("bars") or {}).get(ticker.upper()) or []
    out: list[Candle] = []
    for b in bars:
        out.append(Candle(
            ts=_iso_to_epoch(b.get("t", "")),
            open=float(b.get("o", 0)), high=float(b.get("h", 0)),
            low=float(b.get("l", 0)), close=float(b.get("c", 0)),
            volume=float(b.get("v", 0)),
        ))
    return out


def fetch_finnhub_candles(ticker: str, api_key: str, resolution: str = "5",
                          count: int = 200) -> list[Candle]:
    to = int(time.time())
    frm = to - count * 300 * 3
    url = ("https://finnhub.io/api/v1/stock/candle?"
           + urllib.parse.urlencode({"symbol": ticker.upper(), "resolution": resolution,
                                     "from": frm, "to": to, "token": api_key}))
    data = _get_json(url)
    if not isinstance(data, dict) or data.get("s") != "ok":
        return []
    out: list[Candle] = []
    for i in range(len(data.get("t", []))):
        out.append(Candle(ts=int(data["t"][i]), open=float(data["o"][i]),
                          high=float(data["h"][i]), low=float(data["l"][i]),
                          close=float(data["c"][i]), volume=float(data["v"][i])))
    return out


def fetch_stooq_candles(ticker: str, count: int = 200) -> list[Candle]:
    """마지막 폴백 — 일봉이라 단타용은 아니지만 형태 확인엔 씁니다."""
    import csv
    import io

    url = f"https://stooq.com/q/d/l/?s={ticker.lower()}.us&i=d"
    raw = _get(url, timeout=10)
    if not raw:
        return []
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
    out: list[Candle] = []
    for row in rows[-count:]:
        try:
            import datetime as dt
            ts = int(dt.datetime.strptime(row["Date"], "%Y-%m-%d")
                     .replace(tzinfo=dt.timezone.utc).timestamp())
            out.append(Candle(ts=ts, open=float(row["Open"]), high=float(row["High"]),
                              low=float(row["Low"]), close=float(row["Close"]),
                              volume=float(row["Volume"])))
        except (KeyError, ValueError):
            continue
    return out


def _iso_to_epoch(text: str) -> int:
    import datetime as dt

    text = (text or "").replace("Z", "+00:00")
    try:
        return int(dt.datetime.fromisoformat(text).timestamp())
    except ValueError:
        return int(time.time())


class MarketFeed:
    """슬롯이 쓰는 단일 진입점. 실 피드가 죽으면 조용히 시뮬레이터로 내려갑니다."""

    def __init__(self, ticker: str, creds: FeedCreds | None = None,
                 live: bool = False, seed: int | None = None):
        self.ticker = ticker.upper()
        self.creds = creds or FeedCreds.from_env()
        self.live = live
        self.source = "simulator"
        self.sim = TickSimulator(self.ticker, seed=seed)
        self._candles: list[Candle] = self.sim.history()
        self._last_pull = 0.0
        if live:
            self.refresh(force=True)

    def refresh(self, force: bool = False) -> list[Candle]:
        if not self.live:
            self.sim.tick()
            self._candles = self.sim.history()
            return self._candles
        now = time.time()
        if not force and now - self._last_pull < 20:
            return self._candles
        self._last_pull = now
        bars: list[Candle] = []
        if self.creds.has_alpaca:
            bars = fetch_alpaca_bars(self.ticker, self.creds)
            if bars:
                self.source = "alpaca"
        if not bars and self.creds.finnhub_key:
            bars = fetch_finnhub_candles(self.ticker, self.creds.finnhub_key)
            if bars:
                self.source = "finnhub"
        if not bars:
            bars = fetch_stooq_candles(self.ticker)
            if bars:
                self.source = "stooq(일봉)"
        if bars:
            self._candles = bars
        else:
            self.source = "simulator(폴백)"
            self.sim.tick()
            self._candles = self.sim.history()
        return self._candles

    @property
    def candles(self) -> list[Candle]:
        return self._candles

    @property
    def price(self) -> float:
        return self._candles[-1].close if self._candles else 0.0
