"""터미널 표 정렬 유틸.

한글은 터미널에서 두 칸을 차지하므로 파이썬의 ``str.ljust`` 로는 표가 어긋난다.
동아시아 문자 폭을 고려해 채움 길이를 계산한다.
"""

from __future__ import annotations

import unicodedata


def display_width(text: str) -> int:
    """터미널에서 차지하는 칸 수."""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in str(text))


def ljust(text: str, width: int, fill: str = " ") -> str:
    text = str(text)
    return text + fill * max(width - display_width(text), 0)


def rjust(text: str, width: int, fill: str = " ") -> str:
    text = str(text)
    return fill * max(width - display_width(text), 0) + text


def truncate(text: str, width: int) -> str:
    """표시 폭 기준으로 자른다."""
    text = str(text)
    if display_width(text) <= width:
        return text
    out, used = "", 0
    for ch in text:
        w = display_width(ch)
        if used + w > width:
            break
        out += ch
        used += w
    return out


def row(cells: list[tuple[str, int, str]], gap: str = " ") -> str:
    """``(값, 폭, 정렬)`` 목록을 한 줄로 만든다. 정렬은 ``<`` 또는 ``>``."""
    parts = []
    for value, width, align in cells:
        text = truncate(value, width)
        parts.append(rjust(text, width) if align == ">" else ljust(text, width))
    return gap.join(parts)
