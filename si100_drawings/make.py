"""SI-100 시제품 제작 도면 세트 (A3, 6장) 생성.

실행: python -m si100_drawings.make  →  output/si100/SI-100_drawingset_RevA.pdf
"""

from __future__ import annotations

import math
from pathlib import Path

from matplotlib.backends.backend_pdf import PdfPages

from . import design as D
from .drawlib import BOLD, FILL, INK, MED, THIN, Sheet

OUT = Path("output/si100")
TOTAL = 6


def f1(x):
    return f"{x:.1f}"


# ════════════════════════════════════════════════════════════
# 1. 전체 배치도
# ════════════════════════════════════════════════════════════
def sheet_ga(pdf):
    s = Sheet(1, TOTAL, "전체 배치도", "집열 흡착기 + 응축기 + 수액기 + 증발기·제빙함 / 메탄올 / 1 m²",
              "SI-100-000", "1:15")
    S, OX, OY = 1 / 15, 32.0, 120.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(120, 280, "측면도 — 시스템 배치", "1:15 · 배관은 개략 경로")

    # 지면
    gx1, gy = P(-150, 0)
    gx2, _ = P(2250, 0)
    s.line(gx1, gy, gx2, gy, lw=MED)
    for i in range(30):
        x = gx1 + i * (gx2 - gx1) / 30
        s.line(x, gy, x - 2, gy - 2, lw=THIN)

    # 집열 흡착기 (경사 30°)
    c, sn = math.cos(math.radians(D.TILT_DEG)), math.sin(math.radians(D.TILT_DEG))
    A = (200.0, 1450.0)

    def C(u, v):  # u: 경사 방향, v: 뒷면 방향 깊이
        return P(A[0] + u * c + v * sn, A[1] + u * sn - v * c)

    L, T = D.FRAME_H, D.FRAME_D
    s.poly([C(0, 0), C(L, 0), C(L, T), C(0, T)], lw=BOLD)
    s.poly([C(40, 20), C(L - 40, 20), C(L - 40, 21), C(40, 21)], lw=THIN, fill="#cfe3f5")
    s.poly([C(75, 43), C(1075, 43), C(1075, 94), C(75, 94)], lw=MED, fill=FILL, hatch="////")
    s.poly([C(20, 119), C(L - 20, 119), C(L - 20, 169), C(20, 169)], lw=THIN, hatch="xx")
    hx, hy = C(1105, 68)
    s.circle(hx, hy, D.HEADER_OD / 2 * S, lw=MED, fill="white")
    # 야간 댐퍼 (뒷면 아래·위)
    for u in (60, L - 140):
        s.poly([C(u, T), C(u + 80, T), C(u + 80, T + 12), C(u, T + 12)], lw=MED, fill="#ffe9c7")
    # 햇빛
    for k in range(3):
        sx, sy = C(250 + 300 * k, -260)
        ex, ey = C(250 + 300 * k, -15)
        s.arrow(sx, sy, ex, ey, lw=0.4, color="#d38b00", head=3)
    s.text(*C(560, -300), "햇빛", size=6, color="#b06f00", ha="center")

    # 가대
    for (x, y) in ((285, 1303), (1281, 1878)):
        s.line(*P(x, y), *P(x, 0), lw=1.6)
    s.line(*P(285, 700), *P(1281, 1300), lw=MED)

    # 응축기
    cx0, cy0 = P(600, 980)
    s.rect(cx0, cy0, 120 * S, 400 * S, lw=MED, hatch="||||")
    for i in range(10):
        s.circle(*P(660, 1000 + 40 * i), 8 * S, lw=THIN, fill="white")
    s.line(*P(600, 1180), *P(285, 1180), lw=THIN)

    # 수액기
    rx0, ry0 = P(790, 620)
    s.rect(rx0, ry0, D.REC_OD * S, D.REC_H * S, lw=MED, fill="white")
    s.rect(rx0 + 0.6, ry0 + 0.6, D.REC_OD * S - 1.2, D.REC_H * S * 0.55, lw=0, fill="#d9ecff")
    s.line(*P(790, 780), *P(285, 780), lw=THIN)

    # 제빙함 + 증발기
    bx0, by0 = P(1300, 0)
    s.rect(bx0, by0, 900 * S, 760 * S, lw=BOLD, fill="white")
    s.rect(*P(1400, 100), 700 * S, 560 * S, lw=MED, hatch="", fill="#f6f8fb")
    s.rect(*P(1300, 0), 900 * S, 100 * S, lw=0, hatch="xx")
    s.rect(*P(1725, 130), 50 * S, 400 * S, lw=MED, fill="#d9ecff")
    for x0 in (1697, 1777):
        s.rect(*P(x0, 140), 26 * S, 380 * S, lw=THIN, fill="#eaf6ff", hatch="..")

    # 배관
    def pipe(pts, lw=0.9, color="#3c5a7a", ls="-"):
        for (a, b) in zip(pts, pts[1:]):
            s.line(*P(*a), *P(*b), lw=lw, color=color, ls=ls)

    pipe([(1190, 1946), (1350, 1946), (1350, 1420), (660, 1420), (660, 1380)])          # 낮 증기
    pipe([(660, 980), (660, 950), (900, 950), (900, 920)], lw=0.6)                     # 응축액
    pipe([(900, 620), (900, 590), (1735, 590), (1735, 530)], lw=0.6)                   # 액 배출
    pipe([(1765, 530), (1765, 2150), (1240, 2150), (1240, 1985)], lw=1.2, color="#1f6f4a")  # 밤 증기

    def valve(x, y, label, vertical=False):
        px, py = P(x, y)
        d = 2.2
        if vertical:
            s.poly([(px - d, py - d), (px + d, py - d), (px - d, py + d), (px + d, py + d)], lw=MED, fill="white")
        else:
            s.poly([(px - d, py - d), (px - d, py + d), (px + d, py - d), (px + d, py + d)], lw=MED, fill="white")
        s.text(px + 3.2, py + 2.6, label, size=5.2, weight="bold")

    valve(1765, 900, "V1", vertical=True)
    valve(1150, 590, "V2")
    px, py = P(1350, 1700)
    s.line(px, py, px + 5, py, lw=MED)
    s.rect(px + 5, py - 1.6, 3.2, 3.2, lw=MED, fill="white")
    s.text(px + 9.5, py, f"RV1 {D.RELIEF_KPA_ABS} kPa(abs)", size=4.8)
    px, py = P(1350, 1820)
    s.line(px, py, px + 5, py, lw=MED)
    s.circle(px + 7, py, 2, lw=MED, fill="white")
    s.text(px + 10, py, "PG", size=4.8)
    px, py = P(1765, 820)
    s.line(px, py, px + 5, py, lw=MED)
    s.rect(px + 5, py - 1.2, 2.4, 2.4, lw=MED, fill=INK)
    s.text(px + 9, py, "V3 충전·배기", size=4.8)

    # 풍선 번호
    s.balloon(*P(-60, 2050), 1, *C(500, 0))
    s.balloon(*P(330, 1980), 2, *C(700, 70))
    s.balloon(*P(400, 900), 3, *P(620, 1100))
    s.balloon(*P(600, 600), 4, *P(800, 700))
    s.balloon(*P(2000, 900), 5, *P(1750, 500))
    s.balloon(*P(2150, 1050), 6, *P(2150, 700))
    s.balloon(*P(-60, 1550), 12, *C(70, T + 6))
    s.balloon(*P(130, 600), 11, *P(285, 500))

    # 높이 치수
    xr = P(2330, 0)[0]
    for y, lab in ((530, "530 증발기 상단"), (620, "620 수액기 하단"), (980, "980 응축기 하단"),
                   (1450, "1 450 집열기 하단"), (2025, "2 025 집열기 상단")):
        _, yy = P(0, y)
        s.line(xr - 2, yy, xr + 2, yy, lw=MED)
        s.text(xr + 3, yy, lab, size=4.8)
    s.line(xr, P(0, 0)[1], xr, P(0, 2025)[1], lw=THIN)
    s.text(xr - 1, P(0, 0)[1] + 2, "EL 0", size=4.8, ha="right")
    s.text(P(1000, 0)[0], P(0, -90)[1], "집열기 경사 20~40° 조정 (도시 30°) · 남향(북반구)", size=5, ha="center")
    s.text(*P(1550, 2200), "밤 증기 1\"", size=4.8, color="#1f6f4a")
    s.text(*P(700, 1450), "낮 증기 3/4\"", size=4.8, color="#3c5a7a")
    s.text(*P(1000, 560), "액 1/4\"", size=4.8, color="#3c5a7a")

    # 운전 순서
    s.table(14, 108, [24, 52, 16, 16, 120], [
        ["시간", "상태", "V1", "V2", "설명"],
        ["08~15시", "가열·탈착", "닫힘", "닫힘", "햇빛으로 흡착관 100 °C까지 가열, 메탄올 증기 → 응축기 → 수액기에 모임"],
        ["15~17시", "냉각 시작", "닫힘", "닫힘", "뒷면 댐퍼 개방, 흡착관 자연 냉각. 수액기 눈금으로 생산 예측"],
        ["17~18시", "액 이송", "닫힘", "열림", "수액기 메탄올을 증발기로 배출 후 V2 닫음. 몰드에 15 °C 물 채움"],
        ["18~07시", "흡착·제빙", "열림", "닫힘", "증발기 메탄올 증발(−5 °C) → 흡착관이 흡수 → 몰드 물이 얼음"],
        ["07~08시", "얼음 회수", "닫힘", "닫힘", "V1 닫고 몰드 분리, 댐퍼 닫음"],
    ], title="운전 순서 (하루 1회)", aligns=["center", "left", "center", "center", "left"])

    # BOM
    y = s.table(250, 285, [7, 21, 58, 10, 64], [
        ["No", "도번", "품명", "수량", "재질 / 규격"],
        ["1", "SI-100-100", "집열 흡착기 조립품 (1 m²)", "1", "Al 프레임, 저철분 강화유리 복층"],
        ["2", "SI-100-110", "흡착관 (활성탄 충전)", f"{D.N_TUBES}", "SUS304 Ø50.8×0.8, Maxsorb III+ENG"],
        ["3", "SI-100-200", "응축기 (연속 판핀)", "1", "Cu C1220 Ø15.88, Al 1050 핀"],
        ["4", "SI-100-210", "수액기 (눈금 액면계)", "1", f"SUS304 Ø{D.REC_OD}×{D.REC_T:.0f}, {D.REC_L:.1f} L"],
        ["5", "SI-100-300", "증발기 (지지봉 보강)", "1", f"SUS304 t{D.EVAP_T:.0f}, {D.EVAP_L:.1f} L"],
        ["6", "SI-100-310", "제빙함 + 얼음 몰드 2개", "1", "PU 100 mm, SUS304 몰드"],
        ["7", "V1", "진공 벨로우즈 밸브 DN25", "1", "SUS316, 메탈 시트"],
        ["8", "V2", "진공 벨로우즈 밸브 1/4\"", "1", "SUS316"],
        ["9", "V3", "충전·배기 포트 1/4\"", "1", "메탈 개스킷 면씰 + 캡"],
        ["10", "RV1·PG", "안전밸브 / 압력계", "1식", f"{D.RELIEF_KPA_ABS} kPa(abs) / 0~200 kPa(abs)"],
        ["11", "—", "가대·브래킷", "1식", "Al 6063 형강, 경사 조정"],
        ["12", "—", "야간 냉각 댐퍼 (뒷면 2곳)", "2", "Al, 수동 + 과열 105 °C 자동 개방"],
        ["13", "—", "작동유체 메탄올", f"{D.CHARGE_KG:.1f} kg", "≥ 99.9 %, 수분 < 0.05 %, 탈기"],
    ], title="부품표 (BOM)", aligns=["center", "left", "left", "center", "left"], size=4.9, row_h=4.4)

    r = D.RES
    y = s.table(250, y - 4, [74, 34, 52], [
        ["항목", "값", "비고"],
        ["활성탄 (Maxsorb III)", f"{D.CARBON_KG:.1f} kg", f"관 {D.N_TUBES} × {D.TUBE_CARBON_KG * 1000:.0f} g"],
        ["금속 / 활성탄 질량비", f"{D.METAL_KG / D.CARBON_KG:.2f}", f"금속 {D.METAL_KG:.1f} kg"],
        ["하루 순환 메탄올", f"{D.CYCLED_KG:.2f} kg", f"{D.CYCLED_L:.1f} L, Δx {D.X_MAX - D.X_MIN:.3f}"],
        ["필요 열 / 집열 가능 열", f"{D.HEAT_NEED_MJ:.1f} / {D.HEAT_AVAIL_MJ:.1f} MJ", f"집열 효율 {r.eta_col:.2f}"],
        ["사이클 COP", f"{r.cop:.2f}", "냉열 / 가열량"],
        ["얼음 (평형 상한)", f"{D.ICE_UPPER_KG:.1f} kg/일", "si100_sim 모델"],
        ["얼음 (설계 목표)", f"{D.ICE_TARGET_KG:.0f} kg/일", "상한의 약 78 %"],
    ], title="설계 성능 — 일사 20 MJ/m², 낮 외기 25 °C", aligns=["left", "right", "left"], size=4.9,
        row_h=4.4, bold_rows=(7,))

    s.notes(250, y - 6, "일반 사항", [
        "치수 단위 mm. 공차 ISO 2768-mK.",
        "진공 기기: 메탄올 접촉부는 SUS304/316 또는 Cu. Al·아연도금·고무 금지.",
        ["설계 조건: 증발 −5 °C, 응축 30 °C, 새벽 흡착기 25 °C,", "탈착 최고 100 °C, 급수 15 °C."],
        ["메탄올 독성·인화성: 실외 설치, 화기 금지,", "경고 표지 부착 (SI-100-400 안전 항목)."],
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 2. 집열 흡착기 조립도
# ════════════════════════════════════════════════════════════
def tube_x(i):
    """프레임 왼쪽 바깥면 기준 i 번째 흡착관 중심 x."""
    return (D.FRAME_W - D.APERTURE) / 2 + (D.APERTURE - (D.N_TUBES - 1) * D.TUBE_PITCH) / 2 + i * D.TUBE_PITCH


def sheet_collector(pdf):
    s = Sheet(2, TOTAL, "집열 흡착기 조립도", f"흡착관 {D.N_TUBES}개 + 헤더 + 복층 유리 + 야간 냉각 댐퍼 / 개구 1.0 × 1.0 m",
              "SI-100-100", "1:10, 1:2")
    # ── 평면도 (유리 제거) 1:10
    S, OX, OY = 0.1, 30.0, 128.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(OX + 55, 280, "평면도 — 유리 제거", "1:10")
    s.rect(*P(0, 0), D.FRAME_W * S, D.FRAME_H * S, lw=BOLD)
    s.rect(*P(20, 20), (D.FRAME_W - 40) * S, (D.FRAME_H - 40) * S, lw=THIN)
    s.rect(*P(50, 40), D.APERTURE * S, D.APERTURE * S, lw=THIN, ls=(0, (4, 2)))
    y_tube0 = 40
    for i in range(D.N_TUBES):
        x = tube_x(i)
        s.rect(*P(x - D.TUBE_OD / 2, y_tube0), D.TUBE_OD * S, (D.TUBE_ACTIVE + 40) * S, lw=MED, fill=FILL)
        s.line(*P(x, y_tube0 + 1040), *P(x, 1090 - D.HEADER_OD / 2), lw=0.6)
    hy = 1090
    s.rect(*P(60, hy - D.HEADER_OD / 2), (D.FRAME_W - 120) * S, D.HEADER_OD * S, lw=MED, fill="white")
    s.line(*P(0, hy), *P(60, hy), lw=1.2, color="#1f6f4a")
    s.line(*P(D.FRAME_W - 60, hy), *P(D.FRAME_W, hy), lw=0.9, color="#3c5a7a")
    s.text(P(0, hy)[0] - 1, P(0, hy)[1] + 2.5, "밤 증기 입구 1\" ← V1", size=4.6, ha="right", color="#1f6f4a")
    s.text(P(D.FRAME_W, hy)[0] + 1, P(0, hy)[1] + 2.5, "→ 낮 증기 출구 3/4\"", size=4.6, color="#3c5a7a")
    s.text(P(D.FRAME_W, hy)[0] + 1, P(0, hy)[1] - 2.5, "RV1·PG 분기", size=4.6, color="#3c5a7a")
    # 단면 표시
    ya = P(0, 560)[1]
    s.centerline(P(-40, 0)[0], ya, P(D.FRAME_W + 40, 0)[0], ya)
    for x, lab in ((P(-40, 0)[0], "A"), (P(D.FRAME_W + 40, 0)[0], "A")):
        s.arrow(x, ya, x, ya - 6, lw=MED, head=3)
        s.text(x, ya + 3.5, lab, size=8, ha="center", weight="bold")
    s.dim_h(*[P(0, 0)[0], P(D.FRAME_W, 0)[0]], P(0, -95)[1], P(0, 0)[1], f"{D.FRAME_W:.0f}")
    s.dim_h(P(50, 0)[0], P(1050, 0)[0], P(0, -45)[1], P(0, 40)[1], f"개구 {D.APERTURE:.0f}")
    s.dim_v(P(0, 0)[1], P(0, D.FRAME_H)[1], P(-90, 0)[0], P(0, 0)[0], f"{D.FRAME_H:.0f}")
    s.dim_h(P(tube_x(0), 0)[0], P(tube_x(1), 0)[0], P(0, 1180)[1], P(0, 1120)[1], f"{D.TUBE_PITCH:.0f}")
    s.leader(*P(tube_x(9), 700), P(1180, 800)[0], P(0, 800)[1], f"흡착관 × {D.N_TUBES} (SI-100-110)")
    s.leader(*P(500, hy), P(1180, 1010)[0], P(0, 1010)[1], f"헤더 SUS304 Ø{D.HEADER_OD}×{D.HEADER_T}")
    s.leader(*P(tube_x(4), 1065), P(1180, 940)[0], P(0, 940)[1], "증기 스텁 Ø12.7×0.9 × 18")

    # ── 단면 A-A 1:2 (부분)
    S2, QX, QY = 0.5, 160.0, 172.0

    def Q(x, y):
        return QX + x * S2, QY + y * S2

    s.heading(QX + 72, 280, "단면 A–A (부분)", "1:2 · 아래 = 뒷면, 위 = 햇빛 쪽")
    xe = 300.0
    s.rect(*Q(0, 0), 3 * S2, D.FRAME_D * S2, lw=MED, fill="#c9d1db")
    s.rect(*Q(3, 0), (xe - 3) * S2, 1 * S2, lw=MED, fill="#c9d1db")
    s.rect(*Q(3, 1), (xe - 3) * S2, 50 * S2, lw=THIN, hatch="xxx")
    tube_cy = 76 + D.TUBE_OD / 2
    glass_lo = tube_cy + D.TUBE_OD / 2 + 20
    s.rect(*Q(3, glass_lo), (xe - 3) * S2, 4 * S2, lw=MED, fill="#cfe3f5")
    s.rect(*Q(3, glass_lo + 16), (xe - 3) * S2, 4 * S2, lw=MED, fill="#cfe3f5")
    s.rect(*Q(3, glass_lo + 4), 10 * S2, 12 * S2, lw=THIN, fill="#888")
    s.rect(*Q(0, glass_lo + 20), 14 * S2, (D.FRAME_D - glass_lo - 20) * S2, lw=MED, fill="#c9d1db")
    for i in range(4):
        cx = tube_x(i)
        X, Y = Q(cx, tube_cy)
        s.circle(X, Y, D.TUBE_OD / 2 * S2, lw=MED, fill="#2b2b2b")
        s.circle(X, Y, D.TUBE_ID / 2 * S2, lw=THIN, fill="#9aa4b1", hatch="....")
        s.circle(X, Y, D.CORE_OD / 2 * S2, lw=THIN, fill="white")
    # 파단선
    bx = Q(xe, 0)[0]
    s.line(bx, Q(0, -5)[1], bx, Q(0, D.FRAME_D + 5)[1], lw=THIN, ls=(0, (3, 1.5)))
    # 야간 냉각 공기 통로 화살표
    for k in range(3):
        X, Y = Q(60 + 80 * k, 63.5)
        s.arrow(X, Y, X + 10, Y, lw=0.5, color="#c06000", head=2.4)
    s.dim_v(Q(0, 0)[1], Q(0, D.FRAME_D)[1], Q(-12, 0)[0], Q(0, 0)[0], f"{D.FRAME_D:.0f}")
    lx = Q(xe + 12, 0)[0]
    for yv, lab in ((glass_lo + 18, "저철분 강화유리 4 + 공기 12 + 4 (복층)"),
                    (glass_lo - 10, "공기층 20"),
                    (tube_cy, f"흡착관 Ø{D.TUBE_OD}, 선택흡수 코팅 α ≥ 0.90, ε ≤ 0.30"),
                    (63.5, "야간 냉각 공기 통로 25 (댐퍼 개방 시)"),
                    (26, "미네랄울 50 (128 kg/m³)"),
                    (0.5, "뒷판 Al 1.0")):
        s.leader(Q(xe - 20, yv)[0], Q(0, yv)[1], lx, Q(0, yv)[1], lab, size=4.8)
    s.dim_h(Q(tube_x(0), 0)[0], Q(tube_x(1), 0)[0], Q(0, -12)[1], Q(0, 0)[1], f"{D.TUBE_PITCH:.0f}")

    # ── 야간 냉각 댐퍼 개략 (아래쪽 빈 칸)
    s.text(20, 68, "야간 냉각 댐퍼 — 개략 측면", size=6.5, weight="bold")
    x0, y0, Lr, k = 34.0, 32.0, 52.0, 0.5774
    s.poly([(x0, y0), (x0 + Lr, y0 + Lr * k), (x0 + Lr + 4, y0 + Lr * k - 7), (x0 + 4, y0 - 7)], lw=MED)
    for t, lab, dx in ((0.12, "하부 흡기 900×80", 0), (0.85, "상부 배기 900×80", 0)):
        vx, vy = x0 + 4 + Lr * t, y0 - 7 + Lr * k * t
        s.poly([(vx - 3, vy - 1.7), (vx + 3, vy + 1.7), (vx + 3.8, vy + 0.4), (vx - 2.2, vy - 3)], lw=MED, fill="#ffe9c7")
        s.text(vx + 5, vy - 4, lab, size=4.6)
    ix, iy = x0 + 4 + Lr * 0.12, y0 - 7 + Lr * k * 0.12
    s.arrow(ix - 1, iy - 10, ix - 0.5, iy - 3, lw=0.6, color="#c06000", head=2.4)
    ox, oy = x0 + 4 + Lr * 0.85, y0 - 7 + Lr * k * 0.85
    s.arrow(ox + 2, oy - 1, ox + 8, oy + 6, lw=0.6, color="#c06000", head=2.4)
    s.text(x0 + 82, y0 + 20, "밤: 댐퍼 개방 → 굴뚝 효과로 외기가 흡착관 뒤 25 mm 통로를 통과", size=4.8, color="#c06000")
    s.text(x0 + 82, y0 + 13, "낮: 댐퍼 닫힘 → 집열", size=4.8)
    s.text(x0 + 82, y0 + 6, "흡착관 105 °C 초과: 왁스 액추에이터가 자동 개방", size=4.8, color="#a83226")

    s.table(14, 112, [62, 34, 34, 70], [
        ["항목", "기준", "공차", "관리 이유"],
        ["흡착관 중심 간격", f"{D.TUBE_PITCH:.0f}", "±1.0", "유리 그림자·헤더 스텁 정렬"],
        ["헤더 기울기 (출구 쪽 아래)", "1:100", "최소", "응축액 고임 방지"],
        ["유리–흡착관 공기층", "20", "±3", "대류 손실 (U ≤ 3.5 W/m²K)"],
        ["댐퍼 누설 (닫힘)", "≤ 0.5 m³/h", "—", "낮 집열 효율"],
        ["댐퍼 과열 개방", "105 °C", "±3 °C", "메탄올 분해 방지 (> 120 °C)"],
        ["선택흡수 코팅 내열", "≥ 250 °C", "—", "진공 베이크 공정"],
    ], title="주요 관리 특성", aligns=["left", "center", "center", "left"], size=4.9)
    s.notes(250, 140, "노트", [
        "헤더·스텁·흡착관은 TIG 용접, 전 접합부 헬륨 누설 시험 (SI-100-400).",
        "유리는 프레임에 EPDM 개스킷 + 실리콘 실링. 메탄올 계통과 접촉 없음.",
        "배관 관통부는 단열 슬리브로 열교 차단.",
        ["댐퍼는 수동 레버 + 왁스 액추에이터(105 °C 개방).", "정전·부재 시에도 과열 보호."],
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 3. 흡착관 상세
# ════════════════════════════════════════════════════════════
def sheet_tube(pdf):
    s = Sheet(3, TOTAL, "흡착관 상세", "SUS304 Ø50.8×0.8 / Maxsorb III + 팽창 흑연 압축 링 / 금속망 증기 통로",
              "SI-100-110", "1:1, 2:1")
    S, Y0 = 1.0, 222.0
    s.heading(150, 280, "종단면 — 양 끝 (가운데 생략)", "1:1 · 전체 길이 1 040, 충전 1 000")
    R_o, R_i = D.TUBE_OD / 2, D.TUBE_ID / 2

    def seg(x_paper, u0, u1, top_end):
        w = (u1 - u0) * S
        s.rect(x_paper, Y0 - R_o, w, D.TUBE_T, lw=MED, fill="#555")
        s.rect(x_paper, Y0 + R_i, w, D.TUBE_T, lw=MED, fill="#555")
        # 링
        for k in range(D.RINGS_PER_TUBE + 1):
            uk = 20 + k * D.RING_L
            if u0 <= uk <= u1:
                s.line(x_paper + (uk - u0), Y0 - D.RING_OD / 2, x_paper + (uk - u0), Y0 + D.RING_OD / 2, lw=MED)
        r0, r1 = max(u0, 20), min(u1, 1020)
        if r1 > r0:
            for sgn in (-1, 1):
                ylo = Y0 + (D.RING_ID / 2 if sgn > 0 else -D.RING_OD / 2)
                s.rect(x_paper + r0 - u0, ylo, r1 - r0, (D.RING_OD - D.RING_ID) / 2, lw=THIN, fill="#9aa4b1",
                       hatch="....")
        # 금속망 관
        c0, c1 = max(u0, 1.5), min(u1, 1038.5)
        s.rect(x_paper + c0 - u0, Y0 - D.CORE_OD / 2, c1 - c0, D.CORE_OD, lw=THIN, ls=(0, (2, 1)))
        # 스페이서
        for a, b in ((1.5, 20), (1020, 1038.5)):
            a0, b0 = max(u0, a), min(u1, b)
            if b0 > a0:
                for sgn in (-1, 1):
                    ylo = Y0 + (D.CORE_OD / 2 if sgn > 0 else -R_i)
                    s.rect(x_paper + a0 - u0, ylo, b0 - a0, R_i - D.CORE_OD / 2, lw=THIN, hatch="////")
        # 끝판
        if u0 <= 0:
            s.rect(x_paper - u0, Y0 - R_o, D.CAP_T, D.TUBE_OD, lw=MED, fill="#555")
        if u1 >= 1040:
            xc = x_paper + 1038.5 - u0
            s.rect(xc, Y0 - R_o, D.CAP_T, D.TUBE_OD, lw=MED, fill="#555")
            s.rect(xc + D.CAP_T, Y0 - 6.35, 30, 0.9, lw=THIN, fill="#555")
            s.rect(xc + D.CAP_T, Y0 + 6.35 - 0.9, 30, 0.9, lw=THIN, fill="#555")
            s.rect(xc - 1, Y0 - D.CORE_OD / 2 - 0.5, 1, D.CORE_OD + 1, lw=THIN, fill="#d8dee6")

    seg(22, -2, 130, False)
    seg(168, 912, 1042, True)
    for xb in (155.0, 162.0):
        s.line(xb, Y0 - 34, xb, Y0 + 34, lw=THIN, ls=(0, (4, 1.5)))
    s.centerline(16, Y0, 340, Y0)
    s.text(158.5, Y0 + 40, "생략", size=5, ha="center")
    s.dim_h(22 + 22, 22 + 122, Y0 + 38, Y0 + R_o, f"링 L {D.RING_L:.0f} × {D.RINGS_PER_TUBE}")
    s.dim_h(24, 42, Y0 - 38, Y0 - R_o, "스페이서 18.5", above=False)
    s.dim_v(Y0 - R_o, Y0 + R_o, 16, 22, f"Ø{D.TUBE_OD}")
    s.leader(168 + 1038.5 - 912 + 20, Y0 + 3, 300, Y0 + 30, "증기 스텁 Ø12.7×0.9 → 헤더")
    s.leader(168 + 1038.5 - 912 - 0.5, Y0 + 9, 300, Y0 + 22, "10 µm SUS316L 소결 필터 디스크")
    s.leader(168 + 1038.5 - 912 + 0.7, Y0 - 20, 300, Y0 - 24, f"끝판 SUS304 t{D.CAP_T}, TIG 전둘레")
    s.leader(22 + 80, Y0 + 15, 22 + 60, Y0 + 52, "Maxsorb III + ENG 압축 링")
    s.leader(22 + 80, Y0 + 3, 22 + 100, Y0 - 52, f"증기 통로 금속망 관 Ø{D.CORE_OD:.0f} (10 µm SUS316L)", ha="left")
    s.leader(22 + 2, Y0 - 3, 22 - 4, Y0 - 52, "하단 막힘", ha="left")

    # ── 횡단면 B-B 2:1
    cx, cy, S2 = 370.0, 222.0, 1.4
    s.heading(cx, 280, "횡단면 B–B", "1.4:1")
    s.circle(cx, cy, R_o * S2, lw=MED, fill="#555")
    s.circle(cx, cy, R_i * S2, lw=THIN, fill="white")
    s.circle(cx, cy, D.RING_OD / 2 * S2, lw=MED, fill="#9aa4b1", hatch="....")
    s.circle(cx, cy, D.RING_ID / 2 * S2, lw=MED, fill="white")
    s.circle(cx, cy, D.CORE_OD / 2 * S2, lw=THIN, ls=(0, (2, 1)))
    s.centerline(cx - 42, cy, cx + 42, cy)
    s.centerline(cx, cy - 42, cx, cy + 42)
    s.dim_h(cx - R_o * S2, cx + R_o * S2, cy - 44, cy - R_o * S2, f"Ø{D.TUBE_OD} × {D.TUBE_T}", above=False)
    s.dim_h(cx - D.RING_OD / 2 * S2, cx + D.RING_OD / 2 * S2, cy + 40, cy + D.RING_OD / 2 * S2,
            f"링 Ø{D.RING_OD:.1f} / Ø{D.RING_ID}")
    s.text(cx, cy - 52, "링–관 틈새 0.1 (헐거운 끼움)", size=4.8, ha="center")

    # ── 표
    y = s.table(14, 158, [70, 46, 84], [
        ["흡착제 링 사양", "값", "비고"],
        ["활성탄", "Maxsorb III (고비표면적)", "BET ≈ 3 000 m²/g"],
        ["팽창 흑연(ENG)", f"활성탄의 {D.ENG_FRACTION * 100:.0f} wt%", "열전도 향상, 무바인더"],
        ["링 내 활성탄 밀도", f"{D.CARBON_DENSITY:.2f} g/cm³", "분말 0.28 대비 1.8배 충전"],
        ["링 1개 활성탄", f"{D.RING_CARBON_G:.1f} g", f"ENG {D.RING_CARBON_G * D.ENG_FRACTION:.1f} g 별도"],
        ["관 1개 활성탄", f"{D.TUBE_CARBON_KG * 1000:.0f} g", f"링 {D.RINGS_PER_TUBE}개"],
        ["전체 활성탄", f"{D.CARBON_KG:.2f} kg", f"관 {D.N_TUBES}개"],
        ["압축 압력", "[시험 후 확정]", "목표 밀도 도달 압력"],
    ], aligns=["left", "left", "left"], size=4.9)
    s.table(14, y - 5, [62, 34, 34, 70], [
        ["관리 특성", "기준", "공차", "관리 이유"],
        ["링 바깥지름", f"{D.RING_OD:.1f}", "−0.2 / 0", "삽입성 + 관벽 열접촉"],
        ["링 질량", f"{D.RING_CARBON_G * (1 + D.ENG_FRACTION):.0f} g", "±3 %", "충전량·Δx 일정"],
        ["필터 눈금", "10 µm", "최대", "미분 비산 → 밸브·증발기 오염 방지"],
        ["끝판 용접 시 링 온도", "< 150 °C", "최대", "냉각 지그 사용"],
    ], aligns=["left", "center", "center", "left"], size=4.9)
    s.notes(250, 150, "노트", [
        ["Maxsorb III 미분은 50 µm 망을 통과한다.", "금속망 관·필터는 10 µm 소결망만 사용."],
        "유기 바인더 금지 — 밀봉 후 불응축 가스가 된다.",
        ["링은 250 °C · 8 h · < 1×10⁻³ Pa 진공 베이크 후", "건조 질소 분위기에서 관에 삽입."],
        "관 길이 방향 링 순서 기록 (질량·밀도 추적).",
        "외부 선택흡수 코팅은 용접·누설 시험 후 시공.",
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 4. 응축기·수액기
# ════════════════════════════════════════════════════════════
def sheet_condenser(pdf):
    s = Sheet(4, TOTAL, "응축기 · 수액기", "자연대류 연속 판핀 응축기 / 눈금 액면계 수액기",
              "SI-100-200 / 210", "1:10, 1:5, 1:4")
    # ── 응축기 정면 1:10
    S, OX, OY = 0.1, 40.0, 190.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(OX + 45, 280, "응축기 정면", "1:10 · 통로 10개 직렬, 위에서 아래로")
    s.rect(*P(0, 0), D.COND_PASS_L * S, D.FIN_HEIGHT * S, lw=MED, fill="#f4f6f9")
    for k in range(0, D.FINS + 1, 10):
        x = k * D.FIN_PITCH
        s.line(*P(x, 0), *P(x, D.FIN_HEIGHT), lw=0.15, color="#8792a2")
    ys = [30 + D.COND_PASS_PITCH * i for i in range(D.COND_PASSES)]
    for i, y in enumerate(ys):
        s.line(*P(-30, y), *P(D.COND_PASS_L + 30, y), lw=0.9, color="#b0602a")
    for i in range(D.COND_PASSES - 1):
        side = D.COND_PASS_L + 30 if i % 2 == 0 else -30
        x, y0p = P(side, ys[D.COND_PASSES - 1 - i])
        _, y1p = P(side, ys[D.COND_PASSES - 2 - i])
        s.line(x, y0p, x, y1p, lw=0.9, color="#b0602a")
    s.line(*P(-30, ys[-1]), *P(-80, ys[-1]), lw=0.9, color="#3c5a7a")
    s.text(P(-85, ys[-1])[0], P(0, ys[-1])[1], "증기 입구 3/4\"", size=4.8, ha="right")
    s.line(*P(D.COND_PASS_L + 30, ys[0]), *P(D.COND_PASS_L + 80, ys[0]), lw=0.9, color="#3c5a7a")
    s.text(P(D.COND_PASS_L + 85, 0)[0], P(0, ys[0])[1], "→ 응축액 3/8\" 수액기로", size=4.8)
    s.dim_h(P(0, 0)[0], P(D.COND_PASS_L, 0)[0], P(0, -40)[1], P(0, 0)[1], f"{D.COND_PASS_L:.0f}")
    s.dim_v(P(0, 0)[1], P(0, D.FIN_HEIGHT)[1], P(-60, 0)[0], P(-30, 0)[0], f"{D.FIN_HEIGHT:.0f}")
    s.dim_v(P(0, ys[-2])[1], P(0, ys[-1])[1], P(D.COND_PASS_L + 120, 0)[0], P(D.COND_PASS_L + 30, 0)[0],
            f"통로 간격 {D.COND_PASS_PITCH:.0f}", left=False)
    s.text(P(450, 0)[0], P(0, -75)[1], "각 통로는 흐름 방향으로 1:100 내리막 (응축액 배수)", size=4.8, ha="center")

    # ── 응축기 측면 1:5
    S2, QX, QY = 0.2, 190.0, 165.0
    s.heading(QX + 8, 280, "측면", "1:5")
    s.rect(QX, QY, D.FIN_DEPTH * S2, D.FIN_HEIGHT * S2, lw=MED, fill="#f4f6f9", hatch="----")
    for y in ys:
        s.circle(QX + D.FIN_DEPTH / 2 * S2, QY + y * S2, D.COND_TUBE_OD / 2 * S2, lw=THIN, fill="white")
    s.dim_h(QX, QX + D.FIN_DEPTH * S2, QY - 6, QY, f"{D.FIN_DEPTH:.0f}", above=False)
    s.leader(QX + D.FIN_DEPTH / 2 * S2, QY + ys[5] * S2, QX + 22, QY + 70, f"Cu Ø{D.COND_TUBE_OD}×{D.COND_TUBE_T}")
    s.leader(QX + 2, QY + 20, QX + 22, QY + 30, f"Al 판핀 t{D.FIN_T} @ {D.FIN_PITCH:.0f}")

    # ── 수액기 단면 1:4
    S3, RX, RY = 0.25, 300.0, 168.0
    s.heading(RX + 30, 280, "수액기 단면", "1:4")
    w, h = D.REC_OD * S3, D.REC_H * S3
    s.rect(RX, RY, w, h, lw=MED, fill="white")
    s.rect(RX, RY - 6 * S3, w, 6 * S3, lw=MED, fill="#555")
    s.rect(RX, RY + h, w, 6 * S3, lw=MED, fill="#555")
    s.rect(RX + D.REC_T * S3, RY, w - 2 * D.REC_T * S3, D.CYCLED_L * D.REC_MM_PER_L * S3, lw=0, fill="#d9ecff")
    gx = RX + w + 8
    s.line(RX + w, RY + 10 * S3, gx, RY + 10 * S3, lw=MED)
    s.line(RX + w, RY + h - 10 * S3, gx, RY + h - 10 * S3, lw=MED)
    s.rect(gx - 1.5, RY + 10 * S3, 3, h - 20 * S3, lw=MED, fill="#eaf6ff")
    for L in range(0, 11):
        y = RY + L * D.REC_MM_PER_L * S3
        if y <= RY + h - 10 * S3:
            s.line(gx + 1.5, y, gx + (4 if L % 5 == 0 else 2.5), y, lw=THIN)
            if L % 2 == 0:
                s.text(gx + 5, y, f"{L} L", size=4.4)
    s.line(RX + w * 0.3, RY + h + 6 * S3, RX + w * 0.3, RY + h + 18, lw=0.9, color="#3c5a7a")
    s.text(RX + w * 0.3, RY + h + 20, "응축액 입구 3/8\"", size=4.6, ha="center")
    s.line(RX + w * 0.5, RY - 6 * S3, RX + w * 0.5, RY - 14, lw=0.6, color="#3c5a7a")
    s.text(RX + w * 0.5 + 2, RY - 14, "배출 1/4\" → V2 → 증발기", size=4.6)
    s.dim_v(RY, RY + h, RX - 6, RX, f"{D.REC_H:.0f}")
    s.dim_h(RX, RX + w, RY + h + 10, RY + h + 6 * S3, f"Ø{D.REC_OD}", above=True)
    s.text(gx + 2, RY + h + 4, "관형 액면계 (붕규산, 진공용)", size=4.6)
    s.text(RX + w / 2, RY + D.CYCLED_L * D.REC_MM_PER_L * S3 / 2, f"하루 {D.CYCLED_L:.1f} L", size=4.6, ha="center")

    # ── 표
    y = s.table(14, 130, [70, 40, 90], [
        ["응축기 열 설계", "값", "근거"],
        ["하루 응축 열량", f"{D.COND_Q_MJ:.1f} MJ", f"메탄올 {D.CYCLED_KG:.2f} kg × 잠열(30 °C)"],
        ["평균 / 최대 부하", f"{D.COND_Q_AVG_W:.0f} / {D.COND_Q_PEAK_W:.0f} W", f"탈착 {D.COND_HOURS:.0f} 시간 기준"],
        ["전열 면적 (핀 + 관)", f"{D.COND_AREA_M2:.1f} m²", f"판핀 {D.FINS}장"],
        ["외기 대비 응축 온도차", f"{D.COND_Q_AVG_W / (7 * D.COND_AREA_M2):.1f} / {D.COND_DT_K:.1f} K",
         "자연대류 7 W/m²K 가정, 평균 / 최대"],
        ["설계 응축 온도", f"{D.T_COND:.0f} °C", "낮 평균 외기 25 °C"],
    ], aligns=["left", "center", "left"], size=4.9)
    s.table(14, y - 5, [70, 40, 90], [
        ["수액기", "값", "비고"],
        ["내용적", f"{D.REC_L:.1f} L", f"하루 순환 {D.CYCLED_L:.1f} L의 {D.REC_L / D.CYCLED_L:.1f}배"],
        ["눈금 환산", f"{D.REC_MM_PER_L:.1f} mm/L", "액면계로 그날 생산량 예측"],
        ["끝판", "SUS304 t6 평판", "진공 외압 0.1 MPa"],
        ["설치 높이", "하단 EL 620", "증발기 상단(EL 530)보다 위 — 중력 배출"],
    ], aligns=["left", "center", "left"], size=4.9)
    s.notes(250, 140, "노트", [
        "응축기는 집열기 아래 그늘에 설치. 핀은 세로 방향 (자연대류).",
        "Cu 관 이음은 BCuP 경납땜. 메탄올과 Cu는 30~40 °C에서 호환.",
        ["응축 온도가 35 °C를 넘는 지역은 핀 면적 1.5배 또는", "수냉(물탱크) 응축기로 변경 — 얼음 약 10 % 감소 방지."],
        "액면계 양 끝은 진공용 메탈 개스킷 이음.",
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 5. 증발기·제빙함
# ════════════════════════════════════════════════════════════
def sheet_evaporator(pdf):
    s = Sheet(5, TOTAL, "증발기 · 제빙함", "지지봉 보강 평판 증발기 + 양면 얼음 몰드 + PU 단열함",
              "SI-100-300 / 310", "1:5, 1:4, 1:10")
    # ── 증발기 정면 1:5
    S, OX, OY = 0.2, 30.0, 180.0

    def P(x, y):
        return OX + x * S, OY + y * S

    s.heading(OX + 60, 280, "증발기 정면", "1:5 · 몰드 제거")
    s.rect(*P(0, 0), D.EVAP_W * S, D.EVAP_H * S, lw=BOLD, fill="#eef5fc")
    x0 = (D.EVAP_W - (D.STAYS_X - 1) * D.STAY_PITCH) / 2
    y0 = (D.EVAP_H - (D.STAYS_Y - 1) * D.STAY_PITCH) / 2
    for i in range(D.STAYS_X):
        for j in range(D.STAYS_Y):
            s.circle(*P(x0 + i * D.STAY_PITCH, y0 + j * D.STAY_PITCH), D.STAY_D / 2 * S, lw=THIN, fill="#555")
    level = 7.0e6 / ((D.EVAP_W - 4) * (D.EVAP_D - 4))
    s.line(*P(4, level), *P(D.EVAP_W - 4, level), lw=0.5, color="#2a6fdb", ls=(0, (3, 1.5)))
    s.text(P(D.EVAP_W + 8, 0)[0], P(0, level)[1], f"저녁 액면 ≈ {level:.0f} (7.0 L)", size=4.6, color="#2a6fdb")
    s.rect(*P(380, D.EVAP_H), 25.4 * S, 60 * S, lw=MED, fill="#cfe7da")
    s.text(P(393, D.EVAP_H + 70)[0], P(0, D.EVAP_H + 70)[1], "증기 출구 1\" → V1", size=4.6, ha="center")
    s.rect(*P(150, D.EVAP_H), 6.35 * S, 60 * S, lw=MED, fill="#d9ecff")
    s.text(P(153, D.EVAP_H + 70)[0], P(0, D.EVAP_H + 70)[1], "액 입구 1/4\" ← V2", size=4.6, ha="center")
    s.rect(*P(330, D.EVAP_H - 40), 120 * S, 3 * S, lw=MED, fill="#555")
    s.leader(*P(440, D.EVAP_H - 38), P(D.EVAP_W + 8, 0)[0], P(0, D.EVAP_H - 20)[1], "비말 방지판 (증기 출구 아래)", size=4.6)
    s.leader(*P(x0 + 8 * D.STAY_PITCH, y0), P(D.EVAP_W + 8, 0)[0], P(0, 60)[1],
             f"지지봉 Ø{D.STAY_D:.0f} × {D.STAYS_X * D.STAYS_Y} @ {D.STAY_PITCH:.0f}", size=4.6)
    s.dim_h(P(0, 0)[0], P(D.EVAP_W, 0)[0], P(0, -30)[1], P(0, 0)[1], f"{D.EVAP_W:.0f}", above=False)
    s.dim_v(P(0, 0)[1], P(0, D.EVAP_H)[1], P(-25, 0)[0], P(0, 0)[0], f"{D.EVAP_H:.0f}")

    # ── 측단면 1:4
    S2, QX, QY = 0.25, 230.0, 158.0
    s.heading(QX + 6, 280, "측단면", "1:4 · 양면 몰드 압착")
    t = D.EVAP_T * S2
    s.rect(QX, QY, D.EVAP_D * S2, D.EVAP_H * S2, lw=BOLD, fill="#eef5fc")
    s.rect(QX + t, QY + t, D.EVAP_D * S2 - 2 * t, level * S2, lw=0, fill="#cfe3f5")
    for side in (-1, 1):
        mx = QX - (D.MOLD_D + 1) * S2 if side < 0 else QX + D.EVAP_D * S2
        s.rect(mx, QY + 10 * S2, (D.MOLD_D + 1) * S2, D.MOLD_H * S2, lw=MED, fill="#f0fbff", hatch="..")
    s.dim_h(QX, QX + D.EVAP_D * S2, QY - 7, QY, f"{D.EVAP_D:.0f}", above=False)
    s.leader(QX - D.MOLD_D * S2 / 2, QY + 60, QX - 18, QY + 40, f"얼음 몰드 {D.MOLD_W:.0f}×{D.MOLD_H:.0f}×{D.MOLD_D:.0f}",
             size=4.6, ha="right")
    s.leader(QX + D.EVAP_D * S2 + 2, QY + 20, QX + 30, QY + 6, "클램프 프레임 (양면 압착)", size=4.6)

    # ── 제빙함 단면 1:10
    S3, BX, BY = 0.1, 300.0, 170.0
    s.heading(BX + 45, 280, "제빙함 단면", "1:10")
    ow, oh = D.BOX_IN_W + 2 * D.BOX_WALL, D.BOX_IN_H + 2 * D.BOX_WALL
    s.rect(BX, BY, ow * S3, oh * S3, lw=BOLD, hatch="xx")
    s.rect(BX + D.BOX_WALL * S3, BY + D.BOX_WALL * S3, D.BOX_IN_W * S3, D.BOX_IN_H * S3, lw=MED, fill="white")
    s.line(BX, BY + (oh - D.BOX_WALL) * S3, BX + ow * S3, BY + (oh - D.BOX_WALL) * S3, lw=MED)
    ex = BX + ow / 2 * S3
    ey = BY + (D.BOX_WALL + 30) * S3
    s.rect(ex - D.EVAP_D / 2 * S3, ey, D.EVAP_D * S3, D.EVAP_H * S3, lw=MED, fill="#cfe3f5")
    for side in (-1, 1):
        mx = ex - D.EVAP_D / 2 * S3 - D.MOLD_D * S3 if side < 0 else ex + D.EVAP_D / 2 * S3
        s.rect(mx, ey + 10 * S3, D.MOLD_D * S3, D.MOLD_H * S3, lw=THIN, fill="#f0fbff")
    s.line(ex + 1, ey + D.EVAP_H * S3, ex + 1, BY + oh * S3 + 5, lw=1.0, color="#1f6f4a")
    s.dim_h(BX, BX + ow * S3, BY - 6, BY, f"{ow:.0f}", above=False)
    s.dim_v(BY, BY + oh * S3, BX - 5, BX, f"{oh:.0f}")
    s.text(BX + ow * S3 + 2, BY + oh * S3 - 5, "뚜껑 PU 100 + 개스킷", size=4.4)
    s.text(BX + ow * S3 + 2, BY + 20, f"PU {D.BOX_WALL:.0f}", size=4.4)

    # ── 표
    y = s.table(14, 130, [70, 44, 86], [
        ["증발기", "값", "비고"],
        ["재질 / 판 두께", f"SUS304 / t{D.EVAP_T:.0f}", "TIG, 지지봉 양면 플러그 용접"],
        ["내용적", f"{D.EVAP_L:.1f} L", f"저녁 투입 {D.CYCLED_L:.1f} L + 잔량 0.5 L"],
        ["설계 압력", "외압 0.1 MPa (진공)", f"내압 {D.RELIEF_KPA_ABS} kPa(abs) (RV1)"],
        ["증발 온도 / 압력", f"{D.T_EVAP:.0f} °C / {D.P_EVAP_KPA:.1f} kPa", "메탄올 포화"],
    ], aligns=["left", "center", "left"], size=4.9)
    y = s.table(14, y - 5, [70, 44, 86], [
        ["얼음 몰드 · 제빙함", "값", "비고"],
        ["몰드", f"2개 × {D.MOLD_L:.2f} L", f"얼음 {2 * D.MOLD_L:.1f} kg/일 (목표 {D.ICE_TARGET_KG:.0f})"],
        ["몰드 재질", "SUS304 t0.8 (식품용)", "증발기 면에 클램프 압착"],
        ["제빙함 내부", f"{D.BOX_IN_W:.0f}×{D.BOX_IN_D:.0f}×{D.BOX_IN_H:.0f}", "PU 발포 100, 외피 SUS 또는 FRP"],
        ["냉열 이용률 목표", "0.85", "si100_sim 설계값 (단열 + 접촉)"],
    ], aligns=["left", "center", "left"], size=4.9)
    s.notes(250, 140, "노트", [
        "몰드와 증발기 접촉면 평탄도 0.3 이내. 열전달 그리스 금지(식품).",
        ["지지봉 없이 진공을 걸면 판이 찌그러진다.", "지지봉 용접 후 진공 시험으로 변형 확인 (≤ 1 mm)."],
        "증발기 상단 비말 방지판으로 액 튐이 흡착관으로 가지 않게 한다.",
        "얼음 회수 시 V1 닫은 뒤 몰드 분리.",
    ], width=160, size=4.9, gap=4.2)
    s.save(pdf)


# ════════════════════════════════════════════════════════════
# 6. 공정·충전·시험 사양
# ════════════════════════════════════════════════════════════
def sheet_process(pdf):
    s = Sheet(6, TOTAL, "공정 · 충전 · 시험 사양", "제작 순서 / 메탄올 충전 / 합격 시험 / 안전",
              "SI-100-400", "NONE")
    s.heading(118, 280, "필수 공정 순서", "순서 변경·생략 금지")
    steps = [
        ("가공", "흡착관·끝판·헤더·스텁·수액기·증발기 가공. 증발기 지지봉 용접."),
        ("세척", "탈지 → 10 % 구연산 산세 → DI 헹굼 → N₂ 건조. 탄화수소 잔류 금지."),
        ("흡착제 링 성형", f"Maxsorb III + ENG {D.ENG_FRACTION * 100:.0f} wt% 압축, 밀도 {D.CARBON_DENSITY:.2f} g/cm³, 링 질량 기록."),
        ("링 진공 베이크", "250 °C · 8 h · < 1×10⁻³ Pa. 건조 N₂ 보관."),
        ("링 삽입·끝판 용접", "건조 N₂ 분위기. 냉각 지그로 링 < 150 °C."),
        ("계통 조립·용접", "헤더·배관·밸브 TIG (백실드). 응축기 BCuP 경납."),
        ("누설 시험 1", "He 질량분석, 접합부별 < 1×10⁻⁹ Pa·m³/s."),
        ("코팅·단열", "선택흡수 코팅 (내열 ≥ 250 °C), 증발기 몰드 장착."),
        ("계통 진공 베이크", "흡착기 200 °C · 8 h, 끝 압력 < 1×10⁻² Pa."),
        ("압력 상승 시험", "격리 24 h, 25 °C에서 상승 < 50 Pa."),
        ("메탄올 탈기", "동결–배기–해동 × 3."),
        ("충전", f"V3로 {D.CHARGE_KG:.1f} kg ± 0.1 kg, 질량으로. 증발기 냉각 상태."),
        ("밀봉·누설 시험 2", "V3 캡 체결, He 누설 시험."),
        ("성능 시험", "아래 시험표 T3~T5 합격 후 출하."),
    ]
    y = 266.0
    for i, (name, desc) in enumerate(steps, 1):
        key = i in (4, 9, 12)
        s.rect(16, y - 11, 200, 11, lw=MED, fill="#eef2f7" if key else "white")
        s.rect(16, y - 11, 6, 11, lw=MED, fill="#2c4a66" if key else "#8796a8")
        s.text(19, y - 5.5, str(i), size=5.5, ha="center", color="white", weight="bold")
        s.text(25, y - 3.4, name, size=5.8, weight="bold")
        s.text(25, y - 8.2, desc, size=4.8)
        if i < len(steps):
            s.arrow(116, y - 11, 116, y - 12.6, head=1.8)
        y -= 12.6
    s.text(16, y - 2, "진한 칸 = 불응축 가스 방지 핵심 공정", size=4.6, color="#2c4a66")

    y = s.table(228, 270, [52, 40, 40], [
        ["충전·운전 파라미터", "값", "한계"],
        ["작동유체", "메탄올 ≥ 99.9 %", "수분 < 0.05 %"],
        ["충전량", f"{D.CHARGE_KG:.1f} kg", "± 0.1 kg (질량)"],
        ["하루 순환량", f"{D.CYCLED_KG:.2f} kg", f"{D.CYCLED_L:.1f} L"],
        ["탈착 최고 온도", f"{D.T_GEN:.0f} °C", "≤ 110 °C"],
        ["증발 압력 (−5 °C)", f"{D.P_EVAP_KPA:.1f} kPa", "절대압"],
        ["응축 압력 (30 °C)", f"{D.P_COND_KPA:.1f} kPa", "절대압"],
        ["안전밸브 RV1", f"{D.RELIEF_KPA_ABS} kPa(abs)", "배출구 실외 고소"],
    ], title="", aligns=["left", "center", "center"], size=4.9)
    y = s.table(228, y - 5, [10, 62, 60], [
        ["#", "시험", "합격 기준"],
        ["T1", "He 누설 (공정 7, 13)", "< 1×10⁻⁹ Pa·m³/s / 접합부"],
        ["T2", "압력 상승 24 h (공정 10)", "< 50 Pa"],
        ["T3", "1일 제빙 (일사 ≥ 18 MJ/m²)", "얼음 ≥ 8 kg (초품)"],
        ["T4", "3일 연속 반복", "T3의 90 % 이상"],
        ["T5", "과열 댐퍼 작동", "105 ± 3 °C 개방"],
    ], aligns=["center", "left", "left"], size=4.9)
    s.notes(228, y - 6, "금지 — 고장·사고 원인", [
        "메탄올 충전 후 흡착관을 120 °C 이상 가열 (메탄올 분해 → 불응축 가스).",
        "Al·아연·고무·플라스틱이 메탄올에 닿는 부품.",
        "나사식·O-링 충전구 (진공 누설 → 성능 저하).",
        "유기 바인더 흡착제, 50 µm보다 굵은 필터망.",
        ["실내·밀폐 공간 설치. 메탄올은 독성·인화성", "— 경고 표지, 소화기, 보호구 비치."],
    ], width=182, size=4.8, gap=4.0)
    s.save(pdf)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "SI-100_drawingset_RevA.pdf"
    with PdfPages(path) as pdf:
        sheet_ga(pdf)
        sheet_collector(pdf)
        sheet_tube(pdf)
        sheet_condenser(pdf)
        sheet_evaporator(pdf)
        sheet_process(pdf)
    print(path)


if __name__ == "__main__":
    main()
