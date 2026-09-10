#!/usr/bin/env python3
"""Compose the CP-100 transient solve into an animation (APNG + GIF)."""
import os, sys, math, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from viz_common import thermal_ramp, SERIES_LIGHT, hx

HERE=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(HERE,"out")
D=np.load(os.path.join(OUT,"frames.npz"), allow_pickle=True)
T,Tc,ts,Tdie,Pw,LPM,Qrem,Tout = (D["T"],D["Tc"],D["t"],D["Tdie"],D["P"],D["lpm"],D["Qrem"],D["Tout"])
labels=D["labels"]; tr=D["trace"]
NX,NY,dx,PL,PW,PX0,PY0,FX0,FX1,FY0,FY1,DIE,TIN,CTOT = D["meta"]
NX,NY=int(NX),int(NY)

FD="/usr/share/fonts/truetype/dejavu/"
def F(sz,b=False):
    p=FD+("DejaVuSans-Bold.ttf" if b else "DejaVuSans.ttf")
    try: return ImageFont.truetype(p,sz)
    except Exception: return ImageFont.load_default()
f10,f11,f12,f13,f16,f22,f34 = F(10),F(11),F(12),F(13,True),F(16,True),F(22,True),F(34,True)

INK="#12181f"; SEC="#4b5d6b"; MUT="#8496a3"; GRID="#dde4ea"; SURF="#fcfcfb"; PANEL="#f2f5f7"
RAMP=thermal_ramp(256)
LUT=np.array(RAMP,dtype=np.uint8)
VMIN,VMAX = float(TIN), 120.0                 # fixed scale across the whole run
SC=3                                           # px per cell
FW,FH = NX*SC, NY*SC
W,H = 1010, 664
FX,FY = 34, 84                                 # field origin on canvas

def mm2px(v): return int(round(v/dx*SC))

LEVELS=list(range(50,141,5))
_LUMW=np.array([0.2126,0.7152,0.0722])

def field_img(Tf):
    """Sequential fill + iso-contours every 5 K, so the field stays readable
    at both ends of a scale that has to span the fault."""
    n=np.clip((Tf-VMIN)/(VMAX-VMIN),0,1)
    rgb=LUT[(n*255).astype(np.uint8)].astype(np.float32)     # (NX,NY,3)
    edge=np.zeros(Tf.shape,bool)
    for lv in LEVELS:
        m=Tf>lv
        if not m.any() or m.all(): continue
        e=np.zeros_like(m)
        e[1:,:]|=m[1:,:]^m[:-1,:]; e[:,1:]|=m[:,1:]^m[:,:-1]
        edge|=e
    if edge.any():
        lum=(rgb/255.0)@_LUMW
        ink=np.where(lum[...,None]>0.55,
                     np.array([18,24,31],np.float32),
                     np.array([255,255,255],np.float32))
        rgb[edge]=(0.55*rgb+0.45*ink)[edge]
    im=Image.fromarray(np.transpose(rgb.astype(np.uint8),(1,0,2)),"RGB")
    return im.resize((FW,FH),Image.NEAREST)

