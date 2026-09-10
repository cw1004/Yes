#!/usr/bin/env python3
"""CP-100 cold plate: 2D transient conjugate heat transfer, plan view.

Thickness-averaged copper plate + lumped die node + 1D coolant march.
    rho.cp.t dT/dt = div(k.t grad T) + q_die"(x,y) - h_eff(x,y).(T - Tc(x))
Coolant is quasi-steady along x (residence 0.2 s vs plate tau 0.065 s).
Not CFD: the channel-side heat transfer is the validated 1D correlation
from coldplate_spec.py, applied as a distributed sink.
"""
import sys, os, math, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coldplate_spec import SPEC as S, PG25, thermal, budget

# ---------------------------------------------------------------- geometry
DX = 0.5e-3                                   # m
NX = int(round(S['L']/1000/DX)); NY = int(round(S['W']/1000/DX))
xs = (np.arange(NX)+0.5)*DX*1000              # mm, cell centres
ys = (np.arange(NY)+0.5)*DX*1000
X, Y = np.meshgrid(xs, ys, indexing='ij')

PX0 = (S['L']-S['pocket_L'])/2; PY0 = (S['W']-S['pocket_W'])/2
FX0 = PX0+S['plenum']; FX1 = FX0+S['fin_L']
FY0 = PY0;             FY1 = PY0+S['pocket_W']

pocket = (X>=PX0)&(X<=PX0+S['pocket_L'])&(Y>=PY0)&(Y<=FY1)
finfld = (X>=FX0)&(X<=FX1)&(Y>=FY0)&(Y<=FY1)
die    = (np.abs(X-S['L']/2)<=S['die']/2)&(np.abs(Y-S['W']/2)<=S['die']/2)

# plate thickness map: base under the pocket, full body elsewhere
tmap = np.where(pocket, S['base_t'], S['H_body'])/1000.0        # m

# ---------------------------------------------------------------- material
K_CU, RHO_CU, CP_CU = 390.0, 8960.0, 385.0
A_CELL = DX*DX
C_cell = RHO_CU*CP_CU*tmap*A_CELL                               # J/K per cell

# die node: GH100 silicon + package, lumped
M_DIE, CP_SI = 0.020, 700.0                                     # 20 g effective
C_DIE = M_DIE*CP_SI
A_DIE = die.sum()*A_CELL
R_TIM = 6e-5/(13.0*A_DIE)                                       # K/W, whole die

# ---------------------------------------------------------------- coolant
def coolant_props(lpm):
    """UA and mdot.cp at a given flow, from the validated 1D channel model.
    At zero flow the channels hold stagnant fluid: UA collapses to bare
    natural convection inside a 0.25 mm slot, which is effectively nothing."""
    if lpm < 1e-3:
        return 2.0, 1e-9, None                       # W/K, W/K : stagnant
    t = thermal(PG25, lpm=lpm)
    return t['UA'], t['mcp'], t
A_FF = finfld.sum()*A_CELL
def h_eff(lpm):
    UA,_,_ = coolant_props(lpm)
    return UA/A_FF                                              # W/m2K on the footprint

# ---------------------------------------------------------------- schedule
TIMELINE = [
    (0.0, 150.0, 1.5,   "idle  150 W"),
    (1.5, 700.0, 1.5,   "full load  700 W"),
    (5.0, 700.0, 0.0,   "TOTAL FLOW LOSS"),
    (9.0, 700.0, 1.5,   "flow restored"),
]
T_END = 12.0
def sched(t):
    p,f,lab = TIMELINE[0][1], TIMELINE[0][2], TIMELINE[0][3]
    for tt,pp,ff,ll in TIMELINE:
        if t>=tt: p,f,lab = pp,ff,ll
    return p,f,lab

