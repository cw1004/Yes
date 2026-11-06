"""VC-100 재시뮬레이션: 도면 성능표 검증 → 같은 외형에서 최고 성능 설계 탐색.

실행: python -m vc100_sim.analyze  →  output/vc100/ 에 표·그래프 저장
"""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from . import model as M
from .model import BASE_A, BASE_B, with_

OUT = Path("output/vc100")
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# 제작 가능 범위 (스카이빙 Al 핀 기준)
PITCHES = np.round(np.arange(0.8e-3, 3.01e-3, 0.05e-3), 6)
THICKNESSES = [0.2e-3, 0.3e-3, 0.4e-3, 0.5e-3]
MIN_GAP = 0.6e-3          # 먼지 막힘·스카이빙 한계
CAP_MARGIN = 3.0          # 모세관 한계 ≥ 설계 열량 × 3


def validate():
    rows = []
    for v, r_ref, q_ref in ((1, 1.12, 67), (2, 0.67, 113), (4, 0.46, 163)):
        r = M.q_forced(BASE_A, v)
        rows.append(("A", f"{v} m/s", r_ref, r["r_total"], q_ref, r["q"]))
    c = M.calibrate_natural()
    for ta, q_ref in ((25, 16.5), (30, 14.8), (35, 13.1), (40, 11.4), (45, 9.8)):
        r = M.q_natural(BASE_B, 85, ta)
        rows.append(("B", f"외기 {ta} °C, Tj 85", None, None, q_ref, r["q"]))
    return rows, c


def best_fins(constraint: str, ref: dict, k_fin: float = 218.0, base=BASE_A):
    """같은 팬 전력(fan) 또는 같은 풍량(flow)에서 열량 최대 (피치, 두께)."""
    best, grid = None, {}
    for t in THICKNESSES:
        for p in PITCHES:
            d = with_(base, pitch=float(p), t_fin=t, k_fin=k_fin)
            if d.gap < MIN_GAP:
                continue
            v = M.v_for_fan_power(d, ref["fan_w"]) if constraint == "fan" else M.v_for_flow(d, ref["flow"])
            r = M.q_forced(d, v)
            grid[(t, float(p))] = r["q"]
            if best is None or r["q"] > best[1]["q"]:
                best = (d, {**r, "v": v})
    return best, grid


def improvement_path():
    ref = M.q_forced(BASE_A, 2.0)
    steps = [("도면 기준 (43핀 1.5 피치, 2 m/s)", BASE_A, 2.0)]
    (d1, r1), _ = best_fins("fan", ref)
    steps.append((f"핀 최적화 {d1.n_fins}핀 {d1.pitch * 1e3:.2f} 피치 t{d1.t_fin * 1e3:.1f}", d1, r1["v"]))
    d2 = with_(d1, tim2="solder")
    steps.append(("핀–뚜껑 납땜 접합 (PCM 패드 제거)", d2, M.v_for_fan_power(d2, ref["fan_w"])))
    d3 = with_(d2, wick_a=0.30e-3)
    steps.append(("증발부 윅 0.40 → 0.30 mm", d3, M.v_for_fan_power(d3, ref["fan_w"])))
    (d4, r4), _ = best_fins("fan", ref, k_fin=390.0, base=d3)
    steps.append((f"구리 핀 (재최적화 {d4.pitch * 1e3:.2f} 피치 t{d4.t_fin * 1e3:.1f})", d4, r4["v"]))
    out = []
    for label, d, v in steps:
        r = M.q_forced(d, v)
        out.append((label, d, v, r))
    return ref, out


