#!/usr/bin/env python3
import sys, os, math
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path[:0]=[HERE, os.path.join(HERE,"..","sim")]
from draft import *
from coldplate_spec import SPEC as S, WATER, PG25, thermal, budget

OUT=os.path.join(HERE,"cp_out"); os.makedirs(OUT,exist_ok=True)
TB=[("DRAWN","AI-ASSISTED DRAFT"),("CHECKED","— PENDING —"),
    ("MATERIAL","SEE BOM"),("FINISH","SEE NOTES"),("DATE","2026-09-10")]
TW=thermal(PG25); TWW=thermal(WATER); RB,RT=budget(PG25)
def emit(sh,name):
    sh.frame(); sh.title_block(TB); sh.save(os.path.join(OUT,name)); print("  ",name)
def rsq(sh,x,y,w,h,r,sw=W_VIS,c=INK,fill="none"):
    sh.raw(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" rx="{r:.3f}" '
           f'fill="{fill}" stroke="{c}" stroke-width="{sw}"/>')
MNT=[(S['mnt_edge'],S['mnt_edge']),(S['L']-S['mnt_edge'],S['mnt_edge']),
     (S['mnt_edge'],S['W']-S['mnt_edge']),(S['L']-S['mnt_edge'],S['W']-S['mnt_edge'])]
PX0=(S['L']-S['pocket_L'])/2; PY0=(S['W']-S['pocket_W'])/2
FX0=PX0+S['plenum']

