#!/usr/bin/env python3
import sys, os, math
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path[:0]=[HERE, os.path.join(HERE,"..","sim")]
from draft import *
from design_spec import SPEC as S, WATER, METH, charge_volume, R_vc_calc

OUT=os.path.join(HERE,"out"); os.makedirs(OUT,exist_ok=True)
CH=charge_volume(); RD,R_VC=R_vc_calc()
TB=[("DRAWN","AI-ASSISTED DRAFT"),("CHECKED","— PENDING —"),
    ("MATERIAL","SEE BOM"),("FINISH","SEE NOTES"),("DATE","2026-09-09")]
def emit(sh,name):
    sh.frame(); sh.title_block(TB); sh.save(os.path.join(OUT,name)); print("  ",name)
def rsq(sh,x,y,w,h,r,sw=W_VIS,c=INK,fill="none"):
    sh.raw(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" rx="{r:.3f}" '
           f'fill="{fill}" stroke="{c}" stroke-width="{sw}"/>')

# ══════════════════════════════════════════════════════ SHEET 1
def sheet1():
    sh=Sheet("VC-100","GENERAL ASSEMBLY","2:1","VAPOUR CHAMBER + FIN STACK  /  Cu-H2O  /  68 x 68 x 27")
    sh.sheet_of="1 / 7"
    K=2.0; cx=104.0; hw=S['L']*K/2; L,R=cx-hw,cx+hw
    sh.view_label(cx,20,"EXPLODED ASSEMBLY","SCALE 2:1")

    # 4 fin stack
    yf=28.0; fh=S['finA_h']*K; fb=S['fin_base']*K
    for i in range(22): sh.line(L+(i+0.5)*hw*2/22,yf,L+(i+0.5)*hw*2/22,yf+fh,0.32,INK)
    sh.rect(L,yf,hw*2,fh,W_VIS,INK)
    sh.rect(L,yf+fh,hw*2,fb,W_VIS,INK,"#fff"); sh.hatch(L,yf+fh,hw*2,fb,45,1.6)
    sh.circ(cx+30,yf+fh+fb/2,S['fin_relief_d']*K/2,W_HID,INK,dash="2 1.5")
    sh.balloon(R+13,yf+fh*0.45,"4",R-2,yf+fh*0.45)
    sh.text(cx,yf-2.6,f"{S['finA_n']} FINS  x  {S['finA_t']} THK  @ {S['finA_p']} PITCH  x  {S['finA_h']:.0f} TALL",FS_S,DIM,"middle")
    sh.leader(cx+30,yf+fh+fb,cx+46,yf+fh+fb+8,f"Ø{S['fin_relief_d']:.0f} RELIEF FOR PINCH-OFF")

    # 5 TIM
    yt=84.0; sh.rect(L+5,yt,hw*2-10,1.8,W_HID,INK,"#e6ebf0")
    sh.balloon(R+13,yt+0.9,"5",R-6,yt+0.9)

    # 6 tube + 2 lid
    yl=100.0; lt=S['lid_t']*K
    sh.rect(L,yl,hw*2,lt,W_VIS,INK,"#fff"); sh.hatch(L,yl,hw*2,lt,45,1.4)
    tx=L+S['fill_x']*K
    sh.rect(tx-S['tube_od']*K/2,yl-14,S['tube_od']*K,14,W_VIS,INK,"#dde8f0")
    sh.balloon(tx,yl-20,"6",tx,yl-14)
    lw=S['wick_lid']*K*3
    sh.rect(L+8,yl+lt,hw*2-16,lw,W_THIN,INK,"#f0f3f6"); sh.hatch(L+8,yl+lt,hw*2-16,lw,0,0.8,"#9fb4c6")
    sh.balloon(R+13,yl+lt*0.5,"2",R-2,yl+lt*0.5)
    sh.leader(L+26,yl+lt+lw,L-14,yl+lt+lw+7,f"WICK {S['wick_lid']:.2f}",anchor="end")

    # 1 base
    yb=126.0; bt=S['base_t']*K; pd=S['pocket_d']*K; rim=S['rim']*K
    op=[(L,yb),(L+rim,yb),(L+rim,yb+pd),(R-rim,yb+pd),(R-rim,yb),(R,yb),(R,yb+bt),(L,yb+bt)]
    sh.hatch_poly(op,45,1.6); sh.poly(op,W_VIS,INK,close=True)
    for i in range(10):
        pxx=L+rim+(S['post_edge']+i*S['post_pitch'])*K
        sh.rect(pxx-S['post_d']*K/2,yb,S['post_d']*K,pd,W_THIN,INK,"#fff")
        sh.hatch(pxx-S['post_d']*K/2,yb,S['post_d']*K,pd,45,1.0)
    fw=S['wick_floor']*K*3
    sh.rect(L+rim,yb+pd-fw,hw*2-2*rim,fw,W_THIN,INK,"#f0f3f6")
    sh.hatch(L+rim,yb+pd-fw,hw*2-2*rim,fw,0,0.8,"#9fb4c6")
    sh.balloon(R+13,yb+bt*0.72,"1",R-2,yb+bt*0.72)
    sh.balloon(L-14,yb+pd*0.35,"3",L+rim+16,yb+pd*0.35)
    sh.leader(cx+20,yb+pd-fw,cx+44,yb+pd+13,f"WICK {S['wick_floor']:.2f} + {S['groove_n']} GROOVES")
    sh.ctr_v(22,yb+bt+6,cx)
    sh.dim_h(L,R,yb+bt+16,f"{S['L']:.0f}",ext_from=(yb+bt,yb+bt))
    sh.text(cx,yb+bt+24,"WICK THICKNESS SHOWN x3 FOR CLARITY   /   ASSEMBLED HEIGHT 27.0",FS_S-0.4,THIN,"middle")

    # ---- thermal network
    ny=178.0
    sh.view_label(104,ny,"THERMAL RESISTANCE NETWORK","JUNCTION TO AIR, 20 x 20 DIE")
    chain=[("DIE","—"),("TIM",f"{RD['TIM_die']:.3f}"),("Cu FLOOR",f"{RD['floor']:.3f}"),
           ("EVAP",f"{RD['evap']:.3f}"),("VAPOUR",f"{RD['vapor']:.3f}"),("COND",f"{RD['cond']:.3f}"),
           ("LID+SPRD",f"{RD['lid']+RD['spread']:.3f}"),("TIM",f"{RD['TIM_fin']:.3f}"),
           ("FIN→AIR","0.470"),("AIR","25 C")]
    bx=22.0; bw=16.0; gap=2.6; by=ny+12
    for i,(nm,v) in enumerate(chain):
        x=bx+i*(bw+gap)
        term = i in (0,len(chain)-1)
        rsq(sh,x,by,bw,11,1.4,W_VIS,INK,"#eef2f6" if term else "#fff")
        sh.text(x+bw/2,by+4.6,nm,FS_S-0.65,INK,"middle","700")
        sh.text(x+bw/2,by+8.6,v,FS_S-0.65,DIM,"middle")
        if i: sh.line(x-gap,by+5.5,x,by+5.5,W_VIS,INK)
    sh.text(22,by+19,f"SERIES TOTAL  R th(j-a) = 0.67 K/W  @ 2 m/s     →     Q = 113 W at Tj 100 C / air 25 C",FS_S,INK,"start","600")
    sh.text(22,by+24.5,f"Vapour chamber contributes {R_VC:.3f} K/W (29%); the fin stack dominates. Evaporator wick is the",FS_S-0.4,DIM,"start")
    sh.text(22,by+29,"largest single internal term — do not thin the floor wick below 0.40.",FS_S-0.4,DIM,"start")

    # ---- right column
    X=198.0; WD=210.0
    y=sh.table(X,18,WD,[("ITEM",0.07,"c"),("QTY",0.09,"c"),("PART No.",0.14,"l"),
        ("DESCRIPTION",0.34,"l"),("MATERIAL",0.20,"l"),("MASS",0.16,"r")],
      [["1","1","VC-101","CHAMBER BASE, POCKETED, 100 POSTS","Cu C1100 OFHC","77.4 g"],
       ["2","1","VC-102","CHAMBER LID, 1.0 THK, FILL PORT","Cu C1100 OFHC","41.4 g"],
       ["3","1","VC-103","SINTERED WICK — IN-SITU PROCESS","Cu POWDER 45-75um","9.6 g"],
       ["4","1","VC-201","FIN STACK, 43 FIN — FORCED AIR","Al 1100-H14","88.1 g"],
       ["4A","1","VC-202","FIN STACK, 11 FIN — NAT. CONVECTION","Al 1100-H14","65.4 g"],
       ["5","1","VC-204","THERMAL INTERFACE PAD 0.2 THK","PCM / SIL-PAD","0.4 g"],
       ["6","1","VC-205",f"PINCH-OFF TUBE OD{S['tube_od']:.1f} x ID{S['tube_id']:.1f} x {S['tube_len']:.0f}","Cu C1100","1.2 g"],
       ["7",f"{CH['charge']:.2f} mL","VC-206","WORKING FLUID — DEAERATED","DI H2O 18 MOhm.cm","1.87 g"]],
      title="BILL OF MATERIALS   —   ASSEMBLY VC-100")
    sh.text(X+WD,y+4.4,"TOTAL MASS, CHARGED:   218 g (CONFIG A)   /   196 g (CONFIG B)",FS_S,INK,"end","700")
    y=sh.table(X,y+8,WD,[("CONFIGURATION",0.40,"l"),("AIR",0.16,"c"),("R th (j-a)",0.20,"c"),("Q @ dT 75 K",0.24,"r")],
      [["*CONFIG A — 43 fin @ 1.5 pitch","1 m/s","1.12 K/W","*67 W"],
       ["*CONFIG A — 43 fin @ 1.5 pitch","2 m/s","0.67 K/W","*113 W"],
       ["*CONFIG A — 43 fin @ 1.5 pitch","4 m/s","0.46 K/W","*163 W"],
       ["CONFIG B — 11 fin @ 6.0 pitch","natural","3.87 K/W","19 W"],
       ["capillary limit — water, vertical","—","—","804 W"],
       ["capillary limit — water, horizontal","—","—","858 W"]],
      title="PERFORMANCE   —   20 x 20 DIE, Tj 100 C, AIR IN 25 C")

    # ---- assembled partial section
    K3=3.0; sx=228.0; sw_=34*K3
    sh.view_label(X+WD/2,y+11,"SECTION  X—X   (HALF, FROM CENTRELINE)","SCALE 3:1")
    sy=y+18
    seq=[("FIN STACK",S['finA_h'],"#fff",45),("FIN BASE",S['fin_base'],"#fff",45),
         ("TIM 0.2",0.2,"#e6ebf0",None),("LID 1.0",S['lid_t'],"#fff",45),
         ("LID WICK 0.20",S['wick_lid'],"#eef3f7",0),("VAPOUR CORE 2.40",2.4,"#f7fafc",None),
         ("FLOOR WICK 0.40",S['wick_floor'],"#eef3f7",0),("FLOOR 1.0",S['floor_t'],"#fff",45)]
    yy=sy; thin_i=0
    for nm,t,fill,ha in seq:
        h=t*K3
        sh.rect(sx,yy,sw_,h,W_THIN if h<4 else W_VIS,INK,fill)
        if nm=="FIN STACK":
            for i in range(14): sh.line(sx+(i+0.5)*sw_/14,yy,sx+(i+0.5)*sw_/14,yy+h,0.28,INK)
        elif ha is not None and h>1.2:
            sh.hatch(sx,yy,sw_,h,ha,1.5 if ha==45 else 1.0,HATCH if ha==45 else "#9fb4c6")
        if h>=4: sh.leader(sx+sw_,yy+h/2,sx+sw_+14,yy+h/2+0.6,nm,fs=FS_S-0.5)
        else:
            sh.leader(sx+sw_,yy+h/2,sx+sw_+14+ (0 if thin_i%2 else 26), yy+h/2-3.2+thin_i*4.4,nm,fs=FS_S-0.6)
            thin_i+=1
        yy+=h
    for i in range(9):
        pxp=sx+6+i*S['post_pitch']*K3
        if pxp<sx+sw_-4:
            sh.rect(pxp,sy+(S['finA_h']+S['fin_base']+0.2+S['lid_t'])*K3,S['post_d']*K3,
                    (S['wick_lid']+2.4+S['wick_floor'])*K3,W_THIN,INK,"#fff")
    sh.ctr_v(sy-4,yy+4,sx)
    sh.text(sx-3,sy-6,"CL",FS_S-0.4,CTR,"middle")
    sh.dim_v(sy,yy,sx-9,f"{S['overallA']:.0f}",ext_from=(sx,sx))
    sh.text(sx,yy+7,"Posts shown at 6.0 pitch, bonded lid-to-floor. Vapour core 2.40 clear.",FS_S-0.5,DIM,"start")

    sh.notes(12,244,214,"GENERAL NOTES",
      ["Interpret per ISO 128. Tolerances ISO 2768-mK unless stated. Dimensions in mm.",
       "Charging, evacuation and sealing per VC-300. NEVER charge before diffusion bonding — bond temperature exceeds the fluid critical pressure envelope.",
       "CONFIG A requires forced air >= 1 m/s. For still air use CONFIG B (VC-202); a 1.5 mm fin pitch chokes natural convection to h = 0.25 W/m2K.",
       "Orientation-independent: 10.5 kPa capillary head vs 0.66 kPa gravity head over 68 mm."],lh=3.5,fs=FS_S-0.35)
    emit(sh,"VC-100_general-assembly.svg")

