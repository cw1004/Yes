# INDIA 2030 자동 영상 생성기
PY ?= python3
RANGE ?= 1-100
WORKERS ?= 4
# 내레이션 언어(ko|hi). 셸의 LANG(로케일) 변수와 충돌하지 않도록 NARRATION 사용
NARRATION ?= ko
CAPTION ?=            # 비우면 내레이션과 동일 (예: CAPTION=ko)
LANG_OPT = --lang $(NARRATION) $(if $(CAPTION),--caption-lang $(CAPTION),)

.PHONY: help setup check scripts all hindi fast test clean \
        oneway serve ask today site sitemap purge \
        book ledger preflight up down logs

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

# ───────────────────────────── 하나의 길 — ONE WAY ─────────────────────────────
PORT ?= 8000
SITE_URL ?= https://oneway.example.com

serve:           ## 홈페이지 띄우기   예) make serve PORT=8080
	$(PY) -m oneway serve --port $(PORT)

ask:             ## 터미널에서 AI 상담사와 대화
	$(PY) -m oneway ask

today:           ## 오늘의 3분 보기
	$(PY) -m oneway today

oneway:          ## 상담사·콘텐츠 환경 점검
	$(PY) -m oneway check

site:            ## 정적 사이트 내보내기 (SEO 페이지 78개)
	$(PY) -m oneway build --clean --site-url $(SITE_URL)

sitemap:         ## sitemap.xml 출력
	$(PY) -m oneway sitemap --site-url $(SITE_URL)

purge:           ## 180일 넘은 방문 기록 삭제
	$(PY) -m oneway purge --days 180

book:            ## 전자책 만들기 (EPUB/HTML/마크다운)
	$(PY) -m oneway book

ledger:          ## 판매·기부 장부 보기
	$(PY) -m oneway ledger

preflight:       ## 공개 전 점검 (전화번호·설정·개인정보)
	sh deploy/scripts/preflight.sh

up:              ## 서버에 띄우기 (도커)
	cd deploy && docker compose up -d --build

down:            ## 내리기
	cd deploy && docker compose down

logs:            ## 로그 보기
	cd deploy && docker compose logs -f app

test:            ## 테스트 실행
	$(PY) -m unittest discover -s tests

clean:           ## 생성물 삭제
	rm -rf output
