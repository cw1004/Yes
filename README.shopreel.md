# SHOPREEL — 소셜커머스 인기상품 자동 영상·업로드·수익화

전 세계 소셜커머스에서 **지금 잘 팔리는 상품**을 실시간으로 긁어와 → 제휴(어필리에이트)
링크를 붙이고 → 숏폼 영상을 자동 생성해 → SNS에 자동 업로드하고 → 클릭·주문·수수료까지
추적하는 **한 개 명령으로 도는 파이프라인**입니다.

```
python3 -m shopreel run            # 수집 → 영상 → 업로드 1회
python3 -m shopreel auto --every 180   # 3시간마다 무한 반복
```

API 키가 하나도 없어도 데모 데이터로 전체 흐름이 끝까지 돕니다.
(영상 렌더링 엔진은 같은 저장소의 `india2030` 패키지를 재사용합니다.)

---

## 1. 전체 구조

```
[수집]  aliexpress · amazon · coupang · rakuten · ebay · custom(직접 만든 수집기)
          │  실시간 판매량 증가분(sold_delta) · 평점 · 할인율 · 수수료율
          ▼
[선별]  금지 카테고리 제외 → 필터 → 점수화 → 중복 제거 → 최근 제작분 제외
          │  ※ 수익 데이터(카테고리 EPC)가 점수에 되먹임됨
          ▼
[링크]  제휴 링크 생성 + 플랫폼별 추적코드 발급   내도메인/r/<code> → 302 → 제휴 링크
          ▼
[대본]  HOOK → PROBLEM → PROOF → PRICE → CTA   (템플릿 또는 Claude)
          ▼
[영상]  제품 카드 + 켄번즈 + 가격 배지 + 자막 + 내레이션 + 광고 표기  → mp4 (9:16)
          ▼
[업로드] YouTube Shorts · TikTok · Instagram Reels · Facebook  (일일 한도 준수)
          ▼
[수익]  클릭 기록 → 전환 웹훅/CSV → 리포트 → 다음 제작 우선순위에 반영
```

핵심 원칙 3가지

1. **키가 없어도 멈추지 않는다.** 소스·TTS·업로드 어느 하나가 없어도 폴백으로 계속 진행합니다.
2. **광고 표기는 코드로 강제한다.** 화면·본문·해시태그 세 곳에 자동으로 들어갑니다.
3. **조회수가 아니라 수익을 최적화한다.** 클릭당 수익(EPC)이 좋은 카테고리가 다음에 먼저 만들어집니다.

---

## 2. 설치

```bash
# 1) ffmpeg (필수)
sudo apt-get install -y ffmpeg      # 또는 pip install imageio-ffmpeg
# 2) 파이썬 패키지
pip install -r requirements.txt
# 3) 점검
python3 -m shopreel check
```

`check` 는 렌더링 환경 / 소스 키 / 업로드 키 / 현재 설정을 한 화면에 보여 줍니다.

---

## 3. 5분 시작 (키 없이)

```bash
python3 -m shopreel trends                       # 지금 인기 상품 순위 보기
python3 -m shopreel run --top 1 --duration 15    # 1편 만들어 업로드 패키지 생성
```

결과물

| 경로 | 내용 |
| --- | --- |
| `output/shopreel/video/*.mp4` | 완성 영상 (1080×1920) |
| `output/shopreel/video/*.jpg` | 썸네일 |
| `output/shopreel/script/*.json` | 상품 정보 + 대본 |
| `output/shopreel/upload/<code>/` | 업로드 패키지 (영상·썸네일·문구·해시태그) |
| `output/shopreel/report/run_*.json` | 실행 리포트 |
| `output/shopreel/shopreel.db` | 상품·영상·게시·클릭·수익 기록 |

---

## 4. 명령어

| 명령 | 설명 |
| --- | --- |
| `shopreel check` | 환경·키·설정 점검 |
| `shopreel sources` | 수집 소스 상태 |
| `shopreel trends [--json]` | 실시간 인기 상품 수집·순위 |
| `shopreel make --top 3` | 영상만 생성 (업로드 안 함) |
| `shopreel run` | 수집 → 영상 → 업로드 1회 |
| `shopreel auto --every 180 [--runs 8]` | 주기 자동 실행 |
| `shopreel publish` | 대기·실패한 업로드 재시도 |
| `shopreel serve --port 8787` | 클릭 추적 리다이렉트 서버 |
| `shopreel report --days 30` | 클릭·주문·수익 리포트 |
| `shopreel import-revenue report.csv --network amazon` | 제휴 네트워크 전환 CSV 반영 |
| `shopreel links` | 최근 만든 영상과 추적 링크 |
| `shopreel init` | 설정 파일 생성 |

