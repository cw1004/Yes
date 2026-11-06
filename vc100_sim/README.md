# VC-100 재시뮬레이션 (베이퍼 챔버 + 핀 스택)

도면 VC-100 Rev A 성능표를 독립 모델로 재현하고, 같은 외형(68×68 mm, 핀 높이 20 mm)·같은 팬 전력에서
최고 성능 설계를 찾습니다.

```bash
pip install numpy matplotlib
python -m vc100_sim.analyze   # → output/vc100/
```

- 강제 대류: Teertstra 평판 핀 모델 + 핀 효율 + Muzychka–Yovanovich 압력 손실. 도면 3개 점을 보정 없이 ±3 % 재현.
- 자연 대류: Bar-Cohen–Rohsenow 채널 식 + 외곽 복사. 도면 25 °C 행에 맞춰 대류에 1.5배 보정 → 신뢰도 낮음.
- 내부 열저항: 도면 네트워크 값(0.194 K/W)을 윅 두께·핀 접합 방식에 비례해 조정.
- 시뮬레이션 결과이며 실증이 아닙니다. 시제품 풍동 시험으로 확인해야 합니다.