# ══════════════════════════════════════════════════════ SHEET 2
def sheet2():
    sh=Sheet("VC-101","CHAMBER BASE","2:1","Cu C1100 (OFHC)  /  68 x 68 x 4.0  /  100 INTEGRAL POSTS")
    sh.sheet_of="2 / 7"
    K=2.0; x0,y0=30.0,36.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    Lp,Rp,Tp,Bp=px(0),px(S['L']),py(0),py(S['W'])
    pk=S['rim']; pw=S['L']-2*S['rim']
    rsq(sh,Lp,Tp,S['L']*K,S['W']*K,1.0)
    rsq(sh,px(pk),py(pk),pw*K,pw*K,S['pocket_r']*K)
    for i in range(S['post_n']):
        for j in range(S['post_n']):
            sh.circ(px(pk+S['post_edge']+i*S['post_pitch']),py(pk+S['post_edge']+j*S['post_pitch']),
                    S['post_d']*K/2,0.28,INK,"#eef2f6")
    gx0,gx1,gy0=px(41),px(58),py(9)
    for i in range(13): sh.line(gx0,gy0+i*S['groove_p']*K,gx1,gy0+i*S['groove_p']*K,0.20,"#8fa2b3")
    sh.poly([(gx0,gy0-1.5),(gx0-2.5,gy0+5),(gx0+2.5,gy0+12),(gx0-1.5,gy0+12*S['groove_p']*K+1.5)],0.3,THIN)
    sh.ctr_h(Lp-7,Rp+7,py(S['W']/2)); sh.ctr_v(Tp-7,Bp+7,px(S['L']/2))
    sh.view_label(px(S['L']/2),Tp-16,"PLAN  —  POCKET SIDE UP","SCALE 2:1")
    sh.dim_h(Lp,Rp,Bp+19,f"{S['L']:.0f}",ext_from=(Bp,Bp))
    sh.dim_h(px(pk),px(S['L']-pk),Bp+10,f"{S['pocket']:.0f}",ext_from=(Bp,Bp))
    sh.dim_v(Tp,Bp,Lp-12,f"{S['W']:.0f}",ext_from=(Lp,Lp))
    pa,pb=px(pk+S['post_edge']),px(pk+S['post_edge']+S['post_pitch'])
    sh.dim_h(pa,pb,Tp-6,f"{S['post_pitch']:.0f}",ext_from=(Tp,Tp))
    sh.text(pa-2,Tp-9.5,f"{S['post_n']} x {S['post_pitch']:.0f} = {(S['post_n']-1)*S['post_pitch']:.0f}",FS_S-0.35,DIM,"end","600")
    sh.leader(px(61),py(46),Rp+5,py(46),f"{S['post_total']} x Ø{S['post_d']:.1f} POST",dot=True)
    sh.leader(gx1,gy0+6,Rp+5,py(14),f"{S['groove_n']} GROOVES {S['groove_w']:.2f}x{S['groove_d']:.2f} @ {S['groove_p']:.2f}")
    sh.leader(px(pk)+2.5,py(pk)+2.5,Lp+1,Tp-4,f"R{S['pocket_r']:.0f}",anchor="end")
    sh.section_mark(Lp-5,py(S['W']/2),"A","right"); sh.section_mark(Rp+5,py(S['W']/2),"A","left")

    sy=212.0; bt=S['base_t']*K; pd=S['pocket_d']*K; rim=S['rim']*K
    sh.view_label(px(S['L']/2),Bp+30,"SECTION  A—A","SCALE 2:1")
    op=[(Lp,sy),(Lp+rim,sy),(Lp+rim,sy+pd),(Rp-rim,sy+pd),(Rp-rim,sy),(Rp,sy),(Rp,sy+bt),(Lp,sy+bt)]
    sh.hatch_poly(op,45,1.5); sh.poly(op,W_VIS,INK,close=True)
    for i in range(S['post_n']):
        cp=px(pk+S['post_edge']+i*S['post_pitch'])
        sh.rect(cp-S['post_d']*K/2,sy,S['post_d']*K,pd,W_THIN,INK,"#fff")
        sh.hatch(cp-S['post_d']*K/2,sy,S['post_d']*K,pd,45,1.0)
    sh.dim_v(sy,sy+bt,Rp+10,f"{S['base_t']:.1f}",ext_from=(Rp,Rp))
    sh.dim_v(sy+pd,sy+bt,Rp+21,f"{S['floor_t']:.1f}",ext_from=(Rp,Rp))
    sh.dim_v(sy,sy+pd,Lp-10,f"{S['pocket_d']:.1f}",ext_from=(Lp,Lp))
    sh.detail_circle(px(pk+S['post_edge']+S['post_pitch']),sy+pd*0.5,8.5,"B",lx=px(16),ly=sy-2)

    # ---- DETAIL B  15:1
    KB=15.0; bx=214.0; FY=120.0; BW=110.0
    sh.view_label(bx+BW/2,58,"DETAIL  B","SCALE 15:1")
    ft=S['floor_t']*KB; wk=S['wick_floor']*KB; gw=S['groove_w']*KB; gd=S['groove_d']*KB
    pwid=S['post_d']*KB; ppx=bx+45
    sh.rect(bx,FY,BW,ft,W_VIS,INK,"#fff"); sh.hatch(bx,FY,BW,ft,45,1.8)
    for gxx in [bx+8,bx+18.5,bx+29,bx+80,bx+90.5,bx+101]:
        sh.rect(gxx,FY,gw,gd,0,"none","#fff")
        sh.poly([(gxx,FY),(gxx,FY+gd),(gxx+gw,FY+gd),(gxx+gw,FY)],W_VIS,INK)
    for seg in [(bx,ppx-bx),(ppx+pwid,bx+BW-ppx-pwid)]:
        sh.rect(seg[0],FY-wk,seg[1],wk,W_THIN,INK,"#eef3f7")
        sh.hatch(seg[0],FY-wk,seg[1],wk,0,1.1,"#9fb4c6")
    sh.rect(ppx,FY-40,pwid,40,W_VIS,INK,"#fff"); sh.hatch(ppx,FY-40,pwid,40,45,1.8)
    sh.poly([(ppx-4,FY-36),(ppx+4,FY-40),(ppx+pwid-4,FY-34),(ppx+pwid+4,FY-38)],0.35,INK)
    sh.dim_v(FY-wk,FY,bx-8,f"{S['wick_floor']:.2f}",ext_from=(bx,bx))
    sh.dim_v(FY,FY+ft,bx-8,f"{S['floor_t']:.1f}",ext_from=(bx,bx))
    sh.dim_h(bx+8,bx+18.5,FY+ft+10,f"{S['groove_p']:.2f}",ext_from=(FY+ft,FY+ft))
    sh.dim_h(ppx,ppx+pwid,FY-46,f"Ø{S['post_d']:.1f}")
    sh.leader(bx+90.5+gw/2,FY+gd,bx+BW+6,FY+ft+8,f"{S['groove_w']:.2f} W x {S['groove_d']:.2f} D",fs=FS_S-0.55)
    sh.leader(bx+96,FY-wk/2,bx+BW+6,FY-14,"SINTERED Cu WICK",fs=FS_S-0.55)
    sh.leader(ppx+pwid,FY-30,bx+BW+6,FY-30,"POST, INTEGRAL",fs=FS_S-0.55)

    # ---- DETAIL C  10:1
    KC=10.0; ox,oy=228.0,182.0
    sh.view_label(ox+50,170,"DETAIL  C  —  RIM BOND LAND","SCALE 10:1")
    rw=S['rim']*KC; bh=S['base_t']*KC; pdd=S['pocket_d']*KC; lh=S['lid_t']*KC; INB=64.0
    sh.rect(ox,oy,rw+INB,lh,W_VIS,INK,"#fff"); sh.hatch(ox,oy,rw+INB,lh,135,1.8)
    sh.rect(ox,oy+lh,rw,bh,W_VIS,INK,"#fff"); sh.hatch(ox,oy+lh,rw,bh,45,1.8)
    sh.rect(ox+rw,oy+lh+pdd,INB,bh-pdd,W_VIS,INK,"#fff"); sh.hatch(ox+rw,oy+lh+pdd,INB,bh-pdd,45,1.8)
    sh.line(ox,oy+lh,ox+rw,oy+lh,1.1,"#1f6f43")
    sh.rect(ox+rw,oy+lh,INB,S['wick_lid']*KC,W_THIN,INK,"#eef3f7")
    sh.rect(ox+rw,oy+lh+pdd-S['wick_floor']*KC,INB,S['wick_floor']*KC,W_THIN,INK,"#eef3f7")
    sh.dim_h(ox,ox+rw,oy+lh+bh+9,f"{S['rim']:.0f}",ext_from=(oy+lh+bh,oy+lh+bh))
    sh.dim_v(oy,oy+lh,ox-8,f"{S['lid_t']:.1f}",ext_from=(ox,ox))
    sh.leader(ox+rw*0.5,oy+lh,ox+rw+INB+6,oy-3,"DIFFUSION BOND ZONE",fs=FS_S-0.55)
    sh.leader(ox+rw+22,oy+lh+S['wick_lid']*KC,ox+rw+INB+6,oy+14,"LID WICK 0.20",fs=FS_S-0.55)
    sh.leader(ox+rw+22,oy+lh+pdd-S['wick_floor']*KC,ox+rw+INB+6,oy+30,"FLOOR WICK 0.40",fs=FS_S-0.55)
    sh.text(ox+50,176,"Bond area 4.0 x 4 sides = 1024 mm2.   Burst margin > 16 at 150 C.",FS_S-0.5,DIM,"middle")

    sh.notes(344,58,64,"NOTES",[
      "MATL: Cu C1100 / C10100 OFHC, annealed.",
      "Posts integral with base — machine from solid or coin.",
      "Bond faces (rim + post tops): flatness 0.02, Ra 0.4 max.",
      "Grooves run ONE direction only, interrupted at posts.",
      "Post top faces coplanar with rim within 0.015.",
      "Deburr 0.1 max. No burrs into cavity.",
      "Vacuum degrease + acid pickle before sintering.",
    ],fs=FS_S-0.6,lh=2.9)
    sh.table(12,240,216,[("FEATURE",0.36,"l"),("NOMINAL",0.18,"c"),("TOL",0.20,"c"),("CRITICAL TO",0.26,"l")],
      [["Floor thickness",f"{S['floor_t']:.1f}","+0.05 / -0.00","evaporator R th"],
       ["Post height = pocket depth",f"{S['pocket_d']:.1f}","±0.015","lid bond / burst"],
       ["Rim + post-top flatness","—","0.02","hermeticity"],
       ["Groove depth",f"{S['groove_d']:.2f}","±0.03","capillary return"],
       ["Bond face roughness","Ra 0.4","max","diffusion bond"],
       ["Post position","true position","Ø0.10 MMC","lid land alignment"]],
      title="CRITICAL CHARACTERISTICS",rh=5.0)
    emit(sh,"VC-101_chamber-base.svg")

