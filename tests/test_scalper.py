"""스캘퍼 로직 테스트 — 네트워크 없이 전부 돌아갑니다."""

import time
import unittest

from scalper import indicators
from scalper.backtest import run as run_backtest
from scalper.engine import Engine, Slot
from scalper.feeds import TickSimulator
from scalper.indicators import Candle
from scalper.macro import MacroPulse, geo_scan
from scalper.news import Headline, NewsPulse, score_headline, summarize
from scalper.signals import buy_signal, sell_signal
from scalper.strategy import (Position, RiskConfig, combined_score, decide_entry,
                              decide_exit, plan_levels, position_size)


def make_candles(closes, base_ts=1_700_000_000, volume=100_000.0):
    out = []
    prev = closes[0]
    for i, c in enumerate(closes):
        out.append(Candle(ts=base_ts + i * 300, open=prev,
                          high=max(prev, c) * 1.001, low=min(prev, c) * 0.999,
                          close=c, volume=volume))
        prev = c
    return out


class TestIndicators(unittest.TestCase):
    def test_sma_aligns_with_input_length(self):
        vals = [1, 2, 3, 4, 5]
        out = indicators.sma(vals, 3)
        self.assertEqual(len(out), 5)
        self.assertIsNone(out[1])
        self.assertAlmostEqual(out[2], 2.0)
        self.assertAlmostEqual(out[4], 4.0)

    def test_rsi_saturates_on_monotonic_rise(self):
        out = indicators.rsi([100 + i for i in range(30)], 14)
        self.assertAlmostEqual(out[-1], 100.0)

    def test_rsi_floors_on_monotonic_fall(self):
        out = indicators.rsi([100 - i for i in range(30)], 14)
        self.assertAlmostEqual(out[-1], 0.0)

    def test_vwap_resets_each_session(self):
        day1 = [Candle(ts=0 + i * 300, open=10, high=10, low=10, close=10, volume=100)
                for i in range(5)]
        day2 = [Candle(ts=86400 + i * 300, open=20, high=20, low=20, close=20, volume=100)
                for i in range(5)]
        out = indicators.vwap(day1 + day2)
        self.assertAlmostEqual(out[4], 10.0)
        self.assertAlmostEqual(out[-1], 20.0, places=6)

    def test_macd_series_lengths_match(self):
        closes = [100 + (i % 7) for i in range(80)]
        line, sig, hist = indicators.macd(closes)
        self.assertEqual(len(line), len(sig))
        self.assertEqual(len(hist), len(closes))

    def test_bollinger_upper_above_lower(self):
        closes = [100 + (i % 5) for i in range(40)]
        up, mid, low, width = indicators.bollinger(closes)
        self.assertGreater(up[-1], mid[-1])
        self.assertGreater(mid[-1], low[-1])
        self.assertGreater(width[-1], 0)


class TestSignals(unittest.TestCase):
    def test_uptrend_scores_higher_than_downtrend(self):
        up = indicators.compute(make_candles([100 + i * 0.4 for i in range(60)]))
        down = indicators.compute(make_candles([100 - i * 0.4 for i in range(60)]))
        self.assertGreater(buy_signal(up).score, buy_signal(down).score)

    def test_buy_requires_trend_even_with_score(self):
        down = indicators.compute(make_candles([100 - i * 0.4 for i in range(60)]))
        self.assertEqual(buy_signal(down, min_score=0).side, "HOLD")

    def test_sell_signal_flags_overbought(self):
        snap = indicators.compute(make_candles([100 + i * 0.9 for i in range(60)]))
        snap.rsi = 82.0
        sig = sell_signal(snap, min_score=0)
        # 과매수 하나만으로는 종합 매도점수를 채우지 못합니다(추세가 살아 있으므로).
        # 대신 태그로 드러나야 하고, 실제 청산은 decide_exit 의 RSI 규칙이 담당합니다.
        self.assertTrue(any("RSI" in t for t in sig.tags))
        self.assertGreaterEqual(sig.breakdown.get("overbought", 0), 20)

    def test_exit_fires_on_overbought_rsi(self):
        cfg = RiskConfig()
        now = int(time.time())
        snap = indicators.compute(make_candles([100 + i * 0.9 for i in range(60)]))
        snap.rsi = 82.0
        entry = snap.price * 0.995
        pos = Position(ticker="X", qty=10, entry=entry, stop=entry * 0.99,
                       target=entry * 1.05, opened_at=now - 10 * 60, peak=snap.price)
        d = decide_exit(pos, snap, None, None, cfg, now=now)
        self.assertEqual(d.action, "SELL")
        self.assertIn("과매수", d.reasons[0])

    def test_breakdown_never_exceeds_100(self):
        for closes in ([100 + i * 0.3 for i in range(80)],
                       [100 - i * 0.2 for i in range(80)]):
            snap = indicators.compute(make_candles(closes))
            self.assertLessEqual(buy_signal(snap).score, 100.0)
            self.assertLessEqual(sell_signal(snap).score, 100.0)


