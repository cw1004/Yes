"""한국투자증권 어댑터 테스트 — HTTP 만 가짜이고 나머지는 전부 진짜 코드입니다.

토큰 캐싱·해시키·필드 해석·주문 본문 구성·능력 분기까지 실제 경로를 탑니다.
실제 KIS 서버에 붙여본 적은 없으므로, 응답 **형식**이 다르면 이 테스트는
통과해도 현장에서 깨집니다. 그래서 kis-probe 로 먼저 확인하라고 안내합니다.
"""

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from scalper.live.executor import LiveExecutor
from scalper.live.kis import spec as kis_spec
from scalper.live.kis.broker import KISBroker
from scalper.live.kis.client import KISClient, KISCredentials, KISError
from scalper.live.state import StateStore
from scalper.live.types import BrokerError

CREDS = KISCredentials(app_key="K" * 36, app_secret="S" * 180, account="12345678")


def bar_rows(n=40, start=100.0):
    base = dt.datetime(2026, 10, 1, 9, 35)
    out = []
    price = start
    for i in range(n):
        o = price
        price += 0.1
        out.append({"xymd": (base + dt.timedelta(minutes=5 * i)).strftime("%Y%m%d"),
                    "xhms": (base + dt.timedelta(minutes=5 * i)).strftime("%H%M%S"),
                    "open": f"{o:.2f}", "high": f"{max(o, price) + .05:.2f}",
                    "low": f"{min(o, price) - .05:.2f}", "last": f"{price:.2f}",
                    "evol": "12000"})
    return list(reversed(out))          # KIS 는 최신순으로 줍니다


class FakeKIS(KISClient):
    """HTTP 만 가로챕니다. 토큰·해시키·rt_cd 처리는 실제 코드가 돕니다."""

    def __init__(self, paper=True, token_file=None, qty=0.0, price=101.4,
                 cash=50_000.0, bars=None, fail_order=False, **kw):
        super().__init__(CREDS, paper=paper,
                         token_file=token_file or tempfile.mktemp(suffix=".json"),
                         max_retries=0, **kw)
        self._min_gap = 0.0            # 테스트에서는 유량 제한을 기다리지 않습니다
        self.qty = qty
        self.price = price
        self.cash = cash
        self.bars = bars if bars is not None else bar_rows()
        self.fail_order = fail_order
        self.seen: list[tuple[str, str]] = []
        self.bodies: list[dict] = []
        self.token_requests = 0

    def _raw(self, method, path, body=None, params=None, headers=None, auth=True):
        self.seen.append((method, path))
        tr = (headers or {}).get("tr_id", "")

        if path == self.spec["paths"]["token"]:
            self.token_requests += 1
            return {"access_token": "tok-123", "expires_in": 86400}
        if path == self.spec["paths"]["hashkey"]:
            return {"HASH": "hash-abc"}

        if path == self.spec["paths"]["price"]:
            return {"rt_cd": "0", "output": {"last": f"{self.price:.2f}"}}

        if path == self.spec["paths"]["minute_bars"]:
            return {"rt_cd": "0", "output2": self.bars}

        if path == self.spec["paths"]["balance"]:
            rows = []
            if self.qty > 0:
                rows.append({"ovrs_pdno": "NVDA", "ovrs_cblc_qty": f"{self.qty:.0f}",
                             "pchs_avg_pric": "100.00",
                             "now_pric2": f"{self.price:.2f}",
                             "ovrs_stck_evlu_amt": f"{self.qty * self.price:.2f}",
                             "frcr_evlu_pfls_amt": "12.34"})
            return {"rt_cd": "0", "output1": rows,
                    "output2": {"frcr_dncl_amt_2": f"{self.cash:.2f}",
                                "ord_psbl_frcr_amt": f"{self.cash:.2f}",
                                "tot_evlu_pfls_amt": f"{self.cash + self.qty * self.price:.2f}"}}

        if path == self.spec["paths"]["open_orders"]:
            return {"rt_cd": "0", "output": []}

        if path == self.spec["paths"]["order"]:
            self.bodies.append({"tr_id": tr, **(body or {})})
            if self.fail_order:
                return {"rt_cd": "1", "msg_cd": "40250000", "msg1": "주문가능금액 부족"}
            if (body or {}).get("ORD_QTY"):
                side_buy = tr.endswith("1002U")
                self.qty += float(body["ORD_QTY"]) * (1 if side_buy else -1)
                self.qty = max(0.0, self.qty)
            return {"rt_cd": "0", "output": {"ODNO": f"ODNO{len(self.bodies):04d}"}}

        if path == self.spec["paths"]["order_cancel"]:
            return {"rt_cd": "0", "output": {"ODNO": "cancel"}}

        raise AssertionError(f"처리되지 않은 경로: {path}")