# ══════════════════════════════════════════════════════ SHEET 3
def sheet3():
    sh=Sheet("VC-102","CHAMBER LID","2:1","Cu C1100 (OFHC)  /  68 x 68 x 1.0  /  WICK-LINED, FILL PORT")
    sh.sheet_of="3 / 7"
    K=2.0; x0,y0=30.0,36.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    Lp,Rp,Tp,Bp=px(0),px(S['L']),py(0),py(S['W']); pk=S['rim']; pw=S['L']-2*pk
    rsq(sh,Lp,Tp,S['L']*K,S['W']*K,1.0)
    rsq(sh,px(pk),py(pk),pw*K,pw*K,S['pocket_r']*K,W_THIN,THIN)
    sh.hatch(px(pk),py(pk),pw*K,pw*K,0,1.5,"#c3d0da")
    for i in range(S['post_n']):
        for j in range(S['post_n']):
            sh.circ(px(pk+S['post_edge']+i*S['post_pitch']),py(pk+S['post_edge']+j*S['post_pitch']),
                    S['lid_post_clr']*K/2,0.28,INK,"#fff")
    fx,fy=px(S['fill_x']),py(S['fill_y'])
    sh.circ(fx,fy,S['fill_cbore']*K/2,W_VIS,INK,"#fff")
    sh.circ(fx,fy,S['fill_hole']*K/2,W_VIS,INK,"#fff")
    sh.ctr_h(fx-7,fx+7,fy); sh.ctr_v(fy-7,fy+7,fx)
    sh.ctr_h(Lp-7,Rp+7,py(S['W']/2)); sh.ctr_v(Tp-7,Bp+7,px(S['L']/2))
    sh.view_label(px(S['L']/2),Tp-14,"PLAN  —  WICK SIDE UP","SCALE 2:1")
    sh.dim_h(Lp,Rp,Bp+19,f"{S['L']:.0f}",ext_from=(Bp,Bp))
    sh.dim_h(px(pk),px(S['L']-pk),Bp+10,f"{S['pocket']:.0f}  WICK ZONE",ext_from=(Bp,Bp))
    sh.dim_v(Tp,Bp,Lp-12,f"{S['W']:.0f}",ext_from=(Lp,Lp))
    sh.dim_h(Lp,fx,Tp-6,f"{S['fill_x']:.0f}",ext_from=(Tp,Tp))
    sh.dim_v(Tp,fy,Rp+11,f"{S['fill_y']:.0f}",ext_from=(Rp,Rp))
    sh.leader(fx+S['fill_cbore']*K/2,fy,Rp+6,py(20),f"FILL PORT — DETAIL F")
    sh.leader(px(pk+S['post_edge']+8*S['post_pitch']),py(pk+S['post_edge']+3*S['post_pitch']),
              Rp+6,py(32),f"{S['post_total']} x Ø{S['lid_post_clr']:.1f}",dot=True)
    sh.leader(px(30),py(48),Rp+6,py(52),f"WICK {S['wick_lid']:.2f} THK")
    sh.section_mark(Lp-5,py(S['W']/2),"D","right"); sh.section_mark(Rp+5,py(S['W']/2),"D","left")

    sy=214.0; lt=S['lid_t']*K
    sh.view_label(px(S['L']/2),Bp+30,"SECTION  D—D","SCALE 2:1")
    sh.rect(Lp,sy,S['L']*K,lt,W_VIS,INK,"#fff"); sh.hatch(Lp,sy,S['L']*K,lt,45,1.5)
    wl=S['wick_lid']*K*4
    sh.rect(px(pk),sy+lt,pw*K,wl,W_THIN,INK,"#eef3f7"); sh.hatch(px(pk),sy+lt,pw*K,wl,0,1.0,"#9fb4c6")
    sh.rect(fx-S['tube_od']*K/2,sy-12,S['tube_od']*K,12,W_VIS,INK,"#dde8f0")
    sh.dim_v(sy,sy+lt,Rp+10,f"{S['lid_t']:.1f}",ext_from=(Rp,Rp))
    sh.text(px(S['L']/2),sy+lt+wl+7,"WICK SHOWN x4 THICKNESS FOR CLARITY",FS_S-0.4,THIN,"middle")
    sh.detail_circle(px(pk+S['post_edge']+S['post_pitch']),sy+lt*0.5,8,"E",lx=px(16),ly=sy-2)

    KE=20.0; ex,ey=224.0,60.0
    sh.view_label(ex+56,44,"DETAIL  E  —  POST LAND","SCALE 20:1")
    lt2=S['lid_t']*KE; wk=S['wick_lid']*KE; clr=S['lid_post_clr']*KE; pwid=S['post_d']*KE
    sh.rect(ex,ey,112,lt2,W_VIS,INK,"#fff"); sh.hatch(ex,ey,112,lt2,45,1.8)
    mid=ex+56
    for seg in [(ex,mid-clr/2-ex),(mid+clr/2,ex+112-mid-clr/2)]:
        sh.rect(seg[0],ey+lt2,seg[1],wk,W_THIN,INK,"#eef3f7"); sh.hatch(seg[0],ey+lt2,seg[1],wk,0,1.1,"#9fb4c6")
    sh.rect(mid-pwid/2,ey+lt2,pwid,34,W_VIS,INK,"#fff"); sh.hatch(mid-pwid/2,ey+lt2,pwid,34,45,1.8)
    sh.line(mid-pwid/2,ey+lt2,mid+pwid/2,ey+lt2,1.0,"#1f6f43")
    sh.leader(mid-clr/2-2,ey+lt2,ex-6,ey-8,"DIFFUSION BOND",anchor="end",fs=FS_S-0.5)
    sh.dim_h(mid-clr/2,mid+clr/2,ey+lt2+wk+13,f"Ø{S['lid_post_clr']:.1f}")
    sh.dim_h(mid-pwid/2,mid+pwid/2,ey+lt2+42,f"Ø{S['post_d']:.1f}")
    sh.dim_v(ey+lt2,ey+lt2+wk,ex-8,f"{S['wick_lid']:.2f}",ext_from=(ex,ex))
    sh.dim_v(ey,ey+lt2,ex-19,f"{S['lid_t']:.1f}",ext_from=(ex,ex))

    KF=10.0; fx0,fy0=224.0,150.0
    sh.view_label(fx0+56,fy0-8,"DETAIL  F  —  FILL PORT","SCALE 10:1")
    lt3=S['lid_t']*KF; hole=S['fill_hole']*KF; cb=S['fill_cbore']*KF; cbd=S['fill_cbore_d']*KF
    ox,oy=fx0+16,fy0+34; WD2=100.0; mid2=ox+WD2/2
    sh.rect(ox,oy,WD2,lt3,W_VIS,INK,"#fff"); sh.hatch(ox,oy,WD2,lt3,45,1.8)
    sh.rect(mid2-hole/2,oy,hole,lt3,0,"none","#fff")
    sh.rect(mid2-cb/2,oy,cb,cbd,0,"none","#fff")
    sh.poly([(mid2-cb/2,oy),(mid2-cb/2,oy+cbd),(mid2-hole/2,oy+cbd),(mid2-hole/2,oy+lt3)],W_VIS,INK)
    sh.poly([(mid2+cb/2,oy),(mid2+cb/2,oy+cbd),(mid2+hole/2,oy+cbd),(mid2+hole/2,oy+lt3)],W_VIS,INK)
    to=S['tube_od']*KF; ti=S['tube_id']*KF
    sh.rect(mid2-to/2,oy-40,(to-ti)/2,40,W_VIS,"#2c4a63","#dde8f0")
    sh.rect(mid2+ti/2,oy-40,(to-ti)/2,40,W_VIS,"#2c4a63","#dde8f0")
    sh.line(mid2-to/2-3,oy-3,mid2+to/2+3,oy-3,1.0,"#8a5a1f")
    sh.leader(mid2+to/2,oy-3,ox+WD2+4,oy-14,"BAg-8 BRAZE FILLET",fs=FS_S-0.5)
    sh.leader(mid2-to/2,oy-30,ox-4,oy-34,f"TUBE OD{S['tube_od']:.1f} / ID{S['tube_id']:.1f} x {S['tube_len']:.0f} LG",fs=FS_S-0.5,anchor="end")
    sh.dim_h(mid2-hole/2,mid2+hole/2,oy+lt3+22,f"Ø{S['fill_hole']:.2f}")
    sh.dim_h(mid2-cb/2,mid2+cb/2,oy+lt3+12,f"Ø{S['fill_cbore']:.2f}")
    sh.dim_v(oy,oy+cbd,ox+WD2+10,f"{S['fill_cbore_d']:.2f}",ext_from=(ox+WD2,ox+WD2))
    sh.text(fx0,fy0+72,"Port sits inside the pocket footprint, clear of posts by 2.0 min.",FS_S-0.5,DIM,"start")
    sh.text(fx0,fy0+77,"Pinch off, cold-weld, then laser seal the tip. Do NOT use a screw seal.",FS_S-0.5,INK,"start","600")
    sh.table(224,240,184,[("",0.46,"l"),("",0.30,"c"),("",0.24,"r")],
      [["Fill port position","X 34.0 / Y 7.0","± 0.15"],
       ["Clearance to nearest post","2.00 min","after counterbore"],
       ["Counterbore depth","0.30","+0.05 / -0.00"],
       ["Tube protrusion after pinch","3.5 max","clears fin relief Ø7.0"]],
      hdr=False,title="FILL PORT — CRITICAL DIMENSIONS",rh=5.4)

    sh.notes(346,44,62,"NOTES",[
      "MATL: Cu C1100 OFHC annealed, 1.0 sheet.",
      "Flatness 0.02 over 68 x 68 after sintering.",
      "Wick clearance holes keep post lands bare for metal-to-metal bond.",
      "Braze tube before bake-out, after diffusion bonding.",
      "Handle with gloves. No hydrocarbons on bond faces.",
    ],fs=FS_S-0.55,lh=3.0)
    sh.table(12,244,216,[("CHECK",0.40,"l"),("REQUIREMENT",0.32,"c"),("METHOD",0.28,"l")],
      [["Flatness after sinter","0.02 max","CMM / optical flat"],
       ["Wick adhesion","no spall after 3 thermal cycles","visual 10x"],
       ["Post land bare area",f"Ø{S['lid_post_clr']:.1f} min clear","optical"],
       ["Braze joint","He leak < 1e-9 Pa.m3/s","mass spectrometer"]],
      title="INSPECTION",rh=5.2)
    emit(sh,"VC-102_chamber-lid.svg")



