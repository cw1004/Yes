# 구글 플레이 출시 가이드

> **제가 할 수 있는 것은 여기까지 끝냈습니다.** 앱 프로젝트, 아이콘, 스토어 이미지,
> 등록정보 문구, 빌드 자동화가 모두 준비되어 있습니다.
> **아래 ★ 표시 단계는 계정·결제·서명키가 필요해 반드시 직접 하셔야 합니다.**

## 0. 준비물

| 항목 | 비용 | 비고 |
|---|---|---|
| ★ Google Play 개발자 계정 | **$25 (1회)** | https://play.google.com/console — 신분 확인 절차 있음 |
| ★ AdMob 계정 | 무료 | https://admob.google.com — 광고 단위 ID 발급 |
| ★ 개인정보처리방침 URL | 무료 | `PRIVACY_POLICY.md` 를 GitHub Pages 등에 올리면 됨 |
| ★ 결제 프로필 | — | 수익 지급용 (계좌·세금 정보) |
| Android Studio | 무료 | 빌드용. GitHub Actions 로 대체 가능 |

## 1. 앱 빌드

### 1-1. ★ 업로드 키(서명키) 만들기 — 딱 한 번, 절대 분실 금지
```bash
keytool -genkeypair -v \
  -keystore skygoal-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias skygoal
```
> 이 파일과 비밀번호를 잃어버리면 **같은 앱을 업데이트할 수 없습니다.**
> 저장소에 커밋하지 말고, 비밀번호 관리자와 오프라인 백업 두 곳에 보관하세요.
> (Play App Signing 을 쓰면 분실 시 구글에 재설정 요청이 가능합니다 — 등록 시 켜 두세요.)

### 1-2. AAB 만들기
```bash
cd SKY_GOAL_2_0/11_App_Android
./sync_assets.sh                     # 웹 게임 + 아이콘을 앱에 복사

export SKYGOAL_KEYSTORE=$PWD/skygoal-upload.jks
export SKYGOAL_KEYSTORE_PASSWORD=****
export SKYGOAL_KEY_ALIAS=skygoal
export SKYGOAL_KEY_PASSWORD=****
gradle bundleRelease                 # 또는 Android Studio: Build > Generate Signed Bundle
```
결과: `app/build/outputs/bundle/release/app-release.aab` ← 이 파일을 업로드합니다.

> GitHub Actions(`.github/workflows/skygoal-android.yml`)에 위 4개를 Secrets 로 넣어두면
> (`SKYGOAL_KEYSTORE_BASE64` 는 `base64 -w0 skygoal-upload.jks` 결과) 푸시할 때마다
> 서명된 AAB 가 자동으로 만들어집니다.

## 2. ★ AdMob 설정 (수익화의 실제 시작점)

1. AdMob 콘솔 → 앱 추가 → Android → "아직 스토어에 등록되지 않음" 선택
2. 광고 단위 3개 생성: **배너**, **전면**, **보상형**
3. 발급받은 ID 를 `app/src/main/res/values/strings.xml` 에 붙여넣기
   ```xml
   <string name="admob_app_id">ca-app-pub-실제값~실제값</string>
   <string name="admob_banner_id">ca-app-pub-실제값/실제값</string>
   <string name="admob_interstitial_id">ca-app-pub-실제값/실제값</string>
   <string name="admob_rewarded_id">ca-app-pub-실제값/실제값</string>
   ```
4. 스토어 출시 후 AdMob 에서 앱과 스토어 등록을 연결(앱 승인)

> ⚠️ **개발 중에는 절대 실제 광고 ID 로 테스트하지 마세요.** 자기 광고 클릭은 계정 정지 사유입니다.
> 현재 코드에는 구글 공식 테스트 ID 가 들어 있습니다. 출시 직전에만 교체하세요.

## 3. ★ Play Console 등록 순서

1. **앱 만들기** — 이름 `SKY GOAL 2.0`, 언어 한국어, **게임**, **무료**
2. **스토어 등록정보** — `store/LISTING.md` 의 문구와 `store/` 의 이미지를 그대로 사용
   - 앱 아이콘 512×512 (`store/icons/icon-512.png`)
   - 그래픽 이미지 1024×500 (`store/feature-graphic-1024x500.png`)
   - 휴대전화 스크린샷 최소 2장 (`store/screenshots/` 에 1080×1920 7장 준비됨)