자주 쓰는 옵션: `--sources`, `--publish`, `--top`, `--duration`, `--lang ko|en`,
`--script template|llm`, `--tts`, `--preset veryfast --crf 28`(빠른 미리보기), `--dry-run`.

---

## 5. 실제 데이터 연결 (소스 키)

`shopreel.env.example` 를 복사해 필요한 것만 채우고 `source` 하면 됩니다.

| 소스 | 필요한 것 | 발급처 |
| --- | --- | --- |
| `aliexpress` | APP_KEY / APP_SECRET / TRACKING_ID | AliExpress 제휴 오픈 플랫폼 |
| `amazon` | ACCESS_KEY / SECRET_KEY / ASSOC_TAG | Amazon Associates + PA-API 5.0 |
| `coupang` | ACCESS_KEY / SECRET_KEY | 쿠팡 파트너스 오픈 API |
| `rakuten` | APP_ID (+ AFF_ID) | 라쿠텐 웹서비스 |
| `ebay` | CLIENT_ID / CLIENT_SECRET | eBay Developers (+ EPN) |
| `custom` | `SHOPREEL_CUSTOM_URL` | 직접 만든 수집기 / n8n / Apify 등이 뱉는 JSON |

> **공식 API 가 없는 플랫폼(틱톡샵·쇼피 등)은 `custom` 소스로 붙이세요.**
> 사이트를 무단 스크래핑하면 이용약관 위반이 될 수 있습니다. 공식 제휴 API 또는
> 데이터 제공 사업자를 쓰는 것을 권장합니다.

```bash
source shopreel.env
python3 -m shopreel run --sources aliexpress,amazon --publish youtube,tiktok
```

### 5-1. 쿠팡 파트너스로 바로 확인해 보기 (키 없이)

쿠팡 오픈 API 를 흉내 내면서 **요청의 CEA HMAC 서명을 실제로 검증하는** 목 서버가 들어 있습니다.
여기서 통과하면 실제 키로 바꿔도 같은 코드가 그대로 돕니다.

```bash
make shop-coupang               # 또는  python3 -m tools.coupang_demo --top 1 --fast
```

```
■ API 호출 서명 검증
  ○ GET  /v1/products/bestcategories/1016        ok
  ○ POST /v1/deeplink                            ok
■ 결과
  영상   output/coupang-demo/video/xxxx.mp4 (30초)
  제휴링크 https://link.coupang.com/a/209012?subId=c97f33a24c&utm_medium=youtube...
```

실제 키가 생기면 목 서버만 빼면 됩니다.

```bash
export COUPANG_ACCESS_KEY=... COUPANG_SECRET_KEY=...
python3 -m shopreel run --sources coupang --publish dryrun
```

쿠팡을 붙일 때 알아 둘 점

- **쿠팡은 평점·리뷰·판매량을 주지 않습니다.** 없는 값을 지어내지 않고 API 가 주는
  **인기 순위(rank)** 만 신호로 씁니다. 화면에도 "쿠팡 인기 3위"로 나가고,
  평점 배지는 평점을 주는 소스(알리·아마존)에서만 나옵니다.
  그래서 쿠팡을 쓸 때는 평점 필터를 꺼야 합니다: `"min_rating": 0, "min_reviews": 0`
- 상품 URL 은 **딥링크 API 로 파트너스 추적 링크(`link.coupang.com/a/...`)로 자동 변환**되고,
  플랫폼별 `subId` 가 붙어 유튜브/틱톡 성과가 따로 집계됩니다. 딥링크가 실패해도
  원본 URL 로 계속 진행합니다.
- 엔드포인트는 `COUPANG_ENDPOINT` 로 고릅니다: `bestcategories`(기본) · `goldbox`(골드박스 특가) · `search`.
- 할인율은 쿠팡이 준 `discountRate` 를 그대로 씁니다(쇼핑몰 표시값과 화면이 어긋나지 않게).

---

## 6. 업로드 연결

| 플랫폼 | 필요한 것 | 비고 |
| --- | --- | --- |
| YouTube | CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN | Data API v3 재개형 업로드. 아래 6-1 참고 |
| TikTok | ACCESS_TOKEN | 기본은 **초안함** 업로드. 바로 게시는 심사 통과 앱(`TIKTOK_DIRECT_POST=1`) |
| Instagram | IG_USER_ID / IG_ACCESS_TOKEN + 공개 영상 URL | Graph API 는 로컬 파일이 아닌 URL 을 받습니다 |
| Facebook | FB_PAGE_ID / FB_PAGE_TOKEN | 페이지 동영상 직접 업로드 |
| `dryrun` | 없음 | 업로드하지 않고 패키지만 생성 (기본값) |

