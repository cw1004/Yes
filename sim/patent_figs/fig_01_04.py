"""도 1 ~ 도 4."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import matplotlib.pyplot as plt
import draw as D


def tfmt(t):
    if t < 1e-3:
        return f"{t*1e6:g} μs"
    if t < 1:
        return f"{t*1e3:g} ms"
    return f"{t:g} s"


# ══════════════════════════════════════════════════════ 도 1 전체 시스템 블록도
def fig1():
    fig, ax = D.canvas(10.4, 7.4)
    AX, AY, AS = 79.0, 77.0, 9.0
    g = D.and_gate(ax, AX, AY, s=AS)
    xin = AX - AS * 0.52

    D.box(ax, 25, 88, 41, 9, "디지털 트윈 · 학습 · 검증 (오프라인)", ref=700,
          dashed=True, fs=8.4)
    D.box(ax, 3, 70, 16, 14, "센서부\n\n고속 · 중속\n저속 · 파라메트릭", ref=100, fs=8.0)
    D.box(ax, 25, 70, 21, 14, "진단부   QM(D)\n\n공유 백본 + 5 헤드\nP_fail, U_epis, OOD",
          ref=200, fs=8.0)
    D.box(ax, 52, 70, 16, 14, "복원 정책부\n\n상태 전이\nS0 ~ S4", ref=300, fs=8.0)
    D.box(ax, 86, 70, 12, 14, "재구성\n제어부\n\n게이트\n구동 신호", ref=400, fs=8.0)
    D.box(ax, 25, 57, 25, 8, "계층적 시간\n예산 감시부", ref=500, fs=8.0)

    D.box(ax, 25, 28, 58, 22, "", ref=600)
    ax.text(26.5, 48.6, "안전 감시부   ASIL D(D)   독립 전원 · 클럭 · 연산자원 · 센싱 채널",
            fontsize=8.0, va="top", ha="left", zorder=6)
    D.box(ax, 27.5, 31.5, 17, 13, "독립 센싱 및\n신호 타당성\n검사", ref=610, fs=7.8)
    D.box(ax, 47, 31.5, 15, 13, "재구성 허가\n신호 RP\n결정론적 산출", ref=630, fs=7.8)
    D.box(ax, 64.5, 31.5, 17, 13, "구동측·회생측\n안전 상한 산출\n부호별 클램프", ref=620, fs=7.8)

    D.box(ax, 3, 6, 95, 14, "3상 인버터 및 전동기      "
          "L0 : DESAT · OCP · UVLO      L1 : 하드웨어 비교기", ref=10, fs=8.6)

    # ── 배선
    D.poly(ax, [(11, 20), (11, 70)])
    D.note(ax, 12.4, 45, "전기적 · 열적\n상태량", fs=7.0, ha="left", style="n")
    D.arrow(ax, (30, 20), (30, 28))
    D.note(ax, 28.6, 24, "독립 센싱 경로", fs=7.0, ha="right", style="n")

    D.arrow(ax, (19, 77), (25, 77))
    D.arrow(ax, (46, 77), (52, 77))
    D.note(ax, 49, 79.4, "P_fail\nU_epis\nOOD", fs=6.6, ha="center", va="bottom",
           style="n")
    D.arrow(ax, (68, 79.8), (xin, 79.8))
    D.note(ax, 70.5, 81.4, "재구성 요구", fs=7.0, ha="center", va="bottom", style="n")

    D.poly(ax, [(58, 44.5), (58, 47), (72.5, 47), (72.5, 74.2), (xin, 74.2)])
    D.note(ax, 73.6, 62, "RP", fs=7.6, ha="left", style="n")
    D.poly(ax, [(50, 61), (70, 61), (70, 77), (xin, 77)], dashed=True)
    D.note(ax, 70.8, 68, "시간 예산\n정상", fs=6.4, ha="left", style="n")
    D.arrow(ax, (AX + AS * 0.52, AY), (86, AY))

    D.poly(ax, [(66, 70), (66, 50)])
    D.note(ax, 67.2, 60, "토크 지령", fs=7.0, ha="left", style="n")
    D.poly(ax, [(79, 50), (79, 56), (86, 56), (86, 70)])
    D.note(ax, 82.5, 57.4, "제한된\n토크 지령", fs=6.8, ha="center", va="bottom",
           style="n")
    D.poly(ax, [(92, 70), (92, 20)])
    D.note(ax, 93.2, 45, "게이트\n구동 신호", fs=7.0, ha="left", style="n")

    D.arrow(ax, (35, 88), (35, 84), dashed=True)
    D.note(ax, 36.4, 86, "모델 · 통계량 배포 (OTA)", fs=6.8, ha="left", style="n")
    D.arrow(ax, (33, 65), (33, 70), dashed=True)
    D.poly(ax, [(46, 65), (46, 67), (56, 67), (56, 70)], dashed=True)

    D.note(ax, 34, 23.6, "※ 재구성 게이트 명령은 정책부(300)의 재구성 요구와 "
           "감시부(600)의 재구성 허가 RP의 하드웨어 논리곱을 통과한 경우에만 출력된다.",
           fs=7.0)
    D.caption(fig, 1, "전체 시스템 블록도")
    D.save(fig, "fig01_system_block.png")


# ══════════════════════════════════════════════════════ 도 2 보호 계층 구조도
def fig2():
    fig = plt.figure(figsize=(9.8, 4.5))
    ax = fig.add_axes([0.335, 0.17, 0.645, 0.70])
    ax.set_xscale("log")
    ax.set_xlim(1e-6, 2e2)
    ax.set_ylim(-0.55, 3.9)

    rows = [
        (3, "L0", "게이트 드라이버 내장 보호\nDESAT · OCP · UVLO", 2e-6, 1e-5, True),
        (2, "L1", "하드웨어 비교기 기반\n과전압 · 과온 차단", 5e-5, 2e-4, True),
        (1, "L2", "ECU 소프트웨어 진단 및 출력 제한\n진단부(200) · 정책부(300) · 감시부(600)",
         1e-3, 1e-1, False),
        (0, "L3", "냉각 루프 협조 제어", 1e0, 6e1, False),
    ]
    y0f, dyf = 0.755, 0.178
    for y, tag, desc, t0, t1, prem in rows:
        h = 0.40
        ax.add_patch(plt.Rectangle((t0, y - h / 2), t1 - t0, h, facecolor="white",
                                   edgecolor="black", lw=1.1,
                                   hatch=("////" if prem else None), zorder=3))
        ax.text(np.sqrt(t0 * t1), y + 0.30, f"{tfmt(t0)} ~ {tfmt(t1)}",
                ha="center", va="bottom", fontsize=7.2, zorder=5)
        yf = y0f - (3 - y) * dyf
        fig.text(0.022, yf, tag, ha="left", va="center", fontsize=11,
                 fontweight="bold")
        fig.text(0.072, yf, desc, ha="left", va="center", fontsize=7.6,
                 linespacing=1.4)

    ax.plot([3.6e-4, 3.6e-4], [-0.55, 3.35], color="black", lw=1.0, ls=(0, (5, 3)))
    ax.annotate("", xy=(1.7e2, 3.55), xytext=(4.2e-4, 3.55),
                arrowprops=dict(arrowstyle="<->", lw=1.0, color="black"))
    ax.text(np.sqrt(4.2e-4 * 1.7e2), 3.63, "본 발명의 관여 범위", ha="center",
            va="bottom", fontsize=8.4)
    ax.text(3.0e-4, 3.63, "빗금 : 본 발명이 전제하는 계층", ha="right", va="bottom",
            fontsize=7.4)

    ticks = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1e0, 1e1, 1e2]
    ax.set_xticks(ticks)
    ax.set_xticklabels([tfmt(t) for t in ticks], fontsize=7.4)
    ax.set_xticks([], minor=True)
    ax.set_yticks([])
    ax.set_xlabel("응답 시간 (대수 눈금)", fontsize=8.6)
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    D.caption(fig, 2, "보호 계층 구조 및 각 계층의 응답 시간")
    D.save(fig, "fig02_protection_layers.png")


# ══════════════════════════════════════════════════════ 도 3 상태 전이도
def fig3():
    fig, ax = D.canvas(10.4, 7.0)
    YB, HB = 74, 10
    D.box(ax, 3, YB, 15, HB, "S0\n정상 운전", fs=8.4)
    D.box(ax, 26, YB, 15, HB, "S1\n사전 냉각", fs=8.4)
    D.box(ax, 49, YB, 15, HB, "S2\n출력 디레이팅", fs=8.4)
    D.box(ax, 80, YB, 15, HB, "S3\n회로 재구성", fs=8.4, double=True)
    D.box(ax, 46, 44, 21, 13, "S2⁺  게이팅 체류\n디레이팅 심화 25 %\n정비 요구 신호", fs=8.0)
    D.box(ax, 80, 8, 15, 11, "S4\n안전 정지\nASC / FW", fs=8.4, double=True)

    ym = YB + HB / 2
    D.arrow(ax, (18, ym), (26, ym))
    D.note(ax, 22, 85.6, "slope(P_fail) > 0.15/s\nOR P_fail ≥ 0.20\n"
           "OR (T_j,max − T_j) < 25 K", fs=6.6, ha="center", va="bottom", style="n")
    D.arrow(ax, (41, ym), (49, ym))
    D.note(ax, 45, 85.6, "P_fail ≥ T1", fs=7.0, ha="center", va="bottom", style="n")
    D.arrow(ax, (64, ym), (80, ym))
    D.note(ax, 72, 85.6, "P_fail ≥ T2  AND  U_epis < U_max  AND  ¬OOD\n"
           "AND  w < W_max  AND  고장 모드 확정\nAND  RP = 참  AND  시간 예산 정상",
           fs=6.6, ha="center", va="bottom", style="n")

    D.poly(ax, [(31, YB), (31, 69), (14, 69), (14, YB)])
    D.note(ax, 22.5, 67.6, "P_fail < T1 − ΔT1", fs=6.8, ha="center", va="top",
           style="n")
    D.poly(ax, [(51, YB), (51, 62.5), (36, 62.5), (36, YB)])
    D.note(ax, 43.5, 61.1, "히스테리시스 + 최소 체류", fs=6.8, ha="center", va="top",
           style="n")

    D.poly(ax, [(53, YB), (53, 57)])
    D.note(ax, 51.6, 69.5, "게이팅\nU_epis ≥ U_max  OR  OOD = 참\n"
           "OR  w ≥ W_max  OR  RP_data = 거짓", fs=6.8, ha="right", style="n")
    D.poly(ax, [(61, 57), (61, YB)])
    D.note(ax, 62.4, 68.5, "게이트 해제\n+ 최소 체류 경과", fs=6.8, ha="left", style="n")

    D.poly(ax, [(67, 50.5), (74, 50.5), (74, 13.5), (80, 13.5)])
    D.note(ax, 75.4, 33, "체류 ≥ t_hold ( 30 s )\nAND  P_fail ≥ T2 유지", fs=6.8,
           ha="left", style="n")
    D.poly(ax, [(87.5, YB), (87.5, 19)])
    D.note(ax, 88.9, 50, "감시부 트립\nOR  RP_env = 거짓", fs=6.8, ha="left", style="n")
    D.poly(ax, [(7, YB), (7, 11), (80, 11)])
    D.note(ax, 41, 12.4, "임의 상태에서 :  L0 / L1 트립 확인  OR  안전 감시부 트립  "
           "OR  RP_env = 거짓", fs=7.0, ha="center", va="bottom", style="n")

    D.note(ax, 14, 31, "· S3는 비가역 상태이므로 하향 전이 임계를 두지 않는다.\n"
           "· S2⁺의 유계 체류는 보류 자체가 위험이 되는 것을 방지한다.\n"
           "· 상향 전이는 N = 3 회 연속 조건 충족 시에만 실행된다.\n"
           "· 이중선 : 비가역 또는 종단 상태", fs=7.2)
    D.caption(fig, 3, "상태 전이도 (불확실도 게이팅 및 유계 체류 포함)")
    D.save(fig, "fig03_state_machine.png")


# ══════════════════════════════════════════════════════ 도 4 진단부 구조도
def fig4():
    fig, ax = D.canvas(10.4, 7.2)
    D.box(ax, 3, 72, 18, 22, "입력 특징\n\n· Park 성분 d_a, d_b, d_c\n· 궤적 이심률\n"
          "· ΔV_CE(on), ΔZ_th\n· T_j 여유\n· 턴온 지연 편차\n· dv/dt, DC 리플\n"
          "· THD, 부하율, V_dc", fs=7.0, align="left", va_top=True, pad=1.8)

    D.box(ax, 26, 77, 19, 12, "1D-CNN 공유 백본\n\n스펙트럴 정규화\nσ_max ≤ c", fs=7.8)
    D.box(ax, 50, 77, 19, 12, "TCN 시계열 인코더\n인과적 팽창 합성곱\n수용영역 W = 64", fs=7.8)
    D.note(ax, 35.5, 75.4, "거리 보존 (bi-Lipschitz)\n기하 지표 유효화", fs=6.6,
           ha="center", va="top")
    D.note(ax, 59.5, 75.4, "고정 수용영역\n결정론적 WCET 산정 가능", fs=6.6,
           ha="center", va="top")

    D.arrow(ax, (21, 83), (26, 83))
    D.arrow(ax, (45, 83), (50, 83))
    D.note(ax, 47.5, 84.4, "z", fs=7.6, ha="center", va="bottom", style="n")

    for i in range(5):
        y = 86 - i * 7.4
        D.box(ax, 76, y - 2.6, 13, 5.2, f"헤드 {i+1}", fs=7.4)
        ax.text(90.4, y, f"μ{i+1} ,  σ²{i+1}", fontsize=7.2, va="center", zorder=6)
        D.arrow(ax, (69, 83), (76, y))
    D.note(ax, 74.6, 51, "M = 5\n독립 초기화\n+ 부트스트랩", fs=6.8, ha="right",
           va="center")

    D.box(ax, 26, 33, 68, 10, "probit 사영    "
          "p_m = sigmoid( μ_m / √( 1 + π·σ²_m / 8 ) )        P_fail = (1/M) Σ p_m",
          fs=8.0)
    D.poly(ax, [(89, 51), (89, 47), (60, 47), (60, 43)])

    D.box(ax, 4, 12, 27, 13, "U_total = H( P_fail )\n\n전체 불확실도", fs=7.8)
    D.box(ax, 36.5, 12, 27, 13, "U_alea = (1/M) Σ H( p_m )\n\n우연적 불확실도", fs=7.8)
    D.box(ax, 69, 12, 27, 13, "U_epis = U_total − U_alea\n\n인식적 불확실도\n( 상호정보량 )",
          fs=7.8, double=True)
    for x0, x1 in ((40, 17.5), (55, 50), (75, 82.5)):
        D.poly(ax, [(x0, 33), (x0, 29), (x1, 29), (x1, 25)])

    D.note(ax, 4, 6.5, "H(p) = − [ p·ln p + (1−p)·ln(1−p) ]        "
           "세 항이 모두 nat 단위로 가법적이며, Jensen 부등식에 의해 U_epis ≥ 0 이 보장된다.\n"
           "값의 범위는 [ 0 , ln 2 = 0.6931 ] nat 이므로, 확률 분산과 달리 "
           "P_fail 에 의존하는 상한 제약을 받지 않는다.", fs=7.0)
    D.caption(fig, 4, "진단부(200) 신경망 구조 및 불확실도 분해 경로")
    D.save(fig, "fig04_diagnosis_net.png")


for f in (fig1, fig2, fig3, fig4):
    f()