# ══════════════════════════════════════════════════════ SHEET 4
def sheet4():
    sh=Sheet("VC-103","SINTERED WICK — PROCESS SPECIFICATION","10:1","IN-SITU SINTERED Cu POWDER  /  ALL WICK ZONES")
    sh.sheet_of="4 / 7"
    KC=10.0; ox,oy=30.0,58.0; INB=104.0
    sh.view_label(ox+(S['rim']*KC+INB)/2,44,"WICK ZONE SECTION","SCALE 10:1  —  ASSEMBLED")
    rw=S['rim']*KC; bh=S['base_t']*KC; pdd=S['pocket_d']*KC; lh=S['lid_t']*KC
    wl=S['wick_lid']*KC; wf=S['wick_floor']*KC; ww=S['wick_wall']*KC
    sh.rect(ox,oy,rw+INB,lh,W_VIS,INK,"#fff"); sh.hatch(ox,oy,rw+INB,lh,135,1.8)
    sh.rect(ox,oy+lh,rw,bh,W_VIS,INK,"#fff"); sh.hatch(ox,oy+lh,rw,bh,45,1.8)
    sh.rect(ox+rw,oy+lh+pdd,INB,bh-pdd,W_VIS,INK,"#fff"); sh.hatch(ox+rw,oy+lh+pdd,INB,bh-pdd,45,1.8)
    sh.line(ox,oy+lh,ox+rw,oy+lh,1.1,"#1f6f43")
    for r,lab in [((ox+rw,oy+lh,INB,wl),"C"),((ox+rw,oy+lh+pdd-wf,INB,wf),"A"),((ox+rw,oy+lh+wl,ww,pdd-wl-wf),"B")]:
        sh.rect(*r,W_THIN,INK,"#eef3f7"); sh.hatch(r[0],r[1],r[2],r[3],0,1.1,"#9fb4c6")
    sh.text(ox+rw+3,oy+lh+pdd-wf-2.5,"A",FS_S,INK,"start","700")
    sh.text(ox+rw+3.2,oy+lh+wl+10,"B",FS_S,INK,"start","700")
    sh.text(ox+rw+INB-6,oy+lh+wl+4.5,"C",FS_S,INK,"start","700")
    sh.text(ox+rw+INB/2,oy+lh+pdd/2,"VAPOUR CORE  2.40",FS_S-0.4,DIM,"middle")
    sh.dim_v(oy+lh+pdd-wf,oy+lh+pdd,ox+rw+INB+10,f"A = {S['wick_floor']:.2f}",ext_from=(ox+rw+INB,ox+rw+INB))
    sh.dim_v(oy+lh,oy+lh+wl,ox+rw+INB+34,f"C = {S['wick_lid']:.2f}",ext_from=(ox+rw+INB,ox+rw+INB))
    sh.dim_h(ox+rw,ox+rw+ww,oy+lh+pdd+18,f"B = {S['wick_wall']:.2f}",ext_from=(oy+lh+pdd,oy+lh+pdd))
    sh.text(ox,oy+lh+bh+16,"Zones A, B and C are sintered in ONE cycle and must be capillary-continuous:",FS_S-0.4,INK,"start","600")
    sh.text(ox,oy+lh+bh+21,"condensate returns C → B → A. A break at the B/A junction causes evaporator dry-out.",FS_S-0.4,DIM,"start")

    y=sh.table(30,116,190,[("ZONE",0.12,"c"),("LOCATION",0.36,"l"),("THK",0.16,"c"),("FUNCTION",0.36,"l")],
      [["A","Pocket floor, around posts",f"{S['wick_floor']:.2f}","evaporator + liquid supply"],
       ["B","Pocket side walls (4 off)",f"{S['wick_wall']:.2f}","perimeter return path"],
       ["C","Lid underside, posts masked",f"{S['wick_lid']:.2f}","condensate collection"]],
      title="WICK ZONES",rh=5.2)
    y=sh.table(30,y+8,190,[("PARAMETER",0.42,"l"),("VALUE",0.30,"c"),("TOL / NOTE",0.28,"l")],
      [["*Cu powder, spherical, gas-atomised","*45 – 75 um","sieved, -200/+325 mesh"],
       ["*Effective pore radius","*12.6 um","= 0.21 x d(particle)"],
       ["*Porosity","*55 %","± 5 %, quantitative metallography"],
       ["Permeability (Blake-Kozeny)","1.97e-11 m2","derived, not measured"],
       ["*Capillary head, water @ 60 C","*10.5 kPa","vs 0.66 kPa gravity head"],
       ["Sintering temperature","950 C","± 10 C"],
       ["Dwell","30 min","at temperature"],
       ["Atmosphere","H2 (dew pt < -40 C)","or vacuum < 1e-3 Pa"],
       ["Ramp / cool","10 C/min / furnace cool","no quench"],
       ["Tooling","graphite mandrel + mask","masks post tops, rim, fill port"]],
      title="SINTER PROCESS",rh=5.2)

    X=236.0; WD=172.0
    y2=sh.table(X,58,WD,[("POWDER",0.22,"c"),("r eff",0.16,"c"),("dP cap",0.18,"c"),("Q cap VERT",0.22,"r"),("VERDICT",0.22,"c")],
      [["25 um","5.2 um","25.2 kPa","348 W","clogs, low K"],
       ["*45 – 75 um","*12.6 um","*10.5 kPa","*804 W","*SELECTED"],
       ["100 um","21.0 um","6.3 kPa","1279 W","coarse, ok"],
       ["150 um","31.5 um","4.2 kPa","1802 W","marginal tilt"],
       ["400 um  (original drawing)","100 um","0.4 kPa","0 W","FAILS — < gravity"]],
      title="POWDER TRADE STUDY  —  WHY 45-75 um",rh=5.4)
    sh.text(X,y2+6,"The original 200 um pore spec gives 380 Pa of capillary head against a 500 Pa gravity head",FS_S-0.35,INK,"start","600")
    sh.text(X,y2+10.8,"over 68 mm: the wick cannot lift liquid at all in any vertical orientation.",FS_S-0.35,DIM,"start")

    sh.notes(X,y2+20,WD,"PROCESS NOTES",[
      "Mask post top faces and the 4.0 rim before sintering — sintered powder on a bond land destroys hermeticity.",
      "Mask the fill port bore. Powder in the pinch-off tube prevents a gas-tight cold weld.",
      "Grooves must remain open under the wick. Verify by back-light or CT on the first article.",
      "Sinter and diffusion bond may share one furnace cycle only if the bond fixture applies load after the sinter dwell; otherwise run separately.",
      "No organic binders. Any residue outgasses into the sealed chamber as non-condensable gas.",
    ],fs=FS_S-0.45,lh=3.4)
    sh.table(12,244,216,[("ACCEPTANCE TEST",0.42,"l"),("REQUIREMENT",0.30,"c"),("METHOD",0.28,"l")],
      [["Porosity",f"55 % ± 5","image analysis, 3 sections"],
       ["Wick thickness A",f"{S['wick_floor']:.2f} ± 0.05","cross-section, 5 points"],
       ["Capillary rise, water","> 25 mm in 60 s","witness coupon, vertical"],
       ["Groove continuity","open, no blockage","back-light / CT, first article"]],
      title="WICK ACCEPTANCE",rh=5.2)
    emit(sh,"VC-103_wick-sinter-spec.svg")

