"""VC-100 Rev B 변경 도면 세트 (A3, 5장).

Rev A 대비 바뀐 도면만 다시 발행한다. VC-101·102·202·400 은 Rev A 그대로 유효.
실행: python -m vc100_drawings.make_revb  →  output/vc100/VC100_drawingset_RevB.pdf
"""

from __future__ import annotations

from pathlib import Path

from matplotlib.backends.backend_pdf import PdfPages

from si100_drawings.drawlib import BOLD, FILL, INK, MED, THIN, Sheet
from vc100_sim import model as M

from . import design_b as D

OUT = Path("output/vc100")
TOTAL = 5
DATE = "2026-11-06"
PROJECT = "INDIA-VC THERMAL HARDWARE · VC-100 Rev B"
WARN = "Rev B — AI 보조 초안 · 성능은 시뮬레이션(실측 전) · 검토·승인과 VC-500 시험 합격 전 양산 금지"
CHANGED = "#fff4cc"
B = D.B
P2 = D.PERF[1]


def sheet(n, title, subtitle, dwg, scale):
    return Sheet(n, TOTAL, title, subtitle, dwg, scale, project=PROJECT, rev="B", date=DATE, warning=WARN)


def tag(s, x, y, text="Rev B"):
    s.rect(x, y - 2.2, len(text) * 1.6 + 2.5, 4.4, lw=MED, fill=CHANGED, color="#b07d00")
    s.text(x + 1.2, y, text, size=4.6, weight="bold", color="#7a5600")


