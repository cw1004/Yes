#!/usr/bin/env python3
import sys, os, math
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path[:0]=[HERE, os.path.join(HERE,"..","sim")]
from draft import *
from icemaker_spec import (SPEC as S, ENV as E, design, adsorber, exchangers,
                           pressure, masses, cycle_corners, sweep, psat_meoh)

OUT=os.path.join(HERE,"si_out"); os.makedirs(OUT,exist_ok=True)
TB=[("DRAWN","AI-ASSISTED DRAFT"),("CHECKED","— PENDING —"),
    ("MATERIAL","SEE BOM"),("FINISH","SEE NOTES"),("DATE","2026-09-15")]
D=design(); A=adsorber(); X=exchangers(); PR,HOOP,BURST,PSTAG=pressure()
MASS,MTOT=masses(); CC=cycle_corners()
HOT="#8a2f2f"; COLD="#1b5e8c"; DIA="Ø"
def emit(sh,name):
    sh.frame(); sh.title_block(TB); sh.save(os.path.join(OUT,name)); print("  ",name)
def rsq(sh,x,y,w,h,r,sw=W_VIS,c=INK,fill="none"):
    sh.raw(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" rx="{r:.3f}" '
           f'fill="{fill}" stroke="{c}" stroke-width="{sw}"/>')

