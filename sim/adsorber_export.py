#!/usr/bin/env python3
"""Run the two display cases of the SI-100 adsorber to periodic steady state
and persist the (r,theta) field frames for the animation and the 3D viewer."""
import sys, os, json, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adsorber_2d import Adsorber2D, ice_from
import icemaker_spec as IM
S = IM.SPEC; D = IM.design()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

DISPLAY = [("drawn", dict()),
           ("vent",  dict(night_vent=True, U_night=20.0))]

def main(nr=20, nt=40, n_frames=96):
    pack = {}
    for key, kw in DISPLAY:
        m = Adsorber2D(nr=nr, nt=nt, **kw)
        r = m.run_periodic(max_days=8, n_frames=n_frames, verbose=True)
        T = np.array([f[0] for f in r['frames']], dtype=np.float32)   # (F,n,nt)
        X = np.array([f[1] for f in r['frames']], dtype=np.float32)
        tr = r['trace']
        ice, Qc, Ql = ice_from(r['M_evap'])
        pack[key] = dict(
            T=T, X=X,
            t=np.array([v['t'] for v in tr], np.float32),
            P=np.array([v['P'] for v in tr], np.float32),
            Tp=np.array([v['Tp'] for v in tr], np.float32),
            Ta=np.array([v['Ta'] for v in tr], np.float32),
            G=np.array([v['G'] for v in tr], np.float32),
            T_mean=np.array([v['T_mean'] for v in tr], np.float32),
            T_top=np.array([v['T_top'] for v in tr], np.float32),
            T_bot=np.array([v['T_bot'] for v in tr], np.float32),
            x_mean=np.array([v['x_mean'] for v in tr], np.float32),
            M_ads=np.array([v['M_ads'] for v in tr], np.float32),
            M_liq=np.array([v['M_liq'] for v in tr], np.float32),
            phase=[v['phase'] for v in tr],
            meta=dict(ice=ice, M_evap=r['M_evap'], Q_cool=Qc, Q_leak=Ql,
                      days=len(r['days']), dt=r['dt'],
                      swing=float(max(v['x_mean'] for v in tr)
                                  - min(v['x_mean'] for v in tr)),
                      x_hi=float(max(v['x_mean'] for v in tr)),
                      x_lo=float(min(v['x_mean'] for v in tr)),
                      rho_bed=r['rho_bed'], m_c_tube=r['m_c_tube']))
        print(f"   [{key}] ice {ice:.2f} kg/day  swing {pack[key]['meta']['swing']:.3f}"
              f"  days to converge {pack[key]['meta']['days']}")

    geo = dict(rf=m.rf.tolist(), r=m.r.tolist(), nr=nr, nt=nt,
               nr_steel=m.nr_steel, dth=m.dth, th=m.th.tolist(),
               is_bed=m.is_bed.tolist(),
               bond=m.bond.tolist() if hasattr(m.bond, 'tolist') else list(m.bond),
               tube_od=S['tube_od'], tube_wall=S['tube_wall'],
               core_od=S['core_od'], tube_len=S['tube_len'],
               n_tube=S['n_tube'], pitch=IM.adsorber()['pitch'])
    np.savez_compressed(os.path.join(OUT, "adsorber_fields.npz"),
                        **{f"{k}_{f}": v[f] for k, v in pack.items()
                           for f in ("T","X","t","P","Tp","Ta","G","T_mean",
                                     "T_top","T_bot","x_mean","M_ads","M_liq")},
                        geo=json.dumps(geo),
                        meta=json.dumps({k: v['meta'] for k, v in pack.items()}),
                        phase=json.dumps({k: v['phase'] for k, v in pack.items()}))
    print("   wrote", os.path.join(OUT, "adsorber_fields.npz"))

if __name__ == "__main__":
    main()
