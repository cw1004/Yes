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
from ..content import fifty, pages as pages_mod
from ..content import paths as paths_mod
from ..content import verses as verses_mod

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


# 1차 메뉴에는 신앙 색을 띈 항목을 두지 않는다.
# 처음 온 사람이 메뉴만 보고도 "여기는 교회 사이트구나" 하면 거기서 끝난다.
NAV = [
    ("/counsel", "이야기하기"),
    ("/today", "하루 3분"),
    ("/gate/heart", "마음"),
    ("/about", "소개"),
]

# 깊은 곳으로 가는 문. 페이지 아래쪽에만 조용히 둔다.
DEEPER = [
    ("/believe", "우리가 함께 믿는 50가지"),
    ("/left-church", "나는 교회를 떠났습니다"),
    ("/pray", "함께 기도"),
    ("/traditions", "각 전통을 직접 알아보기"),
]


def layout(cfg: Config, *, title: str, desc: str, path: str, body: str,
           keywords: Sequence[str] = (), jsonld: Optional[Dict] = None,
           hero: str = "") -> str:
    nav = "".join(f'<a href="{u}">{E(l)}</a>' for u, l in NAV)
    deeper = "".join(f'<a href="{u}">{E(l)}</a>' for u, l in DEEPER)
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
  <p class="small">여기서는 먼저 듣습니다. 누구든 오셔도 됩니다.</p>
  <p class="small">힘든 순간에는 혼자 견디지 마십시오 —
     자살예방 상담전화 <b>109</b> · 정신건강 상담전화 <b>1577-0199</b> (24시간)</p>
  <nav class="deeper">{deeper}</nav>
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


def _verse_box(v: verses_mod.Verse, label_traditions: bool = False) -> str:
    """성경 대목 상자.

    표기를 두 가지 다 보여 주되 **어느 교파 표기인지 써 붙이지 않는다**.
    라벨을 붙이는 순간 그 페이지는 교파 이야기가 된다.
    교파를 직접 다루는 페이지(41~50번)에서만 라벨을 붙인다.
    """
    ref = v.both if label_traditions else v.neutral
    return (f'<aside class="verse"><div class="ref">{E(ref)}</div>'
            f'<p>{E(v.gist)}</p>'
            f'<p class="small">번역문은 싣지 않습니다. 직접 펴서 읽어 보십시오.</p></aside>')


# ────────────────────────────────────────────────────────── 홈
# 처음 화면에서는 교파도, 신앙 언어도 쓰지 않는다.
# 여기 오는 사람은 설득당하러 오지 않는다. 힘들어서 온다.
SURFACE_GATES = ("heart", "family", "love", "hope")
DEEPER_GATES = ("faith", "bible", "church")


