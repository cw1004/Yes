"""VC-100 Rev B 설계값. 도면의 숫자는 모두 여기서 나온다 (Rev A 값은 원본 도면 VC-100 세트)."""

from __future__ import annotations

from vc100_sim import model as M

# ── Rev A (원본 도면) ───────────────────────────────────────
A = M.BASE_A
A_FIN_STACK_G = 88.1
A_WICK_G = 9.6
A_WICK_VOID_ML = 1.51
A_CHARGE_ML = 1.90
A_MASS_A_G = 218.0
A_CASE_RTH = 0.25          # 합격 기준 (case-to-case, 50 W)

# ── Rev B 변경 ───────────────────────────────────────────────
B = M.with_(A, pitch=2.0e-3, t_fin=0.3e-3, tim2="solder", wick_a=0.30e-3)
FIN_BASE_T = 2.0e-3
WICK_A_THK = B.wick_a * 1e3            # 0.30
VAPOUR_CORE = 3.0 - WICK_A_THK - 0.20  # 포켓 3.0 − 바닥 윅 − 뚜껑 윅
ZONE_A_AREA_MM2 = 60 * 60 - (4 - 3.1416) * 9 - 100 * 3.1416  # 포켓 바닥 − 모서리 R3 − 기둥 100개
POROSITY = 0.55

d_void = ZONE_A_AREA_MM2 * (0.40 - WICK_A_THK) * POROSITY / 1000       # mL
WICK_VOID_ML = A_WICK_VOID_ML - d_void
CHARGE_ML = round(WICK_VOID_ML * 1.25, 2)
WICK_G = A_WICK_G - ZONE_A_AREA_MM2 * (0.40 - WICK_A_THK) * (1 - POROSITY) * 8.96 / 1000

fins_mm3 = B.n_fins * B.t_fin * B.h_fin * M.L_FLOW * 1e9
FIN_STACK_G = (fins_mm3 + 68 * 68 * FIN_BASE_T * 1e3) * 2.71e-3
SOLDER_G = 68 * 68 * 0.1 * 7.3e-3
MASS_G = A_MASS_A_G - A_FIN_STACK_G - 0.4 + FIN_STACK_G + SOLDER_G - (A_WICK_G - WICK_G) \
    - (A_CHARGE_ML - CHARGE_ML)

R_INT = M.r_internal(B)
R_INT_A = M.r_internal(A)
CASE_RTH = round(A_CASE_RTH - (R_INT_A - R_INT), 2)   # 개선된 내부 저항만큼 합격 기준 강화
CAP_LIMIT = M.capillary_limit(B)

# 성능: Rev A 의 1/2/4 m/s 와 같은 팬 전력
PERF = []
for v in (1.0, 2.0, 4.0):
    ra = M.q_forced(A, v)
    vb = M.v_for_fan_power(B, ra["fan_w"])
    rb = M.q_forced(B, vb)
    rb85 = (85 - 25) / rb["r_total"]
    PERF.append({"v_a": v, "fan_mw": ra["fan_w"] * 1e3, "q_a": ra["q"], "r_a": ra["r_total"],
                 "v_b": vb, "q_b": rb["q"], "r_b": rb["r_total"], "q_b85": rb85, "dp_a": ra["dp"],
                 "dp_b": rb["dp"], "r_sink_b": rb["r_sink"]})

NET_B = [("DIE", "—"), ("TIM", "0.025"), ("Cu FLOOR", "0.006"), ("EVAP", f"{M.R_EVAP_040 * WICK_A_THK / 0.40:.3f}"),
         ("VAPOUR", "0.004"), ("COND", "0.012"), ("LID+SPRD", "0.036"), ("SOLDER", "0.002"),
         ("FIN→AIR", f"{PERF[1]['r_sink_b']:.3f}"), ("AIR", "25 C")]


def summary():
    p = PERF[1]
    return (f"Rev B: {B.n_fins}핀 {B.pitch * 1e3:.1f}피치 t{B.t_fin * 1e3:.1f}, 윅A {WICK_A_THK:.2f}, 증기층 {VAPOUR_CORE:.2f}, "
            f"윅 공극 {WICK_VOID_ML:.2f} mL, 충전 {CHARGE_ML:.2f} mL, 윅 {WICK_G:.1f} g, 핀스택 {FIN_STACK_G:.1f} g, "
            f"총 {MASS_G:.0f} g, R내부 {R_INT:.3f}, 합격 {CASE_RTH:.2f} K/W, 모세관 {CAP_LIMIT:.0f} W, "
            f"2 m/s 동등: {p['q_a']:.1f} → {p['q_b']:.1f} W (R {p['r_b']:.3f})")


if __name__ == "__main__":
    print(summary())
    for p in PERF:
        print({k: round(v, 3) for k, v in p.items()})
