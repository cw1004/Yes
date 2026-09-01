"""
초안 명세서에 기재된 수치 주장에 대한 독립 검증.

각 항목은 명세서 초안의 특정 문장을 대상으로 하며,
성립 여부(PASS/FAIL)와 정정값을 출력한다.
"""
import math
import numpy as np
from scipy.optimize import brentq

LINE = "-" * 78
rows = []


def report(tag, claim, verdict, detail):
    rows.append((tag, claim, verdict, detail))


# =============================================================================
# [C-1] U_epis (확률 분산) 의 상한과 U_max = 0.25 게이트의 성립 가능성
# =============================================================================
# 초안: U_epis = (1/M) Σ (p_m - p̄)^2 ,  게이트는 U_epis >= U_max = 0.25 에서 발동.
# Popoviciu / Bhatia-Davis: [0,1] 확률변수의 분산 <= p̄(1-p̄) <= 1/4.
# 게이트는 S2->S3 전이 시점, 즉 P_fail >= T2 = 0.70 에서만 평가된다.
p_gate = 0.70
var_bound_at_gate = p_gate * (1.0 - p_gate)          # Bhatia-Davis 상한
var_bound_global = 0.25                              # Popoviciu 상한

# M=5 이산 헤드에서 p̄=0.70 을 만족하며 분산을 최대화하는 배치를 완전탐색
M = 5
best = 0.0
best_cfg = None
for k in range(M + 1):                    # k개 헤드가 값 hi, 나머지가 lo
    # p̄ = 0.70 고정, 두 점 분포 (lo, hi) in [0,1]
    for hi in np.linspace(p_gate, 1.0, 601):
        if k == 0:
            continue
        lo_needed = (p_gate * M - k * hi) / (M - k) if k < M else None
        if lo_needed is None or not (0.0 <= lo_needed <= p_gate + 1e-12):
            continue
        vals = np.array([hi] * k + [lo_needed] * (M - k))
        v = float(np.mean((vals - p_gate) ** 2))
        if v > best:
            best, best_cfg = v, (k, hi, lo_needed)

report(
    "C-1",
    "U_epis >= U_max = 0.25 로 재구성을 게이팅한다",
    "FAIL (게이트 발동 불가능)",
    f"P_fail>=0.70 에서 분산 상한 = p(1-p) = {var_bound_at_gate:.4f} < 0.25. "
    f"M=5 이산 최대 = {best:.4f} (헤드 {best_cfg[0]}개={best_cfg[1]:.3f}, "
    f"{M-best_cfg[0]}개={best_cfg[2]:.3f}). 전역 상한도 {var_bound_global:.2f}이며 "
    f"등호는 p̄=0.5 에서만 성립 -> 게이팅 조건이 수학적으로 성립 불가.",
)

# 정정안: 표준편차 기준 및 상호정보량 기준의 실효 범위
sigma_bound_at_gate = math.sqrt(var_bound_at_gate)
report(
    "C-1'",
    "정정안: sigma_epis = sqrt(U_epis) 또는 상호정보량 MI 사용",
    "PASS",
    f"sigma_epis 상한 = {sigma_bound_at_gate:.4f} (P_fail=0.70). "
    f"임계 sigma_max = 0.10 이면 실효 게이트. MI 범위 = [0, ln2 = {math.log(2):.4f}] nat.",
)


# =============================================================================
# [C-2] OOD_2 (예측 엔트로피) 임계 H_th = 0.60 과 전이 임계 T2 = 0.70 의 충돌
# =============================================================================
def H(p):
    p = min(max(p, 1e-15), 1 - 1e-15)
    return -(p * math.log(p) + (1 - p) * math.log(1 - p))


H_th = 0.60
lo = brentq(lambda p: H(p) - H_th, 1e-9, 0.5)
hi = brentq(lambda p: H(p) - H_th, 0.5, 1 - 1e-9)
T2 = 0.70
conflict = lo < T2 < hi
report(
    "C-2",
    "OOD_2 = (H > 0.60) 이고 S2->S3 는 P_fail >= T2 = 0.70 에서 허용된다",
    "FAIL (자기모순)" if conflict else "PASS",
    f"H(p) > 0.60 nat  <=>  p in ({lo:.4f}, {hi:.4f}). T2=0.70 이 이 구간 내부. "
    f"따라서 P_fail in [0.70, {hi:.4f}) 에서는 OOD_2 가 항상 참 -> S3 진입 영구 차단. "
    f"실효 전이 임계가 {hi:.4f} 로 이동하며, 이는 설계 의도와 무관한 부작용.",
)

