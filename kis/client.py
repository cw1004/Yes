"""KIS REST API 공통 클라이언트.

- 공통 헤더(appkey/appsecret/authorization/tr_id) 자동 구성
- 유량 제한 준수(토큰 버킷)
- 일시적 오류 재시도(지수 백오프) 및 토큰 만료 시 자동 재발급
- 연속조회(tr_cont / CTX_AREA_*) 페이지네이션 헬퍼
"""

from __future__ import annotations

import json
import logging
import random
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import requests

from .auth import TokenManager
from .config import Settings
from .errors import ApiError, HttpError, RateLimitError
from .ratelimit import RateLimiter

log = logging.getLogger(__name__)

MAX_RETRIES = 4
BACKOFF_BASE = 0.6

# 재발급이 필요한(토큰 만료/무효) 오류 코드
TOKEN_ERROR_CODES = {"EGW00121", "EGW00123", "EGW00133"}
# 초당 거래건수 초과
RATE_LIMIT_CODES = {"EGW00201"}


@dataclass
class KisResponse:
    """KIS 응답 래퍼."""

    status: int
    body: dict[str, Any]
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def rt_cd(self) -> str:
        return str(self.body.get("rt_cd", ""))

    @property
    def msg1(self) -> str:
        return str(self.body.get("msg1", "")).strip()

    @property
    def msg_cd(self) -> str:
        return str(self.body.get("msg_cd", ""))

    @property
    def is_ok(self) -> bool:
        return self.rt_cd == "0"

    @property
    def output(self) -> Any:
        """output / output1 / output2 중 존재하는 첫 항목."""
        for key in ("output", "output1", "output2"):
            if key in self.body:
                return self.body[key]
        return None

    def get_output(self, key: str = "output") -> Any:
        return self.body.get(key)

    @property
    def tr_cont(self) -> str:
        """연속조회 여부. 'F'/'M' 이면 다음 페이지가 있다."""
        return (self.headers.get("tr_cont") or self.headers.get("TR_CONT") or "").strip()

    @property
    def has_next(self) -> bool:
        return self.tr_cont in {"F", "M"}


