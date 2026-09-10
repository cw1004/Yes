#!/usr/bin/env python3
"""Passive (fanless) capacity with a 85 C maximum junction temperature.

Natural convection between vertical fins (Elenbaas) + radiation from the
outer envelope, solved together for the fin-base temperature.
Air properties are evaluated at the film temperature.
"""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import SPEC as S, R_vc_calc

SIGMA=5.670e-8
_,R_VC=R_vc_calc()

def air(Tf_C):
    """Dry air at 1 atm, film temperature Tf [C]."""
    T=Tf_C+273.15
    return dict(rho=352.6/T, k=1.52e-4*T**0.79, mu=1.458e-6*T**1.5/(T+110.4),
                cp=1006.0, beta=1.0/T)

def q_conv(Tb,Ta,n,t,p,H,L=S['L']/1000):
    """Elenbaas vertical parallel plates, fins vertical, both faces active."""
    dT=Tb-Ta
    if dT<=0: return 0.0,0.0
    a=air((Tb+Ta)/2); nu=a['mu']/a['rho']; al=a['k']/(a['rho']*a['cp'])
    b=(p-t)/1000; Hm=H/1000
    Ra=9.81*a['beta']*dT*b**3/(nu*al)*(b/Hm)
    Nu=(576/Ra**2+2.873/math.sqrt(Ra))**-0.5
    h=Nu*a['k']/b
    m=math.sqrt(2*h/(200.0*t/1000)); eta=math.tanh(m*Hm)/(m*Hm)
    A=n*2*Hm*L
    return h*eta*A*dT, h

def q_rad(Tb,Ta,eps):
    """Envelope radiation: top + 4 sides of the 68 x 68 x 27 block."""
    A=(S['L']*S['W'] + 4*S['L']*S['overallA'])/1e6
    return eps*SIGMA*A*((Tb+273.15)**4-(Ta+273.15)**4)

def solve(Tj,Ta,n,t,p,H,eps,Rvc=R_VC):
    """Find Q and fin-base temperature such that the chain balances."""
    lo,hi=Ta,Tj
    for _ in range(80):
        Tb=(lo+hi)/2
        Q_out=q_conv(Tb,Ta,n,t,p,H)[0]+q_rad(Tb,Ta,eps)
        Q_in=(Tj-Tb)/Rvc
        if Q_in>Q_out: lo=Tb
        else: hi=Tb
    Tb=(lo+hi)/2
    qc,h=q_conv(Tb,Ta,n,t,p,H); qr=q_rad(Tb,Ta,eps)
    return dict(Q=qc+qr,Tb=Tb,qc=qc,qr=qr,h=h,frac_rad=qr/(qc+qr) if qc+qr else 0)

def opt_pitch(Tj,Ta,t,H,eps):
    best=None
    pp=t+0.4
    while pp<=14.0:
        n=int(S['L']/pp)
        if n>=2 and pp-t>=0.4:
            r=solve(Tj,Ta,n,t,pp,H,eps)
            if best is None or r['Q']>best[1]['Q']: best=(pp,r,n)
        pp+=0.1
    return best

