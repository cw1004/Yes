# -*- coding: utf-8 -*-
"""python3 -m beauty_seller <명령>

  quiz       대화형 설문 → 추천 메시지 출력
  recommend  설문 답변 JSON → 추천 메시지 (구글폼/카톡 답변 붙여넣기용)
  margin     세트 1건 손익 + 월 목표 역산
  orders     마켓 주문 CSV → 공급사 대량발주 CSV
"""

import argparse
import json
from pathlib import Path

from .economics import CHANNEL_FEE, UnitEconomics, report
from .orders import convert, load_mapping, read_csv, write_csv
from .quiz import QUESTIONS, QuizError, score
from .recommend import build_routine, load_catalog, render_message

DATA = Path(__file__).parent / "data"


def _recommend(answers, args):
    profile = score(answers)
    routine = build_routine(profile, load_catalog(args.catalog), args.discount)
    print(render_message(routine, args.store_url))
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
    ok, bad = convert(read_csv(args.input), load_mapping(args.mapping))
    out = Path(args.out)
    if ok:
        write_csv(out, ok, list(ok[0].keys()))
    if bad:
        write_csv(out.with_name(out.stem + "_오류.csv"), bad, ["주문번호", "사유"])
    print(f"발주 행 {len(ok)}개 → {out}" if ok else "발주 가능한 행이 없습니다.")
    for b in bad:
        print(f"  ✗ {b['주문번호']}: {b['사유']}")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="beauty_seller", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name in ("quiz", "recommend"):
        p = sub.add_parser(name)
        if name == "recommend":
            p.add_argument("answers", help="JSON 문자열 또는 .json 파일 경로")
        p.add_argument("--catalog", default=str(DATA / "catalog.example.csv"))
        p.add_argument("--discount", type=float, default=0.1, help="세트 할인율 (기본 0.1)")
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

    args = ap.parse_args(argv)
    try:
        return {"quiz": cmd_quiz, "recommend": cmd_recommend,
                "margin": cmd_margin, "orders": cmd_orders}[args.cmd](args)
    except QuizError as e:
        print(f"오류: {e}")
        return 2