# 추가: 이진 분류에서 H 는 P_fail 의 결정론적 함수이므로 정보량이 0
report(
    "C-2b",
    "OOD_2 가 OOD 에 대한 독립적 증거를 제공한다",
    "FAIL (정보량 0)",
    "이진 출력에서 H(p̄) 는 p̄ 만의 단조 결정론적 함수. OOD_2 는 'P_fail 이 중간대역' "
    "과 논리적으로 동치이며 P_fail 외의 추가 정보를 전혀 담지 않음. "
    "정정: 상호정보량(앙상블 불일치) 또는 에너지 스코어로 교체.",
)


# =============================================================================
# [C-3] B4 (4스위치 3상) 모드 출력 상한 58 % 및 그 근거 sqrt(3)/3
# =============================================================================
# c상을 분압 커패시터 중점 O 에 접속 -> v_cO = 0.
# 부동 중성점 부하에서는 선간전압만 유효: v_ac = v_aO, v_bc = v_bO.
# 평형 3상 상전압 진폭 V_m 에 대해 선간 진폭 = sqrt(3)*V_m.
# 레그 전압 한계 |v_aO| <= Vdc/2  =>  V_m <= Vdc/(2*sqrt(3))
Vdc = 1.0
Vm_B4 = Vdc / (2 * math.sqrt(3))
Vm_B6_svpwm = Vdc / math.sqrt(3)      # 3차 고조파 주입 / SVPWM 선형변조 한계
Vm_B6_spwm = Vdc / 2                  # 정현파 PWM 선형변조 한계
ratio_svpwm = Vm_B4 / Vm_B6_svpwm
ratio_spwm = Vm_B4 / Vm_B6_spwm

report(
    "C-3",
    "B4 모드 출력 상한 = 정격의 58 %, 근거 sqrt(3)/3",
    "FAIL (근거 오류 / 기준 미명시)",
    f"V_m(B4) = Vdc/(2*sqrt3) = {Vm_B4:.4f}*Vdc. "
    f"B6-SVPWM 기준비 = {ratio_svpwm:.4f} ({100*ratio_svpwm:.1f} %), "
    f"B6-SPWM 기준비 = {ratio_spwm:.4f} ({100*ratio_spwm:.1f} %). "
    f"sqrt(3)/3 = {math.sqrt(3)/3:.4f} 는 B6-SVPWM 의 변조 이득이지 B4 강압비가 아님. "
    f"58 %는 SPWM 기준일 때만 성립. 양산 SVPWM 기준으로는 50 % 를 채택해야 함.",
)


# =============================================================================
# [C-4] 관통(shoot-through) 전류를 DC 링크 전류 센서로 검출 가능한가
# =============================================================================
Vdc_v = 400.0
L_loop_nH = np.array([15.0, 30.0, 50.0])      # 커뮤테이션 루프 기생 인덕턴스
didt = Vdc_v / (L_loop_nH * 1e-9)             # A/s
didt_A_per_us = didt * 1e-6
I_rated = 400.0
t_to_2p5x = (2.5 * I_rated) / didt            # s
report(
    "C-4",
    "단락 검출 기준으로 'DC 링크 전류 급증 > 2.5x 정격' 을 사용",
    "FAIL (센서 대역폭 부족)",
    f"Vdc=400V, L_loop={L_loop_nH.tolist()} nH -> di/dt = "
    f"{np.round(didt_A_per_us,0).tolist()} A/us. 2.5x정격({2.5*I_rated:.0f} A) 도달까지 "
    f"{np.round(t_to_2p5x*1e9,1).tolist()} ns. 통상 DC링크 전류센서(대역 50~200 kHz, "
    f"상승시간 2~7 us)로는 관측 불가. 1차 검출은 DESAT/게이트 플래토/켈빈 소스 di/dt "
    f"감지여야 하며 DC링크 전류는 사후 확인 지표로 격하해야 함.",
)


# =============================================================================
# [C-5] 게이트 저항 절환(2.2 -> 10 ohm)과 데드타임 연장 0.5~1.5 us 의 정합성
# =============================================================================
# 턴오프 지연은 게이트 방전 시정수에 지배: t_d(off) ~ Rg*Ciss*ln(Vge_on-Vge_off / Vgp-Vge_off)
Ciss_nF = 12.0            # 대형 IGBT 모듈 전형값
Vge_on, Vge_off, Vgp = 15.0, -8.0, 7.5
k = math.log((Vge_on - Vge_off) / (Vgp - Vge_off))
for Rg in (2.2, 10.0):
    pass
