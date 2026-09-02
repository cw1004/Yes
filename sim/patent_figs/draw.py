"""
특허도면 작도 툴킷.

작도 규칙 (KIPO 도면 작성 기준에 맞춤)
  · 백색 바탕에 흑색 선화만 사용한다. 색채·계조를 쓰지 않는다.
  · 선 굵기는 실선 1.1 pt, 보조선·가상선 0.8 pt 파선으로 통일한다.
  · 구성요소에는 명세서와 동일한 참조부호를 병기한다.
  · 도면 번호는 좌측 상단에 【도 N】 형식으로 표기한다.
"""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import (Arc, Circle, FancyArrowPatch, PathPatch,
                                Polygon, Rectangle)
from matplotlib.path import Path

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results",
                   "figures")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- 폰트
_KO = None
for _p in ("/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
           "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
           "/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf",
           "/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf"):
    if os.path.exists(_p):
        fm.fontManager.addfont(_p)
        if _KO is None:
            _KO = fm.FontProperties(fname=_p).get_name()
if _KO is None:
    raise RuntimeError("한글 폰트를 찾을 수 없습니다.")

# NanumGothic 에 없는 글리프(U+2212 등)는 DejaVu Sans 로 자동 대체한다.
plt.rcParams.update({
    "font.family": [_KO, "DejaVu Sans"],
    "axes.unicode_minus": False,
    # 수식(로그 눈금 지수 등)은 DejaVu 로 조판하여 U+2212 누락을 피한다.
    "mathtext.fontset": "dejavusans",
    "figure.dpi": 220,
    "savefig.dpi": 220,
    "savefig.facecolor": "white",
    "figure.facecolor": "white",
})

def _san(t):
    """NanumGothic 에 없는 글리프를 동등 글리프로 치환한다."""
    if not isinstance(t, str):
        return t
    return t.replace("\u00b5", "\u03bc").replace("\u2192", "\u27f6")


LW = 1.1          # 실선
LW_T = 0.8        # 보조선
K = "black"


# ---------------------------------------------------------------- 캔버스
def canvas(w=9.0, h=6.4):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.set_axis_off()
    ax.set_position([0.012, 0.012, 0.976, 0.94])
    return fig, ax


def caption(fig, num, title):
    """좌측 상단에 【도 N】, 그 오른쪽에 도면 제목을 배치한다."""
    w_in = fig.get_size_inches()[0]
    fig.text(0.014, 0.974, f"【도 {num}】", ha="left", va="center",
             fontsize=11.5, fontweight="bold")
    fig.text(0.014 + 0.95 / w_in, 0.974, title, ha="left", va="center",
             fontsize=9.2)


def save(fig, name):
    p = os.path.abspath(os.path.join(OUT, name))
    fig.savefig(p, bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)
    print("생성:", p)
    return p


# ---------------------------------------------------------------- 기본 도형
def box(ax, x, y, w, h, text="", ref=None, fs=8.2, dashed=False, lw=LW,
        double=False, va_top=False, align="center", pad=1.4, zorder=3):
    """좌하단 (x,y) 기준 사각형. text 는 개행 포함 가능."""
    ls = (0, (4, 2.4)) if dashed else "-"
    ax.add_patch(Rectangle((x, y), w, h, fill=True, facecolor="white",
                           edgecolor=K, lw=lw, ls=ls, zorder=zorder))
    if double:
        d = 0.9
        ax.add_patch(Rectangle((x + d, y + d), w - 2 * d, h - 2 * d, fill=False,
                               edgecolor=K, lw=LW_T, zorder=zorder + 1))
    if text:
        if align == "center":
            tx, ha = x + w / 2, "center"
        else:
            tx, ha = x + pad, "left"
        ty = (y + h - pad) if va_top else (y + h / 2)
        ax.text(tx, ty, _san(text), ha=ha, va=("top" if va_top else "center"),
                fontsize=fs, zorder=zorder + 2, linespacing=1.45)
    if ref is not None:
        ax.text(x + w - 0.9, y + 0.8, f"({ref})", ha="right", va="bottom",
                fontsize=7.0, zorder=zorder + 2)
    return (x, y, w, h)


def diamond(ax, cx, cy, w, h, text="", fs=7.6, lw=LW):
    pts = [(cx, cy + h / 2), (cx + w / 2, cy), (cx, cy - h / 2), (cx - w / 2, cy)]
    ax.add_patch(Polygon(pts, closed=True, facecolor="white", edgecolor=K,
                         lw=lw, zorder=3))
    ax.text(cx, cy, _san(text), ha="center", va="center", fontsize=fs,
            zorder=5, linespacing=1.4)
    return (cx, cy, w, h)


