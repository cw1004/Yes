"""매매 엔진.

전략 신호 → 리스크 검증 → 주문 전송 → 기록 의 한 사이클을 관리하고,
장중에는 지정한 주기로 이를 반복한다.
"""

from __future__ import annotations

import logging
import signal as os_signal
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime

from .client import KisClient
from .config import Settings
from .errors import KisError, TradingHaltedError
from .market import is_market_open, now_kst, round_to_tick, seconds_until_open
from .models import Balance, OrderResult, OrderType, Side
from .quotes import QuoteApi
from .realtime import RealtimeClient, RealtimeMessage
from .risk import RiskManager
from .storage import Storage
from .strategy.base import Action, Signal, Strategy, StrategyContext
from .trading import TradingApi

log = logging.getLogger(__name__)


@dataclass
class CycleReport:
    """한 사이클의 실행 결과 요약."""

    at: datetime
    signals: list[Signal] = field(default_factory=list)
    orders: list[OrderResult] = field(default_factory=list)
    daily_pnl: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def executed(self) -> int:
        return sum(1 for o in self.orders if o.success)


class TradingEngine:
    """전략을 실제 주문으로 연결하는 실행기."""

    def __init__(
        self,
        settings: Settings,
        strategy: Strategy,
        *,
        client: KisClient | None = None,
        storage: Storage | None = None,
        interval: float = 60.0,
        order_type: OrderType = OrderType.LIMIT,
        use_realtime: bool = False,
    ) -> None:
        self.settings = settings
        self.strategy = strategy
        self.client = client or KisClient(settings)
        self.quotes = QuoteApi(self.client)
        self.trading = TradingApi(self.client)
        self.storage = storage or Storage(settings.db_path, env=settings.env)
        self.risk = RiskManager(settings, self.storage)
        self.interval = max(interval, 1.0)
        self.order_type = order_type
        self.use_realtime = use_realtime

        self._realtime: RealtimeClient | None = None
        self._stop = threading.Event()
        self._started = False

    # ------------------------------------------------------------ 실행 제어
    def stop(self) -> None:
        self._stop.set()

    def install_signal_handlers(self) -> None:
        """Ctrl+C / SIGTERM 으로 안전하게 멈추도록 한다."""
        def handler(signum, _frame):
            log.warning("종료 신호 수신(%s) — 현재 사이클을 마치고 종료합니다", signum)
            self.stop()

        for sig in (os_signal.SIGINT, os_signal.SIGTERM):
            try:
                os_signal.signal(sig, handler)
            except (ValueError, OSError):  # pragma: no cover - 메인 스레드가 아닐 때
                pass

    # -------------------------------------------------------------- 사이클
    def build_context(self) -> StrategyContext:
        return StrategyContext(quotes=self.quotes, balance=self.trading.balance(), now=datetime.now())

    def run_once(self) -> CycleReport:
        """전략 1회 평가 및 주문 실행."""
        report = CycleReport(at=datetime.now())
        try:
            ctx = self.build_context()
        except KisError as exc:
            log.error("잔고 조회 실패로 사이클을 건너뜁니다: %s", exc)
            report.errors.append(str(exc))
            return report

        if not self._started:
            self.strategy.on_start(ctx)
            self._started = True

        report.daily_pnl = self.risk.update_daily_pnl(ctx.balance)

        # 1) 보호 청산(손절/익절)을 전략 신호보다 먼저 확인한다.
        for position in ctx.balance.positions:
            exit_signal = self.strategy.exit_policy.check(position)
            if exit_signal is not None:
                report.signals.append(exit_signal)
                self._dispatch(exit_signal, ctx, report)

        # 2) 전략 신호
        for symbol in self.strategy.symbols:
            try:
                sig = self.strategy.evaluate(symbol, ctx)
            except KisError as exc:
                log.error("[%s] 전략 평가 실패: %s", symbol, exc)
                report.errors.append(f"{symbol}: {exc}")
                continue
            report.signals.append(sig)
            if sig.is_actionable:
                self._dispatch(sig, ctx, report)
            else:
                log.debug("[%s] HOLD — %s", symbol, sig.reason)

        self.strategy.on_cycle_end(ctx)
        return report

    def run(self, *, max_cycles: int | None = None, only_market_hours: bool = True) -> None:
        """주기적으로 사이클을 반복한다."""
        self._log_startup()
        cycles = 0
        try:
            while not self._stop.is_set():
                if only_market_hours and not is_market_open(now_kst()):
                    wait = min(seconds_until_open(), 300.0)
                    log.info("장 시간이 아닙니다. %.0f초 후 다시 확인합니다.", wait)
                    if self._stop.wait(timeout=max(wait, 1.0)):
                        break
                    continue

                if self.risk.halted:
                    log.critical("매매가 중단된 상태입니다. 엔진을 종료합니다.")
                    break

                started = time.monotonic()
                report = self.run_once()
                cycles += 1
                log.info(
                    "사이클 #%d 완료: 신호 %d건, 주문 %d건, 당일손익 %s원 (%.1fs)",
                    cycles, len(report.signals), report.executed, f"{report.daily_pnl:,}",
                    time.monotonic() - started,
                )

                if max_cycles is not None and cycles >= max_cycles:
                    break
                if self._stop.wait(timeout=self.interval):
                    break
        finally:
            self.shutdown()

    def shutdown(self) -> None:
        if self._realtime is not None:
            self._realtime.stop()
            self._realtime = None
        try:
            balance = self.trading.balance()
            self.storage.update_closing_equity(balance.net_asset or (balance.total_eval + balance.cash))
        except KisError as exc:  # pragma: no cover - 종료 경로
            log.debug("종료 시 잔고 기록 실패: %s", exc)
        log.info("엔진 종료")

    # -------------------------------------------------------------- 주문 실행
    def _dispatch(self, sig: Signal, ctx: StrategyContext, report: CycleReport) -> None:
        try:
            result = self._execute(sig, ctx)
        except TradingHaltedError as exc:
            log.critical("%s", exc)
            report.errors.append(str(exc))
            self.stop()
            return
        except KisError as exc:
            log.error("[%s] 주문 처리 실패: %s", sig.symbol, exc)
            report.errors.append(f"{sig.symbol}: {exc}")
            return
        if result is not None:
            report.orders.append(result)

    def _execute(self, sig: Signal, ctx: StrategyContext) -> OrderResult | None:
        symbol = sig.symbol
        side = Side.BUY if sig.action is Action.BUY else Side.SELL
        quote_price = sig.target_price or ctx.quote(symbol).price
        if quote_price <= 0:
            log.warning("[%s] 가격을 확인할 수 없어 주문하지 않습니다", symbol)
            return None

        # 지정가는 즉시 체결 가능성을 높이도록 호가 단위로 보정한다.
        if self.order_type is OrderType.LIMIT:
            price = round_to_tick(quote_price, mode="up" if side is Side.BUY else "down")
        else:
            price = 0

        quantity = self._decide_quantity(sig, side, ctx, reference_price=price or quote_price)
        if quantity <= 0:
            log.info("[%s] %s 수량이 0이라 건너뜁니다", symbol, side.korean)
            return None

        decision = self.risk.validate_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            price=price or quote_price,
            balance=ctx.balance,
            order_type=self.order_type,
        )
        if not decision:
            log.warning("[%s] %s 주문 거부 — %s", symbol, side.korean, decision.reason)
            self.storage.record_event("RISK_REJECT", f"{symbol} {side.value}: {decision.reason}", level="WARNING")
            return None

        result = self.trading.order(
            symbol, side, decision.quantity, price=price, order_type=self.order_type
        )
        self.storage.record_order(
            symbol=symbol,
            side=side,
            quantity=decision.quantity,
            price=price or quote_price,
            order_type=self.order_type.name,
            result=result,
            strategy=self.strategy.name,
            reason=sig.reason,
        )
        log.info(
            "[%s] %s %d주 @%s — %s | %s",
            symbol, side.korean, decision.quantity, f"{price:,}" if price else "시장가", sig.reason, result,
        )
        return result

    def _decide_quantity(self, sig: Signal, side: Side, ctx: StrategyContext, *, reference_price: int) -> int:
        if side is Side.BUY:
            return self.risk.size_position(
                price=reference_price, balance=ctx.balance, target_ratio=sig.size_ratio
            )
        position = ctx.position(sig.symbol)
        if position is None:
            return 0
        ratio = max(min(sig.sell_ratio, 1.0), 0.0)
        return int(position.quantity * ratio) if ratio < 1.0 else position.quantity

    # ------------------------------------------------------------- 실시간
    def enable_realtime(self, hts_id: str | None = None) -> RealtimeClient:
        """실시간 체결가 구독 + (HTS ID 를 주면) 체결통보까지 수신한다."""
        rt = RealtimeClient(self.settings, self.client.tokens)
        rt.on(rt.notice_tr_id, self._on_fill_notice)
        rt.subscribe_ticks(self.strategy.symbols)
        if hts_id:
            rt.subscribe_notice(hts_id)
        rt.start()
        self._realtime = rt
        self.use_realtime = True
        return rt

    def _on_fill_notice(self, message: RealtimeMessage) -> None:
        """체결통보를 받아 저널에 기록한다."""
        data = message.data
        if data.get("CNTG_YN") != "2":  # 2: 체결, 1: 주문·정정·취소·거부
            return
        quantity = message.get_int("CNTG_QTY")
        price = message.get_int("CNTG_UNPR")
        if quantity <= 0:
            return
        side = Side.SELL if data.get("SELN_BYOV_CLS") == "01" else Side.BUY
        self.storage.record_fill(
            order_no=data.get("ODER_NO", ""),
            symbol=data.get("STCK_SHRN_ISCD", ""),
            side=side,
            quantity=quantity,
            price=price,
        )
        log.info(
            "체결통보: %s %s %d주 @%s",
            data.get("CNTG_ISNM") or data.get("STCK_SHRN_ISCD"), side.korean, quantity, f"{price:,}",
        )

    # --------------------------------------------------------------- 부가
    def _log_startup(self) -> None:
        mode = "모의투자" if self.settings.is_paper else "🔴 실전투자"
        dry = " / DRY-RUN(주문 미전송)" if self.settings.dry_run else ""
        log.info("=" * 62)
        log.info("KIS 자동매매 엔진 시작 — %s%s", mode, dry)
        log.info("전략: %s", self.strategy.describe())
        log.info("대상 종목: %s", ", ".join(self.strategy.symbols))
        log.info(
            "한도: 1회 %s원 / 종목당 %s원 / 일 %d건 / 일손실 %s원 / 최대 %d종목",
            f"{self.settings.risk.max_order_amount:,}",
            f"{self.settings.risk.max_position_amount:,}",
            self.settings.risk.max_orders_per_day,
            f"{self.settings.risk.max_daily_loss:,}",
            self.settings.risk.max_positions,
        )
        log.info("손절 %.1f%% / 익절 %.1f%% / 주기 %.0fs",
                 self.strategy.exit_policy.stop_loss_pct, self.strategy.exit_policy.take_profit_pct, self.interval)
        log.info("킬 스위치: touch %s", self.settings.kill_switch_path)
        log.info("=" * 62)
        self.storage.record_event("ENGINE_START", f"{self.strategy.name} env={self.settings.env}")

    def snapshot(self) -> Balance:
        """현재 잔고를 조회하고 기준 순자산을 기록한다."""
        balance = self.trading.balance()
        self.storage.set_opening_equity(balance.net_asset or (balance.total_eval + balance.cash), day=date.today())
        return balance
