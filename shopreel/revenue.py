# -*- coding: utf-8 -*-
"""수익 집계와 리포트.

제휴 네트워크는 대부분 (1) 실시간 웹훅(postback) 또는 (2) CSV 리포트를 준다.
웹훅은 tracker.py 가 받고, CSV 는 여기서 읽어 들인다.
집계 결과는 랭킹(rank.py)에 EPC 로 되먹여져 '팔리는 카테고리'가 우선 제작된다.
"""

from __future__ import annotations

import csv
import io
import time
from pathlib import Path
from typing import Dict, List, Optional

from .store import Store

# 네트워크마다 헤더 이름이 달라서 넓게 인식한다
ALIASES: Dict[str, tuple] = {
    "code": ("code", "subid", "sub_id", "sub id", "u1", "customid", "custom_id",
             "ascsubtag", "aff_sub", "tracking id", "subid1"),
    "order_id": ("order_id", "order id", "orderid", "transaction id", "transaction_id",
                 "conversion id", "id"),
    "amount": ("amount", "sale amount", "sales", "order amount", "revenue", "gmv"),
    "commission": ("commission", "commission amount", "earnings", "payout", "fee",
                   "estimated commission"),
    "currency": ("currency", "currency code"),
    "status": ("status", "state", "order status"),
    "at": ("date", "datetime", "order date", "created", "conversion date"),
}


def _norm(name: str) -> str:
    return (name or "").strip().lower().replace("-", " ").replace("_", " ")


def _pick(row: Dict[str, str], field: str) -> str:
    lowered = {_norm(k): v for k, v in row.items()}
    for key in ALIASES[field]:
        v = lowered.get(_norm(key))
        if v not in (None, ""):
            return str(v).strip()
    return ""


def _to_float(v: str) -> float:
    try:
        return float("".join(ch for ch in str(v) if ch.isdigit() or ch in ".-") or 0)
    except ValueError:
        return 0.0


def _to_epoch(v: str) -> Optional[float]:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
                "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return time.mktime(time.strptime(str(v)[:19], fmt))
        except (ValueError, OverflowError):
            continue
    return None


def import_csv(path: Path, store: Store, network: str = "") -> Dict[str, int]:
    """네트워크 전환 리포트 CSV 를 읽어 conversions 에 넣는다."""
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    added = skipped = 0
    for row in reader:
        code = _pick(row, "code")
        order_id = _pick(row, "order_id") or f"{code}-{added}-{int(time.time())}"
        if not code:
            skipped += 1
            continue
        ok = store.add_conversion(
            code=code,
            order_id=order_id,
            amount=_to_float(_pick(row, "amount")),
            commission=_to_float(_pick(row, "commission")),
            currency=_pick(row, "currency") or "USD",
            network=network,
            status=_pick(row, "status") or "pending",
            at=_to_epoch(_pick(row, "at")),
        )
        added += 1 if ok else 0
        skipped += 0 if ok else 1
    return {"added": added, "skipped": skipped}


def report(store: Store, days: int = 30) -> Dict:
    summary = store.summary(days)
    clicks = max(1, int(summary["clicks"]))
    return {
        "summary": summary,
        "epc": round(float(summary["revenue"]) / clicks, 4),
        "cvr": round(float(summary["orders"]) / clicks * 100, 2),
        "platforms": store.platform_stats(days),
        "top_products": store.top_products(days, 10),
        "category_epc": store.category_performance(max(days, 60)),
    }


def format_report(data: Dict, lang: str = "ko") -> str:
    s = data["summary"]
    lines: List[str] = []
    lines.append(f"■ 최근 {s['days']}일 요약")
    lines.append(f"  수집 상품   : {s['products']:,}")
    lines.append(f"  제작 영상   : {s['videos']:,}")
    lines.append(f"  업로드      : {s['posts']:,}")
    lines.append(f"  클릭        : {s['clicks']:,}")
    lines.append(f"  주문        : {s['orders']:,}  (전환율 {data['cvr']}%)")
    lines.append(f"  수수료 수익 : {s['revenue']:,}  (클릭당 {data['epc']})")

    if data["platforms"]:
        lines.append("")
        lines.append("■ 플랫폼별")
        lines.append(f"  {'플랫폼':<12}{'클릭':>8}{'주문':>8}{'수익':>12}")
        for p in data["platforms"]:
            lines.append(f"  {p['platform']:<12}{p['clicks']:>8,}{p['orders']:>8,}"
                         f"{p['revenue']:>12,.2f}")

    if data["top_products"]:
        lines.append("")
        lines.append("■ 수익 상위 상품")
        for i, p in enumerate(data["top_products"], 1):
            title = (p["title"] or "")[:38]
            lines.append(f"  {i:2d}. {title:<40} 클릭 {p['clicks']:>5,} · "
                         f"주문 {p['orders']:>4,} · 수익 {p['revenue']:>9,.2f}")

    if data["category_epc"]:
        lines.append("")
        lines.append("■ 카테고리 EPC (다음 제작 우선순위에 반영됨)")
        for cat, epc in sorted(data["category_epc"].items(), key=lambda x: -x[1])[:10]:
            lines.append(f"  {cat:<20} {epc:>8.4f}")
    return "\n".join(lines)
