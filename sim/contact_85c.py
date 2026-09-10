#!/usr/bin/env python3
"""Attach VC-100 + VC-202 (passive) to an 85 C body. Where does it settle?

Case 1  the body keeps generating heat  -> steady state, set by the power
Case 2  the body is just hot, no source -> transient, always ends at ambient
"""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import SPEC as S, R_vc_calc
from passive_85c import solve as nat, q_conv, q_rad

_,R_VC=R_vc_calc()
N,T,P_,H,EPS=S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85

def T_body(Q,Ta):
    """Body temperature for a steady dissipation Q, passive stack."""
    lo,hi=Ta,Ta+400
    for _ in range(90):
        Tb=(lo+hi)/2
        if q_conv(Tb,Ta,N,T,P_,H)[0]+q_rad(Tb,Ta,EPS) < Q: lo=Tb
        else: hi=Tb
    Tfin=(lo+hi)/2
    return Tfin+Q*R_VC, Tfin

def Q_at(Tbody,Ta):
    return nat(Tbody,Ta,N,T,P_,H,EPS)['Q']

# lumped capacitance of the assembly itself
C_ASSY = 0.128*385 + 0.0727*900 + 0.00187*4180      # Cu + Al + water, J/K

def cool(T0,Ta,C,targets):
    """Integrate C dT/dt = -Q(T) with the coupled convection+radiation load."""
    t,Tb,out,dt=0.0,T0,{},0.05
    tg=sorted(targets,reverse=True)
    for target in tg:
        while Tb>target and t<200000:
            Q=q_conv(Tb,Ta,N,T,P_,H)[0]+q_rad(Tb,Ta,EPS)
            Tb-=Q*dt/C; t+=dt
        out[target]=t if t<200000 else None
    return out

def cool_bare(T0,Ta,C,A_m2,targets,eps=0.3):
    """Same body with NO heatsink: bare 68x68x27 block, free convection + radiation."""
    t,Tb,out,dt=0.0,T0,{},0.05
    for target in sorted(targets,reverse=True):
        while Tb>target and t<200000:
            dT=max(Tb-Ta,1e-6)
            h=1.42*(dT/0.068)**0.25                 # vertical plate free convection
            Q=h*A_m2*dT + eps*5.67e-8*A_m2*((Tb+273.15)**4-(Ta+273.15)**4)
            Tb-=Q*dt/C; t+=dt
        out[target]=t if t<200000 else None
    return out

P=print
P("="*74); P("CONTACT WITH AN 85 C BODY  —  VC-100 + VC-202, PASSIVE, NO FAN"); P("="*74)
P(f"R_vc (body to fin base) = {R_VC:.3f} K/W   |   assembly heat capacity = {C_ASSY:.0f} J/K")

P("\n"+"-"*74)
P("CASE 1 — THE BODY KEEPS GENERATING HEAT")
P("-"*74)
P("The final temperature is set by the POWER, not by the heatsink.")
P("85 C is simply the temperature at which this stack rejects 16.5 W.\n")
P(f"{'power':>8}{'body T @ 25 C':>16}{'@ 35 C':>10}{'@ 40 C':>10}{'drop from 85 C':>17}")
for Q in (2,5,8,10,12,14,16.5,20,25):
    t25=T_body(Q,25)[0]; t35=T_body(Q,35)[0]; t40=T_body(Q,40)[0]
    P(f"{Q:>6.1f} W{t25:>14.1f} C{t35:>9.1f} C{t40:>9.1f} C{85-t25:>14.1f} K")
P("\n  -> at 25 C ambient the stack holds the body at 85 C only if it makes 16.5 W.")
P("     Halve the power to 8 W and it settles near 58 C. Cut it to 2 W and it sits at 33 C.")
P("     It can never go below ambient, whatever the heatsink.")

P("\n"+"-"*74)
P("CASE 2 — THE BODY IS JUST HOT, NOTHING GENERATING (a heated block)")
P("-"*74)
P("Then it ALWAYS ends at ambient. The heatsink only changes how fast.\n")
tg=[70,60,50,40,35,30,27]
for label,Cx in [("assembly alone (203 g)",C_ASSY),
                 ("assembly + 100 g Cu block",C_ASSY+0.100*385),
                 ("assembly + 500 g Cu block",C_ASSY+0.500*385)]:
    r=cool(85,25,Cx,tg)
    P(f"  {label:<28} C = {Cx:>5.0f} J/K")
    P("     " + "  ".join(f"{k} C: {v/60:>5.1f} min" for k,v in sorted(r.items(),reverse=True) if v))
P("\n  with NO heatsink (bare 68x68x27 copper block, painted, same mass):")
r=cool_bare(85,25,C_ASSY,(0.068*0.068+4*0.068*0.027),tg)
P("     " + "  ".join(f"{k} C: {v/60:>5.1f} min" for k,v in sorted(r.items(),reverse=True) if v))
a=cool(85,25,C_ASSY,[40])[40]; b=cool_bare(85,25,C_ASSY,(0.068*0.068+4*0.068*0.027),[40])[40]
P(f"\n  -> to reach 40 C: {a/60:.1f} min with the stack vs {b/60:.1f} min bare  ({b/a:.1f}x faster)")

P("\n"+"-"*74)
P("HOW MUCH THE VAPOUR CHAMBER ITSELF IS WORTH HERE")
P("-"*74)
for Q in (5,10,16.5):
    Tb,Tf=T_body(Q,25)
    P(f"  {Q:>5.1f} W : body {Tb:>5.1f} C, fin base {Tf:>5.1f} C  ->  only {Tb-Tf:>4.1f} K"
      f" ({(Tb-Tf)/(Tb-25)*100:>3.0f}%) is lost inside the chamber")
P("  The other 90+ % of the temperature rise is fin-to-air. In passive service the")
P("  vapour chamber is NOT the bottleneck - a solid copper spreader would land close.")
