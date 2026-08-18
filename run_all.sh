#!/usr/bin/env bash
# INDIA 2030 — 1~100화 영상 일괄 생성 스크립트
# 사용법: ./run_all.sh [시작-끝] [워커수]
#   예)  ./run_all.sh            # 1~100화, 워커 4
#        ./run_all.sh 1-20 8     # 1~20화, 워커 8
set -euo pipefail

RANGE="${1:-1-100}"
WORKERS="${2:-4}"
PY="${PYTHON:-python3}"

echo "▶ 환경 점검"
$PY -m india2030 check

echo
echo "▶ 대본 생성 ($RANGE)"
$PY -m india2030 script --range "$RANGE"

echo
echo "▶ 영상 생성 ($RANGE, 워커 $WORKERS)"
BGM_OPT=()
if compgen -G "assets/bgm/*.mp3" > /dev/null || compgen -G "assets/bgm/*.wav" > /dev/null; then
  BGM_OPT=(--bgm assets/bgm)
  echo "  배경음악 폴더 사용: assets/bgm"
fi

# 중간에 끊겨도 다시 실행하면 완성된 회차는 건너뛰고 이어서 만듭니다.
$PY -m india2030 make --range "$RANGE" --workers "$WORKERS" "${BGM_OPT[@]}"

echo
echo "✔ 완료 — output/video 에서 결과를 확인하세요."
