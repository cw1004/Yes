"""대시보드가 사용하는 데이터/명령 계층.

웹 프레임워크에 의존하지 않는 순수 파이썬이라 단위 테스트가 쉽고,
KIS API 호출 결과를 짧은 TTL 로 캐시해 유량 제한(모의 초당 2건)을 지킨다.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import asdict
from datetime import date
from typing import Any

from ..errors import KisError
from ..market import is_market_open, now_kst, round_to_tick
from ..models import Balance, OrderType, Side

log = logging.getLogger(__name__)


class TTLCache:
    """아주 단순한 키-값 TTL 캐시(스레드 안전)."""

    def __init__(self, ttl: float = 5.0) -> None:
        self.ttl = ttl
        self._values: dict[str, tuple[float, Any]] = {}
        self._lock = threading.RLock()

    def get_or_call(self, key: str, factory: Callable[[], Any], *, ttl: float | None = None) -> Any:
        ttl = self.ttl if ttl is None else ttl
        with self._lock:
            cached = self._values.get(key)
            if cached is not None and time.monotonic() - cached[0] < ttl:
                return cached[1]
        value = factory()  # 락 밖에서 호출한다(네트워크 대기 중 다른 요청을 막지 않도록).
        with self._lock:
            self._values[key] = (time.monotonic(), value)
        return value

    def invalidate(self, *keys: str) -> None:
        with self._lock:
            if keys:
                for key in keys:
                    self._values.pop(key, None)
            else:
                self._values.clear()


class DashboardService:
    """잔고·주문·기록 조회와 비상 제어를 묶은 서비스."""

    def __init__(self, trader, *, watchlist: list[str] | None = None, cache_ttl: float = 5.0) -> None:
        self.trader = trader
        self.settings = trader.settings
        self.watchlist = list(dict.fromkeys(watchlist or []))
        self.cache = TTLCache(cache_ttl)

    # ------------------------------------------------------------------ 조회
    def _balance(self) -> Balance:
        return self.cache.get_or_call("balance", self.trader.trading.balance)

    def summary(self) -> dict[str, Any]:
        """상단 요약 카드에 필요한 값 전부."""
        balance = self._balance()
        storage = self.trader.storage
        opening = storage.opening_equity(date.today())
        net_asset = balance.net_asset or (balance.total_eval + balance.cash)
        daily_pnl = net_asset - opening if opening else 0
        limits = self.settings.risk

        return {
            "env": self.settings.env,
            "is_paper": self.settings.is_paper,
            "dry_run": self.settings.dry_run,
            "account": f"{self.settings.account_no[:4]}****-{self.settings.account_product_code}",
            "market_open": is_market_open(),
            "server_time": now_kst().strftime("%Y-%m-%d %H:%M:%S"),
            "halted": self.trader.risk.halted,
            "kill_switch": self.trader.risk.kill_switch_active,
            "cash": balance.cash,
            "available_cash": balance.available_cash,
            "total_eval": balance.total_eval,
            "total_purchase": balance.total_purchase,
            "total_pnl": balance.total_pnl,
            "total_pnl_rate": round(balance.total_pnl / balance.total_purchase * 100, 2)
            if balance.total_purchase
            else 0.0,
            "net_asset": net_asset,
            "opening_equity": opening or 0,
            "daily_pnl": daily_pnl,
            "daily_pnl_rate": round(daily_pnl / opening * 100, 2) if opening else 0.0,
            "position_count": len(balance.positions),
            "orders_today": storage.order_count(),
            "fills_today": storage.daily_fill_summary(),
            "limits": {
                "max_order_amount": limits.max_order_amount,
                "max_position_amount": limits.max_position_amount,
                "max_orders_per_day": limits.max_orders_per_day,
                "max_daily_loss": limits.max_daily_loss,
                "max_positions": limits.max_positions,
            },
        }

    def positions(self) -> list[dict[str, Any]]:
        return [asdict(position) for position in self._balance().positions]

    def open_orders(self) -> list[dict[str, Any]]:
        def load():
            try:
                return [
                    {**asdict(order), "side": order.side.value, "side_ko": order.side.korean}
                    for order in self.trader.trading.open_orders()
                ]
            except KisError as exc:
                log.warning("미체결 조회 실패: %s", exc)
                return []

        return self.cache.get_or_call("open_orders", load)

    def journal(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.trader.storage.recent_orders(limit)

    def quotes(self, symbols: list[str] | None = None) -> list[dict[str, Any]]:
        targets = symbols if symbols else self.watchlist
        if not targets:
            return []

        def load():
            rows = []
            for symbol in targets:
                try:
                    quote = self.trader.quotes.price(symbol)
                except KisError as exc:
                    log.warning("[%s] 시세 조회 실패: %s", symbol, exc)
                    rows.append({"symbol": symbol, "error": str(exc)})
                    continue
                rows.append({
                    "symbol": quote.symbol,
                    "name": quote.name,
                    "price": quote.price,
                    "change": quote.change,
                    "change_rate": quote.change_rate,
                    "volume": quote.volume,
                    "high": quote.high,
                    "low": quote.low,
                    "halted": quote.halted,
                })
            return rows

        return self.cache.get_or_call("quotes:" + ",".join(targets), load)

    def snapshot(self) -> dict[str, Any]:
        """대시보드 한 화면에 필요한 데이터를 한 번에 모은다."""
        return {
            "summary": self.summary(),
            "positions": self.positions(),
            "orders": self.open_orders(),
            "journal": self.journal(15),
            "quotes": self.quotes(),
        }

    # ------------------------------------------------------------------ 제어
    def set_halt(self, on: bool) -> dict[str, Any]:
        """킬 스위치 on/off. 켜는 쪽은 언제나 허용되는 안전 동작이다."""
        path = self.settings.kill_switch_path
        if on:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"halted from dashboard at {now_kst():%Y-%m-%d %H:%M:%S}\n", encoding="utf-8")
            self.trader.storage.record_event("KILL_SWITCH", "대시보드에서 매매 중단", level="CRITICAL")
            log.critical("대시보드에서 킬 스위치를 켰습니다")
        else:
            path.unlink(missing_ok=True)
            self.trader.risk.resume()
            self.trader.storage.record_event("KILL_SWITCH_OFF", "대시보드에서 매매 재개")
            log.warning("대시보드에서 킬 스위치를 껐습니다")
        return {"halted": self.trader.risk.halted, "kill_switch": self.trader.risk.kill_switch_active}

    def cancel(self, *, org_no: str, order_no: str) -> dict[str, Any]:
        result = self.trader.trading.cancel(org_no=org_no, order_no=order_no)
        self.cache.invalidate("open_orders", "balance")
        return {"success": result.success, "message": result.message or str(result), "order_no": result.order_no}

    def cancel_all(self) -> dict[str, Any]:
        results = self.trader.trading.cancel_all()
        self.cache.invalidate("open_orders", "balance")
        return {
            "count": len(results),
            "success": all(r.success for r in results),
            "results": [{"order_no": r.order_no, "success": r.success, "message": r.message} for r in results],
        }

    def place_order(
        self, *, symbol: str, side: str, quantity: int, price: int = 0, market: bool = False
    ) -> dict[str, Any]:
        """수동 주문. 리스크 검증을 반드시 거친다."""
        try:
            order_side = Side(side)
        except ValueError:
            return {"success": False, "message": f"side 는 buy 또는 sell 이어야 합니다: {side!r}"}
        if quantity <= 0:
            return {"success": False, "message": "수량은 1 이상이어야 합니다"}

        order_type = OrderType.MARKET if market else OrderType.LIMIT
        if not market:
            if price <= 0:
                return {"success": False, "message": "지정가 주문에는 가격이 필요합니다"}
            price = round_to_tick(price, mode="up" if order_side is Side.BUY else "down")

        balance = self.trader.trading.balance()  # 검증은 항상 최신 잔고로 한다.
        reference_price = price or self.trader.quotes.price(symbol).price
        decision = self.trader.risk.validate_order(
            symbol=symbol,
            side=order_side,
            quantity=quantity,
            price=reference_price,
            balance=balance,
            order_type=order_type,
        )
        if not decision:
            return {"success": False, "message": f"리스크 한도: {decision.reason}"}

        result = self.trader.trading.order(
            symbol, order_side, decision.quantity, price=price, order_type=order_type
        )
        self.trader.storage.record_order(
            symbol=symbol,
            side=order_side,
            quantity=decision.quantity,
            price=reference_price,
            order_type=order_type.name,
            result=result,
            strategy="dashboard",
            reason="대시보드 수동 주문",
        )
        self.cache.invalidate()
        return {
            "success": result.success,
            "order_no": result.order_no,
            "quantity": decision.quantity,
            "price": price,
            "message": result.message or str(result),
            "dry_run": result.dry_run,
        }
