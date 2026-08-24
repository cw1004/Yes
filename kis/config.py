"""환경설정 로딩.

.env 파일 또는 환경변수에서 값을 읽어 :class:`Settings` 로 만든다.
실전투자(real) 로 동작할 때는 추가 확인 절차를 강제한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .errors import ConfigError

try:  # python-dotenv 는 선택 의존성처럼 다룬다(테스트 환경 배려).
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*_args, **_kwargs):  # type: ignore[misc]
        return False


# 실전/모의 도메인. KIS 개발자센터 문서 기준.
REAL_REST = "https://openapi.koreainvestment.com:9443"
PAPER_REST = "https://openapivts.koreainvestment.com:29443"
REAL_WS = "ws://ops.koreainvestment.com:21000"
PAPER_WS = "ws://ops.koreainvestment.com:31000"

# 유량 제한: 실전 20건/초, 모의 2건/초 (여유를 두고 보수적으로 설정)
REAL_RATE_LIMIT = 15.0
PAPER_RATE_LIMIT = 2.0


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(float(raw.strip().replace(",", "")))
    except ValueError as exc:
        raise ConfigError(f"{name} 값이 정수가 아닙니다: {raw!r}") from exc


@dataclass(frozen=True)
class RiskLimits:
    """주문 전 검증에 쓰이는 리스크 한도."""

    max_order_amount: int = 1_000_000
    max_position_amount: int = 3_000_000
    max_orders_per_day: int = 50
    max_daily_loss: int = 300_000
    max_positions: int = 5


@dataclass(frozen=True)
class Settings:
    """시스템 전역 설정."""

    env: str
    app_key: str
    app_secret: str
    account_no: str
    account_product_code: str
    allow_real_trading: bool = False
    dry_run: bool = True
    data_dir: Path = Path("./data")
    log_level: str = "INFO"
    risk: RiskLimits = field(default_factory=RiskLimits)

    # ---------------------------------------------------------------- 파생값
    @property
    def is_paper(self) -> bool:
        return self.env == "paper"

    @property
    def rest_base(self) -> str:
        return PAPER_REST if self.is_paper else REAL_REST

    @property
    def ws_base(self) -> str:
        return PAPER_WS if self.is_paper else REAL_WS

    @property
    def rate_limit_per_sec(self) -> float:
        return PAPER_RATE_LIMIT if self.is_paper else REAL_RATE_LIMIT

    @property
    def token_path(self) -> Path:
        return self.data_dir / f"token_{self.env}.json"

    @property
    def db_path(self) -> Path:
        return self.data_dir / f"trades_{self.env}.db"

    @property
    def kill_switch_path(self) -> Path:
        return self.data_dir / "KILL_SWITCH"

    def masked(self) -> dict[str, str]:
        """로그에 남겨도 안전한 형태로 요약."""

        def mask(value: str) -> str:
            if not value:
                return "(미설정)"
            return f"{value[:4]}...{value[-2:]}" if len(value) > 8 else "***"

        return {
            "env": self.env,
            "app_key": mask(self.app_key),
            "app_secret": mask(self.app_secret),
            "account": f"{self.account_no[:4]}****-{self.account_product_code}"
            if self.account_no
            else "(미설정)",
            "dry_run": str(self.dry_run),
            "allow_real_trading": str(self.allow_real_trading),
        }

    def ensure_orderable(self) -> None:
        """실주문을 내보내기 전에 호출하는 최종 안전 확인."""
        if self.is_paper:
            return
        if not self.allow_real_trading:
            raise ConfigError(
                "실전투자 환경(KIS_ENV=real)이지만 KIS_ALLOW_REAL_TRADING=false 입니다. "
                "실제 주문을 내려면 .env 에서 KIS_ALLOW_REAL_TRADING=true 로 명시하세요."
            )


def load_settings(env_file: str | os.PathLike[str] | None = ".env", *, override: bool = False) -> Settings:
    """`.env` 와 환경변수를 읽어 :class:`Settings` 를 만든다.

    Args:
        env_file: 읽을 dotenv 파일 경로. None 이면 환경변수만 사용한다.
        override: True 면 dotenv 값이 기존 환경변수를 덮어쓴다.
    """
    if env_file is not None and Path(env_file).exists():
        load_dotenv(env_file, override=override)

    env = (os.getenv("KIS_ENV") or "paper").strip().lower()
    if env in {"prod", "live", "real"}:
        env = "real"
    elif env in {"paper", "vts", "mock", "sim"}:
        env = "paper"
    else:
        raise ConfigError(f"KIS_ENV 는 paper 또는 real 이어야 합니다: {env!r}")

    app_key = (os.getenv("KIS_APP_KEY") or "").strip()
    app_secret = (os.getenv("KIS_APP_SECRET") or "").strip()
    account_no = (os.getenv("KIS_ACCOUNT_NO") or "").strip().replace("-", "")
    product_code = (os.getenv("KIS_ACCOUNT_PRODUCT_CODE") or "01").strip()

    missing = [
        name
        for name, value in (
            ("KIS_APP_KEY", app_key),
            ("KIS_APP_SECRET", app_secret),
            ("KIS_ACCOUNT_NO", account_no),
        )
        if not value
    ]
    if missing:
        raise ConfigError(
            "필수 환경변수가 비어 있습니다: " + ", ".join(missing) + ". .env.example 을 참고하세요."
        )

    if len(account_no) > 8:
        # "12345678-01" 처럼 상품코드까지 붙여 넣은 경우를 보정한다.
        product_code = account_no[8:10]
        account_no = account_no[:8]

    data_dir = Path(os.getenv("KIS_DATA_DIR") or "./data").expanduser()
    data_dir.mkdir(parents=True, exist_ok=True)

    return Settings(
        env=env,
        app_key=app_key,
        app_secret=app_secret,
        account_no=account_no,
        account_product_code=product_code,
        allow_real_trading=_env_bool("KIS_ALLOW_REAL_TRADING", False),
        dry_run=_env_bool("KIS_DRY_RUN", True),
        data_dir=data_dir,
        log_level=(os.getenv("KIS_LOG_LEVEL") or "INFO").upper(),
        risk=RiskLimits(
            max_order_amount=_env_int("KIS_MAX_ORDER_AMOUNT", 1_000_000),
            max_position_amount=_env_int("KIS_MAX_POSITION_AMOUNT", 3_000_000),
            max_orders_per_day=_env_int("KIS_MAX_ORDERS_PER_DAY", 50),
            max_daily_loss=_env_int("KIS_MAX_DAILY_LOSS", 300_000),
            max_positions=_env_int("KIS_MAX_POSITIONS", 5),
        ),
    )
