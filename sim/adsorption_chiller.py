#!/usr/bin/env python3
"""Adsorption chiller / heat pump: is it buildable, and can waste heat drive it?

Two working pairs:
  Maxsorb III + methanol   (Dubinin-Astakhov)   - the pair from the original drawing
  Silica gel  + water      (Freundlich)         - what commercial machines use
"""
import math
P=print; L=lambda c='-': P(c*78)
R=8.314

# ------------------------------------------------------------------ fluids
def psat_meoh(T):                                   # Pa, T in C
    return 10**(5.20409-1581.341/(T+273.15-33.50))*1e5
def psat_h2o(T):
    return 10**(5.40221-1838.675/(T+273.15-31.737))*1e5
def hfg(T, hfg_ref, T_ref, Tc):                     # Watson
    return hfg_ref*((Tc-(T+273.15))/(Tc-(T_ref+273.15)))**0.38
def hfg_meoh(T): return hfg(T, 1100e3, 64.7, 512.6)
def hfg_h2o(T):  return hfg(T, 2257e3, 100.0, 647.1)

# ------------------------------------------------------------------ pairs
def x_maxsorb(T_bed, P_vap, W0=1.75e-3, E=10.5e3, n=1.8, rho=750.):
    Ps = psat_meoh(T_bed)
    if P_vap >= Ps: return W0*rho
    A = R*(T_bed+273.15)*math.log(Ps/P_vap)
    return W0*math.exp(-(A/E)**n)*rho

def x_silica(T_bed, P_vap, x0=0.346, n=1.6):
    Ps = psat_h2o(T_bed)
    return min(x0*(P_vap/Ps)**(1/n), x0)

PAIRS = {
 "Maxsorb III / methanol": dict(x=x_maxsorb, hfg=hfg_meoh, psat=psat_meoh,
                                h_ads=1.33, cp_sorb=920., name="methanol"),
 "Silica gel / water":     dict(x=x_silica,  hfg=hfg_h2o,  psat=psat_h2o,
                                h_ads=1.20, cp_sorb=920., name="water"),
}

def cycle(pair, T_evap, T_cond, T_ads, T_des, metal_ratio=1.5, cp_metal=460.):
    """One bed, per kg of sorbent. metal_ratio = kg of heat-exchanger metal per kg sorbent."""
    p = PAIRS[pair]
    P_ev, P_cd = p['psat'](T_evap), p['psat'](T_cond)
    x_rich = p['x'](T_ads,  P_ev)          # end of adsorption, cold bed sees evaporator
    x_lean = p['x'](T_des,  P_cd)          # end of desorption, hot bed sees condenser
    dx = max(x_rich-x_lean, 0.0)
    q_cool = dx*p['hfg'](T_evap)                                   # J per kg sorbent
    q_sens = (p['cp_sorb'] + metal_ratio*cp_metal + x_rich*2500.)*(T_des-T_ads)
    q_des  = dx*p['hfg'](T_evap)*p['h_ads']
    q_in   = q_sens + q_des
    return dict(x_rich=x_rich, x_lean=x_lean, dx=dx, q_cool=q_cool,
                q_sens=q_sens, q_des=q_des, q_in=q_in,
                COP=q_cool/q_in if q_in>0 else 0.0,
                P_ev=P_ev, P_cd=P_cd)