def home(cfg: Config, card: daily_mod.Daily) -> str:
    def gate_card(e) -> str:
        return (f'<a class="gate" href="{e.url}"><span class="icon">{e.icon}</span>'
                f'<b>{E(e.label)}</b><span class="g-desc">{E(e.hero)}</span></a>')

    gates = "".join(gate_card(entries_mod.get(k)) for k in SURFACE_GATES)
    journey = paths_mod.PATHS[0]
    deeper = "".join(
        f'<a href="{entries_mod.get(k).url}">{E(entries_mod.get(k).title)}</a>'
        for k in DEEPER_GATES)

    hero = f"""<section class="hero">
  <p class="eyebrow">오늘 마음이 어떠십니까?</p>
  <h1>혼자 두지 않겠습니다</h1>
  <p class="lead">지쳤거나, 외롭거나, 답이 안 보이거나.<br>
     정리하지 않으셔도 됩니다. 한 문장이면 충분합니다.</p>
  <div class="cta">
    <a class="btn primary big" href="/counsel">지금 이야기하기</a>
    <a class="btn" href="/today">오늘의 3분</a>
  </div>
  <p class="small quiet">이름도 연락처도 묻지 않습니다. 무료입니다.</p>
</section>"""

    body = f"""
<section>
  <h2 class="section-title">어떤 이야기든 괜찮습니다</h2>
  <div class="gates">{gates}</div>
</section>

<section class="card journey-peek">
  <p class="muted">{journey.days}일 · 하루 3분</p>
  <h2>{E(journey.hero)}</h2>
  <p>전쟁, 지진, 기후. 요즘 그런 생각이 드는 분이 정말 많습니다.</p>
  <p class="muted">한 번에 정리되지 않는 이야기라서 {journey.days}일로 나눴습니다.
     중간에 멈추셔도 됩니다.</p>
  <a class="btn primary" href="{journey.url}">첫 걸음 보기</a>
</section>

<section class="card today-peek">
  <h2>오늘의 3분</h2>
  <p class="muted">하루에 딱 하나만 드립니다. 3분이면 끝납니다.</p>
  <div class="grid4">
    <div><b>오늘의 질문</b><p>{E(card.question)}</p></div>
    <div><b>오늘의 한 걸음</b><p>{E(card.love)}</p></div>
  </div>
  <a class="btn primary" href="/today">3분 시작하기</a>
</section>

<section class="card">
  <h2>이곳이 하는 일</h2>
  <p>먼저 듣습니다. 조언은 그 다음입니다.</p>
  <p>판단하지 않습니다. 무엇을 믿든, 믿지 않든 상관없습니다.</p>
  <p>해결해 드리겠다고 약속하지 않습니다. 대신 밤에도 여기 있습니다.</p>
  <p><a href="/about">이곳에 대하여 →</a></p>
</section>

<section class="card quiet-links">
  <h2>더 깊은 질문이 있으시다면</h2>
  <p class="muted">삶의 의미나 믿음에 대한 질문을 오래 들여다본 글들도 있습니다.
     필요하실 때 열어 보셔도 됩니다.</p>
  <div class="links">{deeper}</div>
</section>
"""
    jsonld = {
        "@context": "https://schema.org", "@type": "WebSite",
        "name": cfg.site_name, "url": cfg.site_url,
        "description": "지치고 외롭고 답이 안 보일 때, 먼저 듣는 곳.",
        "inLanguage": "ko",
    }
    return layout(cfg, title="혼자 두지 않겠습니다",
                  desc="지쳤습니까? 외롭습니까? 답이 안 보이십니까? "
                       "이름도 연락처도 묻지 않습니다. 먼저 듣겠습니다.",
                  path="/", body=body, hero=hero, jsonld=jsonld,
                  keywords=("마음이 힘들 때", "고민 상담", "무료 상담", "외로움",
                            "번아웃", "익명 상담"))


# ────────────────────────────────────────────────────────── 하루 3분
def today(cfg: Config, card: daily_mod.Daily, faith: bool = False) -> str:
    """하루 3분.

    ``faith`` 는 방문자가 스스로 연 깊이다(counselor/depth.py).
    아직 열지 않은 사람에게는 말씀·기도 칸을 아예 보여 주지 않는다.
    같은 페이지가 사람에 따라 다르게 보인다.
    """
    blocks = [
        f'<section class="step-card"><span class="num">①</span>'
        f'<h2>오늘의 질문</h2><p class="big">{E(card.question)}</p>'
        f'<textarea id="answer" rows="3" placeholder="여기에 적어 보셔도 됩니다.'
        f' 이 글은 저장되지 않습니다."></textarea></section>'
    ]

    if faith:
        blocks.insert(0,
            f'<section class="step-card"><span class="num">·</span>'
            f'<h2>오늘의 말씀</h2>'
            f'<p class="ref">{E(card.verse_ref)}'
            f'<span class="alt">{E(card.verse_ref_protestant)}</span></p>'
            f'<p>{E(card.verse_gist)}</p>'
            f'<p class="small">번역문은 싣지 않습니다. 직접 펴서 읽어 보십시오.</p>'
            f'</section>')
        blocks.append(
            f'<section class="step-card"><span class="num">·</span>'
            f'<h2>오늘의 기도</h2><p class="big">{E(card.prayer)}</p>'
            f'<p class="small">30초면 충분합니다.</p></section>')

    blocks.append(
        f'<section class="step-card"><span class="num">②</span>'
        f'<h2>오늘의 한 걸음</h2><p class="big">{E(card.love)}</p>'
        f'<button class="btn primary" data-practice>오늘 했습니다</button>'
        f'<p class="small" id="practice-msg"></p></section>')

    tail = (f'<p><a class="btn" href="{card.belief_url}">오늘 이야기 더 읽기 — '
            f'{E(card.belief_title)}</a></p>') if faith else ""

    body = f"""
<article class="three">
  <p class="muted">{E(card.day)}</p>
  <h1>오늘의 3분</h1>
  {"".join(blocks)}

  <section class="card">
    <h2>이번 주의 질문</h2>
    <p class="big">{E(card.weekly_question)}</p>
  </section>

  <section class="card next">
    <p class="big">내일 또 오셔도 됩니다.</p>
    {tail}
    <p><a class="btn primary" href="/counsel">마음을 더 이야기하기</a></p>
  </section>
  <div id="streak" class="streak"></div>
</article>"""
    return layout(cfg, title=f"오늘의 3분 — {card.day}",
                  desc=f"질문 하나, 한 걸음 하나. 3분이면 끝납니다. {card.question}",
                  path="/today", body=body,
                  keywords=("오늘의 질문", "하루 3분", "마음 돌보기", "자기 성찰"))


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
    vs = "".join(_verse_box(verses_mod.get(k), b.no >= 41) for k in b.verses)
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


