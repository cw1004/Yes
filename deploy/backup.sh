#!/usr/bin/env bash
# SHOPREEL 데이터베이스 백업 — 클릭·주문·수익 기록은 다시 만들 수 없다.
set -euo pipefail

DB="${SHOPREEL_DB:-/var/lib/shopreel/shopreel.db}"
DEST="${SHOPREEL_BACKUP_DIR:-/var/backups/shopreel}"
KEEP="${SHOPREEL_BACKUP_KEEP:-14}"

[ -f "$DB" ] || { echo "DB 없음: $DB"; exit 0; }
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$DEST/shopreel_$STAMP.db"

# 실행 중에도 안전하게 복사 (sqlite3 가 없으면 파이썬 백업 API 사용)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
    s.backup(d)
PY
fi

gzip -f "$OUT"
echo "백업 완료: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

# 오래된 백업 정리
ls -1t "$DEST"/shopreel_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
