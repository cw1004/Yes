#!/usr/bin/env bash
# SKY GOAL 2.0 전체 검증: 빌드 → 엔진 단위 테스트 → 브라우저 스모크 테스트
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/4 빌드 =="
python3 build.py --check --pwa

echo
echo "== 2/4 단위 테스트 (엔진 · 장비 · 아이콘 · 사운드 · 배경 · 광고판) =="
node --test 07_MVP_Code/tests/engine.test.js 07_MVP_Code/tests/gear.test.js \
  07_MVP_Code/tests/audio.test.js 07_MVP_Code/tests/scenery.test.js \
  07_MVP_Code/tests/sponsor.test.js 07_MVP_Code/tests/gearart.test.js

echo
echo "== 3/4 브라우저 스모크 테스트 =="
node 07_MVP_Code/tests/browser.smoke.mjs "$@"

echo
echo "== 4/4 보안 회귀 테스트 (보상 API 가 실제 플레이어에게 노출되지 않는지) =="
node 07_MVP_Code/tests/security.smoke.mjs

echo
echo "모든 검증 통과"