def draw_frame(k):
    im=Image.new("RGB",(W,H),SURF); d=ImageDraw.Draw(im)
    # ---------- header
    d.rectangle([0,0,W,68],fill="#12181f")
    d.text((24,14),"CP-100  DIRECT-TO-CHIP COLD PLATE",font=f16,fill="#ffffff")
    d.text((24,40),"2D transient conjugate solve  ·  H100 SXM5  ·  PG25 / 45 °C in",font=f11,fill="#9db0bd")
    lab=str(labels[k]); fault = "FLOW LOSS" in lab
    cw=d.textlength(lab,font=f13)+22
    d.rounded_rectangle([W-24-cw,18,W-24,44],6,fill="#8a2f2f" if fault else "#1b5e8c")
    d.text((W-24-cw/2,25),lab,font=f13,fill="#ffffff",anchor="ma")
    d.text((W-24,50),f"t = {ts[k]:5.2f} s",font=f12,fill="#9db0bd",anchor="ra")
    # ---------- field
    im.paste(field_img(T[k]),(FX,FY))
    def R(x0,y0,x1,y1,**kw): d.rectangle([FX+mm2px(x0),FY+mm2px(y0),FX+mm2px(x1),FY+mm2px(y1)],**kw)
    PLEN=float(FX0-PX0)
    R(FX0-PLEN,PY0,FX1+PLEN,FY1,outline="#5b6b78",width=1)
    R(FX0,FY0,FX1,FY1,outline="#2c3e4c",width=2)
    dc0,dc1=(PL-DIE)/2,(PL+DIE)/2; dr0,dr1=(PW-DIE)/2,(PW+DIE)/2
    R(dc0,dr0,dc1,dr1,outline="#ffffff",width=2)
    _t="GH100 DIE 28.5 sq"; _w=d.textlength(_t,font=f10)
    _cx,_cy=FX+mm2px(PL/2),FY+mm2px(dr0)-16
    d.rounded_rectangle([_cx-_w/2-6,_cy-2,_cx+_w/2+6,_cy+14],4,fill="#12181f")
    d.text((_cx,_cy+1),_t,font=f10,fill="#ffffff",anchor="ma")
    # flow arrows
    for j in range(5):
        yy=FY+mm2px(FY0+8+j*8.5)
        x0,x1=FX+mm2px(FX0+3),FX+mm2px(FX1-3)
        d.line([x0,yy,x1,yy],fill="#ffffff",width=1)
        d.polygon([(x1,yy),(x1-7,yy-3),(x1-7,yy+3)],fill="#ffffff")
    d.text((FX+mm2px(PX0+3.5),FY+mm2px(PW/2)-7),"IN",font=f11,fill="#12181f",anchor="mm")
    d.text((FX+mm2px(FX1+3.5),FY+mm2px(PW/2)-7),"OUT",font=f11,fill="#12181f",anchor="mm")
    d.rectangle([FX,FY,FX+FW,FY+FH],outline="#9aa9b5",width=1)
    # ---------- colour bar
    cby=FY+FH+22; cbw=FW
    for i in range(cbw):
        c=RAMP[int(i/(cbw-1)*255)]
        d.line([FX+i,cby,FX+i,cby+16],fill=c)
    d.rectangle([FX,cby,FX+cbw,cby+16],outline="#9aa9b5",width=1)
    for v in (45,60,75,90,105,120):
        xx=FX+int((v-VMIN)/(VMAX-VMIN)*cbw)
        d.line([xx,cby+16,xx,cby+21],fill=MUT,width=1)
        d.text((xx,cby+24),f"{v}",font=f10,fill=SEC,anchor="ma")
    d.text((FX,cby+38),"plate temperature  °C   ·   scale fixed 45–120 across the whole run   ·   iso-contours every 5 K",font=f10,fill=MUT)
    # ---------- readouts
    PX=FX+FW+30; pw=W-PX-24
    d.rounded_rectangle([PX,FY,PX+pw,FY+112],8,fill=PANEL)
    d.text((PX+16,FY+12),"GH100 DIE",font=f11,fill=SEC)
    col="#8a2f2f" if Tdie[k]>=90 else INK
    d.text((PX+16,FY+26),f"{Tdie[k]:.1f}",font=f34,fill=col)
    d.text((PX+16+d.textlength(f'{Tdie[k]:.1f}',font=f34)+6,FY+44),"°C",font=f16,fill=SEC)
    if Tdie[k]>=90:
        d.text((PX+16,FY+74),"ABOVE 90 °C THROTTLE LIMIT",font=f11,fill="#8a2f2f")
    else:
        d.text((PX+16,FY+74),f"{90-Tdie[k]:.1f} K to the 90 °C throttle limit",font=f11,fill=SEC)
    d.text((PX+16,FY+90),f"steady design point 63.1 °C  (spec 66 °C)",font=f10,fill=MUT)
    rows=[("power in",f"{Pw[k]:.0f} W"),
          ("coolant flow",f"{LPM[k]:.2f} L/min" if LPM[k]>0 else "0 — STAGNANT"),
          ("removed by coolant",f"{Qrem[k]:.0f} W"),
          ("into the metal",f"{Pw[k]-Qrem[k]:+.0f} W"),
          ("coolant out",f"{Tout[k]:.1f} °C"),
          ("plate max",f"{T[k].max():.1f} °C")]
    yy=FY+126
    for i,(a,b) in enumerate(rows):
        if i%2==0: d.rectangle([PX,yy-3,PX+pw,yy+15],fill="#f7f9fa")
        d.text((PX+4,yy),a,font=f11,fill=SEC)
        d.text((PX+pw-4,yy),b,font=f12,fill=INK,anchor="ra")
        yy+=18
    # ---------- trace plot
    gx0,gx1=PX+34,PX+pw-58; gy0,gy1=yy+40,H-78
    tmin,tmax=0.0,float(ts[-1]); ymin,ymax=40.0,145.0
    def sx(t): return gx0+(t-tmin)/(tmax-tmin)*(gx1-gx0)
    def sy(v): return gy1-(v-ymin)/(ymax-ymin)*(gy1-gy0)
    d.text((PX,gy0-30),"TEMPERATURE  vs  TIME",font=f11,fill=INK)
    lg=PX
    for nm,c in zip(("die","plate under die","coolant out"),SERIES_LIGHT):
        d.rectangle([lg,gy0-16,lg+9,gy0-10],fill=c)
        d.text((lg+13,gy0-19),nm,font=f10,fill=SEC); lg+=int(d.textlength(nm,font=f10))+30
    # scenario bands
    segs=[(0,1.5,"#dfe7ec"),(1.5,5.0,"#cfe0ee"),(5.0,9.0,"#f2dede"),(9.0,tmax,"#cfe0ee")]
    for a,b,c in segs: d.rectangle([sx(a),gy0-4,sx(b),gy0+2],fill=c)
    for v in (60,90,120):
        d.line([gx0,sy(v),gx1,sy(v)],fill=GRID,width=1)
        d.text((gx0-6,sy(v)-6),f"{v}",font=f10,fill=MUT,anchor="ra")
    d.line([gx0,sy(90),gx1,sy(90)],fill="#c99",width=1)
    d.text((gx1+4,sy(90)-6),"90 °C",font=f10,fill="#8a2f2f")
    d.line([gx0,gy1,gx1,gy1],fill="#b9c4cd",width=1)
    for v in (0,3,6,9,12):
        d.text((sx(v),gy1+5),f"{v}",font=f10,fill=MUT,anchor="ma")
    d.text(((gx0+gx1)/2,gy1+20),"seconds",font=f10,fill=MUT,anchor="ma")
    # direct labels: de-collide by pushing apart when the values are close
    ends=sorted([(sy(tr[k,1+si]),si) for si in range(3)])
    placed=[]
    for yv,si in ends:
        while placed and abs(yv-placed[-1])<13: yv=placed[-1]+13
        placed.append(yv)
    lblpos={si:yv for yv,(_,si) in zip(placed,ends)}
    for si,c in enumerate(SERIES_LIGHT):
        pts=[(sx(tr[i,0]),sy(tr[i,1+si])) for i in range(k+1)]
        if len(pts)>1: d.line(pts,fill=c,width=2,joint="curve")
        if pts:
            d.ellipse([pts[-1][0]-4,pts[-1][1]-4,pts[-1][0]+4,pts[-1][1]+4],fill=c,outline=SURF,width=2)
            ly=lblpos[si]
            if abs(ly-pts[-1][1])>2: d.line([gx1+3,pts[-1][1],gx1+7,ly],fill=c,width=1)
            d.text((gx1+9,ly-6),f"{tr[k,1+si]:.0f}",font=f11,fill=c)
    d.line([sx(ts[k]),gy0-6,sx(ts[k]),gy1],fill="#8496a3",width=1)
    # ---------- footer
    d.line([24,H-46,W-24,H-46],fill=GRID,width=1)
    d.text((24,H-38),"Finite-difference conjugate solve on a 152 × 144 grid at 0.5 mm. Channel-side heat transfer "
           "from the validated 1D correlation, applied as a distributed sink; coolant marched along x.",font=f10,fill=MUT)
    d.text((24,H-24),"Not CFD — no resolved channel flow field. Energy closes to 1.3 % at steady state. "
           "Fault segment is a demonstration: a real GPU trips long before 139 °C.",font=f10,fill=MUT)
    return im

if __name__=="__main__":
    step=int(sys.argv[1]) if len(sys.argv)>1 else 2
    ks=list(range(0,len(ts),step))
    print(f"rendering {len(ks)} frames ...")
    imgs=[draw_frame(k) for k in ks]
    imgs[0].save(os.path.join(OUT,"cp100_transient.png"),save_all=True,
                 append_images=imgs[1:],duration=60,loop=0,disposal=1)
    p=os.path.join(OUT,"cp100_transient.png")
    print("APNG:",p,f"{os.path.getsize(p)/1e6:.2f} MB")
    sm=[im.resize((W//2,H//2),Image.LANCZOS).convert("P",palette=Image.ADAPTIVE,colors=200) for im in imgs]
    g=os.path.join(OUT,"cp100_transient.gif")
    sm[0].save(g,save_all=True,append_images=sm[1:],duration=60,loop=0,optimize=True)
    print("GIF :",g,f"{os.path.getsize(g)/1e6:.2f} MB")
    imgs[len(imgs)//3].save(os.path.join(OUT,"still_load.png"))
    imgs[int(len(imgs)*0.62)].save(os.path.join(OUT,"still_fault.png"))
