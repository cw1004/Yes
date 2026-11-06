"""VC-100 베이퍼 챔버 + 핀 스택 열 모델.

- 내부 열저항: 도면 VC-100 '열저항 네트워크' 값(접합부→핀 바닥 0.194 K/W)을 기준으로,
  설계 변수(증발부 윅 두께, 핀–뚜껑 접합 방식)에 비례해 바꾼다.
- 강제 대류 핀: Teertstra 평판 핀 모델(입구 공기 온도 기준, 공기 온도 상승 포함)
  + 핀 효율 + Muzychka–Yovanovich 압력 손실.
- 자연 대류 핀: Bar-Cohen–Rohsenow 수직 평판 채널 + 외곽 복사.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

SIGMA = 5.670e-8
G = 9.81

# 도면 VC-100 열저항 네트워크 (K/W, 20×20 다이, 2 m/s)
R_TIM1 = 0.025      # 다이–챔버 (고객 측 TIM)
R_FLOOR = 0.006     # 구리 바닥
R_EVAP_040 = 0.100  # 증발부 윅 0.40 mm
R_VAPOUR = 0.004
R_COND = 0.012
R_LID_SPRD = 0.036  # 뚜껑 + 핀 바닥 확산
R_TIM2_PAD = 0.011  # 0.2 mm PCM 패드 (뚜껑–핀 바닥)

# 도면 VC-103 모세관 압력 예산 (수직, 최악 조건)
DP_CAP = 10508.0    # Pa
DP_GRAV = 656.0
DP_VAPOUR_PER_W = 0.2
DP_LIQ_PER_W_040 = 12.6

W_FINS = 64.0e-3    # 핀이 차지하는 폭 (43핀 @1.5 피치 = 63.4 mm)
L_FLOW = 68.0e-3    # 공기 흐름 방향 길이
A_ENVELOPE = 0.068 * 0.068 + 4 * 0.068 * 0.027  # 외곽 복사 면적 (윗면 + 옆면), m²


def air(t_c: float) -> dict:
    t = t_c + 273.15
    return {"rho": 101325 / (287.05 * t), "cp": 1007.0,
            "k": 0.0241 + 7.6e-5 * t_c, "mu": 1.716e-5 * (t / 273.15) ** 1.5 * (383.55 / (t + 110.4)),
            "pr": 0.71}


@dataclass(frozen=True)
class Design:
    pitch: float = 1.5e-3       # 핀 피치
    t_fin: float = 0.4e-3       # 핀 두께
    h_fin: float = 20.0e-3      # 핀 높이
    k_fin: float = 218.0        # Al 1100 (Cu C1100 = 390)
    wick_a: float = 0.40e-3     # 증발부(존 A) 윅 두께
    tim2: str = "pad"           # "pad" 0.2 PCM / "thin" 0.1 PCM / "solder" 납땜 접합
    eps: float = 0.85           # 핀 표면 방사율 (양극산화)

    @property
    def n_fins(self) -> int:
        return int((W_FINS - self.t_fin) / self.pitch + 1e-9) + 1

    @property
    def gap(self) -> float:
        return self.pitch - self.t_fin


BASE_A = Design()
BASE_B = Design(pitch=5.0e-3, t_fin=1.0e-3)


def r_internal(d: Design) -> float:
    tim2 = {"pad": R_TIM2_PAD, "thin": R_TIM2_PAD / 2, "solder": 0.002}[d.tim2]
    return R_TIM1 + R_FLOOR + R_EVAP_040 * d.wick_a / 0.40e-3 + R_VAPOUR + R_COND + R_LID_SPRD + tim2


def capillary_limit(d: Design) -> float:
    """수직 최악 조건 모세관 한계 [W]. 액 손실은 존 A 윅 두께에 반비례로 근사."""
    per_w = DP_LIQ_PER_W_040 * 0.40e-3 / d.wick_a + DP_VAPOUR_PER_W
    return (DP_CAP - DP_GRAV) / per_w


def fin_eff(h: float, d: Design) -> float:
    m = math.sqrt(2 * h / (d.k_fin * d.t_fin))
    mh = m * d.h_fin
    return math.tanh(mh) / mh if mh > 0 else 1.0


# ── 강제 대류 ───────────────────────────────────────────────
def forced(d: Design, v_ch: float, t_air: float = 25.0) -> dict:
    """채널 속 풍속 v_ch [m/s] 에서 핀 열저항(입구 공기 기준)과 압력 손실."""
    a = air(t_air + 10)
    nu = a["mu"] / a["rho"]
    b = d.gap
    re_b = v_ch * b / nu
    re_s = re_b * b / L_FLOW
    nu_b = ((re_s * a["pr"] / 2) ** -3
            + (0.664 * math.sqrt(re_s) * a["pr"] ** (1 / 3) * math.sqrt(1 + 3.65 / math.sqrt(re_s))) ** -3) ** (-1 / 3)
    h = nu_b * a["k"] / b
    n = d.n_fins
    a_fin = 2 * d.h_fin * L_FLOW * n
    a_base = (n - 1) * b * L_FLOW
    ua = h * (a_fin * fin_eff(h, d) + a_base)
    # 압력 손실 (평행 평판, 발달 유동)
    dh = 2 * b
    re = v_ch * dh / nu
    lplus = L_FLOW / (dh * re)
    f_app = math.sqrt((3.44 / math.sqrt(lplus)) ** 2 + 24 ** 2) / re
    sig = b / d.pitch
    kc, ke = 0.42 * (1 - sig ** 2), (1 - sig) ** 2
    dp = (kc + ke + 4 * f_app * L_FLOW / dh) * a["rho"] * v_ch ** 2 / 2
    flow = v_ch * b * d.h_fin * (n - 1)
    return {"r_sink": 1 / ua, "h": h, "dp": dp, "flow": flow, "fan_w": flow * dp}


def q_forced(d: Design, v_ch: float, tj: float = 100.0, t_air: float = 25.0) -> dict:
    f = forced(d, v_ch, t_air)
    r = r_internal(d) + f["r_sink"]
    return {**f, "r_total": r, "q": (tj - t_air) / r, "r_int": r_internal(d)}


def v_for_flow(d: Design, flow: float) -> float:
    """같은 풍량(덕트, 팬 동일)일 때 채널 풍속."""
    return flow / (d.gap * d.h_fin * (d.n_fins - 1))


def v_for_fan_power(d: Design, power: float) -> float:
    lo, hi = 0.05, 30.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if forced(d, mid)["fan_w"] < power:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ── 자연 대류 (핀 세로) ─────────────────────────────────────
C_NAT = 1.0  # 도면 값에 맞춰 calibrate_natural() 이 정한다


def natural_q(d: Design, t_base: float, t_amb: float) -> tuple[float, float]:
    """핀 바닥 온도 t_base 에서 (대류 W, 복사 W)."""
    dt = t_base - t_amb
    if dt <= 0:
        return 0.0, 0.0
    tf = (t_base + t_amb) / 2
    a = air(tf)
    nu = a["mu"] / a["rho"]
    alpha = nu / a["pr"]
    beta = 1 / (tf + 273.15)
    s = d.gap
    el = G * beta * dt * s ** 4 / (nu * alpha * L_FLOW)
    nu_s = (576 / el ** 2 + 2.873 / el ** 0.5) ** -0.5
    h = C_NAT * nu_s * a["k"] / s
    n = d.n_fins
    a_fin = 2 * d.h_fin * L_FLOW * n
    a_base = (n - 1) * s * L_FLOW
    q_conv = h * (a_fin * fin_eff(h, d) + a_base) * dt
    tb, ta = t_base + 273.15, t_amb + 273.15
    q_rad = d.eps * SIGMA * A_ENVELOPE * (tb ** 4 - ta ** 4)
    return q_conv, q_rad


def q_natural(d: Design, tj: float = 85.0, t_amb: float = 25.0) -> dict:
    """접합부 tj 를 지키는 최대 열량 (핀 바닥 온도를 풀어서)."""
    r_int = r_internal(d)
    lo, hi = t_amb, tj
    for _ in range(60):
        tb = 0.5 * (lo + hi)
        qc, qr = natural_q(d, tb, t_amb)
        if tb + (qc + qr) * r_int < tj:
            lo = tb
        else:
            hi = tb
    qc, qr = natural_q(d, lo, t_amb)
    return {"q": qc + qr, "q_conv": qc, "q_rad": qr, "t_base": lo}


def calibrate_natural(target_conv: float = 11.9, t_base: float = 82.0, t_amb: float = 25.0) -> float:
    """도면 VC-201/202 '수동 용량' 25 °C 행(대류 11.9 W @ 핀 바닥 82 °C)에 맞추는 보정 계수."""
    global C_NAT
    C_NAT = 1.0
    raw, _ = natural_q(BASE_B, t_base, t_amb)
    C_NAT = target_conv / raw
    return C_NAT


def with_(d: Design, **kw) -> Design:
    return replace(d, **kw)
