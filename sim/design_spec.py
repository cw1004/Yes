#!/usr/bin/env python3
"""Corrected design: parametric spec + performance validation.
Single source of truth for the manufacturing drawings (drawings/sheets.py)."""
import math

# ============================================================ SPEC (all mm)
SPEC = dict(
    # --- VC-101 chamber base, Cu C1100 ---
    L=68.0, W=68.0, base_t=4.0,
    pocket=60.0, pocket_d=3.0, pocket_r=3.0,     # floor = base_t - pocket_d = 1.0
    rim=4.0,
    post_d=2.0, post_pitch=6.0, post_edge=3.0,   # posts span pocket floor -> lid
    groove_w=0.20, groove_d=0.20, groove_p=0.70,
    # --- VC-102 lid : fill port is through the LID (a boss on the 4.0 mm
    #     edge face cannot accept a 3.0 tube - moved topside) ---
    lid_t=1.0, lid_post_clr=2.6,
    fill_x=34.0, fill_y=7.0, fill_hole=1.20, fill_cbore=3.20, fill_cbore_d=0.30,
    tube_od=3.0, tube_id=2.0, tube_len=25.0, fin_relief_d=7.0, fin_relief_h=2.0,
    # --- VC-103 wick ---
    powder_lo=45e-6, powder_hi=75e-6, poro=0.55,
    wick_floor=0.40, wick_wall=0.30, wick_lid=0.20,
    # --- VC-201/202 fin stacks ---
    finA_n=43, finA_t=0.40, finA_p=1.5, finA_h=20.0,
    finB_n=13, finB_t=1.00, finB_p=5.0, finB_h=20.0,
    fin_base=2.0,
    # --- service ---
    die=20.0, Tj_max=100.0, T_air=25.0,
)
S=SPEC
S['floor_t']=S['base_t']-S['pocket_d']
S['post_h']=S['pocket_d']
S['post_n']=int((S['pocket']-2*S['post_edge'])/S['post_pitch'])+1
S['post_total']=S['post_n']**2
S['groove_n']=int(S['pocket']/S['groove_p'])
S['chamber_h']=S['base_t']+S['lid_t']
S['overallA']=S['chamber_h']+S['fin_base']+S['finA_h']
S['overallB']=S['chamber_h']+S['fin_base']+S['finB_h']

# ============================================================ fluids
class F:
    def __init__(s,n,rho,mu,sig,hfg,muv,M,ant):
        s.name,s.rho_l,s.mu_l,s.sigma,s.hfg,s.mu_v,s.M,s.ant=n,rho,mu,sig,hfg,muv,M,ant
    def psat(s,T):
        A,B,C=s.ant; return 10**(A-B/(T+273.15+C))*1e5
    def rho_v(s,T): return s.psat(T)*s.M/(8.314*(T+273.15))
WATER=F("water",983.,4.7e-4,0.0662,2.36e6,1.1e-5,0.018015,(5.40221,1838.675,-31.737))
METH =F("methanol",750.,3.5e-4,0.0190,1.10e6,1.1e-5,0.032046,(5.20409,1581.341,-33.50))
AIR=dict(rho=1.16,cp=1005.,k=0.0263,mu=1.85e-5,Pr=0.71); K_CU,K_AL=398.,200.

# ============================================================ wick
def wick(powder_d, poro=S['poro']):
    r_eff=0.21*powder_d
    K=powder_d**2*poro**3/(150*(1-poro)**2)
    return r_eff,K

def capillary_limit(fl,T,powder_d,tilt_mm):
    r_eff,K=wick(powder_d)
    A_w=(S['pocket']*S['wick_floor']*1e-6)
    A_gr=S['groove_n']*S['groove_w']*S['groove_d']*1e-6
    Leff=S['pocket']/2*1e-3
    dPcap=2*fl.sigma/r_eff
    dPg=fl.rho_l*9.81*tilt_mm*1e-3
    g_l=fl.mu_l*Leff/(fl.hfg*fl.rho_l*K*(A_w+A_gr*0.35))
    hv=(S['pocket_d']-S['wick_floor']-S['wick_lid'])*1e-3; Av=S['pocket']*1e-3*hv
    Dh=2*hv*S['pocket']*1e-3/(hv+S['pocket']*1e-3)
    g_v=32*fl.mu_v*Leff/(Dh**2*fl.rho_v(T)*fl.hfg*Av)
    avail=dPcap-dPg
    return dict(r_eff=r_eff,K=K,dPcap=dPcap,dPg=dPg,
                Q=avail/(g_l+g_v) if avail>0 else 0.0)

