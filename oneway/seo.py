# -*- coding: utf-8 -*-
"""검색 유입을 위한 sitemap / robots.

「50가지」는 페이지 50개가 아니라 **검색 유입 통로 50개**다.
입구 7개, 고정 페이지 4개까지 더하면 색인 대상은 60개가 넘는다.
"""

from __future__ import annotations

from datetime import date
from typing import List, Tuple

from .config import Config
from .content import entries, fifty, pages

# (경로, 우선순위, 변경주기)
def all_urls() -> List[Tuple[str, str, str]]:
    urls: List[Tuple[str, str, str]] = [
        ("/", "1.0", "daily"),
        ("/today", "0.9", "daily"),
        ("/counsel", "0.9", "weekly"),
        ("/believe", "0.8", "weekly"),
        ("/pray", "0.6", "weekly"),
    ]
    urls += [(e.url, "0.8", "monthly") for e in entries.ENTRIES]
    urls += [(b.url, "0.7", "monthly") for b in fifty.BELIEFS]
    urls += [(p.url, "0.7", "monthly") for p in pages.PAGES]
    return urls


def sitemap_xml(cfg: Config, today: date = None) -> str:
    base = cfg.site_url.rstrip("/")
    stamp = (today or date.today()).isoformat()
    items = "\n".join(
        f"  <url><loc>{base}{path}</loc><lastmod>{stamp}</lastmod>"
        f"<changefreq>{freq}</changefreq><priority>{pri}</priority></url>"
        for path, pri, freq in all_urls())
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{items}\n</urlset>\n")


def robots_txt(cfg: Config) -> str:
    base = cfg.site_url.rstrip("/")
    return ("User-agent: *\n"
            "Allow: /\n"
            "Disallow: /api/\n"
            "\n"
            "# 네이버·구글 모두 허용\n"
            "User-agent: Yeti\n"
            "Allow: /\n"
            "\n"
            f"Sitemap: {base}/sitemap.xml\n")
