#!/usr/bin/env python3
"""SI-100 solar adsorption ice maker. Activated carbon + methanol, daily cycle.
Single source of truth for drawings/si_sheets.py."""
import math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adsorption_chiller import x_maxsorb, psat_meoh, hfg_meoh

SPEC = dict(
    # --- duty ---
    A_coll=1.0, ice_day=5.0, T_water_in=25.0, f_sys=0.55,
    H_sun=20.0e6,                       # J/m2/day, clear day, tilted plane
    T_evap=-5.0, T_cond=30.0, T_ads=30.0, T_des=130.0, T_stag=150.0,
    # --- adsorber: tubular, welded to the absorber plate ---
    n_tube=8, tube_od=60.3, tube_wall=1.5, tube_len=1000.0,
    core_od=12.0, mesh="SUS 316L 50 um",
    rho_bulk=300.0,                     # kg/m3, Maxsorb III packed
    k_bed=0.20, cp_bed=920.0,
    # --- glazing / box ---
    glaz="low-iron 3.2 mm tempered", ins_back=50.0, ins_side=30.0,
    absorber="Cu 0.5 mm, selective coating alpha 0.95 / eps 0.10",
    # --- condenser ---
    cond_dT=15.0, cond_h=10.0,          # natural convection + radiation
    # --- evaporator / ice box ---
    box_L=500.0, box_W=350.0, box_H=300.0, box_ins=80.0, k_ins=0.024,
    evap_U=200.0, evap_dT=5.0,
    # --- vessel ---
    mat="SS 316L", S_allow=130.0e6,     # Pa at 150 C
)
S=SPEC

def cycle_points():
    P_ev, P_cd = psat_meoh(S['T_evap']), psat_meoh(S['T_cond'])
    x_rich = x_maxsorb(S['T_ads'],  P_ev)
    x_lean = x_maxsorb(S['T_des'],  P_cd)
    return P_ev, P_cd, x_rich, x_lean, x_rich-x_lean

def adsorber():
    z=design()
    V_c = z['m_c']/S['rho_bulk']                             # m3 of packed carbon
    ID = S['tube_od']-2*S['tube_wall']
    V_gross = S['n_tube']*math.pi*(ID/2000)**2*(S['tube_len']/1000)
    V_core  = S['n_tube']*math.pi*(S['core_od']/2000)**2*(S['tube_len']/1000)
    V_avail = V_gross-V_core
    annulus = (ID-S['core_od'])/2
    alpha = S['k_bed']/(S['rho_bulk']*S['cp_bed'])
    t_diff = (annulus/1000)**2/alpha
    width = S['A_coll']*1e6/S['tube_len']          # mm, collector width
    pitch = width/S['n_tube']
    return dict(V_c=V_c,ID=ID,V_gross=V_gross,V_core=V_core,V_avail=V_avail,
                fill=V_c/V_avail,annulus=annulus,t_diff=t_diff,pitch=pitch,width=width)

def pressure():
    out={}
    for T in (S['T_evap'],S['T_ads'],S['T_cond'],S['T_des'],S['T_stag']):
        out[T]=psat_meoh(T)
    ID=S['tube_od']-2*S['tube_wall']
    p_des=psat_meoh(S['T_stag'])
    hoop=p_des*(ID/1000)/(2*S['tube_wall']/1000)
    p_burst=2*S['S_allow']*(S['tube_wall']/1000)/(ID/1000)
    return out,hoop,p_burst,p_des

def exchangers():
    z=design()
    Q_cd = z['cycled']*hfg_meoh(S['T_cond'])
    A_cd = Q_cd/(6*3600)/(S['cond_h']*S['cond_dT'])
    Q_ev = S['ice_day']*z['q_ice']
    A_ev = Q_ev/(12*3600)/(S['evap_U']*S['evap_dT'])
    # ice box heat leak
    L,W,H,t=S['box_L']/1000,S['box_W']/1000,S['box_H']/1000,S['box_ins']/1000
    A_box=2*(L*W+L*H+W*H)
    U=S['k_ins']/t
    Q_leak=U*A_box*(30-0)
    return dict(Q_cd=Q_cd,P_cd=Q_cd/(6*3600),A_cd=A_cd,
                Q_ev=Q_ev,P_ev=Q_ev/(12*3600),A_ev=A_ev,
                A_box=A_box,U=U,Q_leak=Q_leak,
                leak_frac=Q_leak*12*3600/Q_ev)

