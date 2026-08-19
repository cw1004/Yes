# INDIA 2030 자동 영상 생성기
PY ?= python3
RANGE ?= 1-100
WORKERS ?= 4
TICKERS ?=            # 스캘퍼 대상 종목 (비우면 NVDA TSLA AAPL)
# 내레이션 언어(ko|hi). 셸의 LANG(로케일) 변수와 충돌하지 않도록 NARRATION 사용
NARRATION ?= ko
CAPTION ?=            # 비우면 내레이션과 동일 (예: CAPTION=ko)
LANG_OPT = --lang $(NARRATION) $(if $(CAPTION),--caption-lang $(CAPTION),)

.PHONY: help setup check scripts all hindi fast test clean \
        scalp scalp-live scan macro bt test-scalper

help:            ## 사용 가능한 명령 보기
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

setup:           ## 파이썬 의존성 설치
	$(PY) -m pip install -r requirements.txt

check:           ## 실행 환경 점검 (ffmpeg / 폰트 / TTS)
	$(PY) -m india2030 check

scripts:         ## 대본(JSON/SRT)만 100편 생성
	$(PY) -m india2030 script --range $(RANGE) $(LANG_OPT)

all:             ## 영상 100편 생성 (고화질)  예) make all NARRATION=hi
	$(PY) -m india2030 make --range $(RANGE) --workers $(WORKERS) $(LANG_OPT) --bgm assets/bgm

hindi:           ## 힌디어 내레이션 + 한국어 자막으로 100편 생성
	$(PY) -m india2030 make --range $(RANGE) --workers $(WORKERS) --lang hi --caption-lang ko --bgm assets/bgm

fast:            ## 영상 100편 빠르게 생성 (미리보기 화질)
	$(PY) -m india2030 make --range $(RANGE) --workers $(WORKERS) $(LANG_OPT) --preset veryfast --crf 26

test:            ## 테스트 실행
	$(PY) -m unittest discover -s tests

test-scalper:    ## 스캘퍼 테스트만 실행 (네트워크 불필요)
	$(PY) -m unittest discover -s tests -p 'test_scalper.py'

scalp:           ## 3분할 단타 대시보드 (시뮬레이션)
	$(PY) -m scalper run $(TICKERS)

scalp-live:      ## 3분할 단타 대시보드 (실 시세 + AUTO)  예) make scalp-live TICKERS="NVDA AMD SPY"
	$(PY) -m scalper run --live --auto $(TICKERS)

scan:            ## 워치리스트 스캔 → 오늘의 추천 3선
	$(PY) -m scalper scan $(TICKERS)

macro:           ## 세계 정세·거시 레짐 판독
	$(PY) -m scalper macro

bt:              ## 워크포워드 백테스트  예) make bt TICKERS="NVDA TSLA"
	$(PY) -m scalper backtest $(TICKERS) --offline

clean:           ## 생성물 삭제
	rm -rf output
