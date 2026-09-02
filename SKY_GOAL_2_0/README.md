# SKY GOAL 2.0

플레이 데이터를 분석해 난이도·경기장·보상이 스스로 조정되는 원버튼 축구 아케이드.
설치 없이 브라우저에서 바로 실행된다.

## 바로 실행

```bash
# 1) 파일을 그대로 열기
open 07_MVP_Code/sky_goal_2_0.html          # macOS
xdg-open 07_MVP_Code/sky_goal_2_0.html      # Linux
start 07_MVP_Code\sky_goal_2_0.html         # Windows

# 2) 또는 로컬 서버로 (일부 브라우저는 file:// 에서 localStorage 를 막는다)
./serve.sh                                   # http://localhost:8080/sky_goal_2_0.html
```

조작: **탭 / 클릭 / 스페이스** 한 가지뿐. 시작 후 첫 탭까지는 준비 상태로 기다린다.

## 빌드와 검증

```bash
python3 build.py            # src/ → 07_MVP_Code/sky_goal_2_0.html 생성
python3 build.py --zip      # 배포용 zip 까지 생성
./test.sh                   # 빌드 + 엔진 테스트 15개 + 브라우저 스모크 테스트 15개
```

- 엔진 테스트: Node 만 있으면 실행된다 (`node --test`)
- 브라우저 스모크 테스트: Playwright 가 있으면 실제 Chromium 에서 한 판을 자동 플레이하고,
  없으면 자동으로 건너뛴다

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
│   ├── src/game.js             렌더링·입력·화면 전환
│   ├── src/style.css, template.html
│   └── tests/                  엔진 단위 테스트 + 브라우저 스모크 테스트
├── 08_Patent/                  기술 정리 노트
├── 09_Test_Balance/            테스트·밸런스 기준
└── 10_Release/                 릴리즈 체크리스트
```

`engine.js` 는 DOM 에 의존하지 않는다. 그래서 브라우저에서 게임이 쓰는 로직과
Node 테스트가 검증하는 로직이 **완전히 같은 코드**다.

## 작동 방식 요약

1. 한 판이 끝나면 7개 지표를 모아 숙련도 `S` 를 갱신한다 (지수 평활 0.7/0.3)
2. `D = clamp(0.85S + 8 + F, 10, 95)` 로 목표 난이도를 구하고, **한 판당 ±5** 만 움직인다
3. `D` 는 골문 간격·스크롤 속도·골문 이동폭·바람으로 환산된다
4. 다음 골문은 현재 물리값에서 **도달 가능한 높이 범위** 안에서만 생성된다
5. 결과 화면이 난이도 변경 근거를 문장으로 보여준다

자세한 내용은 `02_AI_Engine/AI_Difficulty_Engine_v1.md` 참고.

## 주의

현재 AI 는 머신러닝 모델이 아니라 **설명 가능한 규칙 기반 적응형 엔진**이다.
학습된 가중치가 아니라 문서에 적힌 공식 그대로 동작한다.
