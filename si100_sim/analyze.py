"""SI-100 개선안 분석: 변수별 민감도 + 개선안 누적 효과.

실행: python -m si100_sim.analyze  →  output/si100/ 에 표(csv)와 그래프(png) 저장
"""

from __future__ import annotations

import csv
from dataclasses import replace
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .model import BASE, DA_E, DA_N, simulate, with_

OUT = Path("output/si100")
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# (변수, 이름, 범위, 단위, 실제로 바꿀 수 있는 방법)
SWEEPS = [
    ("t_gen", "탈착 최고 온도", np.arange(80, 131, 2.5), "°C"),
    ("t_ads", "새벽 흡착기 온도", np.arange(20, 40.1, 1), "°C"),
    ("t_cond", "응축기 온도", np.arange(20, 40.1, 1), "°C"),
    ("t_evap", "증발기 온도", np.arange(-10, -1.9, 0.5), "°C"),
    ("metal_ratio", "금속/활성탄 질량비", np.arange(0.5, 6.01, 0.25), "kg/kg"),
    ("eta_evap", "증발기 냉열 이용률", np.arange(0.5, 0.951, 0.025), "-"),
    ("t_water", "넣는 물 온도", np.arange(5, 35.1, 1), "°C"),
    ("u_loss", "집열기 열손실 계수", np.arange(2, 8.01, 0.5), "W/m²K"),
]

# 개선안: 순서대로 누적 적용
STEPS = [
    ("기준", "기준", {}),
    ("물 예냉 25→15 °C", "물 예냉\n25→15 °C", {"t_water": 15.0}),
    ("제빙함 단열·증발기 접촉 개선 0.70→0.85", "냉열 이용률\n0.70→0.85", {"eta_evap": 0.85}),
    ("흡착기 야간 냉각 30→25 °C", "야간 냉각\n30→25 °C", {"t_ads": 25.0}),
    ("이중 유리·선택흡수 코팅 U 6→3.5", "집열기 단열\nU 6→3.5", {"u_loss": 3.5}),
    ("탈착 온도 100→115 °C", "탈착 온도\n100→115 °C", {"t_gen": 115.0}),
    ("금속 질량 3→1.5 kg/kg", "금속 질량\n3→1.5 kg/kg", {"metal_ratio": 1.5}),
]


def sensitivity():
    rows = []
    fig, axes = plt.subplots(2, 4, figsize=(16, 7.5), sharey=True)
    base = simulate(BASE)
    for ax, (key, label, xs, unit) in zip(axes.flat, SWEEPS):
        ys = []
        for x in xs:
            r = simulate(with_(**{key: float(x)}))
            ys.append(r.ice_per_m2)
            rows.append([key, round(float(x), 3), round(r.dx, 4), round(r.ice_per_kg, 3),
                         round(float(r.cop), 3), round(float(r.ice_per_m2), 2)])
        ax.plot(xs, ys, color="#2a6fdb", lw=2)
        ax.axvline(getattr(BASE, key), color="#999", ls="--", lw=1)
        ax.axhline(base.ice_per_m2, color="#ccc", lw=1)
        if key == "t_gen":
            ax.axvspan(120, xs[-1], color="#e05a47", alpha=0.12)
            ax.text(0.98, 0.04, "메탄올\n분해 위험", transform=ax.transAxes, ha="right",
                    fontsize=9, color="#b03a2e")
        ax.set_title(label, fontsize=12)
        ax.set_xlabel(unit)
        ax.grid(alpha=0.3)
    for ax in axes[:, 0]:
        ax.set_ylabel("집열판 1 m²당 얼음 [kg/일]")
    fig.suptitle("SI-100 변수별 민감도 (점선 = 기준 조건, 가로선 = 기준 생산량)", fontsize=14)
    fig.tight_layout()
    fig.savefig(OUT / "sensitivity.png", dpi=130)
    plt.close(fig)

    with open(OUT / "sensitivity.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["variable", "value", "dx_kg_per_kg", "ice_kg_per_kgAC", "cop", "ice_kg_per_m2"])
        w.writerows(rows)


def improvement_path():
    p = BASE
    results = []
    for label, _, change in STEPS:
        p = replace(p, **change)
        results.append((label, simulate(p)))

    ticks = [short for _, short, _ in STEPS] + ["개선안\n합계"]
    vals = [float(r.ice_per_m2) for _, r in results]
    fig, ax = plt.subplots(figsize=(11, 5.5))
    prev = 0.0
    for i, v in enumerate(vals):
        if i == 0:
            ax.bar(i, v, color="#888")
        else:
            ax.bar(i, v - prev, bottom=prev, color="#2a6fdb" if v >= prev else "#e05a47")
        ax.text(i, v + 0.15, f"{v:.1f}", ha="center", fontsize=10)
        prev = v
    ax.bar(len(vals), vals[-1], color="#1b9e77")
    ax.text(len(vals), vals[-1] + 0.15, f"{vals[-1]:.1f}", ha="center", fontsize=10, fontweight="bold")
    ax.set_xticks(range(len(vals) + 1))
    ax.set_xticklabels(ticks, fontsize=9)
    ax.set_ylabel("집열판 1 m²당 얼음 [kg/일]")
    ax.set_title(f"개선안을 차례로 적용하면 {vals[0]:.1f} → {vals[-1]:.1f} kg/m²·일 ({vals[-1] / vals[0]:.1f}배)")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "improvement_path.png", dpi=130)
    plt.close(fig)

    with open(OUT / "improvement_path.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["step", "dx", "ice_kg_per_kgAC", "cop", "solar_cop", "ac_kg_per_m2", "ice_kg_per_m2"])
        for label, r in results:
            w.writerow([label, round(r.dx, 3), round(r.ice_per_kg, 3), round(float(r.cop), 3),
                        round(float(r.solar_cop), 3), round(float(r.ac_per_m2), 1),
                        round(float(r.ice_per_m2), 2)])
    return results


def single_lever_gains():
    """개선안을 하나씩만 적용했을 때의 증가율 (기준 대비)."""
    base = simulate(BASE)
    out = []
    for label, _, change in STEPS[1:]:
        r = simulate(with_(**change))
        out.append((label, r.ice_per_m2 / base.ice_per_m2 - 1, r.ice_per_kg / base.ice_per_kg - 1))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"DA 계수 (도면 VC-400 표에 맞춤): E = {DA_E:.0f} J/mol, n = {DA_N:.2f}")
    sensitivity()
    results = improvement_path()
    print("\n[누적 적용]")
    print(f"{'단계':<36}{'Δx':>7}{'kg얼음/kgAC':>13}{'COP':>7}{'태양COP':>9}{'AC kg/m²':>10}{'kg얼음/m²':>11}")
    for label, r in results:
        print(f"{label:<36}{r.dx:7.3f}{r.ice_per_kg:13.2f}{r.cop:7.2f}{r.solar_cop:9.3f}"
              f"{r.ac_per_m2:10.1f}{r.ice_per_m2:11.2f}")
    print("\n[하나씩만 적용]")
    for label, g_m2, g_kg in single_lever_gains():
        print(f"{label:<36} m²당 {g_m2:+6.1%}   kgAC당 {g_kg:+6.1%}")
    print(f"\n저장: {OUT}/sensitivity.png, improvement_path.png, *.csv")


if __name__ == "__main__":
    main()
