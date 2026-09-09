#!/usr/bin/env python3
"""
FINAL MAXSORB III VERSION - 1.76x METHANOL  vapor chamber
Feasibility / cooling-capacity simulation.

Models:
  A. Steady-state thermal resistance network (junction -> air)
  B. Heat-pipe operating limits (capillary, gravity, boiling, entrainment, sonic)
  C. Adsorption equilibrium (Dubinin-Astakhov) -> working-fluid inventory balance
  D. Transient burst response incl. adsorption/desorption enthalpy buffer

Units: SI unless suffixed.  Reference T = 60 C unless noted.
"""
import math

# ----------------------------------------------------------------- properties
class Methanol:
    name="methanol"; M=0.032046; R=8.314/0.032046
    @staticmethod
    def psat(T_C):                       # Antoine (NIST), bar -> Pa
        A,B,C = 5.20409,1581.341,-33.50
        return 10**(A - B/(T_C+273.15+C)) * 1e5
    rho_l=750.; mu_l=3.5e-4; sigma=0.0190; hfg=1.10e6; k_l=0.196; cp_l=2600.
    mu_v=1.1e-5
    @classmethod
    def rho_v(cls,T_C): return cls.psat(T_C)/(cls.R*(T_C+273.15))

class Water:
    name="water"; rho_l=983.; mu_l=4.7e-4; sigma=0.0662; hfg=2.36e6; mu_v=1.1e-5
    @staticmethod
    def psat(T_C):
        A,B,C=5.40221,1838.675,-31.737
        return 10**(A-B/(T_C+273.15+C))*1e5
    @classmethod
    def rho_v(cls,T_C): return cls.psat(T_C)*0.018015/(8.314*(T_C+273.15))

AIR=dict(rho=1.16,cp=1005.,k=0.0263,mu=1.85e-5,Pr=0.71)
K_CU, K_AL = 398., 200.

# ----------------------------------------------------------------- geometry
G = dict(
    L=0.068, W=0.068,            # chamber footprint
    t_lid=1.0e-3, t_base_wall=1.0e-3,
    h_cav=3.0e-3,                # internal cavity height
    t_wick=0.3e-3, eps=0.60, d_pore=200e-6,
    fin_h=0.020, fin_t=0.4e-3, fin_pitch=1.5e-3,
    die=0.020,                   # 20x20 mm heat source
    res=(0.068,0.010,0.0022),    # reservoir housing
    m_carbon=0.5e-3,             # kg
    V_charge=1.0e-6,             # m3  (1.0 mL)
)

# ================================================================= A. SINK
def fin_stack(n_fins, v_air, fin_h=G['fin_h'], fin_t=G['fin_t'],
              pitch=G['fin_pitch'], L=G['L']):
    """Laminar duct convection + caloric (effectiveness-NTU) resistance."""
    gap = pitch - fin_t
    if gap <= 0: raise ValueError
    Dh  = 2*gap*fin_h/(gap+fin_h)
    Re  = AIR['rho']*v_air*Dh/AIR['mu']
    # thermally-developing parallel-plate duct, both walls heated
    Lp  = L/(Dh*Re*AIR['Pr']) if Re>0 else 1e9
    Nu  = 7.54 + 0.03*(1/Lp)/(1+0.016*(1/Lp)**0.67) if Lp>0 else 7.54
    Nu  = min(Nu, 14.0)
    h   = Nu*AIR['k']/Dh
    m   = math.sqrt(2*h/(K_AL*fin_t)); eta = math.tanh(m*fin_h)/(m*fin_h)
    A   = n_fins*2*fin_h*L
    UA  = h*eta*A
    Aflow = (n_fins-1)*gap*fin_h
    mdot_cp = AIR['rho']*v_air*Aflow*AIR['cp']
    if mdot_cp <= 0: return dict(R=1e9)
    NTU = UA/mdot_cp; eff = 1-math.exp(-NTU)
    return dict(h=h,eta=eta,A=A,Re=Re,Nu=Nu,UA=UA,mdot_cp=mdot_cp,
                NTU=NTU,eff=eff,R=1/(eff*mdot_cp), span=n_fins*pitch)

