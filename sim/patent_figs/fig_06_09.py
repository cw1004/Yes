"""도 6 ~ 도 9."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import matplotlib.pyplot as plt
import draw as D


# ══════════════════════════════════════════════ 도 6 분포외 판정 구조도
def fig6():
    fig, ax = D.canvas(10.4, 6.8)
    D.box(ax, 3, 82, 16, 12, "정규화된\n입력 특징  x", fs=8.2)
    D.box(ax, 27, 82, 18, 12, "공유 백본\n( 스펙트럴 정규화 )", fs=8.2, ref=200)
    D.box(ax, 53, 82, 16, 12, "M 개 예측 헤드", fs=8.2)
    D.arrow(ax, (19, 88), (27, 88))
    D.arrow(ax, (45, 88), (53, 88))
    D.note(ax, 49, 89.4, "z", fs=7.6, ha="center", va="bottom", style="n")
    D.note(ax, 70.5, 88, "p_1 … p_M", fs=7.6, ha="left", style="n")

    det = [(1.5, "입력공간\n클래스 조건부\n마할라노비스 거리\nD_M,in(x)"),
           (21, "입력공간\n주성분 재구성\n잔차\nR_in(x)"),
           (40.5, "잠재공간\n클래스 조건부\n마할라노비스 거리\nD_M,lat(z)"),
           (60, "잠재공간\n주성분 재구성\n잔차\nR_lat(z)"),
           (79.5, "앙상블 불일치\n상호정보량\nU_epis")]
    for x, t in det:
        D.box(ax, x, 56, 18, 18, t, fs=7.4)
    D.poly(ax, [(11, 82), (11, 78), (10.5, 78), (10.5, 74)])
    D.poly(ax, [(11, 78), (30, 78), (30, 74)])
    D.poly(ax, [(36, 82), (36, 79.5), (49.5, 79.5), (49.5, 74)])
    D.poly(ax, [(49.5, 79.5), (69, 79.5), (69, 74)])
    D.poly(ax, [(61, 82), (61, 76.5), (88.5, 76.5), (88.5, 74)])

    D.box(ax, 1.5, 42, 96, 9, "분포내 경험분포함수에 의한 표준화       "
          "F_j (·) = 분포내 재구성 후보 집합에서의 경험 분위수      ( j = 1 … 5 )", fs=8.0)
    for x, _ in det:
        D.arrow(ax, (x + 9, 56), (x + 9, 51))

    D.box(ax, 33, 28, 33, 9, "결합 점수   S(x) = max_j  F_j (x)", fs=8.4)
    D.poly(ax, [(49.5, 42), (49.5, 37)])
    D.diamond(ax, 49.5, 15, 30, 15, "S(x)  ≥  G_th ?", fs=8.4)
    D.poly(ax, [(49.5, 28), (49.5, 22.5)])
    D.arrow(ax, (64.5, 15), (74, 15))
    D.box(ax, 74, 9, 23, 12, "OOD = 참\n\n재구성 보류\nS2⁺ 체류", fs=8.0, double=True)
    D.arrow(ax, (34.5, 15), (25, 15))
    D.box(ax, 2, 9, 23, 12, "OOD = 거짓\n\n다른 조건 평가로\n진행", fs=8.0)

    D.note(ax, 1.5, 3.2, "G_th = Quantile ( S(분포내 재구성 후보) ,  1 − β )      "
           "이로써 분포내 오게이팅률이 설계값 β 와 정확히 일치하도록 임계를 직접 설계할 수 있다.\n"
           "※ 이진 출력에서 예측 엔트로피 H(P_fail) 은 P_fail 만의 결정론적 단조 함수이므로 "
           "분포외성에 관한 추가 정보를 담지 않는다. 따라서 기하 지표와의 병용이 필수적이다.", fs=7.0)
    D.caption(fig, 6, "분포외 판정 구조 (입력공간 · 잠재공간 기하 지표와 앙상블 불일치의 결합)")
    D.save(fig, "fig06_ood_detection.png")


# ══════════════════════════════════════════════ 도 7 고장 모드 판별 흐름도
def fig7():
    fig, ax = D.canvas(9.8, 10.4)
    CX, LX, LW_, RX, RW = 36, 2, 15, 66, 30

    D.rbox(ax, CX - 13, 93.5, 26, 5.5, "진단 주기 개시")
    D.diamond(ax, CX, 87, 34, 9,
              "DESAT 트립 이력  OR  켈빈 소스 di/dt 감지\nOR  게이트 전압 플래토 이상 ?", fs=6.8)
    D.poly(ax, [(CX, 93.5), (CX, 91.5)])
    D.arrow(ax, (CX + 17, 87), (RX, 87))
    D.note(ax, RX - 1.4, 88.4, "참", fs=7.0, ha="right", va="bottom", style="n")
    D.box(ax, RX, 82, RW, 10, "단락고장 확정\n\n도 9 의 처리로 진행", fs=7.8, double=True)

    D.diamond(ax, CX, 76, 28, 8, "| i_s |  >  0.10 pu ?", fs=7.4)
    D.poly(ax, [(CX, 82.5), (CX, 80)])
    D.note(ax, CX + 1.2, 81.3, "거짓", fs=7.0, ha="left", style="n")
    D.arrow(ax, (CX - 14, 76), (LX + LW_, 76))
    D.note(ax, CX - 15.4, 77.4, "거짓", fs=7.0, ha="right", va="bottom", style="n")
    D.box(ax, LX, 71, LW_, 10, "판정 보류\n\n저부하에서\nd_k 불안정", fs=7.2)

    D.box(ax, 18, 63, 44, 8, "정규화 평균 전류 Park 벡터 산출\n"
          "d_k = ⟨ i_k ⟩ / ( 평균 | i_s | ) ,   k ∈ { a, b, c }", fs=7.4)
    D.poly(ax, [(CX, 72), (CX, 71)])
    D.note(ax, CX + 1.2, 71.5, "참", fs=7.0, ha="left", style="n")

    D.diamond(ax, CX, 55, 30, 8, "max | d_k |  >  d_th ( 0.30 ) ?", fs=7.4)
    D.poly(ax, [(CX, 63), (CX, 59)])
    D.arrow(ax, (CX - 15, 55), (LX + LW_, 55))
    D.note(ax, CX - 16.4, 56.4, "거짓", fs=7.0, ha="right", va="bottom", style="n")
    D.box(ax, LX, 50, LW_, 10, "정상\n\n개방고장\n없음", fs=7.2)

    D.diamond(ax, CX, 42, 32, 9, "해당 상 전류 실효값\n≈ 0  ( < 15 % ) ?", fs=7.2)
    D.poly(ax, [(CX, 51), (CX, 46.5)])
    D.arrow(ax, (CX + 16, 42), (RX, 42))
    D.note(ax, RX - 1.4, 43.4, "참", fs=7.0, ha="right", va="bottom", style="n")
    D.box(ax, RX, 36, RW - 2, 12, "상 개방\n레그 전체 또는 결선 단선\nPark 궤적이 직선으로 퇴화",
          fs=7.4)
    D.poly(ax, [(CX, 37.5), (CX, 28), (RX, 28)])
    D.note(ax, CX + 1.2, 33, "거짓\n실효값 약 70 % = 1/√2", fs=7.0, ha="left", style="n")
    D.box(ax, RX, 22, RW - 2, 12, "단일 스위치 개방\n상암 또는 하암 중 하나\n"
          "Park 궤적이 반원으로 결손", fs=7.4)

    D.box(ax, 6, 14, 52, 9, "고장 소자 위치 특정      "
          "Park 벡터 각  α = atan2( ⟨i_β⟩ , ⟨i_α⟩ ) 및 d_k 의 부호로\n"
          "6 개 소자 중 하나를 특정", fs=7.2)
    D.poly(ax, [(RX, 42), (62, 42), (62, 18.5), (58, 18.5)])
    D.poly(ax, [(RX, 28), (62, 28)], head=False)

    D.diamond(ax, 24, 7, 42, 9,
              "연속 3 전기각 주기 충족  AND\n경과시간 < t_oc,max ( 300 ms ) ?", fs=7.0)
    D.poly(ax, [(24, 14), (24, 11.5)])
    D.arrow(ax, (45, 7), (52, 7))
    D.note(ax, 48.5, 8.4, "참", fs=7.0, ha="center", va="bottom", style="n")
    D.box(ax, 52, 2.5, 24, 9, "개방고장 확정", fs=8.0, double=True)
    D.poly(ax, [(24, 2.5), (24, 0.6), (98.6, 0.6), (98.6, 82)])
    D.note(ax, 97.4, 62, "거짓 : 판별 불능\n보수적으로 단락고장으로\n간주", fs=7.0,
           ha="right", style="n")

    D.caption(fig, 7, "고장 모드 판별 흐름도 (단일 스위치 개방 / 상 개방 / 단락 / 판별 불능)")
    D.save(fig, "fig07_fault_mode_flow.png")


# ══════════════════════════════════════════════ 도 8 개방고장 타이밍 차트
def fig8():
    T1, T2, T4, tmax = 0.05, 0.16, 1.45, 1.6
    t = np.linspace(0, tmax, 4000)

    def step(bounds, vals):
        y = np.full_like(t, vals[-1])
        for (a, b), v in zip(bounds, vals):
            y[(t >= a) & (t < b)] = v
        return y

    sig = [
        ("고장 검출", step([(0, T1), (T1, T1 + 0.015)], [0, 1, 0]), ("0", "1")),
        ("고장 소자 게이트  S_x",
         np.where(t < T1, (np.sin(2 * np.pi * 90 * t) > 0).astype(float), 0.0),
         ("차단", "PWM")),
        ("건전 소자 게이트 저항  R_g", step([(0, T1), (T1, T4)], [2.2, 10, 2.2]),
         ("2.2 Ω", "10 Ω")),
        ("데드타임  t_d", step([(0, T1), (T1, T4)], [1.5, 2.7, 1.5]),
         ("1.5 μs", "2.7 μs")),
        ("대체 경로 절체 소자", step([(0, T2)], [0, 1]), ("개방", "도통")),
        ("전류 지령  i*", np.clip((t - T2) * 0.5, 0, 0.5) * (t > T2),
         ("0 pu", "0.5 pu")),
        ("PWM 주파수  f_sw", step([(0, T2)], [10, 6]), ("6 kHz", "10 kHz")),
        ("출력 상한", step([(0, T1), (T1, T2)], [100, 25, 50]),
         ("25 %", "100 %"), 50.0),
    ]
    fig, axs = plt.subplots(len(sig), 1, figsize=(9.8, 7.6), sharex=True)
    fig.subplots_adjust(left=0.235, right=0.915, top=0.885, bottom=0.175, hspace=0.34)
    sig = [(a, b, c, None) if len(x) == 3 else x
           for x in sig for a, b, c, *r in [x]]
    for ax, (lab, y, names, mid) in zip(axs, sig):
        ax.step(t, y, where="post", color="black", lw=1.2)
        ax.set_xlim(0, tmax)
        lo, hi = float(y.min()), float(y.max())
        rng = (hi - lo) or 1.0
        ax.set_ylim(lo - 0.30 * rng, hi + 0.45 * rng)
        ax.set_yticks([])
        ax.tick_params(axis="both", length=0)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        ax.text(-0.012, 0.5, lab, transform=ax.transAxes, ha="right", va="center",
                fontsize=7.8)
        ax.text(tmax * 1.012, lo, names[0], fontsize=6.8, va="center")
        ax.text(tmax * 1.012, hi, names[1], fontsize=6.8, va="center")
        if mid is not None:
            ax.text(tmax * 1.012, mid, f"{mid:g} %", fontsize=6.8,
                    va="center")
        for x in (T1, T2, T4):
            ax.axvline(x, color="black", lw=0.7, ls=(0, (3, 2.5)), zorder=0)
    for x, mk in ((T1, "①②③"), (T2, "④⑤⑥"), (T4, "⑦")):
        axs[0].text(x, 1.28, mk, transform=axs[0].get_xaxis_transform(),
                    fontsize=8.6, ha="center", va="bottom")
    axs[-1].set_xlabel("시간 [ s ]", fontsize=8.4)
    axs[-1].tick_params(axis="x", labelsize=7.4, length=3)
    fig.text(0.02, 0.055,
             "① 고장 소자 게이트 영구 차단      ② 게이트 저항 절환 R_g1 → R_g2 "
             "( 스위칭 엣지 di/dt 억제 )      ③ 데드타임 연장 Δt ≥ t_d(off)|R_g2 − t_d(off)|R_g1\n"
             "④ 대체 경로 절체 소자 투입 ( 해당 상 전류의 영교차에 동기 )      "
             "⑤ 전류 지령 램프업 ≤ 200 A/s      ⑥ PWM 주파수 하향 및 출력 상한 재설정\n"
             "⑦ 과도 구간 종료 : R_g 및 데드타임 복귀   "
             "( 고 R_g 운전의 허용 지속시간은 ΔP_sw 와 R_th 로부터 산정하여 한정한다 )",
             fontsize=7.0, ha="left", va="bottom", linespacing=1.5)
    D.caption(fig, 8, "개방고장 재구성 게이트 타이밍 차트")
    D.save(fig, "fig08_oc_timing.png")


# ══════════════════════════════════════════════ 도 9 단락고장 처리 흐름도
def fig9():
    fig, ax = D.canvas(9.8, 8.8)
    CX = 42

    D.rbox(ax, CX - 14, 93, 28, 5.5, "단락고장 확정 ( 도 7 )")
    D.box(ax, CX - 22, 84, 44, 6.5, "① 전 스위치 즉시 차단   ( L0 계층이 이미 수행 )", fs=7.8)
    D.poly(ax, [(CX, 93), (CX, 90.5)])

    D.diamond(ax, CX, 74, 36, 10, "② 직렬 차단 소자 보유 ?\n( 레그 직렬형 또는 상 출력 직렬형 )",
              fs=7.2)
    D.poly(ax, [(CX, 84), (CX, 79)])
    D.arrow(ax, (CX - 18, 74), (22, 74))
    D.note(ax, 23.4, 75.4, "미보유", fs=7.0, ha="left", va="bottom", style="n")
    D.box(ax, 2, 68, 20, 12, "재구성 불가\n\nDC 링크 차단기만\n보유한 구성 포함", fs=7.2)

    D.box(ax, CX - 22, 57, 44, 8, "개방 지령 및 격리 확인\n"
          "분리 소자 양단 전압 측정  또는  시험 펄스 후 상전류 부재 3 주기 확인", fs=7.2)
    D.poly(ax, [(CX, 69), (CX, 65)])
    D.diamond(ax, CX, 47, 28, 9, "격리 확인 성공 ?", fs=7.6)
    D.poly(ax, [(CX, 57), (CX, 51.5)])
    D.arrow(ax, (CX - 14, 47), (22, 47))
    D.note(ax, 20.6, 48.4, "실패", fs=7.0, ha="right", va="bottom", style="n")

    D.box(ax, 2, 30, 20, 12, "S4\n안전 정지", fs=8.2, double=True)
    D.poly(ax, [(12, 68), (12, 42)])
    D.poly(ax, [(22, 47), (17, 47), (17, 42)])

    D.diamond(ax, CX, 32, 38, 11, "③ 선간 역기전력 피크  >  V_dc ?\n"
              "( 무제어 정류 조건, 히스테리시스 적용 )", fs=7.2)
    D.poly(ax, [(CX, 42.5), (CX, 37.5)])
    D.note(ax, CX + 1.2, 40, "성공", fs=7.0, ha="left", style="n")

    D.arrow(ax, (CX + 19, 32), (64, 32))
    D.note(ax, 62.6, 33.4, "참 ( 고속 )", fs=7.0, ha="right", va="bottom", style="n")
    D.box(ax, 64, 25, 32, 14, "ASC   3상 능동 단락\n\n단락 고장 소자가 속한 암과\n"
          "동일한 암의 스위치들을 도통\n( 반대 암 진입 시 관통 발생 )", fs=7.2, double=True)
    D.poly(ax, [(CX, 26.5), (CX, 18), (64, 18)])
    D.note(ax, CX + 1.2, 22, "거짓 ( 저속 )", fs=7.0, ha="left", style="n")
    D.box(ax, 64, 12, 24, 12, "FW\n전 스위치 개방", fs=7.8)

    D.box(ax, 30, 1, 66, 7.5, "④ 격리 확인 완료  AND  RP = 참 인 경우에 한하여\n"
          "개방고장 시퀀스 ( 도 8 ) 의 ④ 이하 적용을 검토", fs=7.2)
    D.poly(ax, [(92, 25), (92, 8.5)])
    D.poly(ax, [(76, 12), (76, 8.5)])

    D.note(ax, 2, 22,
           "※ ASC 진입 과도에서 최대 약 2·I_ch 의 첨두 전류가\n"
           "   발생한다. 특성 전류 I_ch = ψ_m / L_d 가 소자 정격을\n"
           "   초과하는 기계에서는 ASC 를 금지하고 제동 저항 투입\n"
           "   또는 FW + 과전압 억제 수단으로 대체한다.\n\n"
           "※ 격리가 확인되기 전에는 대체 경로 활성화를 절대\n"
           "   금지한다 ( 관통 방지 ).", fs=7.0)
    D.caption(fig, 9, "단락고장 처리 흐름도 (격리 확인 및 암 선택을 포함한 ASC / FW 분기)")
    D.save(fig, "fig09_sc_flow.png")


for f in (fig6, fig7, fig8, fig9):
    f()
