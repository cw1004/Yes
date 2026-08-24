from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
import responses

from kis.auth import Token, TokenManager, _parse_expiry
from kis.errors import AuthError


def test_token_validity_margin():
    soon = Token("v", datetime.now(timezone.utc) + timedelta(minutes=5))
    later = Token("v", datetime.now(timezone.utc) + timedelta(hours=5))
    assert not soon.is_valid   # 만료 10분 전부터는 갱신 대상
    assert later.is_valid


def test_parse_expiry_prefers_kst_string():
    expires = _parse_expiry({"access_token_token_expired": "2026-08-25 09:00:00", "expires_in": 60})
    assert expires.astimezone(timezone(timedelta(hours=9))).hour == 9


def test_parse_expiry_falls_back_to_expires_in():
    expires = _parse_expiry({"expires_in": 3600})
    assert timedelta(minutes=55) < expires - datetime.now(timezone.utc) <= timedelta(hours=1)


@responses.activate
def test_token_is_cached_on_disk_and_reused(settings):
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"access_token": "T1", "expires_in": 86400}, status=200)

    first = TokenManager(settings)
    assert first.access_token == "T1"
    assert settings.token_path.exists()
    assert json.loads(settings.token_path.read_text())["access_token"] == "T1"

    # 새 인스턴스도 디스크 캐시를 재사용하므로 추가 발급 요청이 없다.
    assert TokenManager(settings).access_token == "T1"
    assert len(responses.calls) == 1


@responses.activate
def test_invalidate_forces_reissue(settings):
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"access_token": "T1", "expires_in": 86400}, status=200)
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"access_token": "T2", "expires_in": 86400}, status=200)

    manager = TokenManager(settings)
    assert manager.access_token == "T1"
    manager.invalidate()
    assert not settings.token_path.exists()
    assert manager.access_token == "T2"


@responses.activate
def test_expired_cache_is_ignored(settings):
    settings.token_path.write_text(json.dumps({
        "access_token": "OLD",
        "expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
    }))
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"access_token": "NEW", "expires_in": 86400}, status=200)
    assert TokenManager(settings).access_token == "NEW"


@responses.activate
def test_corrupt_cache_is_ignored(settings):
    settings.token_path.write_text("{not json")
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"access_token": "NEW", "expires_in": 86400}, status=200)
    assert TokenManager(settings).access_token == "NEW"


@responses.activate
def test_failed_issue_raises_auth_error(settings):
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/tokenP",
                  json={"error_description": "잘못된 appkey"}, status=403)
    with pytest.raises(AuthError):
        _ = TokenManager(settings).access_token


@responses.activate
def test_approval_key_uses_secretkey_field(settings):
    responses.add(responses.POST, f"{settings.rest_base}/oauth2/Approval",
                  json={"approval_key": "AK-123"}, status=200)
    manager = TokenManager(settings)
    assert manager.approval_key == "AK-123"
    assert manager.approval_key == "AK-123"  # 캐시
    body = json.loads(responses.calls[0].request.body)
    assert body["secretkey"] == settings.app_secret and "appsecret" not in body
    assert len(responses.calls) == 1
