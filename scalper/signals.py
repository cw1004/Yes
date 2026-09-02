"""8가지 단타 로직 점수화 — 매수/매도 신호와 "왜" 태그를 함께 만듭니다.

점수는 항상 0~100 으로 정규화되고, 각 로직이 몇 점을 줬는지 breakdown 에
남습니다. 로그에 "왜 샀는지"가 찍혀야 나중에 로직을 고칠 수 있습니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .indicators import Candle, Snapshot


# ── 매수 로직 가중치 (합 100) ────────────────────────────────────────────
BUY_WEIGHTS = {
    "vwap": 18,        # VWAP 위 안착
    "trend": 16,       # MA5 > MA20 정배열
    "golden": 12,      # 골든크로스 직후
    "volume": 16,      # 거래량 급증
    "rsi": 14,         # RSI 모멘텀 구간
    "squeeze": 8,      # 볼린저 스퀴즈 후 확장
    "macd": 10,        # MACD 상승전환
    "reversal": 6,     # 음봉 뒤 양봉 반전
}

# ── 매도 로직 가중치 (합 100) ────────────────────────────────────────────
SELL_WEIGHTS = {
    "overbought": 30,  # RSI 과매수
    "ma_break": 25,    # MA5 이탈
    "peak": 20,        # 고점 꺾임
    "dist_vol": 15,    # 음봉 + 거래량 동반
    "macd_turn": 10,   # MACD 하락전환
}


@dataclass
class Signal:
    """한 시점의 신호 판정 결과."""

    side: str                      # BUY / SELL / HOLD
    score: float                   # 0~100
    tags: list[str] = field(default_factory=list)
    breakdown: dict[str, float] = field(default_factory=dict)
    trend_up: bool = False
    price: float = 0.0

    def as_dict(self) -> dict:
        return {
            "side": self.side,
            "score": round(self.score, 1),
            "tags": self.tags,
            "breakdown": {k: round(v, 1) for k, v in self.breakdown.items()},
            "trend_up": self.trend_up,
            "price": round(self.price, 4),
        }


def _golden_cross_bars_ago(candles: Sequence[Candle], lookback: int = 6) -> int | None:
    """MA5 가 MA20 을 상향 돌파한 지 몇 봉 지났는지. 없으면 None."""
    from .indicators import sma

    closes = [c.close for c in candles]
    if len(closes) < 25:
        return None
    m5, m20 = sma(closes, 5), sma(closes, 20)
    n = len(closes)
    for back in range(0, min(lookback, n - 1)):
        i = n - 1 - back
        a5, a20, b5, b20 = m5[i], m20[i], m5[i - 1], m20[i - 1]
        if None in (a5, a20, b5, b20):
            continue
        if b5 <= b20 and a5 > a20:
            return back
    return None


def buy_signal(snap: Snapshot, min_score: float = 65.0) -> Signal:
    """8가지 로직으로 매수 점수를 매깁니다."""
    s: dict[str, float] = {}
    tags: list[str] = []
    c = snap.candles
    price = snap.price

    # 1) VWAP 안착 — 위에 있으면 만점, 살짝 아래면 부분점
    if snap.vwap:
        gap = (price - snap.vwap) / snap.vwap * 100
        if gap >= 0.05:
            s["vwap"] = BUY_WEIGHTS["vwap"] * min(1.0, 0.6 + gap / 0.6 * 0.4)
            tags.append("VWAP 안착")
        elif gap > -0.15:
            s["vwap"] = BUY_WEIGHTS["vwap"] * 0.35
        else:
            s["vwap"] = 0.0

    # 2) 정배열 — MA5 > MA20 이고 MA20 도 우상향이면 가점
    if snap.ma5 and snap.ma20:
        if snap.ma5 > snap.ma20:
            base = 0.75
            if snap.prev_ma20 and snap.ma20 > snap.prev_ma20:
                base = 1.0
            if snap.ma60 and snap.ma20 > snap.ma60:
                base = min(1.0, base + 0.15)
            s["trend"] = BUY_WEIGHTS["trend"] * base
            tags.append("정배열")
        else:
            s["trend"] = 0.0

    # 3) 골든크로스 직후 — 갓 터진 크로스일수록 높게
    back = _golden_cross_bars_ago(c)
    if back is not None:
        s["golden"] = BUY_WEIGHTS["golden"] * max(0.3, 1.0 - back * 0.15)
        tags.append(f"골든크로스 {back}봉 전" if back else "골든크로스 발생")

    # 4) 거래량 급증
    vr = snap.vol_ratio
    if vr:
        if vr >= 1.6:
            s["volume"] = BUY_WEIGHTS["volume"]
            tags.append(f"거래량 {vr:.1f}배")
        elif vr >= 1.4:
            s["volume"] = BUY_WEIGHTS["volume"] * 0.75
            tags.append(f"거래량 {vr:.1f}배")
        elif vr >= 1.15:
            s["volume"] = BUY_WEIGHTS["volume"] * 0.4
        else:
            s["volume"] = 0.0

    # 5) RSI 모멘텀 — 45~72 가 건강, 72 위는 추격 금지
    r = snap.rsi
    if r is not None:
        if 55 <= r <= 72:
            s["rsi"] = BUY_WEIGHTS["rsi"]
            tags.append(f"RSI {r:.0f}")
        elif 45 <= r < 55:
            s["rsi"] = BUY_WEIGHTS["rsi"] * 0.6
            tags.append(f"RSI {r:.0f}")
        elif 72 < r <= 78:
            s["rsi"] = BUY_WEIGHTS["rsi"] * 0.25
        else:
            s["rsi"] = 0.0
        # 모멘텀 방향 가점
        if snap.prev_rsi is not None and r > snap.prev_rsi and 45 <= r <= 72:
            s["rsi"] = min(BUY_WEIGHTS["rsi"], s["rsi"] + 2)

    # 6) 볼린저 스퀴즈 — 밴드폭이 하위 30% 이고 상단을 밀어올리는 중
    if snap.bb_width_pct is not None and snap.bb_upper and snap.bb_mid:
        if snap.bb_width_pct <= 30 and price > snap.bb_mid:
            s["squeeze"] = BUY_WEIGHTS["squeeze"]
            tags.append("볼린저 스퀴즈")
        elif snap.bb_width_pct <= 45 and price > snap.bb_mid:
            s["squeeze"] = BUY_WEIGHTS["squeeze"] * 0.5
        else:
            s["squeeze"] = 0.0

    # 7) MACD 상승전환 — 히스토그램이 마이너스→플러스 또는 확대
    if snap.macd_hist is not None and snap.prev_macd_hist is not None:
        if snap.prev_macd_hist <= 0 < snap.macd_hist:
            s["macd"] = BUY_WEIGHTS["macd"]
            tags.append("MACD 상승전환")
        elif snap.macd_hist > snap.prev_macd_hist > 0:
            s["macd"] = BUY_WEIGHTS["macd"] * 0.6
        else:
            s["macd"] = 0.0

    # 8) 음봉 뒤 양봉 반전
    if len(c) >= 2 and not c[-2].is_bull and c[-1].is_bull:
        if c[-1].close > c[-2].open:
            s["reversal"] = BUY_WEIGHTS["reversal"]
            tags.append("음봉 후 반전")
        else:
            s["reversal"] = BUY_WEIGHTS["reversal"] * 0.5

    score = sum(s.values())
    trend_up = bool(snap.ma5 and snap.ma20 and snap.ma5 > snap.ma20)
    side = "BUY" if score >= min_score and trend_up else "HOLD"
    return Signal(side=side, score=score, tags=tags, breakdown=s,
                  trend_up=trend_up, price=price)


def sell_signal(snap: Snapshot, min_score: float = 50.0) -> Signal:
    """청산 압력 점수. 보유 중이 아니어도 '지금은 사지 마라' 신호로 쓸 수 있습니다."""
    s: dict[str, float] = {}
    tags: list[str] = []
    c = snap.candles
    price = snap.price

    r = snap.rsi
    if r is not None:
        if r >= 78:
            s["overbought"] = SELL_WEIGHTS["overbought"]
            tags.append(f"RSI {r:.0f} 과열")
        elif r >= 75:
            s["overbought"] = SELL_WEIGHTS["overbought"] * 0.8
            tags.append(f"RSI {r:.0f}")
        elif r >= 72:
            s["overbought"] = SELL_WEIGHTS["overbought"] * 0.4
        else:
            s["overbought"] = 0.0

    if snap.ma5 and price < snap.ma5:
        drop = (snap.ma5 - price) / snap.ma5 * 100
        s["ma_break"] = SELL_WEIGHTS["ma_break"] * min(1.0, 0.5 + drop / 0.4 * 0.5)
        tags.append("MA5 이탈")

    # 고점 꺾임 — 최근 5봉 고점 대비 되밀림
    if len(c) >= 5:
        recent_high = max(x.high for x in c[-5:])
        if recent_high > 0:
            pull = (recent_high - price) / recent_high * 100
            if pull >= 0.6:
                s["peak"] = SELL_WEIGHTS["peak"]
                tags.append("고점 꺾임")
            elif pull >= 0.3:
                s["peak"] = SELL_WEIGHTS["peak"] * 0.5

    # 음봉 + 거래량 동반 (분산 매물)
    if c and not c[-1].is_bull and snap.vol_ratio and snap.vol_ratio >= 1.3:
        s["dist_vol"] = SELL_WEIGHTS["dist_vol"]
        tags.append(f"음봉 거래량 {snap.vol_ratio:.1f}배")

    if snap.macd_hist is not None and snap.prev_macd_hist is not None:
        if snap.prev_macd_hist >= 0 > snap.macd_hist:
            s["macd_turn"] = SELL_WEIGHTS["macd_turn"]
            tags.append("MACD 하락전환")

    score = sum(s.values())
    side = "SELL" if score >= min_score else "HOLD"
    return Signal(side=side, score=score, tags=tags, breakdown=s,
                  trend_up=bool(snap.ma5 and snap.ma20 and snap.ma5 > snap.ma20),
                  price=price)
