#!/usr/bin/env python3
"""600 W / 700 W / 1200 W class GPUs: where each cooling technology runs out."""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import AIR, WATER as W
P=print; L=lambda c='-': P(c*84)
W2K, W2B = 3600/4184.0, 3.41214

GPUS=[
 # name,              TDP,  die mm2, note
 ("RTX 4090 / AD102",  450,  609, "shipped, air, 3-slot"),
 ("RTX 5090 / GB202",  575,  750, "shipped, air, 2-slot FE"),
 ("H100 SXM5 / GH100", 700,  814, "air 8U DGX, or D2C"),
 ("B200 SXM / 2xdie", 1000, 1600, "liquid in practice"),
 ("GB200 Blackwell",  1200, 1600, "D2C liquid, NVL72"),
]

P("="*84); P("UNIT CHECK  (your table)"); P("="*84)
P(f"{'power':>8}{'kcal/h':>11}{'BTU/h':>11}   1 W = {W2K:.4f} kcal/h = {W2B:.4f} BTU/h")
for w in (300,575,600,700,1000,1200):
    P(f"{w:>6} W{w*W2K:>11.0f}{w*W2B:>11.0f}")
P("  Your 516 / 2047, 602 / 2388, 1032 / 4094 are all correct.")

P("\n"); L('='); P("SPEC NOTES"); L('=')
P("  RTX 5090 shipped at 575 W TGP, not 600 W - and the Founders card does it")
P("  air-cooled in TWO slots. Air is not at its limit at 575 W; it is merely dense.")
P("  700 W is H100 SXM5. H100 PCIe is 350 W and H100 NVL 400 W per GPU.")
P("  1200 W is the GB200 superchip Blackwell; HGX B200 SXM is 1000 W.")

P("\n"); L('='); P("1. HEAT FLUX AT THE DIE - this barely changes"); L('=')
P(f"{'part':>20}{'TDP':>7}{'die':>9}{'die edge':>11}{'flux':>12}")
for n,w,a,_ in GPUS:
    P(f"{n:>20}{w:>5} W{a:>7}mm2{math.sqrt(a):>9.1f}mm{w/(a/100):>10.0f} W/cm2")
P("  75-90 W/cm2 across the whole range. The die-side problem is NOT getting harder;")
P("  total power is. That is a heat-REJECTION problem, not a heat-SPREADING one.")

P("\n"); L('='); P("2. WHAT AIR WOULD HAVE TO DO  (die 85 C)"); L('=')
P(f"{'part':>20}{'TDP':>7}{'R @25C':>9}{'R @35C':>9}{'R @45C':>9}"
  f"{'CFM @15K rise':>15}{'verdict':>14}")
for n,w,a,_ in GPUS:
    cfm=w/(1005*15)/AIR['rho']*2118.9
    v="feasible" if w<=600 else ("extreme" if w<=800 else "no")
    P(f"{n:>20}{w:>5} W{(85-25)/w:>9.3f}{(85-35)/w:>9.3f}{(85-45)/w:>9.3f}{cfm:>13.0f}  {v:>14}")
P("  A 2U slot passes roughly 40-80 CFM. 1200 W needs 145 CFM per GPU at 15 K rise,")
P("  and in a rack the inlet is 35-45 C, not 25 C, which halves the budget again.")

P("\n"); L('='); P("3. VAPOUR CHAMBER LIMITS AT THESE POWERS"); L('=')
def q_cap(Lpath_mm, w_mm, t_wick_mm, r_eff=12.6e-6, K=1.97e-11, tilt_mm=0):
    dPcap=2*W.sigma/r_eff; dPg=W.rho_l*9.81*tilt_mm/1e3
    A=(w_mm/1e3)*(t_wick_mm/1e3)
    g=W.mu_l*(Lpath_mm/1e3)/(W.hfg*W.rho_l*K*A)
    return max(dPcap-dPg,0)/g
P(f"{'chamber':>18}{'wick':>8}{'L eff':>8}{'Q cap':>9}{'covers':>36}")
for cw,cl,tw,Le in [(70,100,0.40,30),(70,100,0.60,30),(90,120,0.60,35),(90,120,1.00,35)]:
    q=q_cap(Le,cw,tw,tilt_mm=cl)
    ok=", ".join(n.split(' /')[0] for n,w,_,_ in GPUS if w<=q) or "none"
    P(f"{cw}x{cl:>11}{tw:>7.2f}mm{Le:>6.0f}mm{q:>7.0f} W{ok:>36}")
P("  Evaporator CHF for a thin sintered Cu-water wick is ~100-250 W/cm2 against the")
P("  75-90 W/cm2 above: only 1.5-3x margin, so the evaporator is not comfortable either.")
P("  A vapour chamber is fine to ~600-800 W with a good wick. Past that it is fighting.")

P("\n"); L('='); P("4. DIRECT-TO-CHIP LIQUID"); L('=')
P(f"{'part':>20}{'TDP':>7}{'flow':>9}{'water rise':>12}{'plate dT':>10}{'die @45C water':>17}")
for n,w,a,_ in GPUS:
    lpm=1.0 if w<700 else 1.5
    mdot=lpm/60*997/1000; dTw=w/(mdot*4180)
    Rcp=0.025                                  # micro-channel plate on bare die
    P(f"{n:>20}{w:>5} W{lpm:>7.1f}L/m{dTw:>11.1f}K{Rcp*w:>9.1f}K{45+dTw+Rcp*w:>15.0f} C")
P("  Facility water at 45 C (warm-water D2C, no chiller) still lands the die at 60-80 C.")
P("  Note the cold plate REPLACES the vapour chamber - its 0.025 K/W beats the")
P("  0.073 K/W of a chamber, because there is no evaporate-condense chain in between.")

P("\n"); L('='); P("5. WHERE EACH TECHNOLOGY RUNS OUT"); L('=')
rows=[("Passive, no fan","~20 W","VC-202 in this repo"),
      ("Air, 68 mm stack","~160 W","VC-201 in this repo, 4 m/s"),
      ("Air, 3-slot card cooler","~600 W","RTX 5090 FE does 575 W in 2 slots"),
      ("Air, 8U server chassis","~700 W","DGX H100, very high airflow, loud"),
      ("D2C cold plate + CDU","~1500 W","GB200 NVL72 at 1200 W"),
      ("Two-phase immersion",">2000 W","rack-level, no per-part heatsink")]
P(f"{'technology':>26}{'practical ceiling':>20}   reference")
for a,b,c in rows: P(f"{a:>26}{b:>20}   {c}")
P("\n  The VC-100 work in this repo is a 113 W device. Every part in your table is")
P("  5-11x beyond it. The vapour chamber concept still applies up to about the")
P("  RTX 5090; from H100 SXM upward the answer is liquid, and the chamber disappears.")