# ══════════════════════════════════════════════════════ SHEET 5
def sheet5():
    sh=Sheet("VC-201 / VC-202","FIN STACK — TWO CONFIGURATIONS","2:1","Al 1100-H14  /  SKIVED OR BONDED  /  68 x 68 x 22")
    sh.sheet_of="5 / 7"
    def config(x0,title,sub,n,t,p,H):
        K=2.0; L=x0; R=x0+S['L']*K; yb0=62.0
        sh.view_label((L+R)/2,42,title,sub)
        fh=H*K; fb=S['fin_base']*K
        span=n*p*K; s0=(L+R)/2-span/2
        for i in range(n): sh.rect(s0+(i+0.5)*p*K-t*K/2,yb0,t*K,fh,0.28,INK,"#fff")
        sh.rect(L,yb0+fh,S['L']*K,fb,W_VIS,INK,"#fff"); sh.hatch(L,yb0+fh,S['L']*K,fb,45,1.6)
        sh.line(L,yb0,R,yb0,W_VIS,INK); sh.line(L,yb0,L,yb0+fh,W_VIS,INK); sh.line(R,yb0,R,yb0+fh,W_VIS,INK)
        sh.text((L+R)/2,yb0-4.5,f"{n} FINS  x  {t:.2f} THK  @ {p:.1f} PITCH",FS_S-0.3,DIM,"middle","600")
        sh.dim_v(yb0,yb0+fh,L-10,f"{H:.0f}",ext_from=(L,L))
        sh.dim_v(yb0+fh,yb0+fh+fb,R+10,f"{S['fin_base']:.1f}",ext_from=(R,R))
        sh.dim_h(L,R,yb0+fh+fb+12,f"{S['L']:.0f}",ext_from=(yb0+fh+fb,yb0+fh+fb))
        rx=L+S['fill_x']*K
        sh.rect(rx-S['fin_relief_d']*K/2,yb0+fh,S['fin_relief_d']*K,fb,W_HID,INK,dash="2 1.5")
        sh.leader(rx+S['fin_relief_d']*K/2,yb0+fh+fb,rx+26,yb0+fh+fb+22,
                  f"Ø{S['fin_relief_d']:.0f} x {S['fin_relief_h']:.1f} RELIEF",fs=FS_S-0.5)
        sh.text((L+R)/2,yb0+fh+fb+22,"FRONT ELEVATION",FS_S-0.35,INK,"middle","700",0.3)
        # ---- enlarged fin detail, scale chosen so 3 pitches span 96 mm
        KD=96.0/(3*p); dy=138.0
        sh.view_label((L+R)/2,dy-6,"FIN DETAIL",f"SCALE {KD:.0f}:1")
        d0=(L+R)/2-1.6*p*KD
        for i in range(4):
            sh.rect(d0+i*p*KD,dy+6,t*KD,44,W_VIS,INK,"#fff"); sh.hatch(d0+i*p*KD,dy+6,t*KD,44,45,1.5)
        sh.rect(d0-5,dy+50,3*p*KD+t*KD+10,S['fin_base']*KD,W_VIS,INK,"#fff")
        sh.hatch(d0-5,dy+50,3*p*KD+t*KD+10,S['fin_base']*KD,45,1.5)
        base_b=dy+50+S['fin_base']*KD
        sh.dim_h(d0,d0+p*KD,base_b+11,f"{p:.1f} PITCH",ext_from=(base_b,base_b))
        sh.dim_h(d0+t*KD,d0+p*KD,dy+2,f"{p-t:.1f}")
        sh.leader(d0+2*p*KD+t*KD/2,dy+28,d0+2*p*KD+t*KD+18,dy+20,f"{t:.2f} THK",fs=FS_S-0.4)
        sh.dim_v(dy+50,base_b,d0-13,f"{S['fin_base']:.1f}",ext_from=(d0-5,d0-5))
        return base_b
    config(30.0,"CONFIG A  —  VC-201","FORCED AIR  >=  1 m/s",S['finA_n'],S['finA_t'],S['finA_p'],S['finA_h'])
    yb=config(190.0,"CONFIG B  —  VC-202","NATURAL CONVECTION ONLY",S['finB_n'],S['finB_t'],S['finB_p'],S['finB_h'])

    sh.notes(334,54,74,"NOTES",[
      "MATL: Al 1100-H14 or 6063-T5. Skived, folded or bonded fin.",
      "Base flatness 0.03. Ra 0.8 max on the TIM face.",
      "Anodise 5 um clear, or bare + passivate. No paint.",
      "Fit ONE configuration only — alternates, not stackable.",
      "Relief pocket clears the folded pinch-off tube. 0.5 min clearance after pinch.",
      "Fin tips deburred. No swarf — it migrates into the fin field.",
    ],fs=FS_S-0.6,lh=2.9)
    sh.table(334,150,74,[("",0.56,"l"),("",0.44,"r")],
      [["Fin area A","0.117 m2"],["Fin area B","0.048 m2"],
       ["h @ 2 m/s (A)","97 W/m2K"],["h natural (B)","9.6 W/m2K"],
       ["Fin efficiency A","0.77"],["Fin efficiency B","0.97"],
       ["Air dP (A) @ 2 m/s","~18 Pa"]],
      hdr=False,title="DERIVED",rh=5.0)
    sh.text(30,yb+16,"AIRFLOW:  CONFIG A channels run parallel to the 68 mm edge. Duct the fan so all 42 channels are fed;",FS_S-0.35,INK,"start","600")
    sh.text(30,yb+21,"a partially blocked inlet starves the downstream half and the die runs 15-20 K hotter than this table predicts.",FS_S-0.35,DIM,"start")
    sh.table(12,236,300,
      [("",0.30,"l"),("FIN PITCH",0.14,"c"),("GAP",0.10,"c"),("FINS",0.09,"c"),
       ("R sink",0.13,"c"),("R th (j-a)",0.13,"c"),("Q @ dT 75 K",0.11,"r")],
      [["*CONFIG A — forced air 1 m/s","*1.5","1.1","*43","0.93","1.12","*67 W"],
       ["*CONFIG A — forced air 2 m/s","*1.5","1.1","*43","0.47","0.67","*113 W"],
       ["*CONFIG A — forced air 4 m/s","*1.5","1.1","*43","0.27","0.46","*163 W"],
       ["CONFIG A — STILL AIR (invalid)","1.5","1.1","43","32.6","32.8","2 W"],
       ["*CONFIG B — natural convection","*6.0","5.0","*11","3.68","3.87","*19 W"],
       ["optimum plate spacing, H=20, dT=40 K","4.2","—","—","—","—","reference"]],
      title="SELECTION TABLE   —   1.5 mm PITCH IS FORCED-AIR ONLY",rh=5.2)
    sh.text(12,285,"A 1.1 mm gap 20 mm tall chokes buoyant flow: h collapses to 0.25 W/m2K. Never fit VC-201 in a fanless enclosure.",FS_S-0.3,INK,"start","600")
    emit(sh,"VC-201_fin-stacks.svg")

