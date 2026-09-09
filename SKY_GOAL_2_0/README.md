# SKY GOAL 2.0

플레이 데이터를 분석해 난이도·경기장·보상이 스스로 조정되는 원버튼 축구 아케이드.
히말라야 능선과 강이 흐르는 배경, WebAudio 로 합성한 BGM·효과음까지 파일 하나에 들어있다.
설치 없이 브라우저에서 바로 실행된다.

## 어디서 돌아가나

| 형태 | 파일 | 설명 |
|---|---|---|
| 웹 | `07_MVP_Code/sky_goal_2_0.html` | 파일 하나. 열면 바로 플레이 |
| 설치형 웹앱(PWA) | `07_MVP_Code/pwa/` | 홈 화면에 추가 → 오프라인 실행, 스토어 불필요. **아이폰도 여기로** |
| 안드로이드 앱 | `11_App_Android/` | WebView 셸 + AdMob(배너·전면·보상형 이어하기) |

아이폰은 Safari → 공유 → 홈 화면에 추가로 PWA 를 쓰면 됩니다
(노치·다이내믹 아일랜드 safe-area 대응 완료). 앱스토어 출시는 맥과 연 $99 가 필요합니다.

같은 HTML 이 세 곳에서 그대로 돌아갑니다. 앱에서만 `window.SkyGoalNative` 가 주입되어
광고와 이어하기가 활성화되고, 브라우저에서는 그 기능이 조용히 빠집니다.

## 바로 실행

```bash
# 1) 파일을 그대로 열기
open 07_MVP_Code/sky_goal_2_0.html          # macOS
xdg-open 07_MVP_Code/sky_goal_2_0.html      # Linux
start 07_MVP_Code\sky_goal_2_0.html         # Windows

# 2) 또는 로컬 서버로 (일부 브라우저는 file:// 에서 localStorage 를 막는다)
./serve.sh                                   # http://localhost:8080/sky_goal_2_0.html
```

경기는 **킥오프 연출**로 시작한다 — 휘슬 → 선수가 달려와 공을 차 올리고, 그 공이
플레이 위치에 안착하면 조작이 넘어온다 (탭하면 건너뛰기).

조작: **탭 / 클릭 / 스페이스** 한 가지뿐. 시작 화면의 **⚙ 조작 설정**에서 공 상하 반응(20~100)과 스피드(30~100)를 손에 맞게 조절할 수 있고,
**⚽ 공 선택 · 상점**에서 무게가 다른 공 5종을 코인으로 해금해 바꿔 쓸 수 있다.
소리는 첫 탭에서 켜지고, 우하단 🔊 버튼으로 끌 수 있다(설정 저장됨).

## 빌드와 검증

```bash
python3 build.py            # src/ → 07_MVP_Code/sky_goal_2_0.html 생성
python3 build.py --pwa      # 설치형 웹앱(PWA)까지 생성
python3 build.py --zip      # 배포용 zip 까지 생성

cd 11_App_Android && ./sync_assets.sh && gradle bundleRelease   # 스토어 업로드용 AAB
./test.sh                   # 빌드 + 엔진 테스트 15개 + 브라우저 스모크 테스트 15개
```

- 단위 테스트 35개(엔진 24 · 사운드 5 · 배경 6): Node 만 있으면 실행된다 (`node --test`)
- 브라우저 스모크 테스트: Playwright 가 있으면 실제 Chromium 에서 한 판을 자동 플레이하고,
  없으면 자동으로 건너뛴다 (52개 항목)

## 구조

```
SKY_GOAL_2_0/
├── build.py                    단일 HTML 빌드 + zip
├── test.sh / serve.sh          검증 / 로컬 실행
├── 01_Game_Design/             게임 디자인
├── 02_AI_Engine/               AI 난이도 엔진 사양
├── 03_Game_Engine/             경기장 변화 시스템
├── 04_Data_Schema/             프로필 스키마 (코드에서 생성)
├── 05_Reward_Economy/          보상·성장 사양
├── 06_Art_Sound/               아트·사운드 가이드
├── 07_MVP_Code/
│   ├── sky_goal_2_0.html       ★ 빌드 결과 — 이 파일 하나로 플레이
│   ├── src/engine.js           난이도·보상 로직 (DOM 없음, Node 에서도 실행)
│   ├── src/audio.js            WebAudio 합성 BGM·효과음 (음원 파일 없음)
│   ├── src/scenery.js          산·강·하늘 패럴랙스 배경
│   ├── src/game.js             렌더링·입력·화면 전환
│   ├── src/style.css, template.html
│   └── tests/                  엔진 단위 테스트 + 브라우저 스모크 테스트
├── 08_Patent/                  기술 정리 노트
├── 09_Test_Balance/            테스트·밸런스 기준
├── 10_Release/                 릴리즈 · 스토어 출시 · 수익화 문서
│   ├── PLAY_STORE_GUIDE.md     구글 플레이 등록 절차 (★ 표시가 직접 하실 부분)
│   ├── MONETIZATION.md         광고 배치와 수익 계산
│   ├── PRIVACY_POLICY.md       개인정보처리방침 초안
│   └── store/                  아이콘 · 피처그래픽 · 스크린샷 · 등록정보 문구
└── 11_App_Android/             안드로이드 앱 프로젝트
```

`engine.js` 는 DOM 에 의존하지 않는다. 그래서 브라우저에서 게임이 쓰는 로직과
Node 테스트가 검증하는 로직이 **완전히 같은 코드**다.

## 작동 방식 요약

1. 한 판이 끝나면 7개 지표를 모아 숙련도 `S` 를 갱신한다 (지수 평활 0.7/0.3)
2. `D = clamp(0.85S + 8 + F, 10, 95)` 로 목표 난이도를 구하고, **한 판당 ±5** 만 움직인다
3. `D` 는 골문 간격·스크롤 속도·골문 이동폭·바람으로 환산된다
4. 다음 골문은 현재 물리값에서 **도달 가능한 높이 범위** 안에서만 생성된다
5. 결과 화면이 난이도 변경 근거를 문장으로 보여준다
6. 스테이지가 오르면 하늘·산·강 색과 날씨가 바뀌고 BGM 파트가 쌓인다 (강도 0~3)
7. 공의 무게(0.78~1.30)가 중력에 곱해져 상하 운동이 공마다 달라진다
8. 골문 7~10개마다 동료 선수가 나타나 낮게 온 공을 헤딩으로 띄워 준다 (보너스 점수)

자세한 내용은 `02_AI_Engine/AI_Difficulty_Engine_v1.md` 참고.

## 주의

현재 AI 는 머신러닝 모델이 아니라 **설명 가능한 규칙 기반 적응형 엔진**이다.
학습된 가중치가 아니라 문서에 적힌 공식 그대로 동작한다.
