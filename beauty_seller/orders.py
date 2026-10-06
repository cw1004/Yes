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


REQUIRED = ("order_id", "product", "qty", "name", "phone", "zip", "address")
FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


def load_mapping(path):
    with open(path, encoding="utf-8") as f:
        mapping = json.load(f)
    missing = [k for k in REQUIRED if k not in mapping.get("marketplace_columns", {})]
    if missing:
        raise ValueError(f"매핑에 필수 열이 없습니다: {missing}")
    return mapping


def check_columns(rows, mapping):
    """주문 파일에 매핑된 열이 실제로 있는지 확인. 열 이름이 바뀐 엑셀을 조용히 통과시키지 않는다."""
    if not rows:
        return
    cols = mapping["marketplace_columns"]
    absent = [src for k, src in cols.items() if k in REQUIRED and src not in rows[0]]
    if absent:
        raise ValueError(f"주문 파일에 열이 없습니다: {absent} (마켓 엑셀 양식이 바뀌었는지 확인)")


def normalize_phone(v):
    digits = re.sub(r"\D", "", v)
    if digits.startswith("82") and len(digits) in (11, 12):  # +82 10-... → 010-...
        digits = "0" + digits[2:]
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10:
        cut = 2 if digits.startswith("02") else 3
        return f"{digits[:cut]}-{digits[cut:-4]}-{digits[-4:]}"
    return v


def normalize_zip(v):
    v = v.strip()
    return v.zfill(5) if v.isdigit() and len(v) == 4 else v  # 엑셀이 앞자리 0을 지운 경우


def safe_cell(v):
    """엑셀 수식 주입 방지: 수식으로 해석될 수 있는 값 앞에 ' 를 붙인다."""
    return "'" + v if isinstance(v, str) and v.startswith(FORMULA_PREFIX) else v


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


def convert(rows, mapping, already_ordered=()):
    """반환: (공급사 발주 행 목록, 오류 행 목록). 세트 상품은 구성품별 행으로 펼친다.

    already_ordered: 이전 실행에서 발주한 주문번호. 같은 주문을 두 번 발주하지 않도록 건너뛴다.
    """
    check_columns(rows, mapping)
    cols, pmap, out_cols = mapping["marketplace_columns"], mapping["product_map"], mapping["supplier_columns"]
    memo_default = mapping.get("default_memo", "")
    done, ok, bad = set(already_ordered), [], []
    for row in rows:
        order = {k: str(row.get(src) or "").strip() for k, src in cols.items()}
        order["phone"] = normalize_phone(order["phone"])
        order["zip"] = normalize_zip(order["zip"])
        if order["order_id"] in done:
            bad.append({"주문번호": order["order_id"], "사유": "중복 주문번호(이미 발주됨) — 건너뜀"})
            continue
        key = order["product"] + (f" / {order['option']}" if order.get("option") else "")
        components = pmap.get(key) or pmap.get(order["product"])
        errs = _validate(order)
        if components is None:
            errs.append(f"상품 매핑 없음({key})")
        if not order["order_id"]:
            errs.append("주문번호 없음")
        if errs:
            bad.append({"주문번호": order["order_id"], "사유": "; ".join(errs)})
            continue
        done.add(order["order_id"])
        for comp in components:
            values = {
                "supplier_code": comp["supplier_code"],
                "qty": str(int(comp.get("qty", 1)) * int(order["qty"])),
                "name": order["name"], "phone": order["phone"], "zip": order["zip"],
                "address": order["address"], "memo": order.get("memo") or memo_default,
                "order_id": order["order_id"],
            }
            ok.append({header: safe_cell(values[field]) for header, field in out_cols.items()})
    return ok, bad


def load_ledger(path):
    """발주 완료 주문번호 장부(한 줄에 하나). 없으면 빈 집합."""
    p = Path(path)
    if not p.exists():
        return set()
    return {line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()}


def append_ledger(path, order_ids):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for oid in order_ids:
            f.write(oid + "\n")


def write_csv(path, rows, fieldnames):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:  # 엑셀에서 한글 깨짐 방지
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
