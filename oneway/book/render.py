# -*- coding: utf-8 -*-
"""책을 사람이 읽는 형태로 만든다.

  · XHTML 조각  — EPUB 안에 들어가는 각 장
  · 한 장짜리 HTML — 브라우저에서 읽고, 인쇄로 PDF 까지 만들 수 있다
  · 마크다운     — 다른 도구로 옮기거나 편집할 때

PDF 를 직접 만들지 않는 이유: PDF 라이브러리를 넣으면 한글 폰트를 따로
챙겨야 하고 설치가 무거워진다. 인쇄용 CSS 를 갖춘 HTML 을 브라우저에서
'PDF 로 저장'하면 글꼴 문제 없이 더 좋은 결과가 나온다.
"""

from __future__ import annotations

import html
from typing import List, Optional

from .content import Book, Chapter, part_intro, verse_line

E = html.escape


# ────────────────────────────────────────────────────────── 조각
def _paras(lines) -> str:
    return "".join(f"<p>{E(x)}</p>" for x in lines if x)


def _section(heading: Optional[str], lines) -> str:
    head = f"<h2>{E(heading)}</h2>" if heading else ""
    return f"<section>{head}{_paras(lines)}</section>"


def chapter_xhtml(book: Book, ch: Chapter, show_part: bool = False) -> str:
    intro = ""
    if show_part:
        lines = part_intro(ch.part)
        if lines:
            intro = f'<div class="part-intro">{_paras(lines)}</div>'
    verse = ""
    if ch.verse_key:
        verse = f'<aside class="verse"><p>{E(verse_line(ch.verse_key))}</p>' \
                f'<p class="small">번역문은 싣지 않았습니다. ' \
                f'직접 펴서 읽어 보십시오.</p></aside>'
    q = (f'<section class="ask"><h3>오늘의 질문</h3><p>{E(ch.question)}</p>'
         f'<div class="write"></div></section>') if ch.question else ""
    st = (f'<section class="ask"><h3>오늘의 한 걸음</h3>'
          f'<p>{E(ch.step)}</p></section>') if ch.step else ""
    cl = f'<p class="closing">{E(ch.closing)}</p>' if ch.closing else ""
    part = f'<p class="part">{E(ch.part)}</p>' if show_part else ""
    return (f'{intro}{part}<h1>{E(ch.title)}</h1>'
            f'{_paras(ch.body)}{verse}{q}{st}{cl}')


def front_xhtml(book: Book) -> str:
    body = "".join(_section(h, lines) for h, lines in book.front)
    return (f'<h1 class="book-title">{E(book.title)}</h1>'
            f'<p class="book-sub">{E(book.subtitle)}</p>{body}')


def back_xhtml(book: Book) -> str:
    return "".join(_section(h, lines) for h, lines in book.back)


def appendix_xhtml(book: Book) -> str:
    return "".join(_section(h, lines) for h, lines in book.appendix)


# ────────────────────────────────────────────────────────── 스타일
CSS = """
body{font-family:"Pretendard","Apple SD Gothic Neo","Noto Sans KR",serif;
  line-height:1.9; font-size:1em; color:#23201c; margin:0 auto; padding:1.2em;
  max-width:34em; word-break:keep-all;}
h1{font-size:1.55em; line-height:1.45; margin:1.2em 0 .8em; letter-spacing:-.02em;}
h1.book-title{font-size:2.1em; margin-bottom:.1em; text-align:center;}
p.book-sub{text-align:center; color:#6d6459; margin-top:0; font-size:1.05em;}
h2{font-size:1.15em; margin:2em 0 .6em;}
h3{font-size:.82em; letter-spacing:.08em; color:#6d6459; margin:0 0 .4em;}
p{margin:1em 0; text-align:justify;}
p.part{font-size:.8em; letter-spacing:.06em; color:#2f6d5a; margin-bottom:0;}
p.closing{font-weight:700; color:#2f6d5a; border-top:1px solid #e6e0d7;
  padding-top:1.1em; margin-top:1.8em;}
p.small{font-size:.85em; color:#6d6459;}
.part-intro{background:#f5f2ec; border-radius:10px; padding:1.1em 1.3em;
  margin:1.5em 0 2.5em;}
.part-intro p{margin:.6em 0;}
aside.verse{border-left:3px solid #2f6d5a; background:#f5f2ec;
  padding:.8em 1.1em; margin:1.6em 0;}
aside.verse p{margin:.3em 0;}
section.ask{border:1px solid #e6e0d7; border-radius:10px;
  padding:1em 1.2em; margin:1.4em 0;}
section.ask p{margin:.2em 0; font-weight:650;}
.write{border-bottom:1px solid #ddd6cb; height:1.9em; margin-top:.9em;}
.write + .write{margin-top:.2em;}
nav ol{list-style:none; padding-left:0;}
nav li{margin:.45em 0;}
nav a{color:inherit; text-decoration:none;}
"""

