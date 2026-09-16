#!/bin/sh
# 매일 한 번 돌리는 정리 작업.
#   1. 오래된 방문 기록 삭제 — 개인정보를 오래 들고 있지 않기 위해
#   2. 백업
#   3. 오래된 백업 삭제
set -eu

DATA="${ONEWAY_DATA:-/var/lib/oneway}"
BACKUP="${ONEWAY_BACKUP:-/var/backups/oneway}"
KEEP_SESSIONS="${ONEWAY_KEEP_DAYS:-180}"
KEEP_BACKUPS="${ONEWAY_KEEP_BACKUPS:-30}"

mkdir -p "$BACKUP"

echo "[1/3] ${KEEP_SESSIONS}일 넘게 방문이 없는 기록을 지웁니다"
python3 -m oneway purge --days "$KEEP_SESSIONS" --data "$DATA"

echo "[2/3] 백업"
STAMP=$(date +%Y%m%d-%H%M)
tar czf "$BACKUP/oneway-$STAMP.tar.gz" -C "$(dirname "$DATA")" "$(basename "$DATA")"
echo "  $BACKUP/oneway-$STAMP.tar.gz"

echo "[3/3] ${KEEP_BACKUPS}일 지난 백업을 지웁니다"
find "$BACKUP" -name 'oneway-*.tar.gz' -mtime "+$KEEP_BACKUPS" -delete

echo "끝났습니다."
