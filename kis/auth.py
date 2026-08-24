"""접근토큰(access token) / 웹소켓 승인키(approval key) 관리.

KIS 는 접근토큰 발급 횟수를 제한한다(유효기간 24시간, 재발급은 분당 1회 수준).
따라서 토큰을 디스크에 캐시해 두고 만료가 임박할 때만 재발급한다.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from .config import Settings
from .errors import AuthError

log = logging.getLogger(__name__)

# 만료 이 시간 전부터는 미리 재발급한다.
RENEW_MARGIN = timedelta(minutes=10)
_KST = timezone(timedelta(hours=9))


@dataclass
class Token:
    value: str
    expires_at: datetime

    @property
    def is_valid(self) -> bool:
        return bool(self.value) and datetime.now(timezone.utc) < self.expires_at - RENEW_MARGIN

    def to_dict(self) -> dict:
        return {"access_token": self.value, "expires_at": self.expires_at.isoformat()}

    @classmethod
    def from_dict(cls, raw: dict) -> Token:
        return cls(value=raw["access_token"], expires_at=datetime.fromisoformat(raw["expires_at"]))


def _parse_expiry(payload: dict) -> datetime:
    """응답에서 만료 시각을 계산한다.

    ``access_token_token_expired`` 는 KST 문자열, ``expires_in`` 은 초 단위이다.
    """
    expired_at = payload.get("access_token_token_expired")
    if expired_at:
        try:
            naive = datetime.strptime(expired_at, "%Y-%m-%d %H:%M:%S")
            return naive.replace(tzinfo=_KST).astimezone(timezone.utc)
        except ValueError:
            log.debug("access_token_token_expired 파싱 실패: %r", expired_at)
    seconds = int(payload.get("expires_in") or 86400)
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


class TokenManager:
    """접근토큰 캐시 + 자동 재발급."""

    def __init__(self, settings: Settings, session: requests.Session | None = None) -> None:
        self.settings = settings
        self.session = session or requests.Session()
        self._token: Token | None = None
        self._approval_key: str | None = None
        self._lock = threading.RLock()

    # ------------------------------------------------------------ 공개 API
    @property
    def access_token(self) -> str:
        """유효한 접근토큰을 반환한다(필요하면 발급/갱신)."""
        with self._lock:
            if self._token is None:
                self._token = self._load_cached()
            if self._token is None or not self._token.is_valid:
                self._token = self._issue()
                self._save_cached(self._token)
            return self._token.value

    @property
    def approval_key(self) -> str:
        """실시간 시세 웹소켓 접속용 승인키(프로세스 수명 동안 캐시)."""
        with self._lock:
            if not self._approval_key:
                self._approval_key = self._issue_approval_key()
            return self._approval_key

    def invalidate(self) -> None:
        """토큰을 폐기해 다음 호출에서 재발급되도록 한다(401 대응)."""
        with self._lock:
            self._token = None
            path = self.settings.token_path
            if path.exists():
                try:
                    path.unlink()
                except OSError:  # pragma: no cover
                    log.warning("토큰 캐시 삭제 실패: %s", path)

    def revoke(self) -> None:
        """서버에 토큰 폐기를 요청한다."""
        with self._lock:
            token = self._token or self._load_cached()
            if token is None:
                return
            try:
                self.session.post(
                    f"{self.settings.rest_base}/oauth2/revokeP",
                    json={
                        "appkey": self.settings.app_key,
                        "appsecret": self.settings.app_secret,
                        "token": token.value,
                    },
                    headers={"content-type": "application/json; charset=utf-8"},
                    timeout=10,
                )
            except requests.RequestException as exc:  # pragma: no cover - 네트워크 의존
                log.warning("토큰 폐기 요청 실패(무시): %s", exc)
            self.invalidate()

    # ------------------------------------------------------------- 내부 구현
    def _issue(self) -> Token:
        url = f"{self.settings.rest_base}/oauth2/tokenP"
        body = {
            "grant_type": "client_credentials",
            "appkey": self.settings.app_key,
            "appsecret": self.settings.app_secret,
        }
        try:
            res = self.session.post(
                url, json=body, headers={"content-type": "application/json; charset=utf-8"}, timeout=15
            )
        except requests.RequestException as exc:
            raise AuthError(f"접근토큰 발급 요청 실패: {exc}") from exc

        if res.status_code != 200:
            raise AuthError(f"접근토큰 발급 실패(HTTP {res.status_code}): {res.text[:300]}")

        payload = res.json()
        token_value = payload.get("access_token")
        if not token_value:
            raise AuthError(f"응답에 access_token 이 없습니다: {payload}")

        token = Token(value=token_value, expires_at=_parse_expiry(payload))
        log.info("접근토큰 발급 완료 (만료 %s)", token.expires_at.astimezone(_KST).strftime("%Y-%m-%d %H:%M:%S KST"))
        return token

    def _issue_approval_key(self) -> str:
        url = f"{self.settings.rest_base}/oauth2/Approval"
        body = {
            "grant_type": "client_credentials",
            "appkey": self.settings.app_key,
            "secretkey": self.settings.app_secret,  # 승인키 발급만 필드명이 secretkey 이다.
        }
        try:
            res = self.session.post(
                url, json=body, headers={"content-type": "application/json; charset=utf-8"}, timeout=15
            )
        except requests.RequestException as exc:
            raise AuthError(f"승인키 발급 요청 실패: {exc}") from exc

        if res.status_code != 200:
            raise AuthError(f"승인키 발급 실패(HTTP {res.status_code}): {res.text[:300]}")
        key = res.json().get("approval_key")
        if not key:
            raise AuthError(f"응답에 approval_key 가 없습니다: {res.text[:300]}")
        log.info("웹소켓 승인키 발급 완료")
        return key

    def _load_cached(self) -> Token | None:
        path = self.settings.token_path
        if not path.exists():
            return None
        try:
            token = Token.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError):
            log.warning("토큰 캐시를 읽을 수 없어 무시합니다: %s", path)
            return None
        if not token.is_valid:
            return None
        log.debug("캐시된 접근토큰 사용 (만료 %s)", token.expires_at.isoformat())
        return token

    def _save_cached(self, token: Token) -> None:
        path = self.settings.token_path
        path.parent.mkdir(parents=True, exist_ok=True)
        # 부분 기록으로 캐시가 깨지지 않도록 임시파일 → rename.
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".token", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(token.to_dict(), fh)
            os.replace(tmp, path)
            os.chmod(path, 0o600)  # 토큰은 소유자만 읽을 수 있게.
        except OSError as exc:  # pragma: no cover
            log.warning("토큰 캐시 저장 실패(무시): %s", exc)
            Path(tmp).unlink(missing_ok=True)
