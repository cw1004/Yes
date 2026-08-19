"""명령줄 진입점.

    python3 -m scalper check                  환경 점검
    python3 -m scalper run                    대시보드 + 3슬롯 엔진 (시뮬레이션)
    python3 -m scalper run --live --auto      실 데이터 + 자동매매(페이퍼)
    python3 -m scalper scan                   워치리스트 스캔 → 오늘의 추천 3선
    python3 -m scalper news NVDA TSLA         종목 뉴스 팩트 + 이벤트 분류
    python3 -m scalper macro                  세계 정세·거시 레짐 판독
    python3 -m scalper backtest NVDA          워크포워드 검증
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from . import indicators
from .backtest import run as run_backtest
from .broker import AlpacaBroker, BrokerError, PaperBroker
from .engine import DEFAULT_TICKERS, WATCHLIST, Engine
from .feeds import FeedCreds, MarketFeed, TickSimulator
from .macro import MacroReader
from .news import NewsCollector
from .signals import buy_signal, sell_signal
from .strategy import RiskConfig, plan_levels

BAR = "─" * 74


def _cfg_from_args(a) -> RiskConfig:
    cfg = RiskConfig()
    for key in ("equity", "risk_per_trade", "buy_threshold", "sell_threshold",
                "max_positions", "stop_pct", "time_stop_min", "fee_bps"):
        val = getattr(a, key, None)
        if val is not None:
            setattr(cfg, key, type(getattr(cfg, key))(val))
    return cfg


def cmd_check(a) -> int:
    creds = FeedCreds.from_env()
    print(BAR)
    print("환경 점검")
    print(BAR)
    rows = [
        ("Alpaca 시세/주문 키", "OK" if creds.has_alpaca else "없음 (시뮬레이터로 동작)"),
        ("Finnhub 키", "OK" if creds.finnhub_key else "없음 (RSS 뉴스로 폴백)"),
        ("Marketaux 키", "OK" if os.environ.get("MARKETAUX_API_KEY") else "없음 (선택)"),
        ("실계좌 잠금 해제", "해제됨 ⚠" if os.environ.get("SCALPER_ALLOW_LIVE") == "1"
                             else "잠김 (안전)"),
    ]
    for k, v in rows:
        print(f"  {k:<22} {v}")

    print("\n네트워크 도달성")
    macro = MacroReader(ttl=0)
    t0 = time.time()
    pulse = macro.pulse(None, force=True)
    got = sum(1 for v in pulse.values.values() if v is not None)
    print(f"  FRED 거시 지표        {got}/{len(pulse.values)}개 수신 ({time.time()-t0:.1f}s)")
    news = NewsCollector(ttl=0).market_pulse(force=True)
    print(f"  시장 뉴스             {news.count}건 수신")
    if got == 0 and news.count == 0:
        print("\n  ⚠ 외부 데이터가 하나도 안 잡힙니다. 방화벽/프록시를 확인하세요.")
        print("    그래도 시뮬레이션 모드는 그대로 동작합니다.")

    if creds.has_alpaca:
        try:
            acct = AlpacaBroker(paper=not a.live_account).account()
            print(f"\n  Alpaca 계좌           {acct.get('status')} · "
                  f"자산 {acct.get('equity')} {acct.get('currency')}")
        except BrokerError as e:
            print(f"\n  Alpaca 계좌 오류      {e}")
    print(BAR)
    return 0


def cmd_macro(a) -> int:
    news = NewsCollector().market_pulse()
    pulse = MacroReader().pulse(news)
    print(BAR)
    print(f"세계 정세·거시 레짐: {pulse.label} ({pulse.regime})  점수 {pulse.score:+.1f}")
    print(BAR)
    for d in pulse.drivers:
        print(f"  • {d}")
    print(f"\n  지정학 리스크   {pulse.geo_risk:.0f}/100 "
          f"{'(' + ', '.join(pulse.geo_tags) + ')' if pulse.geo_tags else ''}")
    print(f"  포지션 사이즈   ×{pulse.size_multiplier:.2f}")
    print(f"  진입 문턱 보정  {pulse.entry_bias:+.1f}점")
    if news.count:
        print(f"\n  시장 뉴스 {news.label} ({news.score:+.0f}, {news.count}건)")
        for h in news.top[:5]:
            tag = ", ".join(h.events) or "-"
            print(f"    [{h.score:+5.0f}] {h.title[:70]}  ({tag})")
    if a.json:
        print("\n" + json.dumps(pulse.as_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_news(a) -> int:
    col = NewsCollector()
    for t in (a.tickers or DEFAULT_TICKERS):
        p = col.pulse(t)
        print(BAR)
        print(f"{p.ticker}  {p.label}  {p.score:+.1f}점  ({p.count}건)")
        if p.events:
            print(f"  이벤트: {', '.join(p.events)}")
        for h in p.top:
            print(f"  [{h.score:+5.0f}] {h.title[:78]}")
            print(f"          {h.source}  {', '.join(h.events) or '-'}")
        if not p.count:
            print("  수집된 뉴스 없음 — FINNHUB_API_KEY 를 넣으면 커버리지가 크게 올라갑니다.")
    return 0


def cmd_scan(a) -> int:
    """워치리스트 전체를 훑어 상위 3종목을 뽑습니다 (오늘의 추천 3선)."""
    cfg = _cfg_from_args(a)
    creds = FeedCreds.from_env()
    col = NewsCollector()
    macro = MacroReader(offline=a.offline).pulse(
        None if a.offline else col.market_pulse())
    tickers = a.tickers or WATCHLIST

    rows = []
    for t in tickers:
        feed = MarketFeed(t, creds, live=not a.offline)
        snap = indicators.compute(feed.candles)
        if snap.price <= 0:
            continue
        tech = buy_signal(snap, min_score=0)
        news = None if a.offline else col.pulse(t)
        from .strategy import combined_score
        score = combined_score(tech, news, macro)
        stop, target = plan_levels(snap, cfg, score, macro, news)
        rows.append((score, t, snap, tech, news, stop, target, feed.source))

    rows.sort(key=lambda r: -r[0])
    print(BAR)
    print(f"오늘의 추천 3선  ·  매크로 {macro.label}({macro.score:+.0f})  "
          f"진입문턱 {cfg.buy_threshold + macro.entry_bias:.0f}점")
    print(BAR)
    for rank, (score, t, snap, tech, news, stop, target, src) in enumerate(rows[:3], 1):
        print(f"{rank}. {t:<6} {score:5.1f}점   진입 {snap.price:.2f}  "
              f"손절 {stop:.2f}({(stop/snap.price-1)*100:+.2f}%)  "
              f"목표 {target:.2f}({(target/snap.price-1)*100:+.2f}%)")
        print(f"   이유: {', '.join(tech.tags) or '없음'}")
        if news and news.count:
            print(f"   뉴스: {news.label} {news.score:+.0f} "
                  f"({', '.join(news.events) or '특이 이벤트 없음'})")
        print(f"   매도압력 {sell_signal(snap, 0).score:.0f}점 · 소스 {src}")
    if len(rows) > 3:
        print("\n" + BAR)
        print("나머지: " + ", ".join(f"{t} {s:.0f}" for s, t, *_ in rows[3:]))
    return 0


def cmd_backtest(a) -> int:
    cfg = _cfg_from_args(a)
    creds = FeedCreds.from_env()
    total = 0.0
    for t in (a.tickers or DEFAULT_TICKERS):
        if a.offline:
            candles = TickSimulator(t, bars=a.bars, seed=a.seed).history()
            src = "simulator"
        else:
            feed = MarketFeed(t, creds, live=True)
            candles = feed.candles
            src = feed.source
        res = run_backtest(t, candles, cfg)
        total += res.net
        print(BAR)
        print(f"{res.summary()}   [{src}, {len(candles)}봉]")
        if src.startswith("simulator"):
            print("  ⚠ 시뮬레이터 데이터입니다 — 성과 수치는 로직 동작 확인용일 뿐,"
                  " 실제 기대수익이 아닙니다.")
        for tr in res.trades[-5:]:
            print(f"  {tr.entry:.2f} → {tr.exit:.2f}  {tr.pnl_pct:+.2f}%  "
                  f"진입: {', '.join(tr.reason_in[:3])} / 청산: {', '.join(tr.reason_out[:2])}")
    print(BAR)
    print(f"합계 순손익 {total:+.2f}$")
    print("※ 과거 성과는 미래를 보장하지 않습니다. 실계좌 전 반드시 페이퍼로 검증하세요.")
    return 0


def cmd_run(a) -> int:
    cfg = _cfg_from_args(a)
    broker = None
    if a.broker == "alpaca":
        try:
            broker = AlpacaBroker(paper=not a.live_account)
        except BrokerError as e:
            print(f"브로커 초기화 실패: {e}", file=sys.stderr)
            return 2
        if not broker.configured:
            print("ALPACA_API_KEY / ALPACA_API_SECRET 가 없습니다.", file=sys.stderr)
            return 2
    elif a.broker == "paper":
        broker = PaperBroker(equity=cfg.equity)

    engine = Engine(tickers=a.tickers, cfg=cfg, live=a.live, auto=a.auto,
                    broker=broker, offline=a.offline)

    if a.headless:
        print(f"헤드리스 모드 · {[s.ticker for s in engine.slots]} · "
              f"AUTO={'ON' if a.auto else 'OFF'} · Ctrl+C 로 종료")
        try:
            engine.run(interval=a.interval)
        except KeyboardInterrupt:
            engine.stop()
            print("\n종료합니다.")
        return 0

    from .server import serve

    httpd = serve(engine, host=a.host, port=a.port, interval=a.interval)
    mode = ("실 데이터" if a.live else "시뮬레이션")
    order = {"alpaca": "Alpaca " + ("실계좌 ⚠" if a.live_account else "페이퍼"),
             "paper": "내장 모의체결", None: "체결 없음(신호만)"}[a.broker]
    print(BAR)
    print(f"  대시보드   http://{a.host}:{a.port}")
    print(f"  슬롯       {' / '.join(s.ticker for s in engine.slots)}")
    print(f"  데이터     {mode}      주문   {order}")
    print(f"  AUTO       {'ON' if a.auto else 'OFF'}      갱신주기 {a.interval}초")
    print(BAR)
    print("  Ctrl+C 로 종료")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        engine.stop()
        httpd.shutdown()
        print("\n종료합니다.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scalper", description="실시간 3분할 단타 스캘핑 트래커")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--equity", type=float, help="계좌 평가금액 (기본 10000)")
        sp.add_argument("--risk-per-trade", dest="risk_per_trade", type=float,
                        help="1회 매매 리스크 비율 (기본 0.005 = 0.5%%)")
        sp.add_argument("--buy-threshold", dest="buy_threshold", type=float,
                        help="매수 진입 문턱 점수 (기본 65)")
        sp.add_argument("--sell-threshold", dest="sell_threshold", type=float)
        sp.add_argument("--max-positions", dest="max_positions", type=int)
        sp.add_argument("--stop-pct", dest="stop_pct", type=float,
                        help="기본 손절폭 (0.017 = -1.7%%)")
        sp.add_argument("--time-stop-min", dest="time_stop_min", type=int)
        sp.add_argument("--fee-bps", dest="fee_bps", type=float,
                        help="왕복 수수료+슬리피지 (bp, 기본 1.0)")
        sp.add_argument("--offline", action="store_true",
                        help="외부 호출 없이 시뮬레이터만 사용")

    sp = sub.add_parser("check", help="환경 점검")
    sp.add_argument("--live-account", dest="live_account", action="store_true")
    sp.set_defaults(func=cmd_check)

    sp = sub.add_parser("macro", help="세계 정세·거시 레짐 판독")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_macro)

    sp = sub.add_parser("news", help="종목 뉴스 팩트 수집")
    sp.add_argument("tickers", nargs="*")
    sp.set_defaults(func=cmd_news)

    sp = sub.add_parser("scan", help="워치리스트 스캔 → 추천 3선")
    sp.add_argument("tickers", nargs="*")
    common(sp)
    sp.set_defaults(func=cmd_scan)

    sp = sub.add_parser("backtest", help="워크포워드 검증")
    sp.add_argument("tickers", nargs="*")
    sp.add_argument("--bars", type=int, default=400)
    sp.add_argument("--seed", type=int, default=7)
    common(sp)
    sp.set_defaults(func=cmd_backtest)

    sp = sub.add_parser("run", help="대시보드 + 3슬롯 엔진")
    sp.add_argument("tickers", nargs="*", help="슬롯 1/2/3 종목 (기본 NVDA TSLA AAPL)")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8787)
    sp.add_argument("--interval", type=float, default=1.5, help="틱 주기(초)")
    sp.add_argument("--live", action="store_true", help="실 시세 피드 사용")
    sp.add_argument("--auto", action="store_true", help="시작부터 AUTO ON")
    sp.add_argument("--headless", action="store_true", help="웹 없이 콘솔만")
    sp.add_argument("--broker", choices=["paper", "alpaca"], default=None,
                    help="주문 실행기 (미지정 시 신호만 기록)")
    sp.add_argument("--live-account", dest="live_account", action="store_true",
                    help="⚠ Alpaca 실계좌. SCALPER_ALLOW_LIVE=1 도 필요")
    common(sp)
    sp.set_defaults(func=cmd_run)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
