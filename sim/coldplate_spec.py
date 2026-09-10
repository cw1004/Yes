#!/usr/bin/env python3
"""CP-100 direct-to-chip cold plate for H100 SXM5, 700 W.
Single source of truth for drawings/cp_sheets.py."""
import math

SPEC = dict(
    # --- service ---
    Q=700.0, die=28.5, Tw_in=45.0, Tdie_max=75.0,       # 45 C warm-water facility loop
    # --- CP-101 body, Cu C10200 ---
    L=76.0, W=72.0, H_body=6.0, base_t=1.5,
    fin_w=50.0, fin_L=40.0,                              # fin field: 50 across flow, 40 along
    fin_t=0.15, ch_w=0.25, fin_h=4.0,                    # skived
    plenum=7.0, pocket_d=4.5,                            # pocket = base_t..H_body
    tip_clr=0.05,                                        # fin tip to cover, max
    # --- CP-102 cover, vacuum brazed (no elastomer inside the loop) ---
    cover_t=5.0, port_boss=6.0, port_id=8.0, port="G1/4 BSPP",
    braze="BCuP-5 preform ring, perimeter only",
    # --- mount ---
    mnt_screw="M3 x 0.5", mnt_n=4, mnt_edge=6.0, belleville="2 x stacked, series",
    # --- loop ---
    flow_lpm=1.5, dP_budget=50.0,                        # kPa per cold plate
)
S=SPEC
S['ch_p']=S['fin_t']+S['ch_w']
S['n_ch']=int(S['fin_w']/S['ch_p'])
S['pocket_L']=S['fin_L']+2*S['plenum']
S['pocket_W']=S['fin_w']
S['H_total']=S['H_body']+S['cover_t']+S['port_boss']

class Fluid:
    def __init__(s,n,rho,cp,k,mu): s.name,s.rho,s.cp,s.k,s.mu=n,rho,cp,k,mu
    @property
    def Pr(s): return s.mu*s.cp/s.k
WATER=Fluid("DI water + inhibitor",988.,4181.,0.643,5.47e-4)      # at 50 C
PG25 =Fluid("PG25 (25% propylene glycol)",1015.,3950.,0.440,1.35e-3)
K_CU=390.

def thermal(fl, lpm=None, fin_h=None, ch_w=None, fin_t=None, fin_L=None, fin_w=None):
    lpm=lpm or S['flow_lpm']; H=(fin_h or S['fin_h'])/1e3
    w=(ch_w or S['ch_w'])/1e3; t=(fin_t or S['fin_t'])/1e3
    Lf=(fin_L or S['fin_L'])/1e3; Wf=(fin_w or S['fin_w'])/1e3
    n=int(Wf/(w+t))
    Aflow=n*w*H; Qv=lpm/60/1000.
    v=Qv/Aflow
    Dh=2*w*H/(w+H); Re=fl.rho*v*Dh/fl.mu
    Lp=Lf/(Dh*Re*fl.Pr) if Re>0 else 1e9                  # dimensionless entry length
    Nu=5.4+0.028*(1/Lp)/(1+0.008*(1/Lp)**0.8)             # rect duct, 3 sides heated, developing
    Nu=min(Nu,14.0)
    h=Nu*fl.k/Dh
    m=math.sqrt(2*h/(K_CU*t)); eta=math.tanh(m*H)/(m*H)
    A_fin=n*2*H*Lf; A_base=n*w*Lf
    UA=h*(A_base+eta*A_fin)
    mcp=Qv*fl.rho*fl.cp
    eff=1-math.exp(-UA/mcp)
    R_fluid=1/(eff*mcp)
    fRe=84.0                                              # high-aspect rectangular duct
    f=fRe/Re
    dP=f*(Lf/Dh)*0.5*fl.rho*v*v
    dP_tot=dP*3.0                                         # + headers, entrance, ports
    return dict(n=n,v=v,Re=Re,Nu=Nu,h=h,eta=eta,UA=UA,mcp=mcp,eff=eff,
                R_fluid=R_fluid,dP=dP_tot/1000.,dTw=S['Q']/mcp,Dh=Dh*1e3)

def budget(fl, **kw):
    Ad=(S['die']/1e3)**2
    r=dict(TIM=6e-5/(13.0*Ad),                            # 60 um, k=13 high-performance
           base=S['base_t']/1e3/(K_CU*Ad),
           spread=0.0050,
           fluid=thermal(fl,**kw)['R_fluid'])
    return r,sum(r.values())

