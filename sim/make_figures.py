"""도 5 (불확실도 게이팅 개념도) 및 도 13 (캘리브레이션/게이팅 검증) 생성."""
import json
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")
FIGOUT = os.path.join(HERE, "results", "figures")
os.makedirs(FIGOUT, exist_ok=True)
d = np.load(os.path.join(OUT, "figure_data.npz"))
R = json.load(open(os.path.join(OUT, "embodiment_results.json")))

T1, T2 = float(d["T1"]), float(d["T2"])
G_TH, BETA = float(d["G_th"]), float(d["beta"])
OOD = ["ood_sensor", "ood_gate", "ood_800v"]
LBL = {"ood_sensor": "OOD: current-sensor gain fault",
       "ood_gate": "OOD: gate-driver degradation",
       "ood_800v": "OOD: 800 V voltage class"}
COL = {"ood_sensor": "#d1495b", "ood_gate": "#e07a3f", "ood_800v": "#8256a0"}
plt.rcParams.update({"font.size": 9, "axes.grid": True,
                     "grid.alpha": 0.3, "figure.dpi": 160})

# ============================================================ 도 5
fig, ax = plt.subplots(figsize=(7.4, 4.8))
U_ID = d["id_U_epis"]
cand0 = d["id_p"] >= T2
u_gate = float(np.quantile(U_ID[cand0], 1 - BETA))
LO = 1e-6

def clipy(v):
    return np.clip(v, LO, None)

ax.scatter(d["id_p"], clipy(U_ID), s=3, c="#2e6fa7", alpha=0.16,
           label="in-distribution (n=60,000)", rasterized=True)
for k in OOD:
    ax.scatter(d[f"{k}_p"], clipy(d[f"{k}_U_epis"]), s=5, c=COL[k], alpha=0.30,
               label=LBL[k], rasterized=True)

HI = 0.4
ax.set_xscale("logit"); ax.set_yscale("log")
ax.set_xlim(2e-4, 0.9995); ax.set_ylim(LO, HI)
x0, x1 = T2, 0.9995
ax.add_patch(plt.Rectangle((x0, LO), x1 - x0, u_gate - LO,
                           fc="#2a9d5c", alpha=0.18, ec="none", zorder=0))
ax.add_patch(plt.Rectangle((x0, u_gate), x1 - x0, HI - u_gate,
                           fc="#c0392b", alpha=0.15, ec="none", zorder=0))
ax.axvline(T1, color="#444", ls=":", lw=1.3)
ax.axvline(T2, color="#111", ls="--", lw=1.5)
ax.axhline(u_gate, color="#c00", ls="-.", lw=1.4)
ax.axhline(0.25, color="#111", ls="--", lw=1.2, alpha=0.6)

ax.text(0.985, 3e-6, "S3 PERMITTED\n(reconfiguration)", ha="right", va="bottom",
        fontsize=8.2, color="#146b3b", weight="bold")
ax.text(0.985, 0.03, "GATED\nhold in S2", ha="right", va="center",
        fontsize=8.2, color="#8e2a20", weight="bold")
ax.text(T1, HI * 0.62, " $T_1$", fontsize=8.5, color="#444")
ax.text(T2, HI * 0.62, " $T_2$", fontsize=8.5, color="#111", ha="right")
ax.text(2.4e-4, u_gate * 1.25, f"corrected $U_{{max}}$ = {u_gate:.2e} nat",
        fontsize=7.8, color="#c00")
ax.text(2.4e-4, 0.25 * 1.15, "draft $U_{max}$ = 0.25  (unreachable; "
        "theoretical bound $p(1-p)$ = 0.21)", fontsize=7.8, color="#111")
ax.set_xlabel("Calibrated failure probability  $P_{fail}$  (logit scale)")
ax.set_ylabel("Epistemic uncertainty $U_{epis}$ = mutual information [nat]")
ax.set_title("FIG. 5  Uncertainty gating in the $P_{fail}$–$U_{epis}$ plane")
ax.legend(loc="lower left", fontsize=7.2, framealpha=0.93, markerscale=2.6)
fig.tight_layout(); fig.savefig(os.path.join(FIGOUT, "fig05_gating_plane.png"))
plt.close(fig)

# ============================================================ 도 13
fig, axs = plt.subplots(2, 2, figsize=(9.4, 7.4))

# (a) 신뢰도 다이어그램
a = axs[0, 0]
conf, acc, nb = d["bin_conf"], d["bin_acc"], d["bin_n"]
a.plot([0, 1], [0, 1], "k--", lw=1, label="perfect calibration")
a.plot(conf, acc, "o-", color="#2e6fa7", ms=4.5, lw=1.5, label="after temperature scaling")
for c_, a_, n_ in zip(conf, acc, nb):
    a.vlines(c_, min(c_, a_), max(c_, a_), color="#c0392b", lw=1.6, alpha=0.75)
a.set_xlabel("mean predicted probability"); a.set_ylabel("empirical frequency")
a.set_title(f"(a) Reliability diagram (equal-mass, 10 bins)\n"
            f"ECE = {R['ece_cal']:.4f}  (criterion $\\leq$ 0.05),  T = {R['temperature']:.3f}",
            fontsize=9)