# ══════════════════════════════════════════ SHEET 1
def sheet1():
    sh=Sheet("SI-100","SOLAR ICE MAKER — ARRANGEMENT","1:10",
             f"ACTIVATED CARBON + METHANOL  /  {S['A_coll']:.1f} m2  /  {S['ice_day']:.0f} kg ICE PER DAY  /  OUTDOOR ONLY")
    sh.sheet_of="1 / 6"
    sh.rect(12,30,396,11,0.7,HOT,"#fbf1f1")
    sh.text(210,37.6,f"CONTAINS {D['charge']:.1f} kg OF METHANOL — TOXIC AND FLAMMABLE — "
            "OUTDOOR INSTALLATION ONLY, SEE SI-300",FS_S+0.2,HOT,"middle","700",0.3)

    K=0.10; x0,y0=30.0,56.0                       # 1:10
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    sh.view_label(px(620),48,"SIDE ELEVATION","SCALE 1:10")
    GND=1500.0
    sh.line(px(-30),py(GND),px(1280),py(GND),0.6,INK)
    for wx in (200,1050):
        sh.circ(px(wx),py(GND-E['wheel_od']/2),E['wheel_od']*K/2,W_VIS,INK,"#eef2f6")
    sh.rect(px(40),py(1240),1170*K,60*K,W_VIS,INK,"#fff")          # lower deck
    for mx in (100,1150):                                           # support posts
        sh.rect(px(mx-20),py(740),40*K,500*K,W_VIS,INK,"#fff")
    # tilted collector, hinge at the right post, rising up-left
    t=math.radians(E['tilt']); Lc=E['coll_l']; dp=E['coll_d']
    hx,hy=px(1150),py(740)
    ux,uy=-math.cos(t),-math.sin(t); nx,ny=-math.sin(t),math.cos(t)
    p=[(hx,hy),(hx+Lc*K*ux,hy+Lc*K*uy),
       (hx+Lc*K*ux+dp*K*nx,hy+Lc*K*uy+dp*K*ny),(hx+dp*K*nx,hy+dp*K*ny)]
    sh.hatch_poly(p,45,1.6); sh.poly(p,W_VIS,INK,close=True)
    sh.poly([(hx-1,hy-2),(hx+Lc*K*ux-1,hy+Lc*K*uy-2)],1.1,"#2c3e4c")
    mid=(hx+Lc*K*ux*0.5,hy+Lc*K*uy*0.5)
    sh.balloon(mid[0]+2,mid[1]-15,"1",mid[0],mid[1]-2)
    sh.text(px(1120),py(830),f"{E['tilt']:.0f}\u00b0 TILT",FS_S-0.4,DIM,"end")
    # ice box on the deck, under the collector
    sh.rect(px(60),py(780),E['box_ext_L']*K,E['box_ext_H']*K,W_VIS,INK,"#fff")
    sh.rect(px(60+S['box_ins']),py(780+S['box_ins']),S['box_L']*K,S['box_H']*K,W_THIN,INK,"#eef3f7")
    sh.hatch(px(60),py(780),E['box_ext_L']*K,S['box_ins']*K,0,1.0,"#c3d0da")
    sh.balloon(px(60)-13,py(1010),"4",px(60),py(1010))
    # condenser and receiver
    sh.rect(px(960),py(800),E['cond_d']*K,E['cond_h']*K,W_VIS,INK,"#fff")
    for i in range(9):
        yy=py(815+i*44); sh.line(px(956),yy,px(960+E['cond_d']+4),yy,0.3,INK)
    sh.balloon(px(1180),py(860),"2",px(960+E['cond_d']),py(860))
    sh.rect(px(780),py(1140),E['recv_od']*K,100*K,W_VIS,INK,"#eef2f6")
    sh.balloon(px(780)-13,py(1190),"3",px(780),py(1190))
    # vapour lines
    sh.poly([(px(1005),py(800)),(px(1005),py(640)),(hx+Lc*K*ux*0.35+dp*K*nx,hy+Lc*K*uy*0.35+dp*K*ny)],
            W_VIS,HOT)
    sh.poly([(px(390),py(780)),(px(390),py(700)),(hx+Lc*K*ux*0.80+dp*K*nx,hy+Lc*K*uy*0.80+dp*K*ny)],
            W_VIS,COLD)
    sh.text(px(700),py(600),"DAY   bed \u2192 condenser",FS_S-0.5,HOT,"middle","600")
    sh.text(px(330),py(668),"NIGHT   evaporator \u2192 bed",FS_S-0.5,COLD,"middle","600")
    sh.dim_h(px(0),px(E['frame_L']),py(GND)+11,f"{E['frame_L']:.0f}",ext_from=(py(GND),py(GND)))
    sh.dim_v(py(98),py(GND),px(-18),f"{GND-98:.0f}",ext_from=(px(0),px(0)))
    sh.text(px(620),py(GND)+22,f"TOTAL MASS {MTOT:.0f} kg CHARGED  —  a wheeled trolley, not a carried unit",
            FS_S-0.4,INK,"middle","600")

    # ---- Clapeyron cycle
    CX,CY,CW,CH = 232.0, 62.0, 168.0, 96.0
    sh.view_label(CX+CW/2,52,"CLAPEYRON CYCLE","ln P  vs  −1/T")
    Ts=[-10,0,20,40,60,80,100,120,140]
    fT=lambda T: -1.0/(T+273.15)
    Ps=[1,2,5,10,20,50]
    t0,t1=fT(-15),fT(150); lp0,lp1=math.log(1.2),math.log(60)
    gx=lambda T:CX+(fT(T)-t0)/(t1-t0)*CW
    gy=lambda Pk:CY+CH-(math.log(Pk)-lp0)/(lp1-lp0)*CH
    sh.rect(CX,CY,CW,CH,W_THIN,THIN)
    for T in Ts:
        sh.line(gx(T),CY,gx(T),CY+CH,0.15,"#e4eaef")
        sh.text(gx(T),CY+CH+5,f"{T}",FS_S-0.5,MUT if False else THIN,"middle")
    for Pk in Ps:
        sh.line(CX,gy(Pk),CX+CW,gy(Pk),0.15,"#e4eaef")
        sh.text(CX-3,gy(Pk)-1.6,f"{Pk}",FS_S-0.5,THIN,"end")
    sh.text(CX+CW/2,CY+CH+12,"bed temperature  °C",FS_S-0.4,DIM,"middle")
    sh.raw(f'<g transform="rotate(-90 {CX-13:.1f} {CY+CH/2:.1f})">')
    sh.text(CX-13,CY+CH/2,"pressure  kPa abs",FS_S-0.4,DIM,"middle"); sh.raw('</g>')
    pts={k:(gx(CC[k][0]),gy(CC[k][1]/1000)) for k in "ABCD"}
    sh.poly([pts['A'],pts['B']],1.6,HOT); sh.poly([pts['B'],pts['C']],1.6,HOT)
    sh.poly([pts['C'],pts['D']],1.6,COLD); sh.poly([pts['D'],pts['A']],1.6,COLD)
    for k,lab in (("A","A  adsorb end"),("B","B  P reached"),("C","C  desorb end"),("D","D  P dropped")):
        x_,y_=pts[k]
        sh.circ(x_,y_,2.4,W_THIN,INK,"#fff")
        dxl = 5 if k in ("A","D") else -5
        sh.text(x_+dxl,y_-3,k,FS_S-0.2,INK,"start" if dxl>0 else "end","700")
    sh.text(CX+3,CY+7,f"isostere x = {CC['x_r']:.2f}",FS_S-0.6,DIM,"start")
    sh.text(CX+CW-3,CY+CH-4,f"isostere x = {CC['x_l']:.2f}",FS_S-0.6,DIM,"end")
    lg=CX
    for nm,c in (("day: heat + desorb",HOT),("night: cool + adsorb",COLD)):
        sh.rect(lg,CY+CH+16,8,3,0,"none",c)
        sh.text(lg+11,CY+CH+18.5,nm,FS_S-0.5,DIM,"start")
        lg+=len(nm)*1.45+30

    # ---- BOM
    y=sh.table(232,188,176,[("ITEM",0.09,"c"),("PART",0.17,"l"),("DESCRIPTION",0.48,"l"),("QTY",0.26,"r")],
      [["1","SI-101",f"ADSORBER-COLLECTOR, {S['n_tube']} TUBE","1"],
       ["2","SI-102","CONDENSER, FINNED, NATURAL CONVECTION","1"],
       ["3","SI-103","RECEIVER, 3 L","1"],
       ["4","SI-104","EVAPORATOR + ICE BOX","1"],
       ["5","SI-105","CHECK VALVE, ALL-METAL","2"],
       ["6","—","ACTIVATED CARBON, MAXSORB III",f"{D['m_c']:.1f} kg"],
       ["7","—","METHANOL, ANHYDROUS >99.8 %",f"{D['charge']:.1f} kg"]],
      title="BILL OF MATERIALS")
    sh.table(12,234,216,[("",0.56,"l"),("",0.44,"r")],
      [[n,f"{v:.1f} kg"] for n,v in MASS]+[["*TOTAL, CHARGED",f"*{MTOT:.1f} kg"]],
      hdr=False,title="MASS",rh=4.3)
    emit(sh,"SI-100_general-arrangement.svg")


