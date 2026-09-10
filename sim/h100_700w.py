#!/usr/bin/env python3
"""H100 SXM5, 700 W. Air vs direct-to-chip liquid, with the interface stack broken out."""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import AIR, K_AL
P=print; L=lambda c='-': P(c*82)
Q=700.0; DIE=28.5          # GH100 = 814 mm2
A_DIE=(DIE/1e3)**2

P("="*82); P("H100 SXM5  —  700 W  =  602 kcal/h  =  2388 BTU/h   (your figures check out)"); P("="*82)
P(f"  GH100 die 814 mm2 = {DIE:.1f} mm square  ->  flux {Q/(814/100):.0f} W/cm2")
P("  Package also carries 6 HBM3 stacks. The cooler must take both.")

P("\n"); L('='); P("1. THE TEMPERATURE BUDGET IS SMALLER THAN IT LOOKS"); L('=')
P("  H100 slows down near 92 C junction. HBM3 wants <= 85-95 C and sits at the")
P("  package edge where spreading is worst - HBM is usually the binding limit, not the die.")
P(f"\n{'target':>12}{'inlet 25 C':>13}{'inlet 30 C':>13}{'inlet 35 C':>13}")
for Tj in (75,85,92):
    P(f"{'die '+str(Tj)+' C':>12}" + "".join(f"{(Tj-Ta)/Q:>13.4f}" for Ta in (25,30,35)) + "  K/W")

P("\n"); L('='); P("2. AIR — INTERFACE STACK DECIDES IT"); L('=')
def chain(soldered_fins, h_evap, spread):
    r={"TIM (bare die, 60 um)":6e-5/(8.0*A_DIE),
       "chamber floor 1 mm":1e-3/(398*A_DIE),
       "evaporator":1/(h_evap*A_DIE),
       "vapour transport":0.003,
       "condenser 70x100":1/(2.2e4*7e-3),
       "lid":1e-3/(398*7e-3),
       "lid -> fin joint":0.0 if soldered_fins else 4e-5/7e-3,
       "spreading":spread}
    return r
for lab,sold,he,sp in [("bolted fins + TIM, ordinary wick",False,6e4,0.018),
                       ("SOLDERED fins, high-flux wick",True,1.0e5,0.012)]:
    r=chain(sold,he,sp); t=sum(r.values())
    P(f"\n  {lab}")
    for k,v in sorted(r.items(),key=lambda x:-x[1]):
        if v>0: P(f"     {k:<28}{v:>8.4f} K/W = {v*Q:>5.1f} K")
    P(f"     {'CHAMBER TOTAL':<28}{t:>8.4f} K/W = {t*Q:>5.1f} K")
    for Ta,Tj in ((25,85),(30,85),(35,85)):
        left=(Tj-Ta)/Q-t
        P(f"     inlet {Ta} C, die {Tj} C -> heatsink must reach "
          + (f"{left:.4f} K/W" if left>0 else "IMPOSSIBLE, chamber alone exceeds the budget"))

P("\n"); L('='); P("3. WHAT THAT HEATSINK LOOKS LIKE"); L('=')
def fins(n,t,p,H,Lf,v):
    H/=1e3;t/=1e3;p/=1e3;Lf/=1e3;gap=p-t
    Dh=2*gap*H/(gap+H); Re=AIR['rho']*v*Dh/AIR['mu']
    Lp=Lf/(Dh*Re*AIR['Pr']); Nu=min(7.54+0.03*(1/Lp)/(1+0.016*(1/Lp)**0.67),14.)
    h=Nu*AIR['k']/Dh; m=math.sqrt(2*h/(390*t)); eta=math.tanh(m*H)/(m*H)   # copper fins
    A=n*2*H*Lf; UA=h*eta*A; Qa=AIR['rho']*v*(n-1)*gap*H
    mcp=Qa*AIR['rho']*AIR['cp']; eff=1-math.exp(-UA/mcp)
    f=64/Re if Re<2300 else 0.316*Re**-0.25
    return dict(R=1/(eff*mcp),cfm=Qa*2118.9,dP=f*(Lf/Dh)*0.5*AIR['rho']*v*v,A=A)
rc=sum(chain(True,1.0e5,0.012).values())
P(f"  chamber = {rc:.4f} K/W. Copper skived fins, soldered to the chamber.")
P(f"{'fin stack LxWxH':>20}{'pitch':>7}{'fins':>6}{'air':>8}{'R sink':>9}"
  f"{'die @25C':>10}{'@35C':>7}{'CFM':>7}{'dP Pa':>8}")
for Lf,Wd,H,p,v in [(120,90,40,1.5,6),(150,90,50,1.4,8),(180,100,60,1.3,10),(180,100,60,1.2,12)]:
    n=int(Wd/p); r=fins(n,0.3,p,H,Lf,v)
    P(f"{Lf}x{Wd}x{H:>13}{p:>7.1f}{n:>6}{v:>6.0f}m/s{r['R']:>9.4f}"
      f"{25+Q*(rc+r['R']):>9.0f}C{35+Q*(rc+r['R']):>6.0f}C{r['cfm']:>7.0f}{r['dP']:>8.0f}")
P("  This is a DGX-class 8U build: a wall of high-static fans, 200-400 Pa, ~80 dBA.")
P("  It works, but the chassis is the product - not the heatsink.")

P("\n"); L('='); P("4. DIRECT-TO-CHIP LIQUID — the easy answer at 700 W"); L('=')
P(f"{'flow':>8}{'water rise':>12}{'plate R':>10}{'plate dT':>10}"
  f"{'die @32C':>10}{'@40C':>8}{'@45C':>8}  (facility water in)")
for lpm in (1.0,1.5,2.0):
    mdot=lpm/60*997/1000; dTw=Q/(mdot*4180)
    for Rcp in (0.025,):
        P(f"{lpm:>6.1f}L/m{dTw:>11.1f}K{Rcp:>10.3f}{Rcp*Q:>9.1f}K"
          + "".join(f"{Tw+dTw+Rcp*Q:>9.0f}C" for Tw in (32,40,45)))
P("  0.025 K/W is an ordinary copper micro-channel plate on a bare die.")
P("  It BEATS the vapour chamber (0.047 K/W) outright - there is no evaporate-condense")
P("  chain and no fin joint, just silicon -> TIM -> copper -> water.")
P("  At 700 W the cold plate REPLACES the vapour chamber. Do not put both in series.")

P("\n"); L('='); P("5. VERDICT"); L('=')
P("  Air  : possible, but only as a soldered-fin copper stack in a DGX-class chassis")
P("         with 100+ CFM per GPU. Bolted fins with a TIM joint do NOT make it.")
P("  D2C  : 1.5 L/min of 40 C facility water puts the die at ~66 C with margin to")
P("         spare, in a fraction of the volume. This is what GB200-era racks do.")
P("  And the practical blocker: an SXM5 module is not something you retrofit. The")
P("  socket specifies a mounting preload; over-force cracks the package, under-force")
P("  starves the TIM. Whatever you build has to meet NVIDIA's load-frame spec.")
