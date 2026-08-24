"""국내 주식시장 규칙: 호가 단위, 장 운영 시간, 수수료 추정."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

KST = timezone(timedelta(hours=9))

# 정규장
MARKET_OPEN = time(9, 0)
MARKET_CLOSE = time(15, 30)
# 장 시작 동시호가 접수 시작
PREOPEN_START = time(8, 30)

# 2023년 호가가격단위 개편 기준 (코스피/코스닥 공통, 코스닥 5만원 이상만 상이)
_TICK_TABLE = (
    (2_000, 1),
    (5_000, 5),
    (20_000, 10),
    (50_000, 50),
    (200_000, 100),
    (500_000, 500),
)
_TICK_MAX = 1_000


def tick_size(price: int, *, kosdaq: bool = False) -> int:
    """가격대별 호가 단위를 반환한다."""
    if kosdaq and price >= 50_000:
        return 100
    for upper, tick in _TICK_TABLE:
        if price < upper:
            return tick
    return _TICK_MAX


def round_to_tick(price: float, *, mode: str = "nearest", kosdaq: bool = False) -> int:
    """호가 단위에 맞게 가격을 보정한다.

    Args:
        mode: ``nearest`` | ``down``(매수에 유리) | ``up``(매도에 유리)
    """
    price = max(float(price), 0.0)
    tick = tick_size(int(price), kosdaq=kosdaq)
    quotient = price / tick
    if mode == "down":
        adjusted = int(quotient) * tick
    elif mode == "up":
        adjusted = -(-int(price) // tick) * tick if price % tick else int(price)
    else:
        adjusted = round(quotient) * tick
    return max(int(adjusted), tick)


def is_business_day(day: date | None = None) -> bool:
    """주말이 아닌지 확인한다(공휴일은 별도 달력이 필요하다)."""
    day = day or now_kst().date()
    return day.weekday() < 5


def now_kst() -> datetime:
    return datetime.now(KST)


def is_market_open(at: datetime | None = None) -> bool:
    """정규장 시간(09:00~15:30, 평일) 여부."""
    at = at or now_kst()
    if not is_business_day(at.date()):
        return False
    return MARKET_OPEN <= at.time() <= MARKET_CLOSE


def seconds_until_open(at: datetime | None = None) -> float:
    """다음 정규장 개장까지 남은 초. 이미 장중이면 0."""
    at = at or now_kst()
    if is_market_open(at):
        return 0.0
    candidate = at.replace(hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0)
    if candidate <= at:
        candidate += timedelta(days=1)
    while not is_business_day(candidate.date()):
        candidate += timedelta(days=1)
    return (candidate - at).total_seconds()


# 수수료/세금 추정치 (증권사·계좌 유형에 따라 다르므로 근사값이다)
DEFAULT_COMMISSION_RATE = 0.00015  # 온라인 위탁수수료 0.015% 가정
SELL_TAX_RATE = 0.0018             # 증권거래세 + 농특세 (2025년 기준 근사)


def estimate_fees(amount: int, *, is_sell: bool, commission_rate: float = DEFAULT_COMMISSION_RATE) -> int:
    """예상 수수료(+매도 시 세금). 손익 추정에만 사용한다."""
    fee = amount * commission_rate
    if is_sell:
        fee += amount * SELL_TAX_RATE
    return int(fee)
