# -*- coding: utf-8 -*-
"""쿠팡 파트너스 연동 시연 — 키 없이 전체 파이프라인을 돌려 본다.

목 서버(tools/mock_coupang.py)가 쿠팡 오픈 API 를 흉내 내고, 요청의 CEA HMAC
서명을 실제로 검증한다. 즉 여기서 통과하면 실제 키로 바꿔도 같은 코드가 그대로 돈다.

  python3 -m tools.coupang_demo                 # 1편 제작
  python3 -m tools.coupang_demo --top 3 --duration 15

실제 파트너스 키가 생기면 목 서버 없이 이렇게 쓰면 된다:
  export COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=...
  python3 -m shopreel run --sources coupang --publish dryrun
"""

from __future__ import annotations

import argparse
import os
import threading
from pathlib import Path

from shopreel.config import Config
from shopreel.pipeline import run_once
from tools.mock_coupang import start

ACCESS, SECRET = "demo-access-key", "demo-secret-key"


def main() -> int:
    ap = argparse.ArgumentParser(description="쿠팡 파트너스 파이프라인 시연 (키 불필요)")
    ap.add_argument("--top", type=int, default=1, help="만들 편수")
    ap.add_argument("--duration", type=float, default=30.0, help="영상 길이(초)")
    ap.add_argument("--out", default="output/coupang-demo", help="출력 디렉터리")
    ap.add_argument("--fast", action="store_true", help="미리보기 화질로 빠르게")
    args = ap.parse_args()

    httpd, base, handler = start(ACCESS, SECRET)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    os.environ.update({
        "COUPANG_ACCESS_KEY": ACCESS,
        "COUPANG_SECRET_KEY": SECRET,
        "COUPANG_API_HOST": base,          # 실제 키를 쓸 때는 이 줄만 빼면 된다
        "COUPANG_CATEGORY_ID": "1016",
        "COUPANG_SUBID": "shopreel",
    })
    print(f"쿠팡 목 서버: {base}  (요청 서명을 실제로 검증합니다)\n")

    cfg = Config(
        out_dir=Path(args.out),
        sources=["coupang"], publish_to=["dryrun"],
        top_n=args.top, duration=args.duration,
        tracker_base="https://link.example.com",
        min_rating=0, min_reviews=0,       # 쿠팡은 평점·리뷰를 주지 않는다
        preset="veryfast" if args.fast else "medium",
        crf=28 if args.fast else 22,
    )
    result = run_once(cfg, log=print)

    print("\n■ API 호출 서명 검증")
    for c in handler.calls:
        mark = "○" if c["signature_ok"] else "×"
        print(f"  {mark} {c['method']:<5}{c['path'].split('/openapi')[-1]:<40}{c['reason']}")

    print("\n■ 결과")
    for v in result.videos:
        print(f"  영상   {v.path} ({v.seconds:.0f}초)")
        print(f"  추적링크 {v.link}")
        print(f"  제휴링크 {v.target}")
    for p in result.posts:
        print(f"  업로드 [{p.platform}] {p.status} → {p.url or p.message}")
    for err in result.errors:
        print(f"  ! {err}")

    httpd.shutdown()
    httpd.server_close()
    return 0 if result.videos else 1


if __name__ == "__main__":
    raise SystemExit(main())
