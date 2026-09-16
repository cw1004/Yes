# 공개하기 — 단계별 안내

「하나의 길 — ONE WAY」를 인터넷에 올리는 방법입니다.
**서버를 처음 다뤄 보신다는 전제로 썼습니다.** 순서대로 따라 하시면 됩니다.

전체 1~2시간, 비용은 **월 1만 원 안쪽**입니다.

---

## 0. 미리 준비할 것

| 항목 | 어디서 | 비용 |
| --- | --- | --- |
| 도메인 | 가비아 · 후이즈 · Cloudflare 등 | 연 1~2만 원 |
| 서버 | Vultr · DigitalOcean · 네이버클라우드 · 카페24 | 월 5천~1만 원 |
| (선택) Claude API 키 | console.anthropic.com | 쓴 만큼 |

서버는 **메모리 1GB, Ubuntu 22.04 이상**이면 충분합니다.
이 사이트는 파이썬 표준 라이브러리만 쓰기 때문에 아주 가볍습니다.

> **키가 없어도 사이트는 완전히 동작합니다.** 규칙 기반 상담 엔진이 답합니다.
> 먼저 키 없이 열고, 반응을 보신 뒤 나중에 붙이셔도 됩니다.

---

## 1. 도메인을 서버로 연결

도메인 관리 화면에서 DNS 레코드를 두 개 만듭니다.

```
유형   이름    값
A      @       서버의 IP 주소
A      www     서버의 IP 주소
```

반영에 몇 분에서 한 시간쯤 걸립니다. 확인:

```bash
ping 내도메인.kr        # 서버 IP 가 나오면 됩니다
```

---

## 2. 서버 준비

서버에 접속한 뒤:

```bash
# 도커 설치 (우분투 기준)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# 여기서 한 번 로그아웃했다가 다시 접속하십시오

# 코드 받기
git clone <이 저장소 주소> oneway
cd oneway
```

설정을 만듭니다.

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

최소한 이것만 바꾸면 됩니다.

```
ONEWAY_SITE_URL=https://내도메인.kr
```

nginx 설정에서도 도메인을 바꿉니다.

```bash
sed -i 's/example\.kr/내도메인.kr/g' deploy/nginx/oneway.conf
```

---

## 3. HTTPS 인증서 받기 (처음 한 번만)

인증서가 없으면 nginx 가 뜨지 않으므로, 순서가 조금 까다롭습니다.
아래를 그대로 따라 하십시오.

```bash
cd deploy

# 3-1. 인증서 없이 뜰 수 있게 HTTPS 부분을 잠시 꺼 둡니다
cp nginx/oneway.conf nginx/oneway.conf.bak
sed -i '/listen 443/,$d' nginx/oneway.conf
echo '}' >> nginx/oneway.conf

# 3-2. 웹 서버만 먼저 띄웁니다
docker compose up -d web

# 3-3. 인증서를 받습니다 (이메일과 도메인을 바꾸십시오)
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d 내도메인.kr -d www.내도메인.kr \
  --email 내메일@example.com --agree-tos --no-eff-email

# 3-4. 원래 설정으로 되돌립니다
mv nginx/oneway.conf.bak nginx/oneway.conf
```

> `Successfully received certificate` 가 나오면 성공입니다.
> 실패하면 대개 1단계의 DNS 가 아직 반영되지 않은 것입니다. 10분 뒤 다시.

---

## 4. 띄우기

```bash
cd deploy
docker compose up -d --build
```

확인:

```bash
curl -I https://내도메인.kr          # 200 이면 성공
docker compose ps                    # 전부 healthy / running
docker compose logs -f app           # 문제가 있으면 여기 나옵니다
```

브라우저로 `https://내도메인.kr` 을 열어 보십시오.

---

## 5. 공개 전 점검 (반드시)

```bash
sh deploy/scripts/preflight.sh deploy/config/config.json
```

특히 이 두 가지는 **사람이 직접** 확인하셔야 합니다.

1. **긴급 전화번호** — `oneway/counselor/safety.py` 의 109 · 1577-0199 등.
   번호는 바뀝니다. 틀린 번호로 공개하면 사람이 다칩니다.