# ══════════════════════════════════════════ SHEET 2
def sheet2():
    sh=Sheet("SI-101","ADSORBER-COLLECTOR","1:10",
             f"SS 316L  /  {S['n_tube']} TUBES OD{S['tube_od']:.1f}  /  {D['m_c']:.1f} kg CARBON  /  DESIGN 14 bar")
    sh.sheet_of="2 / 6"
    K=0.10; x0,y0=30.0,46.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    W_=E['coll_w']; Lc=E['coll_l']
    sh.view_label(px(W_/2),38,"PLAN  \u2014  GLAZING REMOVED","SCALE 1:10")
    sh.rect(px(0),py(0),W_*K,Lc*K,W_VIS,INK,"#fff")
    m=(W_-S['A_coll']*1e6/S['tube_len'])/2
    for i in range(S['n_tube']):
        cx=m+A['pitch']*(i+0.5)
        sh.rect(px(cx-S['tube_od']/2),py(m),S['tube_od']*K,S['tube_len']*K,W_THIN,INK,"#f6efe4")
        sh.ctr_v(py(m)-3,py(m+S['tube_len'])+3,px(cx))
    for yy in (m-26,m+S['tube_len']+26):
        sh.rect(px(m-15),py(yy-9),(A['pitch']*S['n_tube']+30)*K,18*K,W_VIS,INK,"#eef2f6")
    sh.text(px(W_/2),py(m-34),"VAPOUR HEADER, TOP",FS_S-0.55,DIM,"middle")
    sh.text(px(W_/2),py(m+S['tube_len']+48),"VAPOUR HEADER, BOTTOM",FS_S-0.55,DIM,"middle")
    sh.dim_h(px(0),px(W_),py(Lc)+20,f"{W_:.0f}",ext_from=(py(Lc),py(Lc)))
    sh.dim_h(px(m+A['pitch']*0.5),px(m+A['pitch']*1.5),py(0)-7,f"{A['pitch']:.0f}",ext_from=(py(0),py(0)))
    sh.text(px(W_/2),py(0)-14,f"{S['n_tube']} x {A['pitch']:.0f} PITCH",FS_S-0.4,DIM,"middle","600")
    sh.dim_v(py(0),py(Lc),px(0)-11,f"{Lc:.0f}",ext_from=(px(0),px(0)))
    sh.dim_v(py(m),py(m+S['tube_len']),px(W_)+11,f"{S['tube_len']:.0f}",ext_from=(px(W_),px(W_)))
    sh.section_mark(px(0)-5,py(Lc/2),"A","right"); sh.section_mark(px(W_)+5,py(Lc/2),"A","left")
    sh.leader(px(m+A['pitch']*7.5),py(m+160),px(W_)+6,py(72),
              f"{S['n_tube']} x TUBE OD{S['tube_od']:.1f}",dot=True)

    sy=196.0
    sh.view_label(px(W_/2),186,"SECTION  A\u2014A","SCALE 1:10")
    d=E['coll_d']
    sh.rect(px(0),sy,W_*K,d*K,W_VIS,INK,"#fff")
    sh.rect(px(0),sy,W_*K,2.2,W_THIN,"#2c4a63","#e7f0f6")
    for i in range(S['n_tube']):
        cx=m+A['pitch']*(i+0.5)
        sh.circ(px(cx),sy+d*K*0.50,S['tube_od']*K/2,W_THIN,INK,"#f6efe4")
    sh.line(px(0),sy+d*K*0.50-S['tube_od']*K/2-0.8,px(W_),sy+d*K*0.50-S['tube_od']*K/2-0.8,1.0,"#8a5a1f")
    sh.rect(px(0),sy+d*K-S['ins_back']*K,W_*K,S['ins_back']*K,W_THIN,INK,"#f2f0e9")
    sh.hatch(px(0),sy+d*K-S['ins_back']*K,W_*K,S['ins_back']*K,0,1.2,"#c8c2ae")
    sh.dim_v(sy,sy+d*K,px(W_)+11,f"{d:.0f}",ext_from=(px(W_),px(W_)))
    for j,(lab,yy) in enumerate((("GLAZING 3.2 LOW-IRON",sy+1),
                   ("ABSORBER Cu 0.5, SELECTIVE",sy+d*K*0.50-S['tube_od']*K/2-1),
                   ("INSULATION 50 MINERAL WOOL",sy+d*K-S['ins_back']*K/2))):
        sh.leader(px(150+j*300),yy,px(W_)+16,sy-8+j*9,lab,fs=FS_S-0.6)

    KB=1.0; bx,by=196.0,138.0
    sh.view_label(bx,84,"DETAIL  B  \u2014  TUBE SECTION","SCALE 1:1")
    R=S['tube_od']*KB/2; Ri=(S['tube_od']-2*S['tube_wall'])*KB/2; Rc=S['core_od']*KB/2
    sh.hatch_poly([(bx-Ri,by-Ri),(bx+Ri,by-Ri),(bx+Ri,by+Ri),(bx-Ri,by+Ri)],45,1.6,"#c9b9a2")
    sh.circ(bx,by,R,W_VIS,INK)
    sh.circ(bx,by,Ri,W_THIN,INK)
    sh.circ(bx,by,Rc,W_VIS,INK,"#fff")
    sh.circ(bx,by,Rc+1.0,0.35,"#2c4a63")
    sh.ctr_h(bx-R-5,bx+R+5,by); sh.ctr_v(by-R-5,by+R+5,bx)
    sh.leader(bx+Rc*0.7,by-Rc*0.7,bx+R+9,by-26,DIA+f"{S['core_od']:.0f} CORE",fs=FS_S-0.6)
    sh.leader(bx+Rc+1.5,by+2,bx+R+9,by-14,"50 um MESH SLEEVE",fs=FS_S-0.6)
    sh.leader(bx-Ri*0.7,by+Ri*0.7,bx-R-10,by+R,
              f"MAXSORB III, {A['annulus']:.1f} ANNULUS",anchor="end",fs=FS_S-0.6)
    sh.dim_h(bx-R,bx+R,by+R+12,DIA+f"{S['tube_od']:.1f}",ext_from=(by+R,by+R))

    yT=sh.table(258,46,150,[("",0.60,"l"),("",0.40,"r")],
      [["carbon per tube",f"{D['m_c']/S['n_tube']:.2f} kg"],
       ["packed volume",f"{A['V_c']*1000:.1f} L"],["fill of available",f"{A['fill']*100:.0f} %"],
       ["annulus",f"{A['annulus']:.1f} mm"],["diffusion time",f"{A['t_diff']/60:.1f} min"],
       ["operating pressure",f"{D['p_op']:.1f} bar"],
       ["*stagnation design",f"*{PSTAG/1e5:.1f} bar"],
       ["hoop at stagnation",f"{HOOP/1e6:.1f} MPa"],
       ["*margin on SS 316L",f"*{S['S_allow']/HOOP:.1f} x"]],
      hdr=False,title="TUBE DATA",rh=4.8)
    sh.notes(258,yT+8,150,"NOTES",[
      "MATL: tubes and headers SS 316L. Absorber plate Cu, selective coating a 0.95 / e 0.10.",
      "STAGNATION IS THE DESIGN CASE. A solar collector will stagnate; at 150 C methanol reaches 14.0 bar.",
      "No pressure relief to atmosphere anywhere on this assembly. The tube contains stagnation instead.",
      "All joints TIG welded, full penetration. No threaded or elastomer joint on the wetted side.",
      "Bake carbon 200 C / 8 h under vacuum before filling; fill under dry nitrogen.",
      "Core perforation 2.0 dia, 30 % open, sleeved in 50 um mesh to retain fines.",
    ],fs=FS_S-0.55,lh=3.0)

    ty=150.0
    sh.text(150,ty,"DAILY SEQUENCE",FS_S+0.1,INK,"start","700",0.3)
    sh.line(150,ty+1.6,244,ty+1.6,0.35,INK)
    for i,(t_,lab,c) in enumerate([("08:00","sun on, isosteric heating A\u2192B",HOT),
                                   ("10:30","P reaches condenser, desorption B\u2192C",HOT),
                                   ("16:00","sun off, isosteric cooling C\u2192D",COLD),
                                   ("18:00","P falls to evaporator, adsorption D\u2192A",COLD),
                                   ("06:00","ice harvested, cycle repeats",DIM)]):
        yy=ty+8+i*7
        sh.rect(150,yy-3.2,2.4,4.4,0,"none",c)
        sh.text(156,yy,t_,FS_S-0.35,INK,"start","700")
        sh.text(172,yy,lab,FS_S-0.45,DIM,"start")

    sh.table(12,246,220,[("FEATURE",0.36,"l"),("NOMINAL",0.20,"c"),("TOL",0.18,"c"),("CRITICAL TO",0.26,"l")],
      [["Tube wall",f"{S['tube_wall']:.1f}","-0 / +0.15","stagnation containment"],
       ["Weld, tube to header","full penetration","100 % dye pen","hermeticity"],
       ["Absorber-to-tube bond","continuous","ultrasonic","collector efficiency"],
       ["Carbon mass per tube",f"{D['m_c']/S['n_tube']:.2f} kg","\u00b12 %","cycle capacity"]],
      title="CRITICAL CHARACTERISTICS",rh=5.0)
    emit(sh,"SI-101_adsorber-collector.svg")

