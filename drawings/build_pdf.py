#!/usr/bin/env python3
"""SVG sheets -> vector PDF.

  python3 build_pdf.py        1x  ISO A3   420 x 297 mm   (scales as drawn, e.g. 2:1)
  python3 build_pdf.py 5      5x  plot    2100 x 1485 mm  (every scale label x5, e.g. 10:1)

The enlargement rewrites the printed scale strings as well as the page, so a
part measured off the 5x plot with a rule still agrees with its stated scale.
"""
import os, re, io, sys, cairosvg
from pypdf import PdfWriter, PdfReader

HERE=os.path.dirname(os.path.abspath(__file__))
ARGS=[a for a in sys.argv[1:]]
SET=next((a for a in ARGS if a in ("vc","cp")),"vc")
MULT=next((int(a) for a in ARGS if a.isdigit()),1)
VC_SHEETS=[("VC-100","General Assembly","VC-100_general-assembly.svg"),
        ("VC-101","Chamber Base","VC-101_chamber-base.svg"),
        ("VC-102","Chamber Lid","VC-102_chamber-lid.svg"),
        ("VC-103","Sintered Wick - Process Specification","VC-103_wick-sinter-spec.svg"),
        ("VC-201","Fin Stack - Two Configurations","VC-201_fin-stacks.svg"),
        ("VC-300","Process & Charging Specification","VC-300_process-charging.svg"),
        ("VC-400","Maxsorb III Reservoir - Test Coupon","VC-400_maxsorb-test-coupon.svg")]
CP_SHEETS=[("CP-100","D2C Cold Plate - General Assembly","CP-100_general-assembly.svg"),
        ("CP-101","Cold Plate Body","CP-101_body.svg"),
        ("CP-102","Cover / Manifold","CP-102_cover.svg"),
        ("CP-103","Thermal-Hydraulic Specification","CP-103_thermal-hydraulic.svg"),
        ("CP-200","SXM5 Mounting Interface","CP-200_mounting.svg"),
        ("CP-300","Process, Test & Coolant Specification","CP-300_process-coolant.svg")]
SHEETS = VC_SHEETS if SET=="vc" else CP_SHEETS
SRCDIR = "out" if SET=="vc" else "cp_out"
MODNAME= "sheets" if SET=="vc" else "cp_sheets"
SETNAME= ("VC-100 Vapour Chamber" if SET=="vc" else "CP-100 D2C Cold Plate")
SETSUBJ= ("Cu-H2O vapour chamber 68 x 68 x 27 mm" if SET=="vc"
          else "Direct-to-chip cold plate for H100 SXM5, 700 W, Cu C10200")

if MULT!=1:                       # regenerate the sheets with multiplied scale labels
    import draft, importlib; draft.SCALE_MULT=MULT
    mod=importlib.import_module(MODNAME)
    mod.OUT=os.path.join(HERE,f"{SRCDIR}{MULT}x"); os.makedirs(mod.OUT,exist_ok=True)
    fns=[getattr(mod,f"sheet{i}") for i in range(1,len(SHEETS)+1)]
    for fn in fns: fn()
    SRC=mod.OUT
else:
    SRC=os.path.join(HERE,SRCDIR)

PDF=os.path.join(HERE,"pdf"); os.makedirs(PDF,exist_ok=True)
PW,PH=420*MULT,297*MULT
TAG="" if MULT==1 else f"_{MULT}x"
PRE=SET.upper()

def to_pdf_bytes(path):
    svg=open(path).read()
    svg=re.sub(r'<svg\b[^>]*?>',
               lambda m: re.sub(r'\swidth="[^"]*"','',m.group(0))
                          .replace('<svg ',f'<svg width="{PW}mm" height="{PH}mm" ',1), svg, count=1)
    return cairosvg.svg2pdf(bytestring=svg.encode())

writer=PdfWriter()
for i,(no,title,fn) in enumerate(SHEETS):
    b=to_pdf_bytes(os.path.join(SRC,fn))
    open(os.path.join(PDF,fn.replace(".svg",f"{TAG}.pdf")),"wb").write(b)
    pg=PdfReader(io.BytesIO(b)).pages[0]
    writer.add_page(pg); writer.add_outline_item(f"{no} - {title}",i)
    w,h=float(pg.mediabox.width),float(pg.mediabox.height)
    print(f"  p{i+1}  {no:<7} {w:8.2f} x {h:8.2f} pt  ({w/72*25.4:7.1f} x {h/72*25.4:7.1f} mm)")

size=f"ISO A3 420 x 297 mm" if MULT==1 else f"{PW} x {PH} mm ({MULT}x enlargement, scales restated)"
writer.add_metadata({
 "/Title":f"{SETNAME} - Manufacturing Drawing Set, Rev A ({'A3' if MULT==1 else str(MULT)+'x'})",
 "/Subject":f"{SETSUBJ}. {len(SHEETS)} sheets, {size}.",
 "/Author":"INDIA-VC Thermal Hardware",
 "/Keywords":"ISO 128, ISO 2768-mK, Rev A, CHECKED PENDING",
 "/Creator":f"drawings/{MODNAME}.py (parametric)"})
writer.page_layout="/SinglePage"
out=os.path.join(PDF,f"{PRE}-100_drawing-set_RevA{TAG}.pdf")
with open(out,"wb") as f: writer.write(f)
print(f"\nset: {out}  {os.path.getsize(out)/1024:.0f} KB, {len(writer.pages)} pages, {size}")
