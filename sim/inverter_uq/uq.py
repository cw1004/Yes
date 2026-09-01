"""
불확실도 분해 / 캘리브레이션 / 분포외(OOD) 판정 / Venn-Abers 구간.

초안 명세서의 다음 결함을 정정한 구현이다.
  (1) U = sqrt(U_alea + U_epis) 의 차원 불일치
      -> 엔트로피 분해 (Total = Aleatoric + Epistemic, 단위 nat) 로 대체.
  (2) OOD_2 = (예측 엔트로피 > H_th) 의 정보량 0 문제
      -> 이진 출력에서 H(p_bar) 는 p_bar 의 결정론적 단조함수이므로 P_fail 외의
         정보가 없다. 특징공간 지표(마할라노비스 + PCA 잔차)와
         앙상블 불일치(상호정보량)로 대체.
  (3) 분할 컨포멀 예측의 "구간 폭" 오용
      -> 이진 분류에서 컨포멀은 예측 '집합'을 주지 '구간'을 주지 않는다.
         확률 구간이 필요하면 Venn-Abers 예측자(IVAP)를 사용한다.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize_scalar

EPS = 1e-12


# ============================================================ 불확실도 분해
def _H(p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return -(p * np.log(p) + (1 - p) * np.log(1 - p))


def decompose(p_heads: np.ndarray) -> dict:
    """
    p_heads: (n, M) 헤드별 예측 확률.

    엔트로피 분해 (Depeweg et al.):
        H[E_m p_m]           = 전체 불확실도            (Total)
        E_m H[p_m]           = 우연적 불확실도          (Aleatoric)
        I = Total - Aleatoric= 인식적 불확실도 (상호정보량, Epistemic)
    Jensen 부등식에 의해 I >= 0 이 보장되며 단위는 모두 nat 으로 가법적이다.
    """
    p_bar = p_heads.mean(axis=1)
    total = _H(p_bar)
    alea = _H(p_heads).mean(axis=1)
    epis = np.maximum(total - alea, 0.0)
    sigma_epis = p_heads.std(axis=1)          # 보조 지표 (확률 공간 표준편차)
    return dict(p=p_bar, U_total=total, U_alea=alea, U_epis=epis,
                sigma_epis=sigma_epis)


# ============================================================ 캘리브레이션
def fit_temperature(model, X, y) -> float:
    """검증셋 NLL 을 최소화하는 스칼라 온도 T 를 탐색한다."""
    def nll(logT):
        T = float(np.exp(logT))
        p, _, _, _ = model.forward(X, temperature=T)
        pb = np.clip(p.mean(axis=1), 1e-9, 1 - 1e-9)
        return float(-np.mean(y * np.log(pb) + (1 - y) * np.log(1 - pb)))

    res = minimize_scalar(nll, bounds=(np.log(0.25), np.log(6.0)),
                          method="bounded", options=dict(xatol=1e-4))
    return float(np.exp(res.x))


def ece(p, y, n_bins=10, strategy="quantile"):
    """
    Expected Calibration Error.

    등간격(uniform) 빈은 고확신 구간에 표본이 편중되어 ECE 를 과소평가한다.
    기본값으로 등질량(quantile) 빈을 사용한다.
    """
    p = np.asarray(p); y = np.asarray(y)
    if strategy == "quantile":
        edges = np.quantile(p, np.linspace(0, 1, n_bins + 1))
        edges[0], edges[-1] = 0.0, 1.0
        edges = np.unique(edges)
    else:
        edges = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, len(edges) - 2)
    tot, bins = 0.0, []
    for b in range(len(edges) - 1):
        sel = idx == b
        if not sel.any():
            continue
        conf, acc, w = p[sel].mean(), y[sel].mean(), sel.mean()
        tot += w * abs(acc - conf)
        bins.append(dict(lo=edges[b], hi=edges[b + 1], n=int(sel.sum()),
                         conf=float(conf), acc=float(acc)))
    return float(tot), bins


# ============================================================ OOD 지표
class OODDetector:
    """
    학습 특징공간 z 에 대한 3중 분포외 판정.

      (i)  클래스 조건부 마할라노비스 거리 (Ledoit-Wolf 축소 공분산)
      (ii) PCA 재구성 잔차 노름  <- P_fail 과 독립인 기하학적 지표
      (iii) 앙상블 상호정보량 (호출측에서 결합)

    주: 양자화(INT8) 배포 시 특징 분포가 변하므로 mu/Sigma/임계값은
        반드시 배포 대상 양자화 모델로 재산출해야 한다.
    """

    def __init__(self, var_keep=0.95, q=0.995):
        self.var_keep = var_keep
        self.q = q

    @staticmethod
    def _shrunk_cov(Z):
        """Ledoit-Wolf 축소 추정 (고차원/소표본에서 Sigma 특이화 방지)."""
        n, d = Z.shape
        Zc = Z - Z.mean(axis=0, keepdims=True)
        S = (Zc.T @ Zc) / max(n - 1, 1)
        mu_t = np.trace(S) / d
        target = mu_t * np.eye(d)
        num = np.mean([np.sum((np.outer(z, z) - S) ** 2) for z in Zc[:400]])
        den = np.sum((S - target) ** 2) + 1e-18
        lam = float(np.clip(num / (n * den), 0.0, 1.0))
        return (1 - lam) * S + lam * target, lam

    def fit(self, Z, y):
        self.mu_ = {}
        cov_pool = []
        for c in (0.0, 1.0):
            sel = y == c
            self.mu_[c] = Z[sel].mean(axis=0)
            cov_pool.append(Z[sel] - self.mu_[c])
        Zc = np.vstack(cov_pool)
        S, self.shrinkage_ = self._shrunk_cov(Zc + Zc.mean(axis=0))
        self.prec_ = np.linalg.pinv(S)

        # PCA (특징 부분공간) 잔차
        Zm = Z.mean(axis=0)
        self.pca_mean_ = Zm
        U, sv, Vt = np.linalg.svd(Z - Zm, full_matrices=False)
        ratio = np.cumsum(sv**2) / np.sum(sv**2)
        self.k_ = int(np.searchsorted(ratio, self.var_keep) + 1)
        self.V_ = Vt[: self.k_].T

        dm = self.mahalanobis(Z)
        rr = self.residual(Z)
        self.d_th_ = float(np.quantile(dm, self.q))
        self.r_th_ = float(np.quantile(rr, self.q))
        return self

    def mahalanobis(self, Z):
        out = []
        for c in (0.0, 1.0):
            D = Z - self.mu_[c]
            out.append(np.einsum("ij,jk,ik->i", D, self.prec_, D))
        return np.sqrt(np.maximum(np.min(np.column_stack(out), axis=1), 0.0))

    def residual(self, Z):
        Zc = Z - self.pca_mean_
        rec = (Zc @ self.V_) @ self.V_.T
        return np.linalg.norm(Zc - rec, axis=1)

    def flags(self, Z, mi=None, mi_th=None):
        dm, rr = self.mahalanobis(Z), self.residual(Z)
        f1, f2 = dm > self.d_th_, rr > self.r_th_
        f3 = np.zeros_like(f1) if mi is None else (mi > mi_th)
        return dict(maha=dm, resid=rr, ood_maha=f1, ood_resid=f2,
                    ood_mi=f3, ood=f1 | f2 | f3)


def combined_ood_score(parts_id, parts_x):
    """
    복수 OOD 지표를 ID 분포 기준 경험분위수로 표준화한 뒤 최댓값을 취한다.
    이로써 서로 단위가 다른 지표를 하나의 운전점으로 결합할 수 있고,
    임계값을 'ID 오게이팅률 = beta' 로 직접 설계할 수 있다.
    """
    zs = []
    for ref, val in zip(parts_id, parts_x):
        ref_s = np.sort(ref)
        q = np.searchsorted(ref_s, val, side="right") / max(len(ref_s), 1)
        zs.append(q)
    return np.max(np.column_stack(zs), axis=1)


# ============================================================ Venn-Abers
def _pava(y, w):
    """가중 등위회귀 (Pool Adjacent Violators). y 는 x 오름차순 정렬 가정."""
    val = list(y.astype(float))
    wt = list(w.astype(float))
    cnt = [1] * len(val)
    i = 0
    while i < len(val) - 1:
        if val[i] <= val[i + 1] + 1e-15:
            i += 1
            continue
        nw = wt[i] + wt[i + 1]
        nv = (val[i] * wt[i] + val[i + 1] * wt[i + 1]) / nw
        val[i:i + 2] = [nv]; wt[i:i + 2] = [nw]
        cnt[i:i + 2] = [cnt[i] + cnt[i + 1]]
        i = max(i - 1, 0)
    out = np.empty(sum(cnt))
    k = 0
    for v, c in zip(val, cnt):
        out[k:k + c] = v
        k += c
    return out


def venn_abers(s_cal, y_cal, s_test):
    """
    Inductive Venn-Abers Predictor.
    각 시험점에 대해 가상 라벨 0 / 1 을 부여하여 등위회귀를 두 번 적합하고,
    확률 구간 [p0, p1] 을 반환한다. 구간 폭 w = p1 - p0 가 게이팅 지표가 된다.
    """
    order = np.argsort(s_cal, kind="mergesort")
    sc, yc = s_cal[order], y_cal[order]
    p0 = np.empty(len(s_test)); p1 = np.empty(len(s_test))
    for i, s in enumerate(s_test):
        j = int(np.searchsorted(sc, s))
        for lab, dst in ((0.0, p0), (1.0, p1)):
            ys = np.insert(yc, j, lab)
            fit = _pava(ys, np.ones_like(ys))
            dst[i] = fit[j]
    lo, hi = np.minimum(p0, p1), np.maximum(p0, p1)
    return lo, hi


# ============================================================ 지표
def roc(scores, y, n=512):
    th = np.unique(np.quantile(scores, np.linspace(0, 1, n)))
    P, N = max((y == 1).sum(), 1), max((y == 0).sum(), 1)
    tpr = np.array([((scores >= t) & (y == 1)).sum() / P for t in th])
    fpr = np.array([((scores >= t) & (y == 0)).sum() / N for t in th])
    o = np.argsort(fpr)
    return fpr[o], tpr[o], th[o]


def auc(scores, y):
    r = np.argsort(np.argsort(scores)) + 1
    P, N = (y == 1).sum(), (y == 0).sum()
    if P == 0 or N == 0:
        return float("nan")
    return float((r[y == 1].sum() - P * (P + 1) / 2) / (P * N))