# ============================================================ fin stack
def fins(n,t,p,H,v_air,L=S['L']*1e-3):
    H*=1e-3; t*=1e-3; p*=1e-3; gap=p-t
    Dh=2*gap*H/(gap+H); Re=AIR['rho']*v_air*Dh/AIR['mu']
    Lp=L/(Dh*Re*AIR['Pr']); Nu=min(7.54+0.03*(1/Lp)/(1+0.016*(1/Lp)**0.67),14.)
    h=Nu*AIR['k']/Dh
    m=math.sqrt(2*h/(K_AL*t)); eta=math.tanh(m*H)/(m*H)
    A=n*2*H*L; UA=h*eta*A
    mcp=AIR['rho']*v_air*(n-1)*gap*H*AIR['cp']
    eff=1-math.exp(-UA/mcp)
    return dict(h=h,eta=eta,A=A,Re=Re,R=1/(eff*mcp))

def fins_nat(n,t,p,H,dT=40.,L=S['L']*1e-3):
    H*=1e-3; t*=1e-3; p*=1e-3; b=p-t
    nu=AIR['mu']/AIR['rho']; al=nu/AIR['Pr']
    Ra=9.81*(1/318.15)*dT*b**3/(nu*al)*(b/H)
    Nu=(576/Ra**2+2.873/math.sqrt(Ra))**-0.5
    h=Nu*AIR['k']/b
    m=math.sqrt(2*h/(K_AL*t)); eta=math.tanh(m*H)/(m*H)
    A=n*2*H*L
    return dict(h=h,eta=eta,A=A,R=1/(h*eta*A))

R_VC=0.185   # corrected: thicker floor wick + posts improve evap & spreading
def R_vc_calc():
    Adie=(S['die']*1e-3)**2; Acond=(S['L']*1e-3)**2
    r=dict(TIM_die=1e-5/Adie, floor=S['floor_t']*1e-3/(K_CU*Adie),
           evap=1/(2.5e4*Adie), vapor=0.004, cond=1/(1.8e4*Acond),
           lid=S['lid_t']*1e-3/(K_CU*Acond), TIM_fin=5e-5/Acond, spread=0.035)
    return r,sum(r.values())

# ============================================================ charge
def charge_volume():
    p=S['pocket']
    v_floor=p*p*S['wick_floor']*S['poro']
    v_wall =4*p*S['pocket_d']*S['wick_wall']*S['poro']
    v_lid  =p*p*S['wick_lid']*S['poro']
    v_gr   =S['groove_n']*S['groove_w']*S['groove_d']*p
    void=v_floor+v_wall+v_lid+v_gr
    return dict(floor=v_floor,wall=v_wall,lid=v_lid,groove=v_gr,
                void=void,charge=round(void*1.25/50)*50/1000.)

def stress(p_Pa,a_mm,t_mm): return 0.308*p_Pa*(a_mm**2)/(t_mm**2)/1e6