2. **상표** — 「하나의 길」·「ONE WAY」 를 특허정보넷 키프리스에서 검색.
   알리고 나서 이름을 못 쓰게 되면 처음부터 다시입니다.

---

## 6. 검색엔진에 등록

사이트가 뜬 뒤에 하십시오.

| 곳 | 주소 |
| --- | --- |
| 구글 | search.google.com/search-console |
| 네이버 | searchadvisor.naver.com |

각각에서 소유확인 코드를 받아 `deploy/.env` 에 넣고 다시 띄웁니다.

```bash
nano deploy/.env        # ONEWAY_NAVER_VERIFY / ONEWAY_GOOGLE_VERIFY
docker compose up -d
```

그다음 사이트맵을 제출하십시오 — `https://내도메인.kr/sitemap.xml` (78개 주소).

---

## 7. Claude 연결 (선택, 나중에 해도 됨)

```bash
nano deploy/.env        # ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d
docker compose exec app python3 -m oneway check
```

`상담 엔진 : Claude` 로 바뀌면 연결된 것입니다.

**비용 주의.** 상담 한 번이 API 한 번입니다. 그래서 요청 제한을 두 겹으로
걸어 두었습니다(nginx + 앱). 그래도 처음 며칠은 콘솔에서 사용량을
지켜보십시오. `--counselor offline` 로 언제든 되돌릴 수 있습니다.

---

## 평소 관리

```bash
# 상태 보기
docker compose ps
docker compose logs -f app

# 코드를 고친 뒤 반영
git pull && docker compose up -d --build

# 기부 장부에 기록 (책을 팔기 시작한 뒤)
docker compose exec app python3 -m oneway ledger --data /data
docker compose exec app python3 -m oneway ledger --data /data \
  --sale 2026-03-01 교보문고 120 540000 315000

# 백업에서 되돌리기
sh deploy/scripts/restore.sh /경로/oneway-20260101-0400.tar.gz
```

**자동으로 돌아가는 것들** (손댈 것 없습니다)

* 매일 — 180일 넘은 방문 기록 삭제, 백업, 30일 지난 백업 정리
* 12시간마다 — HTTPS 인증서 갱신 확인
* 컨테이너가 죽으면 자동 재시작

---

## 도커 없이 올리고 싶다면

`deploy/systemd/` 에 설정이 있습니다.

```bash
sudo cp deploy/systemd/oneway.service /etc/systemd/system/
sudo cp deploy/systemd/oneway-maintenance.* /etc/systemd/system/
sudo mkdir -p /etc/oneway /var/lib/oneway
sudo cp deploy/config/config.example.json /etc/oneway/config.json
sudo systemctl daemon-reload
sudo systemctl enable --now oneway oneway-maintenance.timer
```

nginx 는 따로 설치하고 `deploy/nginx/oneway.conf` 를 참고해
`proxy_pass http://127.0.0.1:8000` 으로 바꿔 쓰시면 됩니다.

---

## 얼마나 버티나

표준 라이브러리 HTTP 서버라 한 대로 **동시 접속 수백 명** 수준입니다.
개인 사이트나 소규모 공동체에는 충분합니다.

더 커지면 바뀌는 파일은 `oneway/web/server.py` 하나입니다.
페이지 생성(`web/render.py`)과 상담(`counselor/`)은 그대로 둘 수 있습니다.

방문자가 많아지면 `oneway/web/ratelimit.py` 의 `RateLimiter` 를
Redis 로 바꾸십시오. 인터페이스는 `check()` 하나뿐입니다.

---

## 막혔을 때

| 증상 | 대개 이것 |
| --- | --- |
| `curl` 이 연결 안 됨 | DNS 반영 전. 10분 뒤 다시 |
| nginx 가 안 뜸 | 인증서 없음. 3단계를 다시 |
| 502 Bad Gateway | `docker compose logs app` 확인 |
| 상담이 규칙 엔진으로만 답함 | 키 미설정. `oneway check` 확인 |
| 429 가 자주 뜸 | 정상 동작입니다. 한도는 `ratelimit.py` |
