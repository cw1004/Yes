# -*- coding: utf-8 -*-
"""특허 도면 8매 생성기. 흑백 선화, 전자출원 규격 지향."""
import math, os
import geom

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

STYLE = """
<style>
 text{font-family:'Noto Sans CJK KR','NanumGothic','DejaVu Sans',sans-serif;fill:#000;stroke:none}
 .o{fill:none;stroke:#000;stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}
 .m{fill:none;stroke:#000;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
 .f{fill:none;stroke:#000;stroke-width:0.9;stroke-linejoin:round}
 .hd{fill:none;stroke:#000;stroke-width:1.0;stroke-dasharray:7 5}
 .ct{fill:none;stroke:#000;stroke-width:1.0;stroke-dasharray:20 4 4 4}
 .ld{fill:none;stroke:#000;stroke-width:0.9}
 .ar{fill:none;stroke:#000;stroke-width:1.4;marker-end:url(#ar)}
 .ar2{fill:none;stroke:#000;stroke-width:1.1;marker-end:url(#ar)}
 .ray{fill:none;stroke:#000;stroke-width:1.0;stroke-dasharray:6 4;marker-end:url(#ar)}
 .n{font-size:15px}
 .ns{font-size:13.5px}
 .nc{font-size:14px;text-anchor:middle}
 .ncs{font-size:12px;text-anchor:middle}
 .cap{font-size:21px;font-weight:700;text-anchor:middle}
 .sub{font-size:14px}
 .note{font-size:12.5px}
</style>
<defs>
 <marker id="ar" markerWidth="10" markerHeight="10" refX="8.5" refY="3" orient="auto">
  <path d="M0,0 L8.5,3 L0,6 z" fill="#000"/></marker>
 <pattern id="hA" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
  <line x1="0" y1="0" x2="0" y2="8" stroke="#000" stroke-width="0.8"/></pattern>
 <pattern id="hB" width="8" height="8" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
  <line x1="0" y1="0" x2="0" y2="8" stroke="#000" stroke-width="0.8"/></pattern>
 <pattern id="hC" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
  <line x1="0" y1="0" x2="0" y2="5" stroke="#000" stroke-width="1.6"/></pattern>
 <pattern id="hD" width="6" height="6" patternUnits="userSpaceOnUse">
  <circle cx="3" cy="3" r="1.0" fill="#000"/></pattern>
</defs>
"""


def head(w, h, cap, sub=""):
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
         f'viewBox="0 0 {w} {h}">{STYLE}<rect width="{w}" height="{h}" style="fill:#fff"/>'
         f'<text class="cap" x="{w/2}" y="40">【도 {cap}】</text>')
    if sub:
        s += f'<text class="sub" x="30" y="72">{sub}</text>'
    return s


def lead(x1, y1, x2, y2, num, side="L", cls="n"):
    """지시선 + 부호. side=L이면 좌측 열(우측정렬), R이면 우측 열(좌측정렬)."""
    anchor = "end" if side == "L" else "start"
    tx = x2 - 8 if side == "L" else x2 + 8
    return (f'<line class="ld" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>'
            f'<circle cx="{x1}" cy="{y1}" r="2.5" fill="#000"/>'
            f'<text class="{cls}" x="{tx}" y="{y2+5}" text-anchor="{anchor}">{num}</text>')


def box(x, y, w, h, label=None, sub=None, cls="m", rx=0):
    s = f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
    if label and sub:
        s += f'<text class="nc" x="{x+w/2}" y="{y+h/2-3}">{label}</text>'
        s += f'<text class="ncs" x="{x+w/2}" y="{y+h/2+15}">{sub}</text>'
    elif label:
        s += f'<text class="nc" x="{x+w/2}" y="{y+h/2+5}">{label}</text>'
    return s


def hatch(d, pat="hA"):
    return f'<path d="{d}" fill="url(#{pat})" stroke="#000" stroke-width="1.6"/>'


# ═══════════════════════════════════════════ 도 1  사시도
def fig1():
    W, H = 800, 1060
    cx, cy, r = 400, 330, 225
    s = [head(W, H, 1, "사시도 (조립 상태)")]

    s.append(f'<circle class="o" cx="{cx}" cy="{cy}" r="{r}"/>')
    for p in geom.ball_paths(cx, cy, r, steps=16, zmin=0.07):
        s.append(f'<path class="m" d="{p}"/>')
    s.append(f'<path class="f" d="M{cx-r+18},{cy-56} A{r-18},{r-18} 0 0 1 {cx-40},{cy-r+18}"/>')

    # 목 / 손잡이
    nb = cy + r - 18
    s.append(f'<path class="o" d="M{cx-56},{nb} q56,28 112,0 v30 q-56,22 -112,0 z"/>')
    s.append(f'<path class="f" d="M{cx-56},{nb+22} q56,24 112,0"/>')
    hx, hy = cx - 64, nb + 52
    s.append(f'<path class="o" d="M{hx},{hy} h128 v214 q0,26 -26,26 h-76 q-26,0 -26,-26 z"/>')
    s.append(f'<circle class="o" cx="{cx}" cy="{hy+46}" r="25"/>')
    s.append(f'<circle class="f" cx="{cx}" cy="{hy+46}" r="18"/>')
    s.append(f'<path class="m" d="M{cx},{hy+36} v14"/>')
    s.append(f'<path class="m" d="M{cx-9},{hy+40} a12,12 0 1 0 18,0"/>')
    s.append(f'<rect class="m" x="{hx+20}" y="{hy+94}" width="88" height="104" rx="12"/>')
    for i in range(7):
        s.append(f'<path class="f" d="M{hx+26},{hy+104+i*14} q38,7 76,0"/>')
    s.append(f'<path class="m" d="M{hx+3},{hy+208} h122"/>')
    s.append(f'<path class="o" d="M{hx+10},{hy+222} h108 v20 q0,14 -14,14 h-80 q-14,0 -14,-14 z"/>')
    s.append(f'<rect class="m" x="{cx-20}" y="{hy+240}" width="40" height="11" rx="5.5"/>')
    s.append(f'<rect class="f" x="{cx-14}" y="{hy+243}" width="28" height="5" rx="2.5"/>')
    # 스트랩
    s.append(f'<rect class="m" x="{hx+122}" y="{hy+100}" width="19" height="13" rx="4"/>')
    s.append(f'<path class="m" d="M{hx+141},{hy+107} q54,40 44,104 q-5,28 -28,34"/>')
    s.append(f'<path class="m" d="M{hx+141},{hy+118} q44,40 34,98 q-5,26 -26,32"/>')
    # 음공
    for i in range(3):
        s.append(f'<circle class="f" cx="{cx-104+i*11}" cy="{cy+r-6}" r="2.7"/>')

    # 단면선 A-A' (수직 절단면)
    ytop, ybot = cy - r - 52, cy + r + 34
    s.append(f'<line class="ct" x1="{cx}" y1="{ytop}" x2="{cx}" y2="{ybot}"/>')
    s.append(f'<path class="ar" d="M{cx},{ytop+6} h-44"/>')
    s.append(f'<path class="ar" d="M{cx},{ybot-6} h-44"/>')
    s.append(f'<text class="n" x="{cx+10}" y="{ytop+2}">A</text>')
    s.append(f'<text class="n" x="{cx+16}" y="{ybot-8}">A′</text>')

    # 상세 원 B
    s.append(f'<circle class="hd" cx="{cx+104}" cy="{cy-150}" r="56"/>')
    s.append(f'<text class="n" x="{cx+150}" y="{cy-196}">B</text>')

    fc = geom.face_centers(cx, cy, r, zmin=0.55)
    px, py = (fc[0][0], fc[0][1]) if fc else (cx - 60, cy - 40)

    L, R = 84, 716
    s.append(lead(cx - 186, cy - 128, L, 130, "110", "L"))
    s.append(lead(px, py, L, 186, "111", "L"))
    s.append(lead(cx - r + 30, cy - 92, L, 242, "114", "L"))
    s.append(lead(*seam_point(cx, cy, r, 3.55, 0.74), L, 430, "112", "L"))
    s.append(lead(cx - 104, cy + r - 6, L, 486, "116", "L"))
    s.append(lead(hx, hy + 120, L, 700, "200", "L"))
    s.append(lead(hx + 44, hy + 150, L, 756, "250", "L"))
    s.append(lead(hx + 4, hy + 215, L, 812, "210", "L"))
    s.append(lead(cx + 172, cy - 128, R, 130, "100", "R"))
    s.append(lead(*seam_point(cx, cy, r, 0.55, 0.80), R, 430, "112", "R"))
    s.append(lead(cx, hy + 46, R, 620, "230", "R"))
    s.append(lead(hx + 131, hy + 106, R, 700, "240", "R"))
    s.append(lead(hx + 176, hy + 202, R, 756, "241", "R"))
    s.append(lead(cx, hy + 245, R, 812, "175", "R"))

    s.append('<text class="note" x="40" y="1006">A–A′ : 도 4의 절단 위치 (수직 절단면)　　'
             'B : 도 4 우하단 확대부 위치</text>')
    s.append('</svg>')
    return "".join(s)