def passive_best():
    best = None
    for t in [0.5e-3, 0.8e-3, 1.0e-3, 1.2e-3]:
        for p in np.round(np.arange(3.0e-3, 9.01e-3, 0.1e-3), 6):
            d = with_(BASE_B, pitch=float(p), t_fin=t)
            if d.gap < 2.0e-3:
                continue
            q = M.q_natural(d, 85, 25)["q"]
            if best is None or q > best[1]:
                best = (d, q)
    d_best = best[0]
    d_full = with_(d_best, tim2="solder", wick_a=0.30e-3)
    return [("도면 VC-202 (13핀 5.0 피치)", BASE_B, M.q_natural(BASE_B)["q"]),
            (f"핀 최적화 {d_best.n_fins}핀 {d_best.pitch * 1e3:.1f} 피치 t{d_best.t_fin * 1e3:.1f}", d_best, best[1]),
            ("+ 납땜 접합 + 윅 0.30", d_full, M.q_natural(d_full)["q"])]


def plot_validation(rows):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    a = [r for r in rows if r[0] == "A"]
    x = np.arange(len(a))
    axes[0].bar(x - 0.18, [r[4] for r in a], 0.36, label="도면 VC-100", color="#9aa4b1")
    axes[0].bar(x + 0.18, [r[5] for r in a], 0.36, label="이번 모델", color="#2a6fdb")
    axes[0].set_xticks(x, [r[1] for r in a])
    axes[0].set_title("Config A 강제 공냉 — Tj 100 °C 처리 열량 [W]")
    b = [r for r in rows if r[0] == "B"]
    x = np.arange(len(b))
    axes[1].bar(x - 0.18, [r[4] for r in b], 0.36, label="도면 VC-201/202", color="#9aa4b1")
    axes[1].bar(x + 0.18, [r[5] for r in b], 0.36, label="이번 모델 (25 °C 보정)", color="#e0904a")
    axes[1].set_xticks(x, [r[1].split(",")[0] for r in b])
    axes[1].set_title("Config B 무팬 — Tj 85 °C 처리 열량 [W]")
    for ax, rr in ((axes[0], a), (axes[1], b)):
        for i, r in enumerate(rr):
            ax.text(i + 0.18, r[5], f"{r[5]:.1f}", ha="center", va="bottom", fontsize=8)
            ax.text(i - 0.18, r[4], f"{r[4]:.1f}", ha="center", va="bottom", fontsize=8, color="#555")
        ax.legend(fontsize=8)
        ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "validation.png", dpi=130)
    plt.close(fig)


def plot_map(ref):
    _, grid = best_fins("fan", ref)
    fig, ax = plt.subplots(figsize=(8, 4.6))
    colors = ["#9ecae1", "#4292c6", "#08519c", "#08306b"]
    for t, c in zip(THICKNESSES, colors):
        ps = sorted(p for (tt, p) in grid if tt == t)
        ax.plot([p * 1e3 for p in ps], [grid[(t, p)] for p in ps], color=c, lw=2, label=f"핀 두께 {t * 1e3:.1f} mm")
    ax.scatter([1.5], [ref["q"]], color="#e05a47", zorder=5, s=40)
    ax.annotate("도면 기준", (1.5, ref["q"]), xytext=(1.75, ref["q"] - 12), fontsize=9, color="#b03a2e",
                arrowprops=dict(arrowstyle="-", color="#b03a2e", lw=0.8))
    ax.set_xlabel("핀 피치 [mm]")
    ax.set_ylabel("Tj 100 °C 처리 열량 [W]")
    ax.set_title(f"같은 팬 전력({ref['fan_w'] * 1e3:.0f} mW)에서 핀 피치·두께별 성능 (Al, 높이 20 mm)")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "fin_map.png", dpi=130)
    plt.close(fig)