def rbox(ax, x, y, w, h, text="", fs=8.0, lw=LW):
    """둥근 모서리 (시작/종료 단자)."""
    r = min(h / 2, 2.2)
    v = [(x + r, y), (x + w - r, y), (x + w, y), (x + w, y + r),
         (x + w, y + h - r), (x + w, y + h), (x + w - r, y + h),
         (x + r, y + h), (x, y + h), (x, y + h - r), (x, y + r), (x, y),
         (x + r, y)]
    c = [Path.MOVETO, Path.LINETO, Path.CURVE3, Path.CURVE3, Path.LINETO,
         Path.CURVE3, Path.CURVE3, Path.LINETO, Path.CURVE3, Path.CURVE3,
         Path.LINETO, Path.CURVE3, Path.CURVE3]
    ax.add_patch(PathPatch(Path(v, c), facecolor="white", edgecolor=K, lw=lw,
                           zorder=3))
    ax.text(x + w / 2, y + h / 2, _san(text), ha="center", va="center",
            fontsize=fs, zorder=5, linespacing=1.4)


def arrow(ax, p0, p1, label=None, dashed=False, lw=LW, lp=0.5, fs=7.2,
          dx=0.0, dy=1.1, head=True, ha="center", zorder=4):
    ls = (0, (4, 2.4)) if dashed else "-"
    ax.add_patch(FancyArrowPatch(
        p0, p1, arrowstyle=("-|>" if head else "-"), mutation_scale=11,
        lw=lw, ls=ls, color=K, shrinkA=0, shrinkB=0, zorder=zorder,
        joinstyle="miter"))
    if label:
        mx = p0[0] + (p1[0] - p0[0]) * lp + dx
        my = p0[1] + (p1[1] - p0[1]) * lp + dy
        ax.text(mx, my, _san(label), ha=ha, va="center", fontsize=fs,
                zorder=zorder + 2,
                bbox=dict(fc="white", ec="none", pad=0.9), linespacing=1.35)


