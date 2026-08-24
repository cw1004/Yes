# KIS Trader — 한국투자증권 API 개인 매매 시스템

한국투자증권 [KIS Open API](https://apiportal.koreainvestment.com) 를 연결한 개인용 국내주식
자동매매 시스템입니다. 시세 조회 · 주문 · 잔고 · 실시간 체결통보 · 전략 실행 · 리스크 관리 ·
매매 기록을 하나의 파이썬 패키지로 묶었습니다.

> ⚠️ **실거래 경고**
> 이 시스템은 실제 돈으로 실제 주문을 냅니다. 코드의 버그, 네트워크 장애, 잘못된 전략은
> 그대로 금전 손실로 이어집니다. **반드시 모의투자(`KIS_ENV=paper`) → dry-run 해제 →
> 소액 실전** 순서로 단계를 밟으세요. 기본 설정은 "모의투자 + 주문 미전송" 입니다.
> 투자 손익의 책임은 전적으로 사용자 본인에게 있습니다.

---

## 1. 무엇이 들어 있나

| 모듈 | 역할 |
|------|------|
| `kis/config.py` | `.env` 로딩, 실전/모의 도메인 분기, 리스크 한도 |
| `kis/auth.py` | 접근토큰 발급·디스크 캐시·자동 갱신, 웹소켓 승인키 |
| `kis/client.py` | 공통 REST 호출기 (헤더 구성, 유량 제한, 재시도, 연속조회) |
| `kis/quotes.py` | 현재가 · 호가 10단계 · 일/분봉 |
| `kis/trading.py` | 현금 매수/매도, 정정·취소, 잔고, 매수가능, 체결내역 |
| `kis/realtime.py` | 웹소켓 실시간 체결가/호가/체결통보 (AES 복호화 포함) |
| `kis/risk.py` | 주문 전 한도 검사, 포지션 사이징, 킬 스위치, 일일 손실 차단 |
| `kis/strategy/` | 전략 인터페이스 + SMA 골든크로스 / RSI 역추세 구현 |
| `kis/engine.py` | 전략 → 리스크 → 주문 → 기록 사이클 실행기 |
| `kis/storage.py` | SQLite 매매 저널 (주문/체결/일별 순자산/이벤트) |
| `kis/web/` | 폰 브라우저용 모니터링·비상제어 대시보드 (Flask) |
| `android/` | 안드로이드 앱 (Kotlin/Compose) — 조회·비상정지·수동주문 |
| `kis/cli.py` | `kis` 명령줄 도구 |

```
전략(Strategy) ──signal──▶ 엔진(TradingEngine) ──▶ 리스크(RiskManager) ──▶ 주문(TradingApi)
                                  │                        │                      │
                              시세(QuoteApi)          킬 스위치/한도          KIS REST API
                                  │                                               │
                            실시간(RealtimeClient) ◀────── 체결통보 ──────────────┘
                                  │
                              저널(Storage · SQLite)
                                  │
                            대시보드(kis web) ◀──┬─ 폰 브라우저 (조회 · 비상정지)
                              REST /api/*        └─ 안드로이드 앱 (android/)
```

## 2. 설치

```bash
git clone <이 저장소>
cd Yes
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-web.txt                  # 대시보드까지 쓰려면
pip install -e .                                     # kis 명령 등록 (선택)
```

Python 3.10 이상이 필요합니다.

## 3. API 키 발급 (최초 1회)

1. [KIS 개발자센터](https://apiportal.koreainvestment.com) 접속 → 한국투자증권 계정으로 로그인
2. **KIS Developers → 신청/승인** 에서 앱키(App Key) / 앱시크릿(App Secret) 발급
   - 실전투자와 모의투자는 **앱키가 서로 다릅니다.** 각각 발급받으세요.
3. 모의투자를 쓰려면 [모의투자 신청](https://securities.koreainvestment.com) 후 모의계좌 개설
4. 계좌번호는 `12345678-01` 형태입니다. 앞 8자리가 `CANO`, 뒤 2자리가 `ACNT_PRDT_CD` 입니다.

## 4. 설정

```bash
cp .env.example .env
```

`.env` 를 열어 채웁니다. **`.env` 는 절대 커밋하지 마세요** (`.gitignore` 에 등록되어 있습니다).

```dotenv
KIS_ENV=paper                 # paper(모의) | real(실전)
KIS_APP_KEY=발급받은_앱키
KIS_APP_SECRET=발급받은_앱시크릿
KIS_ACCOUNT_NO=12345678       # 계좌 앞 8자리
KIS_ACCOUNT_PRODUCT_CODE=01   # 계좌 뒤 2자리

KIS_ALLOW_REAL_TRADING=false  # 실전 주문 허용 스위치
KIS_DRY_RUN=true              # true면 주문 API를 호출하지 않고 로그만 남김

KIS_MAX_ORDER_AMOUNT=1000000    # 1회 주문 최대 금액
KIS_MAX_POSITION_AMOUNT=3000000 # 종목당 최대 보유 금액
KIS_MAX_ORDERS_PER_DAY=50       # 하루 최대 주문 횟수
KIS_MAX_DAILY_LOSS=300000       # 하루 최대 손실 (초과 시 자동 중단)
KIS_MAX_POSITIONS=5             # 동시 보유 종목 수
```

설정이 끝나면 점검부터 합니다.

```bash
python -m kis check
```

설정 요약 · 토큰 발급 · 시세 조회 · 계좌 조회가 모두 통과하면 준비 완료입니다.

## 5. CLI 사용법

```bash
python -m kis <명령>      # 또는 pip install -e . 후에는  kis <명령>
```

### 조회

```bash
python -m kis price 005930,000660        # 현재가 (쉼표로 여러 종목)
python -m kis orderbook 005930 --depth 5 # 호가 10단계
python -m kis chart 005930 --days 60     # 일봉 (--period D/W/M/Y)
python -m kis balance                    # 잔고 + 보유 종목 손익
python -m kis orders                     # 미체결 주문
python -m kis executions --today         # 당일 체결 내역
```

### 수동 주문

```bash
python -m kis buy  005930 -q 10 -p 70000   # 지정가 매수
python -m kis sell 005930 -q 10 --market   # 시장가 매도
python -m kis cancel --order-no 0000117057 --org-no 91252
python -m kis cancel --all                 # 미체결 전량 취소
```

수동 주문도 기본적으로 리스크 한도 검사를 거칩니다 (`--no-check-risk` 로 생략 가능).
실전 계좌에서는 `'실행'` 을 직접 입력해야 주문이 나갑니다 (`--yes` 로 생략).

### 실시간 시세

```bash
python -m kis watch 005930,000660
python -m kis watch 005930 --hts-id 내HTS아이디   # 체결통보까지 함께 수신
```

### 자동매매

```bash
# 먼저 1회만 돌려 신호를 눈으로 확인
python -m kis run --strategy sma_cross --symbols 005930,000660 --once

# 장중 60초 주기로 반복
python -m kis run --strategy sma_cross --symbols 005930,000660 \
    --interval 60 --stop-loss -5 --take-profit 10

# 실시간 체결통보를 함께 받으며 실행
python -m kis run --strategy rsi_reversal --symbols 005930 --realtime --hts-id 내HTS아이디
```

주요 옵션: `--market`(시장가 주문), `--max-cycles N`, `--ignore-market-hours`(장외 테스트),
`--yes`(실전 확인 프롬프트 생략).

### 기록 · 비상 정지

```bash
python -m kis journal --limit 30   # 주문 저널 + 당일 체결 금액
python -m kis halt                 # 킬 스위치 ON  (즉시 모든 주문 차단)
python -m kis halt --off           # 킬 스위치 OFF
```

킬 스위치는 `data/KILL_SWITCH` 파일 하나로 동작합니다. 엔진이 다른 터미널에서 돌고 있어도
파일이 생기는 즉시 다음 주문 시도부터 차단됩니다.

### 대시보드 (폰에서 보기)

```bash
# PC 에서만 볼 때
python -m kis web

# 폰에서 볼 때 — 같은 와이파이에 있어야 합니다
python -m kis web --host 0.0.0.0 --watch 005930,000660
```

실행하면 터미널에 접속 주소와 토큰이 출력됩니다. 폰 브라우저에서
`http://<PC의_LAN_IP>:8000/?token=<토큰>` 을 한 번 열면 토큰이 브라우저에 저장되어
이후에는 주소만으로 들어갈 수 있습니다. (PC의 LAN IP 는 macOS/리눅스 `ifconfig`,
윈도우 `ipconfig` 로 확인합니다. 보통 `192.168.x.x` 형태입니다.)

화면 구성: 순자산·당일손익·평가손익·주문가능현금 요약, **매매 즉시 중단** 버튼,
보유 종목 손익, 미체결 주문, 관심 종목 시세, 최근 주문 기록. 10초마다 자동 갱신되며
탭을 가리면 갱신을 멈춰 배터리를 아낍니다. 다크 모드를 지원하고, 상승 빨강 / 하락 파랑의
국내 관례를 따릅니다.

**권한 모델** — 기본은 읽기 전용입니다.

| 동작 | 기본 | `--allow-control` |
|------|------|-------------------|
| 조회 (잔고·주문·시세·기록) | ✅ | ✅ |
| 매매 중단 (킬 스위치 ON) | ✅ | ✅ |
| 매매 재개 | ❌ | ✅ |
| 미체결 취소 | ❌ | ✅ |
| 수동 주문 | ❌ | ✅ |

즉 폰을 잃어버려도 기본 설정에서는 "멈추는 것"만 가능합니다. 주문까지 하려면
`--allow-control` 을 붙여 실행하고, 실전 계좌라면 터미널에서 확인 입력을 한 번 더 받습니다.

**보안 주의**

- 암호화되지 않은 HTTP 입니다. **집 와이파이 안에서만** 쓰고, 공유기 포트포워딩이나
  DDNS 로 외부에 공개하지 마세요. 토큰이 노출되면 계좌를 조회당하고, 제어 모드라면
  주문까지 당할 수 있습니다.
- 토큰은 `--token` 이나 `.env` 의 `KIS_WEB_TOKEN` 으로 고정할 수 있습니다.
  생략하면 실행할 때마다 새로 만듭니다.
- 첫 접속 주소에 토큰이 들어가므로 로컬 서버 로그에 한 줄 남습니다. 화면에서는
  주소창에서 즉시 지웁니다.
- 밖에서 접속해야 한다면 포트를 여는 대신 Tailscale 같은 VPN 을 쓰세요.

### 안드로이드 앱

브라우저 대신 네이티브 앱으로 보고 싶다면 `android/` 에 Kotlin/Compose 앱이 있습니다.
Android Studio 에서 `android/` 폴더를 열고 실행하면 됩니다.

앱은 위 대시보드와 **같은 REST API** 를 씁니다. 즉 서버 실행 방법과 권한 모델이 동일하고,
`--allow-control` 없이 띄우면 앱에서도 조회와 매매 중단만 가능합니다.

**앱키·시크릿은 앱에 넣지 않습니다.** APK 는 디컴파일이 쉬워 키를 심으면 그대로 노출되므로,
매매와 인증은 서버가 하고 앱은 접속 토큰만 보관합니다. 토큰은 기기에 암호화 저장되고
클라우드 백업에서 제외됩니다.

자세한 빌드·사용법과 안전장치는 [`android/README.md`](android/README.md) 를 보세요.

## 6. 파이썬 코드로 쓰기

```python
from kis import KisTrader
from kis.models import OrderType

trader = KisTrader.from_env()

quote = trader.quotes.price("005930")
print(f"{quote.name} {quote.price:,}원 ({quote.change_rate:+.2f}%)")

balance = trader.trading.balance()
for position in balance.positions:
    print(position.symbol, position.quantity, f"{position.pnl_rate:+.2f}%")

# 주문 (KIS_DRY_RUN=true 이면 실제로 나가지 않습니다)
result = trader.trading.buy("005930", 1, price=70_000)
print(result.order_no, result.message)

# 시장가
trader.trading.sell("005930", 1, order_type=OrderType.MARKET)
```

## 7. 전략 만들기

`Strategy` 를 상속하고 `evaluate()` 하나만 구현하면 됩니다.
수량 계산·한도 검사·주문 전송은 엔진과 리스크 매니저가 처리합니다.

```python
from kis.strategy.base import Action, Signal, Strategy, StrategyContext, sma

class MyStrategy(Strategy):
    name = "my_strategy"

    def evaluate(self, symbol: str, ctx: StrategyContext) -> Signal:
        closes = ctx.closes(symbol, days=60)
        avg = sma(closes, 20)
        if avg is None:
            return Signal(symbol, Action.HOLD, "데이터 부족")

        price = ctx.quote(symbol).price
        if price < avg * 0.95 and not ctx.holds(symbol):
            return Signal(symbol, Action.BUY, "20일선 -5% 이탈", target_price=price, size_ratio=0.2)
        if price > avg * 1.05 and ctx.holds(symbol):
            return Signal(symbol, Action.SELL, "20일선 +5% 돌파")
        return Signal(symbol, Action.HOLD)
```

실행:

```python
from kis import KisTrader
from kis.engine import TradingEngine
from kis.strategy.base import ExitPolicy

trader = KisTrader.from_env()
strategy = MyStrategy(["005930"], exit_policy=ExitPolicy(stop_loss_pct=-5, take_profit_pct=10))
engine = TradingEngine(trader.settings, strategy, client=trader.client, storage=trader.storage)
engine.install_signal_handlers()
engine.run()
```

내장 지표 헬퍼: `sma`, `ema`, `rsi`. 더 긴 예시는 `examples/custom_strategy.py`(볼린저 밴드),
`examples/realtime_monitor.py`(실시간 목표가 감시)를 보세요.

## 8. 안전장치 (5중 방어)

| 단계 | 장치 | 설명 |
|------|------|------|
| 1 | `KIS_ENV=paper` | 모의투자 도메인으로만 접속. 실계좌에 닿지 않습니다. |
| 2 | `KIS_DRY_RUN=true` | 주문 API 를 호출하지 않고 로그만 남깁니다. |
| 3 | `KIS_ALLOW_REAL_TRADING` | 실전 환경에서 이 값이 `true` 가 아니면 주문 직전에 예외를 던집니다. |
| 4 | 리스크 한도 | 1회 주문액 · 종목당 보유액 · 일 주문수 · 보유 종목수 · 주문가능현금을 모두 검사하고, 초과분은 수량을 줄여 주문합니다. |
| 5 | 일일 손실 한도 + 킬 스위치 | 순자산이 기준 대비 한도 이상 줄면 자동 중단. `kis halt` 로 언제든 수동 차단. |

추가로 손절/익절(`ExitPolicy`)은 전략 신호보다 **먼저** 평가되어, 전략이 HOLD 를 내도 보유 종목의
손실이 기준을 넘으면 청산 주문이 나갑니다. 대시보드(`kis web`)는 기본이 읽기 전용이며,
매매를 멈추는 방향(킬 스위치 ON)만 항상 허용합니다.

## 9. 실전 전환 체크리스트

- [ ] 모의투자에서 최소 2주 이상 무중단 실행하며 로그와 저널을 확인했다
- [ ] `python -m kis journal` 로 주문이 의도대로 나갔는지 검증했다
- [ ] `--once` 실행으로 전략 신호를 눈으로 확인했다
- [ ] 리스크 한도를 감당 가능한 금액으로 낮춰 두었다 (처음에는 1회 10만원 수준 권장)
- [ ] `.env` 의 `KIS_ENV=real`, `KIS_ALLOW_REAL_TRADING=true`, `KIS_DRY_RUN=false` 를 이해하고 바꿨다
- [ ] 실전 앱키/시크릿으로 교체했다 (모의 키는 실전에서 동작하지 않습니다)
- [ ] 킬 스위치 사용법을 숙지했다: `python -m kis halt`
- [ ] 장 마감 후 `python -m kis balance` 로 결과를 확인하는 루틴을 정했다

## 10. 개발

```bash
pip install -r requirements-dev.txt
python -m pytest -q                 # 전체 테스트 (네트워크 없이 동작)
python -m pytest --cov=kis          # 커버리지
python -m ruff check .              # 린트
```

테스트는 `responses` 로 KIS 응답을 모킹하므로 실제 API 키 없이 실행됩니다.
대시보드는 Flask 테스트 클라이언트로 인증·권한 게이팅까지 검증합니다.

안드로이드 앱의 순수 Kotlin 계층(모델·JSON·HTTP·포맷)은 에뮬레이터 없이 검증합니다.

```bash
cd android
./gradlew :core:test                                  # 유닛 테스트
KIS_TEST_SERVER=http://127.0.0.1:8000 KIS_TEST_TOKEN=... \
    ./gradlew :core:test                              # 실제 서버에 붙는 통합 테스트
```

## 11. 알아둘 점

- **유량 제한**: 실전 초당 약 20건, 모의 초당 2건. `RateLimiter` 가 자동으로 대기하므로
  모의투자에서는 종목이 많으면 사이클이 느려집니다.
- **접근토큰**: 유효기간 24시간이며 재발급 횟수 제한이 있습니다. `data/token_*.json` 에 캐시하고
  만료 10분 전에만 갱신합니다. 이 파일은 절대 공유하지 마세요.
- **모의투자 미지원 API**: 일부 조회 API 는 모의 도메인에서 `모의투자 미지원` 오류를 냅니다.
  미체결 조회는 실패 시 일별 체결조회로 자동 대체합니다.
- **공휴일**: `is_market_open()` 은 주말만 거릅니다. 임시휴장일 처리가 필요하면 휴장일 달력을
  추가하세요.
- **호가 단위**: 지정가 주문은 `round_to_tick()` 으로 자동 보정됩니다(매수는 올림, 매도는 내림).
- **세금·수수료**: `estimate_fees()` 는 근사치입니다. 실제 정산 금액은 증권사 기준을 따릅니다.

## 12. 면책

이 소프트웨어는 교육·개인 사용 목적으로 제공되며 어떠한 보증도 하지 않습니다.
투자 결과에 대한 모든 책임은 사용자에게 있습니다. 한국투자증권 API 이용약관과
자본시장법을 준수해 사용하세요.
