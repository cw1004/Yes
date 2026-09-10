#!/usr/bin/env python3
import os, re, json
HERE=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(HERE,"out")
SHEETS=[
 ("VC-100","GENERAL ASSEMBLY","2:1","1 / 7","VC-100_general-assembly.svg",
  "Whole-assembly view, BOM, junction-to-air resistance network and the performance table. Replaces the original single-sheet layout, whose stated 45 g mass was actually 161 g."),
 ("VC-101","CHAMBER BASE","2:1","2 / 7","VC-101_chamber-base.svg",
  "Adds the 100-post support array the original lacked entirely. Lid stress at 100 °C falls from 338 MPa to 2.8 MPa. Groove count corrected from 32 (spanning 22 mm of a 68 mm part) to 85 parallel grooves."),
 ("VC-102","CHAMBER LID","2:1","3 / 7","VC-102_chamber-lid.svg",
  "Fill port moved through the lid. The original Ø5.0 boss on a 4.0 mm edge face could not physically accept a 3.0 mm tube. Screw seal replaced by a cold-weld pinch-off."),
 ("VC-103","SINTERED WICK","10:1","4 / 7","VC-103_wick-sinter-spec.svg",
  "Wick pore size cut from 200 µm to ~25 µm. At 200 µm the capillary head (380 Pa) is below the gravity head over 68 mm (500 Pa), so the original chamber produced zero watts in any vertical orientation."),
 ("VC-201","FIN STACKS A & B","2:1","5 / 7","VC-201_fin-stacks.svg",
  "Fin count corrected from 12 (covering 18 mm of a 68 mm base) to 43. Adds Config B at 6.0 mm pitch, because a 1.5 mm pitch chokes natural convection to h = 0.25 W/m²K."),
 ("VC-300","PROCESS & CHARGING","—","6 / 7","VC-300_process-charging.svg",
  "Corrects the assembly order. The original charged methanol before a 250–300 °C TLP bond, which ruptures the chamber. Bond, bake out, evacuate, charge, pinch off."),
 ("VC-400","MAXSORB III COUPON","2:1","7 / 7","VC-400_maxsorb-test-coupon.svg",
  "The adsorbent idea kept as an instrumented experiment. Documents why the passive version drains 88% of the charge into the carbon, and what a valid test of it would require."),
]
def svg(fn):
    s=open(os.path.join(OUT,fn)).read()
    return re.sub(r'\swidth="100%"','',s,count=1)
KPI=[("113 W","forced air, 2 m/s","20×20 mm die, Tj 100 °C, air in 25 °C"),
     ("16.5 W","passive, Tj 85 °C","no fan, anodised, fins vertical, 25 °C"),
     ("0.67 K/W","junction-to-air","of which 0.194 K/W is the chamber"),
     ("804 W","capillary limit","water, vertical, 45–75 µm wick"),
     ("1.90 mL","charge","DI water, deaerated, 125% of wick void")]
nav="".join(f'''<button class="reg-row" role="tab" aria-selected="{str(i==0).lower()}" aria-controls="s{i}" id="t{i}" data-i="{i}" tabindex="{0 if i==0 else -1}">
<span class="reg-no">{n}</span><span class="reg-ti">{t}</span><span class="reg-sc">{sc}</span><span class="reg-sh">{sh}</span></button>'''
    for i,(n,t,sc,sh,f,d) in enumerate(SHEETS))
panels="".join(f'''<section class="panel" id="s{i}" role="tabpanel" aria-labelledby="t{i}" {"" if i==0 else "hidden"}>
<div class="paper">{svg(f)}</div>
<div class="rev"><span class="rev-tag">Rev A · what this sheet corrects</span><p>{d}</p></div></section>'''
    for i,(n,t,sc,sh,f,d) in enumerate(SHEETS))
kpis="".join(f'<div class="kpi"><dt>{l}</dt><dd class="kpi-v">{v}</dd><dd class="kpi-n">{n}</dd></div>' for v,l,n in KPI)

html=f'''<title>VC-100 Drawing Set</title>
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
  <div class="stamp"><b>INDIA-VC</b><span>VC-100 series</span><span>Rev A</span><span>ISO 128 / ISO 2768-mK</span><span>7 sheets</span></div>
  <h1>Vapour chamber, 68 × 68 × 27</h1>
  <p class="sub">Manufacturing set for the corrected Cu–H<sub>2</sub>O design, plotted as ISO&nbsp;A3 and as a
  5× enlargement (2100&nbsp;×&nbsp;1485&nbsp;mm, every scale label restated). It replaces the
  <b>Maxsorb III / 1.76× methanol</b> concept drawing, which could not be built: the adsorbent drained
  88% of the charge into the carbon, the unsupported 1&nbsp;mm lid yielded under atmospheric load alone,
  and the 200&nbsp;µm wick could not lift liquid against gravity. Every sheet below notes what it corrects.</p>
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

<footer>PDF: <code>pdf/VC-100_drawing-set_RevA.pdf</code> (A3) and <code>…_5x.pdf</code> (2100 × 1485 mm,
fits a 60&nbsp;in plotter roll). Sheets are vector (SVG), drawn to scale from a single parametric source — geometry, the bill of
materials and every performance figure derive from <code>sim/design_spec.py</code>, so a spec change
redraws the set. Title blocks read <em>CHECKED — PENDING</em>: nothing here has been reviewed by a
responsible engineer, and the process on VC-300 has not been run on real hardware.</footer>
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
open(os.path.join(HERE,"vc100-drawing-set.html"),"w").write(html)
print("bytes:", len(html))
