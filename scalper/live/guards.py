"""실전 안전장치 — 주문이 나가기 전에 통과해야 하는 관문들.

전략이 아무리 좋아도 여기서 막히면 주문은 나가지 않습니다.
"가장 확실한 수익 개선은 하지 말아야 할 매매를 안 하는 것"이라는 원칙을 코드로 옮긴 것.
"""

from __future__ import annotations

import datetime as dt
import os
import pathlib
from dataclasses import dataclass, field

from .client import Account, AlpacaClient, AlpacaError, Clock


@dataclass
class GuardConfig:
    """전부 보수적인 기본값입니다."""

    allow_extended_hours: bool = False   # 프리/애프터는 스프레드가 넓어 단타에 불리
    open_buffer_min: int = 5             # 개장 직후 변동성 구간은 신규 진입 회피
    close_buffer_min: int = 15           # 마감 전에는 신규 진입 금지 (청산은 허용)
    respect_pdt: bool = True             # 계좌 2.5만 미만이면 데이트레이딩 횟수 제한
    daily_loss_limit_pct: float = 3.0    # 당일 -3% 도달 시 그날 신규 진입 중단
    max_position_notional: float = 0.0   # 0 이면 무제한. 실수 방지용 절대 상한
    min_equity: float = 0.0              # 이 아래로 내려가면 신규 진입 중단
    halt_file: str = ".scalper_halt"     # 이 파일이 생기면 즉시 정지 (킬 스위치)


@dataclass
class GuardResult:
    """왜 막혔는지가 남아야 나중에 로직을 고칠 수 있습니다."""

    can_enter: bool
    can_exit: bool = True
    reasons: list[str] = field(default_factory=list)
    halted: bool = False

    @property
    def reason(self) -> str:
        return " / ".join(self.reasons) if self.reasons else ""

    def as_dict(self) -> dict:
        return {"can_enter": self.can_enter, "can_exit": self.can_exit,
                "halted": self.halted, "reasons": self.reasons}


def _parse_iso(text: str) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat((text or "").replace("Z", "+00:00"))
    except ValueError:
        return None


class TradingGuards:
    """매 틱마다 evaluate() 를 부르고, 결과에 따라 진입/청산을 결정합니다."""

    def __init__(self, cfg: GuardConfig | None = None, work_dir: str = "."):
        self.cfg = cfg or GuardConfig()
        self.work_dir = pathlib.Path(work_dir)

    # ── 킬 스위치 ──
    @property
    def halt_path(self) -> pathlib.Path:
        return self.work_dir / self.cfg.halt_file

    def halted(self) -> bool:
        """파일 하나로 즉시 멈출 수 있어야 합니다. 자리를 비운 사이 뭔가 잘못됐을 때."""
        return self.halt_path.exists() or os.environ.get("SCALPER_HALT") == "1"

    def halt(self, reason: str = "manual") -> None:
        self.halt_path.write_text(f"{dt.datetime.now(dt.timezone.utc).isoformat()} {reason}\n",
                                  encoding="utf-8")

    def clear_halt(self) -> None:
        self.halt_path.unlink(missing_ok=True)

    # ── 판정 ──
    def evaluate(self, client: AlpacaClient, day_pnl_pct: float = 0.0,
                 now: dt.datetime | None = None) -> GuardResult:
        reasons: list[str] = []
        now = now or dt.datetime.now(dt.timezone.utc)

        if self.halted():
            return GuardResult(can_enter=False, can_exit=True, halted=True,
                               reasons=[f"킬 스위치 작동 ({self.halt_path})"])

        # 계좌 상태
        try:
            acct = client.account()
        except AlpacaError as e:
            # 계좌를 못 읽으면 아무것도 하지 않습니다. 모르는 상태로 주문하지 않기.
            return GuardResult(can_enter=False, can_exit=False,
                               reasons=[f"계좌 조회 실패: {e}"])

        if acct.account_blocked or acct.trading_blocked:
            return GuardResult(can_enter=False, can_exit=False,
                               reasons=[f"계좌 거래 정지 상태 ({acct.status})"])

        if self.cfg.min_equity and acct.equity < self.cfg.min_equity:
            reasons.append(f"자산 {acct.equity:,.0f} < 하한 {self.cfg.min_equity:,.0f}")

        if self.cfg.respect_pdt and acct.pdt_restricted:
            reasons.append(f"PDT 제한 (자산 {acct.equity:,.0f} < 25,000, "
                           f"당일매매 {acct.daytrade_count}회)")

        if day_pnl_pct <= -abs(self.cfg.daily_loss_limit_pct):
            reasons.append(f"일일 손실 한도 {self.cfg.daily_loss_limit_pct:.1f}% 도달 "
                           f"({day_pnl_pct:+.2f}%)")

        # 시장 시간
        try:
            clock = client.clock()
        except AlpacaError as e:
            return GuardResult(can_enter=False, can_exit=False,
                               reasons=[f"시장 시간 조회 실패: {e}"])

        window = self._session_window(clock, now)
        reasons.extend(window)

        can_enter = not reasons
        # 청산은 장중이기만 하면 허용합니다. 손절은 어떤 이유로도 막지 않습니다.
        can_exit = clock.is_open or self.cfg.allow_extended_hours
        return GuardResult(can_enter=can_enter, can_exit=can_exit, reasons=reasons)

    def _session_window(self, clock: Clock, now: dt.datetime) -> list[str]:
        """개장 직후·마감 직전 완충 구간을 신규 진입에서 제외합니다."""
        out: list[str] = []
        if not clock.is_open:
            if not self.cfg.allow_extended_hours:
                nxt = clock.next_open or "?"
                return [f"장 마감 (다음 개장 {nxt})"]
            return []

        close_at = _parse_iso(clock.next_close)
        if close_at is not None:
            to_close = (close_at - now).total_seconds() / 60.0
            if to_close <= self.cfg.close_buffer_min:
                out.append(f"마감 {to_close:.0f}분 전 — 신규 진입 중단")

            # 정규장은 6.5시간. 남은 시간으로 개장 후 경과를 역산합니다.
            since_open = 390 - to_close
            if 0 <= since_open < self.cfg.open_buffer_min:
                out.append(f"개장 {since_open:.0f}분 경과 — 변동성 구간 회피")
        return out
