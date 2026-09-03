#!/usr/bin/env bash
# INDIA 2030 스튜디오 — macOS / Linux 실행기
# 더블클릭하거나 터미널에서 ./start.sh 로 실행하세요.
set -e
cd "$(dirname "$0")"

PY=$(command -v python3 || command -v python) || {
  echo "파이썬이 없습니다. https://www.python.org 에서 설치한 뒤 다시 실행하세요."
  read -r -p "엔터를 누르면 닫힙니다..." _; exit 1; }

echo "[1/3] 필요한 패키지를 확인합니다..."
"$PY" -c "import PIL" 2>/dev/null || "$PY" -m pip install -q -r requirements.txt

echo "[2/3] 실행 환경을 점검합니다..."
"$PY" -m india2030 check || true

echo "[3/3] 스튜디오를 엽니다. 브라우저가 자동으로 열립니다."
echo "      창을 닫으려면 이 터미널에서 Ctrl+C 를 누르세요."
"$PY" -m india2030 studio --port 8500
