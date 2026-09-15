#!/usr/bin/env python3
import os, re, json
HERE=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(HERE,"si_out")
SHEETS=[
 ("SI-100","ARRANGEMENT","1:10","1 / 6","SI-100_general-arrangement.svg",
  "The whole machine, the Clapeyron cycle and the daily sequence. A wheeled trolley at 91 kg charged \u2014 not something a person carries."),
 ("SI-101","ADSORBER-COLLECTOR","1:10","2 / 6","SI-101_adsorber-collector.svg",
  "Eight stainless tubes welded to the absorber plate. Stagnation is the design case: 14.0 bar at 150 \u00b0C gives a 4.9\u00d7 margin on tube geometry alone, which is why it is tubes and not a flat box."),
 ("SI-102","CONDENSER & RECEIVER","1:5","3 / 6","SI-102_condenser-receiver.svg",
  "Air-cooled on buoyancy and radiation only \u2014 no fan. 1.16 m\u00b2 of surface for a 174 W mean duty, shaded, with the receiver below it so the loop drains by gravity."),
 ("SI-104","EVAPORATOR & ICE BOX","1:5","4 / 6","SI-104_evaporator-icebox.svg",
  "51 W mean over a twelve-hour night. The evaporator runs at 2.9 kPa absolute, so it is designed as a vacuum vessel rather than a pressure vessel."),
 ("SI-200","VACUUM & CHARGING","\u2014","5 / 6","SI-200_vacuum-charging.svg",
  "Ten steps to a one-time permanent charge. Charging is the most dangerous operation in the life of the machine, and the charge is specified by mass, never by volume."),
 ("SI-300","SAFETY & COMMISSIONING","\u2014","6 / 6","SI-300_safety-commissioning.svg",
  "Hazard data, the marking that goes on the vessel, commissioning, and what to do if the machine is damaged. It states plainly that this is not a certifiable domestic appliance."),
]
def svg(fn):
    s=open(os.path.join(OUT,fn)).read()
    return re.sub(r'\swidth="100%"','',s,count=1)
KPI=[("5 kg","ice per day","from 25 \u00b0C water, 1.0 m\u00b2 collector"),
     ("0.110","solar COP","literature reports 0.10\u20130.15"),
     ("4.9 kg","methanol charge","toxic and flammable \u2014 outdoor only"),
     ("14.0 bar","stagnation design","4.9\u00d7 margin on the tube"),
     ("91 kg","charged mass","a wheeled trolley, no electricity")]
nav="".join(f'''<button class="reg-row" role="tab" aria-selected="{str(i==0).lower()}" aria-controls="s{i}" id="t{i}" data-i="{i}" tabindex="{0 if i==0 else -1}">
<span class="reg-no">{n}</span><span class="reg-ti">{t}</span><span class="reg-sc">{sc}</span><span class="reg-sh">{sh}</span></button>'''
    for i,(n,t,sc,sh,f,d) in enumerate(SHEETS))
panels="".join(f'''<section class="panel" id="s{i}" role="tabpanel" aria-labelledby="t{i}" {"" if i==0 else "hidden"}>
<div class="paper">{svg(f)}</div>
<div class="rev"><span class="rev-tag">Rev A · what this sheet corrects</span><p>{d}</p></div></section>'''
    for i,(n,t,sc,sh,f,d) in enumerate(SHEETS))
kpis="".join(f'<div class="kpi"><dt>{l}</dt><dd class="kpi-v">{v}</dd><dd class="kpi-n">{n}</dd></div>' for v,l,n in KPI)