def poly(ax, pts, label=None, dashed=False, lw=LW, li=None, fs=7.2,
         dx=0.0, dy=1.1, head=True, ha="center"):
    """직교 배선. pts = [(x,y), ...] 마지막 구간에 화살촉."""
    ls = (0, (4, 2.4)) if dashed else "-"
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ax.plot(xs[:-1], ys[:-1], color=K, lw=lw, ls=ls, solid_joinstyle="miter",
            zorder=4)
    arrow(ax, pts[-2], pts[-1], dashed=dashed, lw=lw, head=head)
    if label:
        i = li if li is not None else max(len(pts) // 2 - 1, 0)
        mx = (pts[i][0] + pts[i + 1][0]) / 2 + dx
        my = (pts[i][1] + pts[i + 1][1]) / 2 + dy
        ax.text(mx, my, _san(label), ha=ha, va="center", fontsize=fs, zorder=6,
                bbox=dict(fc="white", ec="none", pad=0.9), linespacing=1.35)


def and_gate(ax, cx, cy, s=4.2, label="&"):
    """IEC 형식 AND 게이트 (D 형상)."""
    hw, hh = s * 0.52, s * 0.62
    x0, y0 = cx - hw, cy - hh
    v = [(x0, y0), (x0, y0 + 2 * hh), (cx, y0 + 2 * hh), (cx + hw, y0 + 2 * hh),
         (cx + hw, cy), (cx + hw, y0), (cx, y0), (x0, y0)]
    c = [Path.MOVETO, Path.LINETO, Path.LINETO, Path.CURVE3, Path.CURVE3,
         Path.CURVE3, Path.CURVE3, Path.LINETO]
    ax.add_patch(PathPatch(Path(v, c), facecolor="white", edgecolor=K, lw=LW,
                           zorder=5))
    ax.text(cx - hw * 0.15, cy, label, ha="center", va="center", fontsize=9.5,
            zorder=7, fontweight="bold")
    return dict(inL=(x0, cy), inL1=(x0, cy + hh * 0.5), inL2=(x0, cy - hh * 0.5),
                out=(cx + hw, cy))


def note(ax, x, y, text, fs=7.0, ha="left", va="center", box_=False, style="italic"):
    kw = dict(fontsize=fs, ha=ha, va=va, zorder=8, linespacing=1.4)
    if style == "italic":
        kw["style"] = "italic"
    if box_:
        kw["bbox"] = dict(fc="white", ec=K, lw=LW_T, pad=2.4)
    ax.text(x, y, _san(text), **kw)


def brace(ax, x, y0, y1, text="", side="left", fs=7.2, w=1.6):
    """세로 중괄호."""
    s = -1 if side == "left" else 1
    ym = (y0 + y1) / 2
    for a, b in ((y0, ym), (y1, ym)):
        ax.plot([x, x + s * w], [a, a], color=K, lw=LW_T, zorder=4)
    ax.plot([x + s * w, x + s * w], [y0, y1], color=K, lw=LW_T, zorder=4)
    ax.plot([x + s * w, x + s * w * 1.9], [ym, ym], color=K, lw=LW_T, zorder=4)
    if text:
        ax.text(x + s * w * 2.3, ym, _san(text), ha=("right" if s < 0 else "left"),
                va="center", fontsize=fs, zorder=6, linespacing=1.4)


def dot(ax, x, y, r=0.55):
    ax.add_patch(Circle((x, y), r, facecolor=K, edgecolor=K, zorder=6))


# ---------------------------------------------------------------- 회로 소자
def igbt(ax, x, y, s=1.0, flip=False):
    """IGBT + 역병렬 다이오드. (x,y) 는 소자 중심. 세로 방향 도통."""
    h = 3.2 * s
    w = 2.4 * s
    ax.plot([x, x], [y - h / 2, y - h * 0.22], color=K, lw=LW, zorder=4)
    ax.plot([x, x], [y + h * 0.22, y + h / 2], color=K, lw=LW, zorder=4)
    ax.plot([x - w * 0.42, x - w * 0.42], [y - h * 0.30, y + h * 0.30],
            color=K, lw=LW, zorder=4)          # 게이트 판
    ax.plot([x - w * 0.72, x - w * 0.42], [y, y], color=K, lw=LW, zorder=4)
    ax.plot([x - w * 0.28, x], [y - h * 0.28, y - h * 0.22], color=K, lw=LW,
            zorder=4)
    ax.plot([x - w * 0.28, x], [y + h * 0.28, y + h * 0.22], color=K, lw=LW,
            zorder=4)
    ax.plot([x - w * 0.28, x - w * 0.28], [y - h * 0.30, y + h * 0.30],
            color=K, lw=LW, zorder=4)
    # 역병렬 다이오드
    dx = x + w * 0.62
    ax.plot([x, dx], [y + h / 2 * 0.92, y + h / 2 * 0.92], color=K, lw=LW_T, zorder=4)
    ax.plot([x, dx], [y - h / 2 * 0.92, y - h / 2 * 0.92], color=K, lw=LW_T, zorder=4)
    ax.plot([dx, dx], [y - h / 2 * 0.92, y - h * 0.16], color=K, lw=LW_T, zorder=4)
    ax.plot([dx, dx], [y + h * 0.16, y + h / 2 * 0.92], color=K, lw=LW_T, zorder=4)
    tri = [(dx - w * 0.26, y + h * 0.16), (dx + w * 0.26, y + h * 0.16),
           (dx, y - h * 0.16)]
    ax.add_patch(Polygon(tri, closed=True, facecolor="white", edgecolor=K,
                         lw=LW_T, zorder=4))
    ax.plot([dx - w * 0.26, dx + w * 0.26], [y - h * 0.16, y - h * 0.16],
            color=K, lw=LW_T, zorder=4)


def cap(ax, x, y, s=1.0, horiz=False):
    g = 0.6 * s
    p = 2.0 * s
    if horiz:
        ax.plot([x - g, x - g], [y - p, y + p], color=K, lw=LW * 1.3, zorder=4)
        ax.plot([x + g, x + g], [y - p, y + p], color=K, lw=LW * 1.3, zorder=4)
    else:
        ax.plot([x - p, x + p], [y + g, y + g], color=K, lw=LW * 1.3, zorder=4)
        ax.plot([x - p, x + p], [y - g, y - g], color=K, lw=LW * 1.3, zorder=4)


def motor(ax, cx, cy, r=5.0, text="M\n3~"):
    ax.add_patch(Circle((cx, cy), r, facecolor="white", edgecolor=K, lw=LW,
                        zorder=4))
    ax.text(cx, cy, text, ha="center", va="center", fontsize=8.5, zorder=6,
            linespacing=1.25)


def fuse(ax, x, y, s=1.0, horiz=False):
    w, h = (3.4 * s, 1.7 * s) if horiz else (1.7 * s, 3.4 * s)
    ax.add_patch(Rectangle((x - w / 2, y - h / 2), w, h, facecolor="white",
                           edgecolor=K, lw=LW, zorder=5))
    if horiz:
        ax.plot([x - w / 2, x + w / 2], [y, y], color=K, lw=LW_T, zorder=6)
    else:
        ax.plot([x, x], [y - h / 2, y + h / 2], color=K, lw=LW_T, zorder=6)


def switch_bi(ax, x, y, s=1.0, horiz=True, label=None):
    """양방향 차단 소자 (역직렬 반도체 스위치) 기호."""
    w, a, b = 4.4 * s, 1.3 * s, 0.9 * s
    if horiz:
        ax.plot([x - w / 2, x - w * 0.18], [y, y], color=K, lw=LW, zorder=4)
        ax.plot([x + w * 0.18, x + w / 2], [y, y], color=K, lw=LW, zorder=4)
        ax.add_patch(Rectangle((x - w * 0.18, y - a), w * 0.36, 2 * a,
                               facecolor="white", edgecolor=K, lw=LW, zorder=5))
        ax.plot([x - w * 0.10, x + w * 0.10], [y - b, y + b], color=K, lw=LW_T,
                zorder=6)
        ty = y + a + 0.6
    else:
        ax.plot([x, x], [y - w / 2, y - w * 0.18], color=K, lw=LW, zorder=4)
        ax.plot([x, x], [y + w * 0.18, y + w / 2], color=K, lw=LW, zorder=4)
        ax.add_patch(Rectangle((x - a, y - w * 0.18), 2 * a, w * 0.36,
                               facecolor="white", edgecolor=K, lw=LW, zorder=5))
        ax.plot([x - b, x + b], [y - w * 0.10, y + w * 0.10], color=K, lw=LW_T,
                zorder=6)
        ty = y + w / 2 + 0.6
    if label:
        ax.text(x, ty, label, ha="center", va="bottom", fontsize=7.0, zorder=6)


def hop(ax, x, y, r=1.1, horiz=True):
    """배선 교차부의 점프 기호 (접속이 아님을 명시)."""
    th = np.linspace(0, np.pi, 40)
    if horiz:
        ax.plot(x + r * np.cos(th), y + r * np.sin(th), color=K, lw=LW, zorder=7)
    else:
        ax.plot(x + r * np.sin(th), y + r * np.cos(th), color=K, lw=LW, zorder=7)


def wire(ax, pts, lw=LW, dashed=False):
    ls = (0, (4, 2.4)) if dashed else "-"
    ax.plot([p[0] for p in pts], [p[1] for p in pts], color=K, lw=lw, ls=ls,
            solid_joinstyle="miter", zorder=4)


def xmark(ax, x, y, s=1.6):
    ax.plot([x - s, x + s], [y - s, y + s], color=K, lw=LW * 1.2, zorder=8)
    ax.plot([x - s, x + s], [y + s, y - s], color=K, lw=LW * 1.2, zorder=8)


def sw_open(ax, x, y, s=1.0, horiz=True):
    """개방된 직렬 차단 소자 (개폐기 기호)."""
    w = 4.6 * s
    if horiz:
        ax.plot([x - w / 2, x - w * 0.22], [y, y], color=K, lw=LW, zorder=4)
        ax.plot([x + w * 0.22, x + w / 2], [y, y], color=K, lw=LW, zorder=4)
        ax.plot([x - w * 0.22, x + w * 0.16], [y, y + w * 0.34], color=K, lw=LW,
                zorder=4)
        dot(ax, x - w * 0.22, y, 0.4); dot(ax, x + w * 0.22, y, 0.4)
    else:
        ax.plot([x, x], [y - w / 2, y - w * 0.22], color=K, lw=LW, zorder=4)
        ax.plot([x, x], [y + w * 0.22, y + w / 2], color=K, lw=LW, zorder=4)
        ax.plot([x, x + w * 0.34], [y - w * 0.22, y + w * 0.16], color=K, lw=LW,
                zorder=4)
        dot(ax, x, y - w * 0.22, 0.4); dot(ax, x, y + w * 0.22, 0.4)
