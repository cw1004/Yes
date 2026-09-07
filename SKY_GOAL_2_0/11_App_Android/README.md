# SKY GOAL — 안드로이드 앱

웹 게임(`sky_goal_2_0.html`)을 WebView 로 감싼 네이티브 앱입니다.
게임 로직은 그대로 재사용하고, 앱에서만 광고와 이어하기가 추가됩니다.

## 구조

```
11_App_Android/
├── sync_assets.sh              웹 빌드 + 아이콘 → 앱으로 복사
├── app/src/main/
│   ├── assets/game/index.html  게임 본체 (sync_assets.sh 가 생성)
│   ├── java/.../MainActivity.java   WebView 셸 (전체화면·뒤로가기·화면 유지)
│   ├── java/.../AdsManager.java     배너/전면/보상형 + GDPR 동의(UMP)
│   ├── java/.../NativeBridge.java   웹 → 네이티브 창구 (window.SkyGoalNative)
│   └── res/values/strings.xml       ★ AdMob ID (지금은 테스트 ID)
└── build.gradle                applicationId: com.skygoal.arcade
```

## 빌드

```bash
./sync_assets.sh          # 항상 먼저 실행 (게임 최신본을 앱에 넣는다)
gradle assembleDebug      # 디버그 APK
gradle bundleRelease      # 스토어 업로드용 AAB (서명 환경변수 필요)
```

Android Studio 로 이 폴더를 열어도 됩니다. Gradle wrapper jar 는 저장소에 포함하지
않았으므로, 커맨드라인으로 처음 빌드할 때는 `gradle wrapper` 를 한 번 실행하거나
설치된 `gradle` 명령을 그대로 쓰면 됩니다.

## 웹 ↔ 네이티브 연결

| 방향 | 호출 | 동작 |
|---|---|---|
| 웹 → 앱 | `SkyGoalNative.gameOver(score, games)` | 3판마다 전면 광고 (최소 90초 간격) |
| 웹 → 앱 | `SkyGoalNative.showRewarded()` | 보상형 광고 재생 |
| 앱 → 웹 | `SkyGoal.onRewardResult(true/false)` | 시청 완료 시 같은 점수로 이어하기 |

브라우저에서는 `window.SkyGoalNative` 가 없으므로 이어하기 버튼이 나타나지 않고,
게임은 평소대로 동작합니다. 같은 HTML 이 웹·PWA·앱 세 곳에서 그대로 돌아갑니다.

## 출시 전 반드시

1. `res/values/strings.xml` 의 AdMob ID 를 실제 값으로 교체
2. `build.gradle` 의 `versionCode` / `versionName` 확인
3. `../10_Release/PLAY_STORE_GUIDE.md` 체크리스트 확인