def fin_stack_natural(n_fins, fin_h=G['fin_h'], pitch=G['fin_pitch'],
                      fin_t=G['fin_t'], L=G['L'], dT=40.):
    """Natural convection between vertical plates (Elenbaas / Bar-Cohen)."""
    b = pitch-fin_t
    nu=AIR['mu']/AIR['rho']; beta=1/(273.15+45)
    Ra_b = 9.81*beta*dT*b**3/(nu*(nu/AIR['Pr']))*(b/fin_h)
    Nu_b = (576/Ra_b**2 + 2.873/math.sqrt(Ra_b))**-0.5 if Ra_b>0 else 0.1
    h = Nu_b*AIR['k']/b
    m = math.sqrt(2*h/(K_AL*fin_t)); eta=math.tanh(m*fin_h)/(m*fin_h)
    A = n_fins*2*fin_h*L
    return dict(b=b,Ra_b=Ra_b,Nu_b=Nu_b,h=h,eta=eta,A=A,R=1/(h*eta*A))

# ================================================================= A2. VC internal
def vc_resistance(fluid=Methanol, T=60., h_evap=2.0e4, h_cond=1.5e4):
    A_die = G['die']**2
    A_cond= G['L']*G['W']
    R = {}
    R['TIM_die']   = 1.0e-5/A_die            # 10 um, ~1 W/mK -> effective
    R['base_wall'] = G['t_base_wall']/(K_CU*A_die)
    R['evap']      = 1/(h_evap*A_die)
    R['vapor']     = 0.005                    # small, computed below as dP->dT
    R['cond']      = 1/(h_cond*A_cond)
    R['lid']       = G['t_lid']/(K_CU*A_cond)
    R['TIM_fin']   = 5.0e-5/A_cond
    R['spread_vc'] = 0.05                     # vapor-chamber effective spreading
    return R

def spreading_solid_cu():
    """If the chamber failed / dried out: 1 mm Cu spreading, 20mm->68mm."""
    a=G['die']/math.sqrt(math.pi); b=G['L']/math.sqrt(math.pi); t=G['t_base_wall']
    eps=a/b; tau=t/b; Bi=0.0
    lam=math.pi+1/(math.sqrt(math.pi)*eps)
    phi=(math.tanh(lam*tau)+lam/1e6)/(1+lam/1e6*math.tanh(lam*tau))
    psi=(eps*tau/math.sqrt(math.pi))+ (1/math.sqrt(math.pi))*(1-eps)**1.5*phi
    return psi/(K_CU*a*math.sqrt(math.pi))

# ================================================================= B. LIMITS
def hp_limits(fluid=Methanol, T=60., d_pore=G['d_pore'], tilt_m=0.0):
    r_eff = d_pore/2
    eps=G['eps']; d_p = d_pore/0.5                     # particle ~2x pore dia
    Kperm = d_p**2*eps**3/(150*(1-eps)**2)             # Blake-Kozeny
    A_w = G['W']*G['t_wick']
    L_eff = G['L']/2
    dP_cap = 2*fluid.sigma/r_eff
    dP_grav = fluid.rho_l*9.81*tilt_m
    # per-watt gradients
    g_liq = fluid.mu_l*L_eff/(fluid.hfg*fluid.rho_l*Kperm*A_w)
    h_v = G['h_cav']-G['t_wick']; A_v=G['W']*h_v
    Dh_v = 2*h_v*G['W']/(h_v+G['W'])
    rv = fluid.rho_v(T)
    g_vap = 32*fluid.mu_v*L_eff/(Dh_v**2*rv*fluid.hfg*A_v)
    avail = dP_cap-dP_grav
    Q_cap = avail/(g_liq+g_vap) if avail>0 else 0.0
    # boiling limit (thin wick, nucleate, vapour blanketing)
    k_eff = K_CU*(1-eps)+fluid.k_l*eps if hasattr(fluid,'k_l') else 40.
    k_eff = 2*K_CU*( (2*K_CU+0.2-2*(1-eps)*(K_CU-0.2))/(2*K_CU+0.2+(1-eps)*(K_CU-0.2)) )
    dT_sup = 2*fluid.sigma*(T+273.15)/(rv*fluid.hfg*max(r_eff,1e-6))
    q_boil = k_eff*10.0/G['t_wick']                    # 10 K allowable superheat
    Q_boil = q_boil*G['die']**2
    # sonic
    Q_sonic = 0.474*A_v*fluid.hfg*math.sqrt(rv*fluid.psat(T)) if hasattr(fluid,'psat') else 0
    # entrainment
    Q_ent = A_v*fluid.hfg*math.sqrt(rv*fluid.sigma/(2*r_eff))
    return dict(r_eff=r_eff,K=Kperm,dP_cap=dP_cap,dP_grav=dP_grav,
                g_liq=g_liq,g_vap=g_vap,Q_cap=Q_cap,dT_sup=dT_sup,
                Q_boil=Q_boil,Q_sonic=Q_sonic,Q_ent=Q_ent,k_eff=k_eff)