3. **콘텐츠 등급 설문** — 폭력·성적 요소 없음, **"광고 포함" 반드시 체크** → 전체이용가
4. **타겟 사용자층** — 만 13세 이상 권장. 아동(13세 미만)을 대상으로 하면
   가족 정책과 광고 제한이 크게 늘어나므로 이 앱은 **아동 대상 아님**으로 설정
5. **데이터 보안 양식** — 아래 4번 표대로 입력
6. **광고** — "이 앱에는 광고가 포함되어 있습니다" **예**
7. **국가/지역** — 전체 또는 인도·한국 우선
8. ★ **비공개 테스트** — 개인 개발자 계정은 프로덕션 출시 전에 일정 인원의 테스터가
   일정 기간 연속으로 참여해야 합니다(대략 **12명 이상 / 14일 이상**).
   **정확한 인원과 기간은 계정마다 다르고 정책이 자주 바뀌므로 Play Console 이
   화면에 표시하는 요건을 그대로 따르세요.**
   테스터는 Google 계정 이메일로 초대하며, 지인 12명이면 충분합니다.
9. **프로덕션 출시** — 심사 보통 며칠, 신규 계정은 더 걸릴 수 있음

## 4. 데이터 보안 양식 답변 (이 앱 기준)

| 질문 | 답변 |
|---|---|
| 데이터를 수집/공유하나요? | **예** (광고 SDK) |
| 수집 항목 | 기기 또는 기타 ID → **광고 ID** |
| 목적 | 광고 또는 마케팅 |
| 제3자와 공유 | 예 (Google AdMob) |
| 전송 중 암호화 | 예 |
| 삭제 요청 가능 | 예 (기기 설정에서 광고 ID 재설정/삭제) |
| 게임 진행 데이터 | 기기 내부(localStorage)에만 저장, 서버 전송 없음 → **수집 아님** |

## 5. 반려를 부르는 흔한 실수 체크리스트

- [ ] 개인정보처리방침 URL 이 실제로 열리는가 (404 면 즉시 반려)
- [ ] 데이터 보안 양식과 실제 동작이 일치하는가 (광고 ID 수집 누락이 가장 흔함)
- [ ] 테스트 광고 ID 를 실제 ID 로 교체했는가
- [ ] 스크린샷에 다른 앱/브랜드/실존 인물이 없는가
- [ ] 앱 이름·아이콘이 기존 유명 게임을 연상시키지 않는가
- [ ] 타겟 SDK 가 정책 요구 버전 이상인가 (현재 35)
- [ ] 광고가 게임 플레이를 방해하지 않는가 (플레이 중 전면광고 금지 — 현재 구조는 안전)

## 6. 아이폰(iOS)은 어떻게 하나

**웹앱(PWA)은 지금 그대로 아이폰에서 됩니다.** Safari 로 주소를 열고
`공유 → 홈 화면에 추가` 하면 전체화면 아이콘 앱이 되고 오프라인에서도 돕니다.
노치·다이내믹 아일랜드 대응(safe-area)과 홈 화면 아이콘·이름이 이미 들어가 있습니다.

**앱스토어에 올리려면** 안드로이드와 별개의 준비가 필요합니다.

| 항목 | 안드로이드 | 아이폰 |
|---|---|---|
| 개발자 등록비 | $25 (1회) | **$99 / 년** |
| 빌드 장비 | 아무 PC | **맥(Mac) 필수** — Xcode 는 macOS 전용 |
| 심사 | 며칠 | 보통 하루~며칠, 반려 기준이 더 엄격 |
| 웹뷰 앱 정책 | 비교적 관대 | **단순 웹사이트 래핑은 반려**(가이드라인 4.2 최소 기능) |

4.2 대응: 오프라인 완전 동작, 홈 화면 위젯이나 푸시 같은 네이티브 기능,
게임센터 순위표 등 "웹사이트 이상의 것"이 있어야 통과 가능성이 올라갑니다.
지금 구조(오프라인 게임 + 로컬 저장)는 최소 요건에 가깝지만, 심사관 판단에 달렸습니다.

**권장 순서**: 안드로이드 먼저 출시 → 지표 확인 → 아이폰은 PWA 로 우회 →
수익이 $99/년을 넘길 만하면 그때 앱스토어 진입.

## 7. 출시 후

- Play Console → 통계에서 설치 수·유지율 확인
- AdMob → 수익, eCPM, 노출 확인 (`MONETIZATION.md` 참고)
- 업데이트 시 `app/build.gradle` 의 `versionCode` 를 **반드시 1 증가**시킬 것