# ══════════════════════════════════════════ SHEET 3
def sheet3():
    sh=Sheet("SI-102 / SI-103","CONDENSER AND RECEIVER","1:5",
             f"AIR-COOLED, NATURAL CONVECTION  /  {X['P_cd']:.0f} W MEAN  /  {X['A_cd']:.2f} m2")
    sh.sheet_of="3 / 6"
    K=0.20; x0,y0=34.0,60.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    CW,CH_,CD=E['cond_w'],E['cond_h'],E['cond_d']
    sh.view_label(px(CW/2),44,"CONDENSER  —  FRONT","SCALE 1:5")
    sh.rect(px(0),py(0),CW*K,CH_*K,W_VIS,INK,"#fff")
    for i in range(24):
        xx=px(14+i*28); sh.line(xx,py(10),xx,py(CH_-10),0.3,INK)
    for j in range(4):
        yy=py(30+j*90); sh.line(px(8),yy,px(CW-8),yy,W_VIS,"#8a5a1f")
    sh.leader(px(300),py(120),px(180),py(CH_)+26,"Cu TUBE 12 x 1, 4 PASS",fs=FS_S-0.5)
    sh.leader(px(210),py(200),px(180),py(CH_)+34,"Al FIN 0.2 @ 28 PITCH",fs=FS_S-0.5)
    sh.dim_h(px(0),px(CW),py(CH_)+18,f"{CW:.0f}",ext_from=(py(CH_),py(CH_)))
    sh.dim_v(py(0),py(CH_),px(0)-11,f"{CH_:.0f}",ext_from=(px(0),px(0)))
    sx=px(CW)+26; sy=py(0)
    sh.view_label(sx+CD*K/2,sy-12,"SIDE","1:5")
    sh.rect(sx,sy,CD*K,CH_*K,W_VIS,INK,"#fff"); sh.hatch(sx,sy,CD*K,CH_*K,45,1.6)
    sh.dim_h(sx,sx+CD*K,sy+CH_*K+10,f"{CD:.0f}",ext_from=(sy+CH_*K,sy+CH_*K))
    rx,ry=sx+CD*K+34,sy
    sh.view_label(rx+E['recv_od']*K/2,sy-12,"RECEIVER SI-103","1:5")
    sh.rect(rx,ry,E['recv_od']*K,E['recv_len']*K,W_VIS,INK,"#fff")
    sh.hatch(rx,ry,E['recv_od']*K,E['recv_len']*K,45,1.8)
    sh.rect(rx+1,ry+E['recv_len']*K*0.45,E['recv_od']*K-2,E['recv_len']*K*0.53,0,"none","#dfe9f2")
    sh.text(rx+E['recv_od']*K/2,ry+E['recv_len']*K*0.72,"CH3OH",FS_S-0.5,"#2c4a63","middle","600")
    sh.dim_v(ry,ry+E['recv_len']*K,rx+E['recv_od']*K+11,f"{E['recv_len']:.0f}",
             ext_from=(rx+E['recv_od']*K,rx+E['recv_od']*K))
    sh.dim_h(rx,rx+E['recv_od']*K,ry-7,DIA+f"{E['recv_od']:.0f}")
    sh.text(rx+E['recv_od']*K/2,ry+E['recv_len']*K+16,f"WORKING LEVEL {D['cycled']:.1f} kg",FS_S-0.55,DIM,"middle")

    y=sh.table(232,52,176,[("",0.62,"l"),("",0.38,"r")],
      [["condensing temperature",f"{S['T_cond']:.0f} C"],
       ["condensing pressure",f"{D['P_cd']/1000:.1f} kPa abs"],
       ["duty per day",f"{X['Q_cd']/1e6:.2f} MJ"],
       ["*mean power over 6 h",f"*{X['P_cd']:.0f} W"],
       ["air-side dT",f"{S['cond_dT']:.0f} K"],
       ["h, convection + radiation",f"{S['cond_h']:.0f} W/m2K"],
       ["*surface required",f"*{X['A_cd']:.2f} m2"],
       ["methanol condensed per day",f"{D['cycled']:.2f} kg"],
       ["receiver working volume","3.0 L"]],
      hdr=False,title="CONDENSER AND RECEIVER DATA",rh=4.8)
    sh.notes(232,y+8,176,"NOTES",[
      "No fan. The condenser works on buoyancy and radiation, so it must be shaded from the sun and free to draw air from below.",
      "Mount on the shaded side of the collector with 150 mm clear beneath and above.",
      "Receiver sits below the condenser and above the evaporator: the loop is gravity-driven, there is no pump.",
      "Cu tube to SS header joints brazed with BAg, then the whole assembly TIG welded into the envelope.",
      "Fin pitch 28 is coarse on purpose. Natural convection chokes below about 6 mm free spacing.",
      "Receiver has no sight glass and no drain. The charge is not serviceable in the field.",
    ],fs=FS_S-0.55,lh=3.0)
    sh.table(12,246,220,[("CHECK",0.40,"l"),("REQUIREMENT",0.32,"c"),("METHOD",0.28,"l")],
      [["Helium leak, whole assembly","< 1e-8 Pa.m3/s","mass spectrometer"],
       ["Proof pressure","21 bar, 5 min","hydrostatic, then dry"],
       ["Condenser orientation","tubes horizontal, drain to receiver","level check"],
       ["Shading","no direct sun on the fins","site survey"]],
      title="INSPECTION",rh=5.0)
    emit(sh,"SI-102_condenser-receiver.svg")