# ================================================================= C. ADSORPTION
def DA_uptake(T_res_C, P_Pa, W0=1.75e-3, E=10.5e3, n=1.8, fluid=Methanol):
    """Dubinin-Astakhov. W0=1.75e-3 m3/kg (=1.75 cm3/g pore vol), E [J/mol]. -> kg/kg."""
    Ts=T_res_C+273.15; Ps=fluid.psat(T_res_C)
    if P_Pa>=Ps: return W0*fluid.rho_l
    A=8.314*Ts*math.log(Ps/P_Pa)
    W=W0*math.exp(-(A/E)**n)
    return W*fluid.rho_l

def inventory(T_evap_C, T_res_C, fluid=Methanol):
    P = fluid.psat(T_evap_C)                # chamber pressure set by evaporator
    x = DA_uptake(T_res_C, P)               # kg methanol / kg carbon
    m_ads = x*G['m_carbon']
    m_tot = G['V_charge']*fluid.rho_l
    m_free= m_tot-m_ads
    V_wick_void = G['L']*G['W']*G['t_wick']*G['eps']
    fill = (m_free/fluid.rho_l)/V_wick_void
    return dict(P=P, Ps_res=fluid.psat(T_res_C), rel=P/fluid.psat(T_res_C),
                x=x, m_ads=m_ads, m_tot=m_tot, m_free=m_free,
                V_wick_void=V_wick_void, wick_fill=fill)

# ================================================================= REPORT
def line(c='-',n=78): print(c*n)
def hdr(s): print(); line('='); print(s); line('=')

hdr("A.  HEAT-SINK CAPACITY  (fin stack -> air)")
print(f"{'config':<34}{'span':>7}{'h':>8}{'eta':>7}{'A[m2]':>8}{'R[K/W]':>9}{'Q@dT40':>9}")
for label,n,v in [("as drawn: 12 fins, natural",12,None),
                  ("as drawn: 12 fins, 2 m/s",12,2.0),
                  ("as drawn: 12 fins, 4 m/s",12,4.0),
                  ("corrected: 43 fins, natural",43,None),
                  ("corrected: 43 fins, 2 m/s",43,2.0),
                  ("corrected: 43 fins, 4 m/s",43,4.0)]:
    r = fin_stack_natural(n) if v is None else fin_stack(n,v)
    span = n*G['fin_pitch']*1e3
    print(f"{label:<34}{span:>6.0f}m{r['h']:>8.1f}{r['eta']:>7.2f}"
          f"{r['A']:>8.4f}{r['R']:>9.2f}{40/r['R']:>9.1f}")

hdr("B.  VAPOR-CHAMBER INTERNAL RESISTANCE  (20x20 mm die)")
R=vc_resistance(); tot=sum(R.values())
for k,v in R.items(): print(f"   {k:<14}{v:8.4f} K/W")
print(f"   {'TOTAL R_vc':<14}{tot:8.4f} K/W")
print(f"   (bare 1 mm Cu spreader for comparison: {spreading_solid_cu():.3f} K/W)")

def R_lid_constriction(n_fins):
    """Lateral conduction in the 1 mm lid when the fin footprint is narrower
       than the 68 mm chamber (heat must run sideways to reach the fins)."""
    span=n_fins*G['fin_pitch']
    if span>=G['L']*0.95: return 0.0
    Lpath=(G['L']-span)/4                      # mean lateral path each side
    A=G['t_lid']*G['W']*2                      # two conduction wings
    return Lpath/(K_CU*A)

