#!/usr/bin/env bash
# SHOPREEL 서버 설치 — systemd 서비스 + 타이머 + nginx 설정을 넣는다.
# 여러 번 실행해도 안전하다(이미 있는 설정 파일은 덮어쓰지 않는다).
#
#   sudo ./deploy/install.sh --domain link.내도메인.com
#
set -euo pipefail

DOMAIN=""
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8787
USER_NAME=shopreel
STATE_DIR=/var/lib/shopreel
CONF_DIR=/etc/shopreel
BACKUP_DIR=/var/backups/shopreel
SKIP_NGINX=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다: sudo $0 ..." >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "--domain 을 지정하세요 (예: --domain link.example.com)" >&2; exit 1; }

echo "▶ 설치 위치 : $REPO_DIR"
echo "▶ 도메인    : $DOMAIN"
echo "▶ 포트      : $PORT"
echo

# 1) 의존성 확인 ------------------------------------------------------------
command -v python3 >/dev/null || { echo "python3 가 필요합니다" >&2; exit 1; }
if ! command -v ffmpeg >/dev/null; then
  echo "! ffmpeg 이 없습니다. apt-get install -y ffmpeg 후 다시 실행하세요." >&2
  exit 1
fi
python3 -c "import PIL" 2>/dev/null || {
  echo "▶ 파이썬 의존성 설치"; python3 -m pip install -r "$REPO_DIR/requirements.txt"; }

# 2) 사용자와 디렉터리 ------------------------------------------------------
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  echo "▶ 사용자 생성: $USER_NAME"
  useradd --system --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$USER_NAME"
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$STATE_DIR" "$STATE_DIR/video"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 750 "$BACKUP_DIR"
install -d -m 755 "$CONF_DIR"

# 3) 설정 파일 (있으면 그대로 둔다) -----------------------------------------
if [ ! -f "$CONF_DIR/shopreel.config.json" ]; then
  sed "s|__DOMAIN__|$DOMAIN|g" "$REPO_DIR/deploy/shopreel.config.template.json" \
    > "$CONF_DIR/shopreel.config.json"
  chown "$USER_NAME:$USER_NAME" "$CONF_DIR/shopreel.config.json"
  echo "▶ 설정 생성: $CONF_DIR/shopreel.config.json"
else
  echo "· 설정 유지: $CONF_DIR/shopreel.config.json"
fi

if [ ! -f "$CONF_DIR/shopreel.env" ]; then
  cp "$REPO_DIR/deploy/shopreel.env.template" "$CONF_DIR/shopreel.env"
  # 비밀값은 자동 생성해 둔다
  SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  SALT=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i "s|^SHOPREEL_POSTBACK_SECRET=.*|SHOPREEL_POSTBACK_SECRET=$SECRET|" "$CONF_DIR/shopreel.env"
  sed -i "s|^SHOPREEL_IP_SALT=.*|SHOPREEL_IP_SALT=$SALT|" "$CONF_DIR/shopreel.env"
  chown "$USER_NAME:$USER_NAME" "$CONF_DIR/shopreel.env"
  chmod 600 "$CONF_DIR/shopreel.env"
  echo "▶ 환경변수 파일 생성: $CONF_DIR/shopreel.env  (API 키를 채워 넣으세요)"
else
  echo "· 환경변수 유지: $CONF_DIR/shopreel.env"
fi

# 4) systemd 유닛 -----------------------------------------------------------
echo "▶ systemd 유닛 설치"
for unit in "$REPO_DIR"/deploy/systemd/*.service "$REPO_DIR"/deploy/systemd/*.timer; do
  sed -e "s|/opt/shopreel|$REPO_DIR|g" \
      -e "s|--port 8787|--port $PORT|g" \
      -e "s|^User=shopreel|User=$USER_NAME|" \
      -e "s|^Group=shopreel|Group=$USER_NAME|" \
      "$unit" > "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload
systemctl enable --now shopreel-tracker.service
systemctl enable --now shopreel-run.timer shopreel-retry.timer shopreel-backup.timer

# 5) nginx ------------------------------------------------------------------
if [ "$SKIP_NGINX" -eq 0 ] && command -v nginx >/dev/null; then
  echo "▶ nginx 설정 설치"
  TARGET=/etc/nginx/sites-available/shopreel.conf
  sed -e "s|link.example.com|$DOMAIN|g" \
      -e "s|server 127.0.0.1:8787;|server 127.0.0.1:$PORT;|" \
      -e "s|/var/lib/shopreel/video|$STATE_DIR/video|g" \
      "$REPO_DIR/deploy/nginx/shopreel.conf" > "$TARGET"
  ln -sf "$TARGET" /etc/nginx/sites-enabled/shopreel.conf
  if nginx -t; then
    systemctl reload nginx
    echo "▶ nginx 적용 완료"
  else
    echo "! nginx 설정 확인 실패 — $TARGET 을 점검하세요" >&2
  fi
else
  echo "· nginx 건너뜀 (설치되지 않았거나 --skip-nginx)"
fi

# 6) 안내 -------------------------------------------------------------------
cat <<EOF

설치 완료.

다음 순서로 마무리하세요.

  1) API 키 입력
       sudo nano $CONF_DIR/shopreel.env
       sudo systemctl restart shopreel-tracker

  2) HTTPS 인증서 발급 (도메인 A 레코드가 이 서버를 가리켜야 합니다)
       sudo certbot --nginx -d $DOMAIN

  3) 동작 확인
       sudo -u $USER_NAME python3 -m shopreel check --config $CONF_DIR/shopreel.config.json
       curl -s https://$DOMAIN/health
       열어 보기:  https://$DOMAIN/shop      ← 인스타·틱톡 프로필 링크에 넣을 주소

  4) 상태와 로그
       systemctl status shopreel-tracker
       systemctl list-timers 'shopreel*'
       journalctl -u shopreel-run -f

  5) 지금 바로 한 번 돌려 보기
       sudo systemctl start shopreel-run.service

EOF