- 자격증명이 없으면 **에러가 아니라 `skipped`** 로 기록됩니다.
- 업로드 실패·대기 건은 `shopreel publish` 로 재시도합니다.
- 플랫폼별 **일일 업로드 한도**(`daily_limit`)를 넘으면 자동으로 건너뜁니다. 계정 보호용이니
  무리하게 올리지 마세요.

### 6-1. 유튜브 붙이기 (한 번만 하면 계속 자동)

**1) 키 발급**

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성
2. **YouTube Data API v3** 사용 설정
3. OAuth 동의 화면 구성 → 아래 '토큰 만료' 항목을 꼭 읽고 **앱 게시(프로덕션)** 까지 하세요
4. 사용자 인증 정보 → OAuth 클라이언트 ID → **데스크톱 앱** 생성
5. refresh token 발급 (브라우저가 한 번 열립니다)

```bash
export YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=...
python3 -m tools.youtube_auth --save shopreel.env     # 원격 서버면 --paste
python3 -m shopreel check                             # youtube 가 ○ 로 바뀌면 완료
```

**2) 업로드**

```bash
python3 -m shopreel run --sources coupang --publish youtube
python3 -m shopreel auto --every 240 --publish youtube   # 4시간마다 자동
```

**3) 키 없이 먼저 확인해 보기**

유튜브 API 목 서버로 토큰 갱신 → 재개형 세션 → 청크 전송 → 썸네일까지 그대로 태워 봅니다.
받은 바이트가 원본 파일과 같은지(sha1)까지 확인하므로, 여기서 통과하면 실제 업로드도 같습니다.

```bash
make shop-youtube        # 쿠팡 수집 → 영상 제작 → 유튜브 업로드 전 구간
```

```
■ 유튜브 업로드 검증
  video id   vid_8846875e
  전송 크기  888,750 bytes (sha1 8846875e1df0…)
  제목       40% 할인 | 코시 접이식 LED 스탠드 무단조절 USB 충전식 #shorts
  공개설정   public · AI고지 True
  썸네일     79,186 bytes
```

**4) 실무에서 꼭 걸리는 3가지**

| 함정 | 내용 | 대응 |
| --- | --- | --- |
| **할당량** | 업로드 1건이 약 **1,600 유닛**, 기본 일일 할당량은 10,000 → **하루 6건이 한계** | `daily_limit.youtube` 기본값을 5로 잡아 뒀습니다. 더 올리려면 Google 에 할당량 증액을 신청하세요. 할당량 초과는 실패가 아니라 `queued` 로 기록되고 `shopreel publish` 로 재시도됩니다 |
| **토큰 만료** | OAuth 동의 화면이 **테스트 모드면 refresh token 이 7일 뒤 만료**됩니다 | 동의 화면을 **프로덕션으로 게시**하세요. 만료되면 `python3 -m tools.youtube_auth` 로 재발급 |
| **썸네일** | `thumbnails.set` 은 **채널 인증(전화번호 확인)** 이 끝나야 됩니다 | 인증 전이면 `YOUTUBE_THUMBNAIL=0`. 썸네일이 실패해도 영상 업로드 자체는 성공합니다 |

그 외 자동으로 처리되는 것

- 세로 9:16 영상은 본문에 `#Shorts` 를 붙여 쇼츠로 분류되게 합니다.
- **AI 생성 고지**(`containsSyntheticMedia`)와 아동용 아님(`selfDeclaredMadeForKids=false`)을 항상 설정합니다.
- 제목 100자, 본문 5,000자 제한에 맞춰 자동으로 자릅니다.
- 8MB 청크로 나눠 올리고, 끊기면 서버에 진행 지점을 물어 **이어서 전송**합니다(5xx 는 지수 백오프로 5회 재시도).
- 예약 발행: `YOUTUBE_PUBLISH_AT=2026-09-10T09:00:00Z` (비공개로 올라가 그 시각에 공개됩니다).

---

## 7. 링크·수익 추적

```bash
python3 -m shopreel serve --port 8787       # 추적 서버
```

| 엔드포인트 | 용도 |
| --- | --- |
| `GET /r/<code>` | 클릭 기록 후 제휴 링크로 302 |
| `POST /postback` | 제휴 네트워크 전환 웹훅 (`code`, `order_id`, `amount`, `commission`) |
| `GET /stats` | 요약 JSON |
| `GET /health` | 헬스체크 |

- 실서비스에서는 앞단에 nginx/Cloudflare 를 두고 HTTPS 를 종단한 뒤,
  `tracker_base` 를 실제 도메인(`https://link.내도메인.com`)으로 바꾸세요.