def collector_eff(Tm, Ta=30.0, G=800.0, eta0=0.75, a1=3.5, a2=0.015):
    """Good selective-surface single-glazed flat plate, EN 12975 form."""
    dT=Tm-Ta
    return max(eta0 - a1*dT/G - a2*dT*dT/G, 0.0)

def metal_per_kg_carbon(m_c):
    """Real adsorber metal: stainless tubes + copper absorber plate."""
    od,t,Ln,n = S['tube_od'],S['tube_wall'],S['tube_len'],S['n_tube']
    v_tube = n*math.pi*((od/2)**2-(od/2-t)**2)*Ln/1e9        # m3
    m_tube = v_tube*7900.0
    m_plate= S['A_coll']*0.5e-3*8960.0
    return (m_tube+m_plate), (m_tube*500.0+m_plate*385.0)/max(m_c,1e-6)

def design(T_des=None, f_sys=None):
    """Size the carbon to DELIVER the target ice after system derating,
    then check the collector can supply the heat."""
    Td = T_des if T_des is not None else S['T_des']
    f  = f_sys if f_sys is not None else S['f_sys']
    P_ev,P_cd = psat_meoh(S['T_evap']), psat_meoh(S['T_cond'])
    x_r = x_maxsorb(S['T_ads'], P_ev)
    x_l = x_maxsorb(Td,        P_cd)
    dx  = max(x_r-x_l, 0.0)
    if dx<=0: return None
    q_ice  = S['T_water_in']*4186 + 334000
    Q_need = S['ice_day']*q_ice/f                            # ideal cooling required
    q_cool = dx*hfg_meoh(S['T_evap'])
    m_c    = Q_need/q_cool
    m_met, cp_met_per_kg = metal_per_kg_carbon(m_c)
    q_sens = (S['cp_bed'] + cp_met_per_kg + x_r*2500.0)*(Td-S['T_ads'])
    q_des  = dx*hfg_meoh(S['T_evap'])*1.33
    q_in   = q_sens+q_des
    Q_coll = m_c*q_in
    Tm     = (S['T_ads']+Td)/2
    eta    = collector_eff(Tm)
    Q_avail= eta*S['H_sun']*S['A_coll']
    return dict(Td=Td,P_ev=P_ev,P_cd=P_cd,x_r=x_r,x_l=x_l,dx=dx,q_ice=q_ice,
                q_cool=q_cool,q_in=q_in,COP=q_cool/q_in,m_c=m_c,
                charge=m_c*x_r, heel=m_c*x_l, cycled=m_c*dx,
                m_metal=m_met, Q_coll=Q_coll, Q_avail=Q_avail,
                util=Q_coll/Q_avail, eta=eta, feasible=Q_coll<=Q_avail,
                p_op=psat_meoh(Td)/1e5,
                solar_cop=S['ice_day']*q_ice/(S['H_sun']*S['A_coll']))
def sweep(Tds=range(90,151,10)):
    return [d for d in (design(T_des=t) for t in Tds) if d]

