#!/bin/sh
# 백업에서 되돌립니다.
#   sh deploy/scripts/restore.sh /var/backups/oneway/oneway-20260101-0400.tar.gz
set -eu

ARCHIVE="${1:?되돌릴 백업 파일을 지정하십시오}"
DATA="${ONEWAY_DATA:-/var/lib/oneway}"

[ -f "$ARCHIVE" ] || { echo "그런 파일이 없습니다: $ARCHIVE"; exit 1; }

echo "지금 데이터를 먼저 옆으로 치웁니다."
if [ -d "$DATA" ]; then
  mv "$DATA" "$DATA.before-restore-$(date +%Y%m%d-%H%M)"
fi

echo "$ARCHIVE 를 풉니다."
mkdir -p "$(dirname "$DATA")"
tar xzf "$ARCHIVE" -C "$(dirname "$DATA")"

echo "끝났습니다. 서비스를 다시 시작하십시오:"
echo "  sudo systemctl restart oneway     (또는)  docker compose restart app"
