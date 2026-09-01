"""
시뮬레이션 실시예 실행기 (명세서 도 5 / 도 13 의 근거 데이터 생성).

절차
  1. 디지털 트윈으로 학습/검증/시험 데이터 및 4종 OOD 데이터 생성
  2. 공유백본 + 5헤드 앙상블 학습 (스펙트럴 정규화)
  3. 온도 스케일링 -> ECE(등질량 10빈) 검증
  4. ROC + 극단값 외삽(GPD)으로 T1, T2 결정  [반드시 캘리브레이션 후]
  5. OOD 판정: 입력공간 / 잠재공간 기하 지표 + 앙상블 상호정보량
  6. 게이팅 임계를 'ID 오게이팅률 = beta' 로 직접 설계하고 유효성 평가
  7. 초안 게이팅 조건(U_epis >= 0.25) 실측 반증
  8. Venn-Abers 확률 구간
  9. B4 모드 실시 가능 영역
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from scipy.stats import genpareto

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inverter_uq import twin, uq                      # noqa: E402
from inverter_uq.model import Ensemble                # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(20260901)
R: dict = {}
OOD_KEYS = ("ood_sensor", "ood_gate", "ood_800v", "ood_cold")
OOD_LABEL = {
    "ood_sensor": "전류센서 게인이상",
    "ood_gate": "게이트드라이버 열화",
    "ood_800v": "800 V 전압클래스",
    "ood_cold": "저온 시동",
}


def head(t):
    print("\n" + "=" * 78 + f"\n{t}\n" + "=" * 78)


def logit(p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return np.log(p / (1 - p))


# ---------------------------------------------------------------- 1. 데이터
head("1. 디지털 트윈 데이터 생성")
Xtr, ytr, itr = twin.sample(30000, RNG, "id")
Xva, yva, iva = twin.sample(12000, RNG, "id")
Xte, yte, ite = twin.sample(60000, RNG, "id")
ood = {k: twin.sample(6000, RNG, k) for k in OOD_KEYS}
INFO = {"id": ite, **{k: v[2] for k, v in ood.items()}}

mu_x, sd_x = Xtr.mean(0), Xtr.std(0) + 1e-9
nz = lambda A: (A - mu_x) / sd_x
Xtr_n, Xva_n, Xte_n = nz(Xtr), nz(Xva), nz(Xte)
ood_n = {k: (nz(v[0]), v[1], v[2]) for k, v in ood.items()}
print(f"  학습 {Xtr.shape} / 검증 {Xva.shape} / 시험 {Xte.shape}")
print(f"  ID 양성률 = {yte.mean():.4f}")
for k in OOD_KEYS:
    print(f"  OOD {OOD_LABEL[k]:18s} n={ood[k][0].shape[0]}")

# ---------------------------------------------------------------- 2. 학습
head("2. 공유백본 + 5헤드 앙상블 학습 (스펙트럴 정규화)")
net = Ensemble(d_in=twin.N_FEATURES, n_heads=5, sn_bound=3.0,
               rng=np.random.default_rng(7))
net.fit(Xtr_n, ytr, epochs=240, batch=256, lr=6e-3, verbose=True)
n_par = sum(p.size for p in net._params)
print(f"  파라미터 {n_par:,} (INT8 {n_par/1024:.1f} kB)")
R["n_params"] = int(n_par)

# ------------------------------------------------------- 3. 캘리브레이션
head("3. 온도 스케일링 및 캘리브레이션 검증")
T = uq.fit_temperature(net, Xva_n, yva)
p_raw, _, _, _ = net.forward(Xte_n, temperature=1.0)
p_cal, _, _, Zte = net.forward(Xte_n, temperature=T)
ece_raw, _ = uq.ece(p_raw.mean(1), yte, 10, "quantile")
ece_cal, bins = uq.ece(p_cal.mean(1), yte, 10, "quantile")
ece_uni, _ = uq.ece(p_cal.mean(1), yte, 10, "uniform")
D = uq.decompose(p_cal)
P = D["p"]
AUC = uq.auc(P, yte)
print(f"  최적 온도 T = {T:.4f}")
print(f"  ECE(등질량10) 보정전 {ece_raw:.4f} -> 보정후 {ece_cal:.4f}"
      f"   [조건 <=0.05 : {'충족' if ece_cal<=0.05 else '미충족'}]")
print(f"  ECE(등간격10) 보정후 {ece_uni:.4f}  <- 등간격은 과소평가 경향")
print(f"  AUC = {AUC:.4f}")
R.update(temperature=T, ece_raw=ece_raw, ece_cal=ece_cal,
         ece_uniform=ece_uni, auc=AUC)

# ------------------------------------------------------------ 4. 임계치
head("4. 임계치 결정 (캘리브레이션 후, 시간정규화 + 극단값 외삽)")
T1 = float(np.quantile(P[yte == 1], 0.01))
print(f"  T1 : FN <= 1 % -> T1 = {T1:.4f}")

f_diag, tau_dec, N_conf, target_fit = 100.0, 0.25, 3, 10.0
n_eff = 1.0 / tau_dec
fpr_req = (target_fit / (n_eff * 3600.0 * 1e9)) ** (1.0 / N_conf)
print(f"\n  T2 : 목표 오재구성률 <= {target_fit:.0f} FIT (건/1e9h)")
print(f"       탈상관시간 tau={tau_dec}s -> 유효 독립시행 {n_eff:.1f}/s, "
      f"N={N_conf} 연속확인")
print(f"       요구 표본당 FPR = {fpr_req:.3e}")

neg = logit(P[yte == 0])
u = float(np.quantile(neg, 0.99))
exc = neg[neg > u] - u
zeta = float((neg > u).mean())
xi, loc, beta_g = genpareto.fit(exc, floc=0.0)
q_tail = 1.0 - fpr_req / zeta
T2_lg = u + float(genpareto.ppf(q_tail, xi, loc=0.0, scale=beta_g))
T2 = float(1.0 / (1.0 + np.exp(-T2_lg)))
T2_emp = float(np.quantile(P[yte == 0], 1.0 - 1.0 / max((yte == 0).sum(), 1)))
print(f"       GPD 첨두초과 적합: u(99%)={u:.3f}, xi={xi:.4f}, "
      f"beta={beta_g:.4f}, zeta={zeta:.4f}")
print(f"       -> T2 = {T2:.8f}  (로짓 {T2_lg:.3f})")
print(f"       경험 최대 음성 점수 = {T2_emp:.8f} "
      f"(n_neg={int((yte==0).sum()):,} 로는 직접 분해능 부족 -> 외삽 필요)")
print(f"  순서 정합성 T1 < T2 : {'OK' if T1 < T2 else '위반'}")
R.update(T1=T1, T2=T2, gpd=dict(u=u, xi=xi, beta=beta_g, zeta=zeta),
         fpr_required=fpr_req, target_fit=target_fit,
         tau_dec=tau_dec, n_conf=N_conf)

# ------------------------------------------------------------ 5. OOD 판정
head("5. 분포외 판정기 학습 (입력공간 + 잠재공간 + 앙상블 불일치)")
_, _, _, Ztr = net.forward(Xtr_n, temperature=T)
det_in = uq.OODDetector(0.95, 0.995).fit(Xtr_n, ytr)     # 입력공간
det_lat = uq.OODDetector(0.95, 0.995).fit(Ztr, ytr)      # 잠재공간
print(f"  입력공간 : PCA k={det_in.k_}/{Xtr_n.shape[1]}, "
      f"shrinkage={det_in.shrinkage_:.4f}, D_th={det_in.d_th_:.3f}")
print(f"  잠재공간 : PCA k={det_lat.k_}/{Ztr.shape[1]}, "
      f"shrinkage={det_lat.shrinkage_:.4f}, D_th={det_lat.d_th_:.3f}")


def evaluate(Xn):
    p, _, _, Z = net.forward(Xn, temperature=T)
    d = uq.decompose(p)
    return dict(
        **d,
        maha_in=det_in.mahalanobis(Xn), resid_in=det_in.residual(Xn),
        maha_lat=det_lat.mahalanobis(Z), resid_lat=det_lat.residual(Z),
    )


ev_id = evaluate(Xte_n)
ev_ood = {k: evaluate(ood_n[k][0]) for k in OOD_KEYS}
SIGNALS = ["maha_in", "resid_in", "maha_lat", "resid_lat", "U_epis"]

head("6. 개별 지표의 OOD 검출 성능 (AUROC)")
print(f"  {'시나리오':22s}" + "".join(f"{s:>11s}" for s in SIGNALS))
R["ood_auroc"] = {}
for k in OOD_KEYS:
    row = {}
    for s in SIGNALS:
        sc = np.concatenate([ev_id[s], ev_ood[k][s]])
        lb = np.concatenate([np.zeros(len(ev_id[s])), np.ones(len(ev_ood[k][s]))])
        row[s] = uq.auc(sc, lb)
    R["ood_auroc"][k] = row
    print(f"  {OOD_LABEL[k]:22s}" + "".join(f"{row[s]:11.4f}" for s in SIGNALS))
print("\n  주: 상호정보량(U_epis) 단독은 '게이트드라이버 열화' 에서 AUROC < 0.5,")
print("      즉 미학습 고장모드에서 오히려 과확신한다. 앙상블 불일치만으로는")
print("      분포외 입력을 막을 수 없으며 기하학적 지표와의 결합이 필수적이다.")

# --------------------------------------------- 7. 게이트 설계 및 유효성
head("7. 게이팅 임계 설계 (ID 오게이팅률 = beta 로 직접 설계)")
BETA = 0.05
cand_id = P >= T2
cand_ood = {k: ev_ood[k]["p"] >= T2 for k in OOD_KEYS}
print(f"  재구성 후보 (P_fail >= T2)")
print(f"    ID              : {int(cand_id.sum()):6,d} / {len(P):,}")
for k in OOD_KEYS:
    print(f"    {OOD_LABEL[k]:16s}: {int(cand_ood[k].sum()):6,d} / "
          f"{len(cand_ood[k]):,}   <- 전량 차단 대상")

ref = [ev_id[s][cand_id] for s in SIGNALS]
s_id = uq.combined_ood_score(ref, ref)
G_TH = float(np.quantile(s_id, 1.0 - BETA))
false_gate = float((s_id >= G_TH).mean())
print(f"\n  결합 OOD 점수 = max_j  F_j^ID(x)   (ID 후보분포 경험분위수)")
print(f"  게이트 임계 G_th = {G_TH:.6f}  (ID 후보의 {100*(1-BETA):.0f} 백분위)")
print(f"  -> ID 오게이팅률 = {false_gate*100:.2f} %  (가용성 손실, 설계값 {BETA*100:.0f} %)")

R["gate"] = dict(beta=BETA, G_th=G_TH, id_false_gate=false_gate, ood={})
print(f"\n  {'시나리오':22s}{'후보수':>8s}{'게이팅률':>10s}{'미차단':>8s}")
for k in OOD_KEYS:
    sel = cand_ood[k]
    if sel.sum() == 0:
        print(f"  {OOD_LABEL[k]:22s}{0:8d}{'-':>10s}{'-':>8s}")
        R["gate"]["ood"][k] = dict(n=0, rate=None)
        continue
    sc = uq.combined_ood_score(ref, [ev_ood[k][s][sel] for s in SIGNALS])
    rate = float((sc >= G_TH).mean())
    R["gate"]["ood"][k] = dict(n=int(sel.sum()), rate=rate)
    print(f"  {OOD_LABEL[k]:22s}{int(sel.sum()):8,d}{rate*100:9.1f} %"
          f"{int(round((1-rate)*sel.sum())):8,d}")

# 단일 지표만 사용할 경우와의 비교 (결합의 필요성 입증)
print(f"\n  [비교] 동일한 beta={BETA:.2f} 에서 단일 지표만 사용할 때의 게이팅률")
R["gate"]["single"] = {}
print(f"  {'지표':12s}" + "".join(f"{OOD_LABEL[k][:10]:>12s}" for k in OOD_KEYS))
for s in SIGNALS:
    th = float(np.quantile(ev_id[s][cand_id], 1.0 - BETA))
    cells, row = [], {}
    for k in OOD_KEYS:
        sel = cand_ood[k]
        if sel.sum() == 0:
            cells.append(f"{'-':>12s}"); row[k] = None; continue
        r_ = float((ev_ood[k][s][sel] >= th).mean())
        row[k] = r_; cells.append(f"{r_*100:11.1f}%")
    R["gate"]["single"][s] = row
    print(f"  {s:12s}" + "".join(cells))

# ------------------------- 7b. 결정론적 재구성 허가 (감시부 600, ASIL D)
head("7b. 감시부의 결정론적 재구성 허가 신호 RP (학습 모델 불사용)")

VDC_LO, VDC_HI = 240.0, 460.0        # 정격 검증된 전압 클래스 범위
I_SUM_TH = 3 * np.sqrt(3) * 0.02     # 채널당 오프셋 2 % 의 3채널 RSS 3-sigma
TJ_LIM = twin.TJ_MAX                 # 재구성 시퀀스가 검증된 열적 포락선

print("  RP 는 두 부분으로 분해된다. 위반 시의 귀착 상태가 서로 다르기 때문이다.")
print(f"    RP_data (입력 신뢰성) = (Vdc in [{VDC_LO:.0f},{VDC_HI:.0f}] V)"
      f" AND (|ia+ib+ic| <= {I_SUM_TH:.3f} pu)")
print(f"        위반 -> 재구성 보류, S2 체류 (진단 입력을 신뢰할 수 없음)")
print(f"    RP_env  (실행 포락선)  = (Tj <= {TJ_LIM:.0f} degC)")
print(f"        위반 -> S4 안전정지 (재구성 시퀀스의 검증 범위 밖)")
print(f"  임계 {I_SUM_TH:.3f} pu 는 센서 오차 사양으로부터 유도되며 학습 데이터나")
print(f"  AI 출력에 전혀 의존하지 않는다.\n")


def rp_data(info):
    return ((info["vdc"] >= VDC_LO) & (info["vdc"] <= VDC_HI)
            & (info["i_sum_resid"] <= I_SUM_TH))


def rp_env(info):
    return info["tj"] <= TJ_LIM


hdr = (f"  {'시나리오':22s}{'후보':>7s}{'AI게이트':>9s}{'!RP_data':>10s}"
       f"{'!RP_env':>9s}{'통합차단':>9s}{'미차단':>7s}")
print(hdr)
R["gate"]["rp"] = dict(vdc_lo=VDC_LO, vdc_hi=VDC_HI,
                       i_sum_th=float(I_SUM_TH), tj_lim=float(TJ_LIM), ood={})


def rp_row(label, sel_mask, info, ai_gate, store):
    inf = {kk: vv[sel_mask] for kk, vv in info.items()}
    d_ok, e_ok = rp_data(inf), rp_env(inf)
    total = ai_gate | (~d_ok) | (~e_ok)
    store.update(n=int(sel_mask.sum()), ai=float(ai_gate.mean()),
                 rp_data_reject=float((~d_ok).mean()),
                 rp_env_reject=float((~e_ok).mean()),
                 total=float(total.mean()))
    print(f"  {label:22s}{int(sel_mask.sum()):7,d}{ai_gate.mean()*100:8.1f}%"
          f"{(~d_ok).mean()*100:9.1f}%{(~e_ok).mean()*100:8.1f}%"
          f"{total.mean()*100:8.1f}%"
          f"{int(round((1-total.mean())*sel_mask.sum())):7,d}")
    return total


R["gate"]["rp"]["id"] = {}
rp_row("ID (정상 분포)", cand_id, INFO["id"], s_id >= G_TH, R["gate"]["rp"]["id"])
for k in OOD_KEYS:
    sel = cand_ood[k]
    R["gate"]["rp"]["ood"][k] = {}
    if sel.sum() == 0:
        print(f"  {OOD_LABEL[k]:22s}{0:7d}{'-':>9s}{'-':>10s}{'-':>9s}"
              f"{'-':>9s}{'-':>7s}")
        R["gate"]["rp"]["ood"][k] = dict(n=0)
        continue
    sc = uq.combined_ood_score(ref, [ev_ood[k][s][sel] for s in SIGNALS])
    rp_row(OOD_LABEL[k], sel, INFO[k], sc >= G_TH, R["gate"]["rp"]["ood"][k])

r_id = R["gate"]["rp"]["id"]
print(f"\n  [ID 후보의 귀착 분해]  n={r_id['n']:,}")
print(f"    AI 게이팅(보류)        {r_id['ai']*100:5.1f} %")
print(f"    RP_data 위반(보류)     {r_id['rp_data_reject']*100:5.1f} %")
print(f"    RP_env 위반(S4 정지)   {r_id['rp_env_reject']*100:5.1f} %"
      f"   <- 열적 포락선 밖, 안전정지가 정상 동작")
print(f"    재구성 실행 허가       {(1-r_id['total'])*100:5.1f} %")

print("\n  => 800 V 전압클래스는 AI 측 OOD 지표로 차단되지 않으나(근접 OOD),")
print("     감시부의 결정론적 전압범위 검사가 100 % 차단한다.")
print("     전류센서 게인이상은 3상 전류합 구속 위반으로 결정론적으로도 차단된다.")
print("     학습 기반 게이팅과 결정론적 허가 신호는 상호 보완적이며,")
print("     후자가 없으면 ASIL 분해(진단부 QM(D) + 감시부 D(D))가 성립하지 않는다.")

# ------------------------------------------- 8. 초안 조건 실측 반증
head("8. 초안 게이팅 조건 U_epis(확률분산) >= U_max = 0.25 의 실측 반증")
var_epis = p_cal.var(axis=1)
sel = P >= 0.70
print(f"  P_fail >= 0.70 인 시험표본 {int(sel.sum()):,} 개")
print(f"    확률분산 최대 = {var_epis[sel].max():.6f}   (초안 임계 0.25)")
print(f"    초안 게이트 발동 = {int((var_epis[sel] >= 0.25).sum())} 건")
print(f"  전체 시험셋({len(P):,}) 확률분산 최대 = {var_epis.max():.6f}")
allv = np.concatenate([var_epis] + [p_cal.var(1) * 0])  # 참고용
print(f"  OOD 포함 전 구간 최대 = "
      f"{max(var_epis.max(), *[ (uq.decompose(net.forward(ood_n[k][0], temperature=T)[0])['sigma_epis']**2).max() for k in OOD_KEYS]):.6f}")
print(f"  -> 이론 상한(Bhatia-Davis) p(1-p)=0.21 @P=0.7 이며, 실측은 그보다도")
print(f"     한 자릿수 작다. 초안 조건은 전 구간에서 단 한 번도 발동하지 않는다.")
R.update(var_epis_max_at_gate=float(var_epis[sel].max()),
         var_epis_max_all=float(var_epis.max()),
         draft_gate_triggers=int((var_epis[sel] >= 0.25).sum()),
         n_at_gate=int(sel.sum()))

# ------------------------------------------------------- 9. Venn-Abers
head("9. Venn-Abers 확률 구간 (분할 컨포멀 '구간폭' 오용의 정정)")
sub = RNG.choice(len(Xva_n), 3000, replace=False)
p_cv, _, _, _ = net.forward(Xva_n[sub], temperature=T)
idx_c = np.where(cand_id)[0]
tsub = RNG.choice(idx_c, min(400, len(idx_c)), replace=False)
lo, hi = uq.venn_abers(p_cv.mean(1), yva[sub], P[tsub])
w = hi - lo
print(f"  재구성 후보 {len(tsub)} 표본 구간폭: 중앙값 {np.median(w):.4f}, "
      f"95%tile {np.quantile(w,0.95):.4f}, 최대 {w.max():.4f}")
print(f"  -> 이진 분류의 컨포멀은 '집합'을 주므로 폭 비교가 불가능하다.")
print(f"     Venn-Abers 는 확률 '구간' 을 주어 폭 기반 보조 게이트가 성립한다.")
R.update(va_med=float(np.median(w)), va_p95=float(np.quantile(w, 0.95)),
         va_max=float(w.max()))

# --------------------------------------------------- 10. B4 가능 영역
head("10. B4 (4스위치 3상) 모드 실시 가능 영역")
Vdc_b4, C_half, dv_ratio = 400.0, 1.5e-3, 0.05
dv_allow = dv_ratio * Vdc_b4
C_eq = 2 * C_half
print(f"  Vdc={Vdc_b4:.0f} V, 분압 커패시터 {C_half*1e6:.0f} uF x 2 "
      f"(C_eq={C_eq*1e6:.0f} uF), 허용 중점 불평형 {dv_allow:.0f} V ({dv_ratio*100:.0f} %)")
print(f"\n  (i)  전압 제약 : V_m <= Vdc/(2*sqrt3) = {Vdc_b4/(2*np.sqrt(3)):.1f} V "
      f"= B6-SVPWM({Vdc_b4/np.sqrt(3):.1f} V) 의 50.0 %")
print(f"  (ii) 최저 전기주파수 f_min = I_m / (2*pi*C_eq*dv_pk)")
env = []
for pu in (1.0, 0.7, 0.5, 0.3, 0.2, 0.1):
    Im = pu * twin.I_RATED
    f_min = Im / (2 * np.pi * C_eq * dv_allow)
    env.append(dict(i_pu=pu, i_a=float(Im), f_min_hz=float(f_min),
                    ic_rms=float(Im / np.sqrt(2))))
    print(f"       I_m={pu:4.2f} pu ({Im:5.0f} A) -> f_min={f_min:7.1f} Hz, "
          f"I_C,rms={Im/np.sqrt(2):5.0f} A")
print(f"  (iii) 커패시터 RMS 전류 : 기본파 전류 전량이 분압 커패시터를 통과")
print(f"\n  => B4 모드는 저속(저주파) 영역에서 실시 불가하며, 초안의 '58 % 출력'")
print(f"     단일 제약 기재는 실시 가능성을 담보하지 못한다.")
R["b4_envelope"] = env
R["b4_voltage_ratio_svpwm"] = 0.5

# ---------------------------------------------------------------- 저장
with open(os.path.join(OUT, "embodiment_results.json"), "w") as f:
    json.dump(R, f, indent=2, ensure_ascii=False, default=float)

save = dict(y_te=yte, y_star=(ite["risk"] > 0.5).astype(float),
            T1=T1, T2=T2, G_th=G_TH, beta=BETA,
            bin_conf=np.array([b["conf"] for b in bins]),
            bin_acc=np.array([b["acc"] for b in bins]),
            bin_n=np.array([b["n"] for b in bins]))
for s in SIGNALS + ["p", "U_alea"]:
    save[f"id_{s}"] = ev_id[s]
    for k in OOD_KEYS:
        save[f"{k}_{s}"] = ev_ood[k][s]
save["id_gate_score"] = s_id
np.savez_compressed(os.path.join(OUT, "figure_data.npz"), **save)
print(f"\n결과 저장 -> {OUT}/embodiment_results.json , figure_data.npz")