html=f'''<title>SI-100 Solar Ice Maker</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{{
  --paper:#ffffff; --ground:#eef2f5; --panel:#f8fafb; --edge:#d5dee5;
  --ink:#101820; --ink-2:#48606f; --ink-3:#7b909e;
  --blue:#1b5e8c; --blue-soft:#e3eef6; --oxide:#8a2f2f;
  --shadow:0 1px 2px rgba(16,24,32,.09),0 12px 28px -12px rgba(16,24,32,.28);
  --sans:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SFMono-Regular',Menlo,monospace;
}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{
  --paper:#ffffff; --ground:#0d1216; --panel:#151d23; --edge:#27343d;
  --ink:#e7eef3; --ink-2:#9db0bd; --ink-3:#6d8393;
  --blue:#68b0dd; --blue-soft:#16303f; --oxide:#d98a8a;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 18px 40px -14px rgba(0,0,0,.7);
}}}}
:root[data-theme="dark"]{{
  --paper:#ffffff; --ground:#0d1216; --panel:#151d23; --edge:#27343d;
  --ink:#e7eef3; --ink-2:#9db0bd; --ink-3:#6d8393;
  --blue:#68b0dd; --blue-soft:#16303f; --oxide:#d98a8a;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 18px 40px -14px rgba(0,0,0,.7);
}}
*{{box-sizing:border-box}}
body{{background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.55;margin:0}}
.wrap{{max-width:1360px;margin:0 auto;padding:28px 20px 64px;display:flex;flex-direction:column;gap:26px}}

header.mast{{display:flex;flex-direction:column;gap:14px;border-bottom:2px solid var(--ink);padding-bottom:16px}}
.stamp{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-family:var(--mono);font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2)}}
.stamp b{{color:var(--paper);background:var(--blue);padding:3px 8px;font-weight:600;letter-spacing:.14em}}
:root[data-theme="dark"] .stamp b,{{color:#0d1216}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]) .stamp b{{color:#0d1216}}}}
.stamp span{{border:1px solid var(--edge);padding:2px 8px}}
h1{{font-size:clamp(26px,3.4vw,40px);line-height:1.08;margin:0;font-weight:600;letter-spacing:-.02em;text-wrap:balance}}
.sub{{margin:0;max-width:66ch;color:var(--ink-2);font-size:15px}}
.sub b{{color:var(--ink);font-weight:600}}

dl.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0;margin:0;
  border:1px solid var(--edge);background:var(--panel)}}
.kpi{{padding:12px 16px;border-right:1px solid var(--edge)}}
.kpi:last-child{{border-right:0}}
.kpi dt{{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3)}}
.kpi dd{{margin:0}}
.kpi-v{{font-family:var(--mono);font-size:23px;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;color:var(--blue);margin-top:2px !important}}
.kpi-n{{font-size:12px;color:var(--ink-2);margin-top:1px !important}}

.layout{{display:grid;grid-template-columns:270px minmax(0,1fr);gap:22px;align-items:start}}
@media (max-width:900px){{.layout{{grid-template-columns:1fr}}}}

.register{{border:1px solid var(--edge);background:var(--panel);position:sticky;top:16px}}
.register h2{{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-3);margin:0;padding:10px 14px;border-bottom:1px solid var(--edge)}}
.reg-row{{display:grid;grid-template-columns:auto 1fr;grid-template-areas:"no sh" "ti ti" "sc sc";
  gap:1px 10px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--edge);
  padding:9px 14px;cursor:pointer;font-family:inherit;color:var(--ink-2)}}
.reg-row:last-child{{border-bottom:0}}
.reg-row:hover{{background:var(--blue-soft)}}
.reg-row:focus-visible{{outline:2px solid var(--blue);outline-offset:-2px}}
.reg-row[aria-selected="true"]{{background:var(--blue-soft);box-shadow:inset 3px 0 0 var(--blue)}}
.reg-row[aria-selected="true"] .reg-ti{{color:var(--ink);font-weight:600}}
.reg-no{{grid-area:no;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--blue)}}
.reg-sh{{grid-area:sh;justify-self:end;font-family:var(--mono);font-size:10px;color:var(--ink-3)}}
.reg-ti{{grid-area:ti;font-size:13px}}
.reg-sc{{grid-area:sc;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--ink-3)}}

.toolbar{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}}
.toolbar .lbl{{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);margin-right:2px}}
.zoom{{font-family:var(--mono);font-size:12px;padding:5px 11px;border:1px solid var(--edge);
  background:var(--panel);color:var(--ink-2);cursor:pointer}}
.zoom:hover{{border-color:var(--blue);color:var(--ink)}}
.zoom:focus-visible{{outline:2px solid var(--blue);outline-offset:1px}}
.zoom[aria-pressed="true"]{{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}}
.hint{{margin-left:auto;font-size:12px;color:var(--ink-3)}}

.viewport{{border:1px solid var(--edge);background:var(--panel);padding:14px;overflow-x:auto}}
.paper{{background:var(--paper);box-shadow:var(--shadow);width:100%;margin:0 auto}}
.paper svg{{display:block;width:100%;height:auto}}
.viewport[data-z="1.5"] .paper{{width:150%}}
.viewport[data-z="2.5"] .paper{{width:250%}}

.rev{{margin-top:14px;border-left:3px solid var(--oxide);background:var(--panel);
  border-top:1px solid var(--edge);border-right:1px solid var(--edge);border-bottom:1px solid var(--edge);padding:11px 15px}}
.rev-tag{{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--oxide);font-weight:600}}
.rev p{{margin:5px 0 0;font-size:14px;color:var(--ink-2);max-width:78ch}}

footer{{border-top:1px solid var(--edge);padding-top:14px;font-size:12.5px;color:var(--ink-3);max-width:78ch}}
footer code{{font-family:var(--mono);color:var(--ink-2)}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important;animation:none!important}}}}
</style>

<div class="wrap">
<header class="mast">
  <div class="stamp"><b>INDIA-VC</b><span>SI-100 series</span><span>Rev A</span><span>ISO 128 / ISO 2768-mK</span><span>6 sheets</span></div>
  <h1>Solar adsorption ice maker</h1>
  <p class="sub">Activated carbon and methanol, driven by the sun and nothing else \u2014 no pump, no compressor,
  no electricity. One cycle a day: heat and desorb through the afternoon, cool and adsorb overnight, harvest ice
  in the morning. It carries <b>4.9\u00a0kg of methanol</b>, which is toxic, flammable and burns with a nearly
  invisible flame, so every sheet is drawn for an <b>outdoor off-grid machine</b> \u2014 all-welded, permanently
  sealed, with no service port anywhere on the wetted envelope. It is not a domestic appliance and there is no
  certification path to make it one.</p>
</header>

<dl class="kpis">{kpis}</dl>

<div class="layout">
  <nav class="register" role="tablist" aria-label="Drawing register">
    <h2>Drawing register</h2>
    {nav}
  </nav>
  <div>
    <div class="toolbar">
      <span class="lbl">Zoom</span>
      <button class="zoom" data-z="fit" aria-pressed="true">Fit</button>
      <button class="zoom" data-z="1.5" aria-pressed="false">150%</button>
      <button class="zoom" data-z="2.5" aria-pressed="false">250%</button>
      <span class="hint">↑ ↓ to change sheet</span>
    </div>
    <div class="viewport" id="vp" data-z="fit">{panels}</div>
  </div>
</div>

<footer>PDF: <code>pdf/SI-100_drawing-set_RevA.pdf</code> (A3) and <code>\u2026_5x.pdf</code> (2100 \u00d7 1485 mm).
Sheets are vector, drawn to scale from <code>sim/icemaker_spec.py</code>, so a spec change redraws the set.
The 0.55 system realisation factor is stated rather than hidden: without it the equilibrium model predicts
about twice the published solar-icemaker output. Title blocks read <em>CHECKED \u2014 PENDING</em> \u2014 nothing
here has been reviewed by a responsible engineer, no hardware has been built, and the machine carries no
certification of any kind.</footer>
</div>

<script>
(function(){{
  var tabs=[].slice.call(document.querySelectorAll('.reg-row')),
      panels=[].slice.call(document.querySelectorAll('.panel')),
      vp=document.getElementById('vp');
  function show(i){{
    tabs.forEach(function(t,j){{
      t.setAttribute('aria-selected',j===i); t.tabIndex=j===i?0:-1;
      panels[j].hidden=j!==i;
    }});
    vp.scrollLeft=0;
  }}
  tabs.forEach(function(t,i){{
    t.addEventListener('click',function(){{show(i);}});
    t.addEventListener('keydown',function(e){{
      var d=e.key==='ArrowDown'||e.key==='ArrowRight'?1:(e.key==='ArrowUp'||e.key==='ArrowLeft'?-1:0);
      if(!d)return; e.preventDefault();
      var n=(i+d+tabs.length)%tabs.length; show(n); tabs[n].focus();
    }});
  }});
  [].forEach.call(document.querySelectorAll('.zoom'),function(b){{
    b.addEventListener('click',function(){{
      [].forEach.call(document.querySelectorAll('.zoom'),function(o){{o.setAttribute('aria-pressed',o===b);}});
      vp.dataset.z=b.dataset.z; vp.scrollLeft=0;
    }});
  }});
}})();
</script>'''
open(os.path.join(HERE,"si100-ice-maker.html"),"w").write(html)
print("bytes:", len(html))
