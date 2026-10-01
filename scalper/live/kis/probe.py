"""KIS 명세 확인기 — 실제 응답을 그대로 보여줍니다.

tr_id 와 응답 필드명은 개정되고 계좌 종류에 따라 다릅니다. 추측으로 맞추는
대신, 각 엔드포인트를 한 번씩 호출해 **날것 그대로** 출력합니다.
어느 필드가 무엇인지 눈으로 확인하고 spec 파일로 덮어쓰면 됩니다.

주문은 내지 않습니다. 조회만 합니다.
"""

from __future__ import annotations

import json

from .broker import KISBroker
from .client import KISError

MASK_KEYS = {"CANO", "cano", "ACNT_PRDT_CD", "appkey", "appsecret",
             "authorization", "access_token", "HASH"}


def _mask(obj):
    """계좌번호·키가 로그나 화면에 남지 않게 가립니다."""
    if isinstance(obj, dict):
        return {k: ("***" if k in MASK_KEYS else _mask(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_mask(x) for x in obj[:3]]      # 샘플 3건이면 충분합니다
    return obj


def _show(title: str, payload) -> None:
    print(f"\n── {title} " + "─" * max(0, 60 - len(title)))
    print(json.dumps(_mask(payload), ensure_ascii=False, indent=2)[:2500])


def run(broker: KISBroker, symbol: str = "NVDA") -> int:
    spec = broker.spec
    client = broker.client
    print("=" * 74)
    print(f"KIS 명세 확인 — {'모의투자' if client.paper else '실전'} · "
          f"{broker.market} · {symbol}")
    print("=" * 74)
    print("주문은 내지 않습니다. 조회만 합니다.")
    failures = 0

    try:
        client.token()
        print("\n✅ 접근토큰 발급 성공")
    except KISError as e:
        print(f"\n❌ 접근토큰 실패: {e}")
        return 1

    probes = [
        ("현재가", lambda: client.call(
            "GET", spec["paths"]["price"], spec["tr_id"]["price"],
            params={"AUTH": "", "EXCD": broker._qte_exc, "SYMB": symbol})),
        ("분봉", lambda: client.call(
            "GET", spec["paths"]["minute_bars"], spec["tr_id"]["minute_bars"],
            params={"AUTH": "", "EXCD": broker._qte_exc, "SYMB": symbol,
                    "NMIN": "5", "PINC": "1", "NEXT": "", "NREC": "10",
                    "FILL": "", "KEYB": ""})),
        ("잔고", lambda: client.call(
            "GET", spec["paths"]["balance"], client.tr["balance"],
            params={**client.account_body(), "OVRS_EXCG_CD": broker._ord_exc,
                    "TR_CRCY_CD": "USD", "CTX_AREA_FK200": "",
                    "CTX_AREA_NK200": ""})),
        ("미체결", lambda: client.call(
            "GET", spec["paths"]["open_orders"], client.tr["open_orders"],
            params={**client.account_body(), "OVRS_EXCG_CD": broker._ord_exc,
                    "SORT_SQN": "DS", "CTX_AREA_FK200": "",
                    "CTX_AREA_NK200": ""})),
    ]

    for title, fn in probes:
        try:
            _show(title, fn())
        except KISError as e:
            failures += 1
            print(f"\n❌ {title} 실패: {e}")

    print("\n" + "=" * 74)
    print("해석한 결과 (여기가 비어 있으면 fields 매핑이 틀린 것입니다)")
    print("=" * 74)
    for title, fn in (("현재가", lambda: broker.latest_price(symbol)),
                      ("봉 개수", lambda: len(broker.bars(symbol, "5Min", 50))),
                      ("보유 종목", lambda: list(broker.positions())),
                      ("계좌", lambda: broker.account())):
        try:
            print(f"  {title:<10} {fn()}")
        except KISError as e:
            failures += 1
            print(f"  {title:<10} ❌ {e}")

    print("\n" + "=" * 74)
    if failures:
        print(f"확인 필요 {failures}건 — 위 날것 응답과 비교해 spec 을 고치세요.")
        print("  1) 응답에서 실제 필드명을 찾습니다")
        print("  2) my_spec.json 에 그 이름만 적습니다")
        print('     {"fields": {"position_qty": ["실제_필드명"]}}')
        print("  3) export KIS_SPEC_FILE=my_spec.json 후 다시 실행합니다")
    else:
        print("전부 해석됐습니다. preflight 로 넘어가세요.")
    print("=" * 74)
    return 1 if failures else 0