def broker(**kw) -> KISBroker:
    return KISBroker(FakeKIS(**kw))


class TestSpec(unittest.TestCase):
    def test_defaults_mark_no_bracket(self):
        d = kis_spec.load()
        self.assertFalse(d["capabilities"]["bracket"])
        self.assertFalse(d["capabilities"]["protective_stop"])

    def test_user_file_deep_merges(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                         encoding="utf-8") as f:
            json.dump({"fields": {"position_qty": ["my_qty"]},
                       "capabilities": {"protective_stop": True}}, f)
            path = f.name
        d = kis_spec.load(path)
        self.assertEqual(d["fields"]["position_qty"], ["my_qty"])
        self.assertTrue(d["capabilities"]["protective_stop"])
        self.assertFalse(d["capabilities"]["bracket"])          # 안 건드린 건 유지
        self.assertIn("balance", d["paths"])

    def test_pick_is_case_insensitive(self):
        self.assertEqual(kis_spec.pick({"OVRS_PDNO": "NVDA"}, ["ovrs_pdno"]), "NVDA")
        self.assertEqual(kis_spec.pick({"a": ""}, ["a", "b"], "fallback"), "fallback")


class TestClient(unittest.TestCase):
    def test_incomplete_credentials_rejected(self):
        with self.assertRaises(KISError):
            KISClient(KISCredentials("k", "s", "123"))        # 계좌가 8자리가 아님

    def test_token_is_requested_once_and_cached_on_disk(self):
        with tempfile.TemporaryDirectory() as d:
            tf = str(Path(d) / "tok.json")
            c = FakeKIS(token_file=tf)
            c.token(); c.token(); c.token()
            self.assertEqual(c.token_requests, 1)
            # 새 프로세스가 떠도 토큰을 다시 받지 않아야 합니다 (발급 빈도 제한)
            c2 = FakeKIS(token_file=tf)
            self.assertEqual(c2.token(), "tok-123")
            self.assertEqual(c2.token_requests, 0)
            self.assertEqual(Path(tf).stat().st_mode & 0o777, 0o600)

    def test_paper_and_real_tokens_do_not_mix(self):
        with tempfile.TemporaryDirectory() as d:
            tf = str(Path(d) / "tok.json")
            FakeKIS(paper=True, token_file=tf).token()
            live = FakeKIS(paper=False, token_file=tf)
            live.token()
            self.assertEqual(live.token_requests, 1, "실전이 모의 토큰을 재사용했습니다")

    def test_business_error_surfaces_code_and_message(self):
        b = broker(fail_order=True)
        with self.assertRaises(KISError) as ctx:
            b.submit_entry("NVDA", 1)
        self.assertIn("주문가능금액 부족", str(ctx.exception))
        self.assertEqual(ctx.exception.code, "40250000")

    def test_paper_and_real_use_different_hosts(self):
        self.assertIn("vts", FakeKIS(paper=True).base)
        self.assertNotIn("vts", FakeKIS(paper=False).base)


