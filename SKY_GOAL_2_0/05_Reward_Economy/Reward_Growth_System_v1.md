# 보상/성장 시스템 v1.0

구현 위치: `07_MVP_Code/src/engine.js`

## 점수
```
통과 1회: Score += 10 + 2*Combo + PerfectBonus
PerfectBonus = clamp(10 * (1 - |error| / (gap/2)), 0, 10)
```
`error` 는 골문 중앙과 공 중심의 세로 거리. 중앙에 가까울수록 최대 10점.
`|error| <= gap * perfectWindow(기본 0.12)` 이면 **퍼펙트**로 집계되고 골드 파티클이 터진다.

## 코인
```
CoinReward = round(10 + 25 * ln(score + 1))
```
0점이어도 10코인은 지급해 실패한 판도 완전한 손실이 되지 않게 한다.

## XP / 레벨
```
XPReward   = (20 + score*1.5 + perfectCount*5) * (1 + difficulty/200)
XP_required(L) = 100 * L^1.5
```
난이도가 높을수록 XP 가 최대 1.475배까지 늘어난다(고난도 플레이 보상).

## 아이템
| 등급 | 기본 확률 |
|---|---|
| Common | 60% |
| Rare | 25% |
| Epic | 10% |
| Legendary | 5% |

```
Legendary = clamp(5 + (D-50)/100*10 + (LUCK-50)/50, 5, 12)   // 최대 12%
Common    = 100 - Legendary - Epic - Rare                     // 나머지에서 차감
```

## 성장 스탯
레벨업 1회당 **스탯 포인트 1점**(스탯 +2)을 지급하고, 결과 화면에서 직접 배분한다.

| 스탯 | 효과 |
|---|---|
| CONTROL | 골문 간격 체감 +, 골문 흔들림 -, 퍼펙트 판정 폭 + |
| POWER | 탭 1회의 상승력 + |
| SPEED | 체감 스크롤 속도 - |
| LUCK | Legendary 확률 + |
| STAMINA | 중력 - (체공 시간 +) |

모든 보정은 ±10~20% 이내로 제한된다.

## 안티 프러스트레이션
- 최근 10게임 성공률 < 65% → 난이도 -5
- 65~80% → 유지
- \> 80% → 난이도 +5
- 조기 사망(3초 미만/통과 0개)에는 추가로 -3
- 한 판당 난이도 변화는 ±5 이내
