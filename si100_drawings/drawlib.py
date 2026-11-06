"""A3 도면용 최소 그리기 도구 (matplotlib, 용지 좌표 mm)."""

from __future__ import annotations

import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyArrowPatch, Polygon, Rectangle

plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["hatch.linewidth"] = 0.3

W, H = 420.0, 297.0
INK = "#1d2430"
THIN, MED, BOLD = 0.25, 0.5, 0.9
FILL = "#eef1f5"
DATE = "2026-11-06"
REV = "A"


class Sheet:
    def __init__(self, n: int, total: int, title: str, subtitle: str, dwg: str, scale: str,
                 project: str = "SI-100 태양열 흡착식 제빙기 · 시제품 1 m²", rev: str = REV, date: str = DATE,
                 warning: str = "AI 보조 초안 — 자격 있는 설계자의 검토·승인 전 제작 금지 · 수치는 평형 시뮬레이션 기반"):
        self.project, self.rev, self.date, self.warning = project, rev, date, warning
        self.fig = plt.figure(figsize=(W / 25.4, H / 25.4))
        self.ax = self.fig.add_axes([0, 0, 1, 1])
        self.ax.set_xlim(0, W)
        self.ax.set_ylim(0, H)
        self.ax.set_aspect("equal")
        self.ax.axis("off")
        self._frame(n, total, title, subtitle, dwg, scale)

    # ── 기본 요소 ─────────────────────────────────────────
    def line(self, x1, y1, x2, y2, lw=MED, color=INK, ls="-"):
        self.ax.plot([x1, x2], [y1, y2], color=color, lw=lw, ls=ls, solid_capstyle="butt")

    def poly(self, pts, lw=MED, fill="none", hatch=None, closed=True, color=INK, ls="-"):
        self.ax.add_patch(Polygon(pts, closed=closed, fill=fill != "none", facecolor=fill if fill != "none" else "none",
                                  edgecolor=color, lw=lw, hatch=hatch, ls=ls))

    def rect(self, x, y, w, h, lw=MED, fill="none", hatch=None, color=INK, ls="-"):
        self.ax.add_patch(Rectangle((x, y), w, h, fill=fill != "none", facecolor=fill if fill != "none" else "none",
                                    edgecolor=color, lw=lw, hatch=hatch, ls=ls))

    def circle(self, x, y, r, lw=MED, fill="none", hatch=None, color=INK, ls="-"):
        self.ax.add_patch(Circle((x, y), r, fill=fill != "none", facecolor=fill if fill != "none" else "none",
                                 edgecolor=color, lw=lw, hatch=hatch, ls=ls))

    def text(self, x, y, s, size=6.0, ha="left", va="center", weight="normal", color=INK, rot=0, style="normal"):
        self.ax.text(x, y, s, fontsize=size, ha=ha, va=va, fontweight=weight, color=color,
                     rotation=rot, fontstyle=style)

    def arrow(self, x1, y1, x2, y2, lw=THIN, color=INK, head=3.0):
        self.ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=f"-|>,head_length={head * 0.28},head_width={head * 0.12}",
                                          mutation_scale=10, lw=lw, color=color, shrinkA=0, shrinkB=0))

    def centerline(self, x1, y1, x2, y2):
        self.line(x1, y1, x2, y2, lw=THIN, ls=(0, (8, 2, 1, 2)), color="#6b7686")

    # ── 치수·지시 ─────────────────────────────────────────
    def dim_h(self, x1, x2, y, ext_from, label, size=5.5, above=True):
        """수평 치수. ext_from: 치수보조선 시작 y."""
        for x in (x1, x2):
            self.line(x, ext_from, x, y + (1.2 if y >= ext_from else -1.2), lw=THIN)
        self._dimline(x1, y, x2, y)
        self.text((x1 + x2) / 2, y + (1.6 if above else -1.8), label, size=size, ha="center",
                  va="bottom" if above else "top")

    def dim_v(self, y1, y2, x, ext_from, label, size=5.5, left=True):
        for y in (y1, y2):
            self.line(ext_from, y, x + (1.2 if x >= ext_from else -1.2), y, lw=THIN)
        self._dimline(x, y1, x, y2)
        self.text(x + (-1.6 if left else 1.6), (y1 + y2) / 2, label, size=size,
                  ha="right" if left else "left", rot=90 if False else 0)

    def _dimline(self, x1, y1, x2, y2):
        self.arrow((x1 + x2) / 2, (y1 + y2) / 2, x1, y1, head=2.2)
        self.arrow((x1 + x2) / 2, (y1 + y2) / 2, x2, y2, head=2.2)

    def leader(self, x_tip, y_tip, x_txt, y_txt, label, size=5.5, ha="left"):
        self.line(x_txt, y_txt, x_tip, y_tip, lw=THIN)
        self.circle(x_tip, y_tip, 0.45, lw=THIN, fill=INK)
        w = 1.5 if ha == "left" else -1.5
        self.line(x_txt, y_txt, x_txt + w * 2, y_txt, lw=THIN)
        self.text(x_txt + w * 2.6, y_txt, label, size=size, ha=ha)

    def balloon(self, x, y, n, x_tip=None, y_tip=None):
        if x_tip is not None:
            ang = math.atan2(y_tip - y, x_tip - x)
            self.line(x + 3.2 * math.cos(ang), y + 3.2 * math.sin(ang), x_tip, y_tip, lw=THIN)
            self.circle(x_tip, y_tip, 0.45, lw=THIN, fill=INK)
        self.circle(x, y, 3.2, lw=MED, fill="white")
        self.text(x, y, str(n), size=5.5, ha="center", weight="bold")

    def heading(self, x, y, s, sub=None, size=9.0):
        self.text(x, y, s, size=size, ha="center", weight="bold")
        self.line(x - len(s) * size * 0.19, y - 2.6, x + len(s) * size * 0.19, y - 2.6, lw=MED)
        if sub:
            self.text(x, y - 5.5, sub, size=5.0, ha="center", color="#4a5568")

    def table(self, x, y_top, widths, rows, title=None, row_h=4.6, size=5.2, bold_rows=(), aligns=None):
        """rows[0] = 머리행. 표 아래 y 를 돌려준다."""
        total = sum(widths)
        y = y_top
        if title:
            self.rect(x, y - row_h - 0.6, total, row_h + 0.6, lw=MED, fill="#e3e8ef")
            self.text(x + 1.8, y - (row_h + 0.6) / 2, title, size=size + 0.6, weight="bold")
            y -= row_h + 0.6
        aligns = aligns or ["left"] * len(widths)
        for i, row in enumerate(rows):
            fill = "#f2f4f7" if i == 0 else ("#fafbfc" if i % 2 == 0 else "white")
            self.rect(x, y - row_h, total, row_h, lw=THIN, fill=fill)
            cx = x
            for j, (w, cell) in enumerate(zip(widths, row)):
                if j:
                    self.line(cx, y, cx, y - row_h, lw=THIN)
                a = aligns[j]
                tx = cx + 1.5 if a == "left" else (cx + w / 2 if a == "center" else cx + w - 1.5)
                self.text(tx, y - row_h / 2, str(cell), size=size, ha=a,
                          weight="bold" if i == 0 or i in bold_rows else "normal")
                cx += w
            y -= row_h
        self.rect(x, y, total, y_top - y, lw=MED)
        return y

    def notes(self, x, y_top, title, items, width=180, size=5.2, gap=4.4):
        self.text(x, y_top, title, size=size + 0.8, weight="bold")
        self.line(x, y_top - 2.4, x + width, y_top - 2.4, lw=MED)
        y = y_top - 6.5
        for i, it in enumerate(items, 1):
            lines = it if isinstance(it, (list, tuple)) else [it]
            self.text(x, y, f"{i}.", size=size, weight="bold")
            for ln in lines:
                self.text(x + 4.5, y, ln, size=size)
                y -= gap * 0.85
            y -= gap * 0.25
        return y

    # ── 틀·표제란 ─────────────────────────────────────────
    def _frame(self, n, total, title, subtitle, dwg, scale):
        self.rect(5, 5, W - 10, H - 10, lw=BOLD)
        self.rect(10, 10, W - 20, H - 20, lw=THIN)
        for i, c in enumerate("ABCDEFGH"):
            x = 10 + (W - 20) * (i + 0.5) / 8
            self.text(x, 7.5, c, size=5, ha="center", color="#6b7686")
            self.text(x, H - 7.5, c, size=5, ha="center", color="#6b7686")
        for i in range(6):
            y = 10 + (H - 20) * (i + 0.5) / 6
            self.text(7.5, y, str(6 - i), size=5, ha="center", color="#6b7686")
            self.text(W - 7.5, y, str(6 - i), size=5, ha="center", color="#6b7686")
        x0, y0, w = 250.0, 10.0, 160.0
        self.rect(x0, y0, w, 44, lw=BOLD, fill="white")
        self.line(x0, y0 + 37, x0 + w, y0 + 37, lw=MED)
        self.text(x0 + 3, y0 + 40.5, self.project, size=6.2, weight="bold")
        self.text(x0 + w - 3, y0 + 40.5, "ISO 128 / ISO 2768-mK", size=4.8, ha="right")
        self.line(x0, y0 + 19, x0 + w, y0 + 19, lw=MED)
        self.line(x0 + 112, y0 + 9, x0 + 112, y0 + 37, lw=MED)
        self.text(x0 + 3, y0 + 34, "TITLE", size=4.2, color="#6b7686")
        self.text(x0 + 3, y0 + 27.5, title, size=9.5, weight="bold")
        self.text(x0 + 3, y0 + 21.5, subtitle, size=4.6, color="#4a5568")
        self.text(x0 + 115, y0 + 34, "SCALE", size=4.2, color="#6b7686")
        self.text(x0 + 115, y0 + 27.5, scale, size=8.5, weight="bold")
        self.text(x0 + 140, y0 + 34, "UNITS", size=4.2, color="#6b7686")
        self.text(x0 + 140, y0 + 27.5, "mm", size=8.5, weight="bold")
        self.text(x0 + 115, y0 + 21.5, "3각법", size=4.4, color="#4a5568")
        self.line(x0, y0 + 9, x0 + w, y0 + 9, lw=MED)
        self.text(x0 + 3, y0 + 14, "DWG No.", size=4.2, color="#6b7686")
        self.text(x0 + 22, y0 + 14, dwg, size=9.5, weight="bold")
        self.text(x0 + 115, y0 + 14, "REV", size=4.2, color="#6b7686")
        self.text(x0 + 125, y0 + 14, self.rev, size=9.5, weight="bold")
        self.text(x0 + 137, y0 + 14, "SHEET", size=4.2, color="#6b7686")
        self.text(x0 + 157, y0 + 14, f"{n} / {total}", size=8.5, weight="bold", ha="right")
        cols = [("DRAWN", "AI 보조 초안"), ("CHECKED", "— 검토 전 —"), ("APPROVED", "— 미승인 —"),
                ("MATERIAL", "BOM 참조"), ("DATE", self.date)]
        cw = w / len(cols)
        for i, (k, v) in enumerate(cols):
            cx = x0 + i * cw
            if i:
                self.line(cx, y0, cx, y0 + 9, lw=THIN)
            self.text(cx + 1.5, y0 + 6.6, k, size=3.8, color="#6b7686")
            self.text(cx + 1.5, y0 + 2.8, v, size=4.8)
        # 제작 금지 표시
        self.rect(10, 10, 236, 7, lw=MED, fill="#fdf1ef", color="#a83226")
        self.text(128, 13.5, self.warning, size=5.6, ha="center", weight="bold", color="#a83226")

    def save(self, pdf):
        pdf.savefig(self.fig)
        plt.close(self.fig)
