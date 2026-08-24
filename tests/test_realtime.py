from __future__ import annotations

import base64
import json

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

from kis.realtime import (
    NOTICE_FIELDS,
    ORDERBOOK_FIELDS,
    TICK_FIELDS,
    TR_NOTICE_PAPER,
    TR_ORDERBOOK,
    TR_TICK,
    RealtimeClient,
    RealtimeMessage,
    _decrypt_aes256,
    parse_body,
)


def make_tick_body(symbol="005930", price="71500", volume="10") -> str:
    values = [""] * len(TICK_FIELDS)
    values[TICK_FIELDS.index("MKSC_SHRN_ISCD")] = symbol
    values[TICK_FIELDS.index("STCK_CNTG_HOUR")] = "103015"
    values[TICK_FIELDS.index("STCK_PRPR")] = price
    values[TICK_FIELDS.index("CNTG_VOL")] = volume
    values[TICK_FIELDS.index("PRDY_CTRT")] = "1.25"
    return "^".join(values)


def test_field_layouts_have_expected_width():
    assert len(TICK_FIELDS) == 46
    assert len(ORDERBOOK_FIELDS) == 59
    assert len(NOTICE_FIELDS) == 23


def test_parse_single_tick():
    records = parse_body(TR_TICK, make_tick_body(), 1)
    assert len(records) == 1
    assert records[0]["MKSC_SHRN_ISCD"] == "005930"
    assert records[0]["STCK_PRPR"] == "71500"


def test_parse_multiple_records_in_one_frame():
    body = make_tick_body(price="71500") + "^" + make_tick_body(price="71600")
    records = parse_body(TR_TICK, body, 2)
    assert [r["STCK_PRPR"] for r in records] == ["71500", "71600"]


def test_parse_orderbook_levels():
    values = [""] * len(ORDERBOOK_FIELDS)
    values[ORDERBOOK_FIELDS.index("MKSC_SHRN_ISCD")] = "005930"
    values[ORDERBOOK_FIELDS.index("ASKP1")] = "71600"
    values[ORDERBOOK_FIELDS.index("BIDP1")] = "71500"
    records = parse_body(TR_ORDERBOOK, "^".join(values), 1)
    assert records[0]["ASKP1"] == "71600" and records[0]["BIDP1"] == "71500"


def test_unknown_tr_id_returns_raw():
    assert parse_body("UNKNOWN", "a^b", 1) == [{"raw": "a^b"}]


def test_aes_decrypt_roundtrip():
    key, iv = "0" * 32, "1" * 16
    plaintext = "고객ID^12345678^0000117057"
    cipher = AES.new(key.encode(), AES.MODE_CBC, iv.encode())
    encoded = base64.b64encode(cipher.encrypt(pad(plaintext.encode(), AES.block_size))).decode()
    assert _decrypt_aes256(encoded, key, iv) == plaintext


def test_message_accessors():
    msg = RealtimeMessage(tr_id=TR_TICK, tr_key="005930", data=parse_body(TR_TICK, make_tick_body(), 1)[0])
    assert msg.symbol == "005930"
    assert msg.price == 71_500
    assert msg.get_float("PRDY_CTRT") == 1.25
    assert msg.get_int("NOT_THERE", default=7) == 7


class FakeWs:
    def __init__(self):
        self.sent: list[str] = []

    def send(self, payload):
        self.sent.append(payload)


def _client(settings) -> tuple[RealtimeClient, FakeWs]:
    class FakeTokens:
        approval_key = "APPROVAL-KEY"

    rt = RealtimeClient(settings, FakeTokens())
    ws = FakeWs()
    rt._ws = ws
    return rt, ws


def test_pingpong_is_echoed(settings):
    rt, ws = _client(settings)
    frame = json.dumps({"header": {"tr_id": "PINGPONG", "datetime": "20260824103000"}})
    rt._on_message(ws, frame)
    assert ws.sent == [frame]


def test_subscribe_response_stores_aes_key(settings):
    rt, ws = _client(settings)
    rt._on_message(ws, json.dumps({
        "header": {"tr_id": TR_NOTICE_PAPER},
        "body": {"rt_cd": "0", "msg1": "SUBSCRIBE SUCCESS", "output": {"key": "K" * 32, "iv": "I" * 16}},
    }))
    assert rt._aes[TR_NOTICE_PAPER] == ("K" * 32, "I" * 16)


def test_tick_frame_is_dispatched_to_handler(settings):
    rt, ws = _client(settings)
    received: list[RealtimeMessage] = []
    rt.on(TR_TICK, received.append)
    rt._on_message(ws, f"0|{TR_TICK}|001|{make_tick_body()}")
    assert len(received) == 1 and received[0].price == 71_500


def test_encrypted_notice_is_decrypted_and_dispatched(settings):
    rt, ws = _client(settings)
    key, iv = "K" * 32, "I" * 16
    rt._aes[TR_NOTICE_PAPER] = (key, iv)

    values = [""] * len(NOTICE_FIELDS)
    values[NOTICE_FIELDS.index("STCK_SHRN_ISCD")] = "005930"
    values[NOTICE_FIELDS.index("CNTG_QTY")] = "3"
    values[NOTICE_FIELDS.index("CNTG_UNPR")] = "71500"
    values[NOTICE_FIELDS.index("CNTG_YN")] = "2"
    body = "^".join(values)

    cipher = AES.new(key.encode(), AES.MODE_CBC, iv.encode())
    encrypted = base64.b64encode(cipher.encrypt(pad(body.encode(), AES.block_size))).decode()

    received: list[RealtimeMessage] = []
    rt.on(TR_NOTICE_PAPER, received.append)
    rt._on_message(ws, f"1|{TR_NOTICE_PAPER}|001|{encrypted}")

    assert len(received) == 1
    assert received[0].encrypted and received[0].data["CNTG_QTY"] == "3"


def test_handler_exception_does_not_break_loop(settings):
    rt, ws = _client(settings)
    rt.on(TR_TICK, lambda _m: 1 / 0)
    seen: list[RealtimeMessage] = []
    rt.on(TR_TICK, seen.append)
    rt._on_message(ws, f"0|{TR_TICK}|001|{make_tick_body()}")
    assert len(seen) == 1  # 앞 핸들러가 죽어도 뒤 핸들러는 실행된다


def test_subscribe_registers_and_sends_when_connected(settings):
    rt, ws = _client(settings)
    rt._connected.set()
    rt.subscribe_ticks(["005930", "000660"])
    rt.subscribe_ticks(["005930"])  # 중복은 무시
    assert len(rt._subscriptions) == 2
    frames = [json.loads(f) for f in ws.sent]
    assert frames[0]["header"]["approval_key"] == "APPROVAL-KEY"
    assert frames[0]["header"]["tr_type"] == "1"
    assert {f["body"]["input"]["tr_key"] for f in frames} == {"005930", "000660"}


def test_unsubscribe_sends_type_2(settings):
    rt, ws = _client(settings)
    rt._connected.set()
    rt.subscribe(TR_TICK, "005930")
    rt.unsubscribe(TR_TICK, "005930")
    assert json.loads(ws.sent[-1])["header"]["tr_type"] == "2"
    assert not rt._subscriptions


def test_paper_env_uses_paper_notice_tr(settings):
    rt, _ws = _client(settings)
    assert rt.notice_tr_id == TR_NOTICE_PAPER