# ═══════════════════════════════════════════ 도 2  분해 사시도
def fig2():
    W, H = 840, 1270
    cx = 370
    R = 162
    L, R2 = 92, 742
    s = [head(W, H, 2, "분해 사시도")]
    s.append(f'<line class="ct" x1="{cx}" y1="96" x2="{cx}" y2="1240"/>')

    # ① 상부 하우징
    y1 = 250
    s.append(f'<path class="o" d="M{cx-R},{y1} a{R},{R} 0 0 1 {2*R},0"/>')
    s.append(f'<ellipse class="m" cx="{cx}" cy="{y1}" rx="{R}" ry="50"/>')
    for p in geom.ball_paths(cx, y1, R, rx=0.36, ry=0.42, steps=14, zmin=0.10):
        ys = [float(q.split(',')[1]) for q in p[1:].replace(' L', ' ').split(' ')]
        if max(ys) < y1 + 4:
            s.append(f'<path class="f" d="{p}"/>')
    s.append(f'<path class="f" d="M{cx-R+15},{y1-18} a{R-15},{R-15} 0 0 1 {2*(R-15)},0"/>')

    # ② 도광 부재
    y2 = 408
    s.append(f'<ellipse class="o" cx="{cx}" cy="{y2}" rx="{R-10}" ry="46"/>')
    s.append(f'<ellipse class="m" cx="{cx}" cy="{y2}" rx="50" ry="16"/>')
    for k in range(12):
        a = k * math.pi / 6
        s.append(f'<line class="m" x1="{cx+50*math.cos(a):.1f}" y1="{y2+16*math.sin(a):.1f}" '
                 f'x2="{cx+(R-10)*math.cos(a):.1f}" y2="{y2+46*math.sin(a):.1f}"/>')
    s.append(f'<path class="f" d="M{cx-R+10},{y2} q{R-10},-30 {2*(R-10)},0"/>')

    # ③ 발광 모듈
    y3 = 556
    s.append(f'<ellipse class="o" cx="{cx}" cy="{y3}" rx="{R-28}" ry="43"/>')
    s.append(f'<path class="o" d="M{cx-R+28},{y3} v12 a{R-28},43 0 0 0 {2*(R-28)},0 v-12"/>')
    for k in range(11):
        a = k * 2 * math.pi / 11 + 0.25
        ex, ey = cx + (R - 58) * math.cos(a), y3 + 26 * math.sin(a)
        s.append(f'<rect class="m" x="{ex-11:.1f}" y="{ey-7:.1f}" width="22" height="14" rx="2"/>')
        s.append(f'<path class="f" d="M{ex-11:.1f},{ey:.1f} h22"/>')
    s.append(f'<rect class="m" x="{cx-26}" y="{y3-13}" width="52" height="26" rx="3"/>')
    s.append(f'<rect class="f" x="{cx-20}" y="{y3-8}" width="40" height="16" rx="2"/>')
    s.append(f'<rect class="f" x="{cx+44}" y="{y3-11}" width="32" height="20" rx="2"/>')
    s.append(f'<rect class="f" x="{cx-88}" y="{y3-11}" width="30" height="20" rx="2"/>')
    s.append(f'<rect class="f" x="{cx-116}" y="{y3+2}" width="24" height="14" rx="2"/>')
    s.append(f'<path class="f" d="M{cx+80},{y3-16} q20,-12 38,-4"/>')
    s.append(f'<rect class="f" x="{cx+22}" y="{y3+18}" width="20" height="12" rx="2"/>')
    # 하면 실장 소자(은선)
    s.append(f'<path class="hd" d="M{cx-70},{y3+30} h20 M{cx-20},{y3+34} h20 M{cx+34},{y3+30} h20"/>')

    # ④ 하부 하우징 (내부가 보이는 그릇)
    y4 = 716
    s.append(f'<path class="o" d="M{cx-R},{y4} a{R},{R} 0 0 0 {2*R},0"/>')
    s.append(f'<ellipse class="m" cx="{cx}" cy="{y4}" rx="{R}" ry="50"/>')
    s.append(f'<path class="f" d="M{cx-R+13},{y4} a{R-13},{R-13} 0 0 0 {2*(R-13)},0"/>')
    s.append(f'<ellipse class="f" cx="{cx}" cy="{y4}" rx="{R-13}" ry="46"/>')
    s.append(f'<rect class="m" x="{cx-48}" y="{y4+140}" width="96" height="24" rx="4"/>')
    for i in range(4):
        s.append(f'<rect class="f" x="{cx-35+i*21}" y="{y4+146}" width="13" height="12" rx="2"/>')
    s.append(f'<rect class="m" x="{cx-92}" y="{y4+112}" width="32" height="21" rx="3"/>')
    s.append(f'<circle class="m" cx="{cx+80}" cy="{y4+96}" r="17"/>')
    s.append(f'<circle class="f" cx="{cx+80}" cy="{y4+96}" r="7"/>')
    s.append(f'<path class="m" d="M{cx+48},{y4+144} l16,-11 v24 z"/>')
    for i in range(3):
        s.append(f'<circle class="f" cx="{cx-108+i*12}" cy="{y4+72}" r="3"/>')

    # ⑤ 결합부
    y5 = 946
    s.append(f'<path class="o" d="M{cx-60},{y5} h120 v42 h-120 z"/>')
    s.append(f'<rect class="m" x="{cx-54}" y="{y5+7}" width="27" height="29" rx="3"/>')
    s.append(f'<path class="f" d="M{cx-54},{y5+21.5} h27"/>')
    s.append(f'<rect class="m" x="{cx+27}" y="{y5+7}" width="27" height="29" rx="3"/>')
    s.append(f'<path class="f" d="M{cx+27},{y5+21.5} h27"/>')
    for i in range(4):
        xx = cx - 35 + i * 21
        s.append(f'<rect class="m" x="{xx}" y="{y5-11}" width="13" height="13" rx="2"/>')
        s.append(f'<path class="f" d="M{xx+6.5},{y5-11} v-9"/>')
    s.append(f'<path class="o" d="M{cx+60},{y5+9} h21 v24 h-21"/>')
    s.append(f'<ellipse class="f" cx="{cx}" cy="{y5+1}" rx="60" ry="9"/>')

    # ⑥ 손잡이
    y6 = 1040
    s.append(f'<path class="o" d="M{cx-68},{y6} h136 v168 q0,22 -22,22 h-92 q-22,0 -22,-22 z"/>')
    s.append(f'<circle class="m" cx="{cx}" cy="{y6+28}" r="20"/>')
    s.append(f'<rect class="hd" x="{cx-46}" y="{y6+58}" width="92" height="92" rx="10"/>')
    s.append(f'<rect class="hd" x="{cx-46}" y="{y6+154}" width="92" height="20" rx="3"/>')
    s.append(f'<rect class="m" x="{cx-20}" y="{y6+178}" width="40" height="11" rx="5.5"/>')

    for ya, yb in [(y1 + 52, y2 - 48), (y2 + 48, y3 - 46), (y3 + 46, y4 - 52),
                   (y4 + 168, y5 - 16), (y5 + 46, y6 - 8)]:
        s.append(f'<path class="ar2" d="M{cx},{ya} V{yb}"/>')

    s.append(lead(cx - 128, y1 - 92, L, 150, "110", "L"))
    s.append(lead(*seam_point(cx, y1, R, 2.2, 0.80, rx=0.36, ry=0.42, zmin=0.10), L, 200, "112", "L"))
    s.append(lead(cx - 146, y1 - 40, L, 250, "114", "L"))
    s.append(lead(cx + 60, y1 - 128, R2, 150, "111", "R"))
    s.append(lead(cx + 148, y1 - 34, R2, 206, "110", "R"))
    s.append(lead(cx - 118, y2 - 22, L, 380, "123", "L"))
    s.append(lead(cx + 30, y2 + 10, R2, 392, "123", "R"))
    s.append(lead(cx - 73, y3 - 1, L, 500, "124", "L"))
    s.append(lead(cx - 104, y3 + 9, L, 552, "151", "L"))
    s.append(lead(cx - 134, y3 + 20, L, 604, "121", "L"))
    s.append(lead(cx - 104, y3 + 32, L, 656, "122", "L"))
    s.append(lead(cx, y3 - 13, R2, 500, "130", "R"))
    s.append(lead(cx + 60, y3 - 1, R2, 552, "132", "R"))
    s.append(lead(cx + 32, y3 + 24, R2, 604, "146", "R"))
    s.append(lead(cx + 104, y3 + 26, R2, 656, "122", "R"))
    s.append(lead(cx - 108, y4 + 72, L, 780, "116", "L"))
    s.append(lead(cx - 76, y4 + 122, L, 836, "145", "L"))
    s.append(lead(cx - 160, y4 + 40, L, 892, "110", "L"))
    s.append(lead(cx + 80, y4 + 96, R2, 780, "160", "R"))
    s.append(lead(cx, y4 + 152, R2, 836, "115", "R"))
    s.append(lead(cx + 56, y4 + 144, R2, 892, "117", "R"))
    s.append(lead(cx - 41, y5 + 21, L, 950, "221", "L"))
    s.append(lead(cx - 29, y5 - 5, L, 1000, "222", "L"))
    s.append(lead(cx + 70, y5 + 21, R2, 950, "220", "R"))
    s.append(lead(cx + 20, y5 + 1, R2, 1000, "224", "R"))
    s.append(lead(cx - 68, y6 + 110, L, 1080, "210", "L"))
    s.append(lead(cx, y6 + 184, L, 1140, "175", "L"))
    s.append(lead(cx, y6 + 28, R2, 1060, "230", "R"))
    s.append(lead(cx + 46, y6 + 104, R2, 1120, "171", "R"))
    s.append(lead(cx + 46, y6 + 164, R2, 1176, "173", "R"))
    s.append('</svg>')
    return "".join(s)