def plot_path(path, passive):
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8), gridspec_kw={"width_ratios": [5, 3]})
    for ax, labels, vals, unit in (
            (axes[0], [p[0] for p in path], [p[3]["q"] for p in path], "강제 공냉 Tj 100 °C"),
            (axes[1], [p[0] for p in passive], [p[2] for p in passive], "무팬 Tj 85 °C")):
        prev = 0
        for i, v in enumerate(vals):
            if i == 0:
                ax.bar(i, v, color="#888")
            else:
                ax.bar(i, v - prev, bottom=prev, color="#2a6fdb")
            ax.text(i, v, f"{v:.0f} W" if v > 40 else f"{v:.1f} W", ha="center", va="bottom", fontsize=9)
            prev = v
        ax.set_xticks(range(len(vals)), [l.replace(" (", "\n(").replace(" + ", "\n+ ", 1) for l in labels],
                      fontsize=7.5)
        ax.set_title(f"{unit}: {vals[0]:.1f} → {vals[-1]:.1f} W (+{vals[-1] / vals[0] - 1:.0%})")
        ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "improvement_path.png", dpi=130)
    plt.close(fig)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, c = validate()
    print(f"[검증] 자연대류 보정 계수 {c:.2f}")
    for r in rows:
        print(f"  {r[0]} {r[1]:<20} 도면 {r[4]:6.1f} W   모델 {r[5]:6.1f} W   ({r[5] / r[4] - 1:+.1%})")
    plot_validation(rows)

    ref, path = improvement_path()
    plot_map(ref)
    print(f"\n[강제 공냉] 같은 팬 전력 {ref['fan_w'] * 1e3:.0f} mW (도면 2 m/s, 압력손실 {ref['dp']:.0f} Pa)")
    with open(OUT / "forced_path.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["step", "fins", "pitch_mm", "t_mm", "k_fin", "wick_mm", "tim2", "v_ch", "dp_pa",
                    "flow_lps", "r_int", "r_sink", "r_total", "q_tj100", "cap_limit_w", "fin_mass_g"])
        for label, d, v, r in path:
            vol = d.n_fins * d.t_fin * d.h_fin * M.L_FLOW
            mass = vol * (8930 if d.k_fin > 300 else 2710) * 1000
            cap = M.capillary_limit(d)
            print(f"  {label:<44} R {r['r_total']:.3f} K/W (내부 {r['r_int']:.3f} + 핀 {r['r_sink']:.3f})  "
                  f"Q {r['q']:6.1f} W  풍속 {v:.2f} m/s  ΔP {r['dp']:.0f} Pa  모세관 {cap:.0f} W  핀 {mass:.0f} g")
            w.writerow([label, d.n_fins, round(d.pitch * 1e3, 2), round(d.t_fin * 1e3, 2), d.k_fin,
                        round(d.wick_a * 1e3, 2), d.tim2, round(v, 2), round(r["dp"], 1), round(r["flow"] * 1e3, 2),
                        round(r["r_int"], 3), round(r["r_sink"], 3), round(r["r_total"], 3), round(r["q"], 1),
                        round(cap), round(mass)])
    (d_flow, r_flow), _ = best_fins("flow", ref)
    print(f"  (참고) 같은 풍량 기준 핀 최적: {d_flow.n_fins}핀 {d_flow.pitch * 1e3:.2f} 피치 t{d_flow.t_fin * 1e3:.1f}"
          f" → {r_flow['q']:.1f} W, 단 압력손실 {r_flow['dp']:.0f} Pa (팬 전력 {r_flow['fan_w'] / ref['fan_w']:.1f}배)")

    passive = passive_best()
    print("\n[무팬] Tj 85 °C, 외기 25 °C")
    for label, d, q in passive:
        print(f"  {label:<40} {q:5.1f} W")
    plot_path(path, passive)

    best = path[-1]
    d = best[1]
    q = best[3]["q"]
    print(f"\n[한계 점검] 최고 설계 {q:.0f} W: 다이 열유속 {q / 4:.0f} W/cm², "
          f"모세관 한계 {M.capillary_limit(d):.0f} W (여유 {M.capillary_limit(d) / q:.1f}배)")
    print(f"저장: {OUT}/validation.png, fin_map.png, improvement_path.png, forced_path.csv")


if __name__ == "__main__":
    main()
