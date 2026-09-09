#!/usr/bin/env python3
"""Minimal but real technical-drafting primitives -> SVG (ISO-A3, mm units)."""
import math

FS   = 3.0          # standard text height (mm)
FS_S = 2.3          # small text
ARR  = 2.2          # arrowhead length
FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif"

INK, DIM, THIN, HATCH, CTR = "#12181f", "#3c4a57", "#6b7a89", "#aab6c2", "#7a8fa3"
W_VIS, W_HID, W_DIM, W_CTR, W_THIN = 0.50, 0.30, 0.18, 0.16, 0.22

def esc(t): return (str(t).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))

class Sheet:
    """A3 landscape 420x297 mm."""
    W, H = 420.0, 297.0
    M    = 8.0
    def __init__(self, number, title, scale="1:1", sub=""):
        self.n, self.t, self.sc, self.sub = number, title, scale, sub
        self.b = []
        self.rect(0,0,self.W,self.H,0,"none","#ffffff")
    # ---------------------------------------------------------- raw
    def raw(self, s): self.b.append(s); return self
    def line(self, x1,y1,x2,y2, w=W_VIS, c=INK, dash=None, cap="round"):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        return self.raw(f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" '
                        f'stroke="{c}" stroke-width="{w}" stroke-linecap="{cap}"{d}/>')
    def rect(self, x,y,w,h, sw=W_VIS, c=INK, fill="none", r=0, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        return self.raw(f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" rx="{r}" '
                        f'fill="{fill}" stroke="{c}" stroke-width="{sw}"{d}/>')
    def circ(self, cx,cy,r, sw=W_VIS, c=INK, fill="none", dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        return self.raw(f'<circle cx="{cx:.3f}" cy="{cy:.3f}" r="{r:.3f}" fill="{fill}" '
                        f'stroke="{c}" stroke-width="{sw}"{d}/>')
    def poly(self, pts, sw=W_VIS, c=INK, fill="none", close=False, dash=None):
        p = " ".join(f"{x:.3f},{y:.3f}" for x,y in pts)
        tag = "polygon" if close else "polyline"
        d = f' stroke-dasharray="{dash}"' if dash else ''
        return self.raw(f'<{tag} points="{p}" fill="{fill}" stroke="{c}" '
                        f'stroke-width="{sw}" stroke-linejoin="round"{d}/>')
    def text(self, x,y,s, fs=FS, c=INK, anchor="start", weight="400", ls=0, rot=None, mono=False):
        f = "'SFMono-Regular',Menlo,Consolas,monospace" if mono else FONT
        r = f' transform="rotate({rot} {x:.2f} {y:.2f})"' if rot is not None else ''
        return self.raw(f'<text x="{x:.3f}" y="{y:.3f}" font-family="{f}" font-size="{fs}" '
                        f'fill="{c}" text-anchor="{anchor}" font-weight="{weight}" '
                        f'letter-spacing="{ls}"{r}>{esc(s)}</text>')
    # ---------------------------------------------------------- drafting
    def ctr_h(self, x1,x2,y, c=CTR): return self.line(x1,y,x2,y,W_CTR,c,"6 1.5 1 1.5")
    def ctr_v(self, y1,y2,x, c=CTR): return self.line(x,y1,x,y2,W_CTR,c,"6 1.5 1 1.5")
    def _arrow(self, x,y,ang,c=DIM):
        a=math.radians(ang); w=ARR*0.30
        p=[(x,y),(x-ARR*math.cos(a)-w*math.sin(a), y-ARR*math.sin(a)+w*math.cos(a)),
                 (x-ARR*math.cos(a)+w*math.sin(a), y-ARR*math.sin(a)-w*math.cos(a))]
        return self.poly(p,0,c,fill=c,close=True)
    def _tbox(self, x,y,s,fs,anchor="middle",c=DIM):
        w=len(str(s))*fs*0.56+1.4
        dx={"middle":-w/2,"start":-0.7,"end":-w+0.7}[anchor]
        self.rect(x+dx,y-fs*0.80,w,fs*1.15,0,"none","#ffffff")
        return self.text(x,y,s,fs,c,anchor)
    def dim_h(self, x1,x2,y, s, ext_from=None, fs=FS_S, c=DIM, out=False):
        """Horizontal dimension. ext_from=(y_a,y_b) start of extension lines."""
        if ext_from:
            for x in (x1,x2):
                ya,yb = ext_from
                self.line(x, ya + (1.0 if y>ya else -1.0), x, y+(1.6 if y>ya else -1.6), W_DIM, THIN)
        if out:
            self.line(x1-6,y,x2+6,y,W_DIM,c)
            self._arrow(x1,y,180,c); self._arrow(x2,y,0,c)
        else:
            self.line(x1,y,x2,y,W_DIM,c)
            self._arrow(x1,y,0,c); self._arrow(x2,y,180,c)
        self._tbox((x1+x2)/2, y-1.1, s, fs, "middle", c); return self
    def dim_v(self, y1,y2,x, s, ext_from=None, fs=FS_S, c=DIM, out=False):
        if ext_from:
            for y in (y1,y2):
                xa,xb = ext_from
                self.line(xa+(1.0 if x>xa else -1.0), y, x+(1.6 if x>xa else -1.6), y, W_DIM, THIN)
        if out:
            self.line(x,y1-6,x,y2+6,W_DIM,c)
            self._arrow(x,y1,270,c); self._arrow(x,y2,90,c)
        else:
            self.line(x,y1,x,y2,W_DIM,c)
            self._arrow(x,y1,90,c); self._arrow(x,y2,270,c)
        self.raw(f'<g transform="rotate(-90 {x-1.1:.2f} {(y1+y2)/2:.2f})">')
        self._tbox(x-1.1,(y1+y2)/2, s, fs, "middle", c)
        return self.raw('</g>')
    def leader(self, px,py, tx,ty, s, fs=FS_S, c=DIM, anchor=None, dot=False):
        """Leader from feature point (px,py) to text at (tx,ty)."""
        elbow = 3.0 if tx>px else -3.0
        self.poly([(px,py),(tx-elbow,ty+1.0),(tx,ty+1.0)],W_DIM,c)
        ang = math.degrees(math.atan2(py-(ty+1.0), px-(tx-elbow)))
        self._arrow(px,py,ang+180,c)
        if dot: self.circ(px,py,0.5,0,c,fill=c)
        a = anchor or ("start" if tx>px else "end")
        off = 0.8 if a=="start" else -0.8
        return self.text(tx+off,ty,s,fs,c,a)
    def balloon(self, x,y, n, px=None,py=None, r=3.4):
        if px is not None:
            self.poly([(px,py),(x,y)],W_DIM,DIM); self.circ(px,py,0.55,0,DIM,fill=DIM)
        self.circ(x,y,r,W_DIM,INK,fill="#ffffff")
        return self.text(x,y+1.05,n,FS_S,INK,"middle","600")
    def hatch(self, x,y,w,h, angle=45, pitch=1.2, c=HATCH, sw=0.16):
        gid=f"h{len(self.b)}"
        self.raw(f'<pattern id="{gid}" patternUnits="userSpaceOnUse" width="{pitch}" '
                 f'height="{pitch}" patternTransform="rotate({angle})">'
                 f'<line x1="0" y1="0" x2="0" y2="{pitch}" stroke="{c}" stroke-width="{sw}"/></pattern>')
        return self.rect(x,y,w,h,0,"none",f"url(#{gid})")
    def hatch_poly(self, pts, angle=45, pitch=1.2, c=HATCH, sw=0.16):
        gid=f"h{len(self.b)}"
        self.raw(f'<pattern id="{gid}" patternUnits="userSpaceOnUse" width="{pitch}" '
                 f'height="{pitch}" patternTransform="rotate({angle})">'
                 f'<line x1="0" y1="0" x2="0" y2="{pitch}" stroke="{c}" stroke-width="{sw}"/></pattern>')
        p=" ".join(f"{x:.3f},{y:.3f}" for x,y in pts)
        return self.raw(f'<polygon points="{p}" fill="url(#{gid})" stroke="none"/>')
    def view_label(self, x,y, s, sub=""):
        self.text(x,y,s,FS+0.6,INK,"middle","700",0.4)
        if sub: self.text(x,y+5.6,sub,FS_S-0.2,DIM,"middle")
        self.line(x-len(s)*1.05,y+1.3,x+len(s)*1.05,y+1.3,0.35,INK)
        return self
    def section_mark(self, x,y, letter, dirn="down", size=5.0):
        dx,dy = (0,size) if dirn=="down" else ((0,-size) if dirn=="up" else ((size,0) if dirn=="right" else (-size,0)))
        self.line(x,y,x+dx*0.55,y+dy*0.55,0.7,INK)
        self._arrow(x+dx,y+dy, math.degrees(math.atan2(dy,dx)), INK)
        self.text(x - (5.5 if dirn in("down","up") else 0), y - (0 if dirn in("down","up") else 5.5),
                  letter, FS+0.4, INK, "middle","700")
        return self
    def detail_circle(self, cx,cy,r, letter, lx=None,ly=None):
        self.circ(cx,cy,r,0.30,INK,dash="3 2")
        lx = lx if lx is not None else cx+r*0.75
        ly = ly if ly is not None else cy-r*0.80
        self.text(lx,ly,letter,FS+0.6,INK,"middle","700")
        return self
    def table(self, x,y,w, cols, rows, hdr=True, rh=5.4, fs=FS_S, title=None, zebra=True):
        """cols = [(label, width_frac, align)]"""
        y0=y
        if title:
            self.rect(x,y,w,rh,W_THIN,INK,"#eef2f6")
            self.text(x+1.6,y+rh*0.70,title,fs,INK,"start","700",0.3); y+=rh
        if hdr:
            self.rect(x,y,w,rh,W_THIN,INK,"#f5f7f9")
            cx=x
            for lab,fr,al in cols:
                cw=w*fr
                tx={"l":cx+1.4,"c":cx+cw/2,"r":cx+cw-1.4}[al]
                an={"l":"start","c":"middle","r":"end"}[al]
                self.text(tx,y+rh*0.70,lab,fs-0.15,INK,an,"700")
                cx+=cw
                if cx<x+w-0.01: self.line(cx,y,cx,y+rh,W_THIN,THIN)
            y+=rh
        for i,r in enumerate(rows):
            if zebra and i%2: self.rect(x,y,w,rh,0,"none","#fafbfc")
            cx=x
            for (lab,fr,al),v in zip(cols,r):
                cw=w*fr
                tx={"l":cx+1.4,"c":cx+cw/2,"r":cx+cw-1.4}[al]
                an={"l":"start","c":"middle","r":"end"}[al]
                bold = "600" if str(v).startswith("*") else "400"
                self.text(tx,y+rh*0.70,str(v).lstrip("*"),fs,INK if bold=="600" else DIM,an,bold)
                cx+=cw
                if cx<x+w-0.01: self.line(cx,y,cx,y+rh,W_THIN,"#dfe5ea")
            self.line(x,y,x+w,y,W_THIN,"#dfe5ea")
            y+=rh
        self.rect(x,y0,w,y-y0,W_THIN,INK)
        return y
    def notes(self, x,y,w, title, items, fs=FS_S, lh=4.0, num=True):
        self.text(x,y,title,fs+0.3,INK,"start","700",0.35); y+=1.6
        self.line(x,y,x+w,y,0.35,INK); y+=4.2
        for i,it in enumerate(items,1):
            pre=f"{i}." if num else "–"
            self.text(x,y,pre,fs,INK,"start","600")
            for j,ln in enumerate(_wrap(it, int(w/(fs*0.545)))):
                self.text(x+(5.0 if num else 3.4),y,ln,fs,DIM if j else INK,"start")
                y+=lh
            y+=0.9
        return y
    # ---------------------------------------------------------- frame
    def frame(self):
        M=self.M
        self.rect(M,M,self.W-2*M,self.H-2*M,0.7,INK)
        self.rect(M+1.6,M+1.6,self.W-2*M-3.2,self.H-2*M-3.2,0.25,THIN)
        # zone letters / numbers
        for i,ch in enumerate("ABCDEFGH"):
            xx=M+1.6+(self.W-2*M-3.2)*(i+0.5)/8
            self.text(xx,M+0.2+3.4,ch,FS_S-0.3,THIN,"middle")
            self.text(xx,self.H-M-1.0,ch,FS_S-0.3,THIN,"middle")
        for i in range(6):
            yy=M+1.6+(self.H-2*M-3.2)*(i+0.5)/6
            self.text(M+0.2+2.6,yy,str(i+1),FS_S-0.3,THIN,"middle")
            self.text(self.W-M-2.6,yy,str(i+1),FS_S-0.3,THIN,"middle")
        return self
    def title_block(self, extra_rows=None):
        x,y,w,h = 236.0, 238.0, 172.0, 47.0
        self.rect(x,y,w,h,0.7,INK,"#ffffff")
        self.line(x,y+9.0,x+w,y+9.0,0.35,INK)
        self.line(x,y+27.0,x+w,y+27.0,0.35,INK)
        self.line(x,y+37.0,x+w,y+37.0,0.35,INK)
        self.line(x+112,y+9.0,x+112,y+37.0,0.35,INK)
        # org strip
        self.text(x+3,y+6.2,"INDIA-VC  THERMAL HARDWARE",FS_S,INK,"start","700",0.5)
        self.text(x+w-3,y+6.2,"ISO 128 / ISO 2768-mK",FS_S-0.3,DIM,"end")
        # title
        self.text(x+3,y+15.5,"TITLE",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+3,y+21.5,self.t,FS+1.2,INK,"start","700",0.2)
        if self.sub: self.text(x+3,y+25.6,self.sub,FS_S-0.2,DIM,"start")
        # scale / units / sheet
        self.text(x+115,y+15.5,"SCALE",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+115,y+21.0,self.sc,FS+0.8,INK,"start","700")
        self.text(x+145,y+15.5,"UNITS",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+145,y+21.0,"mm",FS+0.8,INK,"start","700")
        self.text(x+115,y+25.8,"THIRD ANGLE PROJECTION",FS_S-0.7,DIM,"start")
        # drawing number band
        self.text(x+3,y+33.5,"DRAWING No.",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+30,y+34.2,self.n,FS+1.6,INK,"start","700",0.6)
        self.text(x+115,y+33.5,"REV",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+128,y+34.2,"A",FS+1.6,INK,"start","700")
        self.text(x+145,y+33.5,"SHEET",FS_S-0.5,THIN,"start","600",0.4)
        self.text(x+160,y+34.2,self.sheet_of,FS+1.0,INK,"start","700")
        rows = extra_rows or []
        cw=w/max(len(rows),1) if rows else w
        for i,(k,v) in enumerate(rows):
            self.text(x+3+i*cw,y+41.0,k,FS_S-0.6,THIN,"start","600",0.35)
            self.text(x+3+i*cw,y+45.4,v,FS_S,INK,"start")
            if i: self.line(x+i*cw,y+37.0,x+i*cw,y+h,0.25,THIN)
        return self
    sheet_of = "1 / 1"
    def render(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.W} {self.H}" '
                f'width="100%" preserveAspectRatio="xMidYMid meet" '
                f'style="background:#fff">' + "".join(self.b) + '</svg>')
    def save(self, path):
        open(path,"w").write(self.render()); return path

def _wrap(t, n):
    out, cur = [], ""
    for wd in str(t).split():
        if len(cur)+len(wd)+1 <= n: cur = (cur+" "+wd).strip()
        else: out.append(cur); cur = wd
    if cur: out.append(cur)
    return out or [""]
