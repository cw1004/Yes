#!/usr/bin/env python3
"""Compose the SI-100 adsorber 2D solve into stills and an animation.

Left: the (r, theta) temperature field of one tube cross-section, drawn in true
polar geometry with the steel wall and the vapour core shown.  Right: the same
slice coloured by uptake.  Below: the day's traces with a time cursor.
"""
import os, sys, math, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from viz_common import thermal_ramp, SERIES_LIGHT, hx
import icemaker_spec as IM

S = IM.SPEC; D = IM.design()
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
Z = np.load(os.path.join(OUT, "adsorber_fields.npz"), allow_pickle=True)
GEO = json.loads(str(Z['geo'])); META = json.loads(str(Z['meta']))
PHASE = json.loads(str(Z['phase']))

FD = "/usr/share/fonts/truetype/dejavu/"
def F(sz, b=False):
    try: return ImageFont.truetype(FD + ("DejaVuSans-Bold.ttf" if b else "DejaVuSans.ttf"), sz)
    except Exception: return ImageFont.load_default()
f9, f10, f11, f12, f13, f16, f20, f26 = F(9), F(10), F(11), F(12), F(13,True), F(16,True), F(20,True), F(26,True)

INK, SEC, MUT, GRID, SURF, PANEL = "#12181f", "#4b5d6b", "#8496a3", "#dde4ea", "#fcfcfb", "#f2f5f7"
C1, C2, C3 = SERIES_LIGHT[0], SERIES_LIGHT[1], SERIES_LIGHT[2]
RAMP = np.array(thermal_ramp(256), np.uint8)
LUMW = np.array([0.2126, 0.7152, 0.0722])

NR, NT, NRS = GEO['nr'], GEO['nt'], GEO['nr_steel']
RF = np.array(GEO['rf']) * 1000.0          # mm
R_IN, R_OUT = RF[0], RF[-1]
PX = 232                                    # field box, px
DISC = PX

# --- precompute the polar -> pixel map once -------------------------------
yy, xx = np.mgrid[0:DISC, 0:DISC]
cx = cy = (DISC - 1) / 2.0
sc = (DISC / 2.0 - 2) / R_OUT               # px per mm
gx = (xx - cx) / sc; gy = (yy - cy) / sc
grr = np.hypot(gx, gy)
# theta = 0 at the TOP, increasing clockwise, matching the solver
gth = (np.arctan2(gx, -gy)) % (2 * math.pi)
IR = np.clip(np.searchsorted(RF, grr) - 1, 0, len(RF) - 2)
IT = np.clip((gth / GEO['dth']).astype(int), 0, NT - 1)
M_SOLID = (grr >= R_IN) & (grr <= R_OUT)
M_CORE = grr < R_IN
M_STEEL = (grr >= RF[NR]) & (grr <= R_OUT)

def disc(field, vmin, vmax, iso=None, steel_edge=True):
    """Draw one (n, nt) field into a polar disc image."""
    n = np.clip((field[IR, IT] - vmin) / (vmax - vmin), 0, 1)
    rgb = RAMP[(n * 255).astype(np.uint8)].astype(np.float32)
    if iso:
        edge = np.zeros(IR.shape, bool)
        v = field[IR, IT]
        for lv in iso:
            m = v > lv
            if not m.any() or m.all(): continue
            e = np.zeros_like(m)
            e[1:, :] |= m[1:, :] ^ m[:-1, :]; e[:, 1:] |= m[:, 1:] ^ m[:, :-1]
            edge |= e
        if edge.any():
            lum = (rgb / 255.0) @ LUMW
            ink = np.where(lum[..., None] > 0.55, np.array([18,24,31],np.float32),
                           np.array([255,255,255],np.float32))
            rgb[edge] = (0.55 * rgb + 0.45 * ink)[edge]
    if steel_edge:                      # mark the steel wall with a light veil
        rgb[M_STEEL] = (0.72 * rgb + 0.28 * np.array([255,255,255],np.float32))[M_STEEL]
    bg = np.array([252, 252, 251], np.float32)
    rgb = np.where(M_SOLID[..., None], rgb, bg)
    rgb = np.where(M_CORE[..., None], np.array([226,232,237],np.float32), rgb)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")

W, H = 1060, 700
TMIN, TMAX = 20.0, 135.0
XMIN, XMAX = 0.30, 1.05

