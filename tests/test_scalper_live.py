"""실전 매매 계층 테스트 — 네트워크 없이 가짜 Alpaca 로 끝까지 돌립니다.

여기서 검증하는 것은 "신호가 맞는가"가 아니라 "실제로 주문이 나가고, 브로커가
멋대로 청산해도 우리가 알아채는가"입니다. 돈이 걸리는 쪽은 이쪽입니다.
"""

import datetime as dt
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

from scalper.live.client import (Account, AlpacaClient, AlpacaError, Order,
                                 _tick)
from scalper.live.executor import LiveExecutor
from scalper.live.guards import GuardConfig, TradingGuards
from scalper.live.runner import LiveRunner
from scalper.live.state import StateStore, TradeRecord
from scalper.strategy import RiskConfig


def iso(offset_min: float = 0.0) -> str:
    return (dt.datetime.now(dt.timezone.utc)
            + dt.timedelta(minutes=offset_min)).isoformat()


class FakeAlpaca(AlpacaClient):
    """AlpacaClient 의 request() 만 갈아끼운 인메모리 브로커.

    executor / guards / runner 는 실제 코드 그대로 돌아갑니다.
    """

    def __init__(self, equity=50_000.0, is_open=True, daytrade_count=0,
                 price=100.0, bars=None):
        super().__init__("k", "s", paper=True, max_retries=0)
        self.equity = equity
        self.is_open = is_open
        self.daytrade_count = daytrade_count
        self.price = price
        self._bars = bars or []
        self.positions_db: dict[str, dict] = {}
        self.orders: dict[str, dict] = {}
        self.calls: list[str] = []
        self._seq = 0
        self.trading_blocked = False

    # ── 테스트용 조작 ──
    def _next_id(self) -> str:
        self._seq += 1
        return f"ord-{self._seq}"

    def fill_bracket_stop(self, symbol: str, fill_price: float) -> None:
        """거래소에서 손절이 체결된 상황을 재현합니다 (우리가 모르는 사이)."""
        self.positions_db.pop(symbol.upper(), None)
        for o in self.orders.values():
            if o["symbol"] == symbol.upper() and o.get("legs"):
                for leg in o["legs"]:
                    if leg.get("stop_price"):
                        leg["status"] = "filled"
                        leg["filled_avg_price"] = str(fill_price)
                        leg["filled_qty"] = leg["qty"]

    # ── 라우팅 ──
    def request(self, method, path, body=None, base=None):
        self.calls.append(f"{method} {path.split('?')[0]}")
        p = path.split("?")[0]

        if p == "/v2/account":
            return {"equity": str(self.equity), "cash": str(self.equity),
                    "buying_power": str(self.equity * 2),
                    "daytrade_count": self.daytrade_count,
                    "pattern_day_trader": False,
                    "trading_blocked": self.trading_blocked,
                    "account_blocked": False, "status": "ACTIVE", "currency": "USD"}

        if p == "/v2/clock":
            return {"is_open": self.is_open, "timestamp": iso(),
                    "next_open": iso(60), "next_close": iso(120)}

        if p == "/v2/positions":
            return list(self.positions_db.values())

        if p.startswith("/v2/positions/") and method == "DELETE":
            sym = p.rsplit("/", 1)[-1]
            if sym not in self.positions_db:
                raise AlpacaError("position does not exist", status=404)
            self.positions_db.pop(sym)
            return {"id": self._next_id(), "symbol": sym, "side": "sell",
                    "status": "filled", "filled_avg_price": str(self.price),
                    "filled_qty": "1", "qty": "1"}

        if p == "/v2/orders" and method == "POST":
            return self._submit(body or {})

        if p == "/v2/orders" and method == "DELETE":
            for o in self.orders.values():
                if o["status"] in ("new", "accepted"):
                    o["status"] = "canceled"
            return {}

        if p.startswith("/v2/orders/"):
            oid = p.rsplit("/", 1)[-1]
            if method == "DELETE":
                o = self.orders.get(oid)
                if o is None:
                    raise AlpacaError("not found", status=404)
                o["status"] = "canceled"
                return {}
            o = self.orders.get(oid)
            if o is None:
                raise AlpacaError("not found", status=404)
            return o

        if p == "/v2/orders":
            return [o for o in self.orders.values()
                    if o["status"] in ("new", "accepted", "partially_filled")]

        if "/trades/latest" in p:
            return {"trade": {"p": self.price}}
        if "/quotes/latest" in p:
            return {"quote": {"bp": self.price - 0.01, "ap": self.price + 0.01}}
        if p == "/v2/stocks/bars":
            sym = (body or {}).get("symbols") or self._bars_symbol(path)
            return {"bars": {sym: self._bars}}

        raise AlpacaError(f"unhandled {method} {p}", status=404)

    @staticmethod
    def _bars_symbol(path: str) -> str:
        import urllib.parse
        q = urllib.parse.parse_qs(path.split("?", 1)[-1])
        return (q.get("symbols") or ["X"])[0]

    def _submit(self, body: dict) -> dict:
        oid = self._next_id()
        sym = body["symbol"]
        qty = float(body["qty"])
        legs = []
        if body.get("order_class") == "bracket":
            legs = [
                {"id": self._next_id(), "symbol": sym, "side": "sell", "qty": body["qty"],
                 "type": "limit", "status": "held", "filled_qty": "0",
                 "limit_price": str(body["take_profit"]["limit_price"])},
                {"id": self._next_id(), "symbol": sym, "side": "sell", "qty": body["qty"],
                 "type": "stop", "status": "held", "filled_qty": "0",
                 "stop_price": str(body["stop_loss"]["stop_price"])},
            ]
        order = {"id": oid, "symbol": sym, "side": "buy", "qty": body["qty"],
                 "filled_qty": body["qty"], "filled_avg_price": str(self.price),
                 "status": "filled", "type": body.get("type", "market"), "legs": legs}
        self.orders[oid] = order
        # 실제 Alpaca 는 부모 체결 후 각 다리를 살아 있는 독립 주문으로 노출합니다.
        for leg in legs:
            leg["status"] = "new"
            self.orders[leg["id"]] = leg
        self.positions_db[sym] = {
            "symbol": sym, "qty": str(qty), "avg_entry_price": str(self.price),
            "market_value": str(qty * self.price), "unrealized_pl": "0",
            "current_price": str(self.price)}
        return order