# ══════════════════════════════════════════ SHEET 1  CP-100
def sheet1():
    sh=Sheet("CP-100","D2C COLD PLATE — GENERAL ASSEMBLY","2:1",
             "H100 SXM5  /  700 W  /  Cu C10200, VACUUM BRAZED  /  PG25 1.5 L/min")
    sh.sheet_of="1 / 6"
    K=2.0; cx=100.0; hw=S['L']*K/2; L,R=cx-hw,cx+hw
    sh.view_label(cx,20,"EXPLODED ASSEMBLY","SCALE 2:1")
    # cover + ports
    yc=30.0; ct=S['cover_t']*K
    for px_ in (FX0-S['plenum']/2, FX0+S['fin_L']+S['plenum']/2):
        bx=L+px_*K
        sh.rect(bx-4,yc-S['port_boss']*K,8,S['port_boss']*K,W_VIS,INK,"#fff")
        sh.hatch(bx-4,yc-S['port_boss']*K,8,S['port_boss']*K,45,1.4)
        sh.line(bx,yc-S['port_boss']*K-5,bx,yc-S['port_boss']*K,1.2,"#2c4a63")
    sh.rect(L,yc,hw*2,ct,W_VIS,INK,"#fff"); sh.hatch(L,yc,hw*2,ct,45,1.5)
    sh.rect(L+FX0*K,yc+ct,S['fin_L']*K,1.0,W_THIN,INK,"#e9eef2")
    sh.balloon(R+13,yc+ct*0.5,"2",R-2,yc+ct*0.5)
    sh.leader(L+(FX0+S['fin_L']+S['plenum']/2)*K,yc-S['port_boss']*K-5,cx+46,yc-13,
              f"2 x {S['port']} PORT",fs=FS_S-0.4)
    # braze ring
    yb=yc+ct+11
    for seg in [(L,PX0*K),(L+(PX0+S['pocket_L'])*K,hw*2-(PX0+S['pocket_L'])*K)]:
        sh.rect(seg[0],yb,seg[1],1.6,W_THIN,"#8a5a1f","#f6ecdc")
    sh.balloon(R+13,yb+0.8,"3",R-PX0*K*0.5,yb+0.8)
    # body
    ybd=yb+11; bt=S['H_body']*K; pd=S['pocket_d']*K
    op=[(L,ybd),(L+PX0*K,ybd),(L+PX0*K,ybd+pd),(R-PX0*K,ybd+pd),(R-PX0*K,ybd),(R,ybd),(R,ybd+bt),(L,ybd+bt)]
    sh.hatch_poly(op,45,1.5); sh.poly(op,W_VIS,INK,close=True)
    for i in range(26):
        fx=L+(FX0+1+i*1.5)*K
        if fx<L+(FX0+S['fin_L'])*K: sh.line(fx,ybd+pd-S['fin_h']*K,fx,ybd+pd,0.3,INK)
    sh.balloon(R+13,ybd+bt*0.8,"1",R-2,ybd+bt*0.8)
    sh.leader(L+(FX0+8)*K,ybd+pd-S['fin_h']*K,cx-16,ybd-5,
              f"{S['n_ch']} SKIVED FINS",anchor="end",fs=FS_S-0.4)
    sh.leader(L+PX0*K+3,ybd+pd-2,cx+34,ybd+bt+9,"INLET PLENUM",fs=FS_S-0.4)
    # TIM + package
    yt=ybd+bt+11
    sh.rect(L+18,yt,hw*2-36,1.4,W_HID,INK,"#e6ebf0"); sh.balloon(R+13,yt+0.7,"4",R-18,yt+0.7)
    yp=yt+9
    sh.rect(L+10,yp,hw*2-20,5,W_VIS,"#5b4632","#f3ede5")
    sh.rect(cx-S['die']*K/2,yp-2.4,S['die']*K,2.4,W_VIS,"#8a2f2f","#fbf1f1")
    sh.text(cx,yp+3.6,f"H100 SXM5 PACKAGE  —  GH100 DIE {S['die']:.1f} sq  —  NOT SUPPLIED",FS_S-0.5,"#5b4632","middle","600")
    sh.ctr_v(24,yp+8,cx)
    sh.dim_h(L,R,yp+13,f"{S['L']:.0f}",ext_from=(yp+5,yp+5))
    sh.text(cx,yp+21,f"ASSEMBLED HEIGHT {S['H_body']+S['cover_t']:.0f} mm  +  {S['port_boss']:.0f} PORT BOSS  =  {S['H_total']:.0f} mm",
            FS_S-0.4,THIN,"middle")

    # ---- assembled section
    ay=168.0; AK=2.0; aL=cx-S['L']*AK/2; aR=cx+S['L']*AK/2
    sh.view_label(cx,ay-10,"SECTION  A—A   (ASSEMBLED)","SCALE 2:1")
    bt2=S['H_body']*AK; ct2=S['cover_t']*AK; pd2=S['pocket_d']*AK
    op2=[(aL,ay+ct2),(aL+PX0*AK,ay+ct2),(aL+PX0*AK,ay+ct2+pd2),
         (aR-PX0*AK,ay+ct2+pd2),(aR-PX0*AK,ay+ct2),(aR,ay+ct2),(aR,ay+ct2+bt2),(aL,ay+ct2+bt2)]
    sh.hatch_poly(op2,45,1.5); sh.poly(op2,W_VIS,INK,close=True)
    sh.rect(aL,ay,S['L']*AK,ct2,W_VIS,INK,"#fff"); sh.hatch(aL,ay,S['L']*AK,ct2,135,1.5)
    for i in range(24):
        fx=aL+(FX0+0.8+i*1.6)*AK
        if fx<aL+(FX0+S['fin_L'])*AK: sh.line(fx,ay+ct2+pd2-S['fin_h']*AK,fx,ay+ct2+pd2,0.3,INK)
    for px_ in (FX0-S['plenum']/2, FX0+S['fin_L']+S['plenum']/2):
        bx=aL+px_*AK
        sh.rect(bx-4,ay-S['port_boss']*AK,8,S['port_boss']*AK,W_VIS,INK,"#fff")
        sh.hatch(bx-4,ay-S['port_boss']*AK,8,S['port_boss']*AK,45,1.4)
        sh.rect(bx-2,ay-S['port_boss']*AK,4,S['port_boss']*AK+ct2,0,"none","#fff")
        sh.poly([(bx-2,ay-S['port_boss']*AK),(bx-2,ay+ct2)],W_VIS,INK)
        sh.poly([(bx+2,ay-S['port_boss']*AK),(bx+2,ay+ct2)],W_VIS,INK)
    for seg in [(aL,PX0*AK),(aR-PX0*AK,PX0*AK)]:
        sh.line(seg[0],ay+ct2,seg[0]+seg[1],ay+ct2,1.1,"#8a5a1f")
    sh.rect(aL+18,ay+ct2+bt2,S['L']*AK-36,1.2,W_HID,INK,"#e6ebf0")
    sh.rect(cx-S['die']*AK/2,ay+ct2+bt2+1.2,S['die']*AK,4,W_VIS,"#8a2f2f","#fbf1f1")
    sh.text(cx,ay+ct2+bt2+4.2,"GH100 DIE",FS_S-0.6,"#8a2f2f","middle","600")
    sh.leader(aL+PX0*AK*0.5,ay+ct2,cx-26,ay-5,"BRAZE JOINT (3)",anchor="end",fs=FS_S-0.5)
    sh.dim_v(ay,ay+ct2+bt2,aR+10,f"{S['H_body']+S['cover_t']:.0f}",ext_from=(aR,aR))
    sh.text(cx,ay+ct2+bt2+12,"Coolant enters left plenum, crosses 125 channels, leaves right plenum.",FS_S-0.5,DIM,"middle")

    X=196.0; WD=212.0
    y=sh.table(X,18,WD,[("ITEM",0.07,"c"),("QTY",0.08,"c"),("PART No.",0.16,"l"),
        ("DESCRIPTION",0.37,"l"),("MATERIAL",0.20,"l"),("NOTE",0.12,"r")],
      [["1","1","CP-101","COLD PLATE BODY, SKIVED FIN","Cu C10200 / C1020","sheet 2"],
       ["2","1","CP-102","COVER / MANIFOLD, 2 PORTS","Cu C10200 / C1020","sheet 3"],
       ["3","1","CP-103","BRAZE PREFORM, PERIMETER RING","BCuP-5 (Ag 15%)","0.10 foil"],
       ["4","1","CP-104","THERMAL INTERFACE, BARE DIE","PTM, k >= 13 W/mK","60 um BLT"],
       ["5","4","CP-201","SPRING SCREW + BELLEVILLE STACK","A2-70 / 17-7PH","sheet 5"],
       ["6","2","CP-202","QUICK DISCONNECT, DRIP-FREE","Ni-plated brass","loop side"]],
      title="BILL OF MATERIALS   —   ASSEMBLY CP-100")
    rows=[[("*" if k=="fluid" else "")+{"fluid":"coolant (convection + sensible)","TIM":"TIM, bare die 60 um k=13",
            "spread":"spreading, die to fin field","base":f"base {S['base_t']:.1f} mm Cu"}[k],
           ("*" if k=="fluid" else "")+f"{v:.4f}",f"{v*S['Q']:.1f} K",f"{v/RT*100:.0f} %"]
          for k,v in sorted(RB.items(),key=lambda x:-x[1])]
    rows.append(["*TOTAL, die to coolant inlet",f"*{RT:.4f}",f"*{RT*S['Q']:.1f} K","*100 %"])
    y=sh.table(X,y+8,WD,[("PATH",0.46,"l"),("K/W",0.18,"c"),("dT @ 700 W",0.20,"c"),("SHARE",0.16,"r")],
               rows,title="RESISTANCE BUDGET   —   PG25, 1.5 L/min")
    y=sh.table(X,y+8,WD,[("COOLANT IN",0.22,"c"),("H100 700 W",0.26,"r"),
                         ("B200 1000 W",0.26,"r"),("GB200 1200 W",0.26,"r")],
      [[f"{t} C"]+[("*" if t==45 else "")+f"{t+RT*q:.0f} C" for q in (700,1000,1200)]
       for t in (32,40,45,50)],
      title="DIE TEMPERATURE   —   SAME PLATE, 1.5 L/min")
    # flow schematic
    sh.view_label(X+WD/2,y+11,"LOOP SCHEMATIC","ONE GPU SHOWN")
    fy=y+20; bw=34.0; gap=8.0; bx=X+2
    for i,(lab,sub) in enumerate([("CDU","45 C out"),("MANIFOLD","supply"),("QD","drip-free"),
                                  ("CP-100","700 W"),("QD  →  RETURN","to CDU")]):
        xx=bx+i*(bw+gap)
        rsq(sh,xx,fy,bw,13,1.2,W_VIS,INK,"#eef2f6" if lab=="CP-100" else "#fff")
        sh.text(xx+bw/2,fy+5.6,lab,FS_S-0.4,INK,"middle","700")
        sh.text(xx+bw/2,fy+10,sub,FS_S-0.7,DIM,"middle")
        if i:
            sh.line(xx-gap,fy+6.5,xx,fy+6.5,W_VIS,DIM); sh._arrow(xx,fy+6.5,0,DIM)
    sh.line(bx+4*(bw+gap)+bw/2,fy+13,bx+4*(bw+gap)+bw/2,fy+19,W_VIS,DIM)
    sh.line(bx+bw/2,fy+19,bx+4*(bw+gap)+bw/2,fy+19,W_VIS,DIM)
    sh.line(bx+bw/2,fy+19,bx+bw/2,fy+13,W_VIS,DIM); sh._arrow(bx+bw/2,fy+13,270,DIM)
    sh.text(bx,fy+24.5,f"per GPU: {S['flow_lpm']:.1f} L/min PG25, {TW['dP']:.1f} kPa at the plate, "
            f"{TW['dTw']:.1f} K coolant rise",FS_S-0.4,INK,"start","600")

    sh.notes(12,242,216,"GENERAL NOTES",
      ["Interpret per ISO 128. Tolerances ISO 2768-mK unless stated. Dimensions in mm.",
       "EVERY WETTED PART IS COPPER OR STAINLESS. No aluminium anywhere in the loop — a Cu/Al couple in glycol corrodes the aluminium out within months.",
       "Cover is vacuum brazed to the body: no elastomer inside the loop, no serviceable joint. Replace, do not open.",
       "SXM5 interface dimensions and mounting preload on sheet 5 are ASSUMED. Confirm against NVIDIA's mechanical specification before manufacture."],lh=3.4,fs=FS_S-0.4)
    emit(sh,"CP-100_general-assembly.svg")

