"""SI-100 시제품(집열판 1 m²) 설계값. 도면의 모든 숫자는 여기서 나온다.

성능은 si100_sim 평형 모델로 계산한 상한값이며, 설계 목표는 상한의 약 78 %로 잡는다.
"""

from __future__ import annotations

import math

from si100_sim.model import h_fg, psat_kpa, simulate, uptake, with_

# ── 운전 조건 (설계점) ─────────────────────────────────────────
T_EVAP = -5.0
T_COND = 30.0
T_ADS = 25.0          # 새벽 흡착 종료 (야간 댐퍼 냉각)
T_GEN = 100.0         # 낮 최고 탈착 온도 (메탄올 분해 120 °C 아래로 여유)
T_WATER = 15.0        # 급수 온도 (밤새 보관한 물)
INSOLATION = 20.0     # MJ/m²·일
PARAMS = with_(t_evap=T_EVAP, t_cond=T_COND, t_ads=T_ADS, t_gen=T_GEN, t_water=T_WATER,
               eta_evap=0.85, u_loss=3.5, metal_ratio=1.6, insolation=INSOLATION)

# ── 흡착관 ─────────────────────────────────────────────────────
N_TUBES = 18
TUBE_PITCH = 55.0
TUBE_OD, TUBE_T = 50.8, 0.8           # SUS304 2" 박판관
TUBE_ID = TUBE_OD - 2 * TUBE_T
TUBE_ACTIVE = 1000.0                   # 흡착제 충전 길이
CAP_T = 1.5                            # 끝판 두께
CORE_OD = 16.0                         # 증기 통로 금속망 관
RING_OD, RING_ID, RING_L = 49.0, 16.5, 100.0
RINGS_PER_TUBE = int(TUBE_ACTIVE / RING_L)
CARBON_DENSITY = 0.50                  # g/cm³ (활성탄 기준, 블록 내)
ENG_FRACTION = 0.10                    # 팽창 흑연 질량비 (활성탄 대비)

RING_CARBON_G = math.pi / 4 * ((RING_OD / 10) ** 2 - (RING_ID / 10) ** 2) * (RING_L / 10) * CARBON_DENSITY
TUBE_CARBON_KG = RING_CARBON_G * RINGS_PER_TUBE / 1000
CARBON_KG = TUBE_CARBON_KG * N_TUBES
ENG_KG = CARBON_KG * ENG_FRACTION

TUBE_STEEL_KG = math.pi * TUBE_OD * TUBE_T * (TUBE_ACTIVE + 40) * 7.9e-6
METAL_KG = N_TUBES * (TUBE_STEEL_KG + 0.15) + 2.6   # 끝판·금속망 0.15 kg/관, 헤더·스텁 2.6 kg

# ── 집열기 ─────────────────────────────────────────────────────
APERTURE = 1000.0
FRAME_W, FRAME_H, FRAME_D = 1100.0, 1150.0, 170.0
TILT_DEG = 30.0
HEADER_OD, HEADER_T = 42.4, 1.5

# ── 사이클 결과 ───────────────────────────────────────────────
X_MAX = uptake(T_ADS, psat_kpa(T_EVAP))
X_MIN = uptake(T_GEN, psat_kpa(T_COND))
RES = simulate(PARAMS)
CYCLED_KG = (X_MAX - X_MIN) * CARBON_KG
CYCLED_L = CYCLED_KG / 0.791
HEEL_KG = 0.4
CHARGE_KG = X_MAX * CARBON_KG + HEEL_KG
ICE_UPPER_KG = RES.ice_per_kg * CARBON_KG
ICE_TARGET_KG = 10.0
HEAT_NEED_MJ = RES.q_in * CARBON_KG / 1000
HEAT_AVAIL_MJ = INSOLATION * RES.eta_col * (APERTURE / 1000) ** 2