# ══════════════════════════════════════════ SHEET 4
def sheet4():
    sh=Sheet("SI-104","EVAPORATOR AND ICE BOX","1:5",
             f"{S['ice_day']:.0f} kg ICE PER NIGHT  /  {X['P_ev']:.0f} W MEAN  /  {S['box_ins']:.0f} mm PU")
    sh.sheet_of="4 / 6"
    K=0.20; x0,y0=48.0,72.0
    px=lambda v:x0+v*K; py=lambda v:y0+v*K
    BL,BW,BH,ti=S['box_L'],S['box_W'],S['box_H'],S['box_ins']
    sh.view_label(px(BL/2),46,"ICE BOX  —  SECTION","SCALE 1:5")
    sh.rect(px(-ti),py(-ti),(BL+2*ti)*K,(BH+2*ti)*K,W_VIS,INK,"#fff")
    sh.hatch(px(-ti),py(-ti),(BL+2*ti)*K,(BH+2*ti)*K,0,1.3,"#c8c2ae")
    sh.rect(px(0),py(0),BL*K,BH*K,W_VIS,INK,"#fff")
    sh.rect(px(0),py(BH*0.35),BL*K,BH*0.65*K,0,"none","#e3eef6")
    sh.text(px(BL/2),py(BH*0.78),"WATER / ICE",FS_S-0.4,"#2c4a63","middle","600")
    for i in range(6):
        xx=px(24+i*78)
        sh.rect(xx,py(BH*0.30),54*K,BH*0.62*K,W_THIN,"#2c4a63","#fff")
    sh.text(px(BL/2),py(BH*0.22),"6 x ICE TRAY",FS_S-0.5,DIM,"middle")
    ev=py(BH*0.30)-3
    sh.line(px(12),ev,px(BL-12),ev,1.6,COLD)
    for i in range(9):
        sh.circ(px(24+i*56),ev,1.6,0,COLD,COLD)
    sh.leader(px(BL*0.65),ev,px(BL+ti)+8,py(30),"EVAPORATOR, SS PLATE-COIL",fs=FS_S-0.5)
    sh.dim_h(px(-ti),px(BL+ti),py(BH+ti)+16,f"{BL+2*ti:.0f}",ext_from=(py(BH+ti),py(BH+ti)))
    sh.dim_h(px(0),px(BL),py(BH+ti)+7,f"{BL:.0f}",ext_from=(py(BH+ti),py(BH+ti)))
    sh.dim_v(py(-ti),py(BH+ti),px(-ti)-11,f"{BH+2*ti:.0f}",ext_from=(px(-ti),px(-ti)))
    sh.leader(px(-ti/2),py(BH*0.5),px(-ti)-6,py(BH*0.92),f"PU {ti:.0f}",anchor="end",fs=FS_S-0.55)

    py2=lambda v: py(BH+ti)+42+v*K
    sh.view_label(px(BL/2),py(BH+ti)+32,"PLAN  \u2014  LID REMOVED","SCALE 1:5")
    sh.rect(px(-ti),py2(-ti),(BL+2*ti)*K,(BW+2*ti)*K,W_VIS,INK,"#fff")
    sh.hatch(px(-ti),py2(-ti),(BL+2*ti)*K,(BW+2*ti)*K,0,1.3,"#c8c2ae")
    sh.rect(px(0),py2(0),BL*K,BW*K,W_VIS,INK,"#e3eef6")
    for i in range(6):
        sh.rect(px(24+i*78),py2(30),54*K,(BW-60)*K,W_THIN,"#2c4a63","#fff")
    for i in range(5):
        yy=py2(20+i*((BW-40)/4)); sh.line(px(10),yy,px(BL-10),yy,1.2,COLD)
    sh.dim_v(py2(-ti),py2(BW+ti),px(-ti)-11,f"{BW+2*ti:.0f}",ext_from=(px(-ti),px(-ti)))
    sh.leader(px(BL*0.5),py2(20),px(BL+ti)+8,py2(-10),"PLATE-COIL, 5 PASS",fs=FS_S-0.55)

    y=sh.table(232,54,176,[("",0.62,"l"),("",0.38,"r")],
      [["evaporating temperature",f"{S['T_evap']:.0f} C"],
       ["evaporating pressure",f"{D['P_ev']/1000:.2f} kPa abs"],
       ["cooling delivered per night",f"{S['ice_day']*D['q_ice']/1e6:.2f} MJ"],
       ["*mean power over 12 h",f"*{X['P_ev']:.0f} W"],
       ["*surface required",f"*{X['A_ev']*1e4:.0f} cm2"],
       ["box internal",f"{BL:.0f} x {BW:.0f} x {BH:.0f}"],
       ["insulation U",f"{X['U']:.2f} W/m2K"],
       ["heat leak at 30 C ambient",f"{X['Q_leak']:.0f} W"],
       ["*leak as share of the night",f"*{X['leak_frac']*100:.0f} %"]],
      hdr=False,title="EVAPORATOR AND BOX DATA",rh=4.8)
    sh.notes(232,y+8,176,"NOTES",[
      "The evaporator runs at 2.9 kPa absolute. It sees full external atmospheric pressure whenever the machine is cold - design it as a vacuum vessel, not a pressure vessel.",
      "Plate-coil in SS 316L, all welded, no fittings inside the box.",
      "Evaporator sits ABOVE the trays so liquid methanol drains back to the receiver by gravity when the machine warms.",
      "Secondary containment: the box is lined with a welded SS tray connected to the bund on SI-300. A leak must not reach the ice.",
      "The ice is NOT potable. Methanol is on the other side of one wall. Use the ice for cooling, not for drinks.",
      "80 mm PU gives a 15 % overnight leak, already inside the 5 kg figure.",
    ],fs=FS_S-0.55,lh=3.0)
    sh.table(12,246,220,[("CHECK",0.40,"l"),("REQUIREMENT",0.32,"c"),("METHOD",0.28,"l")],
      [["Evaporator external collapse","full vacuum, no set","1 bar external, 1 h"],
       ["Helium leak","< 1e-8 Pa.m3/s","mass spectrometer"],
       ["Containment tray","welded, drains to bund","water fill test"],
       ["Box heat leak","<= 10 W at 30 C","calibrated pull-down"]],
      title="INSPECTION",rh=5.0)
    emit(sh,"SI-104_evaporator-icebox.svg")

