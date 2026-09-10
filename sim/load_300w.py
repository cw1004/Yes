#!/usr/bin/env python3
"""A 300 W (258 kcal/h) load against the VC-100 design, and what 300 W really needs."""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import SPEC as S, AIR, K_AL, R_vc_calc
from passive_85c import solve as nat

P=print; L=lambda c='-': P(c*78)
W2KCAL=3600/4184.0

P("="*78); P("300 W LOAD  —  WHAT IT MEANS FOR THIS DESIGN"); P("="*78)
P(f"  unit check: 1 W = 3600 J/h / 4184 J/kcal = {W2KCAL:.4f} kcal/(h.W)")
P(f"              300 W x {W2KCAL:.3f} = {300*W2KCAL:.0f} kcal/h    (your 258 is correct)")

# ---------- R_vc as a function of source area ----------
def R_vc(die_mm, h_evap=2.5e4):
    Adie=(die_mm/1000)**2; Acond=(S['L']/1000)**2
    spread = 0.035*(20.0/die_mm)**1.4          # shrinks as the source spreads out
    return dict(TIM=1e-5/Adie, floor=S['floor_t']/1000/(398*Adie), evap=1/(h_evap*Adie),
                vapour=0.004, cond=1/(1.8e4*Acond), lid=S['lid_t']/1000/(398*Acond),
                TIM_fin=5e-5/Acond, spread=spread)

P("\n"); L('='); P("1. THE CHAMBER'S OWN RESISTANCE IS ALREADY THE WALL"); L('=')
P(f"{'source':>10}{'flux':>12}{'R evap':>9}{'R spread':>10}{'R_vc':>8}{'dT at 300 W':>14}")
for d in (20,30,40,50,60):
    r=R_vc(d); tot=sum(r.values()); flux=300/((d/10)**2)
    P(f"{d:>7} mm{flux:>10.0f} W/cm2{r['evap']:>9.3f}{r['spread']:>10.3f}{tot:>8.3f}{tot*300:>12.0f} K")
P("\n  Budget at Tj 85 C in 25 C air: 60 K / 300 W = 0.200 K/W TOTAL, chamber + heatsink.")
P("  With a 20 x 20 mm source the chamber alone spends 0.194 K/W -> nothing left. Impossible.")
P("  The source must be spread over >= 40 x 40 mm before 300 W is even arguable.")

# ---------- what the VC-100 as drawn would do ----------
P("\n"); L('='); P("2. WHAT THE VC-100 AS DRAWN DOES AT 300 W"); L('=')
def fins(n,t,p,H,Lm,v):
    H/=1000.; t/=1000.; p/=1000.; Lm/=1000.; gap=p-t
    Dh=2*gap*H/(gap+H); Re=AIR['rho']*v*Dh/AIR['mu']
    Lp=Lm/(Dh*Re*AIR['Pr']); Nu=min(7.54+0.03*(1/Lp)/(1+0.016*(1/Lp)**0.67),14.)
    h=Nu*AIR['k']/Dh; m=math.sqrt(2*h/(K_AL*t)); eta=math.tanh(m*H)/(m*H)
    A=n*2*H*Lm; UA=h*eta*A
    mcp=AIR['rho']*v*(n-1)*gap*H*AIR['cp']
    eff=1-math.exp(-UA/mcp)
    return dict(R=1/(eff*mcp), A=A, h=h, mcp=mcp, cfm=AIR['rho']*v*(n-1)*gap*H/AIR['rho']*2118.9)
rv=sum(R_vc(20).values())
for lab,v in [("2 m/s",2.0),("4 m/s",4.0),("6 m/s",6.0)]:
    rs=fins(S['finA_n'],S['finA_t'],S['finA_p'],S['finA_h'],S['L'],v)
    Tj=25+300*(rv+rs['R'])
    P(f"  Config A @ {lab:<6} R_sink {rs['R']:.2f} + R_vc {rv:.2f} = {rv+rs['R']:.2f} K/W"
      f"  ->  Tj = {Tj:>5.0f} C   {'OK' if Tj<=85 else 'FAR TOO HOT'}")
r=nat(85,25,S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85)
P(f"  Config B passive: {r['Q']:.1f} W capacity  ->  300 W is {300/r['Q']:.0f}x beyond it.")
P(f"  Air alone needs {300/(1005*10):.4f} kg/s for a 10 K rise = {300/(1005*10)/AIR['rho']*2118.9:.0f} CFM.")
P(f"  The 68 mm stack passes only {fins(S['finA_n'],S['finA_t'],S['finA_p'],S['finA_h'],S['L'],4)['cfm']:.0f} CFM at 4 m/s.")

# ---------- sizing an air solution ----------
P("\n"); L('='); P("3. AIR-COOLED SIZING FOR 300 W  (Tj 85 C, air in 25 C, 40 x 40 source)"); L('=')
rv40=sum(R_vc(40).values())
need=60/300 - rv40
P(f"  R_vc at 40 x 40 source = {rv40:.3f} K/W  ->  heatsink must reach {need:.3f} K/W")
P(f"\n{'footprint':>12}{'fin H':>8}{'pitch':>7}{'fins':>6}{'air':>8}{'R sink':>9}{'Tj':>8}{'CFM':>7}")
best=None
for Lm in (68,100,120,150):
    for H in (20,40,60,80):
        for p in (2.0,2.5,3.0):
            n=int(Lm/p)
            for v in (2,4,6):
                rs=fins(n,0.5,p,H,Lm,v)
                Tj=25+300*(rv40+rs['R'])
                if Tj<=85 and (best is None or Lm*Lm*H<best[0]):
                    best=(Lm*Lm*H,Lm,H,p,n,v,rs,Tj)
for Lm,H,p,v in [(68,20,1.5,4),(100,40,2.5,4),(120,60,2.5,4),(150,60,2.5,4),(150,80,3.0,6)]:
    n=int(Lm/p); rs=fins(n,0.5,p,H,Lm,v); Tj=25+300*(rv40+rs['R'])
    P(f"{Lm:>9}sq{H:>7}mm{p:>7.1f}{n:>6}{v:>6}m/s{rs['R']:>9.3f}{Tj:>7.0f}C{rs['cfm']:>7.0f}"
      + ("   <- meets 85 C" if Tj<=85 else ""))
if best:
    _,Lm,H,p,n,v,rs,Tj=best
    P(f"\n  smallest air solution found: {Lm} x {Lm} x {H} mm, {n} fins @ {p} mm, {v} m/s -> Tj {Tj:.0f} C")
    P(f"  that is {(Lm*Lm*H)/(68*68*20):.0f}x the volume of the drawn fin stack.")

# ---------- liquid ----------
P("\n"); L('='); P("4. LIQUID LOOP FOR 300 W  (for comparison)"); L('=')
mdot=1.0/60*1000/1e6*997      # 1 L/min in kg/s
dTw=300/(mdot*4180)
P(f"  water 1.0 L/min : coolant rise = {dTw:.1f} K")
for Rcp,lab in [(0.05,"micro-channel cold plate"),(0.03,"jet-impingement plate")]:
    P(f"  {lab:<26} R = {Rcp:.2f} K/W  ->  source is {Rcp*300:.0f} K above the water")
P("  240 mm radiator + 2 fans rejects 300 W at roughly 12-15 K above room air.")
P(f"  So Tj ~ 25 + 14 (radiator) + {dTw:.0f} (rise) + 15 (cold plate) = ~57 C.  Comfortable.")
P("  Cold-plate footprint at the source stays ~60 x 60 mm - the bulk moves to the radiator.")