class TestBroker(unittest.TestCase):
    def test_capabilities_say_no_exchange_side_stop(self):
        caps = broker().caps
        self.assertFalse(caps.bracket)
        self.assertFalse(caps.exchange_side_stop)
        self.assertFalse(caps.pdt, "국내 증권사 경유는 PDT 대상이 아닙니다")

    def test_bracket_order_is_refused_loudly(self):
        with self.assertRaises(KISError):
            broker().submit_bracket("NVDA", 1, 90, 110)

    def test_positions_parsed_from_balance(self):
        pos = broker(qty=7).positions()
        self.assertIn("NVDA", pos)
        self.assertEqual(pos["NVDA"].qty, 7)
        self.assertAlmostEqual(pos["NVDA"].avg_entry_price, 100.0)

    def test_empty_balance_gives_no_positions(self):
        self.assertEqual(broker(qty=0).positions(), {})

    def test_account_falls_back_to_holdings_plus_cash(self):
        b = broker(qty=10, cash=1_000.0)
        b.spec["fields"]["summary_equity"] = ["no_such_field"]
        acct = b.account()
        self.assertAlmostEqual(acct.equity, 1_000.0 + 10 * b.client.price, places=2)

    def test_bars_sorted_ascending_and_utc(self):
        bars = broker().bars("NVDA", "5Min", 50)
        times = [b["t"] for b in bars]
        self.assertEqual(times, sorted(times), "봉이 시간순이 아닙니다")
        self.assertTrue(times[0].endswith("+00:00"))
        self.assertGreater(bars[-1]["c"], bars[0]["c"])

    def test_malformed_bars_are_skipped(self):
        bad = bar_rows(5) + [{"xymd": "", "xhms": "", "last": "0"}]
        self.assertEqual(len(broker(bars=bad).bars("NVDA")), 5)

    def test_entry_order_body_is_well_formed(self):
        b = broker()
        b.submit_entry("NVDA", 3)
        body = b.client.bodies[-1]
        self.assertEqual(body["PDNO"], "NVDA")
        self.assertEqual(body["ORD_QTY"], "3")
        self.assertEqual(body["OVRS_EXCG_CD"], "NASD")
        self.assertEqual(body["ORD_DVSN"], "00")           # 지정가
        self.assertTrue(body["tr_id"].startswith("VTTT"))  # 모의 tr_id
        self.assertGreater(float(body["OVRS_ORD_UNPR"]), b.client.price)  # 체결 우선

    def test_real_account_uses_real_tr_id(self):
        b = KISBroker(FakeKIS(paper=False))
        b.submit_entry("NVDA", 1)
        self.assertTrue(b.client.bodies[-1]["tr_id"].startswith("TTTT"))

    def test_order_sends_hashkey(self):
        b = broker()
        b.submit_entry("NVDA", 1)
        self.assertIn(("POST", b.spec["paths"]["hashkey"]), b.client.seen)

    def test_protective_stop_disabled_by_default(self):
        self.assertIsNone(broker().submit_protective("NVDA", 1, 95.0))

    def test_close_position_sells_held_quantity(self):
        b = broker(qty=5)
        order = b.close_position("NVDA")
        self.assertIsNotNone(order)
        body = b.client.bodies[-1]
        self.assertEqual(body["ORD_QTY"], "5")
        self.assertLess(float(body["OVRS_ORD_UNPR"]), b.client.price)

    def test_close_position_without_holding_is_none(self):
        self.assertIsNone(broker(qty=0).close_position("NVDA"))

    def test_clock_is_computed_from_new_york_time(self):
        c = broker().clock()
        self.assertIsInstance(c.is_open, bool)
        self.assertTrue(c.next_open.endswith("+00:00"))