def seam_point(cx, cy, r, ang, frac=0.62, **kw):
    """구면 이음선 위의 점 중 지정 방향에 가장 가까운 점."""
    tx, ty = cx + frac * r * math.cos(ang), cy - frac * r * math.sin(ang)
    best, bd = (tx, ty), 1e9
    for p in geom.ball_paths(cx, cy, r, **kw):
        for q in p[1:].replace(' L', ' ').split(' '):
            a, b = q.split(',')
            a, b = float(a), float(b)
            d = (a - tx) ** 2 + (b - ty) ** 2
            if d < bd:
                best, bd = (a, b), d
    return best


# ═══════════════════════════════════════════ 도 3  블록도
def fig3():
    W, H = 1200, 900
    s = [head(W, H, 3, "발광 응원 장치의 구성 블록도")]
    s.append('<rect class="hd" x="46" y="100" width="770" height="500"/>')
    s.append('<text class="ns" x="58" y="122">구형 하우징 (110) 내부</text>')

    s.append(box(78, 152, 214, 336, cls="o"))
    s.append('<text class="nc" x="185" y="178">센서부 (140)</text>')
    for i, (nm, no) in enumerate([("마이크로폰", "141"), ("관성센서", "142"), ("터치센서", "143"),
                                  ("조도센서", "144"), ("홀 센서", "145"), ("온도센서", "146")]):
        y = 192 + i * 48
        s.append(box(96, y, 178, 38))
        s.append(f'<text class="ncs" x="185" y="{y+24}">{nm}　{no}</text>')

    s.append(box(352, 158, 232, 214, cls="o"))
    s.append('<text class="nc" x="468" y="184">제어부 (130)</text>')
    s.append(box(372, 198, 192, 52))
    s.append('<text class="ncs" x="468" y="220">추론 연산부 131</text>')
    s.append('<text class="ncs" x="468" y="240">(NPU / 추론 엔진)</text>')
    s.append(box(372, 262, 192, 52))
    s.append('<text class="ncs" x="468" y="284">메모리 132</text>')
    s.append('<text class="ncs" x="468" y="304">추론모델 · 패턴 데이터</text>')
    s.append(box(372, 326, 192, 32))
    s.append('<text class="ncs" x="468" y="347">내부 클럭 · 타이머</text>')

    s.append(box(352, 412, 232, 158, cls="o"))
    s.append('<text class="nc" x="468" y="438">무선통신부 (150)</text>')
    s.append(box(372, 452, 172, 46))
    s.append('<text class="ncs" x="458" y="480">BLE 모듈 151</text>')
    s.append(box(372, 506, 172, 46))
    s.append('<text class="ncs" x="458" y="534">NFC 모듈 152</text>')
    s.append('<path class="m" d="M556,470 l18,-11 v22 z"/>')
    s.append('<path class="m" d="M550,530 h18 M559,520 v20"/>')

    s.append(box(646, 158, 152, 74, "발광 드라이버", "124", cls="o"))
    s.append(box(646, 258, 152, 132, cls="o"))
    s.append('<text class="nc" x="722" y="286">발광 모듈 (120)</text>')
    for i, t in enumerate(["기판 121", "발광 소자 122", "도광 리브 123"]):
        s.append(f'<text class="ncs" x="722" y="{312+i*22}">{t}</text>')
    s.append(box(646, 424, 152, 132, cls="o"))
    s.append('<text class="nc" x="722" y="452">햅틱부 (160)</text>')
    s.append(box(662, 468, 120, 34))
    s.append('<text class="ncs" x="722" y="490">햅틱 드라이버 161</text>')
    s.append(box(662, 510, 120, 34))
    s.append('<text class="ncs" x="722" y="532">진동 모터</text>')

    s.append('<rect class="hd" x="46" y="672" width="770" height="180"/>')
    s.append('<text class="ns" x="58" y="694">손잡이부 (200)</text>')
    s.append(box(96, 706, 150, 100, "배터리", "171", cls="o"))
    s.append(box(276, 706, 150, 46, "충전 회로 172"))
    s.append(box(276, 762, 150, 44, "보호 회로 174"))
    s.append(box(456, 706, 176, 100, cls="o"))
    s.append('<text class="nc" x="544" y="742">전력 관리 회로</text>')
    s.append('<text class="ncs" x="544" y="766">173 (PMIC)</text>')
    s.append('<text class="ncs" x="544" y="790">VLED / 3V3 생성</text>')
    s.append(box(662, 706, 130, 46, "커넥터 175"))
    s.append(box(662, 762, 130, 44, "전원 버튼 230"))

    s.append(box(880, 158, 268, 116, cls="o"))
    s.append('<text class="nc" x="1014" y="192">사용자 단말 (300)</text>')
    s.append('<text class="ncs" x="1014" y="220">응용 프로그램 310</text>')
    s.append('<text class="ncs" x="1014" y="246">패턴 · 좌표 식별자 · 갱신</text>')
    s.append(box(880, 400, 268, 84, "송출부 (500)", "브로드캐스트 송출", cls="o"))
    s.append(box(880, 512, 268, 84, "서버 (400)", "410 스케줄러 / 420 매핑 DB", cls="o"))
    s.append('<path class="ar" d="M1014,512 V488"/>')

    # 센서 → 제어부
    s.append('<path class="ar" d="M292,212 H350"/>')
    s.append('<text class="ns" x="298" y="204">I2S</text>')
    s.append('<path class="ar" d="M292,260 H350"/>')
    s.append('<text class="ns" x="298" y="252">I2C</text>')
    s.append('<path class="m" d="M292,404 H320 V300"/>')
    s.append('<path class="ar" d="M320,300 H350"/>')
    s.append('<text class="ns" x="296" y="396">GPIO</text>')
    # 제어부 → 출력
    s.append('<path class="ar" d="M584,196 H644"/>')
    s.append('<text class="ns" x="590" y="188">SPI</text>')
    s.append('<path class="ar" d="M722,232 V256"/>')
    s.append('<text class="ns" x="730" y="250">125</text>')
    s.append('<path class="m" d="M584,350 H604 V470"/>')
    s.append('<path class="ar" d="M604,470 H644"/>')
    # 제어부 ↔ 무선
    s.append('<path class="ar" d="M468,372 V410"/>')
    s.append('<path class="ar" d="M478,410 V374"/>')
    # 외부 통신
    s.append('<path class="m" d="M584,478 H800"/>')
    s.append('<path class="m" d="M800,478 a7,7 0 0 1 12,0"/>')
    s.append('<path class="m" d="M812,478 H856 V216"/>')
    s.append('<path class="ar" d="M856,216 H878"/>')
    s.append('<path class="ar" d="M866,226 V466 H586"/>')
    s.append('<text class="ncs" x="838" y="300">BLE</text>')
    s.append('<text class="ncs" x="838" y="318">양방향</text>')
    s.append('<path class="m" d="M878,442 H838 V506 H812"/>')
    s.append('<path class="m" d="M812,506 a7,7 0 0 0 -12,0"/>')
    s.append('<path class="ar" d="M800,506 H586"/>')
    s.append('<text class="ncs" x="838" y="352">브로드캐스트</text>')
    s.append('<text class="ncs" x="838" y="370">수신</text>')

    # 전원 버스
    s.append('<path class="m" d="M544,706 V644 H185"/>')
    s.append('<path class="m" d="M544,644 H806 V196"/>')
    s.append('<path class="ar" d="M806,196 H800"/>')
    s.append('<path class="ar" d="M185,644 V490"/>')
    s.append('<path class="m" d="M468,644 V574"/>')
    s.append('<path class="ar" d="M468,574 V572"/>')
    s.append('<path class="ar" d="M722,644 V558"/>')
    s.append('<text class="ns" x="196" y="636">3V3</text>')
    s.append('<text class="ns" x="734" y="636">VLED</text>')
    s.append('<path class="ar" d="M246,752 H274"/>')
    s.append('<path class="ar" d="M426,752 H454"/>')
    s.append('<text class="ns" x="330" y="700">VBAT</text>')
    s.append('<text class="ns" x="56" y="618">전력 · 신호 : 결합부(220) – 대응 접점(115) 경유</text>')
    s.append('</svg>')
    return "".join(s)


