# INDIA 2030 자동 영상 생성기
PY ?= python3
RANGE ?= 1-100
WORKERS ?= 4

.PHONY: help setup check scripts all fast test clean

help:            ## 사용 가능한 명령 보기
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

setup:           ## 파이썬 의존성 설치
	$(PY) -m pip install -r requirements.txt

check:           ## 실행 환경 점검 (ffmpeg / 폰트 / TTS)
	$(PY) -m india2030 check

scripts:         ## 대본(JSON/SRT)만 100편 생성
	$(PY) -m india2030 script --range $(RANGE)

all:             ## 영상 100편 생성 (고화질)
	$(PY) -m india2030 make --range $(RANGE) --workers $(WORKERS) --bgm assets/bgm

fast:            ## 영상 100편 빠르게 생성 (미리보기 화질)
	$(PY) -m india2030 make --range $(RANGE) --workers $(WORKERS) --preset veryfast --crf 26

test:            ## 테스트 실행
	$(PY) -m unittest discover -s tests

clean:           ## 생성물 삭제
	rm -rf output
