from __future__ import annotations

from kis.textutil import display_width, ljust, rjust, row, truncate


def test_korean_counts_as_two_columns():
    assert display_width("삼성전자") == 8
    assert display_width("005930") == 6
    assert display_width("SK하이닉스") == 10  # ASCII 2 + 한글 4×2


def test_padding_aligns_mixed_scripts():
    assert display_width(ljust("삼성전자", 12)) == 12
    assert display_width(rjust("005930", 12)) == 12
    assert ljust("abc", 5) == "abc  "


def test_truncate_respects_width():
    assert truncate("삼성전자우선주", 8) == "삼성전자"
    assert truncate("short", 10) == "short"


def test_rows_have_identical_width():
    header = row([("종목명", 12, "<"), ("수량", 8, ">")])
    line = row([("SK하이닉스", 12, "<"), ("1,234", 8, ">")])
    assert display_width(header) == display_width(line)
