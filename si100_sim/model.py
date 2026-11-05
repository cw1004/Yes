"""SI-100 흡착식 제빙기 사이클 모델 (활성탄 Maxsorb III + 메탄올, 1일 1회 태양열 사이클).

평형(lumped) 열역학 모델이다. 열·물질 전달 속도는 다루지 않으므로
결과는 "이 조건에서 얻을 수 있는 상한"에 가깝다.

흡착 평형은 Dubinin-Astakhov(DA) 식을 쓰고, 계수는 업로드된 도면
VC-400의 Maxsorb III/메탄올 흡착 평형 표(4개 점)에 맞춰 구한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np

R = 8.314          # J/(mol·K)
M_MEOH = 0.03204   # kg/mol
T_CRIT = 512.6     # K, 메탄올 임계 온도

# 도면 VC-400 "ADSORPTION EQUILIBRIUM — DUBININ-ASTAKHOV, METHANOL / MAXSORB III"
# (T_evap 60 °C, 저장조 온도, P/Psat, 흡착량 g/g)
VC400_TABLE = [
    (60.0, 100.0, 0.24, 1.06),
    (60.0, 127.0, 0.11, 0.77),
    (60.0, 169.0, 0.03, 0.42),
]
W0_GG = 1.31  # P/Psat = 1 에서의 포화 흡착량 (도면 값)


def psat_kpa(t_c: float) -> float:
    """메탄올 포화 증기압 [kPa]. NIST Antoine 계수 2구간."""
    t = t_c + 273.15
    if t < 353.5:
        a, b, c = 5.20409, 1581.341, -33.50
    else:
        a, b, c = 5.15853, 1569.613, -34.846
    return 100.0 * 10 ** (a - b / (t + c))


def h_fg(t_c: float) -> float:
    """메탄올 증발 잠열 [kJ/kg]. 끓는점 1,100 kJ/kg 기준 Watson 식."""
    t = t_c + 273.15
    return 1100.0 * ((1 - t / T_CRIT) / (1 - 337.8 / T_CRIT)) ** 0.38


def fit_da() -> tuple[float, float]:
    """도면 표에 DA 식을 최소제곱으로 맞춰 (E [J/mol], n) 을 돌려준다."""
    xs, ys = [], []
    for _, t_res, ratio, w in VC400_TABLE:
        a = R * (t_res + 273.15) * math.log(1 / ratio)
        xs.append(math.log(a))
        ys.append(math.log(math.log(W0_GG / w)))
    n, c = np.polyfit(xs, ys, 1)
    e = math.exp(-c / n)
    return e, n


DA_E, DA_N = fit_da()


def uptake(t_c: float, p_kpa: float) -> float:
    """활성탄 온도 t_c, 압력 p_kpa 에서의 평형 흡착량 [kg/kg]."""
    ratio = min(p_kpa / psat_kpa(t_c), 1.0)
    a = R * (t_c + 273.15) * math.log(1 / ratio)
    return W0_GG * math.exp(-((a / DA_E) ** DA_N))


def q_st(t_c: float, x: float) -> float:
    """흡착열 [kJ/kg]: 증발 잠열 + 흡착 퍼텐셜 (DA 근사)."""
    a = DA_E * math.log(W0_GG / max(x, 1e-6)) ** (1 / DA_N)
    return h_fg(t_c) + a / M_MEOH / 1000


@dataclass(frozen=True)
class Params:
    t_evap: float = -5.0      # 증발기 온도 [°C]
    t_cond: float = 30.0      # 응축기 온도 [°C]
    t_ads: float = 30.0       # 새벽 흡착 종료 시 활성탄 온도 [°C]
    t_gen: float = 100.0      # 낮 최고 탈착 온도 [°C]
    metal_ratio: float = 3.0  # 활성탄 1 kg당 흡착기 금속 질량 [kg]
    cp_metal: float = 0.39    # 금속 비열 [kJ/kgK] (구리)
    cp_ac: float = 0.93       # 활성탄 비열 [kJ/kgK]
    cp_liq: float = 2.53      # 메탄올 액 비열 [kJ/kgK]
    eta_evap: float = 0.70    # 증발기 냉열 중 얼음에 쓰이는 비율 (단열·열침투 손실)
    t_water: float = 25.0     # 넣는 물 온도 [°C]
    insolation: float = 20.0  # 일사량 [MJ/m²·일]
    t_amb_day: float = 30.0   # 낮 평균 외기 [°C]
    eta0: float = 0.75        # 집열기 광학 효율
    u_loss: float = 6.0       # 집열기 열손실 계수 [W/m²K]
    g_avg: float = 700.0      # 낮 평균 일사 강도 [W/m²]


@dataclass(frozen=True)
class Result:
    dx: float            # 1회 사이클 냉매 순환량 [kg/kg AC]
    q_cool: float        # 냉열 [kJ/kg AC]
    q_in: float          # 필요 가열량 [kJ/kg AC]
    cop: float           # 사이클 COP (냉열 / 가열량)
    ice_per_kg: float    # 활성탄 1 kg당 얼음 [kg/일]
    eta_col: float       # 집열 효율
    solar_cop: float     # 냉열 / 일사량
    ac_per_m2: float     # 집열판 1 m²에 넣을 활성탄 [kg]
    ice_per_m2: float    # 집열판 1 m²당 얼음 [kg/일]


ICE_LATENT = 334.0
CP_WATER = 4.19


def simulate(p: Params) -> Result:
    p_e, p_c = psat_kpa(p.t_evap), psat_kpa(p.t_cond)
    x_max = uptake(p.t_ads, p_e)
    x_min = uptake(p.t_gen, p_c)
    dx = max(x_max - x_min, 0.0)

    # 냉열: 증발 잠열에서 응축액(t_cond)을 증발 온도까지 식히는 몫을 뺀다
    q_cool = dx * (h_fg(p.t_evap) - p.cp_liq * (p.t_cond - p.t_evap))

    # 가열량: 등량 가열(압력이 응축 압력에 닿을 때까지) + 등압 탈착
    cp_dry = p.cp_ac + p.metal_ratio * p.cp_metal
    q_in, x, t = 0.0, x_max, p.t_ads
    step = 0.25
    while t < p.t_gen:
        t_next = min(t + step, p.t_gen)
        x_next = min(x, uptake(t_next, p_c))
        q_in += (cp_dry + x * p.cp_liq) * (t_next - t)
        q_in += (x - x_next) * q_st(t_next, 0.5 * (x + x_next))
        t, x = t_next, x_next

    cop = q_cool / q_in if q_in > 0 else 0.0
    ice_heat = CP_WATER * p.t_water + ICE_LATENT
    ice_per_kg = p.eta_evap * q_cool / ice_heat

    # 집열기: 평균 흡착기 온도에서의 효율로 하루 받을 수 있는 열 → 넣을 수 있는 활성탄 양
    t_mean = 0.5 * (p.t_ads + p.t_gen)
    eta_col = max(p.eta0 - p.u_loss * (t_mean - p.t_amb_day) / p.g_avg, 0.0)
    heat_m2 = p.insolation * 1000 * eta_col          # kJ/m²·일
    ac_per_m2 = heat_m2 / q_in if q_in > 0 else 0.0
    ice_per_m2 = ac_per_m2 * ice_per_kg
    solar_cop = ac_per_m2 * q_cool / (p.insolation * 1000)

    return Result(dx, q_cool, q_in, cop, ice_per_kg, eta_col, solar_cop,
                  ac_per_m2, ice_per_m2)


BASE = Params()


def with_(**kw) -> Params:
    return replace(BASE, **kw)
