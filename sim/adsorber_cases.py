#!/usr/bin/env python3
"""SI-100 adsorber: the case matrix, each run to periodic steady state.

A single day from an assumed 30 C rich start tells you nothing about this
machine - the bed does not get back to 30 C overnight, so day 1 only reports
the initial condition.  Every case here is repeated until the day repeats.
"""
import sys, os, json, math, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adsorber_2d import Adsorber2D, ice_from
import icemaker_spec as IM
S = IM.SPEC
D = IM.design()

CASES = [
    ("as drawn",            dict()),
    ("night vent U=10",     dict(night_vent=True, U_night=10.0)),
    ("night vent U=20",     dict(night_vent=True, U_night=20.0)),
    ("night vent U=35",     dict(night_vent=True, U_night=35.0)),
    ("vent + k_bed 0.40",   dict(night_vent=True, U_night=20.0, k_bed=0.40)),
    ("vent + k_bed 0.10",   dict(night_vent=True, U_night=20.0, k_bed=0.10)),
    ("vent + bond +/-15",   dict(night_vent=True, U_night=20.0, theta_bond_deg=15.0)),
    ("vent + bond +/-90",   dict(night_vent=True, U_night=20.0, theta_bond_deg=90.0)),
    ("vent, theta-uniform", dict(night_vent=True, U_night=20.0, axisym=True)),
]

def one(name, kw, nr=20, nt=40, max_days=8):
    t0 = time.time()
    m = Adsorber2D(nr=nr, nt=nt, **kw)
    r = m.run_periodic(max_days=max_days, verbose=False)
    tr = r['trace']
    x_hi = max(t['x_mean'] for t in tr); x_lo = min(t['x_mean'] for t in tr)
    hot = max(tr, key=lambda t: t['T_mean']); cold = min(tr, key=lambda t: t['T_mean'])
    ice, Qc, Ql = ice_from(r['M_evap'])
    return dict(name=name, kw={k: v for k, v in kw.items()},
                days=len(r['days']), x_hi=x_hi, x_lo=x_lo, swing=x_hi - x_lo,
                T_hot=hot['T_mean'], T_hot_t=hot['t'],
                T_cold=cold['T_mean'], T_cold_t=cold['t'],
                split_hot=hot['T_top'] - hot['T_bot'],
                split_max=max(abs(t['T_top'] - t['T_bot']) for t in tr),
                P_hi=max(t['P'] for t in tr), M_evap=r['M_evap'],
                ice=ice, secs=time.time() - t0,
                trace=tr if name in ("as drawn", "night vent U=20") else None)

if __name__ == "__main__":
    P = print; L = lambda c='-': P(c * 94)
    P("=" * 94)
    P("SI-100 ADSORBER  —  2D (r,theta) CASE MATRIX, PERIODIC STEADY STATE")
    P("=" * 94)
    P(f"   design point for comparison:  x_r {D['x_r']:.3f}  x_l {D['x_l']:.3f}"
      f"  swing {D['dx']:.3f}  ice {S['ice_day']:.1f} kg/day at T_des {S['T_des']:.0f} C")
    P(f"   'as drawn' = glazing stays on all night, selective coating eps 0.10,")
    P(f"                so the collector's own U_L is the only heat rejection path")
    P("")
    P(f"{'case':<22}{'d':>3}{'x_rich':>8}{'x_lean':>8}{'swing':>8}{'%des':>6}"
      f"{'T_hot':>7}{'T_cold':>8}{'dT t/b':>8}{'ICE':>8}{'%tgt':>6}")
    L()
    out = []
    for name, kw in CASES:
        r = one(name, kw)
        out.append(r)
        P(f"{name:<22}{r['days']:>3}{r['x_hi']:>8.3f}{r['x_lo']:>8.3f}"
          f"{r['swing']:>8.3f}{r['swing']/D['dx']*100:>6.0f}"
          f"{r['T_hot']:>7.1f}{r['T_cold']:>8.1f}{r['split_max']:>8.1f}"
          f"{r['ice']:>8.2f}{r['ice']/S['ice_day']*100:>6.0f}")
    L()
    json.dump([{k: v for k, v in r.items() if k != 'trace'} for r in out],
              open(os.path.join(os.path.dirname(__file__), 'out', 'adsorber_cases.json'), 'w'),
              indent=1)
    P(f"   total {sum(r['secs'] for r in out)/60:.1f} min")
