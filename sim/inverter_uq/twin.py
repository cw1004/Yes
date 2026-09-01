"""
전기-열 연성 디지털 트윈 기반 특징 생성기.

명세서 (700) 항의 디지털 트윈을 축약 구현한 것으로,
잠재 열화 상태 h 와 운전점으로부터 진단 특징 12종을 생성한다.
학습 분포(ID)와 미학습 분포(OOD)를 분리 생성할 수 있다.
"""
from __future__ import annotations

import numpy as np

FEATURE_NAMES = [
    "dVce_on",      # 도통전압 상승률 [%], 본딩 와이어 열화 지표
    "dRth",         # 열저항 상승률 [%], 솔더 크랙 지표
    "Tj_margin",    # 정격 대비 접합온도 여유 [K]
    "d_a",          # 정규화 평균 전류 Park 성분 (a상)
    "d_b",          # 정규화 평균 전류 Park 성분 (b상)
    "d_c",          # 정규화 평균 전류 Park 성분 (c상)
    "park_ecc",     # Park 벡터 궤적 이심률 (0=원, 1=직선)
    "dt_don",       # 턴온 지연 편차 [ns]
    "dvdt_norm",    # 정규화 dv/dt [-]
    "dc_ripple",   # DC 링크 전류 리플 실효값 [pu]
    "i_thd",        # 상전류 THD [%]
    "load_pu",      # 부하율 [pu]
    "vdc_pu",       # DC 링크 전압 [pu, 400 V 기준]
]
N_FEATURES = len(FEATURE_NAMES)

# 소자/시스템 정수 (400 V 급 SiC 모듈 전형값)
VCE0, RCE = 0.9, 2.2e-3          # 도통 특성
ESW = 8.0e-6                     # 스위칭 에너지 계수 [J/(V*A)]
RTH0 = 0.28                      # 접합-냉각수 열저항 [K/W]
TJ_MAX = 175.0                   # 정격 접합온도 [degC]
I_RATED = 400.0                  # 정격 전류 [A]
FSW = 10e3                       # 스위칭 주파수 [Hz]


def _electro_thermal(load_pu, tc, vdc, h_solder, h_bond, fsw=FSW):
    """손실 -> 온도상승 -> 온도의존 파라미터 -> 손실 재계산 (3회 반복 연성)."""
    i_rms = load_pu * I_RATED / np.sqrt(2.0)
    rth = RTH0 * (1.0 + 0.55 * h_solder)
    tj = tc.copy()
    for _ in range(3):
        # 도통 손실: Vce0 는 온도와 본딩 열화에 따라 증가
        vce0_t = VCE0 * (1.0 + 0.0018 * (tj - 25.0)) * (1.0 + 0.20 * h_bond)
        rce_t = RCE * (1.0 + 0.0035 * (tj - 25.0)) * (1.0 + 0.25 * h_bond)
        p_cond = (vce0_t * i_rms * 0.45 + rce_t * i_rms**2 * 0.45)
        p_sw = ESW * vdc * i_rms * fsw * 1e-3
        tj = tc + (p_cond + p_sw) * rth
    return tj, rth, vce0_t


