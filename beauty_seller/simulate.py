# -*- coding: utf-8 -*-
"""몬테카를로 시뮬레이션으로 운영 전략을 고른다.

모르는 값(전환율, 가격 탄력성, 광고 단가 …)은 하나로 찍지 않고 '범위'로 둔다.
범위 안에서 시나리오를 수백 개 뽑고, 모든 전략을 **같은 시나리오 묶음**으로 평가해
(공통 난수) 운이 아니라 전략의 차이만 비교한다. 고른 전략은 새로 뽑은 시나리오에서
한 번 더 검증해 과적합을 막는다.

모든 기본값은 가정치다. 4주간 실제 데이터가 쌓이면 JSON 으로 범위를 좁혀 다시 돌릴 것.
"""

import csv
import itertools
import json
import math
import random
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path

# 불확실한 가정: 이름 → (낮음, 높음, 분포). log 는 로그균등(배수로 불확실한 값).
UNCERTAIN = {
    "organic_m1": (150, 600, "log"),          # 첫 달 콘텐츠 유입 설문 완료 수
    "organic_growth": (1.05, 1.40, "lin"),    # 콘텐츠 유입 월 성장 배수
    "organic_cap": (3000, 15000, "log"),      # 콘텐츠 유입 월 상한
    "base_cr": (0.015, 0.05, "lin"),          # 할인 0% 일 때 설문→구매 전환율
    "elasticity": (1.0, 3.0, "lin"),          # 가격 탄력성: 가격 1% ↓ → 전환 e% ↑
    "cpq": (400, 1500, "log"),                # 광고로 설문 완료 1건 얻는 비용(원)
    "ad_saturation": (800_000, 3_000_000, "log"),  # 광고 효율이 절반으로 떨어지는 월 광고비
    "paid_cr_mult": (0.5, 0.9, "lin"),        # 광고 유입 전환율 / 콘텐츠 유입 전환율
    "supply_ratio": (0.45, 0.55, "lin"),      # 공급가 / 세트 정가
    "refund_rate": (0.01, 0.05, "lin"),       # 반품·환불 비율
    "repurchase_base": (0.04, 0.12, "lin"),   # 알림 없이 2개월 내 재구매율
    "reminder_uplift": (0.03, 0.15, "lin"),   # 재구매 알림 효과(수신동의 고객 기준)
    "rdisc_k": (0.3, 1.5, "lin"),             # 재구매 할인 1%p 당 재구매율 증가(%p)
    "consent_rate": (0.4, 0.75, "lin"),       # 광고성 알림 수신 동의율
    "affiliate_per_nonbuyer": (10, 60, "lin"),  # 비구매자 1명당 제휴 링크 수익(원)
}

FIXED = {
    "months": 12,
    "list_price": 66_000,       # 세트 정가(개별 구매가 합계)
    "fee_rate": 0.06,           # 채널 수수료(가정치)
    "shipping": 3000,
    "other": 300,
    "return_shipping": 3000,
    "refund_unsellable": 0.3,   # 반품 상품 중 재판매 불가 비율(공급가 기준)
    "fixed_monthly": 100_000,   # 툴·도메인·소모품 등
    "startup_cost": 500_000,    # 첫 달: 촬영용 샘플 구매·조명·사업자 준비 등
    "content_hours": 30,        # 월 숏폼 제작 시간(콘텐츠 유입의 실제 비용)
    "reminder_msgs": 2,         # 구매자 1명당 알림 발송 수
    "msg_cost": 15,             # 알림 1건 비용(원)
    "hourly_value": 15_000,     # 내 시간 1시간의 가치(원)
    "month_noise": 0.25,        # 월별 유입 변동(로그 표준편차)
    "max_cr": 0.25,
    "max_repurchase": 0.5,
}

# 발주 방식: (주문당 오류율, 주문당 작업 분). 오류 1건 = 재발송(공급가+배송비) 손실.
MODES = {"manual": (0.01, 6.0), "agent": (0.02, 3.0), "bulk": (0.003, 0.5)}
MODE_LABEL = {"manual": "수동 입력", "agent": "Aside 에이전트", "bulk": "대량발주 파일"}

