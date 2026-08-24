"""명령줄 인터페이스.

    python -m kis check                 설정/인증/계좌 확인
    python -m kis price 005930          현재가
    python -m kis balance               잔고
    python -m kis buy 005930 -q 1 -p 70000
    python -m kis run --strategy sma_cross --symbols 005930,000660
    python -m kis web --host 0.0.0.0    폰 브라우저용 대시보드
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

from . import KisTrader, __version__
from .errors import KisError
from .logging_setup import setup_logging
from .market import is_market_open, now_kst
from .models import OrderType, Side
from .realtime import TR_TICK, RealtimeMessage
from .strategy import REGISTRY, ExitPolicy, create_strategy
from .textutil import row

log = logging.getLogger("kis.cli")


def _won(value: float | int) -> str:
    return f"{int(value):,}원"


def _split_symbols(raw: str) -> list[str]:
    return [s.strip() for s in raw.replace(" ", ",").split(",") if s.strip()]


def _confirm_real_order(trader: KisTrader, assume_yes: bool) -> bool:
    """실전 계좌에서 실제 주문을 내기 직전 마지막 확인."""
    if trader.settings.dry_run or trader.settings.is_paper:
        return True
    if assume_yes:
        return True
    print("\n" + "!" * 60)
    print("  실전투자 계좌에 실제 주문이 전송됩니다.")
    print(f"  계좌: {trader.settings.account_no[:4]}****-{trader.settings.account_product_code}")
    print("!" * 60)
    answer = input("계속하려면 '실행' 을 입력하세요: ").strip()
    return answer == "실행"


# ---------------------------------------------------------------------- 명령
def cmd_check(trader: KisTrader, args: argparse.Namespace) -> int:
    settings = trader.settings
    print("== 설정 ==")
    for key, value in settings.masked().items():
        print(f"  {key:20s}: {value}")
    print(f"  {'rest_base':20s}: {settings.rest_base}")
    print(f"  {'ws_base':20s}: {settings.ws_base}")
    print(f"  {'data_dir':20s}: {settings.data_dir}")

    print("\n== 인증 ==")
    token = trader.client.tokens.access_token
    print(f"  접근토큰 발급 성공 ({token[:12]}...)")

    print("\n== 시세 ==")
    quote = trader.quotes.price(args.symbol)
    print(f"  {args.symbol} 현재가 {_won(quote.price)} ({quote.change_rate:+.2f}%)")

    print("\n== 계좌 ==")
    balance = trader.trading.balance()
    print(f"  예수금 {_won(balance.cash)} / 주문가능 {_won(balance.available_cash)}")
    print(f"  평가금액 {_won(balance.total_eval)} / 평가손익 {_won(balance.total_pnl)}")
    print(f"  보유 종목 {len(balance.positions)}개")

    print("\n== 시장 ==")
    print(f"  현재 KST {now_kst():%Y-%m-%d %H:%M:%S} / 정규장 {'열림' if is_market_open() else '닫힘'}")
    print("\n모든 점검을 통과했습니다.")
    return 0


def cmd_price(trader: KisTrader, args: argparse.Namespace) -> int:
    for symbol in _split_symbols(args.symbols):
        q = trader.quotes.price(symbol)
        print(
            f"{symbol} {q.name:<12} {_won(q.price):>12} "
            f"{q.change:+,}원 ({q.change_rate:+.2f}%) 거래량 {q.volume:,} "
            f"고 {q.high:,} 저 {q.low:,}"
        )
    return 0


def cmd_orderbook(trader: KisTrader, args: argparse.Namespace) -> int:
    book = trader.quotes.orderbook(args.symbol)
    print(f"== {args.symbol} 호가 ==")
    for level in reversed(book.asks[: args.depth]):
        print(f"  매도 {level.price:>10,}  {level.quantity:>10,}")
    print(f"  {'-' * 30}")
    for level in book.bids[: args.depth]:
        print(f"  매수 {level.price:>10,}  {level.quantity:>10,}")
    print(f"  스프레드 {book.spread:,}원 / 총매도 {book.total_ask_qty:,} 총매수 {book.total_bid_qty:,}")
    return 0


def cmd_chart(trader: KisTrader, args: argparse.Namespace) -> int:
    candles = trader.quotes.daily_candles(args.symbol, days=args.days, period=args.period)
    print(f"== {args.symbol} {args.period}봉 {len(candles)}건 ==")
    print(row([("일자", 12, "<"), ("시가", 10, ">"), ("고가", 10, ">"),
               ("저가", 10, ">"), ("종가", 10, ">"), ("거래량", 14, ">")]))
    for c in candles[-args.limit :]:
        print(row([(f"{c.date:%Y-%m-%d}", 12, "<"), (f"{c.open:,}", 10, ">"), (f"{c.high:,}", 10, ">"),
                   (f"{c.low:,}", 10, ">"), (f"{c.close:,}", 10, ">"), (f"{c.volume:,}", 14, ">")]))
    return 0


def cmd_balance(trader: KisTrader, args: argparse.Namespace) -> int:
    balance = trader.trading.balance()
    print("== 계좌 요약 ==")
    print(f"  예수금       {_won(balance.cash):>16}")
    print(f"  주문가능현금 {_won(balance.available_cash):>16}")
    print(f"  매입금액     {_won(balance.total_purchase):>16}")
    print(f"  평가금액     {_won(balance.total_eval):>16}")
    print(f"  평가손익     {_won(balance.total_pnl):>16}")
    print(f"  순자산       {_won(balance.net_asset):>16}")

    if not balance.positions:
        print("\n보유 종목이 없습니다.")
        return 0

    print("\n== 보유 종목 ==")
    header = [("종목코드", 10, "<"), ("종목명", 16, "<"), ("수량", 8, ">"), ("매입가", 12, ">"),
              ("현재가", 12, ">"), ("평가손익", 14, ">"), ("수익률", 9, ">")]
    print(row(header))
    for p in balance.positions:
        print(row([
            (p.symbol, 10, "<"), (p.name, 16, "<"), (f"{p.quantity:,}", 8, ">"),
            (f"{p.avg_price:,.0f}", 12, ">"), (f"{p.current_price:,}", 12, ">"),
            (f"{p.pnl:,}", 14, ">"), (f"{p.pnl_rate:+.2f}%", 9, ">"),
        ]))
    return 0


def _place_order(trader: KisTrader, args: argparse.Namespace, side: Side) -> int:
    order_type = OrderType.MARKET if args.market else OrderType.LIMIT
    price = 0 if args.market else args.price
    if not args.market and price <= 0:
        print("지정가 주문에는 --price 가 필요합니다 (시장가는 --market).", file=sys.stderr)
        return 2

    if not _confirm_real_order(trader, args.yes):
        print("취소했습니다.")
        return 1

    if args.check_risk:
        balance = trader.trading.balance()
        decision = trader.risk.validate_order(
            symbol=args.symbol,
            side=side,
            quantity=args.quantity,
            price=price or trader.quotes.price(args.symbol).price,
            balance=balance,
            order_type=order_type,
        )
        if not decision:
            print(f"리스크 한도에 걸려 주문하지 않습니다: {decision.reason}", file=sys.stderr)
            return 1
        if decision.quantity != args.quantity:
            print(f"수량 조정: {args.quantity} → {decision.quantity}주")
        args.quantity = decision.quantity

    result = trader.trading.order(args.symbol, side, args.quantity, price=price, order_type=order_type)
    trader.storage.record_order(
        symbol=args.symbol,
        side=side,
        quantity=args.quantity,
        price=price,
        order_type=order_type.name,
        result=result,
        strategy="manual",
        reason="CLI 수동 주문",
    )
    print(result)
    return 0 if result.success else 1


def cmd_buy(trader: KisTrader, args: argparse.Namespace) -> int:
    return _place_order(trader, args, Side.BUY)


def cmd_sell(trader: KisTrader, args: argparse.Namespace) -> int:
    return _place_order(trader, args, Side.SELL)


def cmd_orders(trader: KisTrader, args: argparse.Namespace) -> int:
    orders = trader.trading.open_orders()
    if not orders:
        print("미체결 주문이 없습니다.")
        return 0
    print(row([("주문번호", 12, "<"), ("조직", 8, "<"), ("종목", 10, "<"), ("구분", 6, "<"),
               ("주문", 8, ">"), ("체결", 8, ">"), ("잔량", 8, ">"), ("단가", 10, ">")]))
    for o in orders:
        print(row([
            (o.order_no, 12, "<"), (o.org_no, 8, "<"), (o.symbol, 10, "<"), (o.side.korean, 6, "<"),
            (f"{o.order_qty:,}", 8, ">"), (f"{o.filled_qty:,}", 8, ">"),
            (f"{o.remaining_qty:,}", 8, ">"), (f"{o.order_price:,}", 10, ">"),
        ]))
    return 0


def cmd_executions(trader: KisTrader, args: argparse.Namespace) -> int:
    rows = trader.trading.executions(start=date.today() if args.today else None)
    if not rows:
        print("체결 내역이 없습니다.")
        return 0
    print(row([("시각", 8, "<"), ("주문번호", 12, "<"), ("종목", 10, "<"), ("구분", 6, "<"),
               ("수량", 8, ">"), ("체결", 8, ">"), ("평균가", 12, ">"), ("상태", 12, "<")]))
    for e in rows:
        print(row([
            (e.order_time, 8, "<"), (e.order_no, 12, "<"), (e.symbol, 10, "<"), (e.side.korean, 6, "<"),
            (f"{e.order_qty:,}", 8, ">"), (f"{e.filled_qty:,}", 8, ">"),
            (f"{e.avg_fill_price:,.0f}", 12, ">"), (e.status, 12, "<"),
        ]))
    return 0


def cmd_cancel(trader: KisTrader, args: argparse.Namespace) -> int:
    if not _confirm_real_order(trader, args.yes):
        print("취소했습니다.")
        return 1
    if args.all:
        results = trader.trading.cancel_all()
        if not results:
            print("취소할 미체결 주문이 없습니다.")
        for result in results:
            print(result)
        return 0
    if not (args.order_no and args.org_no):
        print("--order-no 와 --org-no 를 함께 주거나 --all 을 사용하세요.", file=sys.stderr)
        return 2
    print(trader.trading.cancel(org_no=args.org_no, order_no=args.order_no))
    return 0


def cmd_watch(trader: KisTrader, args: argparse.Namespace) -> int:
    symbols = _split_symbols(args.symbols)
    rt = trader.realtime()

    def on_tick(msg: RealtimeMessage) -> None:
        price = msg.get_int("STCK_PRPR")
        rate = msg.get_float("PRDY_CTRT")
        volume = msg.get_int("CNTG_VOL")
        hour = msg.data.get("STCK_CNTG_HOUR", "")
        print(f"[{hour}] {msg.symbol} {price:>10,}원 ({rate:+.2f}%) 체결량 {volume:>8,}")

    rt.on(TR_TICK, on_tick)
    rt.subscribe_ticks(symbols)
    if args.hts_id:
        rt.subscribe_notice(args.hts_id)
    print(f"실시간 구독 시작: {', '.join(symbols)} (Ctrl+C 로 종료)")
    rt.start()
    try:
        while True:
            rt._stop.wait(1.0)  # noqa: SLF001 - 단순 대기
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        rt.stop()
    return 0


def cmd_run(trader: KisTrader, args: argparse.Namespace) -> int:
    from .engine import TradingEngine

    symbols = _split_symbols(args.symbols)
    if not symbols:
        print("--symbols 로 대상 종목을 지정하세요.", file=sys.stderr)
        return 2

    strategy = create_strategy(
        args.strategy,
        symbols,
        exit_policy=ExitPolicy(stop_loss_pct=args.stop_loss, take_profit_pct=args.take_profit),
    )
    engine = TradingEngine(
        trader.settings,
        strategy,
        client=trader.client,
        storage=trader.storage,
        interval=args.interval,
        order_type=OrderType.MARKET if args.market else OrderType.LIMIT,
    )
    engine.install_signal_handlers()

    if not trader.settings.dry_run and not trader.settings.is_paper and not args.yes:
        print("\n" + "!" * 60)
        print("  실전투자 계좌로 자동매매를 시작합니다. 실제 주문이 전송됩니다.")
        print("!" * 60)
        if input("계속하려면 '실행' 을 입력하세요: ").strip() != "실행":
            print("취소했습니다.")
            return 1

    if args.realtime:
        engine.enable_realtime(args.hts_id)

    if args.once:
        report = engine.run_once()
        print(f"\n신호 {len(report.signals)}건 / 주문 {report.executed}건 / 당일손익 {_won(report.daily_pnl)}")
        for sig in report.signals:
            print(f"  {sig}")
        engine.shutdown()
        return 0

    engine.run(max_cycles=args.max_cycles, only_market_hours=not args.ignore_market_hours)
    return 0


def cmd_web(trader: KisTrader, args: argparse.Namespace) -> int:
    from .web import WebConfig, create_app, generate_token, print_startup_banner

    token = args.token or os.getenv("KIS_WEB_TOKEN") or generate_token()
    watchlist = _split_symbols(args.watch or os.getenv("KIS_WATCHLIST") or "")

    config = WebConfig(
        token=token,
        allow_control=args.allow_control,
        host=args.host,
        port=args.port,
        watchlist=watchlist,
        refresh_seconds=args.refresh,
    )

    if args.allow_control and not trader.settings.is_paper and not trader.settings.dry_run and not args.yes:
        print("\n" + "!" * 60)
        print("  실전 계좌에서 제어(주문·취소·매매재개)를 허용하려 합니다.")
        print("  대시보드 접속자는 실제 주문을 낼 수 있습니다.")
        print("!" * 60)
        if input("계속하려면 '실행' 을 입력하세요: ").strip() != "실행":
            print("취소했습니다.")
            return 1

    app = create_app(trader, config)
    print_startup_banner(config, trader)
    # 개인용 LAN 대시보드이므로 내장 서버로 충분하다. 외부에 공개하지 말 것.
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)
    return 0


def cmd_journal(trader: KisTrader, args: argparse.Namespace) -> int:
    rows = trader.storage.recent_orders(args.limit)
    if not rows:
        print("기록된 주문이 없습니다.")
        return 0
    print(row([("시각", 19, "<"), ("종목", 8, "<"), ("구분", 6, "<"), ("수량", 7, ">"),
               ("가격", 10, ">"), ("전략", 12, "<"), ("결과", 8, "<"), ("사유", 30, "<")]))
    for entry in rows:
        status = "성공" if entry["success"] else "실패"
        if entry["dry_run"]:
            status += "(dry)"
        print(row([
            (entry["ts"], 19, "<"), (entry["symbol"], 8, "<"), (entry["side"], 6, "<"),
            (f"{entry['quantity']:,}", 7, ">"), (f"{entry['price']:,}", 10, ">"),
            (entry["strategy"] or "", 12, "<"), (status, 8, "<"), (entry["reason"] or "", 30, "<"),
        ]))
    summary = trader.storage.daily_fill_summary()
    print(f"\n당일 체결: 매수 {_won(summary['buy'])} / 매도 {_won(summary['sell'])}")
    return 0


def cmd_halt(trader: KisTrader, args: argparse.Namespace) -> int:
    path = trader.settings.kill_switch_path
    if args.off:
        if path.exists():
            path.unlink()
            print(f"킬 스위치 해제: {path}")
        else:
            print("킬 스위치가 이미 꺼져 있습니다.")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"halted at {now_kst():%Y-%m-%d %H:%M:%S}\n", encoding="utf-8")
    trader.storage.record_event("KILL_SWITCH", "CLI 로 매매 중단", level="CRITICAL")
    print(f"킬 스위치 작동: {path}\n실행 중인 엔진은 다음 주문 시도에서 중단됩니다.")
    return 0


# ---------------------------------------------------------------------- 파서
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kis",
        description="한국투자증권 KIS Open API 매매 시스템",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"kis-trader {__version__}")
    parser.add_argument("--env-file", default=".env", help="설정 파일 경로 (기본: .env)")
    parser.add_argument("--log-level", default=None, help="DEBUG/INFO/WARNING/ERROR")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("check", help="설정·인증·계좌 점검")
    p.add_argument("--symbol", default="005930", help="시세 확인용 종목 (기본: 삼성전자)")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("price", help="현재가 조회")
    p.add_argument("symbols", help="종목코드(쉼표로 여러 개)")
    p.set_defaults(func=cmd_price)

    p = sub.add_parser("orderbook", help="호가 조회")
    p.add_argument("symbol")
    p.add_argument("--depth", type=int, default=5)
    p.set_defaults(func=cmd_orderbook)

    p = sub.add_parser("chart", help="일/주/월봉 조회")
    p.add_argument("symbol")
    p.add_argument("--days", type=int, default=60)
    p.add_argument("--period", default="D", choices=["D", "W", "M", "Y"])
    p.add_argument("--limit", type=int, default=30, help="출력할 최근 봉 개수")
    p.set_defaults(func=cmd_chart)

    p = sub.add_parser("balance", help="잔고 조회")
    p.set_defaults(func=cmd_balance)

    for name, func, help_text in (("buy", cmd_buy, "매수 주문"), ("sell", cmd_sell, "매도 주문")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("symbol")
        p.add_argument("-q", "--quantity", type=int, required=True)
        p.add_argument("-p", "--price", type=int, default=0, help="지정가 단가")
        p.add_argument("--market", action="store_true", help="시장가 주문")
        p.add_argument("--yes", action="store_true", help="실전 주문 확인 프롬프트 생략")
        p.add_argument("--no-check-risk", dest="check_risk", action="store_false", help="리스크 사전 검증 생략")
        p.set_defaults(func=func, check_risk=True)

    p = sub.add_parser("orders", help="미체결 주문 조회")
    p.set_defaults(func=cmd_orders)

    p = sub.add_parser("executions", help="주문 체결 내역")
    p.add_argument("--today", action="store_true", help="당일만 조회")
    p.set_defaults(func=cmd_executions)

    p = sub.add_parser("cancel", help="주문 취소")
    p.add_argument("--order-no")
    p.add_argument("--org-no")
    p.add_argument("--all", action="store_true", help="미체결 전량 취소")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_cancel)

    p = sub.add_parser("watch", help="실시간 체결가 구독")
    p.add_argument("symbols")
    p.add_argument("--hts-id", default=None, help="체결통보를 함께 받으려면 HTS ID")
    p.set_defaults(func=cmd_watch)

    p = sub.add_parser("run", help="전략 자동매매 실행")
    p.add_argument("--strategy", default="sma_cross", choices=sorted(REGISTRY))
    p.add_argument("--symbols", required=True)
    p.add_argument("--interval", type=float, default=60.0, help="사이클 주기(초)")
    p.add_argument("--once", action="store_true", help="1회만 실행")
    p.add_argument("--max-cycles", type=int, default=None)
    p.add_argument("--market", action="store_true", help="시장가로 주문")
    p.add_argument("--stop-loss", type=float, default=-5.0, help="손절 수익률(%%)")
    p.add_argument("--take-profit", type=float, default=10.0, help="익절 수익률(%%)")
    p.add_argument("--realtime", action="store_true", help="실시간 체결가/체결통보 구독")
    p.add_argument("--hts-id", default=None)
    p.add_argument("--ignore-market-hours", action="store_true", help="장 시간 밖에서도 실행(테스트용)")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("web", help="모니터링 대시보드 실행 (폰 브라우저용)")
    p.add_argument("--host", default="127.0.0.1",
                   help="바인딩 주소. 폰에서 접속하려면 0.0.0.0 (같은 와이파이에서만 사용)")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--token", default=None, help="접속 토큰. 생략하면 자동 생성해 출력합니다")
    p.add_argument("--allow-control", action="store_true",
                   help="주문·취소·매매재개 허용 (기본은 읽기 전용 + 비상정지만 가능)")
    p.add_argument("--watch", default=None, help="관심 종목 (쉼표 구분)")
    p.add_argument("--refresh", type=int, default=10, help="자동 갱신 주기(초)")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("journal", help="매매 기록 조회")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_journal)

    p = sub.add_parser("halt", help="킬 스위치 on/off")
    p.add_argument("--off", action="store_true", help="킬 스위치 해제")
    p.set_defaults(func=cmd_halt)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    trader: KisTrader | None = None
    try:
        trader = KisTrader.from_env(args.env_file)
        setup_logging(args.log_level or trader.settings.log_level, log_dir=trader.settings.data_dir / "logs")
        return int(args.func(trader, args) or 0)
    except KisError as exc:
        setup_logging(args.log_level or "INFO")
        log.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        print("\n중단했습니다.")
        return 130
    finally:
        if trader is not None:
            trader.close()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
