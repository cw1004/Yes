# -*- coding: utf-8 -*-
"""EPUB 3 파일을 만든다. 표준 라이브러리만 쓴다.

EPUB 은 사실 정해진 이름의 파일을 담은 zip 이다. 규칙이 몇 개 있다.

  1. ``mimetype`` 이 **가장 먼저**, **압축하지 않고** 들어가야 한다.
  2. ``META-INF/container.xml`` 이 패키지 파일(opf)의 위치를 가리킨다.
  3. ``content.opf`` 에 메타데이터·매니페스트·순서가 들어간다.
  4. EPUB 3 은 ``nav.xhtml`` 로 목차를 만든다.
     구형 단말을 위해 ``toc.ncx`` 도 같이 넣어 준다.

이 규칙만 지키면 리디·교보·애플북스·킨들(변환) 어디서든 열린다.
"""

from __future__ import annotations

import html
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

from .content import Book
from . import render

E = html.escape

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""


def _page(title: str, body: str, lang: str = "ko") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{E(lang)}" lang="{E(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>{E(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
{body}
</body>
</html>
"""


def _pages(book: Book, site_url: str = "") -> List[Tuple[str, str, str]]:
    """(파일명, 목차 제목, XHTML) 목록. 순서가 곧 책 순서다."""
    out: List[Tuple[str, str, str]] = []

    link = (f'<p class="small">무료로 읽기 · 더 이야기하기 — {E(site_url)}</p>'
            if site_url else "")
    out.append(("front.xhtml", "여는 글",
                _page("여는 글", render.front_xhtml(book) + link, book.language)))

    seen: set = set()
    for ch in book.chapters:
        first = ch.part not in seen
        seen.add(ch.part)
        out.append((f"{ch.slug}.xhtml", ch.title,
                    _page(ch.title, render.chapter_xhtml(book, ch, first),
                          book.language)))

    out.append(("back.xhtml", "닫는 글",
                _page("닫는 글", render.back_xhtml(book), book.language)))
    out.append(("appendix.xhtml", "부록",
                _page("부록", "<h1>부록</h1>" + render.appendix_xhtml(book),
                      book.language)))
    return out


def _opf(book: Book, pages, modified: str) -> str:
    items = "\n    ".join(
        f'<item id="{Path(f).stem}" href="{f}" media-type="application/xhtml+xml"/>'
        for f, _, _ in pages)
    spine = "\n    ".join(f'<itemref idref="{Path(f).stem}"/>' for f, _, _ in pages)
    subjects = "\n    ".join(f"<dc:subject>{E(k)}</dc:subject>" for k in book.keywords)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
         unique-identifier="book-id" xml:lang="{E(book.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">{E(book.identifier)}</dc:identifier>
    <dc:title>{E(book.title)}</dc:title>
    <dc:creator>{E(book.author)}</dc:creator>
    <dc:language>{E(book.language)}</dc:language>
    <dc:description>{E(book.description)}</dc:description>
    <dc:publisher>{E(book.author)}</dc:publisher>
    {subjects}
    <meta property="dcterms:modified">{modified}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
    {items}
  </manifest>
  <spine toc="ncx">
    {spine}
  </spine>
</package>
"""


def _nav(book: Book, pages) -> str:
    lis = "\n      ".join(
        f'<li><a href="{f}">{E(t)}</a></li>' for f, t, _ in pages)
    body = f"""<nav epub:type="toc" id="toc">
  <h1>차례</h1>
  <ol>
      {lis}
  </ol>
</nav>"""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="{E(book.language)}" lang="{E(book.language)}">
<head><meta charset="utf-8"/><title>차례</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
{body}
</body>
</html>
"""


def _ncx(book: Book, pages) -> str:
    """구형 단말을 위한 목차."""
    points = "\n    ".join(
        f'<navPoint id="n{i}" playOrder="{i + 1}">'
        f'<navLabel><text>{E(t)}</text></navLabel>'
        f'<content src="{f}"/></navPoint>'
        for i, (f, t, _) in enumerate(pages))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="{E(book.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>{E(book.title)}</text></docTitle>
  <navMap>
    {points}
  </navMap>
</ncx>
"""


def _cover(book: Book) -> str:
    """표지. 외부 이미지 없이 SVG 로 그린다 — 폰트·저작권 문제가 없다."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"
     viewBox="0 0 1200 1800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1d3b33"/>
      <stop offset="100%" stop-color="#2f6d5a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1800" fill="url(#g)"/>
  <circle cx="600" cy="640" r="150" fill="none" stroke="#7fc3ac"
          stroke-width="3" opacity="0.55"/>
  <circle cx="600" cy="640" r="98" fill="none" stroke="#7fc3ac"
          stroke-width="3" opacity="0.8"/>
  <circle cx="600" cy="640" r="24" fill="#f3efe7"/>
  <text x="600" y="1030" text-anchor="middle" fill="#f3efe7"
        font-family="sans-serif" font-size="104" font-weight="700">
    {E(book.title)}
  </text>
  <text x="600" y="1128" text-anchor="middle" fill="#a9d6c6"
        font-family="sans-serif" font-size="44">
    {E(book.subtitle)}
  </text>
  <text x="600" y="1560" text-anchor="middle" fill="#a9d6c6"
        font-family="sans-serif" font-size="38">
    판매 수익 전액 기부
  </text>
  <text x="600" y="1640" text-anchor="middle" fill="#7fc3ac"
        font-family="sans-serif" font-size="34">
    {E(book.author)}
  </text>
</svg>
"""


def write_epub_to(book: Book, fileobj, site_url: str = "") -> None:
    """열려 있는 대상(파일·메모리 버퍼)에 EPUB 을 쓴다.

    맞춤 책은 내려받을 때마다 메모리에서 만들고 디스크에 남기지 않는다.
    남기면 그 파일이 곧 개인정보가 된다.
    """
    pages = _pages(book, site_url)
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with zipfile.ZipFile(fileobj, "w") as z:
        # mimetype 은 반드시 첫 번째, 압축하지 않고
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip",
                   compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OEBPS/content.opf", _opf(book, pages, modified),
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", _nav(book, pages),
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", _ncx(book, pages),
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/style.css", render.CSS,
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/cover.svg", _cover(book),
                   compress_type=zipfile.ZIP_DEFLATED)
        for name, _, markup in pages:
            z.writestr(f"OEBPS/{name}", markup,
                       compress_type=zipfile.ZIP_DEFLATED)


def write_epub(book: Book, target, site_url: str = "") -> Path:
    """EPUB 파일 하나를 만든다."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as f:
        write_epub_to(book, f, site_url)
    return target
