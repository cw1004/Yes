#!/usr/bin/env bash
# 세 친구의 여행 — 빌드 → 엔진 단위 테스트 → 브라우저 스모크 테스트
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/3 빌드 =="
python3 build.py --check

echo
echo "== 2/3 단위 테스트 (엔진 · 캐릭터 바이블 정합성) =="
node --test 07_MVP_Code/tests/engine.test.js 07_MVP_Code/tests/bible.test.js

echo
echo "== 3/3 브라우저 스모크 테스트 =="
node 07_MVP_Code/tests/browser.smoke.mjs "$@"

echo
echo "모든 검증 통과"
