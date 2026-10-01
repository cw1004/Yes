"""실전 투입 전 go/no-go 점검 — 주문은 단 한 건도 내지 않습니다.

`check` 명령은 "키가 있는가"를 봅니다. 이건 다릅니다.
**"지금 이 계좌로 실제 주문이 나갈 수 있는가"** 를 끝까지 확인합니다.

실전에서 처음 부딪히는 문제는 대부분 전략이 아니라 계좌와 데이터입니다.
- 자산이 작아 1주도 못 삽니다 (브래킷 주문은 소수점 매수 불가)
- 무료 데이터 플랜이라 봉이 15분 지연입니다
- 계좌가 아직 승인 전이거나 입금이 반영되지 않았습니다
- PDT 제한에 이미 걸려 있습니다

여기서 다 잡고 넘어가야 첫 주문에서 당황하지 않습니다.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field

from .. import indicators
from ..indicators import Candle
from ..strategy import RiskConfig, plan_levels, position_size
from ..signals import buy_signal
from .client import AlpacaClient, AlpacaError
from .guards import GuardConfig, TradingGuards

OK, WARN, FAIL = "ok", "warn", "fail"
MARK = {OK: "✅", WARN: "⚠️ ", FAIL: "❌"}


@dataclass
class Check:
    level: str
    title: str
    detail: str = ""
    fix: str = ""

    def render(self) -> str:
        out = f"  {MARK[self.level]} {self.title}"
        if self.detail:
            out += f"\n       {self.detail}"
        if self.fix:
            out += f"\n       → {self.fix}"
        return out


@dataclass
class PreflightReport:
    paper: bool = True
    checks: list[Check] = field(default_factory=list)
    plans: list[dict] = field(default_factory=list)

    def add(self, level: str, title: str, detail: str = "", fix: str = "") -> None:
        self.checks.append(Check(level, title, detail, fix))

    @property
    def failures(self) -> list[Check]:
        return [c for c in self.checks if c.level == FAIL]

    @property
    def warnings(self) -> list[Check]:
        return [c for c in self.checks if c.level == WARN]

    @property
    def go(self) -> bool:
        return not self.failures

    def render(self) -> str:
        bar = "─" * 74
        head = "페이퍼 계좌" if self.paper else "⚠ 실계좌 (진짜 돈)"
        lines = [bar, f"실전 투입 점검 — {head}", bar]
        lines += [c.render() for c in self.checks]

        if self.plans:
            lines += ["", "지금 주문을 낸다면 (실제로는 내지 않습니다)", bar]
            for p in self.plans:
                if p.get("blocked"):
                    lines.append(f"  {p['ticker']:<6} 진입 안 함 — {p['blocked']}")
                    continue
                lines.append(
                    f"  {p['ticker']:<6} {p['qty']}주 × {p['price']:.2f} "
                    f"= {p['notional']:,.0f}$  "
                    f"손절 {p['stop']:.2f}({p['stop_pct']:+.2f}%) "
                    f"목표 {p['target']:.2f}({p['target_pct']:+.2f}%)")
                lines.append(
                    f"         손절 시 손실 {p['risk']:,.2f}$ "
                    f"(자산의 {p['risk_pct']:.2f}%) · 점수 {p['score']:.0f}")

        lines += ["", bar]
        if self.go:
            verdict = "GO — 주문을 낼 수 있는 상태입니다"
            if self.warnings:
                verdict += f" (경고 {len(self.warnings)}건은 읽어보세요)"
        else:
            verdict = f"NO-GO — 먼저 해결할 것 {len(self.failures)}건"
        lines += [verdict, bar]
        return "\n".join(lines)


def _bar_age_min(candles: list[Candle], now: dt.datetime | None = None) -> float:
    if not candles:
        return 1e9
    now = now or dt.datetime.now(dt.timezone.utc)
    return (now.timestamp() - candles[-1].ts) / 60.0


def run(client: AlpacaClient, tickers: list[str], cfg: RiskConfig | None = None,
        guard_cfg: GuardConfig | None = None, feed: str = "iex") -> PreflightReport:
    cfg = cfg or RiskConfig()
    rep = PreflightReport(paper=client.paper)

    if not client.paper:
        rep.add(WARN, "실계좌 모드입니다",
                "여기서 GO 가 나오면 다음 실행부터 진짜 돈으로 주문이 나갑니다.",
                "페이퍼로 최소 2주 검증하지 않았다면 지금 멈추세요.")

    # ── 1. 계좌 ──
    acct = None
    try:
        acct = client.account()
    except AlpacaError as e:
        rep.add(FAIL, "계좌 연결 실패", str(e),
                "API 키가 맞는지, 페이퍼/실계좌 키를 섞어 쓰지 않았는지 확인하세요. "
                "페이퍼 키는 실계좌에서 동작하지 않습니다.")
        return rep

    if acct.status != "ACTIVE":
        rep.add(FAIL, f"계좌 상태가 ACTIVE 가 아닙니다 ({acct.status})", "",
                "Alpaca 대시보드에서 계좌 승인·서류 절차가 끝났는지 확인하세요.")
    elif acct.account_blocked or acct.trading_blocked:
        rep.add(FAIL, "계좌가 거래 정지 상태입니다",
                f"account_blocked={acct.account_blocked}, "
                f"trading_blocked={acct.trading_blocked}",
                "Alpaca 고객지원에 문의해야 합니다.")
    else:
        rep.add(OK, "계좌 연결",
                f"자산 {acct.equity:,.2f} {acct.currency} · "
                f"현금 {acct.cash:,.2f} · 매수여력 {acct.buying_power:,.2f}")

    if acct.equity <= 0:
        rep.add(FAIL, "자산이 0 입니다", "",
                "입금이 반영되었는지 확인하세요. 페이퍼 계좌는 보통 10만 달러로 시작합니다.")

    # ── 2. PDT ──
    if acct.equity < 25_000:
        left = max(0, 3 - acct.daytrade_count)
        level = FAIL if acct.pdt_restricted else WARN
        rep.add(level,
                f"PDT 규정 대상 (자산 {acct.equity:,.0f} < 25,000)",
                f"5영업일 중 당일매매 {acct.daytrade_count}회 사용 · 남은 횟수 {left}회",
                "단타는 하루에도 여러 번 사고팝니다. 이 계좌로는 주 3회가 한계입니다. "
                "자산을 2.5만 달러 이상으로 올리거나, 보유 기간을 하루 이상으로 늘리세요.")
    else:
        rep.add(OK, "PDT 제한 없음", f"자산 {acct.equity:,.0f} ≥ 25,000")

    # ── 3. 시장 시간 ──
    try:
        clock = client.clock()
        if clock.is_open:
            rep.add(OK, "정규장 열려 있음", f"마감 {clock.next_close}")
        else:
            rep.add(WARN, "장이 닫혀 있습니다", f"다음 개장 {clock.next_open}",
                    "장이 열린 뒤 다시 점검하면 데이터 신선도까지 정확히 확인됩니다.")
    except AlpacaError as e:
        rep.add(FAIL, "시장 시간 조회 실패", str(e))

    # ── 4. 안전장치 ──
    guards = TradingGuards(guard_cfg or GuardConfig())
    if guards.halted():
        rep.add(FAIL, "킬 스위치가 켜져 있습니다", str(guards.halt_path),
                f"해제하려면: rm {guards.halt_path}")
    else:
        rep.add(OK, "킬 스위치 해제됨", f"정지 방법: touch {guards.halt_path}")

    # ── 5. 종목별 데이터 + 주문 시뮬레이션 ──
    for ticker in tickers:
        ticker = ticker.upper()
        try:
            rows = client.bars(ticker, "5Min", 200, feed=feed)
        except AlpacaError as e:
            rep.add(FAIL, f"{ticker} 봉 데이터 조회 실패", str(e),
                    "데이터 구독 플랜을 확인하세요. 무료 플랜은 feed=iex 만 됩니다.")
            rep.plans.append({"ticker": ticker, "blocked": "데이터 없음"})
            continue

        candles = [Candle(ts=_epoch(b.get("t", "")), open=float(b.get("o", 0)),
                          high=float(b.get("h", 0)), low=float(b.get("l", 0)),
                          close=float(b.get("c", 0)), volume=float(b.get("v", 0)))
                   for b in rows]

        if len(candles) < 30:
            rep.add(FAIL, f"{ticker} 봉이 {len(candles)}개뿐입니다",
                    "지표 계산에 최소 30개가 필요합니다.",
                    "장 시작 직후이거나 데이터 플랜 제한일 수 있습니다.")
            rep.plans.append({"ticker": ticker, "blocked": "봉 부족"})
            continue

        age = _bar_age_min(candles)
        if age > 20:
            rep.add(WARN, f"{ticker} 최신 봉이 {age:.0f}분 전입니다",
                    f"{feed.upper()} 피드 · 봉 {len(candles)}개",
                    "장중인데도 지연이 크면 무료 IEX 피드의 한계입니다. "
                    "단타에는 유료 SIP 피드가 사실상 필요합니다.")
        else:
            rep.add(OK, f"{ticker} 데이터 정상",
                    f"봉 {len(candles)}개 · 최신 {age:.1f}분 전 · {feed.upper()} 피드")

        try:
            price = client.latest_price(ticker)
        except AlpacaError:
            price = 0.0
        if price <= 0:
            price = candles[-1].close
            rep.add(WARN, f"{ticker} 실시간 가격을 못 받았습니다",
                    f"봉 종가 {price:.2f} 로 대체합니다.",
                    "실시간 체결가 없이는 손절 판단이 최대 5분 늦습니다.")

        snap = indicators.compute(candles)
        snap.price = price
        sig = buy_signal(snap, min_score=0)
        stop, target = plan_levels(snap, cfg, sig.score, None, None)
        qty_raw = position_size(price, stop, cfg, None)
        shares = int(math.floor(qty_raw))

        if shares < 1:
            # 1주를 사려면 자산이 얼마나 있어야 하는지 역산해 알려줍니다.
            per_share_risk = max(price - stop, price * 0.002)
            need_risk = per_share_risk / cfg.risk_per_trade
            need_cap = price / cfg.max_position_pct
            need = max(need_risk, need_cap)
            rep.add(FAIL, f"{ticker} 1주도 살 수 없습니다",
                    f"산정 수량 {qty_raw:.3f}주 (가격 {price:.2f}, "
                    f"리스크 {cfg.risk_per_trade*100:.2f}%, 최대비중 "
                    f"{cfg.max_position_pct*100:.0f}%)",
                    f"이 종목은 자산 약 {need:,.0f}$ 이상이어야 1주가 나옵니다. "
                    f"더 싼 종목을 쓰거나 --risk-per-trade 를 올리세요. "
                    f"(브래킷 주문은 소수점 매수를 지원하지 않습니다)")
            rep.plans.append({"ticker": ticker, "blocked": "1주 미만"})
            continue

        notional = shares * price
        risk_cash = shares * (price - stop)
        if notional > acct.buying_power:
            rep.add(FAIL, f"{ticker} 매수여력 부족",
                    f"필요 {notional:,.0f}$ > 여력 {acct.buying_power:,.0f}$",
                    "입금하거나 --risk-per-trade / --max-positions 를 낮추세요.")
            rep.plans.append({"ticker": ticker, "blocked": "매수여력 부족"})
            continue

        rep.plans.append({
            "ticker": ticker, "qty": shares, "price": price, "notional": notional,
            "stop": stop, "stop_pct": (stop / price - 1) * 100,
            "target": target, "target_pct": (target / price - 1) * 100,
            "risk": risk_cash,
            "risk_pct": risk_cash / acct.equity * 100 if acct.equity else 0.0,
            "score": sig.score,
        })

    # ── 6. 리스크 설정 요약 ──
    worst = sum(p.get("risk", 0.0) for p in rep.plans if not p.get("blocked"))
    if worst and acct.equity:
        pct = worst / acct.equity * 100
        level = WARN if pct > cfg.daily_loss_limit_pct * 100 else OK
        rep.add(level, f"동시 보유 시 최대 손실 {worst:,.2f}$ ({pct:.2f}%)",
                f"일일 손실 한도는 {cfg.daily_loss_limit_pct*100:.1f}% 입니다.",
                "한도를 넘으면 --risk-per-trade 를 낮추세요." if level == WARN else "")

    return rep


def _epoch(text: str) -> int:
    try:
        return int(dt.datetime.fromisoformat(
            (text or "").replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0