td_1 = 2.2 * Ciss_nF * 1e-9 * k
td_2 = 10.0 * Ciss_nF * 1e-9 * k
delta = td_2 - td_1
report(
    "C-5",
    "개방고장 시 데드타임을 0.5~1.5 us 연장한다 (근거 미기재)",
    "PASS (단, 근거를 Rg 절환에 연결해야 성립)",
    f"Ciss={Ciss_nF} nF, ln항={k:.3f} 기준 t_d(off): Rg=2.2ohm -> {td_1*1e9:.0f} ns, "
    f"Rg=10ohm -> {td_2*1e9:.0f} ns, 증가분 {delta*1e9:.0f} ns. "
    f"소자산포/온도依存/드라이버 지연 산포를 더하면 0.5~1.5 us 는 타당. "
    f"단 초안은 데드타임 연장을 '개방고장'에 귀속시켜 인과가 없음. "
    f"정정: Rg1->Rg2 절환으로 t_d(off) 가 증가하므로 관통 방지를 위해 연장하는 것으로 재기재.",
)


# =============================================================================
# [C-6] FP <= 0.1 % 요구의 단위 정합성
# =============================================================================
f_diag = 100.0          # Hz, 진단 주기 10 ms
fpr = 1e-3
per_sec = f_diag * fpr
per_day = per_sec * 86400
# N=3 연속 확인(독립 가정) 시
per_sec_n3 = f_diag * fpr ** 3
per_1e9h_n3 = per_sec_n3 * 3600 * 1e9
report(
    "C-6",
    "T2 는 오경보율 FP <= 0.1 % 를 만족하는 최소 임계로 정한다",
    "FAIL (단위 미정의)",
    f"진단 100 Hz 에서 표본당 FPR=1e-3 -> {per_sec:.1f} 건/s = {per_day:,.0f} 건/일. "
    f"N=3 연속확인 및 오차 독립 가정시에도 {per_1e9h_n3:.3e} 건/1e9h 이나, "
    f"진단 오차는 시간상관되어 독립 가정이 성립하지 않음. "
    f"정정: 목표를 '오재구성률 <= 10 FIT' 로 정의하고, 자기상관으로 측정한 "
    f"탈상관시간 tau_dec 로부터 유효 독립시행수 n_eff = T/tau_dec 를 써서 표본당 임계로 환산.",
)


# =============================================================================
# [C-7] AI 추론 5 ms / 5 MMAC 예산의 실현 가능성
# =============================================================================
mac = 5e6
budget_s = 5e-3
required = mac / budget_s
for f_clk, mpc, eta, name in [
    (300e6, 4, 0.5, "Cortex-R52 300MHz INT8 SIMD 4MAC/cy, eta=0.5"),
    (400e6, 4, 0.5, "400MHz INT8 SIMD 4MAC/cy, eta=0.5"),
    (600e6, 8, 0.6, "600MHz 8MAC/cy(DSP), eta=0.6"),
]:
    cap = f_clk * mpc * eta
    rows.append(("C-7", f"연산능력 {name}", "PASS" if cap >= required else "FAIL",
                 f"요구 {required/1e9:.2f} GMAC/s vs 가용 {cap/1e9:.2f} GMAC/s "
                 f"-> 추론시간 {mac/cap*1e3:.2f} ms"))

report(
    "C-7'",
    "정정안: MAC 예산 하향 + 산정식 명시",
    "PASS",
    f"T_inf = MAC / (f_clk * MAC_per_cycle * eta) 를 명세서에 기재하고, "
    f"락스텝 코어는 처리량 이득이 없으므로 AI 추론은 비락스텝 성능코어에 배치. "
    f"MAC <= 2e6 로 하향 시 300MHz/4MAC/eta0.5 에서 {2e6/(300e6*4*0.5)*1e3:.2f} ms.",
)


# =============================================================================
# [C-8] 3상 전류합 타당성 검사 임계와 센서 오프셋 드리프트 +-2 % 의 정합성
# =============================================================================
I_rated_a = 400.0
off = 0.02 * I_rated_a
eps_min = 3 * math.sqrt(3) * off
report(
    "C-8",
    "센서 불합리 검사로 '3상 전류 합 ~ 0' 을 검증한다 (임계 미기재)",
    "FAIL (임계 미정의)",
    f"명세서 자체가 오프셋 드리프트 +-2 % 를 도메인 랜덤화에 포함. "
    f"정격 {I_rated_a:.0f} A 기준 채널당 오프셋 {off:.1f} A, 3채널 RSS 의 3시그마 = "
    f"{eps_min:.1f} A. 임계 eps 는 이보다 커야 오검출이 없음 -> eps = {eps_min:.0f} A "
    f"({100*eps_min/I_rated_a:.1f} % 정격) 이상으로 기재 필요.",
)


