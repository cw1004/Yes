# INDIA 2030 자동 영상 생성기
PY ?= python3
RANGE ?= 1-100
WORKERS ?= 4
# 내레이션 언어(ko|hi). 셸의 LANG(로케일) 변수와 충돌하지 않도록 NARRATION 사용
NARRATION ?= ko
CAPTION ?=            # 비우면 내레이션과 동일 (예: CAPTION=ko)
LANG_OPT = --lang $(NARRATION) $(if $(CAPTION),--caption-lang $(CAPTION),)

.PHONY: help setup check scripts all hindi fast test clean \
        shop-check shop-trends shop-make shop-run shop-auto shop-serve shop-report \
        shop-coupang shop-youtube

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

clean:           ## 생성물 삭제
	rm -rf output

# ── SHOPREEL (소셜커머스 자동 영상·업로드·수익화) ──────────────────
TOP ?= 3
SECS ?= 30
EVERY ?= 180
PORT ?= 8787
DAYS ?= 30

shop-check:      ## SHOPREEL 환경·키 점검
	$(PY) -m shopreel check

shop-trends:     ## 실시간 인기 상품 순위 보기
	$(PY) -m shopreel trends

shop-make:       ## 영상만 생성 (업로드 안 함)  예) make shop-make TOP=5 SECS=15
	$(PY) -m shopreel make --top $(TOP) --duration $(SECS)

shop-run:        ## 수집→영상→업로드 1회 실행
	$(PY) -m shopreel run --top $(TOP) --duration $(SECS)

shop-auto:       ## 주기 자동 실행  예) make shop-auto EVERY=120
	$(PY) -m shopreel auto --every $(EVERY)

shop-serve:      ## 클릭 추적 서버 실행
	$(PY) -m shopreel serve --port $(PORT)

shop-report:     ## 클릭·주문·수익 리포트
	$(PY) -m shopreel report --days $(DAYS)

shop-coupang:    ## 쿠팡 파트너스 연동 시연 (키 없이, 서명까지 검증)
	$(PY) -m tools.coupang_demo --top $(TOP) --duration $(SECS) --fast

shop-youtube:    ## 쿠팡 수집 → 영상 → 유튜브 업로드 전 구간 시연 (키 없이)
	$(PY) -m tools.coupang_demo --top $(TOP) --duration $(SECS) --fast --youtube