PRINT_CSS = """
@page{margin:18mm 16mm;}
@media print{
  body{max-width:none; padding:0; font-size:10.5pt;}
  .chapter{page-break-before:always;}
  .no-print{display:none;}
  a{text-decoration:none; color:inherit;}
}
"""


# ────────────────────────────────────────────────────────── 한 장짜리 HTML
def single_html(book: Book, site_url: str = "") -> str:
    """브라우저에서 읽고, 인쇄해서 PDF 로 저장할 수 있는 한 파일."""
    toc: List[str] = []
    parts: List[str] = []
    seen_parts: set = set()

    for ch in book.chapters:
        first = ch.part not in seen_parts
        if first:
            seen_parts.add(ch.part)
            toc.append(f'<li class="toc-part">{E(ch.part)}</li>')
        toc.append(f'<li><a href="#{ch.slug}">{E(ch.title)}</a></li>')
        parts.append(f'<article class="chapter" id="{ch.slug}">'
                     f'{chapter_xhtml(book, ch, show_part=first)}</article>')

    link = (f'<p class="small no-print">무료로 읽기 · 더 이야기하기 — '
            f'{E(site_url)}</p>') if site_url else ""

    return f"""<!doctype html>
<html lang="{E(book.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(book.title)} — {E(book.subtitle)}</title>
<meta name="description" content="{E(book.description)}">
<style>{CSS}{PRINT_CSS}</style>
</head>
<body>
<article class="chapter">{front_xhtml(book)}{link}</article>
<article class="chapter">
  <h1>차례</h1>
  <nav><ol>{"".join(toc)}</ol></nav>
</article>
{"".join(parts)}
<article class="chapter">{back_xhtml(book)}</article>
<article class="chapter"><h1>부록</h1>{appendix_xhtml(book)}</article>
</body>
</html>"""


# ────────────────────────────────────────────────────────── 마크다운
def markdown(book: Book, site_url: str = "") -> str:
    out: List[str] = [f"# {book.title}", f"### {book.subtitle}", ""]
    out.append(f"> {book.description}")
    out.append("")
    for heading, lines in book.front:
        if heading:
            out.append(f"## {heading}")
        out += [x for x in lines] + [""]

    seen: set = set()
    for ch in book.chapters:
        if ch.part not in seen:
            seen.add(ch.part)
            out += ["", f"# {ch.part}", ""]
            for line in part_intro(ch.part):
                out.append(f"> {line}")
            out.append("")
        out += [f"## {ch.title}", ""] + list(ch.body) + [""]
        if ch.verse_key:
            out += [f"> {verse_line(ch.verse_key)}", ""]
        if ch.question:
            out += [f"**오늘의 질문** — {ch.question}", ""]
        if ch.step:
            out += [f"**오늘의 한 걸음** — {ch.step}", ""]
        if ch.closing:
            out += [f"*{ch.closing}*", ""]

    out += ["", "---", ""]
    for heading, lines in book.back:
        if heading:
            out.append(f"## {heading}")
        out += list(lines) + [""]
    out += ["", "---", "", "# 부록", ""]
    for heading, lines in book.appendix:
        out.append(f"## {heading}")
        out += list(lines) + [""]
    if site_url:
        out += ["", f"무료로 읽기 — {site_url}"]
    return "\n".join(out) + "\n"
