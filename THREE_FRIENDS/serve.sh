#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py --check
PORT="${1:-8080}"
echo "http://localhost:${PORT}/07_MVP_Code/three_friends.html"
python3 -m http.server "$PORT"