# ══════════════════════════════════════════ SHEET 5
def sheet5():
    sh=Sheet("SI-200","VACUUM AND CHARGING","NONE",
             f"{D['charge']:.1f} kg METHANOL  /  ONE-TIME PERMANENT CHARGE  /  NO FIELD SERVICE")
    sh.sheet_of="5 / 6"
    sh.rect(12,30,396,11,0.7,HOT,"#fbf1f1")
    sh.text(210,37.6,"CHARGING IS THE MOST DANGEROUS OPERATION IN THE LIFE OF THIS MACHINE — "
            "OUTDOORS, TRAINED OPERATOR, NO IGNITION SOURCE",FS_S+0.1,HOT,"middle","700",0.2)
    steps=[("1","WELD OUT","Complete every wetted joint. No threaded or elastomer joint remains.",""),
      ("2","PROOF PRESSURE","Hydrostatic 21 bar, 5 min. Drain, dry with warm dry nitrogen.","1.5 x stagnation"),
      ("3","LEAK TEST","Helium mass spectrometer under vacuum on the whole envelope.","< 1e-8 Pa.m3/s"),
      ("4","BAKE-OUT","200 C / 8 h at < 1 Pa through the charge tube, pumping throughout.","carbon outgasses"),
      ("5","COOL UNDER VACUUM","Let the bed reach ambient still under the pump. Do not vent.","no air, ever"),
      ("6","CHARGE",f"Admit {D['charge']:.1f} kg anhydrous methanol by WEIGHT from a sealed burette.","by mass, not volume"),
      ("7","DEGAS","Freeze-pump-thaw x3 on the receiver. Final pump to < 50 Pa at 0 C.","removes dissolved air"),
      ("8","PINCH-OFF","Cold-weld the charge tube, cut, then TIG cap the stub.","permanent"),
      ("9","LEAK TEST 2","Helium bomb 3 bar / 4 h, then mass spectrometer.","< 1e-8 Pa.m3/s"),
      ("10","FIRST CYCLE","One full solar cycle under observation. Record bed and receiver temperatures.","commissioning")]
    X0=16.0; y=48.0; BW_=196.0; RH=13.2
    sh.view_label(X0+BW_/2,44,"CHARGING SEQUENCE","EVERY STEP, IN ORDER")
    for i,(n,ttl,body,tag) in enumerate(steps):
        crit=n in ("4","5","6","8")
        rsq(sh,X0,y,BW_,RH-2.2,1.2,W_VIS,INK,"#fbf1f1" if crit else "#fff")
        sh.rect(X0,y,5.5,RH-2.2,0,"none",HOT if crit else "#8fa2b3")
        sh.text(X0+2.75,y+7.0,n,FS_S-0.5,"#ffffff","middle","700")
        sh.text(X0+8.5,y+4.6,ttl,FS_S,INK,"start","700",0.3)
        sh.text(X0+8.5,y+9.2,body,FS_S-0.65,DIM,"start")
        if tag: sh.text(X0+BW_-2.5,y+4.6,tag,FS_S-0.7,HOT if crit else "#2c4a63","end","600")
        if i<len(steps)-1:
            sh.line(X0+BW_/2,y+RH-2.2,X0+BW_/2,y+RH,W_DIM,DIM); sh._arrow(X0+BW_/2,y+RH+0.4,90,DIM)
        y+=RH
    X2=222.0; WD=186.0
    sh.view_label(X2+WD/2,44,"CHARGING RIG","SCHEMATIC")
    bx=X2+6; by=52.0
    nodes=[("METHANOL\nBURETTE",bx,by,"#dfe9f2"),("COLD TRAP\nLN2 / dry ice",bx+64,by,"#e7f0f6"),
           ("VACUUM PUMP\n2-stage rotary",bx+128,by,"#eef2f6")]
    for lab,xx,yy,c in nodes:
        rsq(sh,xx,yy,52,22,2,W_VIS,INK,c)
        for k,ln in enumerate(lab.split("\n")):
            sh.text(xx+26,yy+9+k*6,ln,FS_S-0.6,INK,"middle","700" if k==0 else "400")
    rsq(sh,bx+48,by+40,60,20,2,W_VIS,HOT,"#fbf1f1")
    sh.text(bx+78,by+52,"SI-100 MACHINE",FS_S-0.5,HOT,"middle","700")
    for a,b in [((bx+52,by+11),(bx+64,by+11)),((bx+116,by+11),(bx+128,by+11))]:
        sh.line(a[0],a[1],b[0],b[1],W_VIS,DIM); sh._arrow(b[0],b[1],0,DIM)
    sh.line(bx+78,by+22,bx+78,by+40,W_VIS,DIM); sh._arrow(bx+78,by+40,90,DIM)
    sh.text(bx,by+70,"The cold trap protects the pump and, more importantly, stops methanol",FS_S-0.55,DIM,"start")
    sh.text(bx,by+75,"vapour reaching the exhaust. Vent the pump outdoors, downwind.",FS_S-0.55,INK,"start","600")
    y2=sh.table(X2,by+86,WD,[("PARAMETER",0.46,"l"),("VALUE",0.30,"c"),("LIMIT",0.24,"r")],
      [["*Methanol charge",f"*{D['charge']:.2f} kg","*by weight, ±1 %"],
       ["Purity","anhydrous > 99.8 %","water poisons the carbon"],
       ["Bake-out","200 C / 8 h","< 1 Pa"],
       ["Final vacuum before seal","< 50 Pa","at 0 C"],
       ["Proof pressure","21 bar","1.5 x stagnation"],
       ["*Leak rate","*< 1e-8 Pa.m3/s","*helium, twice"],
       ["Seal","cold-weld + TIG cap","no valve, no port"]],
      title="CHARGING PARAMETERS",rh=5.2)
    sh.notes(X2,y2+8,WD,"PROHIBITED",[
      "Venting the envelope to air at any point after bake-out. Air in the bed is non-condensable gas and it never comes out again.",
      "Charging by volume. Methanol expands 1.2 % per 10 K; the charge is a mass specification.",
      "Any valve, gauge port or sight glass left on the wetted envelope. Every one is a leak path for the life of the machine.",
      "Charging indoors, or anywhere without free ventilation and no ignition source within 5 m.",
    ],fs=FS_S-0.5,lh=3.3,num=False)
    emit(sh,"SI-200_vacuum-charging.svg")

