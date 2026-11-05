"""메탄올 대체 냉매 비교: 같은 활성탄(Maxsorb III)에 냉매만 바꿔 하루 얼음량을 계산한다.

흡착은 Dubinin 체적 충전 이론으로 옮긴다.
  - 기공 부피 V0 와 지수 n 은 활성탄 고유값 → 도면 VC-400 메탄올 표에서 구한다.
  - 특성 에너지 E 는 냉매마다 친화 계수 β 만큼 달라진다: E_i = β_i · E_메탄올.
  - β_i 는 끓는점 액체 몰부피 비로 근사한다 (Dubinin). 오차가 커서 ±25 % 민감도를 함께 본다.
  - 임계 온도 이상에서는 Dubinin 의사 포화압 Ps = Pc (T/Tc)² 과
    Ozawa 흡착상 밀도 ρ = ρ_b · exp(−0.0025 (T − Tb)) 를 쓴다.

실행: python -m si100_sim.refrigerants  →  output/si100/refrigerants.csv, refrigerants.png
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, replace
from pathlib import Path

import CoolProp.CoolProp as CP
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .model import BASE, CP_WATER, ICE_LATENT, VC400_TABLE, Params, R

OUT = Path("output/si100")
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


@dataclass(frozen=True)
class Info:
    name: str          # 표시 이름
    coolprop: str      # CoolProp 유체 이름
    gwp: str           # 지구온난화지수 (100년, 근사)
    safety: str        # ASHRAE 34 등급 또는 비고
    copper_ok: bool    # 구리 흡착기·배관 사용 가능 여부
    note: str


FLUIDS = [
    Info("메탄올", "Methanol", "~0", "미분류(독성·가연)", True, "약 120 °C 이상에서 분해"),
    Info("에탄올", "Ethanol", "~0", "미분류(가연)", True, "독성 낮음, 진공 운전"),
    Info("아세톤", "Acetone", "~0", "미분류(가연)", True, "진공 운전"),
    Info("암모니아", "Ammonia", "0", "B2L(독성)", False, "구리 부식 → 강철 흡착기"),
    Info("디메틸에테르", "DimethylEther", "1", "A3(고가연)", True, "양압 운전"),
    Info("이소부탄", "IsoButane", "3", "A3(고가연)", True, "양압 운전"),
    Info("프로판", "Propane", "3", "A3(고가연)", True, "고압"),
    Info("R134a", "R134a", "1,430", "A1", True, "고GWP 규제 대상"),
    Info("R1234ze(E)", "R1234ze(E)", "<1", "A2L", True, "저GWP"),
    Info("R1234yf", "R1234yf", "<1", "A2L", True, "저GWP"),
    Info("R32", "R32", "675", "A2L", True, "고압"),
]
# CO2 는 임계 온도 31 °C 라 낮 응축기(30 °C 이상)에서 액화되지 않으므로 제외한다.

OZAWA_ALPHA = 0.0025


class Fluid:
    def __init__(self, cp_name: str):
        self.n = cp_name
        self.tc = CP.PropsSI("Tcrit", cp_name)
        self.pc = CP.PropsSI("pcrit", cp_name)
        self.m = CP.PropsSI("M", cp_name)
        self.tb = CP.PropsSI("T", "P", 101325, "Q", 0, cp_name)
        self.rho_b = CP.PropsSI("D", "T", self.tb, "Q", 0, cp_name)
        self.vm_b = self.m / self.rho_b                   # m³/mol
        self._t_cap = self.tc - 10.0                       # 포화 물성을 쓰는 상한

    def psat(self, t_k: float) -> float:
        """Pa. 임계 근처·이상은 Dubinin 의사 포화압."""
        if t_k < self._t_cap:
            return CP.PropsSI("P", "T", t_k, "Q", 0, self.n)
        return self.pc * (t_k / self.tc) ** 2

    def rho_ads(self, t_k: float) -> float:
        """흡착상 밀도 kg/m³."""
        if t_k < self._t_cap:
            return CP.PropsSI("D", "T", t_k, "Q", 0, self.n)
        return self.rho_b * math.exp(-OZAWA_ALPHA * (t_k - self.tb))

    def hfg(self, t_k: float) -> float:
        t = min(t_k, self._t_cap)
        return (CP.PropsSI("H", "T", t, "Q", 1, self.n) - CP.PropsSI("H", "T", t, "Q", 0, self.n)) / 1000

    def cp_liq(self, t_k: float) -> float:
        t = min(t_k, self._t_cap)
        return CP.PropsSI("C", "T", t, "Q", 0, self.n) / 1000

    def cooling_per_kg(self, t_evap_k: float, t_cond_k: float) -> float:
        """증발기에서 냉매 1 kg 이 내는 냉열 kJ/kg (응축액이 들어와 포화 증기로 나감)."""
        return (CP.PropsSI("H", "T", t_evap_k, "Q", 1, self.n)
                - CP.PropsSI("H", "T", t_cond_k, "Q", 0, self.n)) / 1000


METHANOL = Fluid("Methanol")


def fit_volume_da() -> tuple[float, float, float]:
    """도면 VC-400 표에서 활성탄 기공 부피 V0 [m³/kg], E_메탄올 [J/mol], n 을 구한다."""
    # P/Psat = 1 행(40·60 °C, 1.31 g/g)의 평균 50 °C 밀도로 기공 부피를 정한다
    v0 = 1.31 / METHANOL.rho_ads(323.15)
    xs, ys = [], []
    for _, t_res, ratio, w in VC400_TABLE:
        t = t_res + 273.15
        v = w / METHANOL.rho_ads(t)
        xs.append(math.log(R * t * math.log(1 / ratio)))
        ys.append(math.log(math.log(v0 / v)))
    n, c = np.polyfit(xs, ys, 1)
    return v0, math.exp(-c / n), n


V0, E_REF, N_DA = fit_volume_da()


class Pair:
    """Maxsorb III + 냉매 한 쌍."""

    def __init__(self, fluid: Fluid, beta_scale: float = 1.0):
        self.f = fluid
        self.beta = fluid.vm_b / METHANOL.vm_b * beta_scale
        self.e = self.beta * E_REF

    def uptake(self, t_k: float, p: float) -> float:
        ratio = min(p / self.f.psat(t_k), 1.0)
        a = R * t_k * math.log(1 / ratio)
        return self.f.rho_ads(t_k) * V0 * math.exp(-((a / self.e) ** N_DA))

    def q_st(self, t_k: float, x: float) -> float:
        v = max(x / self.f.rho_ads(t_k), 1e-9)
        a = self.e * math.log(V0 / v) ** (1 / N_DA) if v < V0 else 0.0
        return self.f.hfg(t_k) + a / self.f.m / 1000


def simulate(pair: Pair, p: Params) -> dict:
    te, tc = p.t_evap + 273.15, p.t_cond + 273.15
    ta, tg = p.t_ads + 273.15, p.t_gen + 273.15
    p_e, p_c = pair.f.psat(te), pair.f.psat(tc)
    x_max, x_min = pair.uptake(ta, p_e), pair.uptake(tg, p_c)
    dx = max(x_max - x_min, 0.0)
    q_cool = dx * pair.f.cooling_per_kg(te, tc)

    cp_dry = p.cp_ac + p.metal_ratio * p.cp_metal
    q_in, x, t = 0.0, x_max, ta
    while t < tg:
        t_next = min(t + 0.5, tg)
        x_next = min(x, pair.uptake(t_next, p_c))
        q_in += (cp_dry + x * pair.f.cp_liq(t)) * (t_next - t)
        q_in += (x - x_next) * pair.q_st(t_next, 0.5 * (x + x_next))
        t, x = t_next, x_next

    ice_per_kg = p.eta_evap * q_cool / (CP_WATER * p.t_water + ICE_LATENT)
    eta_col = max(p.eta0 - p.u_loss * (0.5 * (p.t_ads + p.t_gen) - p.t_amb_day) / p.g_avg, 0.0)
    ac_per_m2 = p.insolation * 1000 * eta_col / q_in if q_in > 0 else 0.0
    return {
        "dx": dx, "ice_per_kg": ice_per_kg, "ice_per_m2": ac_per_m2 * ice_per_kg,
        "cop": q_cool / q_in if q_in else 0.0, "ac_per_m2": ac_per_m2,
        "p_evap_kpa": p_e / 1000, "p_cond_kpa": p_c / 1000,
    }


def best_t_gen(pair: Pair, p: Params, t_max: float) -> tuple[float, dict]:
    """집열판 m²당 얼음이 최대인 탈착 온도 (80 °C ~ t_max)."""
    best = (p.t_gen, simulate(pair, p))
    for tg in np.arange(80, t_max + 0.1, 5):
        r = simulate(pair, replace(p, t_gen=float(tg)))
        if r["ice_per_m2"] > best[1]["ice_per_m2"]:
            best = (float(tg), r)
    return best


def compare(p: Params = BASE):
    rows = []
    for info in FLUIDS:
        fluid = Fluid(info.coolprop)
        pair = Pair(fluid)
        base = simulate(pair, p)
        t_max = 120.0 if info.coolprop == "Methanol" else 150.0
        tg_opt, opt = best_t_gen(pair, p, t_max)
        lo = simulate(Pair(fluid, 0.75), p)["ice_per_kg"]
        hi = simulate(Pair(fluid, 1.25), p)["ice_per_kg"]
        rows.append({"info": info, "beta": pair.beta, "base": base, "tg_opt": tg_opt,
                     "opt": opt, "beta_range": (min(lo, hi), max(lo, hi))})
    return rows


def plot(rows):
    rows = sorted(rows, key=lambda r: r["base"]["ice_per_kg"], reverse=True)
    names = [r["info"].name for r in rows]
    per_kg = [r["base"]["ice_per_kg"] for r in rows]
    # 메탄올은 β 를 맞춘 기준 냉매라 오차막대가 없다
    ref = [r["info"].coolprop == "Methanol" for r in rows]
    lo = [0 if m else r["base"]["ice_per_kg"] - r["beta_range"][0] for r, m in zip(rows, ref)]
    hi = [0 if m else r["beta_range"][1] - r["base"]["ice_per_kg"] for r, m in zip(rows, ref)]
    per_m2 = [r["opt"]["ice_per_m2"] for r in rows]
    colors = ["#1b9e77" if r["info"].coolprop == "Methanol" else "#2a6fdb" for r in rows]

    fig, axes = plt.subplots(1, 2, figsize=(14, 6), sharey=True)
    y = np.arange(len(rows))[::-1]
    axes[0].barh(y, per_kg, color=colors, xerr=[lo, hi], ecolor="#555", capsize=3)
    axes[0].set_title("활성탄 1 kg당 하루 얼음 [kg]\n(탈착 100 °C, 오차막대 = 친화 계수 β ±25 %)")
    axes[1].barh(y, per_m2, color=colors)
    axes[1].set_title("집열판 1 m²당 하루 얼음 [kg]\n(냉매별 최적 탈착 온도)")
    for ax, vals, pad in ((axes[0], per_kg, hi), (axes[1], per_m2, [0] * len(rows))):
        for yi, v, e in zip(y, vals, pad):
            ax.text(v + e + max(vals) * 0.015, yi, f"{v:.2f}" if ax is axes[0] else f"{v:.1f}",
                    va="center", fontsize=9)
        ax.grid(axis="x", alpha=0.3)
    axes[0].set_yticks(y)
    axes[0].set_yticklabels(names)
    fig.suptitle("Maxsorb III + 냉매별 태양열 제빙 성능 (증발 −5 °C, 응축·흡착 30 °C)", fontsize=14)
    fig.tight_layout()
    fig.savefig(OUT / "refrigerants.png", dpi=130)
    plt.close(fig)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"활성탄 기공 부피 V0 = {V0 * 1000:.2f} cm³/g, E_메탄올 = {E_REF:.0f} J/mol, n = {N_DA:.2f}")
    rows = compare()
    hdr = (f"{'냉매':<10}{'β':>6}{'Δx':>7}{'얼음/kgAC':>10}{'(β±25%)':>14}{'얼음/m²':>9}"
           f"{'최적Tg':>8}{'최적 얼음/m²':>12}{'증발압kPa':>11}{'응축압kPa':>11}")
    print(hdr)
    for r in rows:
        b, o = r["base"], r["opt"]
        print(f"{r['info'].name:<10}{r['beta']:6.2f}{b['dx']:7.3f}{b['ice_per_kg']:10.2f}"
              f"   {r['beta_range'][0]:5.2f}~{r['beta_range'][1]:4.2f}{b['ice_per_m2']:9.1f}"
              f"{r['tg_opt']:8.0f}{o['ice_per_m2']:12.1f}{b['p_evap_kpa']:11.1f}{b['p_cond_kpa']:11.0f}")
    with open(OUT / "refrigerants.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["fluid", "beta", "dx", "ice_kg_per_kgAC", "ice_kgAC_beta_lo", "ice_kgAC_beta_hi",
                    "ice_kg_per_m2_tg100", "best_tg", "ice_kg_per_m2_best", "p_evap_kpa", "p_cond_kpa",
                    "gwp", "safety", "copper_ok", "note"])
        for r in rows:
            i, b, o = r["info"], r["base"], r["opt"]
            w.writerow([i.name, round(r["beta"], 2), round(b["dx"], 3), round(b["ice_per_kg"], 3),
                        round(r["beta_range"][0], 3), round(r["beta_range"][1], 3),
                        round(b["ice_per_m2"], 2), r["tg_opt"], round(o["ice_per_m2"], 2),
                        round(b["p_evap_kpa"], 1), round(b["p_cond_kpa"]), i.gwp, i.safety,
                        i.copper_ok, i.note])
    plot(rows)
    print(f"\n저장: {OUT}/refrigerants.csv, refrigerants.png")


if __name__ == "__main__":
    main()
