#!/usr/bin/env python3
"""Pure-methanol adsorption cooling as a household or portable product."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adsorption_chiller import cycle, PAIRS, psat_meoh, hfg_meoh
P=print; L=lambda c='-': P(c*78)

MEOH="Maxsorb III / methanol"; SGW="Silica gel / water"

P("="*78); P("PURE METHANOL  —  HOUSEHOLD vs PORTABLE"); P("="*78)

L('='); P("1. WHAT EVAPORATOR TEMPERATURE DO YOU ACTUALLY NEED?"); L('=')
P(f"{'duty':>26}{'T_evap':>9}{'water works?':>15}{'methanol needed?':>18}")
for duty,Te in [("room air conditioning",10),("drinks cooler / fridge",2),
                ("portable freezer",-10),("ice making",-5)]:
    P(f"{duty:>26}{Te:>7} C{('yes' if Te>2 else 'NO - freezes'):>15}"
      f"{('no' if Te>2 else 'YES'):>18}")
P("\n  Water has 2.4 MJ/kg of latent heat against methanol's 1.2. Above about 2 C")
P("  water is better on every axis: twice the cooling per kg, non-toxic,")
P("  non-flammable. Methanol buys exactly one thing - operation below 0 C.")

L('='); P("2. HOUSEHOLD AIR CONDITIONER  (2.5 kW, evap 10 C, cooling water 30 C)"); L('=')
for pair in (MEOH,SGW):
    c=cycle(pair,10,30,30,90)
    scp=c['q_cool']/600*0.40
    m_s=2500/scp*2; m_tot=(m_s+m_s*1.5)*2.5
    P(f"  {pair:<24} COP {c['COP']:.2f}   sorbent {m_s:5.1f} kg   whole machine ~{m_tot:5.0f} kg")
P(f"\n  A 2.5 kW wall air conditioner is 35 kg and draws 700 W of electricity.")
P("  Drive heat needed: 2.5 kW / COP = about 5 kW of 90 C heat, continuously.")
P("\n  AND THE DECIDING ARITHMETIC — if that heat comes from electricity:")
for pair in (MEOH,SGW):
    c=cycle(pair,10,30,30,90)
    P(f"    {pair:<24} effective COP {c['COP']:.2f}  vs  3.5 for a normal air conditioner"
      f"   ->  {3.5/c['COP']:.1f}x more electricity")
P("  An adsorption chiller only makes sense on heat you were going to waste anyway.")
P("  A house does not have 5 kW of spare 90 C heat.")

L('='); P("3. PORTABLE — THIS IS WHERE THE PAIR BELONGS"); L('=')
P("  Activated carbon + methanol driven by a solar collector is the classic")
P("  solar ice-maker. One cycle per day: heat all day, cool all night.\n")
c=cycle(MEOH,-5,30,30,100)
P(f"  cycle: evaporator -5 C, condenser 30 C, regeneration 100 C")
P(f"  uptake swing {c['dx']:.3f} kg/kg   cooling {c['q_cool']/1000:.0f} kJ per kg of carbon")
ICE=(25*4.18+334)*1e3                      # J per kg of ice from 25 C water
for A in (0.5,1.0,2.0):
    Qsun=20e6*A                            # J/day of insolation
    for solcop in (0.10,0.15):
        ice=Qsun*solcop/ICE
        if solcop==0.10: lo=ice
        else: hi=ice
    m_c=Qsun*0.13/c['q_cool']
    P(f"  collector {A:>3.1f} m2 : {lo:4.1f} - {hi:4.1f} kg of ice per day"
      f"   needs about {m_c:4.1f} kg of carbon and {m_c*c['dx']:4.2f} kg of methanol")
P("\n  Solar COP 0.10-0.15 is ice produced per unit of incident sunlight, and it")
P("  matches the published solar icemaker literature (4-7 kg/m2/day).")
P("  No pump, no compressor, no electricity. One moving part: a valve, or none.")

L('='); P("4. THE BLOCKER — METHANOL INDOORS"); L('=')
rows=[("Flash point","11 C closed cup","below room temperature"),
      ("Flammable range","6 - 36 % in air","unusually wide"),
      ("Flame","nearly invisible in daylight","you cannot see the fire"),
      ("Oral toxicity","10 mL can blind, 30-100 mL can kill","also absorbed through skin"),
      ("Occupational limit","200 ppm TWA / 250 STEL","low"),
      ("Charge in a 2.5 kW machine","roughly 3-6 kg","hundreds of lethal doses")]
P(f"{'property':>28}{'value':>36}   note")
for a,b,cc in rows: P(f"{a:>28}{b:>36}   {cc}")
P("\n  One point in its favour: the vessel runs under deep vacuum with no air in it,")
P("  so there is no flammable mixture inside while it is intact. The hazard is a")
P("  leak, a rupture, or the charging operation - not normal running.")
P("\n  Regulatory reality, which is the real wall:")
for x in ["Household AC and heat pumps are certified to IEC 60335-2-40; refrigerants",
          "  are handled through ISO 817 safety groups and charge limits per room area.",
          "Methanol has no ASHRAE refrigerant designation for this service. It would be",
          "  assessed as both toxic and highly flammable - the worst of both classes.",
          "No major market (KC in Korea, CE under PED+LVD, UL in the US) has a path to",
          "  certify a methanol-charged appliance for indoor domestic use.",
          "A demonstrator you build and run yourself outdoors is a different matter",
          "  from a product you can sell or install in a home."]:
    P("   - "+x if not x.startswith("  ") else x)

L('='); P("5. WHAT I WOULD ACTUALLY BUILD"); L('=')
P("  If the goal is HOUSEHOLD COOLING:")
P("    Not this. A 2.5 kW inverter air conditioner is 35 kg, COP 3.5, and legal.")
P("    If you want a thermally driven machine, use silica gel + WATER, and only")
P("    where a solar collector or real waste heat already exists.")
P("")
P("  If the goal is PORTABLE / OFF-GRID COOLING OR ICE:")
P("    Carbon + methanol is the right pair, and 1 m2 of collector gives 4-7 kg of")
P("    ice a day with no electricity. Build it as an OUTDOOR device:")
P("      - all-welded stainless or copper, no elastomer joints, no service ports")
P("      - charge under vacuum, then seal permanently by pinch-off")
P("      - methanol charge kept to the minimum the swing requires")
P("      - vapour-tight secondary containment around the evaporator")
P("      - labelled for methanol, with the flame and toxicity hazards on the vessel")
P("")
P("  If the goal is a PORTABLE COOLER a person carries indoors:")
P("    Use a thermoelectric or a small R290 compressor box. Both are certifiable.")
P("    A methanol vessel in a living space is not a product, whatever its COP.")
