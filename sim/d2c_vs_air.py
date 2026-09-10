#!/usr/bin/env python3
"""Head-to-head: 8U air stack vs D2C cold plate, per H100 SXM5 at 700 W."""
import sys,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from coldplate_spec import budget, thermal, PG25, SPEC as C
P=print; L=lambda c='-': P(c*80)
Q=700.0
_,R_d2c=budget(PG25); t=thermal(PG25)
R_air=0.0465+0.0247                      # soldered-fin chamber + 180x100x60 stack at 10 m/s

P("="*80); P("D2C COLD PLATE  vs  8U AIR  —  per H100 SXM5 at 700 W"); P("="*80)
rows=[
 ("Thermal resistance, die to coolant", f"{R_air:.4f} K/W", f"{R_d2c:.4f} K/W", f"{R_air/R_d2c:.1f}x better"),
 ("Die temperature", "75 C @ 25 C air", "66 C @ 45 C water", "9 K cooler"),
 ("Coolant inlet it can accept", "25-35 C cold aisle", "45-50 C warm water", "no chiller needed"),
 ("Heatsink envelope", "180x100x60 = 1080 cm3", f"{C['L']:.0f}x{C['W']:.0f}x{C['H_total']:.0f} = 85 cm3", "12.7x smaller"),
 ("Flow per GPU", "111 CFM", f"{C['flow_lpm']:.1f} L/min", "-"),
 ("Pressure drop", "275 Pa", f"{t['dP']:.1f} kPa", "-"),
]
P(f"\n{'':<38}{'8U AIR':>24}{'D2C':>22}")
for a,b,c,d in rows: P(f"  {a:<36}{b:>24}{c:>22}   {d}")

P("\n"); L('='); P("MOVING POWER — what it costs to shift 700 W"); L('=')
air_m3s=111/2118.9; air_hyd=air_m3s*275; air_fan=air_hyd/0.35
liq_m3s=C['flow_lpm']/60/1000; liq_hyd=liq_m3s*(t['dP']*1000+50000); liq_pump=liq_hyd/0.50
P(f"  air : {air_m3s:.4f} m3/s x 275 Pa = {air_hyd:.1f} W hydraulic / 0.35 fan eff = {air_fan:>5.1f} W per GPU")
P(f"  D2C : {liq_m3s*1e6:.1f} mL/s x {(t['dP']*1000+50000)/1000:.0f} kPa = {liq_hyd:.2f} W hydraulic / 0.50 pump = {liq_pump:>5.2f} W per GPU")
P(f"  -> {air_fan-liq_pump:.0f} W saved per GPU, {(air_fan-liq_pump)/Q*100:.1f}% of the GPU's own draw.")
P(f"     On an 8-GPU node that is {8*(air_fan-liq_pump):.0f} W of fan power removed.")
P("  And the bigger item is the chiller: 25 C air needs mechanical cooling in most")
P("  climates, while 45 C water runs on dry coolers year-round. That is the PUE gap,")
P("  typically 1.4-1.6 for chilled air against 1.1-1.2 for warm-water D2C.")

P("\n"); L('='); P("SAME PLATE, NEXT GENERATION"); L('=')
for lpm in (1.5,3.0):
    _,R=budget(PG25,lpm=lpm)
    P(f"  {lpm:.1f} L/min : " + "   ".join(
        f"{n} {q} W -> {45+R*q:.0f} C" for n,q in [("H100",700),("B200",1000),("GB200",1200)]))
P("  The air stack has no such headroom - 1200 W would need 190 CFM per GPU.")

P("\n"); L('='); P("WHAT D2C COSTS YOU  (be honest about this)"); L('=')
for x in ["Leaks. A wetted joint over a live board is a real failure mode. Needs",
          "  drip trays, leak detection and quick-disconnects rated for the fluid.",
          "CDU capital and a facility water loop - this is infrastructure, not a part.",
          "Serviceability: a card swap now means breaking a fluid connection.",
          "Fluid maintenance: PG25 needs inhibitor monitoring and periodic change.",
          "Vendor lock: the cold plate must match NVIDIA's SXM5 load-frame spec."]:
    P("  - "+x if not x.startswith("  ") else x)
P("\n  None of these outweighs a 2.4x thermal advantage plus the chiller saving at")
P("  700 W. Below about 400 W per part the balance flips back toward air.")
