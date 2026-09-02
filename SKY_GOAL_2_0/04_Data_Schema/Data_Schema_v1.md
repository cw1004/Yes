# 데이터 스키마 v1.0

- 저장 위치: 브라우저 `localStorage`
- 키: `sky_goal_2_0_profile_v1`
- 값: `player_profile.json` 과 동일한 형태의 JSON 문자열
- `player_profile.json` 은 `engine.js` 의 `createProfile()` 출력에서 생성되므로 항상 코드와 일치한다.

## 필드
| 경로 | 타입 | 설명 |
|---|---|---|
| `skill` | 0~100 | 숙련도 S |
| `difficulty` | 10~95 | 현재 난이도 D |
| `level` / `xp` | number | 레벨과 누적 경험치 |
| `coins` | int | 보유 코인 |
| `statPoints` | int | 미사용 스탯 포인트 |
| `bestScore` | int | 최고 점수 |
| `stats.*` | 0~100 | CONTROL / POWER / SPEED / LUCK / STAMINA |
| `metrics.*` | — | AI 난이도 엔진 입력 지표 |
| `metrics.recentScores` | number[10] | 최근 10게임 점수 |
| `metrics.recentSuccesses` | 0\|1[10] | 최근 10게임 성공 여부 |
| `metrics.winStreak` / `loseStreak` | int | 연속 성공·실패 |
| `inventory.*` | int | 등급별 획득 아이템 수 |
| `lastRun` | object | 직전 판 요약 |

## 복구 정책 (`normalizeProfile`)
저장 데이터가 손상되었거나 구버전이어도 게임이 멈추지 않는다.
- JSON 파싱 실패 → 새 프로필
- 숫자가 아닌 값 / 범위 밖 값 → 기본값 또는 clamp
- 배열이 아닌 `recentScores` → 빈 배열, 숫자가 아닌 원소는 제거
- `localStorage` 자체가 막힌 환경(시크릿 모드, 일부 `file://`) → 세션 메모리로 폴백하고
  시작 화면에 "이번 세션에서만 기록이 유지됩니다" 라고 알린다.