# ────────────────────────────────────────────────────────── 상담
def counsel_page(cfg: Config, prefill: str = "") -> str:
    """상담 화면.

    예전에는 여기 맨 위에 "이 상담사는 AI입니다"를 세 문단 띄웠다.
    말을 걸기도 전에 읽는 고지문은 사람을 돌려보낸다. 그래서 내렸다.

    대신 (1) 입력창 아래 조용한 한 줄, (2) 「이곳에 대하여」 페이지,
    (3) 물어보면 즉시 정직하게 답하는 것 — 세 가지로 남긴다.
    사람인 척하지는 않는다. 다만 먼저 떠들지도 않는다.
    """
    chips = "".join(
        f'<button class="ask" data-q="{html.escape(a, quote=True)}">{E(a)}</button>'
        for k in ("heart", "family", "love", "hope")
        for a in entries_mod.get(k).asks[:1])
    body = f"""
<div class="chat" data-prefill="{html.escape(prefill, quote=True)}">
  <h1>오늘 어떤 하루였습니까</h1>
  <p class="lead">정리하지 않으셔도 됩니다. 한 문장이면 충분합니다.</p>
  <div class="chips">{chips}</div>
  <div id="log" class="log" aria-live="polite"></div>
  <form id="chat-form" class="chat-form">
    <textarea id="msg" rows="2" placeholder="지금 마음을 한 문장으로 적어 보세요." required></textarea>
    <button class="btn primary" type="submit">보내기</button>
  </form>
  <p class="small quiet">이름도 연락처도 묻지 않습니다.
     듣는 쪽은 사람이 아닙니다 — <a href="/about">자세히</a>.
     위급하다고 느끼시면 <b>109</b>(24시간, 무료)로 연락하십시오.</p>
  <div id="streak" class="streak"></div>
</div>"""
    return layout(cfg, title="지금 마음을 이야기해 보세요",
                  desc="지치고 외롭고 답이 안 보일 때. 이름도 연락처도 묻지 않습니다. "
                       "먼저 듣고, 함께 생각하고, 오늘 할 수 있는 한 걸음을 찾습니다.",
                  path="/counsel", body=body,
                  keywords=("고민 상담", "무료 상담", "익명 상담", "마음이 힘들 때",
                            "심리 상담", "혼자 힘들 때"))


