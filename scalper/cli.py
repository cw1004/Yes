"""명령줄 진입점.

    python3 -m scalper doctor                 화면이 안 뜰 때 원인 진단
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
import pathlib
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


def _resolve_port(host: str, port: int) -> int | None:
    """포트가 막혀 있으면 빈 번호로 비켜 갑니다.

    여기서 그냥 터지면 사용자에게는 트레이스백만 보이고 '안 열린다' 로 끝납니다.
    비켜 간 사실은 크게 알려서, 주소를 착각하지 않게 합니다.
    """
    from .doctor import find_free_port, port_free

    if port_free(host, port):
        return port
    alt = find_free_port(host, port + 1)
    if alt is None:
        print(f"포트 {port} 부터 20개가 모두 사용 중입니다. "
              f"--port 로 다른 번호를 지정하세요.", file=sys.stderr)
        return None
    print(f"⚠ 포트 {port} 이 이미 사용 중이라 {alt} 로 띄웁니다.", file=sys.stderr)
    return alt


def cmd_doctor(a) -> int:
    """화면이 안 뜰 때 원인을 찾아줍니다. 실제로 서버를 띄워 스스로 접속해 봅니다."""
    from . import doctor

    return doctor.run(host=a.host, port=a.port)


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


def _live_client(a):
    """브로커 선택 + 실계좌 2중 잠금. preflight / live / kis-probe 가 공유합니다."""
    from .live.types import BrokerError

    if a.real and os.environ.get("SCALPER_ALLOW_LIVE") != "1":
        print("실계좌는 SCALPER_ALLOW_LIVE=1 까지 있어야 열립니다.\n"
              "  모의투자로 최소 2주 검증한 뒤에 켜세요.", file=sys.stderr)
        return None

    broker = getattr(a, "broker_api", "alpaca")
    try:
        if broker == "kis":
            from .live.kis import KISBroker, KISClient, KISCredentials, spec

            creds = KISCredentials.from_env()
            if not creds.complete:
                print("KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT(계좌 8자리) "
                      "환경변수가 필요합니다.\n"
                      "  https://apiportal.koreainvestment.com 에서 발급하고, "
                      "모의투자 신청도 함께 하세요.", file=sys.stderr)
                return None
            client = KISClient(creds, paper=not a.real, spec=spec.load())
            return KISBroker(client, exchange=getattr(a, "exchange", None))

        from .live import AlpacaClient
        key = os.environ.get("ALPACA_API_KEY", "")
        secret = os.environ.get("ALPACA_API_SECRET", "")
        if not (key and secret):
            print("ALPACA_API_KEY / ALPACA_API_SECRET 환경변수가 필요합니다.\n"
                  "  https://alpaca.markets 에서 페이퍼 계좌 키를 먼저 받으세요.\n"
                  "  한국투자증권을 쓰려면 --broker-api kis 를 붙이세요.",
                  file=sys.stderr)
            return None
        return AlpacaClient(key, secret, paper=not a.real)
    except BrokerError as e:
        print(f"브로커 초기화 실패: {e}", file=sys.stderr)
        return None


def cmd_kis_probe(a) -> int:
    """KIS 응답을 날것으로 보여줍니다. 명세를 맞추는 용도. 주문은 내지 않습니다."""
    from .live.kis import probe
    from .live.types import BrokerError

    a.broker_api = "kis"
    broker = _live_client(a)
    if broker is None:
        return 2
    try:
        return probe.run(broker, a.symbol)
    except BrokerError as e:
        print(f"확인 실패: {e}", file=sys.stderr)
        return 1


def cmd_preflight(a) -> int:
    """주문을 내기 전에 계좌·데이터·수량이 실제로 맞는지 끝까지 확인합니다."""
    from .live import preflight
    from .live.guards import GuardConfig
    from .live.client import AlpacaError

    client = _live_client(a)
    if client is None:
        return 2

    try:
        report = preflight.run(client, a.tickers or DEFAULT_TICKERS,
                               cfg=_cfg_from_args(a),
                               guard_cfg=GuardConfig(), feed=a.feed)
    except AlpacaError as e:
        print(f"점검 실패: {e}", file=sys.stderr)
        return 1

    print(report.render())
    return 0 if report.go else 1


def cmd_live(a) -> int:
    """실제 브로커에 주문을 내는 경로. 기본은 페이퍼 계좌입니다."""
    from .live import AlpacaError, GuardConfig, LiveRunner

    client = _live_client(a)
    if client is None:
        return 2

    cfg = _cfg_from_args(a)
    guards = GuardConfig(
        allow_extended_hours=a.extended,
        open_buffer_min=a.open_buffer,
        close_buffer_min=a.close_buffer,
        respect_pdt=not a.ignore_pdt,
        daily_loss_limit_pct=cfg.daily_loss_limit_pct * 100,
        min_equity=a.min_equity or 0.0,
    )

    runner = LiveRunner(client, a.tickers or DEFAULT_TICKERS, cfg=cfg,
                        guard_cfg=guards, state_path=a.state,
                        use_context=not a.no_context)

    print(BAR)
    print(f"  모드       {'⚠ 실계좌 — 진짜 돈이 나갑니다' if a.real else '페이퍼 계좌 (모의)'}")
    print(f"  종목       {' / '.join(s.ticker for s in runner.slots)}")
    print(f"  리스크     1회 {cfg.risk_per_trade*100:.2f}% · 최대 {cfg.max_positions}포지션 "
          f"· 일일한도 -{cfg.daily_loss_limit_pct*100:.1f}%")
    print(f"  주기       {a.interval}초 · 상태파일 {a.state}")
    if a.serve:
        from .live.monitor import serve as serve_monitor

        port = _resolve_port("127.0.0.1", a.serve)
        if port is None:
            return 2
        serve_monitor(runner, port=port)
        print(f"  모니터     http://127.0.0.1:{port}  (읽기 전용)")
    print(f"  정지       Ctrl+C 또는 `touch {guards.halt_file}` (즉시 전량 청산)")
    print(BAR)

    try:
        runner.run(interval=a.interval, iterations=a.iterations)
    except AlpacaError as e:
        print(f"치명적 오류: {e}", file=sys.stderr)
        return 1
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

    port = _resolve_port(a.host, a.port)
    if port is None:
        return 2
    httpd = serve(engine, host=a.host, port=port, interval=a.interval)
    mode = ("실 데이터" if a.live else "시뮬레이션")
    order = {"alpaca": "Alpaca " + ("실계좌 ⚠" if a.live_account else "페이퍼"),
             "paper": "내장 모의체결", None: "체결 없음(신호만)"}[a.broker]
    print(BAR)
    print(f"  대시보드   http://{a.host}:{port}")
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

    sp = sub.add_parser("doctor", help="화면이 안 뜰 때 원인 진단")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8787)
    sp.set_defaults(func=cmd_doctor)

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

    sp = sub.add_parser("kis-probe", help="한국투자증권 응답 확인 (주문 없음)")
    sp.add_argument("symbol", nargs="?", default="NVDA", help="확인할 종목")
    sp.add_argument("--real", action="store_true",
                    help="⚠ 실전 계좌로 조회 (SCALPER_ALLOW_LIVE=1 필요)")
    sp.add_argument("--exchange", default=None,
                    choices=["NASDAQ", "NYSE", "AMEX"])
    sp.set_defaults(func=cmd_kis_probe)

    sp = sub.add_parser("preflight", help="실전 투입 가능 여부 점검 (주문 없음)")
    sp.add_argument("tickers", nargs="*", help="점검할 종목 (기본 NVDA TSLA AAPL)")
    sp.add_argument("--real", action="store_true",
                    help="⚠ 실계좌로 점검 (SCALPER_ALLOW_LIVE=1 필요)")
    sp.add_argument("--feed", default="iex", choices=["iex", "sip"],
                    help="데이터 피드. 무료 플랜은 iex 만 됩니다")
    sp.add_argument("--broker-api", dest="broker_api", default="alpaca",
                    choices=["alpaca", "kis"],
                    help="주문을 낼 증권사 (기본 alpaca)")
    sp.add_argument("--exchange", default=None,
                    choices=["NASDAQ", "NYSE", "AMEX"],
                    help="KIS 전용 — 거래소 (기본 NASDAQ)")
    common(sp)
    sp.set_defaults(func=cmd_preflight)

    sp = sub.add_parser("live", help="실전 매매 (Alpaca)")
    sp.add_argument("tickers", nargs="*", help="종목 3개 (기본 NVDA TSLA AAPL)")
    sp.add_argument("--interval", type=float, default=5.0,
                    help="틱 주기(초). API 분당 200콜 예산을 지키려면 3초 이상 권장")
    sp.add_argument("--iterations", type=int, default=None, help="N번만 돌고 종료")
    sp.add_argument("--state", default=".scalper_state.json",
                    help="하루 상태 저장 파일 (재시작해도 손실 한도가 유지됩니다)")
    sp.add_argument("--real", action="store_true",
                    help="⚠ 실계좌. SCALPER_ALLOW_LIVE=1 도 필요합니다")
    sp.add_argument("--extended", action="store_true", help="프리/애프터장 허용")
    sp.add_argument("--open-buffer", dest="open_buffer", type=int, default=5,
                    help="개장 후 N분간 신규 진입 금지")
    sp.add_argument("--close-buffer", dest="close_buffer", type=int, default=15,
                    help="마감 N분 전부터 신규 진입 금지")
    sp.add_argument("--ignore-pdt", dest="ignore_pdt", action="store_true",
                    help="PDT 제한 무시 (권장하지 않습니다)")
    sp.add_argument("--min-equity", dest="min_equity", type=float, default=0.0,
                    help="자산이 이 아래면 신규 진입 중단")
    sp.add_argument("--no-context", dest="no_context", action="store_true",
                    help="뉴스·매크로 없이 기술 신호만 사용")
    sp.add_argument("--serve", type=int, default=0, metavar="PORT",
                    help="읽기 전용 모니터 화면을 이 포트로 띄웁니다 (예: 8790)")
    sp.add_argument("--broker-api", dest="broker_api", default="alpaca",
                    choices=["alpaca", "kis"],
                    help="주문을 낼 증권사 (기본 alpaca)")
    sp.add_argument("--exchange", default=None,
                    choices=["NASDAQ", "NYSE", "AMEX"],
                    help="KIS 전용 — 거래소 (기본 NASDAQ)")
    common(sp)
    sp.set_defaults(func=cmd_live)

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
    # 키는 .env 파일로도 넣을 수 있습니다. 이미 설정된 환경변수가 우선입니다.
    from . import envfile

    applied, path = envfile.load()
    if applied:
        print(f"· {path} 에서 {len(applied)}개 설정을 읽었습니다 "
              f"({', '.join(sorted(applied)[:4])}{' …' if len(applied) > 4 else ''})",
              file=sys.stderr)
        if envfile.is_world_readable(pathlib.Path(path)):
            print(f"  ⚠ {path} 를 다른 사용자도 읽을 수 있습니다. "
                  f"chmod 600 {path} 를 권장합니다.", file=sys.stderr)

    args = build_parser().parse_args(argv)
    return args.func(args)