# ══════════════════════════════════════════ SHEET 2  CP-101
def sheet2():
    sh=Sheet("CP-101","COLD PLATE BODY","2:1",
             f"Cu C10200 (JIS C1020)  /  {S['L']:.0f} x {S['W']:.0f} x {S['H_body']:.1f}  /  {S['n_ch']} SKIVED FINS")
    sh.sheet_of="2 / 6"
    K=2.0; x0,y0=28.0,40.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    Lp,Rp,Tp,Bp=px(0),px(S['L']),py(0),py(S['W'])
    rsq(sh,Lp,Tp,S['L']*K,S['W']*K,1.0)
    rsq(sh,px(PX0),py(PY0),S['pocket_L']*K,S['pocket_W']*K,2.0)
    sh.rect(px(FX0),py(PY0),S['fin_L']*K,S['pocket_W']*K,W_THIN,INK,"#f4f7f9")
    for i in range(28):
        yy=py(PY0+1.2+i*1.75)
        if yy<py(PY0+S['pocket_W'])-1: sh.line(px(FX0),yy,px(FX0+S['fin_L']),yy,0.22,"#8fa2b3")
    for cxm,cym in MNT:
        sh.circ(px(cxm),py(cym),1.7*K/2,W_VIS,INK,"#fff")
        sh.ctr_h(px(cxm)-5,px(cxm)+5,py(cym)); sh.ctr_v(py(cym)-5,py(cym)+5,px(cxm))
    sh.ctr_h(Lp-7,Rp+7,py(S['W']/2)); sh.ctr_v(Tp-7,Bp+7,px(S['L']/2))
    sh.view_label(px(S['L']/2),Tp-22,"PLAN  —  FIN SIDE UP","SCALE 2:1")
    sh._arrow(px(S['L']/2)-30,Tp+S['W']*K/2,0,"#2c4a63")
    sh.text(px(S['L']/2)-42,Tp+S['W']*K/2-2.5,"FLOW",FS_S-0.4,"#2c4a63","middle","700")
    sh.dim_h(Lp,Rp,Bp+21,f"{S['L']:.0f}",ext_from=(Bp,Bp))
    sh.dim_h(px(PX0),px(PX0+S['pocket_L']),Bp+12,f"{S['pocket_L']:.0f}  POCKET",ext_from=(Bp,Bp))
    sh.dim_v(Tp,Bp,Lp-11,f"{S['W']:.0f}",ext_from=(Lp,Lp))
    sh.dim_v(py(PY0),py(PY0+S['pocket_W']),Rp+11,f"{S['pocket_W']:.0f}",ext_from=(Rp,Rp))
    sh.dim_h(px(PX0),px(FX0),Tp-6,f"{S['plenum']:.0f}",ext_from=(Tp,Tp))
    sh.dim_h(px(FX0),px(FX0+S['fin_L']),Tp-14,f"{S['fin_L']:.0f}  FIN FIELD",ext_from=(Tp,Tp))
    sh.leader(px(FX0+14),py(PY0+10),Rp+5,py(6),f"{S['n_ch']} CHANNELS — DETAIL E")
    sh.leader(px(MNT[1][0]),py(MNT[1][1])+1.7,Rp+5,py(20),"4 x \u00d83.4 THRU, MOUNT",dot=True)
    sh.leader(px(PX0+3),py(PY0+S['pocket_W']-5),Rp+5,py(34),"PLENUM, BOTH ENDS")
    sh.section_mark(Lp-5,py(S['W']/2),"B","right"); sh.section_mark(Rp+5,py(S['W']/2),"B","left")

    sh.view_label(px(S['L']/2),Bp+32,"SECTION  B—B   (ALONG FLOW)","SCALE 2:1")
    sy=Bp+44; bt=S['H_body']*K; pd=S['pocket_d']*K
    op=[(Lp,sy),(px(PX0),sy),(px(PX0),sy+pd),(px(PX0+S['pocket_L']),sy+pd),
        (px(PX0+S['pocket_L']),sy),(Rp,sy),(Rp,sy+bt),(Lp,sy+bt)]
    sh.hatch_poly(op,45,1.5); sh.poly(op,W_VIS,INK,close=True)
    sh.rect(px(FX0),sy+pd-S['fin_h']*K,S['fin_L']*K,S['fin_h']*K,W_THIN,INK,"#eef3f7")
    sh.hatch(px(FX0),sy+pd-S['fin_h']*K,S['fin_L']*K,S['fin_h']*K,90,0.8,"#9fb4c6")
    sh.dim_v(sy,sy+bt,Rp+10,f"{S['H_body']:.1f}",ext_from=(Rp,Rp))
    sh.dim_v(sy+pd,sy+bt,Rp+21,f"{S['base_t']:.1f}",ext_from=(Rp,Rp))
    sh.dim_v(sy,sy+pd,Lp-10,f"{S['pocket_d']:.1f}",ext_from=(Lp,Lp))
    sh.detail_circle(px(FX0+3),sy+pd-S['fin_h']*K*0.5,7,"E",lx=px(9),ly=sy-1)

    KE=12.0; ex=214.0
    sh.view_label(ex+50,62,"DETAIL  E  —  FIN ROOT","SCALE 12:1")
    ft=S['fin_t']*KE; cw=S['ch_w']*KE; fh=S['fin_h']*KE; bs=S['base_t']*KE
    FY=138.0; WD2=104.0
    sh.rect(ex,FY,WD2,bs,W_VIS,INK,"#fff"); sh.hatch(ex,FY,WD2,bs,45,1.8)
    n=int((WD2-8)/(ft+cw))
    for i in range(n):
        fx=ex+5+i*(ft+cw)
        if fx+ft<ex+WD2-2: sh.rect(fx,FY-fh,ft,fh,W_VIS,INK,"#fff")
    sh.line(ex-4,FY-fh-1.4,ex+WD2+4,FY-fh-1.4,1.0,"#2c4a63")
    sh.text(ex+WD2+6,FY-fh-1.0,"CP-102 COVER",FS_S-0.5,"#2c4a63","start","600")
    sh.dim_h(ex+5,ex+5+ft+cw,FY+bs+10,f"{S['ch_p']:.2f} PITCH",ext_from=(FY+bs,FY+bs))
    sh.dim_h(ex+5,ex+5+ft,FY-fh-9,f"{S['fin_t']:.2f}")
    sh.dim_h(ex+5+ft,ex+5+ft+cw,FY-fh-17,f"{S['ch_w']:.2f}")
    sh.dim_v(FY-fh,FY,ex-9,f"{S['fin_h']:.1f}",ext_from=(ex,ex))
    sh.dim_v(FY,FY+bs,ex-9,f"{S['base_t']:.1f}",ext_from=(ex,ex))
    sh.leader(ex+WD2*0.55,FY-fh-1.4,ex+WD2*0.55,FY-fh-26,
              f"TIP CLEARANCE {S['tip_clr']:.2f} MAX — NOT BRAZED",fs=FS_S-0.5)
    yT=sh.table(ex-6,168,126,[("",0.56,"l"),("",0.44,"r")],
      [["channels",f"{S['n_ch']}"],["hydraulic diameter",f"{TW['Dh']:.3f} mm"],
       ["velocity @ 1.5 L/min",f"{TW['v']:.2f} m/s"],["Reynolds",f"{TW['Re']:.0f}  laminar"],
       ["h",f"{TW['h']:.0f} W/m2K"],["fin efficiency",f"{TW['eta']:.2f}"],
       ["pressure drop",f"{TW['dP']:.1f} kPa"]],
      hdr=False,title="CHANNEL PERFORMANCE  (PG25)",rh=5.0)
    sh.text(ex-6,yT+5.5,"Aspect ratio 16:1. Skiving is the only economical way to",FS_S-0.5,DIM,"start")
    sh.text(ex-6,yT+10,"cut 0.15 mm fins this tall in copper.",FS_S-0.5,DIM,"start")

    sh.notes(348,62,60,"NOTES",[
      "MATL: OXYGEN-FREE copper C10200 / JIS C1020.",
      "Fins skived from solid. No brazed or bonded fin.",
      "Braze land (perimeter, 8 wide) flat 0.02, Ra 0.8.",
      "Die-side face flat 0.015, Ra 0.4, no burr.",
      "Deburr channel ends. A raised burr blocks a channel.",
      "Flush and dry before braze. No cutting fluid in the fins.",
      "Handle fin field with a cover plate. Bent fins are scrap.",
    ],fs=FS_S-0.6,lh=2.9)
    sh.table(12,238,216,[("FEATURE",0.34,"l"),("NOMINAL",0.20,"c"),("TOL",0.20,"c"),("CRITICAL TO",0.26,"l")],
      [["Base thickness under die",f"{S['base_t']:.1f}","+0.05 / -0.00","conduction, 3.3 K"],
       ["Fin height",f"{S['fin_h']:.1f}","±0.05","flow area / dP"],
       ["Channel width",f"{S['ch_w']:.2f}","±0.02","dP goes as w^-2"],
       ["Die-side flatness","—","0.015","TIM bond line"],
       ["Braze land flatness","—","0.02","hermetic joint"],
       ["Channel blockage","zero","100 % flow test","one blocked channel = hot spot"]],
      title="CRITICAL CHARACTERISTICS",rh=5.0)
    emit(sh,"CP-101_body.svg")



