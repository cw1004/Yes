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
MULT=int(sys.argv[1]) if len(sys.argv)>1 else 1
SHEETS=[("VC-100","General Assembly","VC-100_general-assembly.svg"),
        ("VC-101","Chamber Base","VC-101_chamber-base.svg"),
        ("VC-102","Chamber Lid","VC-102_chamber-lid.svg"),
        ("VC-103","Sintered Wick - Process Specification","VC-103_wick-sinter-spec.svg"),
        ("VC-201","Fin Stack - Two Configurations","VC-201_fin-stacks.svg"),
        ("VC-300","Process & Charging Specification","VC-300_process-charging.svg"),
        ("VC-400","Maxsorb III Reservoir - Test Coupon","VC-400_maxsorb-test-coupon.svg")]

if MULT!=1:                       # regenerate the sheets with multiplied scale labels
    import draft; draft.SCALE_MULT=MULT
    import sheets
    sheets.OUT=os.path.join(HERE,f"out{MULT}x"); os.makedirs(sheets.OUT,exist_ok=True)
    for fn in (sheets.sheet1,sheets.sheet2,sheets.sheet3,sheets.sheet4,
               sheets.sheet5,sheets.sheet6,sheets.sheet7): fn()
    SRC=sheets.OUT
else:
    SRC=os.path.join(HERE,"out")

PDF=os.path.join(HERE,"pdf"); os.makedirs(PDF,exist_ok=True)
PW,PH=420*MULT,297*MULT
TAG="" if MULT==1 else f"_{MULT}x"

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
 "/Title":f"VC-100 Vapour Chamber - Manufacturing Drawing Set, Rev A ({'A3' if MULT==1 else str(MULT)+'x'})",
 "/Subject":f"Cu-H2O vapour chamber 68 x 68 x 27 mm. 7 sheets, {size}.",
 "/Author":"INDIA-VC Thermal Hardware",
 "/Keywords":"vapour chamber, heat pipe, sintered wick, ISO 128, ISO 2768-mK, Rev A, CHECKED PENDING",
 "/Creator":"drawings/sheets.py (parametric, from sim/design_spec.py)"})
writer.page_layout="/SinglePage"
out=os.path.join(PDF,f"VC-100_drawing-set_RevA{TAG}.pdf")
with open(out,"wb") as f: writer.write(f)
print(f"\nset: {out}  {os.path.getsize(out)/1024:.0f} KB, {len(writer.pages)} pages, {size}")