GRID = {
    "discount": [0.0, 0.05, 0.10, 0.15, 0.20, 0.25],
    "ad_budget": [0, 300_000, 600_000, 1_000_000, 1_500_000, 2_500_000],
    "ad_start": [1, 3],
    "reminder": [(False, 0.0), (True, 0.0), (True, 0.05), (True, 0.10), (True, 0.15)],
    "mode": list(MODES),
}


@dataclass(frozen=True)
class Strategy:
    discount: float = 0.10       # 세트 할인율
    ad_budget: int = 0           # 월 광고비
    ad_start: int = 1            # 광고 시작 월
    reminder: bool = False       # 재구매 알림 운영
    rdisc: float = 0.0           # 재구매 할인율
    mode: str = "agent"          # 발주 방식

    def describe(self):
        ad = "광고 없음" if not self.ad_budget else f"광고 월 {self.ad_budget / 10_000:,.0f}만원({self.ad_start}개월차부터)"
        rem = f"재구매 알림 + {self.rdisc:.0%} 할인" if self.reminder else "재구매 알림 없음"
        return f"세트 {self.discount:.0%} 할인 · {ad} · {rem} · {MODE_LABEL[self.mode]}"


def all_strategies():
    out = []
    for d, ad, start, (rem, rd), mode in itertools.product(*GRID.values()):
        if ad == 0 and start != 1:
            continue  # 광고 0원이면 시작 월은 의미 없음
        out.append(Strategy(d, ad, start, rem, rd, mode))
    return out


def sample_scenarios(n, seed, uncertain=UNCERTAIN, fixed=FIXED):
    rng = random.Random(seed)
    scenarios = []
    for _ in range(n):
        s = {}
        for name, (lo, hi, kind) in uncertain.items():
            u = rng.random()
            s[name] = math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo))) if kind == "log" else lo + u * (hi - lo)
        s["noise"] = [math.exp(rng.gauss(0, fixed["month_noise"])) for _ in range(fixed["months"])]
        scenarios.append(s)
    return scenarios


def run(strategy, sc, fixed=FIXED):
    """시나리오 하나에서 전략 하나를 월 단위로 돌린다. 기대값 기반이라 같은 입력이면 같은 결과."""
    f, st = fixed, strategy
    months, lp = f["months"], f["list_price"]
    supply = lp * sc["supply_ratio"]
    var_cost = supply + f["shipping"] + f["other"]
    price = lp * (1 - st.discount)
    unit = price * (1 - f["fee_rate"]) - var_cost
    rp_price = lp * (1 - st.rdisc) if st.reminder else price
    rp_unit = rp_price * (1 - f["fee_rate"]) - var_cost
    cr = min(sc["base_cr"] * (1 - st.discount) ** (-sc["elasticity"]), f["max_cr"])
    p_r = sc["repurchase_base"]
    if st.reminder:
        p_r += sc["consent_rate"] * (sc["reminder_uplift"] + sc["rdisc_k"] * st.rdisc)
    p_r = min(p_r, f["max_repurchase"])
    err_rate, minutes = MODES[st.mode]
    refund_loss = f["return_shipping"] + f["refund_unsellable"] * supply

    pending = [0.0] * (months + 2)
    cum = cum_adj = min_cash = 0.0
    breakeven, orders_total, monthly = None, 0.0, []
    for m in range(months):
        organic = min(sc["organic_m1"] * sc["organic_growth"] ** m, sc["organic_cap"]) * sc["noise"][m]
        ad = st.ad_budget if m + 1 >= st.ad_start else 0
        paid = (ad / sc["cpq"]) / (1 + ad / sc["ad_saturation"])
        new = organic * cr + paid * cr * sc["paid_cr_mult"]
        rp = pending[m]
        orders = new + rp
        pending[m + 2] += orders * p_r

        refunds = orders * sc["refund_rate"]
        profit = (new * unit + rp * rp_unit
                  - refunds * (unit + refund_loss)            # 환불: 이익 반납 + 반품 손실
                  - orders * err_rate * (supply + f["shipping"])  # 오발주 재발송
                  - (orders * sc["consent_rate"] * f["reminder_msgs"] * f["msg_cost"] if st.reminder else 0)
                  + (organic + paid - new) * sc["affiliate_per_nonbuyer"]
                  - ad - f["fixed_monthly"] - (f["startup_cost"] if m == 0 else 0))
        labor = (orders * minutes / 60 + f["content_hours"]) * f["hourly_value"]
        cum += profit
        cum_adj += profit - labor
        min_cash = min(min_cash, cum)
        orders_total += orders
        if breakeven is None and cum > 0:
            breakeven = m + 1
        monthly.append((orders, profit))
    return {"profit": cum, "profit_adj": cum_adj, "min_cash": min_cash, "breakeven": breakeven,
            "orders": orders_total, "labor_hours": orders_total * minutes / 60 + f["content_hours"] * months,
            "monthly": monthly}


