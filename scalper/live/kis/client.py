"""한국투자증권 Open API REST 클라이언트.

실전에서 걸리는 것들을 먼저 처리합니다.

- **토큰 발급 빈도 제한**: KIS 는 접근토큰을 자주 재발급하면 거부합니다.
  그래서 디스크에 캐시하고, 만료 전에만 갱신합니다. 프로그램을 여러 번
  재시작해도 토큰을 다시 받지 않습니다.
- **해시키**: 주문 본문은 hashkey 를 함께 보내야 합니다.
- **유량 제한**: 실전 초당 20건, 모의는 훨씬 빡빡합니다. 스스로 간격을 둡니다.
- **tr_id 혼동**: 실전/모의 tr_id 를 섞으면 조용히 거부당합니다. 한곳에서 고릅니다.
"""

from __future__ import annotations

import json
import os
import pathlib
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from ..types import BrokerError
from . import spec as spec_mod

RETRY_STATUS = {429, 500, 502, 503, 504}


class KISError(BrokerError):
    """한국투자증권 API 오류. msg_cd / msg1 을 그대로 담아 원인을 추적합니다."""

    def __init__(self, message: str, status: int = 0, body: str = "",
                 code: str = "", hint: str = ""):
        super().__init__(message, status, body)
        self.code = code
        self.hint = hint

    def __str__(self) -> str:
        base = super().__str__()
        if self.code:
            base = f"[{self.code}] {base}"
        if self.hint:
            base += f"\n  → {self.hint}"
        return base


@dataclass
class KISCredentials:
    app_key: str
    app_secret: str
    account: str          # 계좌번호 8자리 (CANO)
    product_code: str = "01"   # 상품코드 (ACNT_PRDT_CD)

    @classmethod
    def from_env(cls) -> "KISCredentials":
        acct = os.environ.get("KIS_ACCOUNT", "").replace("-", "").strip()
        return cls(
            app_key=os.environ.get("KIS_APP_KEY", "").strip(),
            app_secret=os.environ.get("KIS_APP_SECRET", "").strip(),
            account=acct[:8],
            product_code=(os.environ.get("KIS_PRODUCT_CODE") or acct[8:] or "01")[:2],
        )

    @property
    def complete(self) -> bool:
        return bool(self.app_key and self.app_secret and len(self.account) == 8)