def fig4():
    W, H = 1080, 830
    cx, cy, Ro, Ri = 350, 440, 248, 228
    s = [head(W, H, 4, "도 1의 A–A′ 선 단면도 및 B부 확대도")]

    s.append(f'<path d="M{cx},{cy-Ro} A{Ro},{Ro} 0 1 1 {cx-0.01},{cy-Ro} Z '
             f'M{cx},{cy-Ri} A{Ri},{Ri} 0 1 0 {cx+0.01},{cy-Ri} Z" '
             f'fill="url(#hA)" fill-rule="evenodd" stroke="#000" stroke-width="2.4"/>')
    s.append(f'<circle class="o" cx="{cx}" cy="{cy}" r="{Ri}"/>')
    s.append(f'<circle class="m" cx="{cx}" cy="{cy}" r="{Ri-7}" stroke-dasharray="3 3"/>')

    N = 14
    ang0 = math.pi / N
    for k in range(N):
        a = ang0 + k * 2 * math.pi / N
        p = []
        for rr, sg in ((Ri - 8, 1), (Ro, 1), (Ro, -1), (Ri - 8, -1)):
            aa = a + sg * 0.055
            p.append(f'{cx+rr*math.cos(aa):.1f},{cy+rr*math.sin(aa):.1f}')
        s.append(f'<path d="M{p[0]} L{p[1]} L{p[2]} L{p[3]} Z" fill="url(#hC)" '
                 f'stroke="#000" stroke-width="1.6"/>')

    pw = Ri - 66
    s.append(f'<rect x="{cx-pw}" y="{cy-9}" width="{2*pw}" height="18" fill="url(#hB)" '
             f'stroke="#000" stroke-width="2.2"/>')
    for k in range(N):
        a = ang0 + k * 2 * math.pi / N
        ca, sa = math.cos(a), math.sin(a)
        if abs(sa) < 0.12:
            continue
        x0, y0 = cx + 58 * ca, cy + 58 * sa
        x1, y1 = cx + (Ri - 9) * ca, cy + (Ri - 9) * sa
        nx, ny = -sa, ca
        s.append(f'<path class="m" d="M{x0+nx*9:.1f},{y0+ny*9:.1f} L{x1+nx*4:.1f},{y1+ny*4:.1f} '
                 f'L{x1-nx*4:.1f},{y1-ny*4:.1f} L{x0-nx*9:.1f},{y0-ny*9:.1f} Z"/>')

    for i in range(-4, 5):
        if i == 0:
            continue
        xx = cx + i * 42
        s.append(f'<rect class="m" x="{xx-13}" y="{cy-24}" width="26" height="15" rx="2"/>')
        s.append(f'<rect class="m" x="{xx-13}" y="{cy+9}" width="26" height="15" rx="2"/>')
    s.append(f'<rect class="m" x="{cx-30}" y="{cy-33}" width="60" height="24" rx="2" style="fill:#fff"/>')
    s.append(f'<text class="ncs" x="{cx}" y="{cy-16}">130</text>')

    s.append(f'<path class="ray" d="M{cx+126},{cy-26} L{cx+150},{cy-150}"/>')
    s.append(f'<path class="ray" d="M{cx+126},{cy-26} L{cx+82},{cy-140}"/>')
    s.append(f'<path class="ray" d="M{cx+116},{cy-176} L{cx+140},{cy-206}"/>')
    s.append(f'<path class="ray" d="M{cx+116},{cy-176} L{cx+86},{cy-200}"/>')

    s.append(f'<path class="o" d="M{cx-58},{cy+Ro-26} v40 h116 v-40"/>')
    s.append(f'<rect class="m" x="{cx-44}" y="{cy+Ro+8}" width="88" height="14"/>')

    bx, by, br = cx + 128, cy - 168, 62
    s.append(f'<circle class="hd" cx="{bx}" cy="{by}" r="{br}"/>')
    s.append(f'<text class="n" x="{bx+br-6}" y="{by-br-6}">B</text>')

    ex, ey, er = 838, 330, 172
    s.append(f'<circle class="o" cx="{ex}" cy="{ey}" r="{er}"/>')
    s.append(f'<text class="n" x="{ex-er}" y="{ey-er-14}">B부 확대도</text>')
    s.append(f'<line class="hd" x1="{bx+br*0.72:.0f}" y1="{by-br*0.7:.0f}" '
             f'x2="{ex-er*0.74:.0f}" y2="{ey+er*0.68:.0f}"/>')
    s.append(f'<clipPath id="cpB"><circle cx="{ex}" cy="{ey}" r="{er-2}"/></clipPath>')
    s.append('<g clip-path="url(#cpB)">')
    s.append(f'<rect x="{ex-er}" y="{ey-er}" width="{2*er}" height="66" fill="url(#hA)"/>')
    s.append(f'<path class="o" d="M{ex-er},{ey-er+66} H{ex+er}"/>')
    # 확산층(격벽 좌우로 분리)
    for a0, a1 in ((ex - er, ex - 16), (ex + 16, ex + er)):
        s.append(f'<rect x="{a0}" y="{ey-er+66}" width="{a1-a0}" height="13" fill="url(#hD)" '
                 f'stroke="#000" stroke-width="1.2"/>')
    s.append(f'<rect x="{ex-16}" y="{ey-er}" width="32" height="150" fill="url(#hC)" '
             f'stroke="#000" stroke-width="1.8"/>')
    s.append(f'<path class="o" d="M{ex-15},{ey+150} V{ey-er+66} M{ex+15},{ey+150} V{ey-er+66}"/>')
    s.append(f'<path class="m" d="M{ex-15},{ey+150} L{ex-32},{ey+er} M{ex+15},{ey+150} L{ex+32},{ey+er}"/>')
    s.append(f'<path class="ray" d="M{ex-96},{ey+er} L{ex-40},{ey-er+92}"/>')
    s.append(f'<path class="ray" d="M{ex-40},{ey-er+92} L{ex-92},{ey-er+142}"/>')
    s.append(f'<path class="ray" d="M{ex+96},{ey+er} L{ex+40},{ey-er+92}"/>')
    s.append(f'<path class="ray" d="M{ex+40},{ey-er+92} L{ex+92},{ey-er+142}"/>')
    s.append('</g>')
    s.append(f'<text class="ncs" x="{ex-104}" y="{ey-58}">셀 A</text>')
    s.append(f'<text class="ncs" x="{ex+104}" y="{ey-58}">셀 B</text>')

    L, R = 62, 1032
    s.append(lead(cx, cy - Ro + 10, L, 130, "110", "L"))
    s.append(lead(cx - Ri + 22, cy - 96, L, 186, "114", "L"))
    pa = ang0 + 8 * 2 * math.pi / N
    s.append(lead(cx + (Ro - 8) * math.cos(pa), cy + (Ro - 8) * math.sin(pa), L, 242, "112", "L"))
    s.append(lead(cx - 148, cy - 122, L, 298, "123", "L"))
    s.append(lead(cx - pw + 6, cy, L, 500, "121", "L"))
    s.append(lead(cx - 130, cy + 16, L, 556, "122", "L"))
    s.append(lead(cx - 128, cy + Ri - 62, L, 612, "111", "L"))
    s.append(lead(cx - 30, cy + Ro + 15, L, 668, "115", "L"))
    s.append(lead(ex - 110, ey - 152, R, 130, "110", "R"))
    s.append(lead(ex, ey - 132, R, 186, "112", "R"))
    s.append(lead(ex - 140, ey - 90, R, 242, "114", "R"))
    s.append(lead(ex + 15, ey + 46, R, 298, "123", "R"))
    s.append(lead(ex - 120, ey + 30, R, 354, "111", "R"))
    s.append('<text class="note" x="620" y="566">도광 리브(123)는 격벽(112) 내측에 정렬되어</text>')
    s.append('<text class="note" x="620" y="592">① 발광 소자(122)의 광을 셀(111)로 안내하고,</text>')
    s.append('<text class="note" x="620" y="618">② 인접한 셀 사이의 광 누설을 차단한다.</text>')
    s.append('<text class="note" x="620" y="652">→ 셀 A와 셀 B가 서로 다른 색을 표시하여도</text>')
    s.append('<text class="note" x="620" y="678">　 경계가 선명하게 유지된다.</text>')
    s.append('<text class="note" x="620" y="712">단일 평면 기판(121)의 양면 실장만으로</text>')
    s.append('<text class="note" x="620" y="738">구면 전 방향 발광이 이루어진다.</text>')
    s.append('</svg>')
    return "".join(s)