class KisClient:
    """KIS Open API REST 호출기."""

    def __init__(
        self,
        settings: Settings,
        token_manager: TokenManager | None = None,
        session: requests.Session | None = None,
        limiter: RateLimiter | None = None,
    ) -> None:
        self.settings = settings
        self.session = session or requests.Session()
        self.tokens = token_manager or TokenManager(settings, self.session)
        self.limiter = limiter or RateLimiter(settings.rate_limit_per_sec)

    # --------------------------------------------------------------- 유틸
    def tr(self, real: str, paper: str | None = None) -> str:
        """환경에 맞는 거래ID 를 고른다.

        대부분의 모의투자 tr_id 는 실전 tr_id 의 첫 글자를 ``V`` 로 바꾼 형태이다.
        """
        if not self.settings.is_paper:
            return real
        if paper:
            return paper
        return "V" + real[1:] if real else real

    def _headers(self, tr_id: str, *, tr_cont: str = "", hashkey: str | None = None) -> dict[str, str]:
        headers = {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.tokens.access_token}",
            "appkey": self.settings.app_key,
            "appsecret": self.settings.app_secret,
            "tr_id": tr_id,
            "custtype": "P",  # P: 개인, B: 법인
            "tr_cont": tr_cont,
            # 문의/추적용 고유 ID. KIS 측 로그 대조에 도움이 된다.
            "gt_uid": uuid.uuid4().hex[:32],
        }
        if hashkey:
            headers["hashkey"] = hashkey
        return headers

    def hashkey(self, body: dict[str, Any]) -> str:
        """주문 등 POST 바디의 위변조 검증용 해시키를 발급받는다."""
        url = f"{self.settings.rest_base}/uapi/hashkey"
        self.limiter.acquire()
        res = self.session.post(
            url,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json; charset=utf-8",
                "appkey": self.settings.app_key,
                "appsecret": self.settings.app_secret,
            },
            timeout=10,
        )
        if res.status_code != 200:
            raise HttpError(f"hashkey 발급 실패(HTTP {res.status_code})", status=res.status_code, body=res.text[:300])
        key = res.json().get("HASH")
        if not key:
            raise HttpError(f"hashkey 응답에 HASH 가 없습니다: {res.text[:200]}")
        return key

    # ------------------------------------------------------------- 핵심 호출
    def request(
        self,
        method: str,
        path: str,
        *,
        tr_id: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        tr_cont: str = "",
        use_hashkey: bool = False,
        raise_on_error: bool = True,
        timeout: float = 15.0,
    ) -> KisResponse:
        """API 를 호출하고 :class:`KisResponse` 를 돌려준다."""
        url = f"{self.settings.rest_base}{path}"
        payload = None
        if body is not None:
            # 서버가 검증하는 해시는 '전송한 바이트' 기준이므로 직렬화 결과를 그대로 보낸다.
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

        last_exc: Exception | None = None
        for attempt in range(MAX_RETRIES):
            hashkey = self.hashkey(body) if (use_hashkey and body is not None) else None
            headers = self._headers(tr_id, tr_cont=tr_cont, hashkey=hashkey)

            self.limiter.acquire()
            try:
                res = self.session.request(
                    method.upper(), url, params=params, data=payload, headers=headers, timeout=timeout
                )
            except requests.RequestException as exc:
                last_exc = HttpError(f"{path} 요청 실패: {exc}")
                self._sleep_backoff(attempt, reason=str(exc))
                continue

            # --- HTTP 레벨 처리 -----------------------------------------
            if res.status_code == 401:
                log.warning("401 응답 → 접근토큰 재발급 후 재시도 (%s)", path)
                self.tokens.invalidate()
                last_exc = HttpError("인증 실패(401)", status=401, body=res.text[:300])
                self._sleep_backoff(attempt, reason="401")
                continue
            if res.status_code == 429 or res.status_code >= 500:
                last_exc = (RateLimitError if res.status_code == 429 else HttpError)(
                    f"{path} HTTP {res.status_code}", status=res.status_code, body=res.text[:300]
                )
                self._sleep_backoff(attempt, reason=f"HTTP {res.status_code}")
                continue
            if res.status_code != 200:
                raise HttpError(
                    f"{path} HTTP {res.status_code}: {res.text[:300]}", status=res.status_code, body=res.text[:300]
                )

            try:
                data = res.json()
            except ValueError as exc:
                raise HttpError(f"{path} 응답을 JSON 으로 해석할 수 없습니다: {res.text[:200]}") from exc

            response = KisResponse(status=res.status_code, body=data, headers=dict(res.headers))

            # --- 업무 레벨 처리 -----------------------------------------
            if not response.is_ok:
                if response.msg_cd in RATE_LIMIT_CODES:
                    last_exc = RateLimitError(f"유량 초과: {response.msg1}", status=200)
                    self._sleep_backoff(attempt, reason="EGW00201")
                    continue
                if response.msg_cd in TOKEN_ERROR_CODES:
                    log.warning("토큰 오류(%s) → 재발급 후 재시도", response.msg_cd)
                    self.tokens.invalidate()
                    last_exc = ApiError(response.msg1, rt_cd=response.rt_cd, msg_cd=response.msg_cd, path=path)
                    self._sleep_backoff(attempt, reason=response.msg_cd)
                    continue
                if raise_on_error:
                    raise ApiError(
                        response.msg1 or "API 오류",
                        rt_cd=response.rt_cd,
                        msg_cd=response.msg_cd,
                        path=path,
                        status=res.status_code,
                        body=data,
                    )
            return response

        assert last_exc is not None
        raise last_exc

    def get(self, path: str, *, tr_id: str, params: dict[str, Any] | None = None, **kwargs: Any) -> KisResponse:
        return self.request("GET", path, tr_id=tr_id, params=params, **kwargs)

    def post(self, path: str, *, tr_id: str, body: dict[str, Any], **kwargs: Any) -> KisResponse:
        return self.request("POST", path, tr_id=tr_id, body=body, **kwargs)

    # ------------------------------------------------------------ 연속조회
    def paginate(
        self,
        path: str,
        *,
        tr_id: str,
        params: dict[str, Any],
        fk_key: str = "CTX_AREA_FK100",
        nk_key: str = "CTX_AREA_NK100",
        max_pages: int = 20,
    ) -> Iterator[KisResponse]:
        """연속조회(tr_cont) 를 자동으로 따라가며 페이지를 순회한다."""
        page_params = dict(params)
        page_params.setdefault(fk_key, "")
        page_params.setdefault(nk_key, "")
        tr_cont = ""

        for _ in range(max_pages):
            res = self.get(path, tr_id=tr_id, params=page_params, tr_cont=tr_cont)
            yield res
            if not res.has_next:
                return
            tr_cont = "N"  # 다음 페이지 요청
            page_params[fk_key] = res.body.get(fk_key.lower(), page_params[fk_key])
            page_params[nk_key] = res.body.get(nk_key.lower(), page_params[nk_key])
        log.warning("연속조회 최대 페이지(%d)에 도달했습니다: %s", max_pages, path)

    @staticmethod
    def _sleep_backoff(attempt: int, *, reason: str) -> None:
        delay = BACKOFF_BASE * (2**attempt) + random.uniform(0, 0.25)
        log.debug("재시도 대기 %.2fs (attempt=%d, reason=%s)", delay, attempt + 1, reason)
        time.sleep(delay)