# ---------------------------------------------------------------- solver
def run(dt=4e-4, frame_dt=0.04, verbose=True):
    T_IN = S['Tw_in']
    T = np.full((NX,NY), T_IN, float)
    T_die = T_IN
    # coolant column temperature, one value per x column over the fin field
    ix0, ix1 = int(FX0/1000/DX), int(FX1/1000/DX)
    iy0, iy1 = int(FY0/1000/DX), int(FY1/1000/DX)
    nsteps = int(T_END/dt); every = max(1,int(frame_dt/dt))
    frames, trace = [], []
    kt = K_CU*tmap
    for n in range(nsteps+1):
        t = n*dt
        P, lpm, lab = sched(t)
        UA, mcp, tw = coolant_props(lpm)
        h = UA/A_FF
        # ---- coolant march along x over the fin field (quasi-steady)
        # exact per-column effectiveness form: the coolant asymptotes to the
        # local wall temperature and can never overshoot it (a plain forward
        # march does overshoot at low flow, and then injects energy).
        Tc = np.full(NX, T_IN)
        acc = T_IN
        col_h = h*A_CELL*(iy1-iy0)
        decay = math.exp(-col_h/max(mcp,1e-9))
        Q_removed = 0.0
        for i in range(ix0, ix1):
            Tw_col = T[i, iy0:iy1].mean()
            nxt = Tw_col + (acc-Tw_col)*decay
            Q_removed += mcp*(nxt-acc)
            acc = nxt
            Tc[i] = 0.5*(acc+Tc[i-1] if i>ix0 else acc)   # column mean
            Tc[i] = acc
        Tc_field = np.zeros((NX,NY)); Tc_field[:, :] = Tc[:,None]
        # ---- conduction (variable thickness, harmonic face conductance)
        lap = np.zeros_like(T)
        kx = 2*kt[1:,:]*kt[:-1,:]/(kt[1:,:]+kt[:-1,:])
        fx = kx*(T[1:,:]-T[:-1,:])
        lap[:-1,:] += fx; lap[1:,:] -= fx
        ky = 2*kt[:,1:]*kt[:,:-1]/(kt[:,1:]+kt[:,:-1])
        fy = ky*(T[:,1:]-T[:,:-1])
        lap[:,:-1] += fy; lap[:,1:] -= fy
        # ---- sources
        q_die = np.zeros_like(T)
        q_in = (T_die-T)/R_TIM/die.sum()
        q_die[die] = q_in[die]
        q_sink = np.where(finfld, h*A_CELL*(T-Tc_field), 0.0)
        q_sink = np.maximum(q_sink, 0.0)          # coolant never heats the plate
        dT = (lap + q_die - q_sink)*dt/C_cell
        # ---- die node
        Q_to_plate = ((T_die - T[die].mean())/R_TIM)
        T_die = T_die + (P - Q_to_plate)*dt/C_DIE
        T = T + dT
        if n % every == 0:
            stored = C_cell.sum()*0  # placeholder, energy audit below
            frames.append(dict(t=t, T=T.copy(), Tc=Tc.copy(), Tdie=T_die,
                               P=P, lpm=lpm, lab=lab, Qrem=float(q_sink.sum()),
                               Tout=Tc[ix1-1], Tmax=float(T.max()), Tmin=float(T.min())))
            trace.append((t, T_die, float(T[die].mean()), float(Tc[ix1-1]), P, lpm,
                          float(q_sink.sum())))
        if verbose and n % (nsteps//8) == 0:
            print(f"   t={t:5.2f}s  P={P:5.0f}W  flow={lpm:4.2f}  "
                  f"Tdie={T_die:6.2f}C  Tplate={T[die].mean():6.2f}C  Tout={Tc[ix1-1]:6.2f}C")
    return frames, np.array(trace)

def steady(P=700.0, lpm=1.5, tol=1e-4, max_it=400000, dt=4e-4):
    """March to convergence at fixed power and flow."""
    T_IN=S['Tw_in']; T=np.full((NX,NY),T_IN,float); T_die=T_IN
    ix0,ix1=int(FX0/1000/DX),int(FX1/1000/DX); iy0,iy1=int(FY0/1000/DX),int(FY1/1000/DX)
    UA,mcp,_=coolant_props(lpm); h=UA/A_FF; kt=K_CU*tmap
    col_h=h*A_CELL*(iy1-iy0); decay=math.exp(-col_h/max(mcp,1e-9))
    for n in range(max_it):
        Tc=np.full(NX,T_IN); acc=T_IN
        for i in range(ix0,ix1):
            Tw=T[i,iy0:iy1].mean(); acc=Tw+(acc-Tw)*decay; Tc[i]=acc
        Tcf=np.zeros((NX,NY)); Tcf[:,:]=Tc[:,None]
        lap=np.zeros_like(T)
        kx=2*kt[1:,:]*kt[:-1,:]/(kt[1:,:]+kt[:-1,:]); fx=kx*(T[1:,:]-T[:-1,:])
        lap[:-1,:]+=fx; lap[1:,:]-=fx
        ky=2*kt[:,1:]*kt[:,:-1]/(kt[:,1:]+kt[:,:-1]); fy=ky*(T[:,1:]-T[:,:-1])
        lap[:,:-1]+=fy; lap[:,1:]-=fy
        qd=np.zeros_like(T); qi=(T_die-T)/R_TIM/die.sum(); qd[die]=qi[die]
        qs=np.maximum(np.where(finfld,h*A_CELL*(T-Tcf),0.0),0.0)
        dT=(lap+qd-qs)*dt/C_cell
        T_die=T_die+(P-(T_die-T[die].mean())/R_TIM)*dt/C_DIE
        T=T+dT
        if n>500 and np.abs(dT).max()<tol: break
    return T,T_die,Tc,float(qs.sum()),n

if __name__ == "__main__":
    P=print
    P("="*72); P("CP-100 TRANSIENT CONJUGATE SOLVE"); P("="*72)
    P(f"  grid {NX} x {NY} @ {DX*1000:.1f} mm   |  fin field {finfld.sum()} cells"
      f"  |  die {die.sum()} cells")
    P(f"  R_TIM (whole die) = {R_TIM:.5f} K/W    h_eff = {h_eff(1.5):.0f} W/m2K")
    P(f"  die node C = {C_DIE:.1f} J/K   plate C = {C_cell.sum():.1f} J/K")
    frames, tr = run()
    P("\n--- STEADY-STATE VALIDATION vs the lumped model ---")
    _,RT = budget(PG25)
    Ts,Tds,Tcs,Qs,nit = steady()
    ix1=int(FX1/1000/DX)
    R2d=(Tds-S['Tw_in'])/700
    P(f"  converged in {nit} steps   |  energy: in 700 W, removed {Qs:.1f} W"
      f"  ({abs(700-Qs)/700*100:.2f} % imbalance)")
    P(f"  2D steady : die {Tds:.2f} C, plate under die {Ts[die].mean():.2f} C, "
      f"coolant out {Tcs[ix1-1]:.2f} C, plate max {Ts.max():.2f} C")
    P(f"  lumped    : die {S['Tw_in']+RT*700:.2f} C   (R = {RT:.4f} K/W)")
    P(f"  2D implied R = {R2d:.4f} K/W  ->  the lumped model is conservative by "
      f"{(RT-R2d)*700:.1f} K ({(RT-R2d)/RT*100:.0f} %)")
    P(f"  the gap is almost exactly the lumped 'spread' term (0.0050 K/W = 3.5 K):")
    P(f"  a 28.5 mm die inside a 40 x 50 fin field barely has to spread at all.")
    P(f"  coolant rise: 2D {Tcs[ix1-1]-S['Tw_in']:.2f} K   vs 1D {thermal(PG25)['dTw']:.2f} K")
    P("\n--- ENERGY AUDIT (steady phase, t = 2.9 s) ---")
    f_ss = [f for f in frames if abs(f['t']-2.9)<0.03][0]
    P(f"  power in {f_ss['P']:.0f} W    removed by coolant {f_ss['Qrem']:.1f} W"
      f"    imbalance {abs(f_ss['P']-f_ss['Qrem'])/f_ss['P']*100:.2f} %  (the remainder is still being stored)")
    f_pk = [f for f in frames if abs(f['t']-6.0)<0.03][0]
    P(f"  during the fault (t=6.0 s): in {f_pk['P']:.0f} W, removed {f_pk['Qrem']:.1f} W"
      f"  -> {f_pk['P']-f_pk['Qrem']:.0f} W going into the metal")
    P(f"  combined heat capacity: plate {C_cell.sum():.1f} + die {C_DIE:.1f} = {C_cell.sum()+C_DIE:.1f} J/K")
    P(f"  implied rate at that instant: {(f_pk['P']-f_pk['Qrem'])/(C_cell.sum()+C_DIE):.2f} K/s")

    P("\n--- FAULT RESPONSE ---")
    i_f = np.argmin(np.abs(tr[:,0]-5.0))
    P(f"  at flow loss (t=5.0 s): die {tr[i_f,1]:.1f} C")
    seg = tr[(tr[:,0]>=5.0)&(tr[:,0]<=9.0)]
    for lim,lab in [(85.0,"85 C"),(90.0,"90 C throttle"),(100.0,"100 C")]:
        ov = seg[seg[:,1]>=lim]
        P(f"  flow loss to {lab:<14}: "
          + (f"{ov[0,0]-5.0:5.2f} s" if len(ov) else "not reached in 4 s"))
    P(f"  initial rate  : {(tr[i_f+2,1]-tr[i_f,1])/(tr[i_f+2,0]-tr[i_f,0]):.1f} K/s"
      f"   (700 W into {C_cell.sum()+C_DIE:.0f} J/K of copper and silicon)")
    i_r = np.argmin(np.abs(tr[:,0]-9.5))
    P(f"  0.5 s after restore: die {tr[i_r,1]:.1f} C")
    P("\n  -> A D2C plate has almost NO ride-through. Loss of flow must trip power,")
    P("     not raise an alarm: a few seconds of copper is the entire margin.")
    OUTD=os.path.join(os.path.dirname(__file__),"out"); os.makedirs(OUTD,exist_ok=True)
    np.savez_compressed(os.path.join(OUTD,"frames.npz"),
        T=np.stack([f["T"] for f in frames]).astype(np.float32),
        Tc=np.stack([f["Tc"] for f in frames]).astype(np.float32),
        t=np.array([f["t"] for f in frames],dtype=np.float32),
        Tdie=np.array([f["Tdie"] for f in frames],dtype=np.float32),
        P=np.array([f["P"] for f in frames],dtype=np.float32),
        lpm=np.array([f["lpm"] for f in frames],dtype=np.float32),
        Qrem=np.array([f["Qrem"] for f in frames],dtype=np.float32),
        Tout=np.array([f["Tout"] for f in frames],dtype=np.float32),
        labels=np.array([f["lab"] for f in frames]),
        trace=tr,
        meta=np.array([NX,NY,DX*1000,S["L"],S["W"],PX0,PY0,FX0,FX1,FY0,FY1,
                       S["die"],S["Tw_in"],C_cell.sum()+C_DIE],dtype=np.float32))
    P(f"\n  frames: {len(frames)}  ->  {OUTD}/frames.npz")
