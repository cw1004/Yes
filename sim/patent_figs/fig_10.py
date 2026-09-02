"""도 10 대체 경로 토폴로지."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draw as D

fig, ax = D.canvas(10.4, 9.4)

# ═══════════════════════════════ (a) 리던던트 레그 방식
DCP, DCN, YU, YM, YL = 97.0, 68.0, 88.5, 81.5, 74.5
LEGS = [(20, "a"), (30, "b"), (40, "c")]
XR = 52.0
PHY = {"a": 56.0, "b": 59.0, "c": 62.0}
DROP = {"a": 25.0, "b": 35.0, "c": 45.0}
TSW = {"a": 64.0, "b": 70.0, "c": 76.0}

D.note(ax, 2, 100, "( a )  리던던트 레그 방식", fs=9.4, style="n", va="top")
D.wire(ax, [(8, DCP), (58, DCP)]); D.wire(ax, [(8, DCN), (58, DCN)])
D.note(ax, 59.4, DCP, "DC +", fs=7.4, ha="left", style="n")
D.note(ax, 59.4, DCN, "DC −", fs=7.4, ha="left", style="n")
D.wire(ax, [(10, DCP), (10, 86)]); D.cap(ax, 10, 84.2, s=1.1)
D.wire(ax, [(10, 82.4), (10, DCN)])
D.note(ax, 5.6, 84.2, "C_dc", fs=7.0, ha="right", style="n")

for x, k in LEGS:
    D.wire(ax, [(x, DCP), (x, 95.7)]); D.fuse(ax, x, 94.0, s=1.0)
    D.wire(ax, [(x, 92.3), (x, YU + 1.85)])
    D.igbt(ax, x, YU, s=1.15); D.wire(ax, [(x, YU - 1.85), (x, YL + 1.85)])
    D.igbt(ax, x, YL, s=1.15); D.wire(ax, [(x, YL - 1.85), (x, DCN)])
    D.dot(ax, x, YM)
    D.note(ax, x - 2.6, 94.0, "F", fs=7.0, ha="right", style="n")
    D.note(ax, x, 99.4, k.upper(), fs=8.2, ha="center", va="top", style="n")
    xd, yp = DROP[k], PHY[k]
    D.wire(ax, [(x, YM), (xd, YM), (xd, yp)]); D.hop(ax, xd, DCN, 1.15, horiz=False)
    D.wire(ax, [(xd, yp), (83, yp)])

D.wire(ax, [(XR, DCP), (XR, YU + 1.85)])
D.igbt(ax, XR, YU, s=1.15); D.wire(ax, [(XR, YU - 1.85), (XR, YL + 1.85)])
D.igbt(ax, XR, YL, s=1.15); D.wire(ax, [(XR, YL - 1.85), (XR, DCN)])
D.dot(ax, XR, YM)
D.note(ax, XR, 99.4, "R  ( 예비 )", fs=8.2, ha="center", va="top", style="n")

D.wire(ax, [(XR, YM), (60, YM), (60, 50), (76, 50)])
D.hop(ax, 60, DCN, 1.15, horiz=False)
for k in ("a", "b", "c"):
    xb, yp = TSW[k], PHY[k]
    D.wire(ax, [(xb, 50), (xb, 51.2)])
    D.switch_bi(ax, xb, 53.0, s=0.85, horiz=False)
    D.wire(ax, [(xb, 54.8), (xb, yp)]); D.dot(ax, xb, yp)
    for yy in sorted(v for v in PHY.values() if v < yp):
        D.hop(ax, xb, yy, 1.0, horiz=False)
    D.note(ax, xb + 2.2, 53.0, "T_" + k, fs=7.0, ha="left", style="n")

D.motor(ax, 90, 59, r=7.0, text="M\n3~")
for k in PHY:
    D.dot(ax, 83, PHY[k], 0.5)
D.wire(ax, [(83, 56), (83, 62)])
D.note(ax, 83, 64.4, "a  b  c", fs=6.8, ha="center", style="n")

D.note(ax, 2, 62, "F : 레그 직렬형 차단 소자\n( SSCB 또는 고속 퓨즈 )\n"
       "고장 레그만 분리 가능", fs=7.2)
D.note(ax, 2, 50, "T_a , T_b , T_c : 양방향 차단 절체 소자\n"
       "( 역직렬 반도체 스위치 또는 기계식 컨택터 )\n"
       "사이리스터형은 자기소호 불가하므로\n투입 전용으로만 사용하며 전류 영교차에 동기 점호", fs=7.2)

# ═══════════════════════════════ (b) B4 방식
P, N, M2, U2, L2 = 40.0, 12.0, 26.0, 34.0, 19.0
PH2 = {"a": 6.0, "b": 9.0, "c": 2.0}
D.note(ax, 2, 44.5, "( b )  4스위치 3상 ( B4 ) 방식", fs=9.4, style="n", va="top")
D.wire(ax, [(8, P), (54, P)]); D.wire(ax, [(8, N), (52, N)])
D.note(ax, 55.4, P, "DC +", fs=7.4, ha="left", style="n")
D.note(ax, 53.4, N, "DC −", fs=7.4, ha="left", style="n")

D.wire(ax, [(10, P), (10, 30)]); D.cap(ax, 10, 28.4, s=1.0)
D.wire(ax, [(10, 26.8), (10, 24.2)]); D.cap(ax, 10, 22.6, s=1.0)
D.wire(ax, [(10, 21.0), (10, N)]); D.dot(ax, 10, M2)
D.note(ax, 5.6, 28.4, "C_1", fs=7.0, ha="right", style="n")
D.note(ax, 5.6, 22.6, "C_2", fs=7.0, ha="right", style="n")
D.note(ax, 11.6, M2 + 2.0, "O ( 중점 )", fs=7.2, ha="left", style="n")

for x, k, dead in ((24, "a", False), (35, "b", False), (46, "c", True)):
    if dead:
        D.wire(ax, [(x, P), (x, 38.6)]); D.sw_open(ax, x, 37.0, s=0.85, horiz=False)
        D.note(ax, x + 3.6, 37.0, "개방", fs=6.8, ha="left", style="n")
        D.wire(ax, [(x, 35.4), (x, U2 + 1.76)])
    else:
        D.wire(ax, [(x, P), (x, U2 + 1.76)])
    D.igbt(ax, x, U2, s=1.1); D.wire(ax, [(x, U2 - 1.76), (x, L2 + 1.76)])
    D.igbt(ax, x, L2, s=1.1); D.wire(ax, [(x, L2 - 1.76), (x, N)])
    D.note(ax, x, 43.4, k.upper() + ("  ( 고장 )" if dead else ""), fs=7.8,
           ha="center", va="top", style="n")
    if dead:
        D.xmark(ax, x, M2, s=1.5)
        D.note(ax, x + 2.4, M2, "격리", fs=6.8, ha="left", style="n")
    else:
        D.dot(ax, x, M2)

for x, k, xd in ((24, "a", 30.0), (35, "b", 41.0)):
    D.wire(ax, [(x, M2), (xd, M2), (xd, PH2[k])]); D.hop(ax, xd, N, 1.1, horiz=False)
    D.wire(ax, [(xd, PH2[k]), (71.5, PH2[k])])
D.wire(ax, [(10, M2), (15, M2), (15, PH2["c"])]); D.hop(ax, 15, N, 1.1, horiz=False)
D.wire(ax, [(15, PH2["c"]), (22, PH2["c"])])
D.switch_bi(ax, 25, PH2["c"], s=1.0)
D.wire(ax, [(28, PH2["c"]), (71.5, PH2["c"])])
D.note(ax, 25, PH2["c"] + 1.9, "중점 접속 소자", fs=7.0, ha="center",
       va="bottom", style="n")

D.motor(ax, 78, 6, r=5.6, text="M\n3~")
for k in PH2:
    D.dot(ax, 71.5, PH2[k], 0.5)
D.wire(ax, [(71.5, 2), (71.5, 9)])
D.note(ax, 71.5, 11.2, "a  b  c", fs=6.8, ha="center", style="n")

D.note(ax, 58, 36, "B4 모드 실시 조건 ( 도 11 )\n"
       "· 전압 : V_m ≤ V_dc / ( 2√3 ) = B6-SVPWM 대비 50 %\n"
       "· 최저 전기주파수 : f_e ≥ I_m / ( 2π · C_eq · Δv )\n"
       "· 커패시터 실효 전류 : I_C,rms = I_m / √2\n"
       "  ( 기본파 전류 전량이 분압 커패시터를 통과 )", fs=7.2)
D.note(ax, 58, 22, "· 중점 접속 소자는 양방향 차단 소자로 하며, 사이리스터형을\n"
       "  쓰는 경우 투입 전용으로 한정하고 해당 상 전류의 영교차에\n"
       "  동기하여 점호한다.\n\n"
       "· 반원 기호는 배선의 교차이며 접속이 아니다.", fs=7.2)

D.caption(fig, 10, "3상 인버터 대체 경로 토폴로지")
D.save(fig, "fig10_topology.png")
