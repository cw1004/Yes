#!/usr/bin/env python3
"""Is a 5x geometric scale-up a valid test article for the 68 mm chamber?

Checks the similarity groups that actually govern a capillary two-phase device.
"""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import SPEC as S, WATER as W

g=9.81; K_PERM=1.97e-11; R_EFF=12.6e-6; PORO=0.55

def cap(L_mm, r_eff, t_wick_mm, w_mm, tilt=True):
    """Capillary limit of a flat chamber, side L, wick pore r_eff, thickness t."""
    dPcap=2*W.sigma/r_eff
    dPg=W.rho_l*g*(L_mm/1000) if tilt else 0.0
    Leff=(L_mm/1000)/2
    A=(w_mm/1000)*(t_wick_mm/1000)
    K=r_eff**2/(0.21**2)*PORO**3/(150*(1-PORO)**2)     # back out K from pore size
    g_l=W.mu_l*Leff/(W.hfg*W.rho_l*K*A)
    return dict(dPcap=dPcap,dPg=dPg,g_l=g_l,Q=max(dPcap-dPg,0)/g_l)

def Bo(L_mm):  return W.rho_l*g*(L_mm/1000)**2/W.sigma

P=print; L=lambda:P("-"*76)
P("="*76); P("5x SCALE-UP AS A TEST ARTICLE — SIMILARITY CHECK"); P("="*76)

P("\n1. BOND NUMBER  Bo = rho.g.L^2 / sigma   (surface tension vs gravity)")
for f in (1,2,3,5):
    P(f"   {f}x  L = {68*f:>4.0f} mm   Bo = {Bo(68*f):>8.0f}"
      + ("   <- design point" if f==1 else ""))
P("   Bo scales as L^2. At 5x it is 25x higher: the liquid is gravity-controlled,")
P("   not surface-tension-controlled. Pooling and stratification appear that do not")
P("   exist at 68 mm, so the rig measures a different regime than the product.")

P("\n2. THE WICK CANNOT BE SCALED — neither dimension is free")
L()
P("   (a) scale the PORES 5x  (63 um effective radius)")
r=cap(68*5, R_EFF*5, S['wick_floor']*5, 300)
P(f"       dPcap = {r['dPcap']:>7.0f} Pa   vs gravity head {r['dPg']:>7.0f} Pa"
  f"   ->  Q = {r['Q']:>6.0f} W   FAILS: capillary head < gravity head")
P("   (b) keep 12.6 um pores, scale wick THICKNESS 5x  (2.0 mm)")
P("       Thick sintered wicks vapour-blanket: nucleation inside the wick cannot vent.")
P("       Real vapour chambers use 0.2-0.5 mm wicks at EVERY size for this reason.")
P("   (c) keep the wick exactly as designed  (12.6 um, 0.40 mm)  <- the only option")
P("       Then it is not a scale model at all: the wick is identical, so the rig")
P("       tells you about a 340 mm chamber, not about the 68 mm one.")

P("\n3. CAPACITY OF CASE (c) — the bigger chamber carries LESS power")
L()
P(f"   {'size':>7}{'dPcap':>9}{'dPgrav':>9}{'available':>11}{'Pa/W':>8}{'Q cap VERT':>12}{'Q cap HORIZ':>13}")
for f in (1,2,3,5):
    Lm=68*f; wm=(S['pocket'])*f
    v=cap(Lm,R_EFF,S['wick_floor'],wm,True); h=cap(Lm,R_EFF,S['wick_floor'],wm,False)
    P(f"   {f}x{Lm:>5.0f}mm{v['dPcap']:>9.0f}{v['dPg']:>9.0f}{v['dPcap']-v['dPg']:>11.0f}"
      f"{v['g_l']:>8.1f}{v['Q']:>11.0f} W{h['Q']:>12.0f} W")
q1=cap(68,R_EFF,S['wick_floor'],S['pocket'],True)['Q']
q5=cap(340,R_EFF,S['wick_floor'],S['pocket']*5,True)['Q']
P(f"\n   5x has 25x the area but {q5/q1:.2f}x the capillary limit.")
P("   Flow path is 5x longer and the gravity head 5x higher, while capillary head is fixed.")

P("\n4. POWER NEEDED TO REPRODUCE THE DESIGN HEAT FLUX")
L()
q_flux=113/(S['die']/10)**2                     # W/cm2 at the die
P(f"   design flux at the die  = {q_flux:.2f} W/cm2  (113 W over {S['die']:.0f}x{S['die']:.0f} mm)")
for f in (1,2,3,5):
    die=S['die']*f; need=q_flux*(die/10)**2
    lim=cap(68*f,R_EFF,S['wick_floor'],S['pocket']*f,True)['Q']
    ok="OK" if need<=lim else f"DRY-OUT at {lim/need*100:.0f}% of target"
    P(f"   {f}x  die {die:>5.0f} mm  needs {need:>7.0f} W   capillary limit {lim:>5.0f} W   {ok}")

P("\n5. WHAT THE HARDWARE ACTUALLY COSTS AT 5x")
L()
m1=0.218; rim=S['rim']*4*S['L']                  # bond land area at 1x, mm2
for f in (1,5):
    mass=m1*f**3; bond_kN=8.0*(rim*f*f)/1000; charge=1.90*f**3
    P(f"   {f}x  mass {mass*1000:>7.0f} g   bond land {rim*f*f/100:>7.1f} cm2"
      f"   press force {bond_kN:>7.0f} kN ({bond_kN/9.81:>5.1f} tonne)"
      f"   charge {charge:>6.0f} mL")
P(f"   5x also needs a vacuum furnace with a >= 400 mm hot zone held at 850 C,")
P(f"   and a 340 x 340 mm lapped bond interface flat to 0.02 across the whole face.")

P("\n6. WHAT SCALES CLEANLY (so it does not need a big rig to check)")
L()
P("   Lid bending stress  sigma = 0.308.p.a^2/t^2 : scale a and t together -> unchanged.")
P("   Fin conduction, air-side dP, spreading in the base: all classical, well predicted.")
P("   None of these is why the concept was in doubt.")
