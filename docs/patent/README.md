# 인버터 불확실도 게이팅 복원 안전 시스템 — 특허 문서

초안 명세서를 기술적으로 검증·보정한 결과물이다.

| 파일 | 내용 | 출원서류 |
|---|---|---|
| [`01_기술결함_분석서.md`](01_기술결함_분석서.md) | 초안에 대한 독립 검증. 치명 13 / 중대 19 / 경미 8건 | 미포함 |
| [`02_명세서_보정판.md`](02_명세서_보정판.md) | **보정된 명세서 본문 및 청구범위(독립 4 + 종속 28)** | **포함** |
| [`03_선행기술_및_신규성.md`](03_선행기술_및_신규성.md) | 선행기술 지형, 신규성 논거, 정식 조사 계획 | 미포함 |
| [`04_출원_실무_체크리스트.md`](04_출원_실무_체크리스트.md) | 잔여 과제, 문서 구성 원칙 | 미포함 |
| `../../sim/results/figures/` | **도면 15종** (흑백 선화, 220 dpi) | **포함** |
| `../../sim/` | 검증 · 시뮬레이션 · 도면 작도 코드 | 소명 자료 |

## 가장 중요한 발견

초안의 **핵심 특징인 불확실도 게이팅이 기재된 수치로는 동작하지 않는다.**

`U_epis`는 [0,1] 확률의 분산이므로 Bhatia–Davis 부등식에 의해 `Var ≤ p(1−p)`이다.
게이트가 평가되는 `P_fail ≥ 0.70`에서 상한은 `0.21`, M=5 이산 헤드의 실제 최대는 `0.135`인데
초안 임계는 `0.25`였다. 60,000 표본 시뮬레이션에서 관측 최대는 `0.0488`,
게이트 발동은 **0건**이었다.

두 번째로 중요한 것은 **감시부가 회로 재구성을 전혀 통제하지 않는다**는 구조적 공백이다.
토크 포락선 제한으로는 비가역 조치가 억제되지 않으므로, QM 등급의 학습 기반 진단부가
ASIL D급 위험 조치를 단독 트리거할 수 있었다. 보정판은 감시부가 학습 모델 없이 산출하는
**재구성 허가 신호(RP)** 를 도입하고 하드웨어 논리곱으로 결합한다.

## 검증 재현

```bash
cd sim
pip install numpy scipy matplotlib && sudo apt-get install -y fonts-nanum
python3 check_numerics.py && python3 run_embodiment.py && python3 make_figures.py
for f in patent_figs/fig_01_04.py patent_figs/fig_06_09.py \
         patent_figs/fig_10.py patent_figs/fig_11_14.py; do python3 "$f"; done
```

## 도면

| 도 | 내용 | 파일 |
|---|---|---|
| 1 | 전체 시스템 블록도 | `fig01_system_block.png` |
| 2 | 보호 계층 구조 및 응답 시간 | `fig02_protection_layers.png` |
| 3 | 상태 전이도 (게이팅 · 유계 체류) | `fig03_state_machine.png` |
| 4 | 진단부 구조 및 불확실도 분해 | `fig04_diagnosis_net.png` |
| 5 | P_fail–U_epis 평면의 게이팅 | `fig05_gating_plane.png` |
| 6 | 분포외 판정 구조 | `fig06_ood_detection.png` |
| 7 | 고장 모드 판별 흐름도 | `fig07_fault_mode_flow.png` |
| 8 | 개방고장 재구성 타이밍 차트 | `fig08_oc_timing.png` |
| 9 | 단락고장 처리 흐름도 | `fig09_sc_flow.png` |
| 10 | 대체 경로 토폴로지 (리던던트 레그 / B4) | `fig10_topology.png` |
| 11 | B4 모드 실시 가능 영역 | `fig11_b4_envelope.png` |
| 12 | 시간 예산 및 비가역 조치 무효화 | `fig12_time_budget.png` |
| 13 | ASIL 분해 및 이중 통제 구조 | `fig13_asil.png` |
| 14 | 디지털 트윈 파이프라인 | `fig14_digital_twin.png` |
| 15 | 시뮬레이션 검증 결과 | `fig15_validation.png` |