# ═══════════════════════════════════════════ 도 5  손잡이 결합부
def _joint(ox, oy, gap, flux):
    """결합부 요부 단면. gap = 이격 거리(px)."""
    s = []
    W = 300
    s.append(f'<rect x="{ox}" y="{oy}" width="{W}" height="52" fill="url(#hA)" '
             f'stroke="#000" stroke-width="2.2"/>')
    s.append(f'<rect class="m" x="{ox+22}" y="{oy+8}" width="52" height="34" style="fill:#fff"/>')
    for i in range(3):
        s.append(f'<rect class="m" x="{ox+118+i*30}" y="{oy+52}" width="18" height="12" style="fill:#fff"/>')
    s.append(f'<path class="o" d="M{ox+W},{oy+14} h24 v28 h-24"/>')

    ty = oy + 64 + gap
    s.append(f'<rect x="{ox}" y="{ty}" width="{W}" height="78" fill="url(#hB)" '
             f'stroke="#000" stroke-width="2.2"/>')
    for x0 in (ox + 14, ox + W - 74):
        s.append(f'<rect class="m" x="{x0}" y="{ty+10}" width="60" height="58" style="fill:#fff"/>')
        s.append(f'<path class="f" d="M{x0},{ty+39} h60"/>')
        s.append(f'<text class="ncs" x="{x0+30}" y="{ty+32}">N</text>')
        s.append(f'<text class="ncs" x="{x0+30}" y="{ty+60}">S</text>')
    for i in range(3):
        bx = ox + 118 + i * 30
        s.append(f'<rect class="m" x="{bx}" y="{ty-2}" width="18" height="44" style="fill:#fff"/>')
        s.append(f'<rect class="m" x="{bx+3}" y="{ty-16}" width="12" height="18" style="fill:#fff"/>')
        zz = "".join(f' L{bx+4 if k%2 else bx+14},{ty+16+k*4}' for k in range(6))
        s.append(f'<path class="f" d="M{bx+9},{ty+14}{zz}"/>')
    s.append(f'<path class="o" d="M{ox+2},{ty-8} h{W-4}" stroke-dasharray="9 5"/>')
    s.append(f'<circle class="m" cx="{ox+92}" cy="{ty-8}" r="6" style="fill:#fff"/>')
    s.append(f'<path class="o" d="M{ox+W},{ty+14} h24 v28 h-24"/>')
    s.append(f'<path class="o" d="M{ox+8},{ty+78} v70 h{W-16} v-70"/>')

    if flux:
        for j in range(3):
            xm, cxb = ox + 44, ox + 48
            s.append(f'<path class="m" d="M{xm},{ty+10} C{xm-30-j*14},{ty+2} '
                     f'{cxb-30-j*14},{oy+50} {cxb},{oy+44}" stroke-dasharray="6 4"/>')
        s.append(f'<text class="ncs" x="{ox-6}" y="{oy+96}">자속</text>')
    return "".join(s), ty


