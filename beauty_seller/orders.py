# -*- coding: utf-8 -*-
"""마켓 주문 CSV → 공급사 대량발주 CSV 변환.

브라우저 에이전트로 한 건씩 입력하는 대신, 대부분의 도매몰이 제공하는
'엑셀 대량주문' 양식에 맞춰 파일을 만든다. 고객 개인정보가 AI 서비스로
전송되지 않고, 결과가 결정적이라 검수가 쉽다.
"""

import csv
import io
import json
import re
from pathlib import Path

PHONE_RE = re.compile(r"^0\d{1,2}-?\d{3,4}-?\d{4}$")
ZIP_RE = re.compile(r"^\d{5}$")


def read_csv(path):
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"{path}: UTF-8/CP949 로 읽을 수 없습니다.")
    return list(csv.DictReader(io.StringIO(text, newline="")))


def load_mapping(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _validate(order):
    errs = []
    if not order["name"].strip():
        errs.append("수령인 없음")
    if not PHONE_RE.match(order["phone"].strip()):
        errs.append(f"연락처 형식 오류({order['phone']})")
    if not ZIP_RE.match(order["zip"].strip()):
        errs.append(f"우편번호 형식 오류({order['zip']})")
    if not order["address"].strip():
        errs.append("주소 없음")
    try:
        if int(order["qty"]) < 1:
            raise ValueError
    except ValueError:
        errs.append(f"수량 오류({order['qty']})")
    return errs


def convert(rows, mapping):
    """반환: (공급사 발주 행 목록, 오류 행 목록). 세트 상품은 구성품별 행으로 펼친다."""
    cols, pmap, out_cols = mapping["marketplace_columns"], mapping["product_map"], mapping["supplier_columns"]
    memo_default = mapping.get("default_memo", "")
    ok, bad = [], []
    for row in rows:
        try:
            order = {k: (row.get(src) or "").strip() for k, src in cols.items()}
        except AttributeError:
            bad.append({"주문번호": "", "사유": "행 형식 오류"})
            continue
        key = order["product"] + (f" / {order['option']}" if order.get("option") else "")
        components = pmap.get(key) or pmap.get(order["product"])
        errs = _validate(order)
        if components is None:
            errs.append(f"상품 매핑 없음({key})")
        if errs:
            bad.append({"주문번호": order["order_id"], "사유": "; ".join(errs)})
            continue
        for comp in components:
            values = {
                "supplier_code": comp["supplier_code"],
                "qty": str(int(comp.get("qty", 1)) * int(order["qty"])),
                "name": order["name"], "phone": order["phone"], "zip": order["zip"],
                "address": order["address"], "memo": order.get("memo") or memo_default,
                "order_id": order["order_id"],
            }
            ok.append({header: values[field] for header, field in out_cols.items()})
    return ok, bad


def write_csv(path, rows, fieldnames):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:  # 엑셀에서 한글 깨짐 방지
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
