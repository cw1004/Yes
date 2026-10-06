#!/usr/bin/env python3
"""Pack the SI-100 adsorber solve into a compact JSON for the 3D viewer.

Fields are quantised to uint8 over a fixed range and base64'd - 98 frames of a
21 x 40 grid is 82 kB raw per field, which is nothing, and keeping it uint8
means the page can push it straight into a texture without a conversion pass.
"""
import os, sys, json, base64, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import icemaker_spec as IM
from adsorption_chiller import psat_meoh
from viz_common import thermal_ramp, SERIES_LIGHT, SERIES_DARK

S = IM.SPEC; D = IM.design()
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
Z = np.load(os.path.join(OUT, "adsorber_fields.npz"), allow_pickle=True)
GEO = json.loads(str(Z['geo'])); META = json.loads(str(Z['meta']))
PHASE = json.loads(str(Z['phase']))

TLO, THI = 20.0, 140.0
XLO, XHI = 0.30, 1.10

def q8(a, lo, hi):
    return base64.b64encode(
        np.clip((a - lo) / (hi - lo) * 255.0, 0, 255).astype(np.uint8).tobytes()
    ).decode()

def main():
    cases = {}
    for c in ("drawn", "vent"):
        T = Z[f"{c}_T"]; X = Z[f"{c}_X"]
        F, n, nt = T.shape
        cases[c] = dict(
            nF=int(F), n=int(n), nt=int(nt),
            T=q8(T, TLO, THI), X=q8(X, XLO, XHI),
            t=[round(float(v), 4) for v in Z[f"{c}_t"]],
            P=[round(float(v) / 1000.0, 4) for v in Z[f"{c}_P"]],
            G=[round(float(v), 1) for v in Z[f"{c}_G"]],
            Ta=[round(float(v), 2) for v in Z[f"{c}_Ta"]],
            Tp=[round(float(v), 2) for v in Z[f"{c}_Tp"]],
            T_mean=[round(float(v), 2) for v in Z[f"{c}_T_mean"]],
            T_top=[round(float(v), 2) for v in Z[f"{c}_T_top"]],
            T_bot=[round(float(v), 2) for v in Z[f"{c}_T_bot"]],
            x_mean=[round(float(v), 4) for v in Z[f"{c}_x_mean"]],
            M_liq=[round(float(v) * 1000, 2) for v in Z[f"{c}_M_liq"]],
            phase=PHASE[c], meta=META[c])

    extra = []
    pj = os.path.join(OUT, "adsorber_charge.json")
    if os.path.exists(pj): extra = json.load(open(pj))
    matrix = []
    pm = os.path.join(OUT, "adsorber_cases.json")
    if os.path.exists(pm): matrix = json.load(open(pm))
    control = []
    pc = os.path.join(OUT, "adsorber_control.json")
    if os.path.exists(pc): control = json.load(open(pc))

    doc = dict(
        scale=dict(TLO=TLO, THI=THI, XLO=XLO, XHI=XHI),
        geo=GEO, cases=cases, charge=extra, matrix=matrix, control=control,
        ramp=[list(map(int, c)) for c in thermal_ramp(256)],
        series=dict(light=SERIES_LIGHT, dark=SERIES_DARK),
        design=dict(x_r=D['x_r'], x_l=D['x_l'], dx=D['dx'], T_des=S['T_des'],
                    T_ads=S['T_ads'], T_evap=S['T_evap'], T_cond=S['T_cond'],
                    m_c=D['m_c'], charge=D['charge'], ice=S['ice_day'],
                    f_sys=S['f_sys'], q_ice=D['q_ice'], A_coll=S['A_coll'],
                    P_ev=psat_meoh(S['T_evap']) / 1000.0,
                    P_cd=psat_meoh(S['T_cond']) / 1000.0,
                    ideal_MJ=S['ice_day'] * D['q_ice'] / S['f_sys'] / 1e6))
    p = os.path.join(OUT, "adsorber_web.json")
    json.dump(doc, open(p, "w"), separators=(",", ":"))
    print(f"   wrote {p}  {os.path.getsize(p)/1024:.0f} kB")

if __name__ == "__main__":
    main()
