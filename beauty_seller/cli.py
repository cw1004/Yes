# -*- coding: utf-8 -*-
"""python3 -m beauty_seller <명령>

  quiz       대화형 설문 → 추천 메시지 출력
  recommend  설문 답변 JSON → 추천 메시지 (구글폼/카톡 답변 붙여넣기용)
  margin     세트 1건 손익 + 월 목표 역산
  orders     마켓 주문 CSV → 공급사 대량발주 CSV
  simulate   몬테카를로 시뮬레이션으로 할인·광고·재구매·발주 방식 최적 조합 찾기
"""

import argparse
import json
from pathlib import Path

from .economics import CHANNEL_FEE, UnitEconomics, report
from .orders import append_ledger, convert, load_ledger, load_mapping, read_csv, write_csv
from .quiz import QUESTIONS, QuizError, score
from .recommend import build_routine, load_catalog, render_message

DATA = Path(__file__).parent / "data"


def _recommend(answers, args):
    profile = score(answers)
    routine = build_routine(profile, load_catalog(args.catalog), args.discount)
    print(render_message(routine, args.store_url))
    if not routine.is_sellable(min_margin=args.min_margin):
        print(f"\n⚠ 이 세트는 광고비 0원 기준 순이익률 {args.min_margin:.0%} 미만입니다. 할인율을 낮추거나 구성을 바꾸세요.")
    print("\n[셀러용] 공급사:", routine.supplier,
          "| 공급가 합계:", f"{routine.supply_cost:,}원",
          "| 세트가:", f"{routine.set_price:,}원",
          "| 구성:", ", ".join(p.sku for p in routine.items))
    return 0


def cmd_quiz(args):
    answers = {}
    for key, question, choices in QUESTIONS:
        while True:
            a = input(f"{question} {choices}: ").strip()
            if a in choices:
                answers[key] = a
                break
            print("  보기 중에서 입력해 주세요.")
        if key == "adult" and a != "예":
            print("만 14세 미만은 보호자 동의 후 진행해 주세요.")
            return 1
    return _recommend(answers, args)


def cmd_recommend(args):
    answers = json.loads(Path(args.answers).read_text(encoding="utf-8")
                         if args.answers.endswith(".json") else args.answers)
    return _recommend(answers, args)


def cmd_margin(args):
    fee = args.fee if args.fee is not None else CHANNEL_FEE[args.channel]
    ue = UnitEconomics(args.price, args.supply, fee, args.shipping, args.other, args.ad)
    print(report(ue, args.target, args.conversion))
    return 0


def cmd_orders(args):
    mapping = load_mapping(args.mapping)
    ok, bad = convert(read_csv(args.input), mapping, load_ledger(args.ledger))
    out, err_out = Path(args.out), Path(args.out).with_name(Path(args.out).stem + "_오류.csv")
    for stale in (out, err_out):  # 이전 실행 파일을 다시 업로드하는 사고 방지
        stale.unlink(missing_ok=True)
    if ok:
        write_csv(out, ok, list(ok[0].keys()))
        oid_col = next((h for h, f in mapping["supplier_columns"].items() if f == "order_id"), None)
        if oid_col:
            append_ledger(args.ledger, list(dict.fromkeys(r[oid_col] for r in ok)))
            print(f"발주 장부 기록: {args.ledger} — 같은 주문은 다음 실행에서 자동으로 건너뜁니다."
                  " 발주를 취소했다면 장부에서 해당 줄을 지우세요.")
        else:
            print("⚠ supplier_columns 에 order_id 열이 없어 중복 발주 방지 장부를 쓸 수 없습니다.")
    if bad:
        write_csv(err_out, bad, ["주문번호", "사유"])
    print(f"발주 행 {len(ok)}개 → {out}" if ok else "발주 가능한 행이 없습니다.")
    for b in bad:
        print(f"  ✗ {b['주문번호']}: {b['사유']}")
    return 1 if bad else 0


def cmd_simulate(args):
    from .simulate import report
    print(report(args.runs, args.seed, args.capital, args.max_loss, args.config, args.csv))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="beauty_seller", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name in ("quiz", "recommend"):
        p = sub.add_parser(name)
        if name == "recommend":
            p.add_argument("answers", help="JSON 문자열 또는 .json 파일 경로")
        p.add_argument("--catalog", default=str(DATA / "catalog.example.csv"))
        p.add_argument("--discount", type=float, default=0.05,
                       help="세트 할인율 (기본 0.05 — simulate 결과 0~5%%가 최적, 10%% 이상은 손해)")
        p.add_argument("--min-margin", type=float, default=0.2, help="광고 0원 기준 최소 순이익률")
        p.add_argument("--store-url", default="[스마트스토어 세트 상품 링크]")

    m = sub.add_parser("margin")
    m.add_argument("--price", type=int, required=True, help="세트 판매가")
    m.add_argument("--supply", type=int, required=True, help="공급가 합계")
    m.add_argument("--channel", choices=list(CHANNEL_FEE), default="smartstore")
    m.add_argument("--fee", type=float, help="수수료율 직접 지정 (예: 0.058)")
    m.add_argument("--shipping", type=int, default=3000)
    m.add_argument("--other", type=int, default=300)
    m.add_argument("--ad", type=int, default=0, help="주문 1건당 광고비")
    m.add_argument("--target", type=int, default=3_000_000, help="월 목표 순이익")
    m.add_argument("--conversion", type=float, default=0.03, help="설문 완료→구매 전환율")

    o = sub.add_parser("orders")
    o.add_argument("input", help="마켓 주문 CSV")
    o.add_argument("--mapping", default=str(DATA / "order_mapping.example.json"))
    o.add_argument("--out", default="output/발주서.csv")
    o.add_argument("--ledger", default="output/발주장부.txt", help="이미 발주한 주문번호 목록")

    s = sub.add_parser("simulate")
    s.add_argument("--runs", type=int, default=300, help="시나리오 수 (기본 300)")
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--capital", type=int, default=3_000_000, help="버틸 수 있는 최대 누적 적자")
    s.add_argument("--max-loss", type=float, default=0.10, help="허용 손실 확률 (기본 10%%)")
    s.add_argument("--config", help="가정 범위 덮어쓰기 JSON (실측 후 좁히기)")
    s.add_argument("--csv", default="output/simulation_results.csv")

    args = ap.parse_args(argv)
    try:
        return {"quiz": cmd_quiz, "recommend": cmd_recommend,
                "margin": cmd_margin, "orders": cmd_orders, "simulate": cmd_simulate}[args.cmd](args)
    except (QuizError, ValueError) as e:
        print(f"오류: {e}")
        return 2
