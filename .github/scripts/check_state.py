#!/usr/bin/env python3
"""대시보드 스모크 테스트 — 서버가 200 을 주는 것만으로는 부족하고,
슬롯 3개가 실제로 값을 채웠는지까지 확인합니다."""

from __future__ import annotations

import json
import sys


def main(state_path: str, index_path: str) -> int:
    with open(state_path, encoding="utf-8") as f:
        state = json.load(f)

    slots = state.get("slots", [])
    if len(slots) != 3:
        print(f"실패: 슬롯이 3개가 아닙니다 ({len(slots)}개)", file=sys.stderr)
        return 1

    for slot in slots:
        if not slot.get("price", 0) > 0:
            print(f"실패: SLOT{slot.get('index')} 가격이 비었습니다", file=sys.stderr)
            return 1
        bars = len(slot.get("candles", []))
        if bars < 50:
            print(f"실패: SLOT{slot.get('index')} 캔들 {bars}개뿐입니다", file=sys.stderr)
            return 1
        if slot.get("indicators", {}).get("ma20") is None:
            print(f"실패: SLOT{slot.get('index')} 지표가 계산되지 않았습니다", file=sys.stderr)
            return 1

    tickers = [s["ticker"] for s in slots]
    if len(set(tickers)) != 3:
        print(f"실패: 슬롯이 독립적이지 않습니다 ({tickers})", file=sys.stderr)
        return 1

    with open(index_path, encoding="utf-8") as f:
        html = f.read()
    for marker in ("<canvas", "api/state", "SLOT"):
        if marker not in html:
            print(f"실패: 대시보드 HTML 에 {marker!r} 이 없습니다", file=sys.stderr)
            return 1

    print(f"정상 — 슬롯 {tickers}, HTML {len(html)}바이트")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: check_state.py <state.json> <index.html>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2]))