# ════════════════════════════════════════════════════════════
# 1. 조립도 Rev B
# ════════════════════════════════════════════════════════════
def sheet_ga(pdf):
    s = sheet(1, "GENERAL ASSEMBLY — Rev B", "VAPOUR CHAMBER + FIN STACK / Cu-H2O / 68 × 68 × 27.1 / 핀 납땜 접합",
              "VC-100", "3:1")
    S, OX, OY = 3.0, 30.0, 166.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(OX + 52, 280, "SECTION X–X (HALF, FROM CENTRELINE)", "3:1 · 아래 = 다이 쪽")
    # 바닥·림
    s.rect(*P(0, 0), 34 * S, 1.0 * S, lw=MED, fill="#e8d2bf", hatch="////")
    s.rect(*P(30, 1.0), 4 * S, 3.0 * S, lw=MED, fill="#e8d2bf", hatch="////")
    # 바닥 윅 / 뚜껑 윅
    s.rect(*P(0, 1.0), 30 * S, D.WICK_A_THK * S, lw=THIN, fill="#c9d6e3", hatch="....")
    s.rect(*P(0, 3.8), 30 * S, 0.20 * S, lw=THIN, fill="#c9d6e3", hatch="....")
    s.rect(*P(29.7, 1.0), 0.3 * S, 3.0 * S, lw=THIN, fill="#c9d6e3")
    # 기둥
    for xc in (3, 9, 15, 21, 27):
        s.rect(*P(xc - 1, 1.0), 2 * S, 3.0 * S, lw=MED, fill="#e8d2bf", hatch="////")
    # 뚜껑, 땜납, 핀 바닥, 핀
    s.rect(*P(0, 4.0), 34 * S, 1.0 * S, lw=MED, fill="#e8d2bf", hatch="////")
    s.rect(*P(0, 5.0), 34 * S, 0.1 * S, lw=MED, fill="#7a7a7a")
    s.rect(*P(0, 5.1), 34 * S, 2.0 * S, lw=MED, fill="#dfe4ea", hatch="\\\\\\\\")
    for k in range(B.n_fins // 2):
        xc = 1 + 2 * k
        s.rect(*P(xc - 0.15, 7.1), 0.3 * S, 20 * S, lw=THIN, fill="#b8c2cd")
    s.centerline(*P(0, -2), *P(0, 29))
    s.text(*P(0, 30), "CL", size=5, ha="center", color="#6b7686")
    s.dim_v(P(0, 0)[1], P(0, 27.1)[1], P(-4, 0)[0], P(0, 0)[0], "27.1")
    lx = P(37, 0)[0]
    layers = ((17, f"핀 {B.n_fins} × t{B.t_fin * 1e3:.1f} @ {B.pitch * 1e3:.1f} (VC-201 Rev B)", True),
              (6.1, "핀 바닥 2.0, 무전해 Ni 5 µm", True),
              (5.05, "땜납 Sn-5Sb 0.1 (TIM 패드 삭제)", True),
              (4.5, "뚜껑 Cu 1.0 (VC-102 Rev A)", False),
              (3.9, "뚜껑 윅 C 0.20", False),
              (2.55, f"증기층 {D.VAPOUR_CORE:.2f} (Rev A 2.40)", True),
              (1.15, f"바닥 윅 A {D.WICK_A_THK:.2f} (Rev A 0.40)", True),
              (0.5, "바닥 Cu 1.0 (VC-101 Rev A)", False))
    ty = [P(0, 17)[1]] + [P(0, 11.5)[1] - 5.2 * i for i in range(7)]
    for (yv, lab, changed), yt in zip(layers, ty):
        s.leader(P(31.5 if yv < 8 else 25, yv)[0], P(0, yv)[1], lx, yt, lab, size=4.8)
        if changed:
            tag(s, lx + 72, yt)

    # 열저항 네트워크
    s.text(16, 150, "THERMAL RESISTANCE NETWORK — Rev B (K/W)", size=6.5, weight="bold")
    x = 16.0
    for name, val in D.NET_B:
        hot = name in ("EVAP", "SOLDER", "FIN→AIR")
        s.rect(x, 128, 20.5, 15, lw=MED, fill=CHANGED if hot else ("#eef1f5" if name in ("DIE", "AIR") else "white"))
        s.text(x + 10.25, 138.5, name, size=4.6, ha="center", weight="bold")
        s.text(x + 10.25, 132.5, val, size=4.6, ha="center")
        if name != "AIR":
            s.line(x + 20.5, 135.5, x + 23, 135.5, lw=MED)
        x += 23
    s.text(16, 122, f"합계 R(j-a) = {P2['r_b']:.3f} K/W → Q = {P2['q_b']:.0f} W @ Tj 100 °C / 공기 25 °C "
                    f"(팬 전력 {P2['fan_mw']:.0f} mW = Rev A 2 m/s 와 동일)", size=5.6, weight="bold")
    s.text(16, 117, f"Rev A: {P2['r_a']:.3f} K/W → {P2['q_a']:.0f} W (모델) / 113 W (도면). 노란 칸 = Rev B 변경 항목.",
           size=5.0, color="#4a5568")

    # 변경 내역 (ECN)
    s.table(14, 110, [8, 22, 52, 62, 88], [
        ["No", "도면", "Rev A", "Rev B", "이유 · 효과 (같은 팬 전력, 시뮬레이션)"],
        ["1", "VC-201", "43핀 t0.40 @1.5 (간격 1.1)", f"{B.n_fins}핀 t0.30 @2.0 (간격 {B.gap * 1e3:.1f})",
         "압력손실 28→18 Pa로 풍량 증가. 핀 −28 g. +16 W"],
        ["2", "VC-204", "PCM 패드 0.2 (0.011 K/W)", "Sn-5Sb 땜납 0.1 (≈0.002 K/W)", "접합 저항 감소. +2 W"],
        ["3", "VC-103", "바닥 윅 A 0.40", f"바닥 윅 A {D.WICK_A_THK:.2f} ± 0.05", f"증발 저항 0.100→0.075. 모세관 {D.CAP_LIMIT:.0f} W 유지. +5 W"],
        ["4", "VC-300", "충전 1.90 mL", f"충전 {D.CHARGE_ML:.2f} mL", f"윅 공극 {D.A_WICK_VOID_ML:.2f}→{D.WICK_VOID_ML:.2f} mL, 125 % 유지"],
        ["5", "VC-300", "—", "핀 납땜 공정 추가 (충전 전)", "물 충전 후 260 °C 가열 시 챔버 파열 → 반드시 충전 전"],
        ["6", "VC-100", "윅 0.40 미만 금지", "윅 0.25 미만 금지", "모세관 여유 ≥ 3배 기준으로 재설정"],
        ["7", "VC-500", "—", "신규: 비교 실증 시험", "Rev A·B 같은 팬으로 측정, 합격 시 양산 승인"],
    ], title="ENGINEERING CHANGE — Rev A → Rev B", aligns=["center", "left", "left", "left", "left"], size=4.7,
        row_h=4.4)

    y = s.table(250, 285, [8, 19, 64, 10, 59], [
        ["No", "PART", "DESCRIPTION", "QTY", "MATERIAL · MASS"],
        ["1", "VC-101", "CHAMBER BASE (Rev A)", "1", "Cu C1100 · 77.4 g"],
        ["2", "VC-102", "CHAMBER LID (Rev A)", "1", "Cu C1100 · 41.4 g"],
        ["3", "VC-103 B", f"SINTERED WICK, 바닥 A {D.WICK_A_THK:.2f}", "1", f"Cu 45–75 µm · {D.WICK_G:.1f} g"],
        ["4", "VC-201 B", f"FIN STACK {B.n_fins} FIN @2.0, Ni 도금", "1", f"Al 1100-H14 · {D.FIN_STACK_G:.1f} g"],
        ["4A", "VC-202", "FIN STACK 13 FIN 무팬 (Rev A)", "1", "Al 1100-H14 · 72.7 g"],
        ["5", "VC-207", "SOLDER PREFORM 68×68×0.1", "1", f"Sn-5Sb · {D.SOLDER_G:.1f} g"],
        ["6", "VC-205", "PINCH-OFF TUBE (Rev A)", "1", "Cu C1100 · 1.2 g"],
        ["7", "VC-206", "WORKING FLUID", f"{D.CHARGE_ML:.2f} mL", "DI H₂O, 탈기"],
    ], title="BILL OF MATERIALS — VC-100 Rev B", aligns=["center", "left", "left", "center", "left"], size=4.7,
        row_h=4.3)
    s.text(407, y - 3, f"충전 후 총 질량 {D.MASS_G:.0f} g (Config A) — Rev A 218 g", size=5.2, ha="right", weight="bold")

    rows = [["팬 전력 (Rev A 풍속)", "Rev A", "Rev B", "Rev B 풍속", "ΔP A→B", "B @Tj85"]]
    for p in D.PERF:
        rows.append([f"{p['fan_mw']:.0f} mW ({p['v_a']:.0f} m/s)", f"{p['q_a']:.0f} W", f"{p['q_b']:.0f} W",
                     f"{p['v_b']:.2f} m/s", f"{p['dp_a']:.0f}→{p['dp_b']:.0f} Pa", f"{p['q_b85']:.0f} W"])
    rows.append(["Config B 무팬 (VC-202)", "16.5 W", "변경 없음", "—", "—", "VC-500 T4"])
    y = s.table(250, y - 8, [40, 20, 22, 26, 30, 22], rows,
                title="PERFORMANCE — 20×20 다이, Tj 100 °C, 공기 25 °C (시뮬레이션)", size=4.7, row_h=4.3,
                aligns=["left", "right", "right", "right", "right", "right"], bold_rows=(2,))
    s.notes(250, y - 6, "GENERAL NOTES — Rev B", [
        "Rev A 도면 중 VC-101·102·202·400 은 그대로 유효.",
        ["성능은 vc100_sim 모델값 (도면 Rev A 강제 공냉 3점을 ±3 %로 재현).", "양산 승인은 VC-500 실측 합격 후."],
        ["모세관 한계 (수직, 최악): " + f"{D.CAP_LIMIT:.0f} W — 설계 최대 167 W의 {D.CAP_LIMIT / 167:.1f}배.",
         "바닥 윅 0.25 미만 금지."],
        "핀 납땜은 물 충전 전에만 (VC-300 Rev B 7단계).",
    ], width=160, size=4.8, gap=4.0)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 2. 소결 윅 Rev B
# ════════════════════════════════════════════════════════════
def sheet_wick(pdf):
    s = sheet(2, "SINTERED WICK — Rev B", "IN-SITU SINTERED Cu POWDER / 바닥 윅 A 0.40 → 0.30", "VC-103", "30:1")
    S, OX, OY = 30.0, 40.0, 150.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(120, 280, "WICK ZONE SECTION — Rev B", "30:1 · 림 부근")
    s.rect(*P(0, 0), 1.2 * S, 3.0 * S, lw=MED, fill="#e8d2bf", hatch="////")              # 림
    s.rect(*P(0, 3.0), 5.0 * S, 0.0001, lw=MED)
    s.rect(*P(0, -0.0), 5.0 * S, 0.0001, lw=MED)
    s.rect(*P(1.2, 0), 0.30 * S, 2.8 * S, lw=THIN, fill="#c9d6e3", hatch="....")          # B
    s.rect(*P(1.2, 0), 3.8 * S, D.WICK_A_THK * S, lw=THIN, fill=CHANGED, hatch="....")    # A
    s.rect(*P(1.2, 2.8), 3.8 * S, 0.20 * S, lw=THIN, fill="#c9d6e3", hatch="....")        # C
    s.rect(*P(0, 3.0), 5.0 * S, 0.12 * S, lw=MED, fill="#e8d2bf")
    s.rect(*P(0, -0.12), 5.0 * S, 0.12 * S, lw=MED, fill="#e8d2bf")
    s.line(*P(0, 3.0), *P(1.2, 3.0), lw=1.6, color="#2e7d4f")
    s.text(*P(3.2, 1.55), f"VAPOUR CORE {D.VAPOUR_CORE:.2f}", size=6, ha="center")
    s.text(*P(3.2, 0.15), "A", size=7, ha="center", weight="bold")
    s.text(*P(1.35, 1.6), "B", size=7, ha="center", weight="bold")
    s.text(*P(3.2, 2.9), "C", size=7, ha="center", weight="bold")
    s.dim_v(P(0, 0)[1], P(0, D.WICK_A_THK)[1], P(5.4, 0)[0], P(5.0, 0)[0], f"A = {D.WICK_A_THK:.2f} ± 0.05", left=False)
    s.dim_v(P(0, D.WICK_A_THK)[1], P(0, 2.8)[1], P(5.4, 0)[0], P(5.0, 0)[0], f"{D.VAPOUR_CORE:.2f}", left=False)
    s.dim_v(P(0, 2.8)[1], P(0, 3.0)[1], P(5.4, 0)[0], P(5.0, 0)[0], "C = 0.20", left=False)
    tag(s, P(5.4, 0)[0] + 32, P(0, D.WICK_A_THK / 2)[1])
    tag(s, P(5.4, 0)[0] + 32, P(0, 1.55)[1])
    s.text(40, 135, "응축액 경로 C → B → A 는 한 번의 소결로 끊김 없이 이어져야 한다 (Rev A와 동일).", size=5.2)

    y = s.table(14, 126, [14, 66, 30, 30, 90], [
        ["ZONE", "LOCATION", "Rev A", "Rev B", "FUNCTION"],
        ["A", "포켓 바닥, 기둥 둘레", "0.40", f"{D.WICK_A_THK:.2f}", "증발 + 액 공급 — 얇을수록 증발 저항 감소"],
        ["B", "포켓 옆벽 (4면)", "0.30", "0.30", "둘레 귀환 경로 (변경 없음)"],
        ["C", "뚜껑 아래, 기둥 마스킹", "0.20", "0.20", "응축액 수집 (변경 없음)"],
    ], title="WICK ZONES", aligns=["center", "left", "center", "center", "left"], size=4.9, bold_rows=(1,))
    liq = M.DP_LIQ_PER_W_040 * 0.40 / D.WICK_A_THK
    y = s.table(14, y - 5, [80, 40, 40, 70], [
        ["CAPILLARY BUDGET — 수직, 최악", "Rev A", "Rev B", "NOTE"],
        ["모세관 수두 2σ/r", "10 508 Pa", "10 508 Pa", "분말 45–75 µm 유지"],
        ["액 손실 (윅 + 홈)", "12.6 Pa/W", f"{liq:.1f} Pa/W", "존 A 두께에 반비례 (보수적)"],
        ["증기 손실", "0.2 Pa/W", "0.2 Pa/W", f"증기층 {D.VAPOUR_CORE:.2f}로 오히려 감소"],
        ["중력 (68 mm, 증발부 위)", "656 Pa", "656 Pa", "—"],
        ["모세관 한계", "804 W (도면)", f"{D.CAP_LIMIT:.0f} W", f"설계 최대 167 W의 {D.CAP_LIMIT / 167:.1f}배"],
    ], aligns=["left", "right", "right", "left"], size=4.9, bold_rows=(5,))
    s.table(14, y - 5, [80, 50, 100], [
        ["WICK ACCEPTANCE — Rev B", "REQUIREMENT", "METHOD"],
        ["기공률", "55 % ± 5", "이미지 분석, 단면 3곳 (Rev A 동일)"],
        ["존 A 두께", f"{D.WICK_A_THK:.2f} ± 0.05", "단면 5점 — Rev B 변경"],
        ["모세관 상승", "> 25 mm / 60 s", "증인 시편, 수직 (Rev A 동일)"],
        ["홈 연속성", "막힘 없음", "투과광 / CT, 초품 (Rev A 동일)"],
    ], aligns=["left", "center", "left"], size=4.9, bold_rows=(2,))
    s.notes(250, 270, "NOTES — Rev B", [
        "분말·소결 조건(950 °C · 30 min · H₂)은 Rev A 그대로.",
        ["존 A를 얇게 하려면 바닥 마스크 흑연 맨드릴의", "높이를 0.10 mm 높인다 (VC-103 Rev A 공구 변경)."],
        ["두께 0.25 미만이 나오면 불합격 —", "모세관 한계가 3배 여유 아래로 내려간다."],
        [f"윅 공극 {D.A_WICK_VOID_ML:.2f} → {D.WICK_VOID_ML:.2f} mL 감소에 따라", f"충전량 {D.CHARGE_ML:.2f} mL (VC-300 Rev B)."],
        f"윅 질량 {D.A_WICK_G} → {D.WICK_G:.1f} g.",
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 3. 핀 스택 Rev B
# ════════════════════════════════════════════════════════════
def sheet_fins(pdf):
    s = sheet(3, "FIN STACK — CONFIG A Rev B", f"Al 1100-H14 SKIVED / {B.n_fins} FIN × 0.30 @ 2.0 / Ni 도금 납땜면",
              "VC-201", "3:1, 8:1")
    S, OX, OY = 3.0, 22.0, 180.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(OX + 102, 280, "FRONT ELEVATION — 공기 흐름은 지면 수직", "3:1")
    s.rect(*P(0, 0), 68 * S, 2.0 * S, lw=MED, fill="#dfe4ea", hatch="\\\\\\\\")
    s.rect(*P(0, -0.25), 68 * S, 0.25 * S, lw=THIN, fill="#9aa4b1")
    span = (B.n_fins - 1) * B.pitch * 1e3
    x0 = 34 - span / 2
    for k in range(B.n_fins):
        xc = x0 + k * B.pitch * 1e3
        s.rect(*P(xc - B.t_fin * 1e3 / 2, 2.0), B.t_fin * 1e3 * S, 20 * S, lw=THIN, fill="#b8c2cd")
    s.rect(*P(32.0, 0), 4.0 * S, 1.0 * S, lw=MED, fill="white")
    s.dim_h(P(0, 0)[0], P(68, 0)[0], P(0, -5)[1], P(0, -0.25)[1], "68", above=False)
    s.dim_h(P(x0, 0)[0], P(x0 + span, 0)[0], P(0, 25)[1], P(0, 22)[1], f"{span:.1f} ({B.n_fins - 1} × {B.pitch * 1e3:.1f})")
    s.dim_v(P(0, 2.0)[1], P(0, 22.0)[1], P(-3, 0)[0], P(0, 2)[0], "20")
    s.dim_v(P(0, 0)[1], P(0, 2.0)[1], P(71, 0)[0], P(68, 0)[0], "2.0", left=False)
    s.leader(*P(34, 0.5), P(50, -6)[0], P(0, -9)[1], "Ø7 × 1.0 핀치오프 릴리프 (Rev A와 동일 위치)", size=4.7)
    s.leader(*P(60, -0.12), P(72, -6)[0], P(0, -9)[1], "무전해 Ni-P 5 µm (바닥면만)", size=4.7)

    # 상세 8:1
    S2, QX, QY = 8.0, 300.0, 168.0
    s.heading(QX + 32, 280, "FIN DETAIL", "8:1 · 핀 아래 8 mm")
    s.rect(QX, QY, 7.0 * S2, 2.0 * S2, lw=MED, fill="#dfe4ea", hatch="\\\\\\\\")
    for k in range(3):
        xf = QX + (1.0 + 2.0 * k) * S2
        s.rect(xf, QY + 2.0 * S2, 0.3 * S2, 8.0 * S2, lw=MED, fill="#b8c2cd")
    s.line(QX - 2, QY + 10.0 * S2, QX + 7.0 * S2 + 2, QY + 10.0 * S2, lw=THIN, ls=(0, (3, 1.5)))
    s.dim_h(QX + 1.0 * S2, QX + 3.0 * S2, QY + 10.0 * S2 + 6, QY + 10.0 * S2, "2.0 PITCH")
    s.dim_h(QX + 1.3 * S2, QX + 3.0 * S2, QY + 2.0 * S2 + 30, QY + 2.0 * S2 + 26, f"{B.gap * 1e3:.1f} GAP")
    s.leader(QX + 5.15 * S2, QY + 6 * S2, QX + 60, QY + 52, "0.30 THK", size=4.8)
    s.leader(QX + 0.15 * S2, QY + 1.6 * S2 + 0.3 * S2 / 2, QX - 10, QY - 10, "핀 뿌리 R0.2 이하", size=4.8, ha="right")
    tag(s, QX + 60, QY + 44)

    y = s.table(14, 132, [62, 40, 40, 88], [
        ["FIN GEOMETRY", "Rev A", "Rev B", "비고"],
        ["핀 수", "43", f"{B.n_fins}", "같은 폭 64 mm 안"],
        ["두께 / 피치 / 간격", "0.40 / 1.5 / 1.1", f"0.30 / 2.0 / {B.gap * 1e3:.1f}", "스카이빙 가능 범위 (간격 ≥ 0.6)"],
        ["핀 높이 / 바닥", "20 / 2.0", "20 / 2.0", "외형 변경 없음"],
        ["핀 스택 질량", f"{D.A_FIN_STACK_G} g", f"{D.FIN_STACK_G:.1f} g", "−28 g"],
        ["압력손실 (52 mW 팬)", f"{P2['dp_a']:.0f} Pa @ 2.00 m/s", f"{P2['dp_b']:.0f} Pa @ {P2['v_b']:.2f} m/s", "같은 팬이 더 많은 바람"],
        ["핀→공기 저항", "0.485 K/W", f"{P2['r_sink_b']:.3f} K/W", "같은 팬 전력"],
    ], aligns=["left", "center", "center", "left"], size=4.9)
    s.table(14, y - 5, [62, 168], [
        ["JOINT TO LID — Rev B", "SPECIFICATION"],
        ["접합 방식", "Sn-5Sb 땜납 프리폼 68 × 68 × 0.1 (VC-207), 고상선 ≈ 235 °C"],
        ["표면 처리", "핀 바닥: 무전해 Ni-P 5 µm · 뚜껑 외면: Cu 그대로, 산화막 제거 직후 납땜"],
        ["리플로", "N₂ 또는 진공, 최고 260 °C, 235 °C 이상 60–90 s, 무플럭스 또는 RMA 후 세정"],
        ["보이드", "X선 면적률 < 10 %, 다이 투영 20×20 영역 < 5 %"],
        ["평탄도", "핀 바닥·뚜껑 외면 0.03 (Rev A 동일)"],
    ], aligns=["left", "left"], size=4.9)
    s.notes(250, 128, "NOTES — Rev B", [
        "재질·스카이빙 공법 Rev A 동일. 마감 자유 (강제 대류).",
        ["Al(23 ppm/K)–Cu(17 ppm/K) 팽창 차이로 땜납에 반복 응력 —", "VC-500 T5 열사이클 500회 후 R th 변화 < 5 %."],
        "Config B(VC-202, 무팬)는 Rev A 그대로. 피치 시험은 VC-500 T4.",
        "릴리프 Ø7은 핀치오프 튜브 접힘 공간 — 땜납 프리폼도 같은 위치 Ø9 구멍.",
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 4. 공정·충전 사양 Rev B
# ════════════════════════════════════════════════════════════
def sheet_process(pdf):
    s = sheet(4, "PROCESS & CHARGING — Rev B", "Cu-H2O VAPOUR CHAMBER / 핀 납땜 공정 추가 / 충전량 변경",
              "VC-300", "NONE")
    s.heading(118, 280, "MANDATORY PROCESS SEQUENCE — Rev B", "순서 변경·생략 금지 · 노란 칸 = Rev B 변경")
    steps = [
        ("MACHINE", "VC-101 바닥, VC-102 뚜껑, VC-201 B 핀 스택(스카이빙).", False, False),
        ("FIN PLATING", "핀 스택 바닥면 무전해 Ni-P 5 µm. 핀 쪽 마스킹.", True, False),
        ("CLEAN", "증기 탈지 → 10 % H₂SO₄ 산세 60 s → DI 헹굼 → N₂ 건조.", False, False),
        ("SINTER WICK", f"Cu 45–75 µm, 950 °C / 30 min / H₂. 바닥 A {D.WICK_A_THK:.2f}.", True, False),
        ("DIFFUSION BOND", "뚜껑+바닥 850 °C / 8 MPa / 60 min / 진공.", False, True),
        ("WELD FILL TUBE", "Cu 튜브 OD3.0 레이저 용접. 필러·플럭스 없음.", False, False),
        ("SOLDER FIN STACK", "Sn-5Sb 0.1, N₂ 리플로 최고 260 °C. 챔버는 비어 있고 튜브 열림.", True, True),
        ("LEAK TEST 1", "He 질량분석, 챔버 진공. > 1×10⁻⁹ Pa·m³/s 불합격.", False, False),
        ("BAKE-OUT", "200 °C / 4 h / < 1×10⁻³ Pa. 땜납 고상선 235 °C — 200 °C 초과 금지.", True, True),
        ("CHARGE", f"DI 물 {D.CHARGE_ML:.2f} mL ({D.CHARGE_ML:.2f} g) 질량으로. 챔버 0 °C.", True, True),
        ("DEGAS", "동결–배기–해동 × 3. 얼음점에서 < 10 Pa.", False, True),
        ("PINCH-OFF", "유압 냉간 압착 → 끝단 레이저 밀봉. 나사 밀봉 금지.", False, True),
        ("LEAK TEST 2", "He 봄 3 bar / 4 h 후 질량분석.", False, False),
        ("BURN-IN", "20 ↔ 100 °C 3사이클. 이후 R th 재측정.", False, False),
        ("ACCEPT", f"R th(case-to-case) < {D.CASE_RTH:.2f} K/W @ 50 W, 수평·수직. (Rev A < 0.25)", True, True),
    ]
    y = 266.0
    for i, (name, desc, changed, key) in enumerate(steps, 1):
        s.rect(16, y - 11, 200, 11, lw=MED, fill=CHANGED if changed else ("#eef2f7" if key else "white"))
        s.rect(16, y - 11, 6, 11, lw=MED, fill="#2c4a66" if key else "#8796a8")
        s.text(19, y - 5.5, str(i), size=5.5, ha="center", color="white", weight="bold")
        s.text(25, y - 3.4, name, size=5.8, weight="bold")
        s.text(25, y - 8.2, desc, size=4.8)
        if changed:
            s.text(213, y - 3.4, "Rev B", size=4.6, ha="right", weight="bold", color="#7a5600")
        if i < len(steps):
            s.arrow(116, y - 11, 116, y - 12.4, head=1.8)
        y -= 12.4
    y = s.table(228, 270, [56, 40, 36], [
        ["PROCESS PARAMETERS", "Rev B", "Rev A"],
        ["작동유체", "DI H₂O 18 MΩ·cm", "동일"],
        ["충전량", f"{D.CHARGE_ML:.2f} mL ± 0.05", "1.90 mL"],
        ["윅 공극", f"{D.WICK_VOID_ML:.2f} mL", f"{D.A_WICK_VOID_ML} mL"],
        ["충전율", "125 %", "125 %"],
        ["베이크아웃", "200 °C / 4 h (최대)", "200 °C / 4 h"],
        ["핀 납땜", "Sn-5Sb, 260 °C 최고", "— (PCM 패드)"],
        ["합격 R th", f"< {D.CASE_RTH:.2f} K/W", "< 0.25 K/W"],
    ], aligns=["left", "center", "center"], size=4.9, bold_rows=(2, 6, 7))
    y = s.notes(228, y - 7, "PROHIBITED — Rev B 추가", [
        ["물 충전 후 납땜·재작업 금지. 100 °C에서 물은 0.1 MPa,", "260 °C에서 약 4.7 MPa — 챔버 파열."],
        "베이크아웃 200 °C 초과 금지 (땜납 고상선 235 °C).",
        "플럭스 잔사가 남은 채 베이크아웃 금지 — 불응축 가스 원인.",
        "Rev A 금지 사항(확산접합 전 충전, 나사 밀봉 등) 모두 유효.",
    ], width=182, size=4.8, gap=4.0)
    s.table(228, y - 4, [16, 100, 66], [
        ["STEP", "RECORD RETAINED", "HOLD POINT"],
        ["7", "리플로 온도 곡선, 보이드 X선", "yes — 100 %"],
        ["9", "베이크아웃 온도·압력 기록 (≤ 200 °C 확인)", "yes"],
        ["10", "충전 질량", "yes — 100 %"],
        ["15", "R th 수평·수직", "yes — 100 %"],
    ], title="QUALITY RECORDS — Rev B 추가·변경", aligns=["center", "left", "left"], size=4.8)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 5. 실증 시험 계획 (신규)
# ════════════════════════════════════════════════════════════
def sheet_test(pdf):
    s = sheet(5, "VALIDATION TEST — Rev A vs Rev B", "같은 팬·같은 조건 비교 실증 / 합격 시 Rev B 양산 승인",
              "VC-500", "NONE")
    s.heading(125, 280, "TEST RIG — 덕트형 풍동 (개략)", "공기 흐름 왼쪽 → 오른쪽")
    y0 = 222.0
    s.rect(20, y0, 220, 30, lw=MED)
    s.rect(24, y0 + 3, 16, 24, lw=MED, fill="#eef1f5")
    s.text(32, y0 + 15, "팬", size=6, ha="center")
    s.rect(48, y0 + 3, 10, 24, lw=THIN, hatch="||||")
    s.text(53, y0 - 4, "정류 격자", size=4.8, ha="center")
    s.rect(70, y0 + 3, 8, 24, lw=THIN, fill="white")
    s.text(74, y0 - 4, "유량계", size=4.8, ha="center")
    s.rect(120, y0 + 3, 40, 20, lw=MED, fill="#dfe4ea", hatch="||||")
    s.text(140, y0 + 13, "시험품", size=6, ha="center")
    s.rect(132, y0 - 12, 16, 15, lw=MED, fill="#f6d6c4")
    s.text(140, y0 - 16, "20×20 Cu 히터 블록 + 단열", size=4.8, ha="center")
    for x, lab in ((105, "T in"), (175, "T out")):
        s.circle(x, y0 + 15, 1.5, lw=MED, fill="white")
        s.text(x, y0 + 20, lab, size=4.6, ha="center")
    s.line(108, y0 + 30, 108, y0 + 36, lw=MED)
    s.line(172, y0 + 30, 172, y0 + 36, lw=MED)
    s.line(108, y0 + 36, 172, y0 + 36, lw=MED)
    s.text(140, y0 + 39, "차압계 ΔP", size=4.8, ha="center")
    s.circle(140, y0 - 1, 1.2, lw=MED, fill=INK)
    s.text(152, y0 + 0.5, "Tj (블록 매립 TC)", size=4.6)
    for k in range(3):
        s.arrow(185 + 15 * k, y0 + 15, 195 + 15 * k, y0 + 15, lw=0.6, color="#2a6fdb", head=2.2)

    y = s.table(14, 196, [10, 70, 82, 70], [
        ["#", "TEST", "CONDITION", "MEASURE"],
        ["T1", "강제 공냉 비교", "Rev A·B 각 3개, 같은 팬 전압 3단 (팬 전력 12/52/228 mW)",
         "R(j-a), ΔP, 풍량, 공기 온도"],
        ["T2", "방향 의존성", "수평·수직(증발부 위), 50 / 100 / 150 W", "R th 차이"],
        ["T3", "모세관 여유", "수직, 응축측 수냉 블록, 50 W씩 증가", "증발부 과열 시작 열량"],
        ["T4", "무팬 핀 피치 (VC-202)", "피치 5.0 / 6.0 / 7.0 mm, 외기 25 °C, Tj 85", "처리 열량 — 도면 vs 모델 판정"],
        ["T5", "납땜 열사이클", "0 ↔ 100 °C, 500회", "R th 변화, X선 보이드"],
        ["T6", "장기 운전", "100 W, 1 000 h, 수평", "R th 변화 (불응축 가스)"],
    ], title="TEST MATRIX", aligns=["center", "left", "left", "left"], size=4.8)
    y = s.table(14, y - 5, [10, 62, 80, 80], [
        ["#", "ACCEPTANCE (Rev B)", "BASIS", "모델 예측"],
        ["T1", "팬 52 mW에서 Q(Tj 100) ≥ 125 W", "Rev A 실측 대비 +10 % 이상", f"{P2['q_b']:.0f} W (Rev A {P2['q_a']:.0f} W)"],
        ["T2", "수평·수직 R th 차이 < 5 %", "도면 Rev A 기준 유지", "방향 무관"],
        ["T3", "300 W까지 과열 없음", "설계 최대 167 W × 1.8", f"한계 {D.CAP_LIMIT:.0f} W"],
        ["T5", "R th 변화 < 5 %, 보이드 < 10 %", "Al–Cu 팽창 차이", "—"],
        ["T6", "R th 변화 < 5 %", "Rev A 동일", "—"],
    ], title="PASS / FAIL", aligns=["center", "left", "left", "left"], size=4.8)
    s.notes(250, 200, "DECISION RULE", [
        "T1·T2·T3·T5 합격 → Rev B 양산 승인, Rev A 폐기.",
        ["T1에서 +10 % 미달 → 모델 보정(실측 h) 후", "피치 1.8 / 2.2로 재시험."],
        "T3 불합격 → 바닥 윅 0.35로 되돌림 (VC-103).",
        "T5 불합격 → 구리 핀(+52 g) 또는 PCM 패드 복귀.",
        "T4 결과로 VC-202 Rev B 여부 결정 (도면 4.8 mm vs 모델 6–7 mm).",
    ], width=160, size=4.8, gap=4.0)
    s.table(250, 140, [70, 90], [
        ["INSTRUMENT", "SPEC"],
        ["열전대", "T형 ± 0.2 K, 블록 매립 3점 외삽"],
        ["히터 전력", "4선식 ± 0.5 %"],
        ["풍량", "층류 유량계 ± 2 %"],
        ["차압", "0–100 Pa, ± 0.5 Pa"],
        ["시료 수", "Rev A 3, Rev B 3 (같은 로트 부품)"],
    ], title="INSTRUMENTATION", aligns=["left", "left"], size=4.8)
    s.save(pdf)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "VC100_drawingset_RevB.pdf"
    with PdfPages(path) as pdf:
        sheet_ga(pdf)
        sheet_wick(pdf)
        sheet_fins(pdf)
        sheet_process(pdf)
        sheet_test(pdf)
    print(path)


if __name__ == "__main__":
    main()