def make_bars(n=120, start=100.0, breakout=3):
    """진입 신호가 실제로 뜨는 봉을 만듭니다.

    긴 횡보(스퀴즈) 뒤 거래량을 동반한 짧은 돌파 — 이 전략이 노리는 바로 그 모양.
    직선 상승으로 만들면 RSI 가 100 으로 붙어 오히려 신호가 죽습니다.
    """
    import math

    out = []
    base = dt.datetime(2026, 1, 5, 14, 30, tzinfo=dt.timezone.utc)
    price = start
    for i in range(n):
        o = price
        if i < n - breakout:
            price = start + math.sin(i / 3.0) * 0.55 + math.sin(i / 11.0) * 0.35
            vol = 90_000 + (i % 5) * 3_000
        else:
            price = price * 1.0042
            vol = 205_000
        out.append({"t": (base + dt.timedelta(minutes=5 * i)).isoformat(),
                    "o": o, "h": max(o, price) * 1.0015,
                    "l": min(o, price) * 0.9985, "c": price, "v": vol})
    return out


class TestClient(unittest.TestCase):
    def test_tick_rounding(self):
        # 1달러 이상은 센트 단위, 미만은 0.0001 단위가 미국 주식 호가단위입니다.
        self.assertEqual(_tick(123.456), 123.46)
        self.assertEqual(_tick(1.0), 1.0)
        self.assertEqual(_tick(0.98765), 0.9877)
        self.assertEqual(len(str(_tick(0.5)).split(".")[-1]), 1)

    def test_order_status_classification(self):
        self.assertTrue(Order.parse({"status": "partially_filled"}).is_open)
        self.assertTrue(Order.parse({"status": "filled"}).is_filled)
        self.assertFalse(Order.parse({"status": "canceled"}).is_open)

    def test_pdt_flag(self):
        small = Account.parse({"equity": "5000", "daytrade_count": 3})
        big = Account.parse({"equity": "50000", "daytrade_count": 9})
        self.assertTrue(small.pdt_restricted)
        self.assertFalse(big.pdt_restricted)

    def test_missing_keys_rejected(self):
        with self.assertRaises(AlpacaError):
            AlpacaClient("", "")

    def test_retries_on_429_then_succeeds(self):
        import scalper.live.client as mod

        calls = {"n": 0}

        class Resp:
            def read(self):
                return b'{"ok": true}'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_urlopen(req, timeout=0):
            calls["n"] += 1
            if calls["n"] == 1:
                raise urllib.error.HTTPError(
                    req.full_url, 429, "rate", {"Retry-After": "0"}, None)
            return Resp()

        original = mod.urllib.request.urlopen
        mod.urllib.request.urlopen = fake_urlopen
        try:
            c = AlpacaClient("k", "s", max_retries=2)
            self.assertEqual(c.request("GET", "/v2/account"), {"ok": True})
            self.assertEqual(calls["n"], 2)
        finally:
            mod.urllib.request.urlopen = original

    def test_does_not_retry_on_403(self):
        import scalper.live.client as mod

        calls = {"n": 0}

        def fake_urlopen(req, timeout=0):
            calls["n"] += 1
            raise urllib.error.HTTPError(req.full_url, 403, "forbidden", {}, None)

        original = mod.urllib.request.urlopen
        mod.urllib.request.urlopen = fake_urlopen
        try:
            c = AlpacaClient("k", "s", max_retries=3)
            with self.assertRaises(AlpacaError) as ctx:
                c.request("GET", "/v2/account")
            self.assertEqual(ctx.exception.status, 403)
            self.assertEqual(calls["n"], 1)
        finally:
            mod.urllib.request.urlopen = original


class TestGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.guards = TradingGuards(GuardConfig(), work_dir=self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_open_market_allows_entry(self):
        r = self.guards.evaluate(FakeAlpaca())
        self.assertTrue(r.can_enter, r.reasons)
        self.assertTrue(r.can_exit)

    def test_closed_market_blocks_entry_and_exit(self):
        r = self.guards.evaluate(FakeAlpaca(is_open=False))
        self.assertFalse(r.can_enter)
        self.assertFalse(r.can_exit)
        self.assertIn("장 마감", r.reason)

    def test_pdt_blocks_entry(self):
        r = self.guards.evaluate(FakeAlpaca(equity=5_000, daytrade_count=3))
        self.assertFalse(r.can_enter)
        self.assertIn("PDT", r.reason)

    def test_daily_loss_limit_blocks_entry(self):
        r = self.guards.evaluate(FakeAlpaca(), day_pnl_pct=-4.0)
        self.assertFalse(r.can_enter)
        self.assertIn("손실 한도", r.reason)

    def test_halt_file_stops_everything(self):
        self.guards.halt("test")
        r = self.guards.evaluate(FakeAlpaca())
        self.assertTrue(r.halted)
        self.assertFalse(r.can_enter)
        self.guards.clear_halt()
        self.assertFalse(self.guards.evaluate(FakeAlpaca()).halted)

    def test_blocked_account_stops_exit_too(self):
        c = FakeAlpaca()
        c.trading_blocked = True
        r = self.guards.evaluate(c)
        self.assertFalse(r.can_enter)
        self.assertFalse(r.can_exit)

    def test_close_buffer_blocks_late_entry(self):
        guards = TradingGuards(GuardConfig(close_buffer_min=180), work_dir=self.tmp.name)
        r = guards.evaluate(FakeAlpaca())      # 가짜 시계의 마감까지 120분
        self.assertFalse(r.can_enter)
        self.assertIn("마감", r.reason)
        self.assertTrue(r.can_exit)            # 청산은 계속 허용되어야 합니다


class TestState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "state.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_survives_restart(self):
        s1 = StateStore(self.path)
        s1.load(10_000, today="2026-01-05")
        s1.record_trade(TradeRecord("NVDA", 10, 100, 98, -20.5, -2.05,
                                    iso(), iso(), [], []))
        s2 = StateStore(self.path)
        st = s2.load(10_000, today="2026-01-05")
        self.assertEqual(len(st.trades), 1)
        self.assertAlmostEqual(st.realized_pnl, -20.5)
        self.assertAlmostEqual(st.day_pnl_pct, -0.205, places=4)

    def test_new_day_resets(self):
        s = StateStore(self.path)
        s.load(10_000, today="2026-01-05")
        s.record_trade(TradeRecord("NVDA", 1, 1, 1, -50, -1, iso(), iso(), [], []))
        st = StateStore(self.path).load(9_950, today="2026-01-06")
        self.assertEqual(st.trades, [])
        self.assertEqual(st.realized_pnl, 0.0)
        self.assertEqual(st.start_equity, 9_950)

    def test_corrupt_file_does_not_crash(self):
        Path(self.path).write_text("{ not json", encoding="utf-8")
        st = StateStore(self.path).load(10_000, today="2026-01-05")
        self.assertEqual(st.trades, [])

    def test_write_is_atomic_json(self):
        s = StateStore(self.path)
        s.load(10_000, today="2026-01-05")
        s.record_intent("NVDA", "ord-1", 98.0, 103.0, ["정배열"])
        data = json.loads(Path(self.path).read_text(encoding="utf-8"))
        self.assertEqual(data["intents"]["NVDA"]["order_id"], "ord-1")


class TestExecutor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.client = FakeAlpaca(price=100.0)
        self.store = StateStore(str(Path(self.tmp.name) / "s.json"))
        self.store.load(50_000, today="2026-01-05")
        self.ex = LiveExecutor(self.client, self.store, fee_bps=1.0)

    def tearDown(self):
        self.tmp.cleanup()

    def test_entry_uses_actual_fill_price_not_hint(self):
        self.client.price = 101.37          # 실제 체결가는 봉 종가와 다릅니다
        e = self.ex.enter("NVDA", 10, 98.0, 104.0, ["정배열"], price_hint=100.0)
        self.assertEqual(e.kind, "ENTRY", e.message)
        self.assertAlmostEqual(self.ex.positions["NVDA"].entry, 101.37)

    def test_sub_one_share_rejected_with_reason(self):
        e = self.ex.enter("NVDA", 0.4, 98.0, 104.0, [], price_hint=100.0)
        self.assertEqual(e.kind, "REJECT")
        self.assertIn("1주", e.message)
        self.assertNotIn("NVDA", self.ex.positions)

    def test_broker_stop_fill_is_detected_and_booked(self):
        """핵심: 거래소가 손절을 체결해도 우리가 알아채야 합니다."""
        self.ex.enter("NVDA", 10, 98.0, 104.0, ["정배열"], price_hint=100.0)
        self.assertIn("NVDA", self.ex.positions)

        self.client.fill_bracket_stop("NVDA", 98.0)     # 우리 모르게 체결
        events = self.ex.sync({"NVDA": 98.0})

        kinds = [e.kind for e in events]
        self.assertIn("EXIT", kinds)
        self.assertNotIn("NVDA", self.ex.positions)
        self.assertEqual(len(self.store.state.trades), 1)
        trade = self.store.state.trades[0]
        self.assertAlmostEqual(trade["exit"], 98.0)
        self.assertLess(trade["pnl"], 0)
        self.assertIn("손절", trade["reason_out"][0])

    def test_fee_is_deducted_from_pnl(self):
        self.ex.enter("NVDA", 10, 98.0, 104.0, [], price_hint=100.0)
        self.client.fill_bracket_stop("NVDA", 104.0)
        self.ex.sync({"NVDA": 104.0})
        trade = self.store.state.trades[0]
        gross = (104.0 - 100.0) * 10
        self.assertLess(trade["pnl"], gross)            # 수수료만큼 작아야 합니다

    def test_adopts_existing_position_after_restart(self):
        self.ex.enter("NVDA", 10, 98.0, 104.0, ["정배열"], price_hint=100.0)
        fresh = LiveExecutor(self.client, self.store)   # 재시작 상황
        events = fresh.sync({"NVDA": 100.0})
        self.assertEqual([e.kind for e in events], ["ADOPT"])
        pos = fresh.positions["NVDA"]
        self.assertAlmostEqual(pos.entry, 100.0)
        self.assertAlmostEqual(pos.stop, 98.0)          # 의도 기록에서 복원

    def test_exit_cancels_open_orders_first(self):
        self.ex.enter("NVDA", 10, 98.0, 104.0, [], price_hint=100.0)
        self.client.calls.clear()
        e = self.ex.exit("NVDA", "테스트")
        self.assertEqual(e.kind, "EXIT")
        joined = " ".join(self.client.calls)
        self.assertIn("DELETE /v2/orders/", joined)     # 취소가 먼저
        self.assertIn("DELETE /v2/positions/NVDA", joined)

    def test_exit_without_position_is_rejected(self):
        self.assertEqual(self.ex.exit("NVDA", "x").kind, "REJECT")

    def test_double_entry_blocked(self):
        self.ex.enter("NVDA", 10, 98.0, 104.0, [], price_hint=100.0)
        self.assertEqual(self.ex.enter("NVDA", 10, 98.0, 104.0, [],
                                       price_hint=100.0).kind, "REJECT")

    def test_position_query_failure_reports_error(self):
        class Broken(FakeAlpaca):
            def request(self, method, path, body=None, base=None):
                if path == "/v2/positions":
                    raise AlpacaError("boom", status=500)
                return super().request(method, path, body, base)

        ex = LiveExecutor(Broken(), self.store)
        events = ex.sync()
        self.assertEqual(events[0].kind, "ERROR")


class TestRunner(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bars = make_bars()
        self.client = FakeAlpaca(price=self.bars[-1]["c"], bars=self.bars)
        self.state_path = str(Path(self.tmp.name) / "run.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_fixture_actually_produces_a_signal(self):
        """이 픽스처가 신호를 못 내면 아래 테스트들은 아무것도 검증하지 못합니다."""
        from scalper import indicators
        from scalper.indicators import Candle
        from scalper.signals import buy_signal

        cs = [Candle(ts=i * 300, open=b["o"], high=b["h"], low=b["l"],
                     close=b["c"], volume=b["v"]) for i, b in enumerate(self.bars)]
        sig = buy_signal(indicators.compute(cs), min_score=0)
        self.assertGreaterEqual(sig.score, RiskConfig().buy_threshold)
        self.assertTrue(sig.trend_up)

    def _runner(self, **kw):
        cfg = RiskConfig(equity=50_000, buy_threshold=kw.pop("threshold", 65.0))
        return LiveRunner(self.client, ["NVDA"], cfg=cfg,
                          guard_cfg=GuardConfig(open_buffer_min=0, close_buffer_min=0),
                          state_path=self.state_path, use_context=False,
                          on_log=lambda line: None)

    def test_full_cycle_entry_then_broker_stop(self):
        r = self._runner()
        r.start()
        r.step()
        self.assertIn("NVDA", r.executor.positions, "진입이 일어나야 합니다")

        self.client.fill_bracket_stop("NVDA", 128.0)
        self.client.price = 128.0
        r.step()
        self.assertNotIn("NVDA", r.executor.positions)
        self.assertEqual(len(r.store.state.trades), 1)

    def test_closed_market_places_no_orders(self):
        self.client.is_open = False
        r = self._runner()
        r.start()
        r.step()
        self.assertEqual(r.executor.positions, {})
        self.assertEqual(self.client.positions_db, {})

    def test_halt_flattens_and_stops(self):
        r = self._runner()
        r.start()
        r.step()
        self.assertIn("NVDA", r.executor.positions)
        r.guards.halt("test")
        r._last_guard = 0.0
        r.step()
        self.assertTrue(r.stopped)
        self.assertEqual(self.client.positions_db, {})
        r.guards.clear_halt()

    def test_state_snapshot_is_json_serializable(self):
        r = self._runner()
        r.start()
        r.step()
        json.dumps(r.state(), ensure_ascii=False)

    def test_api_budget_is_reasonable(self):
        """분당 200콜 예산 안에 들어오는지 — 틱당 호출 수를 셉니다."""
        r = self._runner()
        r.start()
        r.step()                                # 첫 틱은 봉/가드 로딩 포함
        self.client.calls.clear()
        r.step()
        self.assertLessEqual(len(self.client.calls), 8,
                             f"틱당 호출 과다: {self.client.calls}")


if __name__ == "__main__":
    unittest.main()