class KISClient:
    def __init__(self, creds: KISCredentials, paper: bool = True,
                 spec: dict | None = None, token_file: str = ".kis_token.json",
                 max_retries: int = 3, timeout: int = 12):
        if not creds.complete:
            raise KISError(
                "KIS 자격정보가 부족합니다.",
                hint="KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT(계좌 8자리) 를 "
                     "환경변수로 설정하세요.")
        self.creds = creds
        self.paper = paper
        self.spec = spec or spec_mod.load()
        self.base = self.spec["base"]["paper" if paper else "real"]
        self.token_file = pathlib.Path(token_file)
        self.max_retries = max_retries
        self.timeout = timeout
        self._token = ""
        self._token_exp = 0.0
        self._lock = threading.Lock()
        self._last_call = 0.0
        limits = self.spec["limits"]
        rate = limits["calls_per_sec_paper"] if paper else limits["calls_per_sec_real"]
        self._min_gap = 1.0 / max(1, rate)
        self.calls = 0

    # ── 토큰 ──────────────────────────────────────────────────────────
    def _load_cached_token(self) -> bool:
        try:
            d = json.loads(self.token_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        if d.get("paper") != self.paper or d.get("app_key") != self.creds.app_key[:8]:
            return False
        if float(d.get("expires_at", 0)) - 300 < time.time():
            return False
        self._token = str(d.get("access_token", ""))
        self._token_exp = float(d.get("expires_at", 0))
        return bool(self._token)

    def _save_token(self) -> None:
        payload = json.dumps({
            "access_token": self._token, "expires_at": self._token_exp,
            "paper": self.paper, "app_key": self.creds.app_key[:8],
        })
        parent = self.token_file.parent if str(self.token_file.parent) else pathlib.Path(".")
        fd, tmp = tempfile.mkstemp(dir=str(parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, self.token_file)
            os.chmod(self.token_file, 0o600)      # 토큰은 자격증명입니다
        except BaseException:
            pathlib.Path(tmp).unlink(missing_ok=True)
            raise

    def token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._token_exp - 300:
                return self._token
            if self._load_cached_token():
                return self._token

            body = {"grant_type": "client_credentials",
                    "appkey": self.creds.app_key,
                    "appsecret": self.creds.app_secret}
            d = self._raw("POST", self.spec["paths"]["token"], body=body, auth=False)
            token = str(d.get("access_token", ""))
            if not token:
                raise KISError(
                    "접근토큰을 받지 못했습니다.", body=json.dumps(d, ensure_ascii=False),
                    hint="앱키/시크릿이 맞는지, 실전키를 모의투자에 쓰고 있지 않은지 "
                         "확인하세요. 토큰은 1분에 1회만 발급됩니다.")
            ttl = float(d.get("expires_in") or self.spec["limits"]["token_ttl_sec"])
            self._token = token
            self._token_exp = time.time() + ttl
            try:
                self._save_token()
            except OSError:
                pass          # 캐시 실패는 치명적이지 않습니다
            return self._token

    # ── 요청 ──────────────────────────────────────────────────────────
    def _throttle(self) -> None:
        gap = time.monotonic() - self._last_call
        if gap < self._min_gap:
            time.sleep(self._min_gap - gap)
        self._last_call = time.monotonic()

    def _raw(self, method: str, path: str, body: dict | None = None,
             params: dict | None = None, headers: dict | None = None,
             auth: bool = True) -> dict:
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        head = {"content-type": "application/json; charset=utf-8",
                "appkey": self.creds.app_key, "appsecret": self.creds.app_secret}
        if auth:
            head["authorization"] = f"Bearer {self.token()}"
        head.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None

        last = ""
        for attempt in range(self.max_retries + 1):
            self._throttle()
            self.calls += 1
            req = urllib.request.Request(url, data=data, method=method, headers=head)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    raw = r.read().decode("utf-8", "replace")
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as e:
                last = e.read().decode("utf-8", "replace")[:500]
                if e.code not in RETRY_STATUS or attempt == self.max_retries:
                    raise KISError(f"HTTP {e.code}", status=e.code, body=last,
                                   hint=_http_hint(e.code)) from e
                time.sleep(min(2 ** attempt, 20))
            except (urllib.error.URLError, TimeoutError, OSError,
                    json.JSONDecodeError) as e:
                last = str(e)
                if attempt == self.max_retries:
                    raise KISError(f"연결 실패: {last}") from e
                time.sleep(min(2 ** attempt, 20))
        raise KISError(f"재시도 소진: {last}")

    def hashkey(self, body: dict) -> str:
        d = self._raw("POST", self.spec["paths"]["hashkey"], body=body, auth=False)
        return str(d.get("HASH", ""))

    def call(self, method: str, path: str, tr_id: str, body: dict | None = None,
             params: dict | None = None, use_hashkey: bool = False) -> dict:
        """업무 호출. rt_cd 가 '0' 이 아니면 KIS 메시지를 그대로 올립니다."""
        headers = {"tr_id": tr_id, "custtype": "P"}
        if use_hashkey and body is not None:
            headers["hashkey"] = self.hashkey(body)

        d = self._raw(method, path, body=body, params=params, headers=headers)
        rt = str(d.get("rt_cd", "0"))
        if rt not in ("0", ""):
            raise KISError(str(d.get("msg1", "")).strip() or "API 오류",
                           body=json.dumps(d, ensure_ascii=False)[:500],
                           code=str(d.get("msg_cd", "")),
                           hint=_msg_hint(str(d.get("msg_cd", ""))))
        return d

    # ── 편의 ──
    @property
    def tr(self) -> dict:
        return self.spec["tr_id"]["paper" if self.paper else "real"]

    def account_body(self) -> dict:
        return {"CANO": self.creds.account,
                "ACNT_PRDT_CD": self.creds.product_code}


def _http_hint(code: int) -> str:
    return {
        401: "접근토큰이 만료되었거나 앱키가 맞지 않습니다. "
             ".kis_token.json 을 지우고 다시 시도하세요.",
        403: "해당 API 사용 권한이 없습니다. KIS Developers 에서 해외주식 "
             "서비스를 신청했는지 확인하세요.",
        429: "호출 유량을 초과했습니다. --interval 을 늘리세요.",
        500: "KIS 서버 오류입니다. 잠시 뒤 다시 시도됩니다.",
    }.get(code, "")


def _msg_hint(code: str) -> str:
    """자주 보는 업무 오류에 대한 안내. 코드 체계는 개정될 수 있습니다."""
    table = {
        "EGW00123": "앱키/시크릿이 유효하지 않습니다.",
        "EGW00133": "토큰 발급이 너무 잦습니다. 1분 뒤 다시 시도하세요.",
        "40250000": "주문 가능 수량/금액을 확인하세요.",
    }
    return table.get(code, "")