def fig5():
    W, H = 1080, 810
    s = [head(W, H, 5, "손잡이부 결합 구조 및 결합 검출 (요부 확대 단면도)")]
    OA, OB, OY = 110, 640, 150
    a, tya = _joint(OA, OY, 0, True)
    s.append('<text class="nc" x="260" y="124">(a) 결합 상태</text>')
    s.append(a)
    b, tyb = _joint(OB, OY, 74, False)
    s.append('<text class="nc" x="790" y="124">(b) 분리 상태</text>')
    s.append(b)

    s.append(f'<path class="m" d="M{OB-32},{OY+64} v74"/>')
    s.append(f'<path class="ar" d="M{OB-32},{OY+64} v28"/>')
    s.append(f'<path class="ar" d="M{OB-32},{OY+138} v-28"/>')
    s.append(f'<text class="ns" x="{OB-40}" y="{OY+106}" text-anchor="end">이격</text>')

    L, R = 72, 1012
    s.append(lead(OA + 250, OY + 10, L, 140, "110", "L"))
    s.append(lead(OA + 48, OY + 25, L, 190, "145", "L"))
    s.append(lead(OA + 24, tya - 8, L, 224, "224", "L"))
    s.append(lead(OA + 44, tya + 40, L, 260, "221", "L"))
    s.append(lead(OA + 8, tya + 70, L, 320, "220", "L"))
    s.append(lead(OA + 150, tya + 110, L, 380, "210", "L"))
    M = 474
    s.append(lead(OA + 178, OY + 58, M, 180, "115", "R"))
    s.append(lead(OA + 127, tya + 20, M, 240, "222", "R"))
    s.append(lead(OA + 187, tya + 32, M, 300, "223", "R"))
    s.append(lead(OB + 312, OY + 28, R, 169, "117", "R"))
    s.append(lead(OB + 312, tyb + 28, R, 260, "117", "R"))
    s.append(lead(OB + 292, tyb + 70, R, 300, "220", "R"))
    s.append(lead(OB + 150, tyb + 110, R, 380, "210", "R"))

    gx, gy, gw, gh = 150, 530, 400, 152
    s.append(f'<line class="o" x1="{gx}" y1="{gy+gh}" x2="{gx+gw}" y2="{gy+gh}"/>')
    s.append(f'<line class="o" x1="{gx}" y1="{gy+gh}" x2="{gx}" y2="{gy}"/>')
    s.append(f'<text class="ns" x="{gx+gw}" y="{gy+gh+24}" text-anchor="end">결합부 이격 거리</text>')
    s.append(f'<text class="ns" x="{gx+4}" y="{gy-10}">홀 센서(145) 출력</text>')
    pts = " ".join(f"{gx+i*gw/40:.1f},{gy+gh-(gh-14)*math.exp(-(i/40)*3.4):.1f}" for i in range(41))
    s.append(f'<polyline class="o" points="{pts}"/>')
    thy = gy + gh - (gh - 14) * math.exp(-0.42 * 3.4)
    s.append(f'<line class="hd" x1="{gx}" y1="{thy:.1f}" x2="{gx+gw}" y2="{thy:.1f}"/>')
    s.append(f'<text class="ns" x="{gx+gw+8}" y="{thy+5:.1f}">문턱값</text>')
    xt = gx + 0.42 * gw
    s.append(f'<line class="hd" x1="{xt:.1f}" y1="{gy}" x2="{xt:.1f}" y2="{gy+gh}"/>')
    s.append(f'<text class="ncs" x="{(gx+xt)/2:.1f}" y="{gy+gh+48}">결합 판별</text>')
    s.append(f'<text class="ncs" x="{(xt+gx+gw)/2:.1f}" y="{gy+gh+48}">분리 판별</text>')
    s.append(f'<text class="ncs" x="{(gx+xt)/2:.1f}" y="{gy+gh+70}">통상 발광 모드</text>')
    s.append(f'<text class="ncs" x="{(xt+gx+gw)/2:.1f}" y="{gy+gh+70}">저전력 표시 모드</text>')

    s.append('<text class="note" x="620" y="536">(a) 자성체(221)의 자속이 홀 센서(145)에 도달하여</text>')
    s.append('<text class="note" x="620" y="562">　　출력 ≥ 문턱값 → 제어부(130)가 결합 상태로 판별</text>')
    s.append('<text class="note" x="620" y="588">　　→ 통상 발광 모드</text>')
    s.append('<text class="note" x="620" y="626">(b) 이격에 따라 자속 밀도가 감소하여</text>')
    s.append('<text class="note" x="620" y="652">　　출력 &lt; 문턱값 → 분리 상태로 판별</text>')
    s.append('<text class="note" x="620" y="678">　　→ 구동 전류를 제한하고, 밝기 변화 주기가 긴</text>')
    s.append('<text class="note" x="620" y="704">　　　패턴으로 전환 (저전력 표시 모드)</text>')
    s.append('<text class="note" x="620" y="742">전기 접점(222)은 탄성 부재(223)에 의하여 변위 가능하고,</text>')
    s.append('<text class="note" x="620" y="768">방향 결정 형상(117)에 의해 정해진 방향으로만 결합된다.</text>')
    s.append('</svg>')
    return "".join(s)


# ═══════════════════════════════════════════ 도 6  순서도
def _pbox(x, y, w, h, lines):
    s = [f'<rect class="m" x="{x}" y="{y}" width="{w}" height="{h}"/>']
    n = len(lines)
    for i, t in enumerate(lines):
        yy = y + h / 2 + (i - (n - 1) / 2) * 19 + 5
        cls = "nc" if i == 0 else "ncs"
        s.append(f'<text class="{cls}" x="{x+w/2}" y="{yy:.1f}">{t}</text>')
    return "".join(s)


def _dia(cx, cy, w, h, lines):
    s = [f'<path class="m" d="M{cx},{cy-h/2} L{cx+w/2},{cy} L{cx},{cy+h/2} L{cx-w/2},{cy} Z"/>']
    n = len(lines)
    for i, t in enumerate(lines):
        yy = cy + (i - (n - 1) / 2) * 19 + 5
        s.append(f'<text class="{"nc" if i==0 else "ncs"}" x="{cx}" y="{yy:.1f}">{t}</text>')
    return "".join(s)


def fig6():
    W, H = 980, 1260
    C = 400
    s = [head(W, H, 6, "온디바이스 이벤트 판별 및 출력 제어 순서도")]

    s.append(f'<rect class="m" x="{C-110}" y="96" width="220" height="40" rx="20"/>')
    s.append(f'<text class="nc" x="{C}" y="121">시작 / 초기화</text>')
    s.append(f'<path class="ar" d="M{C},136 V166"/>')

    s.append(_dia(C, 206, 300, 76, ["S105  손잡이부 결합?", "(홀 센서 145)"]))
    s.append(f'<path class="ar" d="M{C+150},206 H{760}"/>')
    s.append('<text class="ns" x="672" y="198">아니오</text>')
    s.append(_pbox(760, 172, 190, 68, ["S106 저전력", "표시 모드", "구동 전류 제한"]))
    s.append(f'<path class="m" d="M855,240 V268 H{C}"/>')
    s.append(f'<circle cx="{C}" cy="268" r="3" fill="#000"/>')
    s.append(f'<path class="ar" d="M{C},244 V296"/>')
    s.append(f'<text class="ns" x="{C+10}" y="264">예</text>')

    s.append(_pbox(C - 175, 296, 350, 62, ["S110  신호 취득", "마이크로폰 141 / 관성센서 142"]))
    s.append(f'<path class="ar" d="M{C},358 V388"/>')

    s.append(_dia(C, 428, 300, 76, ["S115  충격 검출?", "|a| > 충격 문턱값"]))
    s.append(f'<path class="ar" d="M{C+150},428 H760"/>')
    s.append('<text class="ns" x="672" y="420">예</text>')
    s.append(_pbox(760, 394, 190, 68, ["S116 발광 출력", "제한 / 중지", "(소정 시간)"]))
    s.append(f'<path class="m" d="M855,462 V492 H{C}"/>')
    s.append(f'<circle cx="{C}" cy="492" r="3" fill="#000"/>')
    s.append(f'<path class="ar" d="M{C},466 V518"/>')
    s.append(f'<text class="ns" x="{C+10}" y="486">아니오</text>')

    s.append(_pbox(C - 235, 518, 470, 108, [
        "S120  특징 추출",
        "① 프레임 분할 → 주파수 변환 → 대역별 에너지",
        "② 에너지의 시간적 변화율 · 음압 상승 유지 시간",
        "③ 가속도 크기의 시간적 변화율 · 최대 가속도",
        "→ ①②③ 결합하여 특징 벡터 생성"]))
    s.append(f'<path class="ar" d="M{C},626 V656"/>')

    s.append(_pbox(C - 175, 656, 350, 62, ["S130  추론 (추론 연산부 131)",
                                            "이벤트 종류별 확신도 산출"]))
    s.append(f'<path class="ar" d="M{C},718 V748"/>')

    s.append(_dia(C, 796, 340, 96, ["S140  최대 확신도 ≥ 문턱값",
                                     "AND 직전 판정으로부터",
                                     "불응 시간 경과?"]))
    s.append(f'<path class="m" d="M{C-170},796 H70 V310"/>')
    s.append(f'<path class="ar" d="M70,310 H{C-177}"/>')
    s.append(f'<text class="ns" x="86" y="782">아니오</text>')
    s.append(f'<path class="ar" d="M{C},844 V874"/>')
    s.append(f'<text class="ns" x="{C+10}" y="868">예</text>')

    s.append(_dia(C, 922, 340, 84, ["S145  브로드캐스트", "무선 신호 수신 중?"]))
    s.append(f'<path class="ar" d="M{C+170},922 H740"/>')
    s.append('<text class="ns" x="660" y="914">예</text>')
    s.append(_pbox(740, 880, 210, 84, ["S146 연출 우선",
                                        "발광 : 연출 데이터",
                                        "진동 : 내부 판별 결과"]))
    s.append(f'<path class="m" d="M845,964 V1002 H{C+120}"/>')
    s.append(f'<path class="ar" d="M{C+120},1002 V1036"/>')
    s.append(f'<path class="ar" d="M{C},964 V1036"/>')
    s.append(f'<text class="ns" x="{C+10}" y="996">아니오</text>')

    s.append(_pbox(C - 235, 1036, 470, 82, [
        "S150  패턴 출력",
        "발광 패턴 → 발광 드라이버 124",
        "진동 패턴 → 햅틱 드라이버 161  (개시 시각 정렬)"]))
    s.append(f'<path class="m" d="M{C-235},1077 H152 V276 H{C-60}"/>')
    s.append(f'<path class="ar" d="M{C-60},276 V294"/>')

    s.append('<text class="note" x="60" y="1170">S110 ~ S150 의 모든 단계는 외부 서버와의 통신 없이 발광 응원 장치(100) 내부에서 수행된다.</text>')
    s.append('<text class="note" x="60" y="1198">불응 시간의 도입에 의하여 동일 이벤트의 반복 판정에 따른 출력 진동이 억제된다.</text>')
    s.append('</svg>')
    return "".join(s)