# ── 응축기 ─────────────────────────────────────────────────────
COND_Q_MJ = CYCLED_KG * h_fg(T_COND) / 1000
COND_HOURS = 5.0
COND_Q_AVG_W = COND_Q_MJ * 1e6 / (COND_HOURS * 3600)
COND_Q_PEAK_W = 600.0
COND_PASSES, COND_PASS_L, COND_PASS_PITCH = 10, 900.0, 40.0
COND_TUBE_OD, COND_TUBE_T = 15.88, 0.8
# 연속 판핀(라디에이터형): 통로 10개를 한 장으로 관통, 세로로 세워 자연대류
FIN_DEPTH, FIN_HEIGHT, FIN_T, FIN_PITCH = 80.0, 420.0, 0.3, 6.0
FINS = int(COND_PASS_L / FIN_PITCH)
COND_AREA_M2 = FINS * 2 * (FIN_DEPTH * FIN_HEIGHT - COND_PASSES * math.pi / 4 * COND_TUBE_OD ** 2) / 1e6 \
    + math.pi * COND_TUBE_OD * COND_PASS_L * COND_PASSES / 1e6
COND_DT_K = COND_Q_PEAK_W / (7.0 * COND_AREA_M2)

# ── 수액기 ─────────────────────────────────────────────────────
REC_OD, REC_T, REC_H = 219.1, 2.0, 300.0
REC_L = math.pi / 4 * ((REC_OD - 2 * REC_T) / 100) ** 2 * (REC_H / 100)
REC_MM_PER_L = 1 / (math.pi / 4 * ((REC_OD - 2 * REC_T) / 100) ** 2) * 100  # mm/L

# ── 증발기·제빙함 ─────────────────────────────────────────────
EVAP_W, EVAP_H, EVAP_D, EVAP_T = 600.0, 400.0, 50.0, 2.0
EVAP_L = (EVAP_W - 2 * EVAP_T) * (EVAP_H - 2 * EVAP_T) * (EVAP_D - 2 * EVAP_T) / 1e6
STAY_D, STAY_PITCH = 8.0, 60.0
STAYS_X, STAYS_Y = 9, 6
MOLD_W, MOLD_H, MOLD_D = 560.0, 380.0, 25.0
MOLD_L = MOLD_W * MOLD_H * MOLD_D / 1e6
BOX_IN_W, BOX_IN_D, BOX_IN_H = 700.0, 300.0, 560.0
BOX_WALL = 100.0

# ── 배관 ──────────────────────────────────────────────────────
VAPOR_NIGHT = "1\" (25.4 × 1.2)"
VAPOR_DAY = "3/4\" (19.05 × 1.0)"
LIQUID = "1/4\" (6.35 × 0.9)"
RELIEF_KPA_ABS = 200

P_EVAP_KPA = psat_kpa(T_EVAP)
P_COND_KPA = psat_kpa(T_COND)


def summary() -> str:
    return (f"활성탄 {CARBON_KG:.2f} kg, 금속 {METAL_KG:.1f} kg (비 {METAL_KG / CARBON_KG:.2f}), "
            f"Δx {X_MAX - X_MIN:.3f}, 순환 {CYCLED_KG:.2f} kg ({CYCLED_L:.1f} L), 충전 {CHARGE_KG:.1f} kg, "
            f"얼음 상한 {ICE_UPPER_KG:.1f} kg, 필요열 {HEAT_NEED_MJ:.1f} / 가용 {HEAT_AVAIL_MJ:.1f} MJ, "
            f"응축 {COND_Q_MJ:.1f} MJ 평균 {COND_Q_AVG_W:.0f} W, 응축 면적 {COND_AREA_M2:.1f} m² ΔT {COND_DT_K:.1f} K, "
            f"수액기 {REC_L:.1f} L, 증발기 {EVAP_L:.1f} L, 몰드 {MOLD_L:.2f} L ×2")


if __name__ == "__main__":
    print(summary())
