# 세 친구의 여행 (프로토타입)

NUBI · WOBI · SARO 세 친구가 함께 걷는 오토런 어드벤처의 **최소 검증판**.

검증 대상은 딱 두 가지다.
1. **티키타카(장난치기)** — 걷는 중 친구들이 장난을 걸고, 제때 탭하면 성공
2. **리더 교체** — 장애물마다 필요한 친구가 다르다

```bash
python3 build.py     # 07_MVP_Code/three_friends.html 생성
./serve.sh           # http://localhost:8080/07_MVP_Code/three_friends.html
bash test.sh         # 엔진 24개 + 브라우저 18개
```

설계 근거는 `01_Game_Design/Game_Design_v1.md` 에 있다.

구조
```
07_MVP_Code/src/engine.js   난이도 · 편중 보정 · 미션 · 보상 (DOM 의존 없음, Node 에서도 돈다)
07_MVP_Code/src/game.js     렌더링 · 입력 · 화면 전환
07_MVP_Code/tests/          엔진 단위 테스트 + Playwright 스모크 테스트
```
