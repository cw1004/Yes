#!/usr/bin/env bash
# 로컬 서버로 실행 (file:// 에서 localStorage 가 막히는 브라우저 대응)
set -euo pipefail
cd "$(dirname "$0")/07_MVP_Code"
PORT="${1:-8080}"
echo "http://localhost:${PORT}/sky_goal_2_0.html 에서 플레이하세요 (종료: Ctrl+C)"
python3 -m http.server "$PORT"
