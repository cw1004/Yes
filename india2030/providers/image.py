# -*- coding: utf-8 -*-
"""장면 이미지 생성.

1) assets/stock/ep###/ 에 사용자가 넣어둔 이미지가 있으면 그것을 우선 사용
2) 없으면 Pillow 로 ACT 색감에 맞는 시네마틱 배경을 절차적으로 그린다
   (그라디언트 + 태양/조명 + 실루엣 + 먼지 입자 + 비네팅 + 필름 그레인)

텍스트는 배경에 굽지 않고 투명 오버레이 PNG 로 따로 만들어,
영상 단계에서 켄번즈 줌이 배경에만 걸리도록 한다.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..config import Config

RGB = Tuple[int, int, int]

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def hex_rgb(value: str) -> RGB:
    v = value.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def _mix(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore


def _font(path: Optional[str], size: int) -> ImageFont.FreeTypeFont:
    if path:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------- 배경 요소
def _gradient(size: Tuple[int, int], palette: Sequence[str]) -> Image.Image:
    w, h = size
    cols = [hex_rgb(c) for c in palette] or [(20, 20, 20), (80, 80, 80)]
    grad = Image.new("RGB", (1, h))
    px = grad.load()
    seg = max(1, len(cols) - 1)
    for y in range(h):
        t = y / max(1, h - 1)
        pos = t * seg
        i = min(int(pos), seg - 1)
        px[0, y] = _mix(cols[i], cols[i + 1], pos - i)
    return grad.resize((w, h), Image.BILINEAR)


def _screen(base: Image.Image, top: Image.Image) -> Image.Image:
    """screen 블렌드 (밝게)."""
    from PIL import ImageChops
    return ImageChops.screen(base.convert("RGB"), top.convert("RGB"))


def _vignette(img: Image.Image, strength: float = 0.75) -> Image.Image:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-w * 0.25, -h * 0.15, w * 1.25, h * 1.15], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.12))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(img, Image.blend(img, dark, strength), mask)


def _grain(img: Image.Image, rng: random.Random, amount: int = 10) -> Image.Image:
    w, h = img.size
    small = Image.new("L", (w // 3, h // 3))
    small.putdata([rng.randint(128 - amount, 128 + amount)
                   for _ in range(small.width * small.height)])
    noise = small.resize((w, h), Image.BILINEAR).convert("RGB")
    from PIL import ImageChops
    return ImageChops.overlay(img, noise)


def _dust(img: Image.Image, rng: random.Random, color: RGB, count: int = 120) -> None:
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x, y = rng.uniform(0, w), rng.uniform(h * 0.2, h)
        r = rng.uniform(1.0, 4.0)
        a = rng.randint(30, 130)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(1.2))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


# ---------------------------------------------------------------- 실루엣
def _ground(d: ImageDraw.ImageDraw, w: int, h: int, y: int, color: RGB) -> None:
    d.rectangle([0, y, w, h], fill=color)


def _boy(d: ImageDraw.ImageDraw, x: int, base_y: int, scale: float, color: RGB,
         kicking: bool = True) -> None:
    """달리거나 공을 차는 소년 실루엣."""
    s = scale
    head_r = int(14 * s)
    head_y = base_y - int(150 * s)
    d.ellipse([x - head_r, head_y - head_r, x + head_r, head_y + head_r], fill=color)
    # 몸통
    d.polygon([(x - int(16 * s), head_y + head_r),
               (x + int(16 * s), head_y + head_r),
               (x + int(11 * s), base_y - int(70 * s)),
               (x - int(13 * s), base_y - int(70 * s))], fill=color)
    lw = max(3, int(9 * s))
    # 팔
    d.line([(x - int(12 * s), head_y + int(28 * s)),
            (x - int(46 * s), head_y + int(6 * s))], fill=color, width=lw)
    d.line([(x + int(12 * s), head_y + int(28 * s)),
            (x + int(40 * s), head_y + int(52 * s))], fill=color, width=lw)
    # 다리
    if kicking:
        d.line([(x - int(4 * s), base_y - int(72 * s)),
                (x - int(34 * s), base_y)], fill=color, width=lw + 2)
        d.line([(x + int(4 * s), base_y - int(72 * s)),
                (x + int(52 * s), base_y - int(30 * s))], fill=color, width=lw + 2)
    else:
        d.line([(x - int(4 * s), base_y - int(72 * s)),
                (x - int(16 * s), base_y)], fill=color, width=lw + 2)
        d.line([(x + int(4 * s), base_y - int(72 * s)),
                (x + int(18 * s), base_y)], fill=color, width=lw + 2)


def _ball(d: ImageDraw.ImageDraw, x: int, y: int, r: int, color: RGB) -> None:
    d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def _goal(d: ImageDraw.ImageDraw, cx: int, base_y: int, w: int, h: int,
          color: RGB, width: int = 8) -> None:
    d.line([(cx - w // 2, base_y), (cx - w // 2, base_y - h)], fill=color, width=width)
    d.line([(cx + w // 2, base_y), (cx + w // 2, base_y - h)], fill=color, width=width)
    d.line([(cx - w // 2, base_y - h), (cx + w // 2, base_y - h)], fill=color, width=width)


def _elephant(d: ImageDraw.ImageDraw, cx: int, base_y: int, scale: float, color: RGB) -> None:
    s = scale
    body = [(cx - 150 * s, base_y), (cx - 160 * s, base_y - 120 * s),
            (cx - 120 * s, base_y - 175 * s), (cx + 20 * s, base_y - 185 * s),
            (cx + 110 * s, base_y - 150 * s), (cx + 140 * s, base_y - 60 * s),
            (cx + 150 * s, base_y)]
    d.polygon([(int(x), int(y)) for x, y in body], fill=color)
    # 머리와 귀
    hx, hy = cx + 130 * s, base_y - 150 * s
    d.ellipse([int(hx - 70 * s), int(hy - 70 * s), int(hx + 70 * s), int(hy + 70 * s)], fill=color)
    d.ellipse([int(hx - 120 * s), int(hy - 60 * s), int(hx - 10 * s), int(hy + 80 * s)], fill=color)
    # 코
    trunk = [(hx + 40 * s, hy + 30 * s), (hx + 75 * s, hy + 40 * s),
             (hx + 80 * s, base_y - 10 * s), (hx + 50 * s, base_y - 5 * s)]
    d.polygon([(int(x), int(y)) for x, y in trunk], fill=color)
    # 상아
    d.line([(int(hx + 30 * s), int(hy + 45 * s)), (int(hx + 90 * s), int(hy + 90 * s))],
           fill=color, width=max(3, int(10 * s)))


def _crowd(d: ImageDraw.ImageDraw, w: int, y: int, rng: random.Random, color: RGB) -> None:
    for row in range(3):
        yy = y + row * 26
        x = -20
        while x < w + 20:
            r = rng.randint(12, 20)
            d.ellipse([x - r, yy - r, x + r, yy + r], fill=color)
            x += rng.randint(28, 46)


def _floodlight(d: ImageDraw.ImageDraw, x: int, base_y: int, h: int, color: RGB) -> None:
    d.line([(x, base_y), (x, base_y - h)], fill=color, width=10)
    d.rectangle([x - 70, base_y - h - 46, x + 70, base_y - h], fill=color)


# ---------------------------------------------------------------- 장면 조립
SCENE_KEYS = {
    "elephant": ("코끼리",),
    "goal": ("골", "그물", "골대", "벽"),
    "crowd": ("관중", "함성", "광장", "인파", "스크린", "깃발", "스타디움", "경기장"),
    "stadium": ("잔디", "구장", "그라운드", "조명"),
    "train": ("기차", "버스", "떠나"),
    "rain": ("비", "진흙"),
}


def pick_scene(text: str, beat: str) -> str:
    for key, words in SCENE_KEYS.items():
        if any(w in text for w in words):
            return key
    return {"HOOK": "village", "EMOTION": "village", "ACTION": "run",
            "DREAM": "horizon", "MESSAGE": "horizon"}.get(beat, "village")


def render_background(path: Path, size: Tuple[int, int], palette: Sequence[str],
                      accent: str, scene: str, seed: int) -> Path:
    w, h = size
    rng = random.Random(seed)
    img = _gradient((w, h), palette)
    accent_rgb = hex_rgb(accent)
    horizon = int(h * rng.uniform(0.60, 0.70))

    # 태양 / 조명
    sun_x = int(w * rng.uniform(0.25, 0.75))
    sun_y = int(horizon - h * rng.uniform(0.02, 0.10))
    img = _screen(img, _radial(size, (sun_x, sun_y), int(min(w, h) * 0.42), accent_rgb))

    dark = _mix(hex_rgb(palette[0]), (0, 0, 0), 0.55)
    d = ImageDraw.Draw(img)

    if scene == "crowd":
        _crowd(d, w, int(horizon - h * 0.05), rng, _mix(dark, (0, 0, 0), 0.3))
    if scene in ("stadium", "crowd"):
        _floodlight(d, int(w * 0.12), horizon, int(h * 0.30), dark)
        _floodlight(d, int(w * 0.88), horizon, int(h * 0.30), dark)

    _ground(d, w, h, horizon, dark)

    if scene == "elephant":
        _elephant(d, int(w * 0.58), int(horizon + h * 0.10), w / 620.0, _mix(dark, (0, 0, 0), 0.45))
        _boy(d, int(w * 0.24), int(horizon + h * 0.10), w / 700.0, (0, 0, 0), kicking=False)
    elif scene == "goal":
        _goal(d, int(w * 0.62), horizon + int(h * 0.06), int(w * 0.52), int(h * 0.16),
              _mix(dark, (0, 0, 0), 0.5), width=max(6, w // 150))
        _boy(d, int(w * 0.26), int(horizon + h * 0.10), w / 620.0, (0, 0, 0))
        _ball(d, int(w * 0.40), int(horizon + h * 0.07), max(8, w // 60), (0, 0, 0))
    elif scene == "run":
        _boy(d, int(w * 0.46), int(horizon + h * 0.12), w / 520.0, (0, 0, 0))
        _ball(d, int(w * 0.68), int(horizon + h * 0.10), max(9, w // 52), (0, 0, 0))
    elif scene == "horizon":
        _boy(d, int(w * 0.34), int(horizon + h * 0.08), w / 760.0, (0, 0, 0), kicking=False)
        _ball(d, int(w * 0.42), int(horizon + h * 0.075), max(7, w // 75), (0, 0, 0))
    elif scene == "train":
        d.rectangle([0, horizon - int(h * 0.06), int(w * 0.85), horizon],
                    fill=_mix(dark, (0, 0, 0), 0.45))
        _boy(d, int(w * 0.90), int(horizon + h * 0.09), w / 780.0, (0, 0, 0), kicking=False)
    elif scene == "rain":
        rain = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        rd = ImageDraw.Draw(rain)
        for _ in range(220):
            x, y = rng.uniform(0, w), rng.uniform(0, h)
            rd.line([(x, y), (x - 6, y + 26)], fill=(220, 230, 255, rng.randint(40, 110)), width=2)
        img = Image.alpha_composite(img.convert("RGBA"), rain).convert("RGB")
        d = ImageDraw.Draw(img)
        _boy(d, int(w * 0.5), int(horizon + h * 0.11), w / 560.0, (0, 0, 0))
    else:  # village
        # 낮은 담벼락과 야자수 실루엣
        d.rectangle([0, horizon - int(h * 0.045), int(w * 0.55), horizon],
                    fill=_mix(dark, (0, 0, 0), 0.35))
        _boy(d, int(w * 0.66), int(horizon + h * 0.11), w / 600.0, (0, 0, 0))
        _ball(d, int(w * 0.50), int(horizon + h * 0.09), max(8, w // 62), (0, 0, 0))

    _dust(img, rng, accent_rgb, count=int(w * h / 14000))
    img = _vignette(img, 0.68)
    img = _grain(img, rng, amount=9)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=94)
    return path


def _radial(size: Tuple[int, int], center: Tuple[int, int], radius: int,
            color: RGB) -> Image.Image:
    w, h = size
    small = (max(64, w // 6), max(64, h // 6))
    img = Image.new("RGB", small, (0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = center[0] * small[0] / w, center[1] * small[1] / h
    r = radius * small[0] / w
    steps = 22
    for i in range(steps, 0, -1):
        rr = r * i / steps
        t = (1 - i / steps) ** 2.2
        c = tuple(int(v * t) for v in color)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=c)
    return img.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(radius * 0.03))


# ---------------------------------------------------------------- 텍스트 오버레이
def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont,
          max_w: int) -> List[str]:
    """어절 단위로 줄바꿈하고, 한 어절이 너무 길면 글자 단위로 쪼갠다."""
    lines: List[str] = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split(" "):
            trial = f"{cur} {word}".strip()
            if draw.textlength(trial, font=font) <= max_w or not cur:
                if draw.textlength(trial, font=font) > max_w and not cur:
                    # 어절 자체가 한 줄을 넘는 경우 글자 단위 분해
                    chunk = ""
                    for ch in word:
                        if draw.textlength(chunk + ch, font=font) <= max_w or not chunk:
                            chunk += ch
                        else:
                            lines.append(chunk)
                            chunk = ch
                    cur = chunk
                else:
                    cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return [l for l in lines if l != ""] or [""]


def render_text_overlay(path: Path, size: Tuple[int, int], caption: str,
                        badge: str, accent: str, font_path: Optional[str],
                        watermark: str = "", subtitle_pos: float = 0.78,
                        big: bool = False) -> Path:
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    accent_rgb = hex_rgb(accent)

    # 상단 배지 (ACT / 화수)
    if badge:
        bf = _font(font_path, max(20, w // 34))
        pad = max(10, w // 90)
        tw = d.textlength(badge, font=bf)
        bh = bf.size + pad * 2
        x0, y0 = int(w * 0.06), int(h * 0.055)
        d.rounded_rectangle([x0, y0, x0 + tw + pad * 2, y0 + bh],
                            radius=bh // 2, fill=(0, 0, 0, 150),
                            outline=accent_rgb + (220,), width=2)
        d.text((x0 + pad, y0 + pad - bf.size * 0.08), badge, font=bf, fill=accent_rgb + (255,))

    # 자막
    if caption:
        cf = _font(font_path, max(28, int(w / (10.5 if big else 13.0))))
        max_w = int(w * 0.84)
        lines = _wrap(d, caption, cf, max_w)
        line_h = int(cf.size * 1.34)
        block_h = line_h * len(lines)
        top = int(h * subtitle_pos) - block_h // 2

        # 가독성용 스크림
        scrim = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(scrim)
        sd.rectangle([0, top - int(line_h * 0.7), w, top + block_h + int(line_h * 0.7)],
                     fill=(0, 0, 0, 120))
        scrim = scrim.filter(ImageFilter.GaussianBlur(line_h * 0.35))
        img = Image.alpha_composite(img, scrim)
        d = ImageDraw.Draw(img)

        for i, line in enumerate(lines):
            tw = d.textlength(line, font=cf)
            x = (w - tw) / 2
            y = top + i * line_h
            d.text((x, y), line, font=cf, fill=(255, 255, 255, 255),
                   stroke_width=max(2, cf.size // 14), stroke_fill=(0, 0, 0, 210))

    # 워터마크
    if watermark:
        wf = _font(font_path, max(16, w // 48))
        tw = d.textlength(watermark, font=wf)
        d.text(((w - tw) / 2, h - wf.size * 2.4), watermark, font=wf,
               fill=accent_rgb + (190,))

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return path


# ---------------------------------------------------------------- 스톡 이미지
def stock_images(cfg: Config, ep_no: int) -> List[Path]:
    base = cfg.stock_dir or (cfg.assets_dir / "stock")
    folder = Path(base) / f"ep{ep_no:03d}"
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)


def fit_to_canvas(src: Path, dst: Path, size: Tuple[int, int]) -> Path:
    """스톡 이미지를 캔버스 비율에 맞춰 중앙 크롭."""
    w, h = size
    img = Image.open(src).convert("RGB")
    scale = max(w / img.width, h / img.height)
    img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))),
                     Image.LANCZOS)
    left, top = (img.width - w) // 2, (img.height - h) // 2
    img = img.crop((left, top, left + w, top + h))
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, quality=94)
    return dst
