from __future__ import annotations

import pytest

from kis.config import RiskLimits, Settings
from kis.storage import Storage


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        env="paper",
        app_key="APPKEY-TEST-0001",
        app_secret="APPSECRET-TEST-0001",
        account_no="12345678",
        account_product_code="01",
        allow_real_trading=False,
        dry_run=False,
        data_dir=tmp_path,
        risk=RiskLimits(
            max_order_amount=1_000_000,
            max_position_amount=3_000_000,
            max_orders_per_day=5,
            max_daily_loss=100_000,
            max_positions=3,
        ),
    )


@pytest.fixture
def real_settings(settings) -> Settings:
    from dataclasses import replace

    return replace(settings, env="real")


@pytest.fixture
def storage(settings) -> Storage:
    store = Storage(settings.db_path, env=settings.env)
    yield store
    store.close()


@pytest.fixture
def token_response(settings):
    """토큰 발급 엔드포인트 응답 등록 헬퍼."""
    import responses as responses_lib

    def register(rsps: responses_lib.RequestsMock) -> None:
        rsps.add(
            responses_lib.POST,
            f"{settings.rest_base}/oauth2/tokenP",
            json={"access_token": "TEST-TOKEN", "expires_in": 86400, "token_type": "Bearer"},
            status=200,
        )

    return register
