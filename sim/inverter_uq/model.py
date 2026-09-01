"""
공유 백본 + M-헤드 앙상블 (순수 NumPy, 수동 역전파).

명세서 (200) 진단부의 구조를 구현한다.
  - 백본에 스펙트럴 정규화를 적용하여 bi-Lipschitz(거리보존) 성질을 부여한다.
    이는 공유 백본이 인식적 불확실도를 과소평가하는 문제를 완화하고,
    특징공간 마할라노비스 거리가 입력공간 거리를 반영하도록 만든다.
  - 각 헤드는 (mu, rho) 를 출력하며 sigma^2 = softplus(rho) 는
    로짓 공간의 관측 잡음 분산(우연적 성분)이다.
  - 확률 사영은 probit 근사를 사용한다:
        p = sigmoid( mu / sqrt(1 + pi*sigma^2/8) )
    이로써 로짓 공간의 잡음이 확률 공간으로 정합적으로 전달된다.
"""
from __future__ import annotations

import numpy as np

SQ8_PI = np.pi / 8.0


def _softplus(x):
    return np.logaddexp(0.0, x)


def _sigmoid(x):
    return 0.5 * (1.0 + np.tanh(0.5 * x))


class Ensemble:
    def __init__(self, d_in, d_h1=32, d_z=24, d_head=16, n_heads=5,
                 sn_bound=3.0, rng=None):
        self.rng = rng or np.random.default_rng(0)
        self.M = n_heads
        self.sn_bound = sn_bound
        r = self.rng

        def init(a, b):
            return r.normal(0, np.sqrt(2.0 / a), (a, b))

        # 공유 백본
        self.W1, self.b1 = init(d_in, d_h1), np.zeros(d_h1)
        self.W2, self.b2 = init(d_h1, d_z), np.zeros(d_z)
        # 헤드 (마지막 2개 레이어를 헤드별로 분리)
        self.Wh = [init(d_z, d_head) for _ in range(self.M)]
        self.bh = [np.zeros(d_head) for _ in range(self.M)]
        self.Wo = [init(d_head, 2) * 0.1 for _ in range(self.M)]
        self.bo = [np.array([0.0, -1.0]) for _ in range(self.M)]

        self._params = self._collect()
        self._m = [np.zeros_like(p) for p in self._params]
        self._v = [np.zeros_like(p) for p in self._params]
        self._t = 0

    # ------------------------------------------------------------------ utils
    def _collect(self):
        ps = [self.W1, self.b1, self.W2, self.b2]
        for m in range(self.M):
            ps += [self.Wh[m], self.bh[m], self.Wo[m], self.bo[m]]
        return ps

    def _spectral_clip(self):
        """백본 가중치의 최대 특이값을 sn_bound 이하로 제한 (거리보존 유도)."""
        for W in (self.W1, self.W2):
            u = self.rng.normal(0, 1, W.shape[0])
            for _ in range(6):
                v = W.T @ u
                v /= np.linalg.norm(v) + 1e-12
                u = W @ v
                u /= np.linalg.norm(u) + 1e-12
            s = float(u @ (W @ v))
            if s > self.sn_bound:
                W *= self.sn_bound / s

    # ---------------------------------------------------------------- forward
    def features(self, X):
        a1 = np.tanh(X @ self.W1 + self.b1)
        z = np.tanh(a1 @ self.W2 + self.b2)
        return a1, z

    def forward(self, X, temperature=1.0):
        """반환: p (n, M), mu (n, M), s2 (n, M), z (n, d_z)"""
        _, z = self.features(X)
        mu = np.empty((X.shape[0], self.M))
        s2 = np.empty((X.shape[0], self.M))
        for m in range(self.M):
            hh = np.tanh(z @ self.Wh[m] + self.bh[m])
            o = hh @ self.Wo[m] + self.bo[m]
            mu[:, m] = o[:, 0]
            s2[:, m] = _softplus(o[:, 1])
        mu_t = mu / temperature
        s2_t = s2 / (temperature**2)
        kappa = 1.0 / np.sqrt(1.0 + SQ8_PI * s2_t)
        p = _sigmoid(mu_t * kappa)
        return p, mu, s2, z

    # --------------------------------------------------------------- training
    def _grads(self, X, y, W):
        """W: (n, M) 부트스트랩 가중치. 반환: loss, grad list"""
        n = X.shape[0]
        a1 = np.tanh(X @ self.W1 + self.b1)
        z = np.tanh(a1 @ self.W2 + self.b2)

        gW1 = np.zeros_like(self.W1); gb1 = np.zeros_like(self.b1)
        gW2 = np.zeros_like(self.W2); gb2 = np.zeros_like(self.b2)
        gWh = [np.zeros_like(w) for w in self.Wh]
        gbh = [np.zeros_like(b) for b in self.bh]
        gWo = [np.zeros_like(w) for w in self.Wo]
        gbo = [np.zeros_like(b) for b in self.bo]

        dz_acc = np.zeros_like(z)
        loss = 0.0
        for m in range(self.M):
            pre_h = z @ self.Wh[m] + self.bh[m]
            hh = np.tanh(pre_h)
            o = hh @ self.Wo[m] + self.bo[m]
            mu, rho = o[:, 0], o[:, 1]
            s2 = _softplus(rho)
            denom = np.sqrt(1.0 + SQ8_PI * s2)
            kappa = 1.0 / denom
            a = mu * kappa
            p = _sigmoid(a)
            pc = np.clip(p, 1e-9, 1 - 1e-9)
            w = W[:, m]
            loss += float(np.sum(w * -(y * np.log(pc) + (1 - y) * np.log(1 - pc))))

            g_a = w * (p - y) / n                      # dL/da
            g_mu = g_a * kappa
            dkappa_ds = -0.5 * SQ8_PI / denom**3
            g_s2 = g_a * mu * dkappa_ds
            g_rho = g_s2 * _sigmoid(rho)

            g_o = np.column_stack([g_mu, g_rho])
            gWo[m] = hh.T @ g_o
            gbo[m] = g_o.sum(axis=0)
            g_hh = g_o @ self.Wo[m].T
            g_pre = g_hh * (1.0 - hh**2)
            gWh[m] = z.T @ g_pre
            gbh[m] = g_pre.sum(axis=0)
            dz_acc += g_pre @ self.Wh[m].T

        g_z_pre = dz_acc * (1.0 - z**2)
        gW2 = a1.T @ g_z_pre
        gb2 = g_z_pre.sum(axis=0)
        g_a1 = g_z_pre @ self.W2.T
        g_a1_pre = g_a1 * (1.0 - a1**2)
        gW1 = X.T @ g_a1_pre
        gb1 = g_a1_pre.sum(axis=0)

        grads = [gW1, gb1, gW2, gb2]
        for m in range(self.M):
            grads += [gWh[m], gbh[m], gWo[m], gbo[m]]
        return loss / n, grads

    def _adam(self, grads, lr, wd=1e-5, b1=0.9, b2=0.999, eps=1e-8):
        self._t += 1
        for i, (p, g) in enumerate(zip(self._params, grads)):
            if p.ndim == 2:
                g = g + wd * p
            self._m[i] = b1 * self._m[i] + (1 - b1) * g
            self._v[i] = b2 * self._v[i] + (1 - b2) * g * g
            mh = self._m[i] / (1 - b1**self._t)
            vh = self._v[i] / (1 - b2**self._t)
            p -= lr * mh / (np.sqrt(vh) + eps)

    def fit(self, X, y, epochs=260, batch=256, lr=6e-3, verbose=False):
        n = X.shape[0]
        # 헤드별 부트스트랩 가중치 (Poisson(1) 근사)
        Wboot = self.rng.poisson(1.0, size=(n, self.M)).astype(np.float64)
        Wboot = np.where(Wboot.sum(axis=1, keepdims=True) == 0, 1.0, Wboot)
        for ep in range(epochs):
            idx = self.rng.permutation(n)
            cur_lr = lr * (0.5 * (1 + np.cos(np.pi * ep / epochs)))
            tot = 0.0
            for k in range(0, n, batch):
                b = idx[k:k + batch]
                loss, grads = self._grads(X[b], y[b], Wboot[b])
                self._adam(grads, cur_lr)
                self._spectral_clip()
                tot += loss * len(b)
            if verbose and (ep + 1) % 40 == 0:
                print(f"    epoch {ep+1:4d}  loss={tot/n:.4f}  lr={cur_lr:.2e}")
        return self