hdr("C.  END-TO-END COOLING CAPACITY  (Tj limit 100 C, air 25 C -> dT 75 K)")
print(f"{'scenario':<38}{'R_sink':>8}{'R_lid':>7}{'R_vc':>7}{'R_tot':>8}{'Q_max':>9}")
for label,n,v in [("as drawn: 12 fins, natural conv",12,None),
                  ("as drawn: 12 fins, 2 m/s",12,2.0),
                  ("as drawn: 12 fins, 4 m/s",12,4.0),
                  ("corrected: 43 fins, natural conv",43,None),
                  ("corrected: 43 fins, 2 m/s",43,2.0),
                  ("corrected: 43 fins, 4 m/s",43,4.0)]:
    rs = (fin_stack_natural(n) if v is None else fin_stack(n,v))['R']
    rl = R_lid_constriction(n); Rt = rs+rl+tot
    print(f"{label:<38}{rs:>8.2f}{rl:>7.2f}{tot:>7.2f}{Rt:>8.2f}{75/Rt:>9.1f} W")

hdr("C2. NATURAL-CONVECTION FIN PITCH  (why 1.5 mm chokes)")
nu=AIR['mu']/AIR['rho']; al=nu/AIR['Pr']; beta=1/318.15
Ra_L=9.81*beta*40*G['fin_h']**3/(nu*al)
b_opt=2.714*G['fin_h']/Ra_L**0.25
print(f"   Ra_L(H=20mm,dT=40K) = {Ra_L:.0f}")
print(f"   optimum plate spacing b_opt = {b_opt*1e3:.1f} mm  (drawing gives 1.1 mm gap)")
for pitch in [1.5e-3,3e-3,6e-3,8e-3]:
    nf=int(G['L']/pitch)
    r=fin_stack_natural(nf,pitch=pitch)
    print(f"   pitch {pitch*1e3:>4.1f} mm -> {nf:>2} fins, h={r['h']:>5.2f}, "
          f"R={r['R']:>7.2f} K/W, Q@dT75 = {75/(r['R']+tot):>5.1f} W")

hdr("D.  HEAT-PIPE OPERATING LIMITS")
print(f"{'case':<44}{'dPcap':>8}{'Qcap':>9}{'Qboil':>8}{'Qent':>9}")
for lab,fl,dp,tilt in [
    ("as drawn: methanol 200um pore, horizontal",Methanol,200e-6,0.0),
    ("as drawn: methanol 200um pore, VERTICAL",  Methanol,200e-6,0.068),
    ("methanol 50um pore, horizontal",           Methanol, 50e-6,0.0),
    ("methanol 50um pore, VERTICAL",             Methanol, 50e-6,0.068),
    ("water 50um pore, VERTICAL",                Water,    50e-6,0.068)]:
    L=hp_limits(fl,60.,dp,tilt)
    print(f"{lab:<44}{L['dP_cap']:>8.0f}{L['Q_cap']:>9.0f}{L['Q_boil']:>8.0f}{L['Q_ent']:>9.0f}")
print("\n   adverse-gravity head over 68 mm: methanol %.0f Pa | water %.0f Pa"
      %(Methanol.rho_l*9.81*0.068, Water.rho_l*9.81*0.068))
print("   fluid merit N=rho*sigma*hfg/mu @60C: methanol %.2e | water %.2e (%.1fx)"
      %(Methanol.rho_l*Methanol.sigma*Methanol.hfg/Methanol.mu_l,
        Water.rho_l*Water.sigma*Water.hfg/Water.mu_l,
        (Water.rho_l*Water.sigma*Water.hfg/Water.mu_l)/
        (Methanol.rho_l*Methanol.sigma*Methanol.hfg/Methanol.mu_l)))

hdr("E.  MAXSORB III INVENTORY BALANCE  (the decisive check)")
print("   chamber pressure is set by the EVAPORATOR; carbon sees P/Psat(T_res).")
print(f"\n{'T_evap':>7}{'T_res':>7}{'P/Psat':>9}{'uptake':>9}{'ads':>8}"
      f"{'free':>8}{'wick fill':>11}  verdict")
for Te,Tr in [(60,40),(60,50),(60,60),(60,80),(60,100),(60,127),(85,60),(85,110)]:
    d=inventory(Te,Tr)
    v = "DRYOUT" if d['wick_fill']<0.5 else ("marginal" if d['wick_fill']<0.9 else "ok")
    print(f"{Te:>7}{Tr:>7}{min(d['rel'],1.0):>9.2f}{d['x']:>9.2f}"
          f"{d['m_ads']*1e3:>7.2f}g{d['m_free']*1e3:>7.2f}g{d['wick_fill']*100:>10.0f}%  {v}")