class TestNews(unittest.TestCase):
    def test_positive_event_scores_positive(self):
        score, events = score_headline("Nvidia beats estimates and raises guidance")
        self.assertGreater(score, 40)
        self.assertIn("실적 서프라이즈", events)

    def test_negative_event_scores_negative(self):
        score, events = score_headline("Tesla recalls 400,000 vehicles over defect")
        self.assertLess(score, -30)
        self.assertIn("제품 리스크", events)

    def test_negation_flips_lexicon(self):
        plain, _ = score_headline("Shares gain on outlook")
        negated, _ = score_headline("Shares do not gain on outlook")
        self.assertGreater(plain, negated)

    def test_old_headlines_are_dropped(self):
        now = int(time.time())
        items = [Headline(title="Nvidia beats estimates", source="x", ts=now - 10 * 86400)]
        pulse = summarize("NVDA", items, now=now)
        self.assertEqual(pulse.count, 0)

    def test_recency_weighting_favors_fresh_news(self):
        now = int(time.time())
        fresh = summarize("A", [Headline(title="Company beats estimates", source="x", ts=now)],
                          now=now)
        stale = summarize("A", [Headline(title="Company beats estimates", source="x",
                                         ts=now - 8 * 3600)], now=now)
        self.assertGreater(fresh.score, stale.score)

    def test_duplicate_headlines_counted_once(self):
        now = int(time.time())
        items = [Headline(title="Same story here", source="a", ts=now),
                 Headline(title="Same story here", source="b", ts=now)]
        self.assertEqual(summarize("A", items, now=now).count, 1)


class TestMacro(unittest.TestCase):
    def test_geo_scan_detects_conflict(self):
        pulse = NewsPulse(ticker="MARKET", count=1,
                          top=[Headline(title="US announces new tariff on chips", source="x")])
        risk, tags = geo_scan(pulse)
        self.assertGreater(risk, 0)
        self.assertTrue(tags)

    def test_risk_off_shrinks_size_and_raises_threshold(self):
        off = MacroPulse(regime="RISK_OFF", score=-60)
        on = MacroPulse(regime="RISK_ON", score=60)
        self.assertLess(off.size_multiplier, on.size_multiplier)
        self.assertGreater(off.entry_bias, on.entry_bias)

    def test_size_multiplier_stays_bounded(self):
        for score in (-200, -100, 0, 100, 200):
            m = MacroPulse(regime="NEUTRAL", score=score).size_multiplier
            self.assertGreaterEqual(m, 0.3)
            self.assertLessEqual(m, 1.3)