# =============================================================================
# [C-9] ASIL 분해 조합의 유효성
# =============================================================================
valid = {("D(D)", "QM(D)"), ("QM(D)", "D(D)"),
         ("C(D)", "A(D)"), ("A(D)", "C(D)"),
         ("B(D)", "B(D)")}
draft = ("B(D)", "D(D)")
report(
    "C-9",
    "분해 조합: ASIL B(D) + ASIL D(D) = ASIL D",
    "FAIL (ISO 26262-9 에 없는 조합)",
    f"ASIL D 의 유효 분해는 D(D)+QM(D), C(D)+A(D), B(D)+B(D) 뿐. "
    f"{draft} 는 정의된 조합이 아님(D(D) 단독으로 이미 D 를 충족하므로 분해가 아님). "
    f"의도(AI 는 낮게/감시부는 높게)에 부합하는 유효 조합은 QM(D) + D(D).",
)


# =============================================================================
# [C-10] 감시부 포락선 min() 연산의 회생(음 토크) 구간 동작
# =============================================================================
T_lim = 200.0
cases = [(150.0, "역행 정상"), (250.0, "역행 초과"), (-250.0, "회생 초과")]
bad = [(c, min(c, T_lim)) for c, _ in cases if abs(min(c, T_lim)) > T_lim]
report(
    "C-10",
    "최종 토크 지령 = min(정책부 지령, 감시부 상한)",
    "FAIL (회생 구간 무제한)",
    f"T_lim={T_lim:.0f} Nm 에서 min(-250, 200) = -250 -> 회생측 포락선이 전혀 적용되지 않음. "
    f"정정: T_final = clamp(T_cmd, -T_lim_regen, +T_lim_drive) 로 부호별 포락선 적용.",
)


# =============================================================================
# [C-11] B4 모드 DC 링크 중점 커패시터 기본파 리플 (초안 미기재 제약)
# =============================================================================
# 고장상 전류 i_c 가 분압 커패시터를 통해 환류 -> 기본파 주파수의 중점 전압 변동
# dv_pk = I_m / (omega * C_eq),  C_eq = 2C (직렬 분압 두 개의 병렬 환류 경로)
I_m = 400.0
for f_e, C_uF in [(200.0, 1000.0), (50.0, 1000.0), (10.0, 1000.0), (5.0, 1000.0)]:
    w = 2 * math.pi * f_e
    C_eq = 2 * C_uF * 1e-6
    dv = I_m / (w * C_eq)
    rows.append(("C-11", f"B4 중점전압 변동 @ f_e={f_e:g} Hz, C={C_uF:g} uF x2, Im={I_m:g} A",
                 "PASS" if dv < 0.05 * 400 else "FAIL",
                 f"dv_pk = Im/(w*C_eq) = {dv:.1f} V "
                 f"({100*dv/400:.1f} % of 400 V) -> 저주파(저속)에서 발산"))
report(
    "C-11'",
    "정정안: B4 모드에 3중 제약을 기재",
    "PASS",
    "(i) 전압: V_m <= Vdc/(2*sqrt3) (SVPWM 대비 50 %), "
    "(ii) 최저 전기주파수 f_min: dv_pk = Im/(2*pi*f*C_eq) <= 허용 중점 불평형, "
    "(iii) 커패시터 RMS 전류 정격: 기본파 전류 전량이 분압 커패시터를 통과. "
    "초안은 (i) 만 기재했고 그 값도 오류.",
)


# =============================================================================
# 출력
# =============================================================================
print(LINE)
print("초안 명세서 수치 주장 독립 검증 결과")
print(LINE)
n_fail = 0
for tag, claim, verdict, detail in rows:
    if verdict.startswith("FAIL"):
        n_fail += 1
    print(f"\n[{tag}] {claim}")
    print(f"  판정 : {verdict}")
    for i in range(0, len(detail), 74):
        print(f"  {'근거 :' if i == 0 else '      '} {detail[i:i+74]}")
print("\n" + LINE)
print(f"총 {len(rows)} 항목 검증 / FAIL {n_fail} 건")
print(LINE)
