# -*- coding: utf-8 -*-
"""링크인바이오 페이지.

인스타그램·틱톡은 캡션에 링크를 걸 수 없고 프로필 링크 한 개만 허용한다.
영상마다 상품이 다르므로, 프로필 링크는 이 페이지로 보내고 여기서 최신 상품들을
각자의 추적 링크(/r/<code>)로 연결한다. 이 페이지가 없으면 인스타·틱톡 조회수는
클릭으로 이어지지 않는다.

외부 CSS·JS·폰트를 쓰지 않는다(모바일에서 빠르고, 차단될 여지가 없다).
"""

from __future__ import annotations

import html
import time
from typing import Dict, List, Optional

from . import compliance
from .config import Config
from .models import Product, source_label

STYLE = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; background:#0f1115; color:#e9ecf1; font:16px/1.5 -apple-system,
       BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif; }
.wrap { max-width:560px; margin:0 auto; padding:20px 16px 56px; }
.head { text-align:center; padding:14px 0 8px; }
.head h1 { margin:0; font-size:20px; letter-spacing:.02em; }
.head p { margin:6px 0 0; font-size:13px; color:#98a2b3; }
.notice { margin:14px 0 18px; padding:10px 12px; border-radius:10px; font-size:12.5px;
          background:#1b1f27; color:#b9c2d0; border:1px solid #262b35; }
.card { display:block; text-decoration:none; color:inherit; background:#161a21;
        border:1px solid #232833; border-radius:16px; overflow:hidden; margin-bottom:14px; }
.card:active { transform:scale(.995); }
.thumb { position:relative; width:100%; aspect-ratio:1/1; background:#1b1f27; overflow:hidden; }
.thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.badge { position:absolute; top:10px; left:10px; background:#e53935; color:#fff;
         font-size:13px; font-weight:700; padding:5px 9px; border-radius:8px; }
.rank { position:absolute; top:10px; right:10px; background:rgba(15,17,21,.82);
        color:#ffd166; font-size:12px; padding:5px 9px; border-radius:8px; }
.body { padding:13px 14px 15px; }
.title { font-size:15px; font-weight:600; margin:0 0 8px;
         display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
         overflow:hidden; }
.price { display:flex; align-items:baseline; gap:8px; }
.now { font-size:21px; font-weight:800; color:#ffd166; }
.was { font-size:13px; color:#7d8798; text-decoration:line-through; }
.meta { margin-top:8px; font-size:12px; color:#8b95a6; display:flex; gap:8px;
        flex-wrap:wrap; }
.cta { margin-top:12px; text-align:center; background:#ffd166; color:#151821;
       font-weight:700; padding:11px; border-radius:11px; font-size:15px; }
.empty { text-align:center; color:#8b95a6; padding:60px 0; font-size:14px; }
.foot { margin-top:26px; text-align:center; font-size:11.5px; color:#6f7889;
        line-height:1.7; }
"""


def _card(item: Dict, platform: str) -> str:
    p = Product.from_dict(item["product"])
    code = item["code"]
    esc = html.escape
    discount = (f'<span class="badge">{p.discount:.0f}% OFF</span>'
                if p.discount else "")
    rank = (f'<span class="rank">{esc(source_label(p.source))} 인기 {p.rank}위</span>'
            if p.rank else f'<span class="rank">{esc(source_label(p.source))}</span>')
    was = (f'<span class="was">{esc(p.price_text("", p.orig_price))}</span>'
           if p.orig_price > p.price > 0 else "")
    chips = [x for x in ([f"★ {p.rating:.1f}"] if p.rating else [])
             + ([f"후기 {p.reviews:,}개"] if p.reviews else [])
             + list(p.highlights[:2])]
    meta_html = ('<div class="meta">' + "".join(f"<span>{esc(c)}</span>" for c in chips)
                 + "</div>") if chips else ""
    # 상대 경로로 둔다 — 도메인이 무엇이든(로컬·운영·프록시 뒤) 그대로 동작한다
    img = f"/img/{esc(p.key)}.jpg"
    query = f"?p={esc(platform)}" if platform else ""
    return f"""
    <a class="card" href="/r/{esc(code)}{query}" rel="nofollow sponsored noopener"
       target="_blank">
      <div class="thumb">{discount}{rank}<img src="{img}" alt="" loading="lazy"></div>
      <div class="body">
        <p class="title">{esc(p.title)}</p>
        <div class="price"><span class="now">{esc(p.price_text())}</span>{was}</div>
        {meta_html}
        <div class="cta">{esc(source_label(p.source))}에서 가격 확인 →</div>
      </div>
    </a>"""


def render(items: List[Dict], cfg: Config, base: str = "",
           platform: str = "") -> str:
    """상품 카드 목록 페이지 HTML (링크는 모두 상대 경로)."""
    esc = html.escape
    title = cfg.watermark or "SHOPREEL"
    cards = "".join(_card(item, platform) for item in items) or \
        '<p class="empty">아직 등록된 상품이 없습니다.</p>'
    updated = time.strftime("%Y-%m-%d %H:%M")
    note = compliance.disclosure(cfg.lang, cfg.disclosure)

    return f"""<!doctype html>
<html lang="{esc(cfg.lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>{esc(title)} · 오늘의 추천</title>
<style>{STYLE}</style>
</head><body><div class="wrap">
<div class="head">
  <h1>{esc(title)}</h1>
  <p>영상에 나온 상품 · {updated} 기준</p>
</div>
<div class="notice">{esc(note)}</div>
{cards}
<div class="foot">
  가격과 재고는 판매처 사정으로 바뀔 수 있습니다. 최종 가격은 판매처에서 확인하세요.<br>
  {esc(note)}
</div>
</div></body></html>"""