class TestExecutorWithKIS(unittest.TestCase):
    """브래킷이 없는 브로커에서 실행기가 올바른 경로를 타는지."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = StateStore(str(Path(self.tmp.name) / "s.json"))
        self.store.load(50_000, today="2026-10-01")

    def tearDown(self):
        self.tmp.cleanup()

    def _ex(self, **kw):
        b = broker(**kw)
        return b, LiveExecutor(b, self.store, fill_timeout=2.0)

    def test_entry_uses_plain_order_not_bracket(self):
        b, ex = self._ex()
        e = ex.enter("NVDA", 5, 99.0, 104.0, ["정배열"], price_hint=101.4)
        self.assertEqual(e.kind, "ENTRY", e.message)
        self.assertEqual(ex.positions["NVDA"].qty, 5)
        self.assertAlmostEqual(ex.positions["NVDA"].entry, 100.0)  # 잔고의 실제 평단

    def test_position_is_flagged_unprotected_and_says_so(self):
        b, ex = self._ex()
        e = ex.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
        self.assertFalse(ex.positions["NVDA"].protected)
        self.assertIn("무방비", e.message)
        self.assertEqual(ex.unprotected, ["NVDA"])

    def test_protective_stop_marks_position_protected_when_supported(self):
        b = broker()
        b.caps.protective_stop = True
        ex = LiveExecutor(b, self.store, fill_timeout=2.0)
        e = ex.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
        self.assertEqual(e.kind, "ENTRY", e.message)
        self.assertTrue(ex.positions["NVDA"].protected)
        self.assertNotIn("무방비", e.message)
        self.assertEqual(ex.unprotected, [])
        self.assertIn("stop_order_id", self.store.state.intents["NVDA"])

    def test_rejected_order_leaves_no_position_or_intent(self):
        b, ex = self._ex(fail_order=True)
        e = ex.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
        self.assertEqual(e.kind, "REJECT")
        self.assertEqual(ex.positions, {})
        self.assertNotIn("NVDA", self.store.state.intents)

    def test_exit_sells_and_sync_books_the_trade(self):
        b, ex = self._ex()
        ex.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
        b.client.price = 103.0
        self.assertEqual(ex.exit("NVDA", "목표 도달").kind, "EXIT")
        events = ex.sync({"NVDA": 103.0})
        self.assertIn("EXIT", [e.kind for e in events])
        self.assertEqual(len(self.store.state.trades), 1)
        self.assertGreater(self.store.state.trades[0]["pnl"], 0)

    def test_restart_adopts_existing_holding(self):
        b, ex = self._ex()
        ex.enter("NVDA", 5, 99.0, 104.0, ["정배열"], price_hint=101.4)
        fresh = LiveExecutor(b, self.store, fill_timeout=2.0)
        events = fresh.sync({"NVDA": 101.4})
        self.assertEqual([e.kind for e in events], ["ADOPT"])
        self.assertAlmostEqual(fresh.positions["NVDA"].stop, 99.0)

    def test_unfilled_order_is_cancelled(self):
        class NoFill(FakeKIS):
            def _raw(self, method, path, body=None, params=None,
                     headers=None, auth=True):
                if path == self.spec["paths"]["order"] and body:
                    self.bodies.append({"tr_id": (headers or {}).get("tr_id", ""),
                                        **body})
                    return {"rt_cd": "0", "output": {"ODNO": "STUCK"}}  # 체결 안 됨
                return super()._raw(method, path, body, params, headers, auth)

        b = KISBroker(NoFill())
        ex = LiveExecutor(b, self.store, fill_timeout=1.0)
        e = ex.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
        self.assertEqual(e.kind, "REJECT")
        self.assertIn("미체결", e.message)
        self.assertEqual(ex.positions, {})


class TestRunnerShutdown(unittest.TestCase):
    def test_unprotected_positions_are_flattened_on_exit(self):
        from scalper.live.runner import LiveRunner
        from scalper.live.guards import GuardConfig
        from scalper.strategy import RiskConfig

        with tempfile.TemporaryDirectory() as d:
            b = broker()
            r = LiveRunner(b, ["NVDA"], cfg=RiskConfig(equity=50_000),
                           guard_cfg=GuardConfig(open_buffer_min=0,
                                                 close_buffer_min=0),
                           state_path=str(Path(d) / "s.json"),
                           use_context=False, on_log=lambda l: None)
            r.executor.fill_timeout = 2.0
            r.start()
            r.executor.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
            self.assertEqual(r.executor.unprotected, ["NVDA"])

            r._protect_on_exit()
            self.assertEqual(b.client.qty, 0.0, "무방비 포지션이 그대로 남았습니다")

    def test_protected_positions_are_left_alone(self):
        from scalper.live.runner import LiveRunner
        from scalper.live.guards import GuardConfig
        from scalper.strategy import RiskConfig

        with tempfile.TemporaryDirectory() as d:
            b = broker()
            b.caps.protective_stop = True
            r = LiveRunner(b, ["NVDA"], cfg=RiskConfig(equity=50_000),
                           guard_cfg=GuardConfig(), state_path=str(Path(d) / "s.json"),
                           use_context=False, on_log=lambda l: None)
            r.executor.fill_timeout = 2.0
            r.start()
            r.executor.enter("NVDA", 5, 99.0, 104.0, [], price_hint=101.4)
            before = b.client.qty
            r._protect_on_exit()
            self.assertEqual(b.client.qty, before, "보호된 포지션을 건드렸습니다")


if __name__ == "__main__":
    unittest.main()
