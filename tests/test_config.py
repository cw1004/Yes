from __future__ import annotations

import pytest

from kis.config import PAPER_REST, REAL_REST, load_settings
from kis.errors import ConfigError


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in list(dict(__import__("os").environ)):
        if key.startswith("KIS_"):
            monkeypatch.delenv(key, raising=False)


def _base_env(monkeypatch, tmp_path, **extra):
    monkeypatch.setenv("KIS_APP_KEY", "key")
    monkeypatch.setenv("KIS_APP_SECRET", "secret")
    monkeypatch.setenv("KIS_ACCOUNT_NO", "12345678")
    monkeypatch.setenv("KIS_DATA_DIR", str(tmp_path))
    for key, value in extra.items():
        monkeypatch.setenv(key, str(value))


def test_defaults_to_paper(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path)
    settings = load_settings(env_file=None)
    assert settings.env == "paper"
    assert settings.rest_base == PAPER_REST
    assert settings.dry_run is True  # 안전 기본값
    assert settings.allow_real_trading is False


def test_real_env_uses_real_host(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path, KIS_ENV="real")
    assert load_settings(env_file=None).rest_base == REAL_REST


def test_missing_credentials_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("KIS_DATA_DIR", str(tmp_path))
    with pytest.raises(ConfigError, match="KIS_APP_KEY"):
        load_settings(env_file=None)


def test_account_with_dash_is_split(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path)
    monkeypatch.setenv("KIS_ACCOUNT_NO", "12345678-02")
    settings = load_settings(env_file=None)
    assert settings.account_no == "12345678"
    assert settings.account_product_code == "02"


def test_real_trading_requires_explicit_opt_in(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path, KIS_ENV="real")
    settings = load_settings(env_file=None)
    with pytest.raises(ConfigError, match="KIS_ALLOW_REAL_TRADING"):
        settings.ensure_orderable()

    monkeypatch.setenv("KIS_ALLOW_REAL_TRADING", "true")
    load_settings(env_file=None).ensure_orderable()  # 예외 없음


def test_paper_env_never_blocks(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path)
    load_settings(env_file=None).ensure_orderable()


def test_masked_hides_secrets(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path)
    monkeypatch.setenv("KIS_APP_SECRET", "super-secret-value")
    masked = load_settings(env_file=None).masked()
    assert "super-secret-value" not in str(masked)


def test_invalid_env_rejected(monkeypatch, tmp_path):
    _base_env(monkeypatch, tmp_path, KIS_ENV="staging")
    with pytest.raises(ConfigError):
        load_settings(env_file=None)
