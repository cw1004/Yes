# -*- coding: utf-8 -*-
"""SHOPREEL 전 구간 시연 — 키 없이 수집부터 업로드·랜딩 페이지까지 돌려 본다.

목 서버(tools/mock_coupang.py)가 쿠팡 오픈 API 를 흉내 내고, 요청의 CEA HMAC
서명을 실제로 검증한다. 즉 여기서 통과하면 실제 키로 바꿔도 같은 코드가 그대로 돈다.

  python3 -m tools.coupang_demo                        # 쿠팡 수집 → 영상
  python3 -m tools.coupang_demo --youtube --instagram   # 업로드까지 전 구간
  python3 -m tools.coupang_demo --instagram --serve     # 랜딩 페이지를 띄워 둔 채로

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
from shopreel.store import Store
from shopreel.tracker import serve
from tools.mock_coupang import start
from tools.mock_instagram import env_for as instagram_env
from tools.mock_instagram import start as start_instagram
from tools.mock_youtube import env_for as youtube_env
from tools.mock_youtube import start as start_youtube

ACCESS, SECRET = "demo-access-key", "demo-secret-key"


def main() -> int:
    ap = argparse.ArgumentParser(description="쿠팡 파트너스 파이프라인 시연 (키 불필요)")
    ap.add_argument("--top", type=int, default=1, help="만들 편수")
    ap.add_argument("--duration", type=float, default=30.0, help="영상 길이(초)")
    ap.add_argument("--out", default="output/coupang-demo", help="출력 디렉터리")
    ap.add_argument("--fast", action="store_true", help="미리보기 화질로 빠르게")
    ap.add_argument("--youtube", action="store_true",
                    help="유튜브 목 서버까지 띄워 업로드 전 구간을 시연")
    ap.add_argument("--instagram", action="store_true",
                    help="인스타그램 목 서버 + 추적 서버로 릴스 게시를 시연")
    ap.add_argument("--serve", action="store_true",
                    help="끝난 뒤 링크인바이오 페이지를 계속 띄워 둔다")
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
    print(f"쿠팡 목 서버: {base}  (요청 서명을 실제로 검증합니다)")

    yt_httpd = yt_handler = None
    publish_to = ["dryrun"]
    if args.youtube:
        yt_httpd, yt_base, yt_handler = start_youtube("ok")
        threading.Thread(target=yt_httpd.serve_forever, daemon=True).start()
        os.environ.update(youtube_env(yt_base))
        publish_to = ["youtube", "dryrun"]
        print(f"유튜브 목 서버: {yt_base}  (토큰 갱신·재개형 업로드를 실제로 처리합니다)")
    print()

    cfg = Config(
        out_dir=Path(args.out),
        sources=["coupang"], publish_to=publish_to,
        top_n=args.top, duration=args.duration,
        tracker_base="https://link.example.com",   # 아래에서 추적 서버 주소로 덮어쓴다
        min_rating=0, min_reviews=0,       # 쿠팡은 평점·리뷰를 주지 않는다
        preset="veryfast" if args.fast else "medium",
        crf=28 if args.fast else 22,
    )
    # 추적 서버(링크인바이오 + 영상 공개 URL). 인스타그램 Graph API 는 URL 만 받는다.
    cfg.ensure_dirs()
    store = Store(cfg.db)
    tracker, _ = serve(cfg, host="127.0.0.1", port=0, store=store)
    threading.Thread(target=tracker.serve_forever, daemon=True).start()
    tracker_base = f"http://127.0.0.1:{tracker.server_address[1]}"
    cfg.tracker_base = tracker_base
    print(f"추적 서버: {tracker_base}  (링크인바이오 {tracker_base}/shop)")

    ig_httpd = ig_handler = None
    if args.instagram:
        ig_httpd, ig_base, ig_handler = start_instagram("ok")
        threading.Thread(target=ig_httpd.serve_forever, daemon=True).start()
        os.environ.update(instagram_env(ig_base))
        os.environ["PUBLIC_VIDEO_BASE"] = f"{tracker_base}/v"
        cfg.publish_to = ["instagram"] + cfg.publish_to
        print(f"인스타그램 목 서버: {ig_base}  (영상 URL 을 실제로 내려받아 검증합니다)")
    print()

    result = run_once(cfg, store, log=print)

    print("\n■ API 호출 서명 검증")
    for c in handler.calls:
        mark = "○" if c["signature_ok"] else "×"
        print(f"  {mark} {c['method']:<5}{c['path'].split('/openapi')[-1]:<40}{c['reason']}")

    if yt_handler is not None:
        print("\n■ 유튜브 업로드 검증")
        for up in yt_handler.uploads:
            print(f"  video id   {up['video_id']}")
            print(f"  전송 크기  {up['size']:,} bytes (sha1 {up['sha1'][:12]}…)")
            print(f"  제목       {up['title']}")
            print(f"  태그       {', '.join(up['tags'][:6])}")
            print(f"  공개설정   {up['status'].get('privacyStatus')} · "
                  f"AI고지 {up['status'].get('containsSyntheticMedia')}")
            print(f"  썸네일     {up['thumbnail_bytes']:,} bytes")
        chunks = sum(1 for c in yt_handler.calls if c["method"] == "PUT")
        print(f"  청크 전송  {chunks}회")

    if ig_handler is not None:
        print("\n■ 인스타그램 릴스 게시 검증")
        for item in ig_handler.published:
            probe = item["probe"]
            print(f"  media id   {item['media_id']}")
            print(f"  영상 URL   {item['video_url']}")
            print(f"  다운로드   {'성공' if probe.get('ok') else '실패'} "
                  f"{probe.get('bytes', 0):,} bytes {probe.get('content_type', '')}")
            print(f"  커버 지점  {item['thumb_offset']}ms · 피드 공유 {item['share_to_feed']}")
            print(f"  캡션 첫줄  {item['caption'].splitlines()[0][:60]}")

    print("\n■ 결과")
    for v in result.videos:
        print(f"  영상   {v.path} ({v.seconds:.0f}초)")
        print(f"  추적링크 {v.link}")
        print(f"  제휴링크 {v.target}")
    for p in result.posts:
        print(f"  업로드 [{p.platform}] {p.status} → {p.url or p.message}")
    for err in result.errors:
        print(f"  ! {err}")

    print(f"\n■ 링크인바이오 페이지")
    print(f"  {tracker_base}/shop            (프로필 링크에 거는 주소)")
    print(f"  {tracker_base}/shop?p=instagram  (인스타 유입으로 집계)")

    httpd.shutdown()
    httpd.server_close()
    for server in (yt_httpd, ig_httpd):
        if server is not None:
            server.shutdown()
            server.server_close()

    if args.serve:
        print("\n랜딩 페이지를 띄워 둡니다. Ctrl+C 로 종료하세요.")
        try:
            while True:
                threading.Event().wait(1.0)
        except KeyboardInterrupt:
            print("\n종료")
    tracker.shutdown()
    tracker.server_close()
    return 0 if result.videos else 1


if __name__ == "__main__":
    raise SystemExit(main())