if __name__=="__main__":
    P=print; L=lambda c='-': P(c*74)
    z=design(); a=adsorber(); pr,hoop,burst,p_des=pressure(); x=exchangers()
    P("="*74); P("SI-100  SOLAR ADSORPTION ICE MAKER  —  DESIGN POINT"); P("="*74)
    P(f"  duty: {S['ice_day']:.0f} kg of ice per day from {S['T_water_in']:.0f} C water,"
      f" {S['A_coll']:.1f} m2 collector")
    P(f"  cycle: evap {S['T_evap']:.0f} C  /  cond {S['T_cond']:.0f} C  /"
      f"  adsorb {S['T_ads']:.0f} C  /  regenerate {S['T_des']:.0f} C")
    P(f"  system realisation factor {S['f_sys']:.2f} applied to the ideal cycle")

    P("\n"); L('='); P("1. CYCLE AND CHARGE"); L('=')
    P(f"   evaporator pressure   {z['P_ev']/1000:8.2f} kPa abs")
    P(f"   condenser pressure    {z['P_cd']/1000:8.2f} kPa abs")
    P(f"   x rich (30 C, P_ev)  {z['x_r']:8.3f} kg/kg")
    P(f"   x lean ({z['Td']:.0f} C, P_cd) {z['x_l']:8.3f} kg/kg")
    P(f"   uptake swing          {z['dx']:8.3f} kg/kg")
    P(f"   cooling per kg carbon {z['q_cool']/1000:8.0f} kJ")
    P(f"   ice enthalpy          {z['q_ice']/1000:8.0f} kJ/kg  (cool 25->0 then freeze)")
    P(f"   carbon required       {z['m_c']:8.2f} kg")
    P(f"   solar COP             {z['solar_cop']:8.3f}   (literature 0.10-0.15)")
    P(f"\n   METHANOL CYCLED PER DAY {z['cycled']:6.2f} kg")
    P(f"   METHANOL TOTAL CHARGE   {z['charge']:6.2f} kg   <-- this is the number that matters")
    P(f"   of which never desorbs  {z['heel']:6.2f} kg  ({z['heel']/z['charge']*100:.0f} % dead heel)")
    P("   The charge is set by the RICH state, not by the swing. An earlier note in")
    P("   this repo quoted the cycled mass as the charge - it is far larger.")

    P("\n"); L('='); P("2. ADSORBER — TUBULAR, WELDED TO THE ABSORBER PLATE"); L('=')
    P(f"   {S['n_tube']} tubes  OD {S['tube_od']:.1f} x {S['tube_wall']:.1f} wall x"
      f" {S['tube_len']:.0f} long @ {a['pitch']:.0f} mm pitch across {a['width']:.0f} mm")
    P(f"   carbon volume {a['V_c']*1000:6.1f} L   available inside tubes {a['V_avail']*1000:6.1f} L"
      f"   fill {a['fill']*100:.0f} %")
    P(f"   annulus (core to wall) {a['annulus']:.1f} mm")
    P(f"   thermal diffusion time through the annulus: {a['t_diff']:.0f} s = {a['t_diff']/60:.1f} min")
    P("   -> bed conductivity is NOT the limit here. A 10-minute chiller is starved by")
    P("      k = 0.2 W/mK; a once-a-day solar cycle has six hours and does not care.")

    P("\n"); L('='); P("3. PRESSURE — STAGNATION IS THE DESIGN CASE"); L('=')
    for T in sorted(pr): P(f"   methanol Psat at {T:6.1f} C : {pr[T]/1e5:7.3f} bar abs")
    P(f"\n   A solar collector WILL stagnate. Design case is {S['T_stag']:.0f} C -> {p_des/1e5:.1f} bar.")
    P(f"   hoop stress in the tube at stagnation : {hoop/1e6:6.1f} MPa")
    P(f"   allowable for {S['mat']} at 150 C     : {S['S_allow']/1e6:6.1f} MPa")
    P(f"   margin                                 : {S['S_allow']/hoop:6.1f} x")
    P("   The tubular adsorber rides stagnation on its own geometry. A flat welded box")
    P("   of the same area would need stiffening or a relief - and relieving methanol")
    P("   to atmosphere is not acceptable. This is why the adsorber is tubes.")
    P(f"   Night-time the same tube sees full external vacuum ({pr[S['T_evap']]/1000:.1f} kPa abs inside).")

    P("\n"); L('='); P("4. CONDENSER AND EVAPORATOR"); L('=')
    P(f"   condenser duty {x['Q_cd']/1e6:5.2f} MJ over ~6 h = {x['P_cd']:5.0f} W mean")
    P(f"   condenser area {x['A_cd']:5.2f} m2 at dT {S['cond_dT']:.0f} K, h {S['cond_h']:.0f} W/m2K"
      f"  (natural convection + radiation)")
    P(f"   evaporator duty {x['Q_ev']/1e6:5.2f} MJ over ~12 h = {x['P_ev']:5.0f} W mean")
    P(f"   evaporator area {x['A_ev']:5.3f} m2 at U {S['evap_U']:.0f}, dT {S['evap_dT']:.0f} K")
    P(f"\n   ice box {S['box_L']:.0f} x {S['box_W']:.0f} x {S['box_H']:.0f} internal,"
      f" {S['box_ins']:.0f} mm PU")
    P(f"   surface {x['A_box']:.2f} m2, U {x['U']:.2f} W/m2K, leak at 30 C ambient {x['Q_leak']:.0f} W")
    P(f"   leak over a 12 h night = {x['leak_frac']*100:.0f} % of the night's cooling")
    if x['leak_frac']>0.25:
        P("   -> TOO MUCH. Thicken the insulation or shrink the box.")
    else:
        P("   -> acceptable; it is already inside the 5 kg/day figure as margin.")

    P("\n"); L('='); P("5. REGENERATION TEMPERATURE — SELECTED TO MINIMISE INVENTORY"); L('=')
    P("   Hotter regeneration opens the swing, so less carbon carries the same duty,")
    P("   and the methanol charge falls with it. The cost is pressure and collector")
    P("   efficiency. For a portable device holding a toxic fluid, inventory wins.")
    P(f"{'T_des':>7}{'swing':>8}{'COP':>7}{'carbon':>9}{'METHANOL':>11}"
      f"{'coll use':>10}{'Psat':>8}   note")
    for r in sweep():
        note=""
        if r['Td']==S['T_des']: note="  <-- SELECTED"
        elif r['util']>0.92:    note="  no collector margin"
        elif r['p_op']>=psat_meoh(S['T_stag'])/1e5*0.95: note="  at the stagnation limit"
        P(f"{r['Td']:>5.0f} C{r['dx']:>8.3f}{r['COP']:>7.2f}{r['m_c']:>8.1f}kg"
          f"{r['charge']:>9.1f}kg{r['util']*100:>9.0f}%{r['p_op']:>7.1f}b{note}")
    lo=[r for r in sweep() if r['Td']==100][0]; sel=design()
    P(f"\n   {S['T_des']:.0f} C against 100 C: methanol {lo['charge']:.1f} -> {sel['charge']:.1f} kg,"
      f" a {100*(1-sel['charge']/lo['charge']):.0f} % cut in inventory.")
    P(f"   150 C would reach {[r for r in sweep() if r['Td']==150][0]['charge']:.1f} kg but leaves"
      f" only {100-[r for r in sweep() if r['Td']==150][0]['util']*100:.0f} % collector margin")
    P("   and puts operating pressure level with the stagnation design case.")

    P("\n"); L('='); P("6. SAFETY-DRIVEN CONSEQUENCES OF A 4.9 kg METHANOL CHARGE"); L('=')
    for t in ["Outdoor device only. No indoor installation, no indoor storage while charged.",
              "All-welded SS 316L and copper. No elastomer joints, no service ports, no",
              "  threaded fittings on the wetted envelope. Charge under vacuum, then seal",
              "  permanently by pinch-off and weld cap.",
              "Bund or drip tray under the evaporator and receiver sized for the whole",
              "  charge, in a vapour-tight secondary enclosure.",
              "Vessel proof tested to 1.5 x the 150 C stagnation pressure = 21 bar.",
              "No pressure relief venting to atmosphere. The vessel is designed to",
              "  contain stagnation instead - that is why the adsorber is tubes.",
              "Methanol burns with a nearly invisible flame. Site fire cover accordingly.",
              "Label the vessel for methanol with flame and acute-toxicity marking."]:
        P("   - "+t if not t.startswith("  ") else t)
