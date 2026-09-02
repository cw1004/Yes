# -*- coding: utf-8 -*-
"""제품 카드 이미지 생성.

1) 상품 이미지가 있으면 내려받아 카드로 합성한다.
2) 없거나 실패하면 카테고리 색감으로 절차적 카드를 그린다(오프라인에서도 동작).

텍스트는 배경에 굽지 않고 투명 오버레이 PNG 로 따로 만든다.
영상 단계에서 켄번즈 줌이 배경에만 걸리게 하기 위해서다.
"""

from __future__ import annotations

import hashlib
import random
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..models import Product

RGB = Tuple[int, int, int]

# 카테고리별 색 (배경 그라디언트 + 강조색)
PALETTES: Dict[str, Tuple[List[str], str]] = {
    "주방용품": (["#12212b", "#1d3d4a", "#2b6272"], "#ffd166"),
    "생활가전": (["#141a2b", "#1f2a4a", "#2f3f74"], "#4cc9f0"),
    "사무/PC": (["#12141c", "#20222e", "#343849"], "#a0e548"),
    "자동차용품": (["#181212", "#2c1a1a", "#4a2a24"], "#ff6b35"),
    "캠핑/아웃도어": (["#0f1a14", "#1b2f24", "#2c4a37"], "#ffb703"),
    "반려동물": (["#1d1424", "#33203f", "#4d3160"], "#ff8fab"),
    "_default": (["#101418", "#1b2229", "#2a343d"], "#ffcc00"),
}


def hex_rgb(value: str) -> RGB:
    v = value.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def palette_for(product: Product) -> Tuple[List[str], str]:
    if product.category in PALETTES:
        return PALETTES[product.category]
    idx = int(hashlib.sha1((product.category or product.source).encode()).hexdigest(), 16)
    keys = [k for k in PALETTES if k != "_default"]
    return PALETTES[keys[idx % len(keys)]]


def font(path: Optional[str], size: int) -> ImageFont.FreeTypeFont:
    if path:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:                       # Pillow < 10
        return ImageFont.load_default()


# ------------------------------------------------------------------ 다운로드
def download_image(url: str, out: Path, timeout: int = 15) -> Optional[Path]:
    """상품 이미지를 내려받는다. 실패하면 None (파이프라인은 계속된다)."""
    if not url:
        return None
    try:
        from ..sources.base import http
        data = http(url, timeout=timeout)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        with Image.open(out) as im:         # 유효성 확인
            im.verify()
        return out
    except Exception:
        try:
            out.unlink(missing_ok=True)
        except Exception:
            pass
        return None


# ------------------------------------------------------------------ 배경 요소
def _gradient(size: Tuple[int, int], colors: Sequence[str]) -> Image.Image:
    w, h = size
    cols = [hex_rgb(c) for c in colors]
    strip = Image.new("RGB", (1, h))
    px = strip.load()
    seg = max(1, len(cols) - 1)
    for y in range(h):
        pos = (y / max(1, h - 1)) * seg
        i = min(int(pos), seg - 1)
        t = pos - i
        px[0, y] = tuple(int(cols[i][c] + (cols[i + 1][c] - cols[i][c]) * t) for c in range(3))
    return strip.resize((w, h), Image.BILINEAR)


def _cover(img: Image.Image, size: Tuple[int, int]) -> Image.Image:
    w, h = size
    ratio = max(w / img.width, h / img.height)
    resized = img.resize((max(1, int(img.width * ratio)), max(1, int(img.height * ratio))),
                         Image.LANCZOS)
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    return resized.crop((left, top, left + w, top + h))


def _rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1],
                                          radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def _shadow(base: Image.Image, box: Tuple[int, int, int, int], radius: int,
            blur: int = 26, alpha: int = 130) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius=radius, fill=(0, 0, 0, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)


def _vignette(img: Image.Image, strength: float = 0.55) -> Image.Image:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([-w * 0.3, -h * 0.12, w * 1.3, h * 1.12], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.13))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(img.convert("RGB"), Image.blend(img.convert("RGB"), dark, strength),
                           mask)


# ------------------------------------------------------------------ 배경 합성
def build_background(out: Path, product: Product, photo: Optional[Path],
                     size: Tuple[int, int], beat: str, seed: int = 0,
                     font_path: Optional[str] = None) -> Path:
    """제품 카드 배경 한 장 (비트마다 구도가 조금씩 달라진다)."""
    w, h = size
    colors, accent = palette_for(product)
    rng = random.Random(f"{product.key}{beat}{seed}")

    canvas = _gradient((w, h), colors).convert("RGBA")

    src: Optional[Image.Image] = None
    if photo and Path(photo).exists():
        try:
            src = Image.open(photo).convert("RGB")
        except Exception:
            src = None

    if src is not None:
        blurred = _cover(src, (w, h)).filter(ImageFilter.GaussianBlur(38))
        blurred = Image.blend(blurred, Image.new("RGB", (w, h), hex_rgb(colors[0])), 0.45)
        canvas.alpha_composite(blurred.convert("RGBA"))

    # 제품 카드 (비트별로 크기/위치 살짝 변화 → 정지 화면 느낌 제거)
    scale = {"HOOK": 0.78, "PROBLEM": 0.72, "PROOF": 0.70, "PRICE": 0.76, "CTA": 0.68}.get(beat, 0.74)
    cw = int(w * scale)
    ch = int(cw * 1.05)
    cx = (w - cw) // 2
    cy = int(h * 0.30) - ch // 2 + int(h * 0.06)
    box = (cx, cy, cx + cw, cy + ch)
    _shadow(canvas, box, radius=48)

    if src is not None:
        card = _cover(src, (cw, ch))
    else:
        card = _gradient((cw, ch), [colors[-1], colors[1]]).convert("RGB")
        pattern = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        pd = ImageDraw.Draw(pattern)
        for _ in range(18):                       # 절차적 패턴 (은은하게)
            x, y = rng.randint(0, cw), rng.randint(0, ch)
            r = rng.randint(40, 150)
            pd.ellipse([x - r, y - r, x + r, y + r],
                       outline=hex_rgb(accent) + (46,), width=3)
        card = Image.alpha_composite(card.convert("RGBA"), pattern).convert("RGB")
        d = ImageDraw.Draw(card)
        initial = (product.title or "?").strip()[:1].upper()
        f = font(font_path, int(cw * 0.42))
        tw = d.textbbox((0, 0), initial, font=f)
        d.text(((cw - (tw[2] - tw[0])) / 2, (ch - (tw[3] - tw[1])) / 2 - tw[1]),
               initial, font=f, fill=hex_rgb(accent))

    canvas.alpha_composite(_rounded(card, 44), (cx, cy))

    frame = ImageDraw.Draw(canvas)
    frame.rounded_rectangle(box, radius=44, outline=(255, 255, 255, 60), width=3)

    final = _vignette(canvas, 0.5)
    out.parent.mkdir(parents=True, exist_ok=True)
    final.convert("RGB").save(out, quality=92)
    return out


