#!/usr/bin/env bash
# 웹 게임 빌드 결과와 아이콘을 안드로이드 프로젝트로 복사한다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "== 웹 게임 빌드 =="
python3 "$ROOT/build.py"

echo "== assets 동기화 =="
mkdir -p "$HERE/app/src/main/assets/game"
cp "$ROOT/07_MVP_Code/sky_goal_2_0.html" "$HERE/app/src/main/assets/game/index.html"
echo "  ✓ assets/game/index.html"

ICONS="$ROOT/10_Release/store/icons"
if [ -d "$ICONS" ]; then
  echo "== 런처 아이콘 동기화 =="
  declare -A MAP=( [48]=mdpi [72]=hdpi [96]=xhdpi [144]=xxhdpi [192]=xxxhdpi )
  for size in "${!MAP[@]}"; do
    dir="$HERE/app/src/main/res/mipmap-${MAP[$size]}"
    mkdir -p "$dir"
    cp "$ICONS/icon-$size.png" "$dir/ic_launcher.png"
    cp "$ICONS/icon-$size.png" "$dir/ic_launcher_round.png"
    echo "  ✓ mipmap-${MAP[$size]} (${size}px)"
  done
  cp "$ICONS/adaptive-foreground-432.png" "$HERE/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png"
  echo "  ✓ 적응형 아이콘 전경"
else
  echo "  ! 아이콘이 없습니다. 먼저 10_Release/store/tools/make_assets.mjs 를 실행하세요."
fi

echo
echo "완료. 다음 단계:"
echo "  Android Studio 로 $HERE 를 열거나"
echo "  gradle assembleDebug  /  gradle bundleRelease"