if __name__ == "__main__":
    P("="*78); P("ADSORPTION CHILLER  —  IS IT BUILDABLE?"); P("="*78)
    P("  Yes: this is a real, commercial technology. The question is what it costs you.")
    P("  Cycle: evaporator 10 C, condenser 35 C, bed adsorbs at 35 C, desorbs at T_des.")

    for pair in PAIRS:
        P("\n"); L('='); P(f"{pair}"); L('=')
        P(f"{'T_des':>8}{'x rich':>9}{'x lean':>9}{'swing':>9}{'q_cool':>11}"
          f"{'q_in':>10}{'COP':>7}{'  verdict'}")
        for Td in (55,65,75,85,95,110,130):
            c = cycle(pair, 10, 35, 35, Td)
            v = "no swing" if c['dx']<0.01 else ("weak" if c['COP']<0.25 else
                ("usable" if c['COP']<0.45 else "good"))
            P(f"{Td:>6} C{c['x_rich']:>9.3f}{c['x_lean']:>9.3f}{c['dx']:>9.3f}"
              f"{c['q_cool']/1000:>9.0f} kJ{c['q_in']/1000:>8.0f} kJ{c['COP']:>7.2f}   {v}")
        c85 = cycle(pair, 10, 35, 35, 85)
        P(f"\n  at 85 C drive: evaporator {c85['P_ev']/1000:.2f} kPa abs, "
          f"condenser {c85['P_cd']/1000:.2f} kPa abs  -> deep vacuum plant")

    L('='); P("\nSIZING FOR 1 kW OF COOLING  (85 C drive, 2 beds for continuous output)"); L('=')
    P(f"{'pair':>24}{'cycle':>8}{'SCP eq':>10}{'SCP real':>10}{'sorbent':>10}{'+ metal':>10}{'total':>9}")
    for pair in PAIRS:
        c = cycle(pair, 10, 35, 35, 85)
        for tcyc in (600,):
            scp_eq = c['q_cool']/tcyc                       # W per kg, equilibrium
            util = 0.40                                     # heat/mass transfer reality
            scp = scp_eq*util
            m_sorb = 1000/scp*2                             # 2 beds
            m_metal = m_sorb*1.5
            P(f"{pair:>24}{tcyc//60:>6} min{scp_eq:>9.0f}W{scp:>9.0f}W"
              f"{m_sorb:>8.1f}kg{m_metal:>9.1f}kg{m_sorb+m_metal:>7.1f}kg")
    P("  plus evaporator, condenser, vacuum vessel, valves: roughly double again.")
    P("  Commercial 1 kW-class adsorption chillers land at 150-400 kg. They exist;")
    P("  they are the size of a refrigerator and they are sold for waste-heat sites.")

    L('='); P("\nCAN THE GPU'S OWN WASTE HEAT DRIVE IT?"); L('=')
    P("  Available drive temperature = the D2C return water, 50-60 C at best.")
    P(f"{'pair':>24}{'T_des 55 C':>13}{'T_des 60 C':>13}{'T_des 85 C':>13}")
    for pair in PAIRS:
        row=[]
        for Td in (55,60,85):
            c=cycle(pair,10,35,35,Td); row.append(f"COP {c['COP']:.2f}")
        P(f"{pair:>24}{row[0]:>13}{row[1]:>13}{row[2]:>13}")
    P("\n  Maxsorb/methanol needs ~90 C+ to open a useful swing. Silica gel/water")
    P("  works down to ~60 C - that is why every commercial low-grade-heat chiller")
    P("  uses silica gel or zeolite with water, not activated carbon with methanol.")

    L('='); P("\nTHE TRAP: USING GPU HEAT TO COOL THE GPU"); L('=')
    Q_gpu=700.0
    for pair,Td in (("Silica gel / water",60),("Silica gel / water",85)):
        c=cycle(pair,10,35,35,Td)
        Q_cool=Q_gpu*c['COP']
        Q_rej=Q_gpu+Q_cool
        P(f"  {pair}, drive {Td} C, COP {c['COP']:.2f}")
        P(f"    700 W of GPU heat in  ->  {Q_cool:.0f} W of cooling out")
        P(f"    but total heat rejected to ambient = 700 + {Q_cool:.0f} = {Q_rej:.0f} W")
        P(f"    the condenser and the adsorber both dump to ambient. Nothing is saved.")
    P("  A chiller does not destroy heat, it MOVES it and adds the drive energy.")
    P("  Self-cooling a GPU with its own waste heat increases the heat rejection load.")

    L('='); P("\nHONEST BASELINE  —  1 kW of cooling, three ways"); L('=')
    rows=[("Vapour compression (R32/R290)","250-330 W electric","COP 3-4","15-25 kg","cheapest, smallest"),
          ("Adsorption, silica gel/water","~2.0 kW heat at 85 C","COP 0.5","150-400 kg","only if heat is free"),
          ("Adsorption, Maxsorb/methanol","~2.5 kW heat at 95 C","COP 0.4","150-400 kg","sub-zero capable"),
          ("Thermoelectric (Peltier)","3-5 kW electric","COP 0.2-0.3","2-5 kg","tiny loads only")]
    P(f"{'technology':>30}{'drive':>22}{'COP':>10}{'mass':>12}   note")
    for a,b,c_,d,e in rows: P(f"{a:>30}{b:>22}{c_:>10}{d:>12}   {e}")

    L('='); P("\nCORRECTION — COOLING-WATER TEMPERATURE IS THE DOMINANT LEVER"); L('=')
    P("  The tables above assumed 35 C cooling water for BOTH the adsorber and the")
    P("  condenser, which is pessimistic: real machines run a 28-31 C tower loop.")
    P("  Adsorption chillers are famously sensitive to this - here is why.\n")
    P(f"{'pair':>24}{'cool water':>12}{'T_des 60':>10}{'T_des 70':>10}{'T_des 85':>10}{'T_des 95':>10}")
    for pair in PAIRS:
        for Tcw in (28,31,35):
            row=[]
            for Td in (60,70,85,95):
                c=cycle(pair,10,Tcw,Tcw,Td)
                row.append(f"{c['COP']:.2f}" if c['dx']>0.005 else "  -  ")
            P(f"{pair:>24}{Tcw:>10} C{row[0]:>10}{row[1]:>10}{row[2]:>10}{row[3]:>10}")
    P("\n  Silica gel / water on 28 C tower water opens a usable swing from about 65 C.")
    P("  That is the operating window every commercial low-grade-heat chiller lives in.")
    P("  Maxsorb / methanol still wants 80 C+ even on cold tower water: its isotherm")
    P("  is too flat near saturation, which is the same property that made it useless")
    P("  as a passive regulator inside the vapour chamber on sheet VC-400.")

    L('='); P("\nWHERE THE MASS ACTUALLY GOES  (1 kW cooling, silica gel/water, 85 C)"); L('=')
    c=cycle("Silica gel / water",10,29,29,85)
    scp=c['q_cool']/600*0.40
    m_s=1000/scp*2; m_m=m_s*1.5
    parts=[("sorbent, 2 beds",m_s),("bed heat exchanger (fin+tube)",m_m),
           ("evaporator + condenser",0.55*(m_s+m_m)),("vacuum vessel + valves",0.7*(m_s+m_m)),
           ("water charge + frame",0.25*(m_s+m_m))]
    tot=sum(v for _,v in parts)
    for n_,v in parts: P(f"   {n_:<32}{v:>7.1f} kg")
    P(f"   {'TOTAL':<32}{tot:>7.1f} kg   for 1 kW of cooling")
    P(f"   realised SCP {scp:.0f} W per kg of sorbent  (equilibrium {c['q_cool']/600:.0f}, utilisation 0.40)")
    P("   A 1 kW vapour-compression unit is 15-25 kg and needs 280 W of electricity.")
