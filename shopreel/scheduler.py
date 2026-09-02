# -*- coding: utf-8 -*-
"""주기 실행기.

  python3 -m shopreel auto --every 180          # 3시간마다 계속
  python3 -m shopreel auto --every 60 --runs 8  # 1시간마다 8회

크론(cron)이 있는 환경이라면 크론에 `shopreel run` 을 걸어도 된다.
이 모듈은 별도 데몬 없이 한 프로세스로 돌리고 싶을 때 쓴다.
"""

from __future__ import annotations

import random
import signal
import time
from typing import Callable, List, Optional

from .config import Config
from .models import RunResult
from .pipeline import run_once
from .store import Store

Log = Callable[[str], None]
_stop = False


def _handle_stop(signum, frame) -> None:      # noqa: ANN001
    global _stop
    _stop = True


def run_forever(cfg: Config, every_minutes: Optional[int] = None, runs: int = 0,
                jitter: float = 0.1, log: Log = print) -> List[RunResult]:
    """`runs` 회(0이면 무한) 반복 실행. Ctrl+C 로 안전하게 멈춘다."""
    global _stop
    _stop = False
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_stop)
        except ValueError:                     # 메인 스레드가 아닐 때
            pass

    interval = (every_minutes or cfg.schedule_minutes) * 60
    store = Store(cfg.db)
    results: List[RunResult] = []
    count = 0

    while not _stop and (runs == 0 or count < runs):
        count += 1
        log(f"\n===== 실행 #{count} · {time.strftime('%Y-%m-%d %H:%M:%S')} =====")
        try:
            results.append(run_once(cfg, store, log))
        except Exception as e:
            log(f"! 실행 실패: {type(e).__name__}: {e}")

        if runs and count >= runs:
            break
        wait = interval * (1 + random.uniform(-jitter, jitter))   # 업로드 패턴 분산
        log(f"다음 실행까지 {wait / 60:.0f}분 대기 (Ctrl+C 로 종료)")
        end = time.time() + wait
        while not _stop and time.time() < end:
            time.sleep(min(2.0, max(0.0, end - time.time())))

    log(f"\n총 {count}회 실행 후 종료")
    return results
