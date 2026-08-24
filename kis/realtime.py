"""실시간 시세 웹소켓 (체결가 / 호가 / 체결통보).

KIS 실시간 서비스는 한 세션에 최대 41건까지 등록할 수 있고,
체결통보(H0STCNI0/H0STCNI9)는 AES-256-CBC 로 암호화되어 내려온다.
암복호화 키는 등록 응답 본문의 ``output.key`` / ``output.iv`` 로 전달된다.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .auth import TokenManager
from .config import Settings
from .errors import KisError

log = logging.getLogger(__name__)

# --- 실시간 거래ID ---------------------------------------------------------
TR_TICK = "H0STCNT0"      # 국내주식 실시간체결가
TR_ORDERBOOK = "H0STASP0"  # 국내주식 실시간호가
TR_NOTICE_REAL = "H0STCNI0"   # 실시간 체결통보(실전)
TR_NOTICE_PAPER = "H0STCNI9"  # 실시간 체결통보(모의)

MAX_SUBSCRIPTIONS = 41

TICK_FIELDS = [
    "MKSC_SHRN_ISCD", "STCK_CNTG_HOUR", "STCK_PRPR", "PRDY_VRSS_SIGN", "PRDY_VRSS", "PRDY_CTRT",
    "WGHN_AVRG_STCK_PRC", "STCK_OPRC", "STCK_HGPR", "STCK_LWPR", "ASKP1", "BIDP1", "CNTG_VOL",
    "ACML_VOL", "ACML_TR_PBMN", "SELN_CNTG_CSNU", "SHNU_CNTG_CSNU", "NTBY_CNTG_CSNU", "CTTR",
    "SELN_CNTG_SMTN", "SHNU_CNTG_SMTN", "CCLD_DVSN", "SHNU_RATE", "PRDY_VOL_VRSS_ACML_VOL_RATE",
    "OPRC_HOUR", "OPRC_VRSS_PRPR_SIGN", "OPRC_VRSS_PRPR", "HGPR_HOUR", "HGPR_VRSS_PRPR_SIGN",
    "HGPR_VRSS_PRPR", "LWPR_HOUR", "LWPR_VRSS_PRPR_SIGN", "LWPR_VRSS_PRPR", "BSOP_DATE",
    "NEW_MKOP_CLS_CODE", "TRHT_YN", "ASKP_RSQN1", "BIDP_RSQN1", "TOTAL_ASKP_RSQN", "TOTAL_BIDP_RSQN",
    "VOL_TNRT", "PRDY_SMNS_HOUR_ACML_VOL", "PRDY_SMNS_HOUR_ACML_VOL_RATE", "HOUR_CLS_CODE",
    "MRKT_TRTM_CLS_CODE", "VI_STND_PRC",
]

ORDERBOOK_FIELDS = (
    ["MKSC_SHRN_ISCD", "BSOP_HOUR", "HOUR_CLS_CODE"]
    + [f"ASKP{i}" for i in range(1, 11)]
    + [f"BIDP{i}" for i in range(1, 11)]
    + [f"ASKP_RSQN{i}" for i in range(1, 11)]
    + [f"BIDP_RSQN{i}" for i in range(1, 11)]
    + [
        "TOTAL_ASKP_RSQN", "TOTAL_BIDP_RSQN", "OVTM_TOTAL_ASKP_RSQN", "OVTM_TOTAL_BIDP_RSQN",
        "ANTC_CNPR", "ANTC_CNQN", "ANTC_VOL", "ANTC_CNTG_VRSS", "ANTC_CNTG_VRSS_SIGN",
        "ANTC_CNTG_PRDY_CTRT", "ACML_VOL", "TOTAL_ASKP_RSQN_ICDC", "TOTAL_BIDP_RSQN_ICDC",
        "OVTM_TOTAL_ASKP_RSQN_ICDC", "OVTM_TOTAL_BIDP_RSQN_ICDC", "STCK_DEAL_CLS_CODE",
    ]
)

NOTICE_FIELDS = [
    "CUST_ID", "ACNT_NO", "ODER_NO", "OODER_NO", "SELN_BYOV_CLS", "RCTF_CLS", "ODER_KIND",
    "ODER_COND", "STCK_SHRN_ISCD", "CNTG_QTY", "CNTG_UNPR", "STCK_CNTG_HOUR", "RFUS_YN",
    "CNTG_YN", "ACPT_YN", "BRNC_NO", "ODER_QTY", "ACNT_NAME", "CNTG_ISNM", "CRDT_CLS",
    "CRDT_LOAN_DATE", "CNTG_ISNM40", "ODER_PRC",
]

FIELD_MAP: dict[str, list[str]] = {
    TR_TICK: TICK_FIELDS,
    TR_ORDERBOOK: ORDERBOOK_FIELDS,
    TR_NOTICE_REAL: NOTICE_FIELDS,
    TR_NOTICE_PAPER: NOTICE_FIELDS,
}


@dataclass(frozen=True)
class Subscription:
    tr_id: str
    tr_key: str


@dataclass
class RealtimeMessage:
    """수신한 실시간 데이터 한 건."""

    tr_id: str
    tr_key: str
    data: dict[str, str]
    encrypted: bool = False
    raw: str = field(default="", repr=False)

    def get_int(self, key: str, default: int = 0) -> int:
        try:
            return int(float(self.data.get(key, "") or default))
        except ValueError:
            return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.data.get(key, "") or default)
        except ValueError:
            return default

    # 자주 쓰는 값 단축 접근자
    @property
    def symbol(self) -> str:
        return self.data.get("MKSC_SHRN_ISCD") or self.data.get("STCK_SHRN_ISCD") or self.tr_key

    @property
    def price(self) -> int:
        return self.get_int("STCK_PRPR") or self.get_int("CNTG_UNPR")


def _decrypt_aes256(cipher_b64: str, key: str, iv: str) -> str:
    """체결통보 본문을 복호화한다 (AES-256-CBC, PKCS7)."""
    from Crypto.Cipher import AES  # 지연 임포트: 실시간을 안 쓰면 pycryptodome 이 없어도 된다.
    from Crypto.Util.Padding import unpad

    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, iv.encode("utf-8"))
    decrypted = unpad(cipher.decrypt(base64.b64decode(cipher_b64)), AES.block_size)
    return decrypted.decode("utf-8")


def parse_body(tr_id: str, body: str, count: int = 1) -> list[dict[str, str]]:
    """``^`` 로 구분된 본문을 필드명 딕셔너리 목록으로 변환한다."""
    fields = FIELD_MAP.get(tr_id)
    values = body.split("^")
    if not fields:
        return [{"raw": body}]
    width = len(fields)
    records: list[dict[str, str]] = []
    for i in range(max(count, 1)):
        chunk = values[i * width : (i + 1) * width]
        if not chunk:
            break
        records.append({name: chunk[j] if j < len(chunk) else "" for j, name in enumerate(fields)})
    return records


class RealtimeClient:
    """실시간 시세 구독 클라이언트(백그라운드 스레드 + 자동 재접속)."""

    def __init__(
        self,
        settings: Settings,
        tokens: TokenManager,
        *,
        on_message: Callable[[RealtimeMessage], None] | None = None,
        reconnect_delay: float = 5.0,
    ) -> None:
        self.settings = settings
        self.tokens = tokens
        self.on_message = on_message
        self.reconnect_delay = reconnect_delay

        self._handlers: dict[str, list[Callable[[RealtimeMessage], None]]] = {}
        self._subscriptions: set[Subscription] = set()
        self._aes: dict[str, tuple[str, str]] = {}  # tr_id -> (key, iv)
        self._ws: Any = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._connected = threading.Event()
        self._lock = threading.RLock()

    # ------------------------------------------------------------- 핸들러
    def on(self, tr_id: str, handler: Callable[[RealtimeMessage], None]) -> None:
        """특정 tr_id 에 대한 콜백을 등록한다."""
        self._handlers.setdefault(tr_id, []).append(handler)

    @property
    def notice_tr_id(self) -> str:
        return TR_NOTICE_PAPER if self.settings.is_paper else TR_NOTICE_REAL

    # ------------------------------------------------------------- 구독관리
    def subscribe(self, tr_id: str, tr_key: str) -> None:
        sub = Subscription(tr_id, tr_key)
        with self._lock:
            if sub in self._subscriptions:
                return
            if len(self._subscriptions) >= MAX_SUBSCRIPTIONS:
                raise KisError(f"실시간 등록은 최대 {MAX_SUBSCRIPTIONS}건까지 가능합니다")
            self._subscriptions.add(sub)
        if self._connected.is_set():
            self._send(tr_id, tr_key, register=True)

    def unsubscribe(self, tr_id: str, tr_key: str) -> None:
        sub = Subscription(tr_id, tr_key)
        with self._lock:
            self._subscriptions.discard(sub)
        if self._connected.is_set():
            self._send(tr_id, tr_key, register=False)

    def subscribe_ticks(self, symbols: list[str]) -> None:
        for symbol in symbols:
            self.subscribe(TR_TICK, symbol)

    def subscribe_orderbook(self, symbols: list[str]) -> None:
        for symbol in symbols:
            self.subscribe(TR_ORDERBOOK, symbol)

    def subscribe_notice(self, hts_id: str) -> None:
        """체결통보 구독. tr_key 는 HTS ID 이다(종목코드가 아니다)."""
        self.subscribe(self.notice_tr_id, hts_id)

    # ------------------------------------------------------------- 수명주기
    def start(self, *, wait: float = 10.0) -> None:
        """백그라운드 스레드에서 접속을 시작한다."""
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run_forever, name="kis-realtime", daemon=True)
        self._thread.start()
        if wait and not self._connected.wait(timeout=wait):
            log.warning("실시간 웹소켓 접속이 %.0f초 내에 완료되지 않았습니다", wait)

    def stop(self) -> None:
        self._stop.set()
        self._connected.clear()
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:  # pragma: no cover - 종료 경로
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        log.info("실시간 웹소켓 종료")

    def __enter__(self) -> RealtimeClient:
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop()

    # ------------------------------------------------------------- 내부구현
    def _run_forever(self) -> None:
        import websocket  # 지연 임포트

        while not self._stop.is_set():
            try:
                self._ws = websocket.WebSocketApp(
                    f"{self.settings.ws_base}/tryitout/{TR_TICK}",
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as exc:  # pragma: no cover - 네트워크 의존
                log.error("실시간 웹소켓 오류: %s", exc)
            self._connected.clear()
            if self._stop.is_set():
                break
            log.info("%.0f초 후 재접속을 시도합니다", self.reconnect_delay)
            time.sleep(self.reconnect_delay)

    def _on_open(self, _ws: Any) -> None:
        log.info("실시간 웹소켓 접속 (%s)", self.settings.ws_base)
        self._connected.set()
        with self._lock:
            subs = list(self._subscriptions)
        for sub in subs:  # 재접속 시 구독 복구
            self._send(sub.tr_id, sub.tr_key, register=True)

    def _on_error(self, _ws: Any, error: Any) -> None:
        log.error("실시간 웹소켓 에러: %s", error)

    def _on_close(self, _ws: Any, status: Any, msg: Any) -> None:
        self._connected.clear()
        log.info("실시간 웹소켓 연결 종료 (status=%s, msg=%s)", status, msg)

    def _send(self, tr_id: str, tr_key: str, *, register: bool) -> None:
        frame = {
            "header": {
                "approval_key": self.tokens.approval_key,
                "custtype": "P",
                "tr_type": "1" if register else "2",  # 1: 등록, 2: 해제
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": tr_id, "tr_key": tr_key}},
        }
        try:
            self._ws.send(json.dumps(frame))
            log.debug("%s %s %s", "구독" if register else "해제", tr_id, tr_key)
        except Exception as exc:  # pragma: no cover - 네트워크 의존
            log.error("구독 요청 실패(%s %s): %s", tr_id, tr_key, exc)

    def _on_message(self, _ws: Any, raw: str) -> None:
        try:
            if raw and raw[0] in "01":
                self._handle_data(raw)
            else:
                self._handle_control(raw)
        except Exception:  # 콜백 예외가 수신 루프를 죽이지 않도록 격리
            log.exception("실시간 메시지 처리 중 오류: %.200s", raw)

    def _handle_control(self, raw: str) -> None:
        """등록 응답 / PINGPONG 등 JSON 제어 메시지."""
        payload = json.loads(raw)
        header = payload.get("header", {})
        tr_id = header.get("tr_id", "")

        if tr_id == "PINGPONG":
            self._ws.send(raw)  # 받은 프레임을 그대로 돌려준다.
            log.debug("PINGPONG 응답")
            return

        body = payload.get("body") or {}
        output = body.get("output") or {}
        if output.get("key") and output.get("iv"):
            self._aes[tr_id] = (output["key"], output["iv"])
            log.info("체결통보 복호화 키 수신 (%s)", tr_id)

        rt_cd = str(body.get("rt_cd", ""))
        msg = body.get("msg1", "")
        if rt_cd and rt_cd != "0":
            log.warning("실시간 등록 응답 오류 [%s] %s", body.get("msg_cd"), msg)
        else:
            log.debug("실시간 등록 응답 [%s] %s", tr_id, msg)

    def _handle_data(self, raw: str) -> None:
        encrypted = raw[0] == "1"
        parts = raw.split("|", 3)
        if len(parts) < 4:
            log.warning("형식을 알 수 없는 실시간 프레임: %.120s", raw)
            return
        _flag, tr_id, count_raw, body = parts

        if encrypted:
            keys = self._aes.get(tr_id)
            if not keys:
                log.warning("복호화 키가 없어 %s 메시지를 건너뜁니다", tr_id)
                return
            body = _decrypt_aes256(body, *keys)

        try:
            count = int(count_raw)
        except ValueError:
            count = 1

        for record in parse_body(tr_id, body, count):
            message = RealtimeMessage(
                tr_id=tr_id,
                tr_key=record.get("MKSC_SHRN_ISCD") or record.get("STCK_SHRN_ISCD") or "",
                data=record,
                encrypted=encrypted,
                raw=raw,
            )
            self._dispatch(message)

    def _dispatch(self, message: RealtimeMessage) -> None:
        for handler in self._handlers.get(message.tr_id, []):
            try:
                handler(message)
            except Exception:
                log.exception("핸들러 처리 중 오류 (%s)", message.tr_id)
        if self.on_message is not None:
            try:
                self.on_message(message)
            except Exception:
                log.exception("on_message 처리 중 오류")