def sample(
    n: int,
    rng: np.random.Generator,
    regime: str = "id",
) -> tuple[np.ndarray, np.ndarray, dict]:
    """
    특징 행렬 X (n, 12), 라벨 y (n,), 부가정보 dict 를 반환.

    regime:
      "id"        : 학습 분포 (400 V 급, 냉각수 20~85 degC, 학습된 3개 고장모드)
      "ood_800v"  : 800 V 급 전압 클래스 (미학습 전압 도메인)
      "ood_gate"  : 게이트 드라이버 열화 (미학습 고장 모드)
      "ood_cold"  : 저온 시동 (미학습 온도 도메인)
    """
    # ---- 운전점 -----------------------------------------------------------
    load_pu = rng.uniform(0.05, 1.0, n)
    tc = rng.uniform(20.0, 85.0, n)
    vdc = rng.uniform(250.0, 450.0, n)
    f_e = rng.uniform(5.0, 400.0, n)

    if regime == "ood_800v":
        vdc = rng.uniform(500.0, 900.0, n)
    elif regime == "ood_cold":
        tc = rng.uniform(-25.0, 5.0, n)

    # 3상 전류합 잔차 [pu] : 기본값은 센서 오프셋 잡음에 의한 것
    i_sum_resid = np.abs(rng.normal(0, 0.02, n) * np.sqrt(3.0))

    # ---- 잠재 열화 상태 ----------------------------------------------------
    h = rng.beta(1.4, 2.0, n)                    # 전체 열화도 [0,1]
    h_bond = h * rng.uniform(0.5, 1.0, n)        # 본딩 와이어 성분
    h_solder = h * rng.uniform(0.5, 1.0, n)      # 솔더 성분

    # 고장 모드: 0=건전, 1=개방 전조, 2=단락 전조
    mode = rng.choice([0, 1, 2], size=n, p=[0.62, 0.24, 0.14])
    # 전조는 열화가 진행된 개체에서만 유의하게 발현
    onset = np.clip((h - 0.45) / 0.55, 0.0, 1.0)

    # ---- 전기-열 연성 ------------------------------------------------------
    tj, rth, vce0_t = _electro_thermal(load_pu, tc, vdc, h_solder, h_bond)
    tj_margin = TJ_MAX - tj

    # ---- 특징 합성 ---------------------------------------------------------
    d_vce = 20.0 * h_bond + 0.12 * (tj - 25.0) * 0.15
    d_rth = 55.0 * h_solder**1.4

    # 개방 전조: 해당 상의 정규화 평균 Park 성분이 증가 (Cardoso 지표)
    faulty_phase = rng.integers(0, 3, n)
    d = np.zeros((n, 3))
    oc = (mode == 1)
    amp_oc = 0.55 * onset[oc] * rng.uniform(0.6, 1.0, oc.sum())
    d[oc, faulty_phase[oc]] = amp_oc
    # 나머지 두 상은 -amp/2 씩 (전류합 = 0 구속)
    for k in range(3):
        sel = oc & (faulty_phase == k)
        for j in range(3):
            if j != k:
                d[sel, j] -= d[sel, k] / 2.0

    park_ecc = np.zeros(n)
    park_ecc[oc] = 0.45 * onset[oc]

    # 단락 전조: 게이트 전하 이상 -> dv/dt 상승, DC 링크 리플 증가
    sc = (mode == 2)
    dvdt = 1.0 + 0.02 * h_bond
    dvdt[sc] += 0.35 * onset[sc]
    dc_ripple = 0.08 + 0.05 * load_pu + 0.03 * h
    dc_ripple[sc] += 0.22 * onset[sc]

    dt_don = 30.0 * h_bond + 8.0 * (tj - 25.0) / 100.0

    if regime == "ood_sensor":
        # 미학습 고장 원인: 상전류 센서 게인 이상 (+10~35 %).
        # 정규화 평균 Park 성분이 개방고장과 유사하게 상승하므로
        # 진단부는 '개방고장 임박' 으로 높은 확신도의 오판을 내리기 쉽다.
        # 이때 재구성을 실행하면 건전 소자를 격리하게 되어 고장을 유발한다.
        g = rng.uniform(0.10, 0.35, n)
        kk = rng.integers(0, 3, n)
        for j in range(3):
            sel = kk == j
            d[sel, j] += 1.6 * g[sel]
        park_ecc = park_ecc + 0.9 * g
        mode = np.full(n, 4)
        # 단일 채널 게인 오차이므로 3상 전류합 구속이 깨진다.
        # 이 잔차는 학습 기반 진단부가 아니라 결정론적 감시부(600)가 검출한다.
        i_sum_resid = g * load_pu

    if regime == "ood_gate":
        # 미학습 고장 모드: 게이트 구동전압 저하
        #  -> 턴온 지연이 크게 증가하나 Vce_on/Park 지표는 정상 범위
        sev = rng.uniform(0.4, 1.0, n)
        dt_don = dt_don + 220.0 * sev
        dvdt = dvdt - 0.45 * sev
        d_vce = d_vce + 1.5 * sev          # 미미한 상승만
        mode = np.full(n, 3)               # 학습에 없는 모드 라벨

    i_thd = 3.0 + 6.0 * (1.0 - load_pu) + 12.0 * park_ecc + 2.0 * h

    # ---- 라벨: 고장 임박 여부 (확률적 -> 우연적 불확실도의 원천) --------------
    logit_risk = (
        6.2 * (h - 0.74)
        + 1.9 * np.clip((tj - 128.0) / 22.0, -2.5, 2.5)
        + 1.5 * (mode == 2)
        + 0.9 * (mode == 1)
        - 0.85
    )
    risk = 1.0 / (1.0 + np.exp(-logit_risk))
    y = (rng.uniform(0, 1, n) < risk).astype(np.float64)

    X = np.column_stack([
        d_vce, d_rth, tj_margin, d[:, 0], d[:, 1], d[:, 2],
        park_ecc, dt_don, dvdt, dc_ripple, i_thd, load_pu, vdc / 400.0,
    ])

    # ---- 센서 결함 모델: 백색잡음 + 오프셋 드리프트 + 게인 오차 --------------
    snr_db = rng.uniform(30.0, 60.0, (n, 1))
    scale = np.abs(X).mean(axis=0, keepdims=True) + 1e-9
    X = X + rng.normal(0, 1, X.shape) * scale * 10 ** (-snr_db / 20.0)
    X = X * (1.0 + rng.normal(0, 0.01, (n, N_FEATURES)))          # 게인 오차
    X = X + rng.normal(0, 0.02, (n, N_FEATURES)) * scale          # 오프셋 드리프트

    info = dict(h=h, mode=mode, tj=tj, tj_margin=tj_margin, load_pu=load_pu,
                vdc=vdc, tc=tc, f_e=f_e, risk=risk,
                i_sum_resid=i_sum_resid)
    return X, y, info