def _q(xs, q):
    xs = sorted(xs)
    return xs[min(int(q * len(xs)), len(xs) - 1)]


def evaluate(strategy, scenarios, fixed=FIXED):
    rs = [run(strategy, sc, fixed) for sc in scenarios]
    adj = [r["profit_adj"] for r in rs]
    be = [r["breakeven"] for r in rs if r["breakeven"]]
    return {
        "mean_adj": statistics.fmean(adj),
        "mean_profit": statistics.fmean(r["profit"] for r in rs),
        "p10_adj": _q(adj, 0.10),
        "p90_adj": _q(adj, 0.90),
        "p_loss": sum(r["profit"] < 0 for r in rs) / len(rs),
        "p5_min_cash": _q([r["min_cash"] for r in rs], 0.05),
        "breakeven_median": statistics.median(be) if be else None,
        "orders_mean": statistics.fmean(r["orders"] for r in rs),
        "labor_hours": statistics.fmean(r["labor_hours"] for r in rs),
        "runs": rs,
    }


def optimize(n_runs=300, seed=7, capital=3_000_000, max_loss_prob=0.10, strategies=None,
             uncertain=UNCERTAIN, fixed=FIXED):
    """조건(12개월 손실확률 ≤ max_loss_prob, 최악 5% 누적 적자 ≤ capital)을 만족하는
    전략 중 '내 시간 비용까지 뺀 기대 순이익'이 가장 큰 것을 고른다."""
    scenarios = sample_scenarios(n_runs, seed, uncertain, fixed)
    results = []
    for st in strategies or all_strategies():
        ev = evaluate(st, scenarios, fixed)
        ev["feasible"] = ev["p_loss"] <= max_loss_prob and ev["p5_min_cash"] >= -capital
        del ev["runs"]
        results.append((st, ev))
    results.sort(key=lambda x: (x[1]["feasible"], x[1]["mean_adj"]), reverse=True)
    best = results[0][0]
    holdout = evaluate(best, sample_scenarios(n_runs, seed + 10_007, uncertain, fixed), fixed)
    return results, scenarios, holdout


def sensitivity(strategy, scenarios, uncertain=UNCERTAIN, fixed=FIXED):
    """가정 하나만 낮은 값(10%)/높은 값(90%)으로 고정했을 때 기대 순이익이 얼마나 흔들리는지."""
    base = evaluate(strategy, scenarios, fixed)["mean_adj"]
    rows = []
    for name, (lo, hi, kind) in uncertain.items():
        pick = (lambda u: math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo)))) if kind == "log" \
            else (lambda u: lo + u * (hi - lo))
        lo_v, hi_v = pick(0.1), pick(0.9)
        lo_m = evaluate(strategy, [{**s, name: lo_v} for s in scenarios], fixed)["mean_adj"]
        hi_m = evaluate(strategy, [{**s, name: hi_v} for s in scenarios], fixed)["mean_adj"]
        rows.append((name, lo_v, hi_v, lo_m - base, hi_m - base))
    rows.sort(key=lambda r: abs(r[4] - r[3]), reverse=True)
    return base, rows


