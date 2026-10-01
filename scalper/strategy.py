"""기술 신호 × 뉴스 팩트 × 세계 정세를 하나의 매매 판단으로 합칩니다.

기본 철학
- 기술적 신호가 방아쇠, 뉴스와 매크로는 '얼마나 크게, 얼마나 길게' 를 정합니다.
- 나쁜 환경에서는 진입 문턱을 올리고 사이즈를 줄입니다. 좋은 환경에서도
  문턱을 크게 낮추지는 않습니다 (손실 방어가 수익 극대화의 전제).
- 손절은 항상 계산되고, 손절 없는 진입은 만들지 않습니다.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .indicators import Snapshot
from .macro import MacroPulse
from .news import NewsPulse
from .signals import Signal, buy_signal, sell_signal


@dataclass
class RiskConfig:
    """계좌 리스크 규칙. 전부 '한 번의 실수로 안 죽는' 쪽으로 기본값을 잡았습니다."""

    equity: float = 10_000.0
    risk_per_trade: float = 0.005      # 1회 매매당 계좌의 0.5% 만 잃도록
    max_position_pct: float = 0.25     # 한 종목 최대 비중
    max_positions: int = 3
    stop_pct: float = 0.017            # 기본 손절 -1.7%
    hard_stop_pct: float = 0.02        # 긴급 손절 -2.0%
    target_min_pct: float = 0.008      # 목표 +0.8%
    target_max_pct: float = 0.032      # 목표 +3.2%
    time_stop_min: int = 30            # 30분 안에 안 가면 자리를 비웁니다
    time_stop_min_pnl: float = 0.3     # 단, 이만큼 이익 중이면 시간청산 유예
    trail_start_pct: float = 0.5       # 이익이 이만큼 나면 손절선을 끌어올림
    trail_give_back: float = 0.45      # 고점 대비 손절폭의 몇 배까지 되돌림 허용
    buy_threshold: float = 65.0
    sell_threshold: float = 50.0
    rsi_exit: float = 78.0
    daily_loss_limit_pct: float = 0.03  # 하루 -3% 도달 시 그날 매매 중단
    news_veto: float = -55.0           # 이보다 나쁜 뉴스면 신규 진입 금지
    max_geo_risk: float = 75.0         # 지정학 리스크가 이 이상이면 신규 진입 금지
    reentry_cooldown_sec: int = 180    # 청산 후 재진입 금지 시간 (과매매 방지)
    min_hold_sec: int = 60             # 손절 외 청산은 최소 보유 후에만
    fee_bps: float = 1.0               # 왕복 수수료+슬리피지 (bp). 단타는 이게 성패

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class Position:
    """보유 중인 한 포지션."""

    ticker: str
    qty: float
    entry: float
    stop: float
    target: float
    opened_at: int
    reasons: list[str] = field(default_factory=list)
    peak: float = 0.0

    def pnl_pct(self, price: float) -> float:
        return (price - self.entry) / self.entry * 100 if self.entry else 0.0

    def pnl_cash(self, price: float) -> float:
        return (price - self.entry) * self.qty

    def held_min(self, now: int | None = None) -> float:
        return ((now or int(time.time())) - self.opened_at) / 60.0

    def as_dict(self, price: float | None = None, now: int | None = None) -> dict:
        p = price if price is not None else self.entry
        return {
            "ticker": self.ticker,
            "qty": round(self.qty, 4),
            "entry": round(self.entry, 4),
            "stop": round(self.stop, 4),
            "target": round(self.target, 4),
            "opened_at": self.opened_at,
            "reasons": self.reasons,
            "price": round(p, 4),
            "pnl_pct": round(self.pnl_pct(p), 3),
            "pnl_cash": round(self.pnl_cash(p), 2),
            "held_min": round(self.held_min(now), 1),
        }


@dataclass
class Decision:
    """엔진이 실제로 실행할 한 줄짜리 지시."""

    action: str                      # BUY / SELL / HOLD
    ticker: str = ""
    score: float = 0.0
    qty: float = 0.0
    price: float = 0.0
    stop: float = 0.0
    target: float = 0.0
    reasons: list[str] = field(default_factory=list)
    blocked_by: str = ""
    tech: float = 0.0
    news: float = 0.0
    macro: float = 0.0

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "ticker": self.ticker,
            "score": round(self.score, 1),
            "qty": round(self.qty, 4),
            "price": round(self.price, 4),
            "stop": round(self.stop, 4),
            "target": round(self.target, 4),
            "reasons": self.reasons,
            "blocked_by": self.blocked_by,
            "components": {
                "tech": round(self.tech, 1),
                "news": round(self.news, 1),
                "macro": round(self.macro, 1),
            },
        }


def combined_score(tech: Signal, news: NewsPulse | None, macro: MacroPulse | None) -> float:
    """기술 점수에 뉴스·매크로 보정을 더한 최종 점수 (0~100).

    뉴스는 ±12점, 매크로는 ±8점까지만 움직입니다. 배경 정보가 기술적 신호를
    통째로 뒤엎지 않게 하되, 경계선에 있는 판단은 확실히 갈리게 하는 폭입니다.
    """
    score = tech.score
    if news and news.count:
        score += max(-12.0, min(12.0, news.score * 0.12))
    if macro:
        score += max(-8.0, min(8.0, macro.score * 0.08))
    return max(0.0, min(100.0, score))


def plan_levels(snap: Snapshot, cfg: RiskConfig, score: float,
                macro: MacroPulse | None, news: NewsPulse | None) -> tuple[float, float]:
    """손절가·목표가 계산.

    손절은 고정 %와 ATR 기반 중 '더 타이트한' 쪽을 쓰되 최소폭을 보장합니다.
    목표는 점수·변동성·환경이 좋을수록 위쪽 끝(+3.2%)으로 늘립니다.
    """
    price = snap.price
    atr_pct = (snap.atr / price * 100) if (snap.atr and price) else None

    stop_pct = cfg.stop_pct * 100
    if atr_pct:
        stop_pct = max(0.6, min(cfg.hard_stop_pct * 100, max(atr_pct * 1.1, 0.6)))
        stop_pct = min(stop_pct, cfg.stop_pct * 100)
    stop = price * (1 - stop_pct / 100)

    # VWAP 바로 아래를 손절로 쓰면 더 자연스러운 자리 (단, 한도 안에서만)
    if snap.vwap and snap.vwap < price:
        vwap_stop = snap.vwap * 0.999
        if vwap_stop > price * (1 - cfg.hard_stop_pct):
            stop = max(stop, vwap_stop)

    span = cfg.target_max_pct - cfg.target_min_pct
    quality = max(0.0, min(1.0, (score - cfg.buy_threshold) / 30.0))
    vol_boost = min(1.0, (atr_pct / 1.2)) if atr_pct else 0.5
    env = 0.5
    if macro:
        env = max(0.0, min(1.0, 0.5 + macro.score / 200.0))
    if news and news.count and news.score > 30:
        env = min(1.0, env + 0.2)
    target_pct = cfg.target_min_pct + span * (0.45 * quality + 0.35 * vol_boost + 0.20 * env)
    target = price * (1 + target_pct)
    return stop, target


def position_size(price: float, stop: float, cfg: RiskConfig,
                  macro: MacroPulse | None) -> float:
    """리스크 기준 수량 산정 — '손절까지 갔을 때 잃는 돈'을 고정합니다."""
    risk_per_share = max(price - stop, price * 0.002)
    budget = cfg.equity * cfg.risk_per_trade
    qty = budget / risk_per_share
    if macro:
        qty *= macro.size_multiplier
    cap = cfg.equity * cfg.max_position_pct / price if price else 0
    return max(0.0, min(qty, cap))


def decide_entry(ticker: str, snap: Snapshot, news: NewsPulse | None,
                 macro: MacroPulse | None, cfg: RiskConfig,
                 open_positions: int = 0, day_pnl_pct: float = 0.0,
                 cooldown_left: float = 0.0) -> Decision:
    """신규 진입 판단."""
    tech = buy_signal(snap, min_score=0)          # 점수만 받고 문턱은 여기서 적용
    threshold = cfg.buy_threshold + (macro.entry_bias if macro else 0.0)
    score = combined_score(tech, news, macro)

    d = Decision(action="HOLD", ticker=ticker, score=score, price=snap.price,
                 tech=tech.score,
                 news=news.score if news else 0.0,
                 macro=macro.score if macro else 0.0,
                 reasons=list(tech.tags))

    # ── 진입 차단 조건 (수익 극대화보다 생존이 먼저) ──
    if day_pnl_pct <= -cfg.daily_loss_limit_pct * 100:
        d.blocked_by = f"일일 손실 한도 {cfg.daily_loss_limit_pct*100:.1f}% 도달"
        return d
    if open_positions >= cfg.max_positions:
        d.blocked_by = f"최대 {cfg.max_positions}포지션 보유 중"
        return d
    if cooldown_left > 0:
        d.blocked_by = f"재진입 쿨다운 {cooldown_left:.0f}초 남음"
        return d
    if news and news.count and news.score <= cfg.news_veto:
        d.blocked_by = f"악재 뉴스 차단 ({news.label})"
        return d
    if macro and macro.geo_risk >= cfg.max_geo_risk:
        d.blocked_by = f"지정학 리스크 {macro.geo_risk:.0f} 초과"
        return d
    if not tech.trend_up:
        d.blocked_by = "상승추세 아님 (MA5 < MA20)"
        return d
    sell = sell_signal(snap, min_score=0)
    if sell.score >= cfg.sell_threshold:
        d.blocked_by = f"매도 압력 {sell.score:.0f}점"
        return d
    if score < threshold:
        d.blocked_by = f"점수 {score:.0f} < 문턱 {threshold:.0f}"
        return d

    stop, target = plan_levels(snap, cfg, score, macro, news)
    edge_pct = (target - snap.price) / snap.price * 100 if snap.price else 0.0
    cost_pct = cfg.fee_bps / 100.0 * 2
    if edge_pct < cost_pct * 3:
        d.blocked_by = f"기대수익 {edge_pct:.2f}% < 비용 {cost_pct:.2f}%의 3배"
        return d
    qty = position_size(snap.price, stop, cfg, macro)
    if qty <= 0:
        d.blocked_by = "산정 수량 0"
        return d

    reasons = list(tech.tags)
    if news and news.count:
        reasons.append(f"뉴스 {news.label}({news.score:+.0f})")
        reasons.extend(news.events[:2])
    if macro:
        reasons.append(f"매크로 {macro.label}({macro.score:+.0f})")

    d.action = "BUY"
    d.qty = qty
    d.stop = stop
    d.target = target
    d.reasons = reasons
    return d


def decide_exit(pos: Position, snap: Snapshot, news: NewsPulse | None,
                macro: MacroPulse | None, cfg: RiskConfig,
                now: int | None = None) -> Decision:
    """청산 판단. 조건은 위험한 순서대로 검사합니다."""
    price = snap.price
    now = now or int(time.time())
    d = Decision(action="HOLD", ticker=pos.ticker, price=price,
                 qty=pos.qty, stop=pos.stop, target=pos.target)
    pnl = pos.pnl_pct(price)

    if pnl <= -cfg.hard_stop_pct * 100:
        d.action, d.reasons = "SELL", [f"긴급 손절 {pnl:.2f}%"]
        return d
    if price <= pos.stop:
        d.action, d.reasons = "SELL", [f"손절 터치 {pnl:.2f}%"]
        return d
    if price >= pos.target:
        d.action, d.reasons = "SELL", [f"목표 도달 {pnl:.2f}%"]
        return d
    # 손절/긴급 이외의 청산은 최소 보유시간을 채운 뒤에만 — 진입 직후 흔들림에
    # 바로 털리면 수수료만 나갑니다.
    if pos.held_min(now) * 60 < cfg.min_hold_sec:
        return d

    if snap.rsi is not None and snap.rsi >= cfg.rsi_exit:
        d.action, d.reasons = "SELL", [f"RSI {snap.rsi:.0f} 과매수"]
        return d
    # 시간청산 — 이익이 나고 있으면 한 번 유예하고 트레일링에 맡깁니다.
    # 잘 가는 트레이드를 시계 때문에 자르면 손익비가 무너집니다.
    held = pos.held_min(now)
    if held >= cfg.time_stop_min:
        if pnl < cfg.time_stop_min_pnl or held >= cfg.time_stop_min * 2:
            d.action, d.reasons = "SELL", [f"시간청산 {held:.0f}분 경과 ({pnl:+.2f}%)"]
            return d
    if news and news.count and news.score <= cfg.news_veto:
        d.action, d.reasons = "SELL", [f"악재 발생 청산 ({news.label})"]
        return d
    if macro and macro.geo_risk >= cfg.max_geo_risk and pnl > 0:
        d.action, d.reasons = "SELL", [f"지정학 리스크 {macro.geo_risk:.0f} — 이익 확정"]
        return d

    sell = sell_signal(snap, min_score=cfg.sell_threshold)
    if sell.side == "SELL":
        d.action, d.reasons = "SELL", [f"매도신호 {sell.score:.0f}점"] + sell.tags
        d.score = sell.score
        return d

    # 트레일링 — 이익이 trail_start_pct 를 넘으면 고점을 따라 손절선을 올립니다.
    # 여기서 peak 를 갱신해 두면 백테스트와 실시간 엔진이 같은 규칙을 씁니다.
    pos.peak = max(pos.peak or pos.entry, price)
    if pnl >= cfg.trail_start_pct:
        trail = max(
            pos.entry * 1.0005,                                  # 최소한 본전
            pos.peak * (1 - cfg.stop_pct * cfg.trail_give_back),  # 고점 되돌림 허용폭
        )
        if trail > pos.stop:
            pos.stop = trail
            d.reasons = [f"손절선 상향 {trail:.2f} (고점 {pos.peak:.2f})"]
            d.stop = trail
    return d