# ────────────────────────────────────────────────────────── 여정
# 한 번에 정리되지 않는 고민은 여러 날에 걸쳐 간다.
# 걸음마다 깊이가 깊어지고, 각 걸음은 다음 걸음을 예고해 다시 오게 만든다.
def path_index(cfg: Config, path: paths_mod.Path, walked: int = 0) -> str:
    def row(st: paths_mod.Step) -> str:
        done = "done" if st.no <= walked else ""
        nxt = "next" if st.no == walked + 1 else ""
        mark = "✓" if st.no <= walked else str(st.no)
        deep = ("", " · 오래된 이야기", " · 신앙의 언어")[st.depth]
        return (f'<li class="{done} {nxt}"><a href="{path.step_url(st.no)}">'
                f'<span class="no">{mark}</span>'
                f'<span class="t">{E(st.title)}</span>'
                f'<span class="s">{E(st.description)}</span>'
                f'<span class="muted">{st.no}번째 걸음{E(deep)}</span></a></li>')

    steps = "".join(row(st) for st in path.steps)
    start = walked + 1 if walked < path.days else path.days
    label = "이어서 걷기" if walked else "첫 걸음 시작하기"
    hero = (f'<section class="hero small-hero"><p class="eyebrow">'
            f'하루 한 걸음 · {path.days}일</p><h1>{E(path.hero)}</h1></section>')
    jsonld = {
        "@context": "https://schema.org", "@type": "HowTo",
        "name": path.title, "description": path.description,
        "totalTime": f"P{path.days}D", "inLanguage": "ko",
        "step": [{"@type": "HowToStep", "position": st.no, "name": st.title,
                  "url": cfg.site_url.rstrip("/") + path.step_url(st.no)}
                 for st in path.steps],
    }
    body = f"""
<section class="card lead-block">{_p(path.intro)}</section>
<p><a class="btn primary big" href="{path.step_url(start)}">{E(label)}</a></p>
<ol class="path-list">{steps}</ol>
<section class="card next">
  <p>지금 바로 이야기하고 싶으시면 그렇게 하셔도 됩니다.</p>
  <p><a class="btn primary" href="/counsel">지금 이야기하기</a>
     <a class="btn" href="/today">오늘의 3분</a></p>
</section>"""
    return layout(cfg, title=path.seo_title, desc=path.description,
                  path=path.url, body=body, hero=hero,
                  keywords=path.keywords, jsonld=jsonld)


def path_step(cfg: Config, path: paths_mod.Path, st: paths_mod.Step) -> str:
    paras = "".join(
        f'<p>{E(x)}</p>' if "\n" not in x
        else '<p>' + "<br>".join(E(line) for line in x.split("\n")) + '</p>'
        for x in st.body)

    verses = ""
    if st.verses:
        verses = "".join(_verse_box(verses_mod.get(k)) for k in st.verses)

    prayer = ""
    if st.prayer:
        prayer = (f'<section class="step-card"><h2>30초 기도</h2>'
                  f'<p class="big">{E(st.prayer)}</p></section>')

    nxt = ""
    if st.no < path.days:
        nxt = (f'<p class="big">{E(st.teaser)}</p>'
               f'<p><a class="btn primary" href="{path.step_url(st.no + 1)}">'
               f'다음 걸음 — {E(path.step(st.no + 1).title)}</a></p>'
               f'<p class="small">내일 오셔도 됩니다. 오늘은 여기까지가 좋습니다.</p>')
    else:
        nxt = (f'<p class="big">{E(st.teaser)}</p>'
               f'<p><a class="btn primary" href="/today">오늘의 3분</a>'
               f'<a class="btn" href="/counsel">더 이야기하기</a></p>')

    prev_link = (f'<a href="{path.step_url(st.no - 1)}">← {st.no - 1}번째 걸음</a>'
                 if st.no > 1 else f'<a href="{path.url}">← 전체 보기</a>')
    next_link = (f'<a href="{path.step_url(st.no + 1)}">{st.no + 1}번째 걸음 →</a>'
                 if st.no < path.days else "")

    jsonld = {
        "@context": "https://schema.org", "@type": "Article",
        "headline": st.seo_title, "description": st.description,
        "inLanguage": "ko", "isPartOf": {"@type": "HowTo", "name": path.title},
        "url": cfg.site_url.rstrip("/") + path.step_url(st.no),
    }
    body = f"""
<article class="path-step" data-path="{E(path.slug)}" data-step="{st.no}">
  <p class="muted"><a href="{path.url}">{E(path.title)}</a> ·
     {st.no} / {path.days}번째 걸음</p>
  <div class="bar"><i style="width:{int(st.no / path.days * 100)}%"></i></div>
  <h1>{E(st.title)}</h1>
  {paras}
  {verses}
  <section class="step-card"><h2>오늘의 질문</h2>
    <p class="big">{E(st.question)}</p>
    <textarea rows="3" placeholder="적어 보셔도 됩니다. 저장되지 않습니다."></textarea>
  </section>
  <section class="step-card"><h2>오늘의 한 걸음</h2>
    <p class="big">{E(st.action)}</p>
  </section>
  {prayer}
  <p class="closing-line">{E(st.closing)}</p>
  <section class="card next">{nxt}</section>
  <nav class="pager">{prev_link}{next_link}</nav>
</article>"""
    return layout(cfg, title=st.seo_title, desc=st.description,
                  path=path.step_url(st.no), body=body,
                  keywords=st.keywords, jsonld=jsonld)


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