def load_overrides(path):
    """JSON: {"uncertain": {"base_cr": [0.02, 0.035, "lin"]}, "fixed": {"list_price": 59000}}"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    unc = dict(UNCERTAIN)
    for k, v in data.get("uncertain", {}).items():
        if k not in UNCERTAIN:
            raise ValueError(f"알 수 없는 가정: {k}")
        lo, hi = float(v[0]), float(v[1])
        kind = v[2] if len(v) > 2 else UNCERTAIN[k][2]
        if not lo <= hi or (kind == "log" and lo <= 0):
            raise ValueError(f"{k}: 범위 오류 {v}")
        unc[k] = (lo, hi, kind)
    fixed = dict(FIXED)
    for k, v in data.get("fixed", {}).items():
        if k not in FIXED:
            raise ValueError(f"알 수 없는 고정값: {k}")
        fixed[k] = type(FIXED[k])(v)
    return unc, fixed


def write_results(path, results):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    keys = ["mean_adj", "mean_profit", "p10_adj", "p90_adj", "p_loss", "p5_min_cash",
            "breakeven_median", "orders_mean", "labor_hours", "feasible"]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(list(asdict(Strategy())) + keys)
        for st, ev in results:
            w.writerow(list(asdict(st).values()) + [ev[k] for k in keys])


def ad_breakeven_cpq(strategy, scenarios, fixed=FIXED):
    """광고로 설문 1건을 이 단가보다 싸게 얻을 때만 광고가 이익(재구매까지 포함한 고객가치 기준)."""
    vals = []
    for sc in scenarios:
        supply = fixed["list_price"] * sc["supply_ratio"]
        unit = fixed["list_price"] * (1 - strategy.discount) * (1 - fixed["fee_rate"]) \
            - supply - fixed["shipping"] - fixed["other"]
        cr = min(sc["base_cr"] * (1 - strategy.discount) ** (-sc["elasticity"]), fixed["max_cr"])
        p_r = sc["repurchase_base"]
        if strategy.reminder:
            p_r += sc["consent_rate"] * (sc["reminder_uplift"] + sc["rdisc_k"] * strategy.rdisc)
        p_r = min(p_r, fixed["max_repurchase"])
        vals.append(max(unit, 0) * cr * sc["paid_cr_mult"] / (1 - p_r))
    return statistics.median(vals)


def monthly_median(strategy, scenarios, fixed=FIXED):
    rs = [run(strategy, sc, fixed)["monthly"] for sc in scenarios]
    return [(statistics.median(r[m][0] for r in rs), statistics.median(r[m][1] for r in rs))
            for m in range(fixed["months"])]


def won(v):
    return f"{v / 10_000:,.0f}만원"


def report(n_runs=300, seed=7, capital=3_000_000, max_loss_prob=0.10, config=None, csv_path=None, top=5):
    unc, fixed = load_overrides(config) if config else (UNCERTAIN, FIXED)
    results, scenarios, holdout = optimize(n_runs, seed, capital, max_loss_prob, None, unc, fixed)
    best, ev = results[0]
    out = []
    if not ev["feasible"]:
        out.append("⚠ 조건(손실확률·자본한도)을 만족하는 전략이 없습니다. 가장 나은 전략을 참고용으로 보여줍니다.")
    out += [
        f"■ 최적 전략 ({len(results)}개 전략 × {n_runs}개 시나리오 × {fixed['months']}개월)",
        f"  {best.describe()}",
        f"  기대 순이익 {won(ev['mean_profit'])} / 내 시간비용 차감 후 {won(ev['mean_adj'])}",
        f"  비관(하위10%) {won(ev['p10_adj'])} ~ 낙관(상위10%) {won(ev['p90_adj'])}",
        f"  손실 확률 {ev['p_loss']:.0%} · 최악 5% 누적 적자 {won(-ev['p5_min_cash'])} · "
        f"흑자 전환 {ev['breakeven_median'] or '-'}개월차(중앙값)",
        f"  연 주문 {ev['orders_mean']:,.0f}건 · 작업 {ev['labor_hours']:,.0f}시간/년(콘텐츠 포함, 시간당 {fixed['hourly_value']:,}원으로 환산)",
        f"  검증(새 시나리오 {n_runs}개): 시간비용 차감 후 {won(holdout['mean_adj'])}, 손실 확률 {holdout['p_loss']:.0%}",
        "",
    ]
    base = evaluate(Strategy(), scenarios, fixed)
    out.append(f"■ 기존 방식 대비: {Strategy().describe()}")
    out.append(f"  {won(base['mean_adj'])} → {won(ev['mean_adj'])} "
               f"({(ev['mean_adj'] / base['mean_adj'] - 1) if base['mean_adj'] > 0 else 0:+.0%})")
    out.append("")

    ties = [st for st, e in results[1:] if e["feasible"] and e["mean_adj"] >= ev["mean_adj"] - abs(ev["mean_adj"]) * 0.01]
    if ties:
        out.append(f"  ※ 1% 이내 차이로 사실상 동률인 전략 {len(ties)}개 — 상위 목록 참고, 운영이 쉬운 쪽을 고르면 됩니다.")
        out.append("")
    out.append("■ 요소별 효과 (최적 전략에서 하나만 바꿨을 때)")
    variants = [
        ("세트 할인 10%", {"discount": 0.10}), ("세트 할인 20%", {"discount": 0.20}),
        ("광고 월 60만원", {"ad_budget": 600_000, "ad_start": 1}),
        ("광고 월 150만원", {"ad_budget": 1_500_000, "ad_start": 1}),
        ("재구매 알림 끔", {"reminder": False, "rdisc": 0.0}),
        ("Aside 에이전트 발주", {"mode": "agent"}), ("수동 발주", {"mode": "manual"}),
    ]
    for label, change in variants:
        alt = Strategy(**{**asdict(best), **change})
        if alt == best:
            continue
        e = evaluate(alt, scenarios, fixed)
        out.append(f"  {label:<14} {won(e['mean_adj'] - ev['mean_adj']):>10}  (손실확률 {e['p_loss']:.0%})")
    out.append("")

    out.append(f"■ 상위 {top}개 전략")
    for i, (st, e) in enumerate(results[:top], 1):
        out.append(f"  {i}. {won(e['mean_adj']):>8}  하위10% {won(e['p10_adj']):>8}  {st.describe()}")
    out.append("")

    cpq = ad_breakeven_cpq(best, scenarios, fixed)
    out.append(f"■ 광고 허용 조건: 설문 완료 1건당 광고비가 {cpq:,.0f}원 미만일 때만 광고 시작")
    out.append(f"  (가정한 광고 단가 범위 {unc['cpq'][0]:,.0f}~{unc['cpq'][1]:,.0f}원 — 소액 테스트로 실측 후 판단)")
    out.append("")

    _, sens = sensitivity(best, scenarios, unc, fixed)
    out.append("■ 결과를 가장 크게 흔드는 가정 (먼저 실측해야 할 순서)")
    for name, lo_v, hi_v, d_lo, d_hi in sens[:6]:
        out.append(f"  {name:<22} {lo_v:>10,.3g} → {won(d_lo):>8} | {hi_v:>10,.3g} → {won(d_hi):>8}")
    out.append("")

    out.append("■ 월별 예상 (중앙값)")
    for m, (o, p) in enumerate(monthly_median(best, scenarios, fixed), 1):
        out.append(f"  {m:>2}개월차  주문 {o:>6,.0f}건  순이익 {won(p):>8}")
    if csv_path:
        write_results(csv_path, results)
        out.append(f"\n전체 {len(results)}개 전략 결과: {csv_path}")
    return "\n".join(out)