if __name__=="__main__":
    P=print; L=lambda c='-': P(c*74)
    P("="*74); P("CORRECTED DESIGN - VALIDATION"); P("="*74)
    P(f"base {S['L']}x{S['W']}x{S['base_t']} | pocket {S['pocket']}sq x{S['pocket_d']}dp "
      f"| floor {S['floor_t']} | lid {S['lid_t']} | chamber H {S['chamber_h']}")
    P(f"posts {S['post_n']}x{S['post_n']}={S['post_total']} off D{S['post_d']} @{S['post_pitch']} pitch")
    P(f"grooves {S['groove_n']} off {S['groove_w']}Wx{S['groove_d']}D @{S['groove_p']}")
    P(f"overall  Config A {S['overallA']} mm | Config B {S['overallB']} mm")

    P("\n--- WICK POWDER SELECTION (methanol is the worst case) ---")
    P(f"{'powder':>10}{'r_eff':>8}{'K[m2]':>11}{'dPcap':>8}"
      f"{'Qcap H2O v':>12}{'Qcap MeOH v':>13}")
    best=None
    for d in [25e-6,45e-6,60e-6,75e-6,100e-6,150e-6]:
        w=capillary_limit(WATER,60.,d,68.); m=capillary_limit(METH,60.,d,68.)
        P(f"{d*1e6:>9.0f}u{w['r_eff']*1e6:>7.1f}u{w['K']:>11.2e}{w['dPcap']:>8.0f}"
          f"{w['Q']:>12.0f}{m['Q']:>13.0f}")
        if m['Q']>0 and (best is None or m['Q']>best[1]): best=(d,m['Q'])
    P(f"  -> SELECT powder {S['powder_lo']*1e6:.0f}-{S['powder_hi']*1e6:.0f} um "
      f"(r_eff {0.21*60e-6*1e6:.0f} um, pore ~{2*0.21*60e-6*1e6:.0f} um)")

    P("\n--- OPERATING LIMITS AT SELECTED WICK (60 um powder) ---")
    for fl in (WATER,METH):
        for tilt,lab in [(0.,'horizontal'),(68.,'vertical')]:
            r=capillary_limit(fl,60.,60e-6,tilt)
            P(f"  {fl.name:>9} {lab:<11} dPcap={r['dPcap']:>6.0f} Pa  "
              f"dPgrav={r['dPg']:>5.0f} Pa  Qcap={r['Q']:>6.0f} W")

    P("\n--- THERMAL RESISTANCE ---")
    rd,rtot=R_vc_calc()
    for k,v in rd.items(): P(f"   {k:<10}{v:7.4f} K/W")
    P(f"   {'R_vc TOTAL':<10}{rtot:7.4f} K/W")

    P("\n--- COOLING CAPACITY (Tj 100 C, air 25 C, dT 75 K) ---")
    P(f"{'config':<44}{'R_sink':>8}{'R_tot':>8}{'Q':>8}")
    rows=[]
    for lab,cfg,v in [
      ("A  43 fin @1.5mm, 1 m/s",'A',1.0),("A  43 fin @1.5mm, 2 m/s",'A',2.0),
      ("A  43 fin @1.5mm, 3 m/s",'A',3.0),("A  43 fin @1.5mm, 4 m/s",'A',4.0),
      ("B  11 fin @6.0mm, natural convection",'B',None)]:
        if cfg=='A': r=fins(S['finA_n'],S['finA_t'],S['finA_p'],S['finA_h'],v)
        else:        r=fins_nat(S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'])
        Rt=r['R']+rtot; rows.append((lab,r['R'],Rt,75/Rt))
        P(f"{lab:<44}{r['R']:>8.2f}{Rt:>8.2f}{75/Rt:>7.0f} W")

    P("\n--- CHARGE ---")
    c=charge_volume()
    for k in ('floor','wall','lid','groove'): P(f"   {k:<8}{c[k]:>8.1f} mm3")
    P(f"   {'VOID':<8}{c['void']:>8.1f} mm3 = {c['void']/1000:.2f} mL")
    P(f"   CHARGE (125% of void) = {c['charge']:.2f} mL  water, DI 18 MOhm.cm, deaerated")

    P("\n--- LID STRESS WITH POST ARRAY (max unsupported span = post pitch) ---")
    P(f"{'T[C]':>6}{'Psat[kPa]':>11}{'|dp|[kPa]':>11}{'sigma[MPa]':>12}{'SF vs 70':>10}")
    for T in [25,60,100,125,150]:
        ps=WATER.psat(T)/1e3; dp=abs(ps-101.3)
        s=stress(dp*1e3,S['post_pitch'],S['lid_t'])
        P(f"{T:>6}{ps:>11.1f}{dp:>11.1f}{s:>12.2f}{70/s if s>0 else 999:>10.0f}")

    P("\n--- MASS ---")
    rho_cu,rho_al=8.96e-3,2.70e-3   # g/mm3
    v_base=S['L']*S['W']*S['base_t']-S['pocket']**2*S['pocket_d']+S['post_total']*math.pi*(S['post_d']/2)**2*S['post_h']
    v_lid=S['L']*S['W']*S['lid_t']
    v_wick=(S['pocket']**2*(S['wick_floor']+S['wick_lid'])+4*S['pocket']*S['pocket_d']*S['wick_wall'])*(1-S['poro'])
    v_finA=(S['L']*S['W']*S['fin_base']+S['finA_n']*S['L']*S['finA_h']*S['finA_t'])
    v_finB=(S['L']*S['W']*S['fin_base']+S['finB_n']*S['L']*S['finB_h']*S['finB_t'])
    mA=(v_base+v_lid+v_wick)*rho_cu+v_finA*rho_al+c['charge']*1000*1e-3*0.983
    mB=(v_base+v_lid+v_wick)*rho_cu+v_finB*rho_al+c['charge']*1000*1e-3*0.983
    P(f"   Cu base {v_base*rho_cu:6.1f} g | lid {v_lid*rho_cu:5.1f} g | wick {v_wick*rho_cu:5.1f} g")
    P(f"   Al fin A {v_finA*rho_al:5.1f} g | fin B {v_finB*rho_al:5.1f} g | water {c['charge']*0.983:4.2f} g")
    P(f"   TOTAL  Config A = {mA:.0f} g   Config B = {mB:.0f} g")