if __name__=="__main__":
    P=print; L=lambda c='-': P(c*76)
    P("="*76); P("CP-100  DIRECT-TO-CHIP COLD PLATE  —  H100 SXM5, 700 W"); P("="*76)
    P(f"  fin field {S['fin_w']:.0f} x {S['fin_L']:.0f} mm, skived Cu")
    P(f"  fin {S['fin_t']:.2f} thk / channel {S['ch_w']:.2f} / pitch {S['ch_p']:.2f} / "
      f"height {S['fin_h']:.1f}  ->  {S['n_ch']} channels")
    P(f"  base under die {S['base_t']:.1f} mm  |  envelope {S['L']:.0f} x {S['W']:.0f} x {S['H_total']:.0f} mm")

    P("\n"); L('='); P("THERMAL-HYDRAULIC, AT 1.5 L/min"); L('=')
    P(f"{'coolant':>28}{'v':>8}{'Re':>7}{'h':>10}{'eta':>7}{'R fluid':>10}{'dT water':>10}{'dP':>9}")
    for fl in (WATER,PG25):
        t=thermal(fl)
        P(f"{fl.name:>28}{t['v']:>7.2f}m/s{t['Re']:>7.0f}{t['h']:>8.0f}W{t['eta']:>7.2f}"
          f"{t['R_fluid']:>10.4f}{t['dTw']:>9.1f}K{t['dP']:>7.1f}kPa")

    P("\n"); L('='); P("RESISTANCE BUDGET  (die to coolant inlet)"); L('=')
    for fl in (WATER,PG25):
        r,tot=budget(fl)
        P(f"\n  {fl.name}")
        for k,v in sorted(r.items(),key=lambda x:-x[1]):
            P(f"     {k:<10}{v:>8.4f} K/W = {v*S['Q']:>5.1f} K")
        P(f"     {'TOTAL':<10}{tot:>8.4f} K/W = {tot*S['Q']:>5.1f} K")
        for Tin in (32,40,45,50):
            P(f"     water in {Tin} C  ->  die {Tin+tot*S['Q']:>5.1f} C"
              + ("   OK" if Tin+tot*S['Q']<=S['Tdie_max'] else "   over target"))

    P("\n"); L('='); P("FLOW SENSITIVITY  (PG25, the worst case)"); L('=')
    P(f"{'flow':>9}{'v':>8}{'R fluid':>10}{'R total':>10}{'die @45C':>11}{'dP':>9}")
    for lpm in (0.75,1.0,1.5,2.0,3.0):
        t=thermal(PG25,lpm=lpm); _,tot=budget(PG25,lpm=lpm)
        P(f"{lpm:>7.2f}L/m{t['v']:>7.2f}m/s{t['R_fluid']:>10.4f}{tot:>10.4f}"
          f"{45+tot*S['Q']:>10.1f}C{t['dP']:>7.1f}kPa")

    P("\n"); L('='); P("FIN GEOMETRY TRADE  (PG25, 1.5 L/min)"); L('=')
    P(f"{'ch w':>7}{'fin t':>7}{'height':>8}{'n':>6}{'eta':>7}{'R total':>10}{'die @45C':>11}{'dP':>9}")
    for cw,ft,fh in [(0.40,0.20,3.0),(0.25,0.15,3.0),(0.25,0.15,4.0),(0.25,0.15,5.0),
                     (0.20,0.12,4.0),(0.15,0.10,4.0)]:
        t=thermal(PG25,ch_w=cw,fin_t=ft,fin_h=fh); _,tot=budget(PG25,ch_w=cw,fin_t=ft,fin_h=fh)
        mark="  <- SPECIFIED" if (cw,ft,fh)==(0.25,0.15,4.0) else ""
        P(f"{cw:>7.2f}{ft:>7.2f}{fh:>7.1f}mm{t['n']:>6}{t['eta']:>7.2f}{tot:>10.4f}"
          f"{45+tot*S['Q']:>10.1f}C{t['dP']:>7.1f}kPa{mark}")

    P("\n"); L('='); P("HEADROOM TO THE NEXT PARTS"); L('=')
    _,tot=budget(PG25)
    P(f"{'part':>22}{'TDP':>8}{'die @45C water':>18}{'verdict':>12}")
    for n,q in [("H100 SXM5",700),("B200 SXM",1000),("GB200 Blackwell",1200)]:
        P(f"{n:>22}{q:>6} W{45+tot*q:>16.0f} C{'OK' if 45+tot*q<=90 else 'raise flow':>12}")
    P("  Same plate, 3.0 L/min: " + ", ".join(
        f"{n} {45+budget(PG25,lpm=3.0)[1]*q:.0f} C" for n,q in
        [("H100",700),("B200",1000),("GB200",1200)]))
