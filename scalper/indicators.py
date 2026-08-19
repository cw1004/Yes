"""단타용 기술 지표 — 외부 의존성 없이 순수 파이썬으로 계산합니다.

모든 함수는 "과거 → 현재" 순서의 리스트를 받고, 계산 불가한 앞부분은 None 으로
채운 같은 길이의 리스트를 돌려줍니다. 인덱스가 캔들과 1:1 로 맞아야
차트/백테스트에서 미래참조(look-ahead) 사고가 나지 않습니다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence


@dataclass
class Candle:
    """5분봉 하나. ts 는 UTC epoch 초."""

    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def is_bull(self) -> bool:
        return self.close >= self.open

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def typical(self) -> float:
        return (self.high + self.low + self.close) / 3.0

    def as_dict(self) -> dict:
        return {
            "ts": self.ts,
            "o": round(self.open, 4),
            "h": round(self.high, 4),
            "l": round(self.low, 4),
            "c": round(self.close, 4),
            "v": round(self.volume, 2),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Candle":
        return cls(
            ts=int(d.get("ts") or d.get("t") or 0),
            open=float(d.get("o", d.get("open", 0.0))),
            high=float(d.get("h", d.get("high", 0.0))),
            low=float(d.get("l", d.get("low", 0.0))),
            close=float(d.get("c", d.get("close", 0.0))),
            volume=float(d.get("v", d.get("volume", 0.0))),
        )


Series = list[float | None]


def _f(values: Iterable[float | None]) -> list[float | None]:
    return [None if v is None else float(v) for v in values]


def sma(values: Sequence[float], period: int) -> Series:
    """단순이동평균."""
    out: Series = [None] * len(values)
    if period <= 0:
        return out
    acc = 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= period:
            acc -= values[i - period]
        if i >= period - 1:
            out[i] = acc / period
    return out


def ema(values: Sequence[float], period: int) -> Series:
    """지수이동평균. 첫 값은 SMA 로 시드해 초기 왜곡을 줄입니다."""
    out: Series = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    k = 2.0 / (period + 1.0)
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    prev = seed
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi(values: Sequence[float], period: int = 14) -> Series:
    """와일더 방식 RSI."""
    out: Series = [None] * len(values)
    if len(values) <= period:
        return out
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        gains += max(diff, 0.0)
        losses += max(-diff, 0.0)
    avg_gain = gains / period
    avg_loss = losses / period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(diff, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-diff, 0.0)) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd(
    values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[Series, Series, Series]:
    """MACD 라인 / 시그널 / 히스토그램."""
    fast_line = ema(values, fast)
    slow_line = ema(values, slow)
    line: Series = [
        None if (f is None or s is None) else f - s
        for f, s in zip(fast_line, slow_line)
    ]
    dense = [v for v in line if v is not None]
    sig_dense = ema(dense, signal)
    sig: Series = [None] * len(values)
    offset = len(values) - len(dense)
    for i, v in enumerate(sig_dense):
        sig[offset + i] = v
    hist: Series = [
        None if (l is None or s is None) else l - s for l, s in zip(line, sig)
    ]
    return line, sig, hist


def bollinger(
    values: Sequence[float], period: int = 20, mult: float = 2.0
) -> tuple[Series, Series, Series, Series]:
    """볼린저밴드 (상단, 중심, 하단, 밴드폭%)."""
    mid = sma(values, period)
    upper: Series = [None] * len(values)
    lower: Series = [None] * len(values)
    width: Series = [None] * len(values)
    for i in range(len(values)):
        m = mid[i]
        if m is None:
            continue
        window = values[i - period + 1 : i + 1]
        var = sum((v - m) ** 2 for v in window) / period
        sd = math.sqrt(var)
        upper[i] = m + mult * sd
        lower[i] = m - mult * sd
        width[i] = (upper[i] - lower[i]) / m * 100 if m else None
    return upper, mid, lower, width


def vwap(candles: Sequence[Candle], session_reset: bool = True) -> Series:
    """거래량가중평균가. 단타의 기준선이라 세션(날짜)이 바뀌면 리셋합니다."""
    out: Series = [None] * len(candles)
    pv = 0.0
    vol = 0.0
    day = None
    for i, c in enumerate(candles):
        cur_day = c.ts // 86400
        if session_reset and day is not None and cur_day != day:
            pv = 0.0
            vol = 0.0
        day = cur_day
        pv += c.typical * c.volume
        vol += c.volume
        out[i] = pv / vol if vol > 0 else c.close
    return out


def atr(candles: Sequence[Candle], period: int = 14) -> Series:
    """평균실체범위 — 손절폭을 종목 변동성에 맞추는 데 씁니다."""
    out: Series = [None] * len(candles)
    if len(candles) < 2:
        return out
    trs: list[float] = [candles[0].high - candles[0].low]
    for i in range(1, len(candles)):
        prev_close = candles[i - 1].close
        c = candles[i]
        trs.append(
            max(c.high - c.low, abs(c.high - prev_close), abs(c.low - prev_close))
        )
    smoothed = sma(trs, period)
    for i, v in enumerate(smoothed):
        out[i] = v
    return out


def volume_ratio(candles: Sequence[Candle], period: int = 20) -> Series:
    """직전 period 평균 대비 현재 거래량 배수."""
    vols = [c.volume for c in candles]
    avg = sma(vols, period)
    out: Series = [None] * len(candles)
    for i, a in enumerate(avg):
        if a and a > 0:
            out[i] = vols[i] / a
    return out


def slope(values: Series, lookback: int = 3) -> float | None:
    """최근 lookback 구간의 기울기(단위: 값/봉). 추세 꺾임 감지용."""
    pts = [v for v in values[-(lookback + 1) :] if v is not None]
    if len(pts) < 2:
        return None
    return (pts[-1] - pts[0]) / (len(pts) - 1)


def percentile_rank(values: Series, value: float | None, window: int = 60) -> float | None:
    """최근 window 안에서 value 가 몇 % 지점인지. 볼린저 스퀴즈 판정에 사용."""
    if value is None:
        return None
    pool = [v for v in values[-window:] if v is not None]
    if len(pool) < 5:
        return None
    below = sum(1 for v in pool if v <= value)
    return below / len(pool) * 100.0


@dataclass
class Snapshot:
    """한 시점의 모든 지표를 한 번에 담아 신호 로직으로 넘깁니다."""

    price: float
    ma5: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    ma120: float | None = None
    prev_ma5: float | None = None
    prev_ma20: float | None = None
    rsi: float | None = None
    prev_rsi: float | None = None
    macd: float | None = None
    macd_signal: float | None = None
    macd_hist: float | None = None
    prev_macd_hist: float | None = None
    bb_upper: float | None = None
    bb_mid: float | None = None
    bb_lower: float | None = None
    bb_width: float | None = None
    bb_width_pct: float | None = None
    vwap: float | None = None
    atr: float | None = None
    vol_ratio: float | None = None
    candles: list[Candle] = field(default_factory=list)

    def as_dict(self) -> dict:
        out = {}
        for k, v in self.__dict__.items():
            if k == "candles":
                continue
            out[k] = None if v is None else round(float(v), 4)
        return out


def compute(candles: Sequence[Candle]) -> Snapshot:
    """캔들 시퀀스 → 최신 시점 지표 스냅샷."""
    closes = [c.close for c in candles]
    if not closes:
        return Snapshot(price=0.0)
    ma5, ma20 = sma(closes, 5), sma(closes, 20)
    ma60, ma120 = sma(closes, 60), sma(closes, 120)
    rsi14 = rsi(closes, 14)
    line, sig, hist = macd(closes)
    up, mid, low, width = bollinger(closes, 20, 2.0)
    vw = vwap(candles)
    at = atr(candles, 14)
    vr = volume_ratio(candles, 20)
    i = len(candles) - 1
    j = i - 1 if i > 0 else i
    return Snapshot(
        price=closes[i],
        ma5=ma5[i],
        ma20=ma20[i],
        ma60=ma60[i],
        ma120=ma120[i],
        prev_ma5=ma5[j],
        prev_ma20=ma20[j],
        rsi=rsi14[i],
        prev_rsi=rsi14[j],
        macd=line[i],
        macd_signal=sig[i],
        macd_hist=hist[i],
        prev_macd_hist=hist[j],
        bb_upper=up[i],
        bb_mid=mid[i],
        bb_lower=low[i],
        bb_width=width[i],
        bb_width_pct=percentile_rank(width, width[i], 60),
        vwap=vw[i],
        atr=at[i],
        vol_ratio=vr[i],
        candles=list(candles),
    )