# ------------------------------------------------------------------ 텍스트 오버레이
def _wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont,
          max_w: int) -> List[str]:
    if not text:
        return []
    lines: List[str] = []
    line = ""
    for word in text.split():
        cand = f"{line} {word}".strip()
        if draw.textlength(cand, font=f) <= max_w or not line:
            line = cand
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines[:3]


def _text(draw: ImageDraw.ImageDraw, xy, text: str, f, fill=(255, 255, 255, 255),
          stroke: int = 0, stroke_fill=(0, 0, 0, 200), anchor: Optional[str] = None) -> None:
    draw.text(xy, text, font=f, fill=fill, stroke_width=stroke,
              stroke_fill=stroke_fill, anchor=anchor)


def _chip(draw: ImageDraw.ImageDraw, xy: Tuple[int, int], text: str, f,
          bg: Tuple[int, int, int, int], fg=(0, 0, 0, 255), pad: int = 26) -> Tuple[int, int]:
    x, y = xy
    tw = draw.textlength(text, font=f)
    th = f.size
    box = (x, y, int(x + tw + pad * 2), int(y + th + pad))
    draw.rounded_rectangle(box, radius=int((th + pad) / 2), fill=bg)
    _text(draw, (x + pad, y + pad / 2 - 2), text, f, fill=fg)
    return box[2], box[3]


def render_overlay(out: Path, size: Tuple[int, int], *, caption: str, badge: str,
                   price: str = "", discount: str = "", rating: str = "",
                   accent: str = "#ffcc00", font_path: Optional[str] = None,
                   watermark: str = "", disclosure: str = "", beat: str = "HOOK",
                   cta: str = "") -> Path:
    """비트 하나의 텍스트 레이어(투명 PNG)."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    acc = hex_rgb(accent)

    f_badge = font(font_path, int(w * 0.036))
    f_cap = font(font_path, int(w * 0.082))
    f_big = font(font_path, int(w * 0.125))
    f_small = font(font_path, int(w * 0.040))
    f_tiny = font(font_path, int(w * 0.030))

    # 상단 배지
    if badge:
        _chip(d, (int(w * 0.07), int(h * 0.07)), badge, f_badge, acc + (235,))

    # 하단 그라디언트 (자막 가독성)
    grad = Image.new("RGBA", (w, int(h * 0.42)), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for i in range(grad.height):
        gd.line([(0, i), (w, i)], fill=(0, 0, 0, int(210 * (i / grad.height) ** 1.5)))
    img.alpha_composite(grad, (0, h - grad.height))

    y = int(h * 0.70)

    # PRICE 비트는 가격을 크게
    if beat == "PRICE" and price:
        if discount:
            _chip(d, (int(w * 0.07), y - int(h * 0.055)), discount, f_small,
                  (229, 57, 53, 240), fg=(255, 255, 255, 255))
        _text(d, (int(w * 0.07), y), price, f_big, fill=acc + (255,), stroke=4)
        y += int(f_big.size * 1.15)
    elif beat == "PROOF" and rating:
        _text(d, (int(w * 0.07), y), rating, f_big, fill=(255, 255, 255, 255), stroke=4)
        y += int(f_big.size * 1.15)

    # 자막
    for line in _wrap(d, caption, f_cap, int(w * 0.86)):
        _text(d, (int(w * 0.07), y), line, f_cap, stroke=5)
        y += int(f_cap.size * 1.18)

    # CTA 바
    if cta:
        bar_h = int(h * 0.075)
        bar_y = h - bar_h - int(h * 0.055)
        d.rounded_rectangle([int(w * 0.07), bar_y, int(w * 0.93), bar_y + bar_h],
                            radius=int(bar_h / 2), fill=acc + (240,))
        _text(d, (w / 2, bar_y + bar_h / 2), cta, f_small, fill=(20, 20, 20, 255),
              anchor="mm")

    # 광고 표기 (항상 화면에)
    if disclosure:
        _text(d, (int(w * 0.07), int(h * 0.945)), disclosure, f_tiny,
              fill=(255, 255, 255, 220), stroke=3)

    # 워터마크
    if watermark:
        _text(d, (int(w * 0.93), int(h * 0.072)), watermark, f_tiny,
              fill=(255, 255, 255, 170), stroke=2, anchor="ra")

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out