# ══════════════════════════════════════════ SHEET 3  CP-102
def sheet3():
    sh=Sheet("CP-102","COVER / MANIFOLD","2:1",
             f"Cu C10200 (JIS C1020)  /  {S['L']:.0f} x {S['W']:.0f} x {S['cover_t']:.1f}  /  2 x {S['port']}")
    sh.sheet_of="3 / 6"
    K=2.0; x0,y0=28.0,40.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    Lp,Rp,Tp,Bp=px(0),px(S['L']),py(0),py(S['W'])
    PORTX=[FX0-S['plenum']/2, FX0+S['fin_L']+S['plenum']/2]; PORTY=S['W']/2
    rsq(sh,Lp,Tp,S['L']*K,S['W']*K,1.0)
    # braze land (perimeter) hatched
    for r in [(Lp,Tp,px(PX0)-Lp,S['W']*K),(px(PX0+S['pocket_L']),Tp,Rp-px(PX0+S['pocket_L']),S['W']*K),
              (px(PX0),Tp,S['pocket_L']*K,py(PY0)-Tp),
              (px(PX0),py(PY0+S['pocket_W']),S['pocket_L']*K,Bp-py(PY0+S['pocket_W']))]:
        sh.hatch(*r,45,2.0,"#b6c4d0")
    rsq(sh,px(PX0),py(PY0),S['pocket_L']*K,S['pocket_W']*K,2.0,W_THIN,THIN)
    sh.rect(px(FX0),py(PY0),S['fin_L']*K,S['pocket_W']*K,W_VIS,INK,"#eef3f7")
    for cxm,cym in MNT:
        sh.circ(px(cxm),py(cym),1.7*K/2,W_VIS,INK,"#fff")
        sh.ctr_h(px(cxm)-5,px(cxm)+5,py(cym)); sh.ctr_v(py(cym)-5,py(cym)+5,px(cxm))
    for pxx in PORTX:
        sh.circ(px(pxx),py(PORTY),10*K/2,W_HID,INK,dash="2.5 1.5")
        sh.circ(px(pxx),py(PORTY),11.8*K/2*0.55,W_VIS,INK,"#fff")
        sh.ctr_h(px(pxx)-9,px(pxx)+9,py(PORTY)); sh.ctr_v(py(PORTY)-9,py(PORTY)+9,px(pxx))
    sh.view_label(px(S['L']/2),Tp-22,"PLAN  —  UNDERSIDE (WETTED FACE)","SCALE 2:1")
    sh.dim_h(Lp,Rp,Bp+21,f"{S['L']:.0f}",ext_from=(Bp,Bp))
    sh.dim_h(px(PORTX[0]),px(PORTX[1]),Bp+12,f"{PORTX[1]-PORTX[0]:.0f}  PORT CENTRES",ext_from=(Bp,Bp))
    sh.dim_v(Tp,Bp,Lp-11,f"{S['W']:.0f}",ext_from=(Lp,Lp))
    sh.dim_h(Lp,px(PORTX[0]),Tp-6,f"{PORTX[0]:.1f}",ext_from=(Tp,Tp))
    sh.leader(px(FX0+S['fin_L']-4),py(PY0+6),Rp+5,py(8),
              f"FIN LAND BOSS {S['fin_L']:.0f} x {S['fin_w']:.0f}, 0.5 PROUD")
    sh.leader(px(S['L']-5),py(20),Rp+5,py(24),"BRAZE LAND, 11 WIDE ALL ROUND")
    sh.leader(px(PORTX[1]),py(PORTY)+10,Rp+5,py(52),f"2 x {S['port']} — DETAIL G",dot=True)
    sh.section_mark(Lp-5,py(PORTY),"H","right"); sh.section_mark(Rp+5,py(PORTY),"H","left")

    KS=1.5; sx0=210.0; sy=196.0
    spx=lambda v: sx0+v*KS
    sh.view_label(sx0+S['L']*KS/2,186,"SECTION  H—H   (WETTED FACE UP)","SCALE 1.5:1")
    ct=S['cover_t']*KS
    sh.rect(spx(FX0),sy-0.5*KS,S['fin_L']*KS,0.5*KS,W_VIS,INK,"#fff")
    sh.rect(spx(0),sy,S['L']*KS,ct,W_VIS,INK,"#fff"); sh.hatch(spx(0),sy,S['L']*KS,ct,135,1.4)
    for pxx in PORTX:
        bx=spx(pxx)
        sh.rect(bx-10*KS,sy+ct,20*KS,S['port_boss']*KS,W_VIS,INK,"#fff")
        sh.hatch(bx-10*KS,sy+ct,20*KS,S['port_boss']*KS,135,1.4)
        sh.rect(bx-11.8*KS/2,sy,11.8*KS,S['port_boss']*KS+ct,0,"none","#fff")
        sh.poly([(bx-11.8*KS/2,sy),(bx-11.8*KS/2,sy+ct+S['port_boss']*KS)],W_VIS,INK)
        sh.poly([(bx+11.8*KS/2,sy),(bx+11.8*KS/2,sy+ct+S['port_boss']*KS)],W_VIS,INK)
    sh.dim_v(sy,sy+ct,spx(S['L'])+9,f"{S['cover_t']:.1f}",ext_from=(spx(S['L']),spx(S['L'])))
    sh.dim_v(sy+ct,sy+ct+S['port_boss']*KS,spx(S['L'])+20,f"{S['port_boss']:.1f}",
             ext_from=(spx(S['L']),spx(S['L'])))
    sh.leader(spx(FX0+8),sy-0.5*KS,sx0+4,sy-13,"0.5 BOSS — LANDS ON FIN TIPS",fs=FS_S-0.55)
    sh.text(sx0,sy+ct+S['port_boss']*KS+9,"Ports open straight into the plenums; no internal turn.",FS_S-0.5,DIM,"start")

    KG=5.0; gx=210.0
    sh.view_label(gx+65,62,"DETAIL  G  —  PORT","SCALE 5:1")
    ct3=S['cover_t']*KG; pb=S['port_boss']*KG; bore=11.8*KG; od=20.0*KG
    GY=100.0; mid=gx+65; CW3=130.0
    sh.rect(gx,GY,CW3,ct3,W_VIS,INK,"#fff"); sh.hatch(gx,GY,CW3,ct3,135,1.8)
    sh.rect(mid-od/2,GY+ct3,od,pb,W_VIS,INK,"#fff"); sh.hatch(mid-od/2,GY+ct3,od,pb,135,1.8)
    sh.rect(mid-bore/2,GY,bore,pb+ct3,0,"none","#fff")
    sh.poly([(mid-bore/2,GY),(mid-bore/2,GY+pb+ct3)],W_VIS,INK)
    sh.poly([(mid+bore/2,GY),(mid+bore/2,GY+pb+ct3)],W_VIS,INK)
    for i in range(10):
        yy=GY+ct3+3+i*3.4
        if yy<GY+ct3+pb-2:
            sh.line(mid-bore/2,yy,mid-bore/2-2.5,yy,0.35,INK)
            sh.line(mid+bore/2,yy,mid+bore/2+2.5,yy,0.35,INK)
    sh.dim_h(mid-bore/2,mid+bore/2,GY+ct3+pb+11,"G1/4 BSPP",ext_from=(GY+ct3+pb,GY+ct3+pb))
    sh.dim_h(mid-od/2,mid+od/2,GY-9,"Ø20 BOSS")
    sh.dim_v(GY+ct3,GY+ct3+pb,gx+CW3+9,f"{S['port_boss']:.1f}",ext_from=(gx+CW3,gx+CW3))
    sh.text(gx,GY+pb+ct3+24,"Parallel thread. Seal with a bonded washer or",FS_S-0.5,DIM,"start")
    sh.text(gx,GY+pb+ct3+29,"O-ring face seal — NOT with PTFE tape: shredded",FS_S-0.5,INK,"start","600")
    sh.text(gx,GY+pb+ct3+34,"tape migrates into the 0.25 mm channels.",FS_S-0.5,INK,"start","600")

    sh.notes(348,62,60,"NOTES",[
      "MATL: OXYGEN-FREE copper C10200 / JIS C1020.",
      "Braze land flat 0.02, Ra 0.8, matched to CP-101.",
      "Fin land boss 0.5 proud, flat 0.02 — it seals the fin field against bypass flow.",
      "Deburr port bores fully. Any chip ends up in a channel.",
      "Do not braze the fin land. Mechanical contact only.",
    ],fs=FS_S-0.6,lh=2.9)
    sh.table(12,238,216,[("CHECK",0.40,"l"),("REQUIREMENT",0.32,"c"),("METHOD",0.28,"l")],
      [["Braze land flatness","0.02 max","CMM / optical flat"],
       ["Fin land boss height","0.50 ± 0.02","height gauge"],
       ["Port thread","G1/4 BSPP, gauge to BS 2779","ring gauge"],
       ["Cleanliness","no chips, no cutting fluid","borescope + flush"]],
      title="INSPECTION",rh=5.2)
    emit(sh,"CP-102_cover.svg")