# ══════════════════════════════════════════════════════ SHEET 6
def sheet6():
    sh=Sheet("VC-300","PROCESS & CHARGING SPECIFICATION","NONE","Cu-H2O VAPOUR CHAMBER  /  MANDATORY SEQUENCE")
    sh.sheet_of="6 / 7"
    steps=[("1","MACHINE","VC-101 base + VC-102 lid. Posts integral. Fill port drilled + counterbored.",""),
      ("2","CLEAN","Vapour degrease → 10% H2SO4 pickle 60 s → DI rinse → N2 blow dry.","no hydrocarbons"),
      ("3","SINTER WICK","Cu powder 45-75 um. 950 C / 30 min / H2 or vacuum. Mask rim, post tops, fill bore.","per VC-103"),
      ("4","DIFFUSION BOND","Stack lid on base. 850 C / 8 MPa / 60 min / vacuum < 1e-3 Pa.","Cu-Cu solid state"),
      ("5","WELD FILL TUBE","Laser or micro-TIG weld Cu tube OD3.0 to lid. No filler, no flux.","after bonding"),
      ("6","LEAK TEST 1","He mass spec, chamber under vacuum. Reject > 1e-9 Pa.m3/s.","gross + fine"),
      ("7","BAKE-OUT","200 C / 4 h / < 1e-3 Pa through the fill tube. Pump throughout.","removes adsorbed gas"),
      ("8","CHARGE","1.90 mL DI water 18 MOhm.cm, deaerated. Burette under vacuum, chamber at 0 C.","± 0.05 mL"),
      ("9","DEGAS","Freeze-pump-thaw x 3. Final pump at ice point to < 10 Pa.","removes dissolved O2"),
      ("10","PINCH-OFF","Cold-weld the tube in a hydraulic pincher. Laser-seal the tip. Trim + fold.","NO screw seal"),
      ("11","LEAK TEST 2","He bomb 3 bar / 4 h, then mass spec. Reject > 1e-9 Pa.m3/s.","post-seal"),
      ("12","BURN-IN","3 thermal cycles 20 ↔ 100 C. Re-test R th after.","stabilises wick"),
      ("13","ACCEPT","R th (case-to-case) < 0.25 K/W at 50 W, horizontal and vertical.","final gate")]
    X=16.0; y=46.0; BW=196.0; RH=13.4
    sh.view_label(X+BW/2,36,"MANDATORY PROCESS SEQUENCE","EVERY STEP IN ORDER — NO SUBSTITUTION")
    for i,(n,ttl,body,tag) in enumerate(steps):
        crit = n in ("4","7","9","10")
        rsq(sh,X,y,BW,RH-2.2,1.2,W_VIS,INK,"#f2f6f9" if crit else "#fff")
        sh.rect(X,y,5.5,RH-2.2,0,"none","#2c4a63" if crit else "#8fa2b3")
        sh.text(X+2.75,y+7.2,n,FS_S-0.4,"#ffffff","middle","700")
        sh.text(X+8.5,y+4.8,ttl,FS_S,INK,"start","700",0.3)
        sh.text(X+8.5,y+9.4,body,FS_S-0.6,DIM,"start")
        if tag: sh.text(X+BW-2.5,y+4.8,tag,FS_S-0.65,"#2c4a63","end","600")
        if i<len(steps)-1:
            sh.line(X+BW/2,y+RH-2.2,X+BW/2,y+RH,W_DIM,DIM)
            sh._arrow(X+BW/2,y+RH+0.4,90,DIM)
        y+=RH
    X2=226.0; WD=182.0
    y2=sh.table(X2,46,WD,[("PARAMETER",0.44,"l"),("VALUE",0.30,"c"),("LIMIT",0.26,"r")],
      [["*Working fluid","*DI water 18 MOhm.cm","deaerated"],
       ["*Charge volume",f"*{CH['charge']:.2f} mL","± 0.05 mL"],
       ["Wick void volume",f"{CH['void']/1000:.2f} mL","charge = 125 %"],
       ["Bake-out","200 C / 4 h","< 1e-3 Pa"],
       ["Final vacuum before seal","< 10 Pa","at ice point"],
       ["Diffusion bond","850 C / 8 MPa / 60 min","vacuum"],
       ["*Leak rate","*< 1e-9 Pa.m3/s","He mass spec"],
       ["*Acceptance R th","*< 0.25 K/W @ 50 W","both orientations"]],
      title="PROCESS PARAMETERS",rh=5.4)
    y2=sh.notes(X2,y2+10,WD,"PROHIBITED — CAUSES FIELD FAILURE",[
      "Charging before diffusion bonding. Water boils at 100 C and the bond runs at 850 C: the chamber ruptures. This error appears on the superseded Maxsorb drawing — do not repeat it.",
      "Threaded or O-ring fill seals. A screw seal cannot hold high vacuum; helium ingress accumulates as non-condensable gas and the condenser is blanketed within months. Cold-weld pinch-off only.",
      "Aluminium anywhere wetted. Al + water generates H2. The fin stack is external and TIM-coupled only.",
      "Undeaerated water. Dissolved O2 oxidises copper and liberates H2.",
      "Activated carbon or any organic inside the envelope without a 250 C / 8 h vacuum bake.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    sh.text(X2,y2+3,"Non-condensable gas is the dominant failure mode of a sealed two-phase device.",FS_S-0.35,INK,"start","700")
    sh.text(X2,y2+8,"Steps 7, 9 and 10 exist solely to prevent it. None of them is optional.",FS_S-0.35,DIM,"start")
    y3=sh.table(X2,y2+16,WD,[("STEP",0.12,"c"),("RECORD RETAINED",0.56,"l"),("HOLD POINT",0.32,"r")],
      [["4","bond furnace chart (T, P, vacuum)","yes — first article"],
       ["6","He leak rate, pre-charge","*yes — 100 %"],
       ["7","bake-out pressure trace","yes"],
       ["8","charge mass, by weight","*yes — 100 %"],
       ["11","He leak rate, post-seal","*yes — 100 %"],
       ["13","R th, both orientations","*yes — 100 %"]],
      title="QUALITY RECORDS",rh=5.4)
    sh.text(X2,y3+6,"Charge by MASS, not by volume: 1.90 mL DI water = 1.87 g at 20 C. A burette",FS_S-0.4,INK,"start","600")
    sh.text(X2,y3+11,"reading is not traceable once the chamber is cold and under vacuum.",FS_S-0.4,DIM,"start")
    emit(sh,"VC-300_process-charging.svg")

# ══════════════════════════════════════════════════════ SHEET 7
def sheet7():
    sh=Sheet("VC-400","MAXSORB III RESERVOIR — TEST COUPON","2:1","EXPERIMENTAL  /  NOT FOR PRODUCTION  /  INSTRUMENTED")
    sh.sheet_of="7 / 7"
    sh.rect(12,30,396,11,0.7,"#8a2f2f","#fbf1f1")
    sh.text(210,37.6,"EXPERIMENTAL COUPON — NOT A PRODUCTION CONFIGURATION — SEE PHYSICS NOTE BELOW",
            FS+0.4,"#8a2f2f","middle","700",0.5)
    K=2.0; x0,y0=24.0,58.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    sh.view_label(px(34),50,"COUPON ARRANGEMENT","SCALE 2:1")
    # chamber
    sh.rect(px(0),py(0),S['L']*K,S['base_t']*K+S['lid_t']*K,W_VIS,INK,"#fff")
    sh.hatch(px(0),py(0),S['L']*K,S['base_t']*K+S['lid_t']*K,45,1.6)
    sh.text(px(34),py(2.6)+1,"VAPOUR CHAMBER VC-100",FS_S-0.4,INK,"middle","600")
    # die
    sh.rect(px(24),py(5),S['die']*K,3,W_VIS,"#8a5a1f","#f6ecdc")
    sh.text(px(34),py(5)+8,"20 x 20 HEATER (DIE SIMULATOR)",FS_S-0.5,"#8a5a1f","middle")
    # reservoir on a heated stub
    rx,ry=px(74),py(-4)
    sh.rect(rx,ry,30,18,W_VIS,INK,"#eef2f6")
    sh.text(rx+15,ry+7,"Maxsorb III",FS_S-0.45,INK,"middle","700")
    sh.text(rx+15,ry+12,"0.50 g",FS_S-0.5,DIM,"middle")
    sh.rect(rx,ry+18,30,5,W_VIS,"#8a2f2f","#fbf1f1")
    sh.text(rx+15,ry+21.6,"HEATER 0-20 W",FS_S-0.6,"#8a2f2f","middle","600")
    # isolation valve
    vx=px(69)
    sh.line(px(68),py(2.5),vx+2,py(2.5),W_VIS,INK)
    sh.poly([(vx+2,py(2.5)-4),(vx+2,py(2.5)+4),(vx+9,py(2.5)-4),(vx+9,py(2.5)+4)],W_VIS,INK,"#fff",close=True)
    sh.line(vx+9,py(2.5),rx,py(2.5),W_VIS,INK)
    sh.leader(vx+5.5,py(2.5)-4,vx+2,py(2.5)-16,"ISOLATION VALVE (BELLOWS, ALL-METAL)",fs=FS_S-0.5)
    # thermocouples
    for i,(tx,ty,lab,dy) in enumerate([(px(34),py(6.5),"T1 die",9.0),(px(10),py(0),"T2 cond",-3.4),
                                    (rx+15,ry,"T3 carbon",-3.4),(px(58),py(0),"T4 wall",-3.4)]):
        sh.circ(tx,ty,1.6,W_THIN,"#1f6f43","#e6f2ea")
        sh.text(tx,ty+dy,lab,FS_S-0.7,"#1f6f43","middle","600")
    sh.text(px(0),py(16),"Mesh: 10 um SUS 316L — NOT 50 um. Maxsorb III fines pass a 50 um mesh and foul the wick.",FS_S-0.45,INK,"start","600")
    sh.text(px(0),py(21),"Carbon bake-out 250 C / 8 h / < 1e-3 Pa before installation, transferred under vacuum.",FS_S-0.45,DIM,"start")
    sh.text(px(0),py(26),"Reservoir 0.5 g Maxsorb III needs >= 1.8 cm3 at 0.28 g/cc bulk density — the original 1.50 cm3",FS_S-0.45,INK,"start","600")
    sh.text(px(0),py(31),"housing could not physically hold the charge. This coupon uses 30 x 12 x 6 = 2.16 cm3.",FS_S-0.45,DIM,"start")

    y=sh.table(16,124,196,[("T evap",0.14,"c"),("T res",0.14,"c"),("P/Psat",0.14,"c"),
                            ("UPTAKE",0.16,"c"),("HELD",0.14,"c"),("WICK FILL",0.16,"c"),("RESULT",0.12,"c")],
      [["60 C","40 C","1.00","1.31 g/g","0.66 g","15 %","*DRY"],
       ["60 C","60 C","1.00","1.31 g/g","0.66 g","15 %","*DRY"],
       ["60 C","100 C","0.24","1.06 g/g","0.53 g","35 %","*DRY"],
       ["60 C","127 C","0.11","0.77 g/g","0.39 g","58 %","marginal"],
       ["60 C","169 C","0.03","0.42 g/g","0.21 g","90 %","wet"]],
      title="ADSORPTION EQUILIBRIUM  —  DUBININ-ASTAKHOV, METHANOL / MAXSORB III",rh=5.4)
    sh.notes(16,y+8,196,"PHYSICS NOTE — WHY THE PASSIVE VERSION CANNOT WORK",[
      "In a sealed pure-substance chamber the pressure is set by the evaporator: P = Psat(T_evap). The carbon sees the relative pressure P / Psat(T_res).",
      "A reservoir on the condenser side always satisfies T_res <= T_evap, so P/Psat >= 1 and the carbon saturates: it takes 0.66 g of a 0.75 g charge and the wick runs at 15 % fill. That is permanent dry-out, not pressure control.",
      "Keeping the wick wet needs the reservoir ~110 K ABOVE the chip. A working vapour chamber is isothermal, so no passive layout can deliver that. It requires the heater and valve drawn above.",
      "Overcharging to 1.90 mL keeps the wick wet, but then liquid always remains, the pressure stays at Psat, and the carbon buys nothing thermally. Its only genuine residual function is as a non-condensable gas getter — for which tens of mg suffices, not 0.5 g.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    sh.table(16,244,196,[("",0.52,"l"),("WITH CARBON",0.24,"c"),("WITHOUT",0.24,"r")],
      [["Wick fill at equilibrium","15 %","*125 %"],
       ["Q at 2 m/s forced air","0 W (dry)","*113 W"],
       ["Transient buffer","722 J (heater needed)","0 J"],
       ["Parts count / failure modes","+ valve, heater, control","*baseline"]],
      title="COUPON vs PRODUCTION VC-100",rh=5.2)

    X2=226.0; WD=182.0
    y2=sh.table(X2,58,WD,[("MEASUREMENT",0.44,"l"),("INSTRUMENT",0.32,"l"),("PURPOSE",0.24,"r")],
      [["T1..T4","type-T TC, ± 0.2 K","gradient map"],
       ["Chamber pressure","capacitance manometer","verify Psat(T)"],
       ["Reservoir mass","in-situ load cell ± 1 mg","uptake vs time"],
       ["Heater power","4-wire, ± 0.5 %","energy balance"],
       ["Valve state","open / closed","isolate the carbon"]],
      title="INSTRUMENTATION",rh=5.4)
    y2=sh.table(X2,y2+8,WD,[("#",0.07,"c"),("TEST",0.55,"l"),("MEASURES",0.38,"r")],
      [["1","Valve CLOSED, sweep 0-150 W","baseline R th, no carbon"],
       ["2","Valve OPEN, reservoir unheated","dry-out rate + time constant"],
       ["3","Valve OPEN, reservoir held 110 K above die","whether the wick recovers"],
       ["4","Valve OPEN, cyclic 10 W bursts, heater regen","usable buffer energy (722 J predicted)"],
       ["5","1000 h hold, valve OPEN, unheated","NCG getter benefit vs dry-out cost"]],
      title="TEST MATRIX",rh=5.4)
    sh.notes(X2,y2+9,WD,"COUPON NOTES",[
      "Fluid is METHANOL for this coupon (activated carbon is hydrophobic; water uptake is poor). Accept the 7.3x lower merit number — this coupon measures adsorption, not peak cooling.",
      "Methanol charge 1.90 mL so the wick stays wet with the carbon saturated. Do not run at 1.00 mL.",
      "The valve is what makes this an experiment rather than a defect. A production unit has no valve, so it has no way to stop the carbon draining the wick.",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    sh.notes(X2,206,WD,"IF TEST 4 SUCCEEDS — PATH TO A PRODUCT",[
      "Move the reservoir onto the die's own heat path, upstream of the chamber, so it is genuinely hotter than the evaporator without a valve.",
      "Replace the bellows valve with a thermally actuated one-way element, or accept a control loop driving the regeneration heater.",
      "Budget 722 J against ~5 g of added mass and a new hermetic joint. Compare against simply adding 15 K of copper (+50 g).",
    ],fs=FS_S-0.45,lh=3.4,num=False)
    emit(sh,"VC-400_maxsorb-test-coupon.svg")

if __name__=="__main__":
    print("generating ->",OUT)
    sheet1(); sheet2(); sheet3(); sheet4(); sheet5(); sheet6(); sheet7()