# ═══════════════════════════════════════════ 도 7  군집 동기 제어 시스템
def fig7():
    W, H = 1220, 900
    s = [head(W, H, 7, "다수 발광 응원 장치의 무선 군집 동기 제어 시스템 구성도")]

    # 서버
    s.append(box(56, 130, 250, 190, cls="o"))
    s.append('<text class="nc" x="181" y="158">서버 (400)</text>')
    s.append(box(76, 176, 210, 56))
    s.append('<text class="ncs" x="181" y="199">연출 스케줄러 410</text>')
    s.append('<text class="ncs" x="181" y="219">영상 → 좌표별 출력값</text>')
    s.append(box(76, 244, 210, 56))
    s.append('<text class="ncs" x="181" y="267">좌표 매핑 DB 420</text>')
    s.append('<text class="ncs" x="181" y="287">좌표 식별자 ↔ 위치 좌표</text>')

    # 송출부
    s.append('<path class="ar" d="M306,225 H352"/>')
    s.append('<text class="ns" x="310" y="217">연출 데이터</text>')
    s.append(box(352, 168, 172, 114, cls="o"))
    s.append('<text class="nc" x="438" y="196">송출부 (500)</text>')
    s.append('<text class="ncs" x="438" y="222">분산 배치 송출기</text>')
    s.append('<text class="ncs" x="438" y="244">500a / 500b / 500c</text>')
    s.append('<text class="ncs" x="438" y="266">송출 시각 상호 정렬</text>')

    # 관람 공간
    VX, VY, VW, VH = 588, 110, 580, 400
    s.append(f'<rect class="o" x="{VX}" y="{VY}" width="{VW}" height="{VH}"/>')
    s.append(f'<text class="ns" x="{VX+10}" y="{VY-10}">관람 공간 = 대면적 표시 영역</text>')
    s.append(f'<line class="m" x1="{VX+26}" y1="{VY+VH-24}" x2="{VX+VW-26}" y2="{VY+VH-24}" marker-end="url(#ar)"/>')
    s.append(f'<line class="m" x1="{VX+26}" y1="{VY+VH-24}" x2="{VX+26}" y2="{VY+24}" marker-end="url(#ar)"/>')
    s.append(f'<text class="ns" x="{VX+VW-18}" y="{VY+VH-6}">x</text>')
    s.append(f'<text class="ns" x="{VX+10}" y="{VY+20}">y</text>')

    cols, rows = 12, 7
    x0, y0, dx, dy = VX + 106, VY + 84, 32, 36
    for r in range(rows):
        for c in range(cols):
            X, Y = x0 + c * dx, y0 + r * dy
            on = abs((c - 5.5) * 0.85 + (r - 3.0) * 1.7) < 2.4
            fill = "#000" if on else "none"
            s.append(f'<circle class="f" cx="{X}" cy="{Y}" r="9" style="fill:{fill}"/>')
    s.append(f'<text class="ncs" x="{x0-22}" y="{y0-20}">(0,0)</text>')
    s.append(f'<text class="ncs" x="{x0+5*dx}" y="{y0+rows*dy+10}">1 대 = 1 화소 (좌표 식별자별)</text>')

    # 송출기 배치 + 커버리지
    for i, (tx, ty) in enumerate([(VX + 138, VY + 36), (VX + VW - 70, VY + 36), (VX + 60, VY + VH / 2)]):
        for k in (1, 2, 3):
            s.append(f'<circle class="f" cx="{tx}" cy="{ty}" r="{14+k*11}" stroke-dasharray="4 4"/>')
        s.append(f'<rect class="m" x="{tx-16}" y="{ty-11}" width="32" height="22" style="fill:#fff"/>')
        s.append(f'<text class="ncs" x="{tx}" y="{ty+5}">{"abc"[i]}</text>')
    s.append(f'<text class="ns" x="{VX+VW}" y="{VY+VH+24}" text-anchor="end">송출기 500a / 500b / 500c</text>')

    # 브로드캐스트
    for k in (0, 1, 2):
        s.append(f'<path class="f" d="M528,{300+k*16} q28,-12 58,0" stroke-dasharray="5 4"/>')
    s.append('<path class="ar" d="M528,352 L584,376"/>')
    s.append('<text class="ncs" x="438" y="312">브로드캐스트</text>')
    s.append('<text class="ncs" x="438" y="332">(비접속형 · 단방향)</text>')

    # 개별 장치 확대
    dxc, dyc = 150, 620
    s.append(f'<circle class="o" cx="{dxc}" cy="{dyc}" r="62"/>')
    for p in geom.ball_paths(dxc, dyc, 62, steps=10, zmin=0.10):
        s.append(f'<path class="f" d="{p}"/>')
    s.append(f'<path class="o" d="M{dxc-20},{dyc+58} h40 v66 q0,10 -10,10 h-20 q-10,0 -10,-10 z"/>')
    s.append(f'<circle class="f" cx="{dxc}" cy="{dyc+76}" r="8"/>')
    s.append(lead(dxc + 46, dyc - 40, 60, 556, "100", "L"))
    s.append(f'<path class="hd" d="M{dxc+64},{dyc-30} L{x0+3*dx},{y0+5*dy}"/>')
    s.append(box(60, 726, 300, 116, cls="m"))
    s.append('<text class="ncs" x="210" y="750">각 장치에 좌표 식별자 할당</text>')
    s.append('<text class="ncs" x="210" y="772">→ 1대 = 1 화소로 동작</text>')
    s.append('<text class="ncs" x="210" y="798">내부 클럭을 기준 시각에 정렬 후</text>')
    s.append('<text class="ncs" x="210" y="820">개시 시각에 출력값 발광</text>')

    # 사용자 단말
    s.append(box(396, 566, 150, 210, cls="o", rx=14))
    s.append(box(412, 596, 118, 150))
    s.append('<text class="ncs" x="471" y="646">300 / 310</text>')
    s.append('<text class="ncs" x="471" y="672">좌표 식별자</text>')
    s.append('<text class="ncs" x="471" y="694">등록 · 할당</text>')
    s.append(f'<path class="ar" d="M394,660 H{dxc+70}"/>')
    s.append('<text class="ns" x="300" y="652">BLE</text>')
    s.append('<text class="ncs" x="471" y="800">사용자 단말</text>')

    # 패킷 구성
    PX, PY, PW = 600, 566, 568
    s.append(f'<text class="ns" x="{PX}" y="{PY-8}">무선 신호(브로드캐스트 패킷) 구성</text>')
    fields = [("기준 시각", "정보"), ("연출", "식별자"), ("개시 시각", "정보"),
              ("좌표별 출력값", "또는 산출 규칙")]
    fw = [120, 106, 120, 222]
    cxp = PX
    for (a, b), w in zip(fields, fw):
        s.append(f'<rect class="o" x="{cxp}" y="{PY}" width="{w}" height="66"/>')
        s.append(f'<text class="ncs" x="{cxp+w/2}" y="{PY+30}">{a}</text>')
        s.append(f'<text class="ncs" x="{cxp+w/2}" y="{PY+50}">{b}</text>')
        cxp += w
    s.append(f'<text class="note" x="{PX}" y="{PY+100}">· 접속 수립을 요하지 아니하므로 동시 수용 대수에 원리적 제한이 없다.</text>')
    s.append(f'<text class="note" x="{PX}" y="{PY+128}">· 좌표별 출력값 대신 산출 규칙(전파 방향 · 속도 · 색상 변화 계수)을</text>')
    s.append(f'<text class="note" x="{PX}" y="{PY+152}">　전송하면, 패킷 크기가 장치 대수와 무관하게 유지된다.</text>')
    s.append(f'<text class="note" x="{PX}" y="{PY+186}">· 소정 시간 이상 미수신 시 : 최종 연출 유지 또는</text>')
    s.append(f'<text class="note" x="{PX}" y="{PY+210}">　내부 이벤트 판별 결과에 따른 출력으로 자동 복귀한다.</text>')
    s.append('</svg>')
    return "".join(s)


