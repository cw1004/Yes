#!/usr/bin/env python3
"""Colour: one-hue sequential ramp built in OKLCH (guaranteed monotonic L,
constant hue - never a rainbow), plus the validated categorical trio."""
import math

# --- categorical series slots 1-3, validated by the dataviz validator ---
SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a"]   # die, plate, coolant out
SERIES_DARK  = ["#3987e5", "#d95926", "#199e70"]
SURF_LIGHT, SURF_DARK = "#fcfcfb", "#1a1a19"

def _f(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def _g(c): return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055

def oklch_to_srgb(L, C, h_deg):
    h = math.radians(h_deg)
    a, b = C*math.cos(h), C*math.sin(h)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bl=-0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(_g(v) for v in (r,g,bl))

def in_gamut(rgb, eps=1e-4):
    return all(-eps <= v <= 1+eps for v in rgb)

def oklch_hex(L, C, h):
    """Reduce chroma until the colour is inside sRGB, then quantise."""
    lo, hi = 0.0, C
    for _ in range(40):
        mid = (lo+hi)/2
        if in_gamut(oklch_to_srgb(L, mid, h)): lo = mid
        else: hi = mid
    r,g,b = oklch_to_srgb(L, lo, h)
    return tuple(max(0,min(255,int(round(v*255)))) for v in (r,g,b))

THERMAL_HUE = 42.0          # one hue, warm - reads as temperature

def thermal_ramp(n=256, L_hi=0.972, L_lo=0.34, C=0.19):
    """Sequential: one hue, light -> dark, monotonic in OKLCH lightness.

    Chroma rises from 0 at the light end (so 'near zero' recedes toward the
    surface) and is held at the dark end, where the hue must stay legible -
    the hottest cells are the ones being read. Out-of-gamut chroma is clipped
    per step, which cannot change hue or lightness."""
    out = []
    for i in range(n):
        f = i/(n-1)
        L = L_hi + (L_lo-L_hi)*f
        c = C*(f**0.40)
        out.append(oklch_hex(L, c, THERMAL_HUE))
    return out

def hx(t): return "#%02x%02x%02x" % t

if __name__ == "__main__":
    r = thermal_ramp(9)
    print("one-hue sequential ramp, light -> dark, hue %.0f deg:" % THERMAL_HUE)
    for i,c in enumerate(r): print(f"   step {i}: {hx(c)}  rgb{c}")
    # monotonicity check in relative luminance
    def lum(c):
        R,G,B=[_f(v/255) for v in c]; return 0.2126*R+0.7152*G+0.0722*B
    ls=[lum(c) for c in r]
    print("\nluminance:", " ".join(f"{v:.3f}" for v in ls))
    print("monotonic decreasing:", all(ls[i]>ls[i+1] for i in range(len(ls)-1)))
