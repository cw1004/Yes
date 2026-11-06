# VC-100 Rev B 변경 도면 (AI 보조 초안)

`vc100_sim` 최적화 결과(같은 팬 전력에서 110 → 133 W)를 반영한 VC-100 Rev B 변경 도면 5장입니다.
바뀐 도면만 다시 발행하며, VC-101·102·202·400 은 Rev A 그대로 유효합니다.

```bash
python -m vc100_drawings.design_b     # Rev B 설계값 요약
python -m vc100_drawings.make_revb    # → output/vc100/VC100_drawingset_RevB.pdf
```

| 장 | 도번 | 내용 |
| --- | --- | --- |
| 1 | VC-100 | 조립 단면, 열저항 네트워크, 변경 내역(ECN), BOM, 성능표 |
| 2 | VC-103 | 소결 윅: 바닥 존 A 0.40 → 0.30, 모세관 예산 |
| 3 | VC-201 | 핀 스택: 32핀 t0.30 @2.0, Ni 도금, Sn-5Sb 납땜 사양 |
| 4 | VC-300 | 공정 15단계 (핀 납땜은 물 충전 전), 충전 1.66 mL |
| 5 | VC-500 | 신규: Rev A vs Rev B 비교 실증 시험 계획 |

성능은 시뮬레이션 값입니다. VC-500 시험 합격 전에는 양산하지 마세요.