# ═══════════════════════════════════════════ 도 8  타이밍도
def fig8():
    W, H = 1220, 940
    T0X = 880
    s = [head(W, H, 8, "시각 동기 및 좌표별 출력값 추출 타이밍도")]
    ax0, ax1 = 240, 1150

    def axis(y, label):
        return (f'<line class="o" x1="{ax0}" y1="{y}" x2="{ax1}" y2="{y}" marker-end="url(#ar)"/>'
                f'<text class="ns" x="{ax0-14}" y="{y+5}" text-anchor="end">{label}</text>')

    px = [300, 440, 580, 720]

    # 송출부
    s.append(axis(160, "송출부 500"))
    for i, x in enumerate(px):
        s.append(f'<rect class="m" x="{x}" y="132" width="46" height="28"/>')
        s.append(f'<text class="ncs" x="{x+23}" y="{151}">P{i+1}</text>')
        s.append(f'<line class="hd" x1="{x+23}" y1="160" x2="{x+23}" y2="{600}"/>')
    s.append(f'<text class="ns" x="{ax1}" y="96" text-anchor="end">P : 기준 시각 · 연출 식별자 · 개시 시각 · 좌표별 출력값(또는 산출 규칙)</text>')

    # 장치 A
    s.append(axis(300, "장치 A (100a)"))
    for i, x in enumerate(px):
        rx = x + 23 + 10
        s.append(f'<path class="m" d="M{rx},300 v-22 h9 v22"/>')
        s.append(f'<path class="ar2" d="M{x+23},288 H{rx-2}"/>')
    s.append(f'<text class="ns" x="{px[0]+40}" y="276">Δ1</text>')

    # 장치 B
    s.append(axis(420, "장치 B (100b)"))
    for i, x in enumerate(px):
        rx = x + 23 + 30
        s.append(f'<path class="m" d="M{rx},420 v-22 h9 v22"/>')
        s.append(f'<path class="ar2" d="M{x+23},408 H{rx-2}"/>')
    s.append(f'<text class="ns" x="{px[0]+54}" y="396">Δ2</text>')
    s.append('<text class="ns" x="240" y="372">수신 시점은 장치마다 상이</text>')

    # 클럭 오차 그래프
    gy, ghh = 600, 130
    s.append(f'<line class="o" x1="{ax0}" y1="{gy}" x2="{ax1}" y2="{gy}"/>')
    s.append(f'<line class="o" x1="{ax0}" y1="{gy}" x2="{ax0}" y2="{gy-ghh}"/>')
    s.append(f'<text class="ns" x="{ax0-14}" y="{gy-ghh+6}" text-anchor="end">시각 오차</text>')
    s.append(f'<text class="ns" x="{ax0-14}" y="{gy+5}" text-anchor="end">0</text>')
    lvl = [104, 62, 34, 16]
    prev = 118
    dd = []
    xcur = ax0
    for i, x in enumerate(px):
        xm = x + 23
        dd.append(f'M{xcur},{gy-prev} L{xm},{gy-prev-6}')
        dd.append(f'M{xm},{gy-prev-6} L{xm},{gy-lvl[i]}')
        prev = lvl[i]
        xcur = xm
    dd.append(f'M{xcur},{gy-prev} L{ax1-20},{gy-prev-4}')
    s.append(f'<path class="o" d="{" ".join(dd)}"/>')
    s.append(f'<text class="ncs" x="{px[0]+78}" y="{gy-lvl[0]-28}">S220 · S230 보정</text>')
    for i in range(1, len(px)):
        s.append(f'<circle cx="{px[i]+23}" cy="{gy-lvl[i]}" r="3.5" fill="#000"/>')
    s.append(f'<text class="ns" x="{ax1}" y="{gy-116}" text-anchor="end">주파수 편차 보정(S230)에 의하여</text>')
    s.append(f'<text class="ns" x="{ax1}" y="{gy-96}" text-anchor="end">패킷 사이 구간의 오차 누적도 억제된다</text>')

    # T0
    s.append(f'<line class="ct" x1="{T0X}" y1="100" x2="{T0X}" y2="900"/>')
    s.append(f'<text class="n" x="{T0X+10}" y="196">개시 시각 T0</text>')

    # 출력
    for y, nm in ((760, "A 발광 출력"), (860, "B 발광 출력")):
        s.append(f'<line class="o" x1="{ax0}" y1="{y}" x2="{ax1}" y2="{y}"/>')
        s.append(f'<text class="ns" x="{ax0-14}" y="{y+5}" text-anchor="end">{nm}</text>')
        s.append(f'<path class="o" d="M{T0X},{y} v-44 h122 v44 h44 v-44 h74 v44"/>')
    s.append(f'<path class="ar2" d="M{T0X-90},{700} H{T0X-4}"/>')
    s.append(f'<text class="ns" x="{T0X-96}" y="704" text-anchor="end">S250 출력 개시</text>')
    s.append(f'<text class="note" x="{ax0}" y="912">수신 시점(Δ1 ≠ Δ2)이 서로 달라도, 정렬된 내부 클럭에 의하여 '
             f'출력 개시 시각은 T0 로 일치한다 (편차 수 ms 이내).</text>')
    s.append(f'<text class="note" x="{ax0}" y="{666}">S210 수신 → S220 오프셋 · 주파수 편차 산출 → S230 내부 클럭 정렬 '
             f'→ S240 좌표 식별자별 출력값 추출/산출 → S250 개시 시각에 출력</text>')
    s.append('</svg>')
    return "".join(s)