a.legend(fontsize=7.5, loc="upper left"); a.set_xlim(-.02, 1.02); a.set_ylim(-.02, 1.02)

# (b) ROC
b = axs[0, 1]
sys.path.insert(0, HERE)
from inverter_uq import uq  # noqa: E402
fpr, tpr, th = uq.roc(d["id_p"], d["y_te"], 4000)
b.plot(fpr, tpr, color="#2e6fa7", lw=1.6, label=f"AUC = {R['auc']:.4f}")
for t, nm, c_ in ((T1, "$T_1$ (FN $\\leq$ 1 %)", "#2a9d5c"),
                  (T2, "$T_2$ (10 FIT target)", "#c0392b")):
    j = int(np.argmin(np.abs(th - t)))
    b.plot(fpr[j], tpr[j], "o", color=c_, ms=7, label=f"{nm}: {t:.4f}")
b.set_xscale("symlog", linthresh=1e-4)
b.set_xlabel("false positive rate (per diagnostic sample)")
b.set_ylabel("true positive rate")
b.set_title("(b) ROC and threshold operating points\n$T_1$ drives early intervention; $T_2$ guards the irreversible step", fontsize=9)
b.legend(fontsize=7.5, loc="lower right")

# (c) U_epis 분포 (ID vs OOD)
c = axs[1, 0]
lo_ = 1e-6
bins = np.logspace(np.log10(lo_), np.log10(0.4), 60)
c.hist(np.clip(d["id_U_epis"], lo_, None), bins=bins, density=True,
       color="#2e6fa7", alpha=0.5, label="in-distribution")
for k in OOD:
    c.hist(np.clip(d[f"{k}_U_epis"], lo_, None), bins=bins, density=True,
           histtype="step", lw=1.6, color=COL[k],
           label=LBL[k].replace("OOD: ", ""))
c.set_xscale("log")
c.axvline(0.25, color="k", ls="--", lw=1.6)
c.axvline(u_gate, color="#c00", ls="-.", lw=1.4)
ytop = c.get_ylim()[1]
c.annotate("draft threshold $U_{max}$ = 0.25\n0 activations in 60,000 samples\n"
           "(theoretical bound $p(1-p)$ = 0.21)",
           xy=(0.25, ytop * 0.55), xytext=(1.2e-5, ytop * 0.995), fontsize=7.2,
           ha="left", va="top", arrowprops=dict(arrowstyle="->", lw=1.0, color="k"))
c.annotate(f"corrected $U_{{max}}$\n= {u_gate:.2e} nat", xy=(u_gate, ytop * 0.30),
           xytext=(u_gate * 3.0, ytop * 0.36), fontsize=7.4, color="#c00",
           arrowprops=dict(arrowstyle="->", lw=1.0, color="#c00"))
c.set_xlim(lo_, 0.4)
c.set_xlabel("epistemic uncertainty (mutual information) [nat, log scale]")
c.set_ylabel("density")
c.set_title("(c) Epistemic uncertainty distribution\nand refutation of the draft threshold", fontsize=9)
c.legend(fontsize=7.0, loc="center left", framealpha=0.9)

# (d) 게이팅 운용 곡선
e = axs[1, 1]
SIG = ("maha_in", "resid_in", "maha_lat", "resid_lat", "U_epis")
cand_id = d["id_p"] >= T2
ref_all = [d[f"id_{s}"] for s in SIG]
s_id_all = uq.combined_ood_score(ref_all, ref_all)
ref = [d[f"id_{s}"][cand_id] for s in SIG]
s_id = uq.combined_ood_score(ref, ref)
betas = np.linspace(0.005, 0.30, 80)
ths = [np.quantile(s_id_all, 1 - bb) for bb in betas]
for k in OOD:
    sc = uq.combined_ood_score(ref_all, [d[f"{k}_{s}"] for s in SIG])
    y_ = [float((sc >= t).mean()) * 100 for t in ths]
    st = {"ood_sensor": (2.6, (0, (4, 2))), "ood_gate": (1.7, "-"),
          "ood_800v": (1.9, "-")}[k]
    e.plot(betas * 100, y_, lw=st[0], ls=st[1], color=COL[k],
           label=f"{LBL[k].replace('OOD: ','')} (n={len(sc):,})")
e.axvline(BETA * 100, color="k", ls="--", lw=1.2)
e.text(BETA * 100 + 0.6, 34, f"design point\n$\\beta$ = {BETA*100:.0f} %", fontsize=7.6)
e.set_xlabel("in-distribution false-gating rate $\\beta$ [%]  (availability loss)")
e.set_ylabel("OOD blocking rate [%]")
e.set_title("(d) Gating operating curve, all OOD samples\n"
            "(AI-side detector only; monitor permissive excluded)", fontsize=9)
e.set_ylim(-3, 103); e.legend(fontsize=7.2, loc="lower right")

fig.suptitle("FIG. 15  Simulation-based validation of calibration, thresholds and gating",
             fontsize=10.5, y=0.995)
fig.tight_layout(rect=[0, 0, 1, 0.975])
fig.savefig(os.path.join(FIGOUT, "fig15_validation.png"))
plt.close(fig)
print("생성:", os.path.join(FIGOUT, "fig05_gating_plane.png"))
print("생성:", os.path.join(FIGOUT, "fig15_validation.png"))
