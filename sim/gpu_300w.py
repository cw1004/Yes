#!/usr/bin/env python3
"""300 W NVIDIA GPU. What the VC-100 can do, and what the job actually needs."""
import math, sys, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design_spec import AIR, K_AL

P=print; L=lambda c='-': P(c*80)

def fins(n,t,p,H,Lflow,v,k=K_AL):
    """Fin stack: n fins, thickness t, pitch p, height H (mm), flow path Lflow (mm)."""
    H/=1e3; t/=1e3; p/=1e3; Lf=Lflow/1e3; gap=p-t
    Dh=2*gap*H/(gap+H); Re=AIR['rho']*v*Dh/AIR['mu']
    Lp=Lf/(Dh*Re*AIR['Pr']); Nu=min(7.54+0.03*(1/Lp)/(1+0.016*(1/Lp)**0.67),14.)
    h=Nu*AIR['k']/Dh
    m=math.sqrt(2*h/(k*t)); eta=math.tanh(m*H)/(m*H)
    A=n*2*H*Lf; UA=h*eta*A
    Q_air=AIR['rho']*v*(n-1)*gap*H            # m3/s
    mcp=Q_air*AIR['rho']*AIR['cp']
    eff=1-math.exp(-UA/mcp)
    f=64/Re if Re<2300 else 0.316*Re**-0.25
    dP=f*(Lf/Dh)*0.5*AIR['rho']*v*v
    return dict(R=1/(eff*mcp),A=A,h=h,eta=eta,cfm=Q_air*2118.9,dP=dP,Re=Re)

def R_chamber(die_mm, cond_mm2, h_evap=6e4, h_cond=2.2e4, t_floor=1.0):
    Ad=(die_mm/1e3)**2; Ac=cond_mm2/1e6
    return dict(TIM_die=6e-5/(8.0*Ad),           # 60 um bare-die paste, k=8
                floor=t_floor/1e3/(398*Ad),
                evap=1/(h_evap*Ad), vapour=0.003,
                cond=1/(h_cond*Ac), lid=1e-3/(398*Ac),
                TIM_fin=4e-5/Ac, spread=0.018)

P("="*80); P("300 W NVIDIA GPU  —  THERMAL BUDGET"); P("="*80)
P("  300 W = 258 kcal/h  (1 W = 0.8604 kcal/h)  - your conversion is correct.")
P("  Assumed: ~26 x 26 mm bare die (AD102 is 24.7 sq, GA100 28.7 sq), no IHS.")
P("  Board total 300 W; ~250 W at the die, ~50 W in VRAM/VRM that the cooler")
P("  must also carry. Budget below is for the full 300 W.")

P("\n"); L('='); P("1. TARGET RESISTANCE"); L('=')
P(f"{'target die T':>14}{'air 25 C':>12}{'air 35 C':>12}{'air 40 C':>12}")
for Tj in (70,80,85,90):
    P(f"{Tj:>12} C" + "".join(f"{(Tj-Ta)/300:>11.3f}" for Ta in (25,35,40)) + "   K/W")
P("  A shipping 300-350 W card runs ~65-75 C in a 25 C room -> R(j-a) ~ 0.12-0.15 K/W.")

P("\n"); L('='); P("2. WHAT THE DRAWN VC-100 (68 x 68) DOES"); L('=')
rc=R_chamber(26, 68*68); rv=sum(rc.values())
P(f"  chamber 68 x 68, 26 mm die : R_vc = {rv:.3f} K/W  ({rv*300:.0f} K at 300 W)")
for v in (2,4,6):
    rs=fins(43,0.4,1.5,20,68,v)
    P(f"    + 68 mm fin stack @ {v} m/s : R_sink {rs['R']:.3f}  total {rv+rs['R']:.3f}"
      f"  ->  die {25+300*(rv+rs['R']):>4.0f} C   ({rs['cfm']:.0f} CFM)")
P("  Condenser area is the problem: 68 x 68 = 46 cm2. A 300 W card needs 3000-5000 cm2 of fin.")

P("\n"); L('='); P("3. CASE A - SELF-COOLED CARD (axial fans on the card)"); L('=')
P("  Vapour chamber grown to cover die + VRAM. Fins along the card, fans blow through.")
P(f"{'chamber':>12}{'fin stack (L x W x H)':>26}{'pitch':>7}{'fins':>6}{'air':>7}"
  f"{'R_vc':>7}{'R_sink':>8}{'die @25C':>10}{'CFM':>7}")
for chW,chL,Lf,W_,H,p,v in [(70,100,90,110,30,2.0,2.0),(70,100,90,110,40,2.0,2.5),
                            (70,110,90,120,45,1.8,3.0),(70,110,90,130,50,1.8,3.0)]:
    rc=R_chamber(26,chW*chL); rvv=sum(rc.values())
    n=int(W_/p); rs=fins(n,0.4,p,H,Lf,v)
    P(f"{chW}x{chL:>7}{Lf}x{W_}x{H:>16}{p:>7.1f}{n:>6}{v:>5.1f}m/s"
      f"{rvv:>7.3f}{rs['R']:>8.3f}{25+300*(rvv+rs['R']):>9.0f}C{rs['cfm']:>7.0f}")
P("  Two 92 mm axial fans deliver 60-90 CFM at the low static pressure a card allows.")
P("  This is exactly the 2.5-3 slot cooler shipping on every 300 W card.")

P("\n"); L('='); P("4. CASE B - PASSIVE SERVER CARD (A100/L40S style, chassis airflow)"); L('=')
P("  No fan on the card. Fins run front-to-back; the chassis pushes air the full length.")
P(f"{'fin stack':>22}{'pitch':>7}{'fins':>6}{'air':>8}{'R_sink':>8}"
  f"{'die @25C':>10}{'@35C':>7}{'CFM':>7}{'dP Pa':>8}")
for Lf,W_,H,p,v in [(250,100,28,1.8,4),(250,100,28,1.8,6),(250,110,32,1.6,6),
                    (270,110,34,1.6,8),(270,110,34,1.4,10)]:
    rc=R_chamber(26,W_*120); rvv=sum(rc.values())
    n=int(W_/p); rs=fins(n,0.3,p,H,Lf,v)
    P(f"{Lf}x{W_}x{H:>14}{p:>7.1f}{n:>6}{v:>6.1f}m/s{rs['R']:>8.3f}"
      f"{25+300*(rvv+rs['R']):>9.0f}C{35+300*(rvv+rs['R']):>6.0f}C{rs['cfm']:>7.0f}{rs['dP']:>8.0f}")
P("  Server fans give the static pressure a 1.5 mm pitch needs; a desktop fan cannot.")
P("  This is why A100/L40S are passive but REQUIRE a qualified chassis.")

P("\n"); L('='); P("5. WHERE THE HEAT ACTUALLY GOES - budget at 300 W, die 70 C, air 25 C"); L('=')
rc=R_chamber(26,70*100)
for k,v_ in sorted(rc.items(),key=lambda x:-x[1]):
    P(f"    {k:<10}{v_:>7.4f} K/W  = {v_*300:>5.1f} K")
P(f"    {'chamber':<10}{sum(rc.values()):>7.4f} K/W  = {sum(rc.values())*300:>5.1f} K")
P(f"    {'fin->air':<10}{0.15-sum(rc.values()):>7.4f} K/W  = {(0.15-sum(rc.values()))*300:>5.1f} K   (the rest)")
P("  The vapour chamber is worth having here - 26 mm die into a 70 x 100 condenser is")
P("  exactly the spreading job it is good at - but it is still only ~1/3 of the budget.")