# ══════════════════════════════════════════ SHEET 6
def sheet6():
    sh=Sheet("SI-300","SAFETY, MARKING AND COMMISSIONING","NONE",
             f"OUTDOOR OFF-GRID EQUIPMENT  /  {D['charge']:.1f} kg METHANOL  /  NOT A DOMESTIC APPLIANCE")
    sh.sheet_of="6 / 6"
    sh.rect(12,30,396,20,0.9,HOT,"#fbf1f1")
    sh.text(210,39,"THIS IS NOT A CERTIFIABLE DOMESTIC APPLIANCE",FS+1.4,HOT,"middle","700",0.4)
    sh.text(210,46.5,"Methanol has no ASHRAE refrigerant designation for this service and grades as both toxic and "
            "highly flammable. There is no path to IEC 60335-2-40 approval for indoor use.",FS_S-0.3,HOT,"middle")
    y=sh.table(16,58,196,[("PROPERTY",0.42,"l"),("VALUE",0.34,"c"),("CONSEQUENCE",0.24,"r")],
      [["*Charge",f"*{D['charge']:.1f} kg methanol","*outdoor only"],
       ["Flash point","11 C closed cup","below ambient"],
       ["Flammable range","6 – 36 % in air","unusually wide"],
       ["Flame","nearly invisible in daylight","cannot be seen"],
       ["Acute toxicity","10 mL blinds, 30 mL can kill","skin absorbs it"],
       ["Occupational limit","200 ppm TWA","low"],
       ["Operating pressure",f"{D['p_op']:.1f} bar at {S['T_des']:.0f} C","vessel, not plumbing"],
       ["*Stagnation pressure",f"*{PSTAG/1e5:.1f} bar at {S['T_stag']:.0f} C","*the design case"]],
      title="HAZARD DATA")
    y=sh.notes(16,y+8,196,"DESIGN CONSEQUENCES ALREADY BUILT IN",[
      "All-welded SS 316L and copper envelope. No elastomer, no thread, no service port anywhere wetted.",
      "One-time permanent charge, sealed by cold-weld pinch-off and a welded cap. The machine is replaced, never opened.",
      "No pressure relief to atmosphere. The tubular adsorber contains stagnation at 4.9 x margin instead of venting methanol.",
      "Welded stainless containment tray under the evaporator, receiver and condenser, drained to a bund sized for the whole charge.",
      "Ice box lined and sealed: a leak cannot reach the ice. The ice is not potable in any case.",
    ],fs=FS_S-0.5,lh=3.3,num=False)
    X2=222.0; WD=186.0
    sh.view_label(X2+WD/2,62,"REQUIRED MARKING","ON THE VESSEL AND THE FRAME")
    bx,by=X2+18,72.0
    rsq(sh,bx,by,150,62,3,0.8,HOT,"#fff")
    sh.poly([(bx+22,by+8),(bx+38,by+36),(bx+6,by+36)],1.2,HOT,"#fbf1f1",close=True)
    sh.text(bx+22,by+32,"!",FS+2,HOT,"middle","700")
    sh.text(bx+46,by+15,"METHANOL  CH3OH",FS_S+0.6,HOT,"start","700",0.3)
    sh.text(bx+46,by+23,f"{D['charge']:.1f} kg  —  TOXIC, FLAMMABLE",FS_S-0.2,INK,"start","600")
    sh.text(bx+46,by+30,"INVISIBLE FLAME",FS_S-0.3,HOT,"start","600")
    sh.text(bx+6,by+45,"OUTDOOR USE ONLY  ·  DO NOT OPEN  ·  DO NOT VENT",FS_S-0.35,INK,"start","600")
    sh.text(bx+6,by+53,"ICE NOT POTABLE  ·  NO IGNITION SOURCE WITHIN 5 m",FS_S-0.35,INK,"start","600")
    y2=sh.table(X2,146,WD,[("STEP",0.10,"c"),("COMMISSIONING",0.56,"l"),("RECORD",0.34,"r")],
      [["1","Site: outdoors, level, free air, 5 m from ignition","site sheet"],
       ["2","Confirm bund and tray drain clear","visual"],
       ["3","Leak test 2 witnessed before first sun","He, < 1e-8"],
       ["4","First solar cycle observed end to end","T bed, T receiver"],
       ["5","Confirm condenser drains fully to the receiver","no hold-up"],
       ["6","Measure ice after night one","kg, vs 5 kg target"],
       ["7","Record stagnation temperature on a no-load day","T max"]],
      title="COMMISSIONING")
    sh.notes(X2,y2+8,WD,"IF THE MACHINE IS DAMAGED",[
      "Do not approach a suspected leak with any ignition source. The flame is invisible in daylight; use a thermal camera or a broom handle.",
      "Methanol vapour is heavier than air near the source and pools in the bund. Ventilate from upwind.",
      "Do not attempt to recover the charge. Isolate the machine, let it weather in open air, and dispose of the carbon and vessel through a chemical waste route.",
      "A machine that has been vented to atmosphere is finished as a machine: air in the bed cannot be pumped out in the field.",
    ],fs=FS_S-0.5,lh=3.3,num=False)
    sh.table(16,242,196,[("",0.58,"l"),("",0.42,"r")],
      [["Designed output",f"{S['ice_day']:.0f} kg ice / day"],
       ["Solar COP",f"{D['solar_cop']:.3f}"],
       ["Collector",f"{S['A_coll']:.1f} m2"],
       ["Total mass, charged",f"{MTOT:.0f} kg"],
       ["*Certification status","*NONE — demonstrator"]],
      hdr=False,title="MACHINE SUMMARY",rh=4.8)
    emit(sh,"SI-300_safety-commissioning.svg")

if __name__=="__main__":
    print("generating ->",OUT)
    sheet1(); sheet2(); sheet3(); sheet4(); sheet5(); sheet6()
