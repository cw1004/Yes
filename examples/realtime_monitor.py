"""실시간 체결가를 받아 조건 도달 시 알림만 출력하는 예시.

실행:
    python examples/realtime_monitor.py 005930 71000
"""

from __future__ import annotations

import sys
import time

from kis import KisTrader
from kis.logging_setup import setup_logging
from kis.realtime import TR_TICK, RealtimeMessage


def main() -> None:
    if len(sys.argv) < 3:
        print("사용법: python examples/realtime_monitor.py <종목코드> <목표가>")
        raise SystemExit(2)

    symbol, target = sys.argv[1], int(sys.argv[2])
    setup_logging("INFO")
    trader = KisTrader.from_env()
    realtime = trader.realtime()
    hit = False

    def on_tick(message: RealtimeMessage) -> None:
        nonlocal hit
        price = message.get_int("STCK_PRPR")
        print(f"[{message.data.get('STCK_CNTG_HOUR')}] {message.symbol} {price:,}원", end="\r")
        if not hit and price >= target:
            hit = True
            print(f"\n🔔 목표가 도달: {message.symbol} {price:,}원 >= {target:,}원")

    realtime.on(TR_TICK, on_tick)
    realtime.subscribe_ticks([symbol])

    with realtime:
        print(f"{symbol} 실시간 감시 시작 (목표가 {target:,}원). Ctrl+C 로 종료.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n종료합니다.")
    trader.close()


if __name__ == "__main__":
    main()