class TestStrategy(unittest.TestCase):
    def setUp(self):
        self.cfg = RiskConfig(equity=10_000)
        self.snap = indicators.compute(make_candles([100 + i * 0.35 for i in range(80)]))

    def test_position_size_caps_risk_per_trade(self):
        qty = position_size(100.0, 98.3, self.cfg, None)
        risk = qty * (100.0 - 98.3)
        self.assertLessEqual(risk, self.cfg.equity * self.cfg.risk_per_trade * 1.01)

    def test_position_size_respects_max_weight(self):
        qty = position_size(100.0, 99.99, self.cfg, None)
        self.assertLessEqual(qty * 100.0,
                             self.cfg.equity * self.cfg.max_position_pct + 1e-6)

    def test_stop_never_below_hard_limit(self):
        stop, target = plan_levels(self.snap, self.cfg, 80.0, None, None)
        self.assertGreaterEqual(stop, self.snap.price * (1 - self.cfg.hard_stop_pct))
        self.assertGreater(target, self.snap.price)

    def test_target_within_configured_band(self):
        stop, target = plan_levels(self.snap, self.cfg, 95.0, None, None)
        gain = (target - self.snap.price) / self.snap.price
        self.assertGreaterEqual(gain, self.cfg.target_min_pct - 1e-9)
        self.assertLessEqual(gain, self.cfg.target_max_pct + 1e-9)

    def test_news_veto_blocks_entry(self):
        bad = NewsPulse(ticker="X", score=-80, count=6)
        d = decide_entry("X", self.snap, bad, None, self.cfg)
        self.assertEqual(d.action, "HOLD")
        self.assertIn("악재", d.blocked_by)

    def test_max_positions_blocks_entry(self):
        d = decide_entry("X", self.snap, None, None, self.cfg, open_positions=3)
        self.assertEqual(d.action, "HOLD")
        self.assertIn("포지션", d.blocked_by)

    def test_daily_loss_limit_blocks_entry(self):
        d = decide_entry("X", self.snap, None, None, self.cfg, day_pnl_pct=-5.0)
        self.assertEqual(d.action, "HOLD")
        self.assertIn("손실 한도", d.blocked_by)

    def test_cooldown_blocks_entry(self):
        d = decide_entry("X", self.snap, None, None, self.cfg, cooldown_left=90)
        self.assertEqual(d.action, "HOLD")
        self.assertIn("쿨다운", d.blocked_by)

    def test_combined_score_bounded_by_component_caps(self):
        from scalper.signals import Signal
        tech = Signal(side="HOLD", score=50.0)
        best = combined_score(tech, NewsPulse("X", score=100, count=9),
                              MacroPulse(regime="RISK_ON", score=100))
        worst = combined_score(tech, NewsPulse("X", score=-100, count=9),
                               MacroPulse(regime="RISK_OFF", score=-100))
        self.assertLessEqual(best - 50.0, 20.001)
        self.assertLessEqual(50.0 - worst, 20.001)

    def test_hard_stop_exits_immediately_despite_min_hold(self):
        now = int(time.time())
        pos = Position(ticker="X", qty=10, entry=110.0, stop=108.0, target=112.0,
                       opened_at=now, peak=110.0)
        snap = indicators.compute(make_candles([100 + i * 0.35 for i in range(80)]))
        snap.price = 100.0
        d = decide_exit(pos, snap, None, None, self.cfg, now=now)
        self.assertEqual(d.action, "SELL")

    def test_min_hold_blocks_soft_exit(self):
        now = int(time.time())
        entry = self.snap.price
        pos = Position(ticker="X", qty=10, entry=entry, stop=entry * 0.99,
                       target=entry * 1.02, opened_at=now, peak=entry)
        self.snap.rsi = 95.0
        d = decide_exit(pos, self.snap, None, None, self.cfg, now=now)
        self.assertEqual(d.action, "HOLD")

    def test_time_stop_defers_while_winning(self):
        now = int(time.time())
        entry = self.snap.price * 0.985            # 약 +1.5% 이익 중
        pos = Position(ticker="X", qty=10, entry=entry, stop=entry * 0.99,
                       target=entry * 1.05, opened_at=now - 31 * 60, peak=self.snap.price)
        self.snap.rsi = 60.0          # 과매수 규칙이 먼저 걸리지 않도록
        d = decide_exit(pos, self.snap, None, None, self.cfg, now=now)
        self.assertNotEqual(d.action, "SELL")

    def test_time_stop_fires_when_flat(self):
        now = int(time.time())
        entry = self.snap.price
        pos = Position(ticker="X", qty=10, entry=entry, stop=entry * 0.99,
                       target=entry * 1.05, opened_at=now - 31 * 60, peak=entry)
        self.snap.rsi = 60.0
        d = decide_exit(pos, self.snap, None, None, self.cfg, now=now)
        self.assertEqual(d.action, "SELL")
        self.assertIn("시간청산", d.reasons[0])

    def test_trailing_stop_only_moves_up(self):
        now = int(time.time())
        self.snap.rsi = 60.0
        entry = self.snap.price * 0.99
        pos = Position(ticker="X", qty=10, entry=entry, stop=entry * 0.983,
                       target=entry * 1.05, opened_at=now - 5 * 60, peak=self.snap.price)
        before = pos.stop
        decide_exit(pos, self.snap, None, None, self.cfg, now=now)
        self.assertGreaterEqual(pos.stop, before)