- 웹훅이 없는 네트워크는 CSV 리포트를 내려받아 `shopreel import-revenue` 로 넣으면 됩니다.
  헤더 이름이 달라도(SubId / u1 / customid …) 알아서 인식합니다.
- 클릭 IP 는 원문 저장 없이 솔트 해시로만 기록합니다.

수익 구조: **조회수 → 클릭 → 주문 → 수수료**. 리포트는 각 단계 전환율과
플랫폼·상품·카테고리별 성과를 보여 주고, 카테고리 EPC 는 다음 실행의 상품 선정에 반영됩니다.

---

## 8. 24시간 자동화

한 프로세스로 돌리기

```bash
python3 -m shopreel auto --every 180        # 3시간마다, Ctrl+C 로 종료
```

크론으로 돌리기

```cron
0 */3 * * *  cd /path/to/repo && . ./shopreel.env && python3 -m shopreel run >> log/run.log 2>&1
5 4   * * *  cd /path/to/repo && . ./shopreel.env && python3 -m shopreel publish >> log/retry.log 2>&1
```

추적 서버는 `systemd` 나 `pm2` 로 상시 실행해 두세요.

---

## 9. 반드시 지켜야 할 것

- **광고 표기 의무.** 제휴 링크가 있는 콘텐츠는 대가성을 명확히 밝혀야 합니다(공정위
  추천·보증 심사지침, FTC Endorsement Guides). 이 파이프라인은 화면·본문·해시태그
  세 곳에 자동으로 넣지만, 문구가 각 나라·플랫폼 기준에 맞는지는 직접 확인하세요.
- **금지 카테고리 자동 제외.** 의약품·건강 표방, 성인용품, 무기, 담배/전자담배, 도박,
  위조품, 몰래카메라 등은 제작 대상에서 빠집니다(`compliance.py`에서 조정).
- **과장 표현 자동 완화.** "최저가 보장", "100% 효과", "guaranteed" 같은 단정 표현은
  대본 생성 시 완화됩니다.
- **상품 이미지 저작권.** 제휴 프로그램이 허용하는 범위에서만 상품 이미지를 사용하세요.
  이미지가 없거나 사용이 곤란하면 절차적으로 그린 카드가 대신 쓰입니다.
- **플랫폼 정책.** 대량 자동 게시는 스팸으로 간주될 수 있습니다. 일일 한도를 지키고,
  같은 상품을 반복 게시하지 마세요(`repost_after_days` 기본 30일).
- **AI 생성 고지.** YouTube 업로드 시 합성 미디어 플래그를 자동으로 설정합니다.

---

## 10. 품질을 올리는 순서

1. `--script llm` (ANTHROPIC_API_KEY) — 상품별 카피가 확 달라집니다.
2. TTS 업그레이드 — `pip install edge-tts` (무료) 또는 `ELEVENLABS_API_KEY`.
3. `assets/bgm/` 에 배경음악을 넣고 `--bgm assets/bgm`.
4. `min_commission`, `min_discount` 를 올려 **수익성 높은 상품만** 제작.
5. 2주쯤 데이터가 쌓이면 `shopreel report` 로 이기는 카테고리를 확인하고
   `allow_categories` 로 좁히기.

## 11. 구조

```
shopreel/
  config.py        설정(길이·비트 배분·필터·한도)
  models.py        Product / Script / VideoAsset / PostResult
  sources/         수집 소스 (aliexpress, amazon, coupang, rakuten, ebay, custom, demo)
  rank.py          점수화·필터·중복 제거 (+ 수익 피드백)
  compliance.py    광고 표기·금지 카테고리·과장 표현
  affiliate.py     제휴 링크 + 플랫폼별 추적코드
  scriptgen.py     5단계 대본 + 제목/본문/해시태그
  providers/llm.py Claude 대본(선택)
  render/          제품 카드 이미지 + 영상 조립(india2030 엔진 재사용)
  publish/         youtube · tiktok · instagram · facebook · dryrun
  tracker.py       클릭 리다이렉트 + 전환 웹훅 서버
  revenue.py       수익 집계·CSV 임포트·리포트
  store.py         SQLite 기록
  pipeline.py      전체 흐름
  scheduler.py     주기 실행
  cli.py           명령줄
tools/
  mock_coupang.py  쿠팡 오픈 API 목 서버 (서명 검증 포함)
  mock_youtube.py  유튜브 Data API 목 서버 (재개형 업로드·할당량 오류 재현)
  coupang_demo.py  쿠팡→영상→유튜브 전 구간 시연 (키 없이)
  youtube_auth.py  유튜브 refresh token 발급 도우미
```

테스트: `make test` (렌더링 없이 1초대에 끝납니다)