if __name__=="__main__":
    P=print
    P("="*76); P("PASSIVE CAPACITY — Tj max 85 C, NO FAN, FINS VERTICAL"); P("="*76)
    P(f"R_vc = {R_VC:.3f} K/W   |   envelope 68 x 68 x {S['overallA']:.0f} mm")

    P("\n--- CONFIG B  (11 fin @ 6.0 pitch, 1.0 thk, 20 tall), ANODISED eps=0.85 ---")
    P(f"{'ambient':>9}{'dT':>6}{'T base':>9}{'h':>8}{'convection':>12}{'radiation':>11}{'TOTAL Q':>10}")
    for Ta in (25,30,35,40,45):
        r=solve(85,Ta,S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85)
        P(f"{Ta:>7} C{85-Ta:>6}{r['Tb']:>8.1f}C{r['h']:>8.2f}{r['qc']:>10.2f} W{r['qr']:>9.2f} W{r['Q']:>8.1f} W")

    P("\n--- EMISSIVITY: why the finish is not cosmetic (ambient 25 C) ---")
    P(f"{'finish':>34}{'eps':>7}{'conv':>9}{'rad':>9}{'TOTAL':>9}{'vs bare':>9}")
    base=None
    for eps,lab in [(0.05,"bare mill-finish aluminium"),(0.12,"bright machined + passivated"),
                    (0.60,"chromate conversion"),(0.85,"clear anodise 5 um"),(0.92,"black anodise")]:
        r=solve(85,25,S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],eps)
        if base is None: base=r['Q']
        P(f"{lab:>34}{eps:>7.2f}{r['qc']:>7.1f} W{r['qr']:>7.1f} W{r['Q']:>7.1f} W{r['Q']/base:>8.2f}x")

    P("\n--- FIN PITCH SWEEP at Tj 85 C / 25 C, anodised, 20 mm tall ---")
    P(f"{'pitch':>7}{'fins':>6}{'h':>8}{'conv':>9}{'rad':>8}{'TOTAL':>9}")
    for pp in (1.5,3.0,4.0,5.0,6.0,7.0,8.0,10.0):
        n=int(S['L']/pp); r=solve(85,25,n,S['finB_t'],pp,S['finB_h'],0.85)
        mark="  <-- as drawn (VC-202)" if abs(pp-6.0)<1e-6 else ("  <-- VC-201, forced-air only" if abs(pp-1.5)<1e-6 else "")
        P(f"{pp:>6.1f}{n:>6}{r['h']:>8.2f}{r['qc']:>7.1f} W{r['qr']:>6.1f} W{r['Q']:>7.1f} W{mark}")
    bp,br,bn=opt_pitch(85,25,S['finB_t'],S['finB_h'],0.85)
    P(f"  optimum: {bp:.1f} mm pitch, {bn} fins -> {br['Q']:.1f} W")

    P("\n--- TALLER PASSIVE STACK (ambient 25 C, anodised, optimum pitch each) ---")
    P(f"{'fin height':>12}{'pitch':>8}{'fins':>6}{'overall H':>11}{'TOTAL Q':>10}")
    for H in (20,30,40,60):
        p,r,n=opt_pitch(85,25,1.0,H,0.85)
        P(f"{H:>10} mm{p:>8.1f}{n:>6}{S['chamber_h']+S['fin_base']+H:>9.0f} mm{r['Q']:>8.1f} W")

    P("\n--- ORIENTATION (Config B, 25 C, anodised) ---")
    r=solve(85,25,S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85)
    P(f"  fins VERTICAL (chimney)        {r['Q']:>6.1f} W   design case")
    rh=solve(85,25,S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85)
    qh=rh['qc']*0.45+rh['qr']
    P(f"  fins HORIZONTAL (flat, up)     {qh:>6.1f} W   channels trap air, ~55% convection loss")
    P(f"  radiation floor (fins blocked) {r['qr']:>6.1f} W   what you keep in the worst orientation")

    P("\n--- COMPARISON at Tj 85 C, ambient 25 C ---")
    for lab,n,t,p,H,eps,v in [("CONFIG B passive, anodised",S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'],0.85,None),
                              ("CONFIG A passive (1.5 pitch)",S['finA_n'],S['finA_t'],S['finA_p'],S['finA_h'],0.85,None)]:
        r=solve(85,Ta if False else 25,n,t,p,H,eps)
        P(f"  {lab:<30}{r['Q']:>7.1f} W")
    P(f"  {'CONFIG A + fan 1 m/s':<30}{(85-25)/1.12:>7.1f} W")
    P(f"  {'CONFIG A + fan 2 m/s':<30}{(85-25)/0.67:>7.1f} W")
