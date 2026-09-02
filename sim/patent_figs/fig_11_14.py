"""도 11 ~ 도 14."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import matplotlib.pyplot as plt
import draw as D

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results")
R = json.load(open(os.path.join(RES, "embodiment_results.json")))


# ══════════════════════════════════════════════ 도 11 B4 실시 가능 영역
def fig11():
    I_RATED, C_EQ, DV, VDC = 400.0, 3.0e-3, 20.0, 400.0
    IC_RATED = 150.0
    f = np.logspace(1, 3.4, 600)
    i_cap = 2 * np.pi * f * C_EQ * DV / I_RATED          # 중점 전압 제약
    i_rms = np.full_like(f, IC_RATED * np.sqrt(2) / I_RATED)   # 커패시터 전류 제약

    fig = plt.figure(figsize=(9.4, 5.6))
    ax = fig.add_axes([0.115, 0.135, 0.58, 0.775])
    ax.set_xscale("log")
    ax.set_xlim(10, 2500); ax.set_ylim(0, 1.15)

    env = np.minimum(i_cap, i_rms)
    ax.fill_between(f, 0, np.clip(env, 0, 1.15), facecolor="none", hatch="....",
                    edgecolor="0.55", lw=0.0, zorder=1)
    ax.plot(f, np.clip(i_cap, 0, 1.2), color="black", lw=1.5, zorder=3)
    ax.plot(f, i_rms, color="black", lw=1.5, ls=(0, (6, 3)), zorder=3)

    for e in R["b4_envelope"]:
        ax.plot(e["f_min_hz"], e["i_pu"], "o", ms=5.5, mfc="white", mec="black",
                mew=1.2, zorder=5)
        ax.annotate(f"{e['i_pu']:.2f} pu\n{e['f_min_hz']:.0f} Hz",
                    (e["f_min_hz"], e["i_pu"]), textcoords="offset points",
                    xytext=(6, -14), fontsize=6.6, zorder=6)

    ax.text(800, 0.20, "실시 가능 영역", fontsize=10.5, ha="center", zorder=6)
    ax.text(220, 0.88, "중점 전압 제약\n$I_m$ ≤ 2π·f·C_eq·Δv / I_rated", fontsize=7.4,
        ha="center", va="center", zorder=6)
    ax.text(12, 0.555, "커패시터 실효 전류 제약   $I_m$ ≤ √2 · I_C,rated = 0.53 pu",
        fontsize=7.4, ha="left", va="bottom", zorder=6)
    ax.set_xlabel("전기 주파수  f_e  [ Hz ]  ( 대수 눈금 )", fontsize=8.6)
    ax.set_ylabel("전류 지령  I_m  [ pu ]", fontsize=8.6)
    ax.tick_params(labelsize=7.6)
    ax.grid(True, which="both", lw=0.4, color="0.85", zorder=0)

    fig.text(0.715, 0.86, "산출 조건", fontsize=8.6, fontweight="bold", va="top")
    fig.text(0.715, 0.805,
             f"V_dc = {VDC:.0f} V\nC_1 = C_2 = 1500 μF  ( C_eq = 3000 μF )\n"
             f"허용 중점 불평형  Δv = {DV:.0f} V  ( 5 % )\n"
             f"정격 전류 I_rated = {I_RATED:.0f} A\n"
             f"커패시터 정격 실효전류 I_C,rated = {IC_RATED:.0f} A",
             fontsize=7.4, va="top", linespacing=1.7)
    fig.text(0.715, 0.535, "전압 제약 ( 별도 축 )", fontsize=8.6, fontweight="bold",
             va="top")
    fig.text(0.715, 0.485,
             "V_m ≤ V_dc / ( 2√3 ) = 115.5 V\n"
             "B6-SVPWM ( V_dc/√3 = 230.9 V ) 대비 50.0 %\n"
             "B6-SPWM  ( V_dc/2  = 200.0 V ) 대비 57.7 %\n\n"
             "※ √3/3 = 0.577 은 B6-SVPWM 의 변조 이득이며\n"
             "   B4 강압비가 아니다. 양산 인버터는 SVPWM 을\n"
             "   사용하므로 출력 상한은 정격의 50 % 로 한다.",
             fontsize=7.4, va="top", linespacing=1.7)
    fig.text(0.715, 0.155, "정책부는 위 세 제약을 모두 만족하는\n"
             "영역 내에서만 B4 운전을 허가하고,\n"
             "그 밖의 영역에서는 S4 로 귀착시킨다.", fontsize=7.4, va="top",
             linespacing=1.7)
    D.caption(fig, 11, "B4 모드 실시 가능 영역 (전압 · 최저 주파수 · 커패시터 전류의 3중 제약)")
    D.save(fig, "fig11_b4_envelope.png")


# ══════════════════════════════════════════════ 도 12 계층적 시간 예산
def fig12():
    fig, ax = D.canvas(10.0, 6.0)
    X0, X1, YT, HT = 8.0, 88.0, 79.0, 9.0
    segs = [("L2-a", "센싱 + 전처리", 0, 2), ("L2-b", "AI 추론", 2, 7),
            ("L2-c", "정책 결정 +\n게이트 명령", 7, 10)]
    sc = (X1 - X0) / 10.0
    for tag, name, a, b in segs:
        x, w = X0 + a * sc, (b - a) * sc
        D.box(ax, x, YT, w, HT, f"{tag}\n{name}", fs=7.8)
        D.note(ax, x + w / 2, YT - 1.6, f"{b - a:g} ms", fs=7.4, ha="center",
               va="top", style="n")
        D.note(ax, x, YT + HT + 1.2, f"{a:g}", fs=7.0, ha="center", va="bottom",
               style="n")
    D.note(ax, X1, YT + HT + 1.2, "10 ms", fs=7.0, ha="center", va="bottom",
           style="n")
    D.wire(ax, [(X0, YT + HT + 5.5), (X1, YT + HT + 5.5)])
    for xx in (X0, X1):
        D.wire(ax, [(xx, YT + HT + 4.2), (xx, YT + HT + 6.8)])
    D.note(ax, (X0 + X1) / 2, YT + HT + 6.4, "진단 주기  T_diag = 10 ms   "
           "( 지연 상한 10 ms, 허용 지터 ≤ 1 ms )", fs=7.6, ha="center",
           va="bottom", style="n")

    outs = [("L2-a", "진단 스킵\n직전 상태 유지"), ("L2-b", "P_fail 산출 실패\n자동 디레이팅"),
            ("L2-c", "즉시 S2 전이")]
    for i, (tag, txt) in enumerate(outs):
        a, b = segs[i][2], segs[i][3]
        cx = X0 + (a + b) / 2 * sc
        D.box(ax, cx - 12, 55, 24, 11, f"{tag} 예산 초과\n\n{txt}", fs=7.4)
        D.arrow(ax, (cx, YT - 5.5), (cx, 66))
    D.box(ax, 8, 38, 80, 10, "어느 구간이든 시간 예산을 초과한 경우\n"
          "해당 주기에 생성된 재구성 명령을 무효로 처리하고 직전의 보수적 상태를 유지한다",
          fs=8.2, double=True)
    for i in range(3):
        a, b = segs[i][2], segs[i][3]
        cx = X0 + (a + b) / 2 * sc
        D.arrow(ax, (cx, 55), (cx, 48))

    D.box(ax, 8, 20, 38, 12, "L0  게이트 드라이버   10 μs\nL1  하드웨어 비교기   200 μs\n"
          "→ 본 발명의 범위 밖 ( 전제 )", fs=7.6, dashed=True)
    D.box(ax, 50, 20, 38, 12, "L3  냉각 협조   1 s\n초과 시 경고만 발생\n"
          "( 비가역 조치와 무관 )", fs=7.6, dashed=True)
    D.note(ax, 8, 13.5, "※ 시한을 초과한 상태에서 비가역 조치를 실행해서는 안 된다. "
           "이 무효화 규칙은 진단부(200)의 등급과 무관하게\n"
           "   재구성 제어부(400)의 출력단에서 하드웨어적으로 강제된다.", fs=7.2)
    D.caption(fig, 12, "계층적 시간 예산 분해 및 비가역 조치 무효화 로직")
    D.save(fig, "fig12_time_budget.png")


# ══════════════════════════════════════════════ 도 13 ASIL 분해 구조
def fig13():
    fig, ax = D.canvas(10.2, 7.0)
    BX = 50.0
    ax.plot([BX, BX], [4, 92], color="black", lw=1.2, ls=(0, (6, 4)), zorder=2)
    D.note(ax, BX, 93.5, "독립성 경계  ( freedom from interference )", fs=8.0,
           ha="center", va="bottom", style="n")

    D.note(ax, 3, 90, "Doer 경로", fs=9.0, style="n", va="top")
    D.note(ax, 97, 90, "Checker 경로", fs=9.0, ha="right", style="n", va="top")
    D.box(ax, 3, 74, 42, 12, "진단부 (200)\n학습 기반 모델 · 비락스텝 성능 코어\n"
          "P_fail , U_epis , OOD 산출", ref=None, fs=7.8)
    D.note(ax, 5, 72.4, "QM (D)", fs=9.2, va="top", style="n")
    D.box(ax, 3, 56, 42, 12, "복원 정책부 (300)\n결정론적 규칙 · 락스텝 코어쌍\n"
          "상태 전이 및 지령 생성", fs=7.8)
    D.arrow(ax, (24, 74), (24, 68))

    D.box(ax, 55, 74, 42, 12, "안전 감시부 (600)\n독립 전원 · 클럭 · 기준전압\n"
          "독립 센싱 채널 · 별도 락스텝 코어쌍", fs=7.8)
    D.note(ax, 95, 72.4, "ASIL D (D)", fs=9.2, ha="right", va="top", style="n")
    D.box(ax, 55, 56, 20, 12, "구동측·회생측\n안전 상한\n결정론적 산출", fs=7.4, ref=620)
    D.box(ax, 77, 56, 20, 12, "재구성 허가\n신호 RP\n결정론적 산출", fs=7.4, ref=630)
    D.arrow(ax, (65, 74), (65, 68))
    D.arrow(ax, (87, 74), (87, 68))

    D.box(ax, 12, 34, 24, 9, "클램프\nclamp( · )", fs=8.0)
    D.poly(ax, [(18, 56), (18, 43)])
    D.note(ax, 16.6, 49, "토크 지령", fs=7.0, ha="right", style="n")
    D.poly(ax, [(65, 56), (65, 47), (30, 47), (30, 43)])
    D.note(ax, 24, 44.6, "T_lim,drive , T_lim,regen", fs=7.0, ha="center",
           va="bottom", style="n")
    g = D.and_gate(ax, 76, 34.5, s=10)
    D.poly(ax, [(38, 56), (38, 37.6), (70.8, 37.6)])
    D.note(ax, 60, 39.2, "재구성 요구", fs=7.0, ha="center", va="bottom",
           style="n")
    D.poly(ax, [(87, 56), (87, 27), (66, 27), (66, 31.4), (70.8, 31.4)])
    D.note(ax, 82, 28.4, "RP", fs=7.4, ha="center", va="bottom", style="n")

    D.box(ax, 12, 16, 24, 9, "최종 출력 지령", fs=8.0, double=True)
    D.arrow(ax, (24, 34), (24, 25))
    D.box(ax, 50, 16.5, 26, 9, "재구성 게이트 명령", fs=8.0, double=True)
    D.poly(ax, [(81.2, 34.5), (89, 34.5), (89, 21), (76, 21)])

    D.note(ax, 3, 13, "ASIL D  =  QM (D)  +  D (D)      "
           "( ISO 26262-9 에 정의된 유효 분해 조합 )\n"
           "· 학습 기반 진단부가 단독으로 비가역 조치를 트리거할 수 없으므로 QM (D) 할당이 성립한다.\n"
           "· 출력 포락선 제한만으로는 회로 재구성이 억제되지 않으므로 재구성 허가 RP 가 필수적이다.\n"
           "· 충분한 독립성 확보를 위해 종속고장분석 ( DFA, ISO 26262-9 Clause 5 ) 을 수행한다.",
           fs=7.2, va="top")
    D.caption(fig, 13, "ASIL 분해 및 이중 통제 구조 (출력 포락선 클램프와 재구성 허가의 논리곱)")
    D.save(fig, "fig13_asil.png")


# ══════════════════════════════════════════════ 도 14 디지털 트윈 파이프라인
def fig14():
    fig, ax = D.canvas(10.2, 6.6)
    rows = [
        [(3, "전기-열 연성 모델\n스위칭 함수 평균값 모델\nFoster / Cauer 열회로망"),
         (27, "고장 시나리오 합성\n단일 스위치 개방 / 상 개방\n단락 · 열화 · 드라이버 이상"),
         (51, "도메인 랜덤화\n400 V · 800 V 클래스\n온도 · 부하 · 소자 산포\n센서 오프셋·게인·위상"),
         (75, "합성 데이터셋\n라벨링\n( 정상 / 초기 열화 /\n고장 임박 / 고장 )")],
    ]
    for x, t in rows[0]:
        D.box(ax, x, 74, 21, 20, t, fs=7.2)
    for x in (24, 48, 72):
        D.arrow(ax, (x, 84), (x + 3, 84))

    D.box(ax, 3, 52, 21, 15, "모델 학습\n공유 백본 + 5 헤드\n부트스트랩", fs=7.4)
    D.box(ax, 27, 52, 21, 15, "INT8 양자화\n\n배포 대상 모델 확정", fs=7.4)
    D.box(ax, 51, 52, 21, 15, "통계량 재산출\nμ_c , Σ , 주성분 기저\n각 OOD 임계값",
          fs=7.4, double=True)
    D.box(ax, 75, 52, 21, 15, "sim-to-real 정렬 검증\n실차 정상 주행 데이터와의\n"
          "MMD / Wasserstein 거리", fs=7.4, double=True)
    D.poly(ax, [(85.5, 74), (85.5, 70.5), (13.5, 70.5), (13.5, 67)])
    for x in (24, 48, 72):
        D.arrow(ax, (x, 59.5), (x + 3, 59.5))

    D.box(ax, 3, 30, 21, 15, "캘리브레이션\n온도 스케일링\nECE ( 등질량 10빈 ) 검증", fs=7.4)
    D.box(ax, 27, 30, 21, 15, "임계치 결정\nT1 : FN ≤ 1 %\nT2 : FIT 목표 + GPD 외삽\n"
          "U_max : 이중 제약", fs=7.4)
    D.box(ax, 51, 30, 21, 15, "회귀 검증 및\n안전 케이스 갱신\nSOTIF 트리거링 조건 반영",
          fs=7.4)
    D.box(ax, 75, 30, 21, 15, "OTA 배포\n\n완화 방향 변경은\n이 경로로만 수행", fs=7.4,
          double=True)
    D.poly(ax, [(85.5, 52), (85.5, 48.5), (13.5, 48.5), (13.5, 45)])
    for x in (24, 48, 72):
        D.arrow(ax, (x, 37.5), (x + 3, 37.5))

    D.box(ax, 27, 8, 45, 12, "필드 데이터 수집\n분포외 판정 이력 · 재구성 허가 거부 사유 ·\n"
          "시간 예산 초과 이력", fs=7.6, dashed=True)
    D.poly(ax, [(85.5, 30), (85.5, 14), (72, 14)], dashed=True)
    D.poly(ax, [(27, 14), (13.5, 14), (13.5, 30)], dashed=True)
    D.note(ax, 49.5, 21.4, "오프라인 재학습 경로", fs=7.2, ha="center", va="bottom")
    D.note(ax, 3, 5, "※ 온라인 자가보정은 사전 검증된 유한 집합 내에서 안전 여유가 증가하는 "
           "방향으로만 허용되며,\n   보정량은 주행 사이클 단위로 복귀되는 일시 성분과 "
           "유지되는 영구 성분으로 분리된다.", fs=7.2)
    D.caption(fig, 14, "디지털 트윈 데이터 생성 및 sim-to-real 검증 파이프라인")
    D.save(fig, "fig14_digital_twin.png")


for f in (fig11, fig12, fig13, fig14):
    f()