print(f"\n   total charge = {G['V_charge']*Methanol.rho_l*1e3:.2f} g "
      f"({G['V_charge']*1e6:.1f} mL); wick void = {G['L']*G['W']*G['t_wick']*G['eps']*1e6:.2f} mL")
print("\n   --- required reservoir temperature to keep the wick wet ---")
for Te in [50,60,85]:
    P=Methanol.psat(Te); need=None
    for Tr in [x*0.5 for x in range(int(Te*2),400)]:
        d=inventory(Te,Tr)
        if d['wick_fill']>=0.90: need=Tr; break
    print(f"   T_evap={Te:>3} C  ->  reservoir must be held at >= "
          f"{need if need else '>200'} C  (delta = "
          f"{(need-Te) if need else '>'+str(200-Te)} K ABOVE the chip)")
print("\n   --- FIX PATH: overcharge so the carbon saturates AND the wick stays wet ---")
for Vml in [1.0,1.5,1.9,2.2]:
    m_tot=Vml*1e-6*Methanol.rho_l
    m_ads=1.75e-3*Methanol.rho_l*G['m_carbon']
    free=m_tot-m_ads
    fill=(free/Methanol.rho_l)/(G['L']*G['W']*G['t_wick']*G['eps'])
    print(f"   charge {Vml:>4.1f} mL -> carbon takes {m_ads*1e3:.2f} g, "
          f"free {free*1e3:>5.2f} g, wick fill {fill*100:>5.0f}%  "
          f"{'OK' if fill>=1.0 else 'DRYOUT'}")

hdr("F.  TRANSIENT BURST BUFFER  (what the carbon COULD buy, if hot-side coupled)")
m_ads_max=1.75e-3*Methanol.rho_l*G['m_carbon']
E_des=m_ads_max*Methanol.hfg
C_cu=0.160*385
print(f"   max adsorbed methanol      : {m_ads_max*1e3:.2f} g")
print(f"   desorption enthalpy buffer : {E_des:.0f} J")
print(f"   sensible heat of 160 g Cu  : {C_cu:.0f} J/K  -> buffer = {E_des/C_cu:.1f} K")
print(f"   latent heat of full charge : {G['V_charge']*Methanol.rho_l*Methanol.hfg:.0f} J")
for Q in [5,10,20,40]:
    print(f"   sustains {Q:>2} W excess for  : {E_des/Q:>6.0f} s")

hdr("G.  STRUCTURAL: 1 mm C110 LID, UNSUPPORTED 66 mm SPAN")
print("   clamped square plate  sigma = 0.308*p*a^2/t^2 ; C110 annealed Sy~70 MPa")
print(f"{'T[C]':>6}{'Psat[kPa]':>11}{'|dP|[kPa]':>11}{'no posts':>11}{'6mm posts':>11}")
for T in [25,50,80,100,125,150]:
    Ps=Methanol.psat(T)/1e3; dP=abs(Ps-101.3)
    s1=0.308*(dP*1e3)*(0.066**2)/(0.001**2)/1e6
    s2=0.308*(dP*1e3)*(0.006**2)/(0.001**2)/1e6
    print(f"{T:>6}{Ps:>11.1f}{dP:>11.1f}{s1:>10.0f}M{s2:>10.1f}M")

hdr("H.  MASS AUDIT")
rho_cu,rho_al=8960.,2700.
parts=[("Cu shell (1 mm walls)",(0.068*0.068*0.005-0.066*0.066*0.003)*rho_cu),
       ("Cu lid 1 mm",0.068*0.068*0.001*rho_cu),
       ("Cu sintered wick",0.068*0.068*0.0003*0.40*rho_cu),
       ("Cu reservoir housing",(0.068*0.010*0.0022-0.066*0.008*0.0016)*rho_cu),
       ("Al fins (12, as drawn)",12*0.068*0.020*0.0004*rho_al),
       ("Maxsorb III carbon",G['m_carbon']),
       ("methanol charge",G['V_charge']*Methanol.rho_l)]
tot_m=0
for n,m in parts:
    print(f"   {n:<26}{m*1e3:>8.1f} g"); tot_m+=m
print(f"   {'TOTAL (wet, 12 fins)':<26}{tot_m*1e3:>8.1f} g   <-- drawing claims 45 g dry")
print(f"   {'TOTAL with 43 fins':<26}"
      f"{(tot_m-12*0.068*0.020*0.0004*rho_al+43*0.068*0.020*0.0004*rho_al)*1e3:>8.1f} g")