# ══════════════════════════════════════════ SHEET 4  CP-103
def sheet4():
    sh=Sheet("CP-103","THERMAL-HYDRAULIC SPECIFICATION","NONE",
             "H100 SXM5 700 W  /  PG25  /  DESIGN POINT AND SENSITIVITIES")
    sh.sheet_of="4 / 6"
    K=1.4; x0,y0=26.0,48.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    sh.view_label(px(S['L']/2),38,"FLOW PATH","SCALE 1.4:1")
    rsq(sh,px(0),py(0),S['L']*K,S['W']*K,1.0,W_THIN,THIN)
    sh.rect(px(PX0),py(PY0),S['plenum']*K,S['pocket_W']*K,W_VIS,INK,"#e3eef6")
    sh.rect(px(FX0+S['fin_L']),py(PY0),S['plenum']*K,S['pocket_W']*K,W_VIS,INK,"#f6e9e3")
    sh.rect(px(FX0),py(PY0),S['fin_L']*K,S['pocket_W']*K,W_VIS,INK,"#fff")
    for i in range(15):
        yy=py(PY0+2.0+i*3.2)
        if yy<py(PY0+S['pocket_W'])-2:
            sh.line(px(FX0),yy,px(FX0+S['fin_L']),yy,0.25,"#8fa2b3")
            if i%4==1: sh._arrow(px(FX0+S['fin_L']/2),yy,0,"#5b7c96")
    for pxx,lab,c in [(FX0-S['plenum']/2,"IN","#2c4a63"),(FX0+S['fin_L']+S['plenum']/2,"OUT","#8a2f2f")]:
        sh.circ(px(pxx),py(S['W']/2),4,W_VIS,c,"#fff")
        sh.text(px(pxx),py(S['W']/2)+1.3,lab,FS_S-0.6,c,"middle","700")
    sh.text(px(PX0+S['plenum']/2),py(PY0)-3.5,"INLET",FS_S-0.55,"#2c4a63","middle","600")
    sh.text(px(FX0+S['fin_L']+S['plenum']/2),py(PY0)-3.5,"OUTLET",FS_S-0.55,"#8a2f2f","middle","600")
    sh.text(px(S['L']/2),py(S['W'])+9,
            f"{S['n_ch']} PARALLEL CHANNELS  —  {S['ch_w']:.2f} W x {S['fin_h']:.1f} H x {S['fin_L']:.0f} LONG",
            FS_S-0.4,INK,"middle","600")
    sh.text(px(S['L']/2),py(S['W'])+15,"Single pass, straight. No U-turn, no serpentine:",FS_S-0.5,DIM,"middle")
    sh.text(px(S['L']/2),py(S['W'])+20,"at 0.25 mm a turn costs more than the whole fin field.",FS_S-0.5,DIM,"middle")

    X2=216.0; WD=192.0
    sh.notes(X2,44,WD,"READING THESE NUMBERS",[
      "PG25 is the design fluid. Water is shown only to bound the gain from inhibited water where freeze protection is not required — about 5 % on total resistance.",
      "A SINGLE blocked channel is not a thermal event. The 1.5 mm copper base carries its ~10 W sideways 0.4 mm to the neighbours for roughly 0.1 K.",
      "Progressive fouling across many channels is the real risk, and it shows up first as rising pressure drop, not as a rising die temperature.",
      "So instrument the loop for DIFFERENTIAL PRESSURE, not only temperature, and filter to 50 um at the CDU. Service trigger: dP 20 % above the commissioning baseline at the same flow.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    rows=[]
    for lpm in (0.75,1.0,1.5,2.0,3.0):
        t=thermal(PG25,lpm=lpm); _,R=budget(PG25,lpm=lpm)
        m="*" if lpm==1.5 else ""
        rows.append([m+f"{lpm:.2f} L/min",m+f"{R:.4f}",m+f"{45+R*S['Q']:.1f} C",
                     m+f"{t['dTw']:.1f} K",m+f"{t['dP']:.1f} kPa"])
    y2=sh.table(X2,118,WD,[("FLOW",0.22,"c"),("R total",0.20,"c"),("DIE @45 C",0.20,"c"),
                           ("RISE",0.18,"c"),("dP",0.20,"r")],rows,
      title="FLOW SENSITIVITY   —   PG25, 700 W")
    sh.text(X2,y2+5.5,"Below 1.0 L/min the plate loses ground quickly. Above 2.0 L/min it buys",FS_S-0.45,DIM,"start")
    sh.text(X2,y2+10,"almost nothing — spend the pump head elsewhere in the loop.",FS_S-0.45,DIM,"start")

    sh.table(12,168,196,[("PARAMETER",0.46,"l"),("WATER",0.27,"c"),("PG25",0.27,"r")],
      [[l,fw(TWW),"*"+fw(TW)] for l,fw in [
        ("velocity in channel",lambda t:f"{t['v']:.2f} m/s"),
        ("Reynolds number",lambda t:f"{t['Re']:.0f}"),
        ("heat transfer coefficient",lambda t:f"{t['h']:.0f} W/m2K"),
        ("fin efficiency",lambda t:f"{t['eta']:.2f}"),
        ("coolant temperature rise",lambda t:f"{t['dTw']:.1f} K"),
        ("pressure drop, plate only",lambda t:f"{t['dP']:.1f} kPa")]],
      title="DESIGN POINT   —   1.5 L/min, 700 W")
    rows=[]
    for frac,lab in [(1.00,"all clear"),(0.95,"5 % blocked"),(0.90,"10 % blocked"),(0.80,"20 % blocked")]:
        t=thermal(PG25,fin_w=S['fin_w']*frac); _,R=budget(PG25,fin_w=S['fin_w']*frac)
        m="*" if frac==1 else ""
        rows.append([m+lab,m+f"{t['n']}",m+f"{t['v']:.2f} m/s",m+f"{R:.4f}",
                     m+f"{45+R*S['Q']:.1f} C",m+f"{t['dP']:.1f} kPa"])
    sh.table(12,222,216,[("CHANNEL BLOCKAGE",0.24,"l"),("OPEN",0.11,"c"),("VELOCITY",0.17,"c"),
                         ("R total",0.16,"c"),("DIE @45 C",0.16,"c"),("dP",0.16,"r")],rows,
      title="ROBUSTNESS   —   CONSTANT FLOW",rh=5.0)
    emit(sh,"CP-103_thermal-hydraulic.svg")

# ══════════════════════════════════════════ SHEET 5  CP-200
def sheet5():
    sh=Sheet("CP-200","SXM5 MOUNTING INTERFACE","2:1",
             "LOAD FRAME, PRELOAD AND TIM  /  DIMENSIONS ASSUMED — SEE BANNER")
    sh.sheet_of="5 / 6"
    sh.rect(12,30,396,12,0.7,"#8a2f2f","#fbf1f1")
    sh.text(210,38.4,"ASSUMED INTERFACE — CONFIRM EVERY DIMENSION AND THE PRELOAD AGAINST "
            "NVIDIA'S SXM5 MECHANICAL SPECIFICATION BEFORE MANUFACTURE",
            FS_S+0.3,"#8a2f2f","middle","700",0.2)
    K=2.0; cx=112.0; hw=S['L']*K/2; L,R=cx-hw,cx+hw
    sh.view_label(cx,54,"MOUNTING ARRANGEMENT","SCALE 2:1")
    yb=76.0
    sh.rect(L,yb,hw*2,S['cover_t']*K,W_VIS,INK,"#fff"); sh.hatch(L,yb,hw*2,S['cover_t']*K,135,1.5)
    yb2=yb+S['cover_t']*K
    sh.rect(L,yb2,hw*2,S['H_body']*K,W_VIS,INK,"#fff"); sh.hatch(L,yb2,hw*2,S['H_body']*K,45,1.5)
    yt=yb2+S['H_body']*K
    sh.rect(L+16,yt,hw*2-32,1.4,W_HID,INK,"#e6ebf0")
    sh.balloon(R+14,yt+0.7,"4",R-16,yt+0.7)
    yp=yt+1.4
    sh.rect(L+8,yp,hw*2-16,7,W_VIS,"#5b4632","#f3ede5")
    sh.rect(cx-S['die']*K/2,yp,S['die']*K,3,W_VIS,"#8a2f2f","#fbf1f1")
    sh.text(cx,yp+5.4,"H100 SXM5 MODULE  (NOT SUPPLIED)",FS_S-0.5,"#5b4632","middle","600")
    yf=yp+7
    sh.rect(L-6,yf,hw*2+12,5,W_VIS,INK,"#eef2f6")
    sh.text(cx,yf+3.4,"SXM5 SOCKET / BOARD  +  BACKPLATE",FS_S-0.5,INK,"middle","600")
    for sx_ in (L+S['mnt_edge']*K, R-S['mnt_edge']*K):
        sh.rect(sx_-1.6,yb-16,3.2,16,W_VIS,INK,"#dde8f0")
        sh.rect(sx_-4.5,yb-22,9,6,W_VIS,INK,"#fff")
        sh.line(sx_,yb+S['cover_t']*K,sx_,yf+5,W_HID,INK,"2 1.5")
        for i in range(4):
            yy=yb-15+i*2.6
            sh.poly([(sx_-4.6,yy),(sx_-1.8,yy+1.8),(sx_+1.8,yy),(sx_+4.6,yy+1.8)],0.5,"#2c4a63")
    sh.leader(L+S['mnt_edge']*K+4.6,yb-11,L-10,yb-26,
              f"{S['mnt_n']} x {S['mnt_screw']} SPRING SCREW\\n+ BELLEVILLE STACK",anchor="end",fs=FS_S-0.5)
    sh.leader(R-S['mnt_edge']*K,yf+5,R+14,yf+11,"BACKPLATE TAKES THE LOAD",fs=FS_S-0.5)
    sh.dim_v(yb,yf+5,L-13,"STACK",ext_from=(L-6,L-6),fs=FS_S-0.6)

    KD=8.0; dx=250.0; dy=76.0
    sh.view_label(dx+60,64,"DETAIL  J  —  SPRING SCREW STACK","SCALE 8:1")
    sh.rect(dx+52,dy,16,26,W_VIS,INK,"#dde8f0")
    sh.rect(dx+44,dy-10,32,10,W_VIS,INK,"#fff")
    yy=dy+26
    for i in range(4):
        sh.poly([(dx+40,yy),(dx+56,yy+5),(dx+64,yy+5),(dx+80,yy)],0.7,"#2c4a63")
        yy+=6
    sh.rect(dx+30,yy,60,7,W_VIS,INK,"#f4f7f9")
    sh.text(dx+60,yy+4.8,"CP-102 COVER",FS_S-0.6,INK,"middle")
    sh.leader(dx+80,dy+30,dx+96,dy+18,f"{S['belleville']}",fs=FS_S-0.55)
    sh.leader(dx+44,dy-5,dx+26,dy-12,"SHOULDER SETS\\nTHE STOP",anchor="end",fs=FS_S-0.55)
    sh.text(dx+10,yy+22,"The shoulder, not the torque wrench, sets the preload.",FS_S-0.45,INK,"start","600")
    sh.text(dx+10,yy+27,"Torque-only assembly on a bare die cracks silicon.",FS_S-0.45,"#8a2f2f","start","700")

    y=sh.table(12,152,196,[("PARAMETER",0.44,"l"),("VALUE",0.30,"c"),("SOURCE",0.26,"r")],
      [["*Total preload on the package","*TO BE TAKEN FROM NVIDIA SPEC","*NOT SET HERE"],
       ["Screws",f"{S['mnt_n']} x {S['mnt_screw']}, shouldered","this drawing"],
       ["Spring element",S['belleville'],"this drawing"],
       ["Tightening","cross pattern, 3 passes to shoulder","this drawing"],
       ["Cold plate flatness, die face","0.015 max","CP-101"],
       ["Parallelism, plate to package","0.05 max","this drawing"],
       ["TIM","PTM, k >= 13 W/mK, 60 um BLT","CP-104"]],
      title="MOUNTING PARAMETERS")
    sh.notes(216,150,192,"WHY THIS SHEET IS NOT FINISHED",[
      "An SXM5 module is a bare die on a socketed carrier. The socket, the load frame and the allowable preload are defined by NVIDIA, not by the cold plate designer.",
      "Too much preload cracks the die or the substrate. Too little starves the TIM bond line and the 4.0 K TIM budget on sheet 1 becomes 15 K or worse.",
      "Obtain the SXM5 mechanical and thermal design guide, then set the preload, the screw shoulder height and the Belleville stack to match it. Everything else on these six sheets is independent of that number.",
      "Do not substitute a torque specification for a shoulder stop. Torque on an M3 screw scatters by +/- 30 % with friction alone.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    sh.table(12,238,216,[("RISK",0.28,"l"),("MECHANISM",0.42,"l"),("CONTROL",0.30,"r")],
      [["*Die crack","*preload above the package rating, or uneven load","*shoulder stop + cross tightening"],
       ["High TIM resistance","insufficient preload, or air in the bond line","preload to spec, controlled dispense"],
       ["TIM pump-out","thermal cycling with a soft grease","use a phase-change material"],
       ["Plate rocking","flatness or parallelism out of tolerance","0.015 / 0.05 per this sheet"]],
      title="MOUNTING RISK REGISTER",rh=5.2)
    emit(sh,"CP-200_mounting.svg")

# ══════════════════════════════════════════ SHEET 6  CP-300
def sheet6():
    sh=Sheet("CP-300","PROCESS, TEST & COOLANT SPECIFICATION","NONE",
             "CP-100 COLD PLATE  /  MANDATORY SEQUENCE AND LOOP CHEMISTRY")
    sh.sheet_of="6 / 6"
    steps=[("1","MACHINE","CP-101 body and CP-102 cover. Pocket, plenums, ports, mount holes.",""),
      ("2","SKIVE FINS",f"{S['n_ch']} fins, {S['fin_t']:.2f} thk x {S['fin_h']:.1f} tall @ {S['ch_p']:.2f} pitch.","one pass per fin"),
      ("3","DEBURR + CLEAN","Ultrasonic in alkaline, DI rinse, dry. Borescope every channel.","no cutting fluid"),
      ("4","BRAZE","Vacuum or dry N2/H2. BCuP-5 preform on the perimeter land ONLY.","fin tips NOT brazed"),
      ("5","PROOF PRESSURE","Hydrostatic 3 x working, 5 min, no permanent set.","typically 15 bar"),
      ("6","LEAK TEST","Helium mass spectrometer under vacuum.","< 1e-8 Pa.m3/s"),
      ("7","FLOW TEST","Measure dP at 1.5 L/min. Record as the commissioning baseline.",f"{TW['dP']:.1f} kPa nom"),
      ("8","THERMAL TEST","Die simulator at 700 W. Verify R <= 0.032 K/W.","first article + AQL"),
      ("9","FLUSH + DRY","DI flush, N2 purge, cap both ports.","ship dry, capped"),
      ("10","INSTALL","Mount per CP-200. Fill, vent, run 30 min, re-vent.","air blankets fins")]
    X=16.0; y=44.0; BW=192.0; RH=13.0
    sh.view_label(X+BW/2,36,"MANUFACTURE AND TEST SEQUENCE","IN ORDER")
    for i,(n,ttl,body,tag) in enumerate(steps):
        crit=n in ("4","6","7","10")
        rsq(sh,X,y,BW,RH-2.2,1.2,W_VIS,INK,"#f2f6f9" if crit else "#fff")
        sh.rect(X,y,5.5,RH-2.2,0,"none","#2c4a63" if crit else "#8fa2b3")
        sh.text(X+2.75,y+7.0,n,FS_S-0.5,"#ffffff","middle","700")
        sh.text(X+8.5,y+4.6,ttl,FS_S,INK,"start","700",0.3)
        sh.text(X+8.5,y+9.2,body,FS_S-0.65,DIM,"start")
        if tag: sh.text(X+BW-2.5,y+4.6,tag,FS_S-0.7,"#2c4a63","end","600")
        if i<len(steps)-1:
            sh.line(X+BW/2,y+RH-2.2,X+BW/2,y+RH,W_DIM,DIM); sh._arrow(X+BW/2,y+RH+0.4,90,DIM)
        y+=RH
    X2=218.0; WD=190.0
    y2=sh.table(X2,44,WD,[("PROPERTY",0.44,"l"),("SPECIFICATION",0.32,"c"),("WHY",0.24,"r")],
      [["*Fluid","*PG25, 25 % propylene glycol","*freeze + biocide"],
       ["Inhibitor package","phosphate/azole, Cu-rated","protects copper"],
       ["pH","8.0 - 9.5","copper passivity"],
       ["Conductivity","< 50 uS/cm","galvanic / leak sensing"],
       ["Particulate","filtered 50 um at the CDU","0.25 mm channels"],
       ["Supply temperature","45 C nominal, 50 C max","warm-water loop"],
       ["Flow per plate",f"{S['flow_lpm']:.1f} L/min","design point"],
       ["Change interval","per fluid supplier, test annually","inhibitor depletes"]],
      title="COOLANT SPECIFICATION")
    y2=sh.table(X2,y2+8,WD,[("MATERIAL",0.42,"l"),("USE",0.34,"c"),("VERDICT",0.24,"r")],
      [["Copper C10200, brass, bronze","plate, fittings","*ALLOWED"],
       ["Stainless 304 / 316","tubing, QD bodies","*ALLOWED"],
       ["EPDM","hose, external seals","*ALLOWED"],
       ["*ALUMINIUM, any alloy","*anywhere wetted","*PROHIBITED"],
       ["Zinc, galvanised steel","anywhere wetted","*PROHIBITED"],
       ["Nitrile, PTFE tape","seals","not recommended"]],
      title="WETTED MATERIALS   —   GALVANIC COMPATIBILITY")
    sh.text(X2,y2+6,"Copper is strongly cathodic. One aluminium fitting in a copper loop corrodes",FS_S-0.45,INK,"start","600")
    sh.text(X2,y2+10.6,"through in months and the debris then blocks the 0.25 mm channels.",FS_S-0.45,DIM,"start")
    y3=sh.notes(X2,y2+18,WD,"COMMISSIONING",[
      "Fill slowly from the lowest point. Vent at the highest point until clear.",
      "Run 30 minutes, re-vent, then record dP at 1.5 L/min as the baseline for this plate.",
      "Trend dP, not only temperature. Fouling shows in dP long before the die gets hot.",
      "Service trigger: dP 20 % above the commissioning baseline at the same flow.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    sh.table(16,238,196,[("TEST",0.40,"l"),("LIMIT",0.34,"c"),("APPLIED TO",0.26,"r")],
      [["*Helium leak","*< 1e-8 Pa.m3/s","*100 %"],
       ["Proof pressure","3 x working, no set","100 %"],
       ["dP at 1.5 L/min",f"{TW['dP']:.1f} kPa +20 % / -30 %","100 %"],
       ["Thermal R, die simulator","<= 0.032 K/W at 700 W","first article + AQL"]],
      title="ACCEPTANCE",rh=5.2)
    emit(sh,"CP-300_process-coolant.svg")

if __name__=="__main__":
    print("generating ->",OUT)
    sheet1(); sheet2(); sheet3(); sheet4(); sheet5(); sheet6()