def frame(case, k):
    T = Z[f"{case}_T"][k]; X = Z[f"{case}_X"][k]
    t = float(Z[f"{case}_t"][k]); ph = PHASE[case][k]
    tr = {f: Z[f"{case}_{f}"] for f in ("t","P","T_mean","T_top","T_bot","x_mean","G","Ta","Tp")}
    mt = META[case]
    im = Image.new("RGB", (W, H), SURF); d = ImageDraw.Draw(im)

    ttl = ("SI-100 ADSORBER TUBE  —  AS DRAWN, GLAZING SEALED ALL NIGHT"
           if case == "drawn" else
           "SI-100 ADSORBER TUBE  —  WITH A NIGHT COOLING PATH (U 20 W/m²K)")
    d.text((34, 24), ttl, font=f16, fill=INK)
    d.text((34, 48), f"2D (r, θ) transient · Maxsorb III / methanol · Dubinin-Astakhov "
                     f"local equilibrium · periodic steady state, day {mt['days']}",
           font=f11, fill=SEC)

    # ---------------- clock / phase band
    bx, by = 34, 78
    d.rounded_rectangle([bx, by, W-34, by+34], 5, fill=PANEL)
    hh = int(t); mm = int((t-hh)*60)
    d.text((bx+14, by+8), f"{hh:02d}:{mm:02d}", font=f20, fill=INK)
    PHN = {"heat":"ISOSTERIC HEATING  A→B", "desorb":"DESORBING  B→C",
           "cool":"ISOSTERIC COOLING  C→D", "adsorb":"ADSORBING / MAKING ICE  D→A"}
    PHC = {"heat":C2, "desorb":C2, "cool":C1, "adsorb":C1}
    d.text((bx+108, by+12), PHN[ph], font=f13, fill=PHC[ph])
    d.text((W-300, by+6),  f"sun  {float(tr['G'][k]):4.0f} W/m²", font=f11, fill=SEC)
    d.text((W-300, by+20), f"ambient {float(tr['Ta'][k]):4.1f} °C   "
                           f"plate {float(tr['Tp'][k]):5.1f} °C", font=f11, fill=SEC)

    # ---------------- two discs
    for j, (fld, vmin, vmax, lab, unit, iso) in enumerate((
            (T, TMIN, TMAX, "TEMPERATURE", "°C", list(range(30,131,10))),
            (X, XMIN, XMAX, "UPTAKE  x", "kg/kg", None))):
        ox = 34 + j * (DISC + 70)
        oy = 134
        im.paste(disc(fld, vmin, vmax, iso), (ox, oy))
        d.ellipse([ox+1, oy+1, ox+DISC-2, oy+DISC-2], outline=GRID)
        d.text((ox, oy-20), lab, font=f12, fill=INK)
        # sun side marker
        d.text((ox+DISC/2-26, oy-20+0), "▲ sun", font=f10, fill=MUT)
        fl = fld[:NR] if lab.startswith("TEMP") else fld[:NR]
        pf = ".1f" if unit == "\u00b0C" else ".3f"
        d.text((ox, oy+DISC+8),
               f"top {float(fl[:,0].mean()):{pf}}   bottom {float(fl[:,NT//2].mean()):{pf}}"
               f"   mean {float(fl.mean()):{pf}} {unit}", font=f11, fill=SEC)
        # colour bar
        cbx, cby, cbw, cbh = ox, oy+DISC+30, DISC, 9
        for i in range(cbw):
            c = tuple(RAMP[int(i/(cbw-1)*255)])
            d.line([cbx+i, cby, cbx+i, cby+cbh], fill=c)
        d.rectangle([cbx, cby, cbx+cbw, cby+cbh], outline=GRID)
        d.text((cbx, cby+13), f"{vmin:g} {unit}", font=f9, fill=MUT)
        tw = d.textlength(f"{vmax:g} {unit}", font=f9)
        d.text((cbx+cbw-tw, cby+13), f"{vmax:g} {unit}", font=f9, fill=MUT)

    # ---------------- key numbers panel
    kx = 34 + 2*(DISC+70)
    d.rounded_rectangle([kx, 134, W-34, 134+DISC+52], 6, fill=PANEL)
    rows = [("swing achieved", f"{mt['swing']:.3f} kg/kg", f"design {D['dx']:.3f}"),
            ("x rich", f"{mt['x_hi']:.3f}", f"design {D['x_r']:.3f}"),
            ("x lean", f"{mt['x_lo']:.3f}", f"design {D['x_l']:.3f}"),
            ("peak bed mean", f"{float(max(tr['T_mean'])):.1f} °C",
             f"assumed {S['T_des']:.0f}"),
            ("coldest bed mean", f"{float(min(tr['T_mean'])):.1f} °C", f"assumed {S['T_ads']:.0f}"),
            ("ideal cooling", f"{mt['Q_cool']/1e6:.2f} MJ/day", ""),
            ("ice, no derating", f"{mt['ice']:.2f} kg/day", f"target {S['ice_day']:.1f}")]
    yr = 148
    for lab, val, note in rows:
        d.text((kx+14, yr), lab, font=f10, fill=MUT)
        d.text((kx+14, yr+13), val, font=f13, fill=INK)
        if note: d.text((kx+104, yr+15), note, font=f9, fill=MUT)
        yr += 38

    # ---------------- traces: temperature then pressure, one axis each
    # never a dual axis - the two measures get their own panel on a shared
    # time axis, with direct labels pushed apart so they cannot collide
    gx0, gx1 = 72, W - 212
    def place(labels):
        """labels = [(y, text, colour)] -> y values spread by at least 13 px."""
        labels = sorted(labels)
        for i in range(1, len(labels)):
            if labels[i][0] - labels[i-1][0] < 13:
                labels[i] = (labels[i-1][0] + 13, labels[i][1], labels[i][2])
        return labels

    panels = (
        (452, 566, [("bed top", tr['T_top'], C2), ("bed mean", tr['T_mean'], C1),
                    ("bed bottom", tr['T_bot'], C3)],
         "bed temperature, \u00b0C", 20, 140,
         [(S['T_des'], f"design assumed {S['T_des']:.0f} \u00b0C at desorption"),
          (S['T_ads'], f"design assumed {S['T_ads']:.0f} \u00b0C at adsorption")]),
        (600, 672, [("system pressure", tr['P']/1000.0, C1)],
         "system pressure, kPa abs", 0, 26,
         [(21.86, "condenser  21.9"), (2.92, "evaporator  2.9")]),
    )
    for ys, ye, series, ylab, ylo, yhi, refs in panels:
        tt = tr['t']
        el = np.arange(len(tt)) / (len(tt) - 1) * 24.0
        def X_(i): return gx0 + el[i] / 24.0 * (gx1 - gx0)
        def Y_(v): return ye - (v - ylo) / (yhi - ylo) * (ye - ys)
        d.text((gx0 - 38, ys - 20), ylab, font=f10, fill=SEC)
        for gl in np.linspace(ylo, yhi, 5):
            y_ = Y_(gl)
            d.line([gx0, y_, gx1, y_], fill=GRID)
            d.text((gx0 - 36, y_ - 6), f"{gl:.0f}", font=f9, fill=MUT)
        d.line([gx0, ye, gx1, ye], fill=MUT)
        for hhh in range(0, 25, 3):
            x_ = gx0 + hhh / 24.0 * (gx1 - gx0)
            d.line([x_, ye, x_, ye + 4], fill=MUT)
            d.text((x_ - 9, ye + 7), f"{(6 + hhh) % 24:02d}:00", font=f9, fill=MUT)
        # what the design assumed, as recessive dashed references
        for lv, nm in refs:
            y_ = Y_(lv)
            for xs in range(int(gx0), int(gx1), 9):
                d.line([xs, y_, xs + 4, y_], fill="#b9c6d0")
            # put a low reference where the traces are high (midday) and a
            # high reference at the left, so the label never sits on a line
            lx = gx0 + 5 if lv > (ylo + yhi) / 2 else gx0 + 0.42 * (gx1 - gx0)
            d.text((lx, y_ - 12), nm, font=f9, fill=MUT)
        lab = []
        for nm, arr, col in series:
            pts = [(X_(i), Y_(float(arr[i]))) for i in range(len(tt))]
            d.line(pts, fill=col, width=2)
            lab.append((pts[-1][1] - 6, nm, col))
        for y_, nm, col in place(lab):
            d.line([gx1 + 3, y_ + 6, gx1 + 8, y_ + 6], fill=col, width=2)
            d.text((gx1 + 12, y_), nm, font=f10, fill=col)
        xc = X_(k)
        d.line([xc, ys, xc, ye], fill=INK, width=1)
        d.ellipse([xc - 2, ys - 2, xc + 2, ys + 2], fill=INK)

    im_ = im
    return im_

def main():
    for case in ("drawn", "vent"):
        n = len(Z[f"{case}_t"])
        imgs = [frame(case, k) for k in range(n)]
        imgs[0].save(os.path.join(OUT, f"adsorber_{case}.png"), save_all=True,
                     append_images=imgs[1:], duration=90, loop=0)
        sm = [i.resize((W//2, H//2), Image.LANCZOS).convert("P", palette=Image.ADAPTIVE, colors=200)
              for i in imgs]
        sm[0].save(os.path.join(OUT, f"adsorber_{case}.gif"), save_all=True,
                   append_images=sm[1:], duration=90, loop=0, optimize=True)
        # stills at the hot and the cold extreme
        tm = Z[f"{case}_T_mean"]
        imgs[int(np.argmax(tm))].save(os.path.join(OUT, f"adsorber_{case}_hot.png"))
        imgs[int(np.argmin(tm))].save(os.path.join(OUT, f"adsorber_{case}_cold.png"))
        print(f"   {case}: {n} frames -> adsorber_{case}.png / .gif + 2 stills")

if __name__ == "__main__":
    main()
