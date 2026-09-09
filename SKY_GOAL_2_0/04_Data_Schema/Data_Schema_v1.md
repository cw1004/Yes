# 데이터 스키마 v1.0

- 저장 위치: 브라우저 `localStorage`
- 키: `sky_goal_2_0_profile_v1`
- 값: `player_profile.json` 과 동일한 형태의 JSON 문자열
- `player_profile.json` 은 `engine.js` 의 `createProfile()` 출력에서 생성되므로 항상 코드와 일치한다.

## 필드
| 경로 | 타입 | 설명 |
|---|---|---|
| `mode` | 'amateur'\|'pro' | 현재 모드 |
| `modes.<모드>` | object | 모드별 `skill` · `difficulty` · `bestScore` · 최근 10게임 · 연속 기록 |
| `skill` | 0~100 | 숙련도 S (현재 모드의 미러) |
| `difficulty` | 10~95 | 현재 난이도 D |
| `level` / `xp` | number | 레벨과 누적 경험치 |
| `coins` | int | 보유 코인 |
| `statPoints` | int | 미사용 스탯 포인트 |
| `bestScore` | int | 최고 점수 |
| `stats.*` | 0~100 | CONTROL / POWER / SPEED / LUCK / STAMINA |
| `settings.muted` | bool | 음소거 |
| `settings.ballFine` | 20~100 | 공 상하 미세 조정 |
| `settings.speed` | 30~100 | 스피드 |
| `balls.owned` | string[] | 보유 공 id (기본 공은 항상 포함) |
| `balls.selected` | string | 사용 중인 공 id |
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
- 존재하지 않는 공 id → 목록에서 제거, 보유하지 않은 공을 선택 중이면 기본 공으로
- `modes` 가 없는 구버전 프로필 → 최상위 skill·difficulty·bestScore·최근 기록을
  **아마추어 모드로 이어받는다** (기존 플레이어의 기록이 초기화되지 않게)
- 최고 점수는 모드 전환 시 절대 내려가지 않는다
- `localStorage` 자체가 막힌 환경(시크릿 모드, 일부 `file://`) → 세션 메모리로 폴백하고
  시작 화면에 "이번 세션에서만 기록이 유지됩니다" 라고 알린다.
