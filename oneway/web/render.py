# -*- coding: utf-8 -*-
"""HTML 렌더링.

템플릿 엔진 의존성 없이 표준 라이브러리만으로 만든다. 페이지 수가 적고
구조가 단순해서 이 편이 배우기도 쉽고 정적 빌드도 간단하다.

모든 페이지는 다음을 갖는다.
  · 검색 결과용 <title> / description / keywords / canonical
  · 공유용 Open Graph 태그
  · 구조화 데이터(JSON-LD) — 검색엔진이 내용을 이해하게 한다
"""

from __future__ import annotations

import html
import json
from typing import Dict, Iterable, List, Optional, Sequence

from .. import BRAND, BRAND_EN, TAGLINE
from ..config import Config
from ..content import daily as daily_mod
from ..content import entries as entries_mod
from ..content import fifty, pages as pages_mod, verses as verses_mod

E = html.escape


def _meta(cfg: Config, title: str, desc: str, path: str,
          keywords: Sequence[str] = (), jsonld: Optional[Dict] = None) -> str:
    url = cfg.site_url.rstrip("/") + path
    full_title = title if title.endswith(BRAND) else f"{title} | {BRAND} ONE WAY"
    out = [
        f"<title>{E(full_title)}</title>",
        f'<meta name="description" content="{E(desc)}">',
        f'<link rel="canonical" href="{E(url)}">',
        '<meta name="robots" content="index,follow">',
        f'<meta property="og:site_name" content="{E(cfg.site_name)}">',
        f'<meta property="og:title" content="{E(full_title)}">',
        f'<meta property="og:description" content="{E(desc)}">',
        f'<meta property="og:url" content="{E(url)}">',
        '<meta property="og:type" content="article">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if keywords:
        out.append(f'<meta name="keywords" content="{E(", ".join(keywords))}">')
    if cfg.naver_verify:
        out.append(f'<meta name="naver-site-verification" content="{E(cfg.naver_verify)}">')
    if cfg.google_verify:
        out.append(f'<meta name="google-site-verification" content="{E(cfg.google_verify)}">')
    if jsonld:
        out.append('<script type="application/ld+json">'
                   + json.dumps(jsonld, ensure_ascii=False) + "</script>")
    return "\n".join(out)


NAV = [
    ("/today", "하루 3분"),
    ("/counsel", "AI 상담"),
    ("/believe", "50가지"),
    ("/left-church", "교회를 떠났습니다"),
    ("/pray", "함께 기도"),
    ("/about", "소개"),
]


def layout(cfg: Config, *, title: str, desc: str, path: str, body: str,
           keywords: Sequence[str] = (), jsonld: Optional[Dict] = None,
           hero: str = "") -> str:
    nav = "".join(f'<a href="{u}">{E(l)}</a>' for u, l in NAV)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{_meta(cfg, title, desc, path, keywords, jsonld)}
<link rel="stylesheet" href="/static/style.css">
{cfg.analytics_snippet}
</head>
<body>
<header class="top">
  <a class="brand" href="/">
    <span class="brand-ko">{E(BRAND)}</span>
    <span class="brand-en">{E(BRAND_EN)}</span>
  </a>
  <nav class="nav">{nav}</nav>
</header>
{hero}
<main class="wrap">
{body}
</main>
<footer class="foot">
  <p class="tagline">{E(TAGLINE)}</p>
  <p class="small">이곳은 특정 교파로 데려가기 위한 곳이 아닙니다.
     신앙에 질문이 있는 사람이라면 누구나 들어올 수 있습니다.</p>
  <p class="small">성경 본문은 번역본을 그대로 싣지 않고 <b>어디를 펴야 하는지</b>만
     알려 드립니다. 직접 펴서 읽어 보십시오.</p>
  <p class="small">힘든 순간에는 혼자 견디지 마십시오 —
     자살예방 상담전화 <b>109</b> · 정신건강 상담전화 <b>1577-0199</b> (24시간)</p>
  <p class="small">&copy; {E(BRAND)} {E(BRAND_EN)}</p>
</footer>
<script src="/static/app.js"></script>
</body>
</html>"""


def _p(paragraphs: Iterable[str]) -> str:
    return "".join(f"<p>{E(x)}</p>" for x in paragraphs)


def _ask_buttons(asks: Sequence[str]) -> str:
    if not asks:
        return ""
    btns = "".join(
        f'<a class="ask" href="/counsel?q={html.escape(a, quote=True)}">{E(a)}</a>'
        for a in asks)
    return f'<section class="card asks"><h2>이런 질문을 해 보셔도 됩니다</h2>' \
           f'<div class="ask-list">{btns}</div></section>'


def _verse_box(v: verses_mod.Verse) -> str:
    return (f'<aside class="verse"><div class="ref">{E(v.ref)}'
            f'<span class="alt">개신교 표기 · {E(v.ref_protestant)}</span></div>'
            f'<p>{E(v.gist)}</p>'
            f'<p class="small">번역문은 싣지 않습니다. 직접 펴서 읽어 보십시오.</p></aside>')


# ────────────────────────────────────────────────────────── 홈
def home(cfg: Config, card: daily_mod.Daily) -> str:
    gates = "".join(
        f'<a class="gate" href="{e.url}"><span class="icon">{e.icon}</span>'
        f'<b>{E(e.label)}</b><span class="g-desc">{E(e.hero)}</span></a>'
        for e in entries_mod.ENTRIES)

    hero = f"""<section class="hero">
  <p class="eyebrow">당신의 마음은 지금 무엇을 찾고 있습니까?</p>
  <ul class="hero-q">
    <li>지쳤습니까?</li><li>외롭습니까?</li><li>믿음에 질문이 있습니까?</li>
    <li>교회를 떠났습니까?</li><li>다시 하느님을 찾고 있습니까?</li>
  </ul>
  <h1>{E(BRAND)}</h1>
  <p class="tag">{E(TAGLINE)}</p>
  <p class="lead">질문하고, 기도하고, 사랑을 실천하며 함께 걷습니다.</p>
  <div class="cta">
    <a class="btn primary" href="/counsel">마음을 이야기하기</a>
    <a class="btn" href="/today">오늘의 3분</a>
    <a class="btn" href="/believe">함께 믿는 50가지</a>
    <a class="btn" href="/left-church">나는 교회를 떠났습니다</a>
  </div>
</section>"""

    body = f"""
<section class="card today-peek">
  <h2>오늘의 3분</h2>
  <p class="muted">{E(card.day)} · 하루에 하나만 드립니다.</p>
  <div class="grid4">
    <div><b>오늘의 말씀</b><p>{E(card.verse_ref)}</p></div>
    <div><b>오늘의 질문</b><p>{E(card.question)}</p></div>
    <div><b>오늘의 기도</b><p>{E(card.prayer)}</p></div>
    <div><b>오늘의 사랑</b><p>{E(card.love)}</p></div>
  </div>
  <a class="btn primary" href="/today">3분 시작하기</a>
</section>

<section>
  <h2 class="section-title">어디서부터 이야기할까요</h2>
  <p class="muted">메뉴가 아니라 마음으로 들어오시면 됩니다.</p>
  <div class="gates">{gates}</div>
</section>

<section class="card">
  <h2>이곳은 이런 곳입니다</h2>
  <p>먼저 듣습니다. 설교는 나중입니다.</p>
  <p>질문을 환영합니다. 질문했다고 믿음이 약하다고 말하지 않습니다.</p>
  <p>가톨릭과 개신교가 함께 고백할 수 있는 것을 먼저 이야기합니다.</p>
  <p><a href="/about">더 알아보기 →</a></p>
</section>
"""
    jsonld = {
        "@context": "https://schema.org", "@type": "WebSite",
        "name": cfg.site_name, "url": cfg.site_url,
        "description": "신앙에 질문이 있는 사람이라면 누구나 들어올 수 있는 공간.",
        "inLanguage": "ko",
    }
    return layout(cfg, title=f"{BRAND} — {TAGLINE}",
                  desc="지쳤습니까? 외롭습니까? 믿음에 질문이 있습니까? "
                       "먼저 듣고, 함께 질문하고, 매일 3분을 드립니다.",
                  path="/", body=body, hero=hero, jsonld=jsonld,
                  keywords=("신앙 상담", "마음이 힘들 때", "기도", "성경", "가톨릭 개신교"))


# ────────────────────────────────────────────────────────── 하루 3분
def today(cfg: Config, card: daily_mod.Daily) -> str:
    body = f"""
<article class="three">
  <p class="muted">{E(card.day)} · {card.index % 50 + 1}번째 이야기</p>
  <h1>오늘의 3분</h1>

  <section class="step-card"><span class="num">①</span>
    <h2>오늘의 말씀</h2>
    <p class="ref">{E(card.verse_ref)} <span class="alt">({E(card.verse_ref_protestant)})</span></p>
    <p>{E(card.verse_gist)}</p>
    <p class="small">번역문은 싣지 않습니다. 성경을 직접 펴서 읽어 보십시오.</p>
  </section>

  <section class="step-card"><span class="num">②</span>
    <h2>오늘의 질문</h2>
    <p class="big">{E(card.question)}</p>
    <textarea id="answer" rows="3" placeholder="여기에 적어 보셔도 됩니다. 이 글은 저장되지 않습니다."></textarea>
  </section>

  <section class="step-card"><span class="num">③</span>
    <h2>오늘의 기도</h2>
    <p class="big">{E(card.prayer)}</p>
    <p class="small">30초면 충분합니다. 소리 내어 한 번 말해 보십시오.</p>
  </section>

  <section class="step-card"><span class="num">④</span>
    <h2>오늘의 사랑</h2>
    <p class="big">{E(card.love)}</p>
    <button class="btn primary" data-practice>오늘 실천했습니다</button>
    <p class="small" id="practice-msg"></p>
  </section>

  <section class="card">
    <h2>이번 주의 질문</h2>
    <p class="big">{E(card.weekly_question)}</p>
  </section>

  <section class="card next">
    <p>{E(card.tomorrow_teaser)}</p>
    <p class="big">내일 다시 만나요.</p>
    <p><a class="btn" href="{card.belief_url}">오늘 이야기 더 읽기 — {E(card.belief_title)}</a></p>
    <p><a class="btn" href="/counsel">마음을 더 이야기하기</a></p>
  </section>
  <div id="streak" class="streak"></div>
</article>"""
    return layout(cfg, title=f"오늘의 3분 — {card.day}",
                  desc=f"오늘의 말씀·질문·기도·사랑 한 걸음. {card.question}",
                  path="/today", body=body,
                  keywords=("오늘의 말씀", "묵상", "짧은 기도", "하루 3분"))


# ────────────────────────────────────────────────────────── 50가지
def believe_index(cfg: Config) -> str:
    out: List[str] = []
    for g in fifty.GROUPS:
        items = "".join(
            f'<li><a href="{b.url}"><span class="no">{b.no:02d}</span>'
            f'<span class="t">{E(b.title)}</span>'
            f'<span class="s">{E(b.seo_title)}</span></a></li>'
            for b in fifty.BELIEFS if g.first <= b.no <= g.last)
        out.append(f'<section class="group"><h2>{g.no}. {E(g.name)}</h2>'
                   f'<p class="muted">{E(g.subtitle)}</p>'
                   f'<ol class="belief-list">{items}</ol></section>')
    jsonld = {
        "@context": "https://schema.org", "@type": "ItemList",
        "name": "우리가 함께 믿는 50가지",
        "itemListElement": [
            {"@type": "ListItem", "position": b.no, "name": b.title,
             "url": cfg.site_url.rstrip("/") + b.url} for b in fifty.BELIEFS],
    }
    body = ('<h1>우리가 함께 믿는 50가지</h1>'
            '<p class="lead">가톨릭과 개신교가 <b>함께</b> 고백할 수 있는 것을 먼저 세었습니다. '
            '다른 점은 41~50번에서 정직하게 다룹니다.</p>'
            '<p class="muted">하루에 하나씩 읽으면 50일입니다. 순서대로 읽지 않아도 됩니다.</p>'
            + "".join(out))
    return layout(cfg, title="우리가 함께 믿는 50가지",
                  desc="가톨릭과 개신교가 함께 고백할 수 있는 50가지. "
                       "하루에 하나씩 읽으면 50일입니다.",
                  path="/believe", body=body, jsonld=jsonld,
                  keywords=("기독교 신앙", "가톨릭 개신교 공통", "신앙 고백", "묵상 50일"))


def belief_page(cfg: Config, b: fifty.Belief) -> str:
    vs = "".join(_verse_box(verses_mod.get(k)) for k in b.verses)
    prev_b = fifty.get(b.no - 1) if b.no > 1 else None
    next_b = fifty.get(b.no + 1) if b.no < 50 else None
    nav = []
    if prev_b:
        nav.append(f'<a href="{prev_b.url}">← {prev_b.no:02d}. {E(prev_b.title)}</a>')
    if next_b:
        nav.append(f'<a href="{next_b.url}">{next_b.no:02d}. {E(next_b.title)} →</a>')

    asks = _ask_buttons((b.question,))
    jsonld = {
        "@context": "https://schema.org", "@type": "Article",
        "headline": b.seo_title, "description": b.description,
        "inLanguage": "ko", "articleSection": b.group.name,
        "url": cfg.site_url.rstrip("/") + b.url,
        "publisher": {"@type": "Organization", "name": cfg.site_name},
    }
    body = f"""
<article class="belief" data-belief="{b.no}">
  <p class="muted">{b.group.no}. {E(b.group.name)} · {b.no:02d} / 50</p>
  <h1>{E(b.title)}</h1>
  <p class="lead">{E(b.description)}</p>
  {_p(b.body)}
  {vs}
  <section class="step-card"><h2>오늘의 질문</h2><p class="big">{E(b.question)}</p></section>
  <section class="step-card"><h2>30초 기도</h2><p class="big">{E(b.prayer)}</p></section>
  <section class="step-card"><h2>오늘의 한 걸음</h2><p class="big">{E(b.practice)}</p></section>
  {asks}
  <nav class="pager">{"".join(nav)}</nav>
  <p><a class="btn" href="/believe">50가지 전체 보기</a>
     <a class="btn primary" href="/counsel?q={html.escape(b.question, quote=True)}">이 질문을 상담사와 이야기하기</a></p>
</article>"""
    return layout(cfg, title=b.seo_title, desc=b.description, path=b.url,
                  body=body, keywords=b.keywords, jsonld=jsonld)


# ────────────────────────────────────────────────────────── 입구
def gate_page(cfg: Config, e: entries_mod.Entry) -> str:
    beliefs = "".join(
        f'<li><a href="{b.url}"><span class="no">{b.no:02d}</span>'
        f'<span class="t">{E(b.title)}</span></a></li>' for b in e.belief_items)
    hero = f"""<section class="hero small-hero">
  <p class="eyebrow">{e.icon} {E(e.label)}</p>
  <h1>{E(e.hero)}</h1>
</section>"""
    body = f"""
<section class="card">{_p(e.intro)}</section>
{_ask_buttons(e.asks)}
<section>
  <h2 class="section-title">함께 읽어 보세요</h2>
  <ol class="belief-list">{beliefs}</ol>
</section>
<section class="card next">
  <p><a class="btn primary" href="/counsel">지금 마음을 이야기하기</a>
     <a class="btn" href="/today">오늘의 3분</a></p>
</section>"""
    return layout(cfg, title=e.seo_title, desc=e.description, path=e.url,
                  body=body, hero=hero, keywords=e.keywords)


# ────────────────────────────────────────────────────────── 고정 페이지
def static_page(cfg: Config, p: pages_mod.Page) -> str:
    blocks: List[str] = []
    for heading, paras in p.body:
        if heading:
            blocks.append(f'<section class="card"><h2>{E(heading)}</h2>{_p(paras)}</section>')
        else:
            blocks.append(f'<section class="card lead-block">{_p(paras)}</section>')
    journey = ""
    if p.slug in ("traditions", "about"):
        steps = "".join(
            f'<li><a href="{u}"><b>{E(s)}</b><span>{E(t)}</span></a></li>'
            for s, t, u in pages_mod.JOURNEY)
        journey = f'<section class="card"><h2>알아보는 순서</h2><ol class="journey">{steps}</ol></section>'
    hero = f'<section class="hero small-hero"><h1>{E(p.hero)}</h1></section>'
    body = "".join(blocks) + _ask_buttons(p.asks) + journey + f"""
<section class="card next">
  <p><a class="btn primary" href="/counsel">이야기 나누기</a>
     <a class="btn" href="/today">오늘의 3분</a></p>
</section>"""
    return layout(cfg, title=p.seo_title, desc=p.description, path=p.url,
                  body=body, hero=hero, keywords=p.keywords)


# ────────────────────────────────────────────────────────── AI 상담
def counsel_page(cfg: Config, prefill: str = "") -> str:
    chips = "".join(
        f'<button class="ask" data-q="{html.escape(a, quote=True)}">{E(a)}</button>'
        for e in entries_mod.ENTRIES for a in e.asks[:1])
    body = f"""
<div class="chat" data-prefill="{html.escape(prefill, quote=True)}">
  <h1>마음을 이야기해 보세요</h1>
  <p class="lead">정리하지 않아도 됩니다. 한 문장이면 충분합니다.</p>
  <div class="notice">
    <p>이 상담사는 사람이 아니라 <b>AI</b>입니다. 숨기지 않습니다.
       사제·목회자·의사·심리상담사의 상담을 대신하지 않습니다.</p>
    <p>이름·연락처를 묻지 않습니다. 대화는 익명으로 처리됩니다.</p>
    <p>지금 많이 위험하다고 느끼신다면 먼저 <b>109</b>(자살예방 상담전화)로 연락하십시오. 24시간 무료입니다.</p>
  </div>
  <div class="chips">{chips}</div>
  <div id="log" class="log" aria-live="polite"></div>
  <form id="chat-form" class="chat-form">
    <textarea id="msg" rows="2" placeholder="지금 마음을 한 문장으로 적어 보세요." required></textarea>
    <button class="btn primary" type="submit">보내기</button>
  </form>
  <div id="streak" class="streak"></div>
</div>"""
    return layout(cfg, title="AI 상담사에게 마음을 이야기하기",
                  desc="지치고 외롭고 믿음에 질문이 있을 때. 먼저 듣고, 함께 질문하고, "
                       "오늘 할 수 있는 한 걸음을 찾습니다.",
                  path="/counsel", body=body,
                  keywords=("신앙 상담", "마음이 힘들 때", "고민 상담", "기도 요청"))


# ────────────────────────────────────────────────────────── 함께 기도
def pray_page(cfg: Config, count_today: int = 0) -> str:
    body = f"""
<h1>함께 기도</h1>
<p class="lead">이름을 밝히지 않아도 됩니다. 한 줄이면 충분합니다.</p>
<p class="muted">오늘 이 자리에 <b id="pray-count">{count_today}</b>개의 지향이 놓였습니다.</p>
<div class="notice">
  <p>맡기신 지향은 <b>다른 사람에게 공개되지 않습니다.</b>
     당신의 브라우저와 연결된 익명 기록으로만 남습니다.</p>
  <p>다음에 오시면 상담사가 그 기도를 기억하고 먼저 물어볼 것입니다.</p>
</div>
<form id="pray-form" class="chat-form">
  <textarea id="intention" rows="3" placeholder="예) 아버지 수술이 잘 되게 해 주십시오." required></textarea>
  <button class="btn primary" type="submit">맡기기</button>
</form>
<div id="my-intentions" class="log"></div>
<section class="card next">
  <p><a class="btn" href="/today">오늘의 3분</a>
     <a class="btn" href="/counsel">마음을 이야기하기</a></p>
</section>"""
    return layout(cfg, title="함께 기도 — 기도 지향 맡기기",
                  desc="혼자 기도하기 힘든 날, 한 줄만 맡겨 두십시오. 공개되지 않습니다.",
                  path="/pray", body=body,
                  keywords=("기도 요청", "중보기도", "기도 지향"))


def not_found(cfg: Config) -> str:
    body = ('<h1>여기에는 아무것도 없습니다</h1>'
            '<p class="lead">길을 잘못 드셨어도 괜찮습니다.</p>'
            '<p><a class="btn primary" href="/">처음으로</a> '
            '<a class="btn" href="/today">오늘의 3분</a> '
            '<a class="btn" href="/counsel">마음을 이야기하기</a></p>')
    return layout(cfg, title="찾을 수 없는 페이지", desc="요청하신 페이지가 없습니다.",
                  path="/404", body=body)