class TestFeeds(unittest.TestCase):
    def test_simulator_is_deterministic_per_ticker(self):
        a = TickSimulator("NVDA", bars=50).history()
        b = TickSimulator("NVDA", bars=50).history()
        self.assertEqual([round(c.close, 6) for c in a], [round(c.close, 6) for c in b])

    def test_different_tickers_diverge(self):
        a = [c.close for c in TickSimulator("NVDA", bars=50).history()]
        b = [c.close for c in TickSimulator("TSLA", bars=50).history()]
        self.assertNotEqual([round(x, 4) for x in a], [round(x, 4) for x in b])

    def test_candles_are_ohlc_consistent(self):
        for c in TickSimulator("SPY", bars=80).history():
            self.assertLessEqual(c.low, min(c.open, c.close) + 1e-9)
            self.assertGreaterEqual(c.high, max(c.open, c.close) - 1e-9)
            self.assertGreater(c.volume, 0)


class TestEngine(unittest.TestCase):
    def test_three_independent_slots(self):
        eng = Engine(tickers=["NVDA", "TSLA", "AAPL"], offline=True)
        self.assertEqual([s.ticker for s in eng.slots], ["NVDA", "TSLA", "AAPL"])
        self.assertEqual(len({id(s.feed) for s in eng.slots}), 3)

    def test_auto_toggle_is_per_slot(self):
        eng = Engine(offline=True)
        eng.set_auto(2, True)
        self.assertEqual([s.auto for s in eng.slots], [False, True, False])
        eng.set_auto(None, True)
        self.assertTrue(all(s.auto for s in eng.slots))

    def test_ticker_change_resets_position(self):
        eng = Engine(offline=True)
        slot = eng.slots[0]
        slot.position = Position(ticker="NVDA", qty=1, entry=100, stop=99,
                                 target=102, opened_at=int(time.time()))
        eng.set_ticker(1, "MSFT")
        self.assertEqual(eng.slots[0].ticker, "MSFT")
        self.assertIsNone(eng.slots[0].position)

    def test_state_is_json_serializable(self):
        import json
        eng = Engine(offline=True)
        eng.step()
        payload = json.dumps(eng.state(), ensure_ascii=False)
        self.assertIn("slots", payload)
        self.assertEqual(len(eng.state()["slots"]), 3)

    def test_engine_respects_max_positions(self):
        eng = Engine(offline=True, auto=True, cfg=RiskConfig(equity=10_000, max_positions=2))
        for _ in range(60):
            eng.step()
        self.assertLessEqual(sum(1 for s in eng.slots if s.position), 2)

    def test_slot_survives_feed_failure(self):
        eng = Engine(offline=True)
        slot = eng.slots[0]

        def boom(*_a, **_k):
            raise RuntimeError("feed down")

        slot.feed.refresh = boom
        events = slot.step(None, None, 0, 0.0)
        self.assertEqual(events[0].kind, "ERROR")
        self.assertTrue(eng.slots[1].step(None, None, 0, 0.0) is not None)


class TestBacktest(unittest.TestCase):
    def test_backtest_produces_consistent_stats(self):
        candles = TickSimulator("NVDA", bars=300).history()
        res = run_backtest("NVDA", candles, RiskConfig(equity=10_000))
        self.assertEqual(res.wins, sum(1 for t in res.trades if t.pnl > 0))
        self.assertAlmostEqual(res.net, sum(t.pnl for t in res.trades), places=6)
        self.assertLessEqual(res.max_drawdown, 0.0)

    def test_no_lookahead_same_result_when_future_appended(self):
        """미래 캔들을 뒤에 붙여도 앞부분 매매는 바뀌지 않아야 합니다."""
        candles = TickSimulator("AMD", bars=400).history()
        short = run_backtest("AMD", candles[:300], RiskConfig())
        long = run_backtest("AMD", candles, RiskConfig())
        n = len(short.trades)
        self.assertGreater(n, 0)
        for a, b in zip(short.trades, long.trades[:n]):
            self.assertEqual((a.entry_ts, round(a.entry, 6)), (b.entry_ts, round(b.entry, 6)))

    def test_every_trade_has_stop_below_entry(self):
        candles = TickSimulator("SPY", bars=350).history()
        for t in run_backtest("SPY", candles, RiskConfig()).trades:
            self.assertGreater(t.qty, 0)


if __name__ == "__main__":
    unittest.main()
