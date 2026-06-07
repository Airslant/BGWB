#!/usr/bin/env python3
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "public/assets/brand/candidates/bgwb-real-covers-hall-of-fame-spec.json"
OUT_DIR = ROOT / "public/assets/brand/candidates"
CANVAS = (1720, 917)
BASE_HERO = ROOT / "public/assets/brand/bgwb-collection-wall-1720.jpg"


def open_rgb(path):
    image = Image.open(path)
    image = ImageOps.exif_transpose(image).convert("RGB")
    return image


def rounded_rect_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def make_background(seed=0):
    base = open_rgb(BASE_HERO).resize(CANVAS, Image.Resampling.LANCZOS).convert("RGBA")
    overlay = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # Keep the homepage headline area clean and soften the old fictional cover art
    # where the real covers will sit.
    draw.rectangle((0, 0, 700, CANVAS[1]), fill=(255, 246, 226, 32))
    draw.rectangle((800, 20, 1715, 670), fill=(28, 18, 10, 78))
    draw.rectangle((580, 640, 1715, 917), fill=(26, 16, 8, 58))
    random.seed(seed)
    return Image.alpha_composite(base, overlay)


def add_shadow(canvas, box, radius=16, opacity=95):
    x, y, w, h = box
    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle((x + 14, y + 18, x + w + 14, y + h + 18), radius=radius, fill=(0, 0, 0, opacity))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)


def draw_shelf(canvas, y, x0=760, x1=1715, thickness=24):
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x0, y, x1, y + thickness), radius=5, fill=(104, 61, 30, 255))
    draw.rectangle((x0, y + 4, x1, y + 10), fill=(155, 101, 55, 120))
    draw.rectangle((x0, y + thickness - 6, x1, y + thickness), fill=(48, 25, 12, 150))


def cover_card(path, target, radius=8, rotate=0, dim=1.0):
    target_w, target_h = target
    cover = open_rgb(path)
    cover = ImageOps.contain(cover, (target_w - 8, target_h - 8), Image.Resampling.LANCZOS)
    target_w = cover.width + 8
    target_h = cover.height + 8
    card = Image.new("RGBA", target, (36, 25, 18, 255))
    card = Image.new("RGBA", (target_w, target_h), (36, 25, 18, 255))
    card.alpha_composite(cover.convert("RGBA"), (4, 4))

    edge = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(edge)
    draw.rounded_rectangle((0, 0, target_w - 1, target_h - 1), radius=radius, outline=(255, 232, 183, 88), width=2)
    draw.rectangle((target_w - 10, 7, target_w - 4, target_h - 8), fill=(20, 12, 8, 78))
    card = Image.alpha_composite(card, edge)

    if dim != 1.0:
        card = ImageEnhance.Brightness(card).enhance(dim)
        card = ImageEnhance.Contrast(card).enhance(1.04)

    mask = rounded_rect_mask((target_w, target_h), radius)
    card.putalpha(ImageChops_multiply(card.getchannel("A"), mask))
    if rotate:
        card = card.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
    return card


def ImageChops_multiply(a, b):
    # Local tiny replacement avoids importing another namespace in older Pillow builds.
    return Image.eval(Image.composite(a, b, b), lambda px: px)


def paste_cover(canvas, cover_info, x, y, w, h, rotate=0, dim=1.0):
    card = cover_card(cover_info["path"], (w, h), rotate=rotate, dim=dim)
    px = x + (w - card.width) // 2
    py = y + (h - card.height)
    add_shadow(canvas, (px, py, card.width, card.height), opacity=82)
    canvas.alpha_composite(card, (px, py))


def draw_tokens(canvas, seed, density=1.0):
    random.seed(seed)
    draw = ImageDraw.Draw(canvas)
    colors = ["#b4432f", "#d7a33a", "#2f6b55", "#244d78", "#f0dfbd", "#2b2b2b"]
    for _ in range(int(42 * density)):
        x = random.randint(760, 1620)
        y = random.randint(720, 875)
        size = random.randint(8, 16)
        color = random.choice(colors)
        draw.rounded_rectangle((x, y, x + size, y + size), radius=3, fill=color, outline=(30, 20, 13, 90))
    for _ in range(int(16 * density)):
        x = random.randint(880, 1640)
        y = random.randint(700, 860)
        draw.ellipse((x, y, x + 18, y + 18), fill=random.choice(colors), outline=(30, 20, 13, 110))


def add_mobile_safe_vignette(canvas):
    width, height = CANVAS
    overlay = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 690, height), fill=(245, 232, 207, 42))
    draw.rectangle((0, 0, width, 80), fill=(20, 12, 6, 18))
    draw.rectangle((0, height - 120, width, height), fill=(20, 12, 6, 35))
    draw.rectangle((1180, 0, width, height), fill=(20, 10, 5, 24))
    canvas.alpha_composite(overlay)


def option_a(covers):
    canvas = make_background(11)
    placements = [
        (835, 48, 118, 166), (990, 48, 118, 166), (1145, 48, 118, 166), (1300, 48, 118, 166), (1455, 48, 118, 166),
        (790, 276, 126, 176), (950, 276, 126, 176), (1110, 276, 126, 176), (1270, 276, 126, 176), (1430, 276, 126, 176),
        (820, 510, 122, 168), (980, 510, 122, 168), (1140, 510, 122, 168), (1300, 510, 122, 168), (1460, 510, 122, 168),
    ]
    for cover, (x, y, w, h) in zip(covers, placements):
        paste_cover(canvas, cover, x, y, w, h, 0, 0.96 if y > 480 else 1.0)
    draw_tokens(canvas, 12, 0.55)
    add_mobile_safe_vignette(canvas)
    return canvas.convert("RGB")


def option_b(covers):
    canvas = make_background(22)
    placements = [
        (835, 40, 126, 176), (995, 40, 126, 176), (1155, 40, 126, 176), (1315, 40, 126, 176), (1475, 40, 126, 176),
        (780, 268, 118, 166), (930, 268, 118, 166), (1080, 268, 118, 166), (1230, 268, 118, 166), (1380, 268, 118, 166), (1530, 268, 118, 166),
        (800, 510, 112, 156), (945, 510, 112, 156), (1090, 510, 112, 156), (1235, 510, 112, 156), (1380, 510, 112, 156),
    ]
    for cover, (x, y, w, h) in zip(covers, placements):
        paste_cover(canvas, cover, x, y, w, h, 0, 0.97 if y > 480 else 1.0)
    tabletop = [(755, 714, 94, 128, -7), (900, 734, 92, 126, 4), (1045, 710, 92, 126, -2), (1190, 744, 92, 126, 5), (1340, 722, 92, 126, -4), (1490, 740, 92, 126, 3)]
    for cover, (x, y, w, h, r) in zip(covers[:6], tabletop):
        paste_cover(canvas, cover, x, y, w, h, rotate=r, dim=0.93)
    draw_tokens(canvas, 23, 0.8)
    add_mobile_safe_vignette(canvas)
    return canvas.convert("RGB")


def option_c(covers):
    canvas = make_background(33)
    for i, cover in enumerate(covers[:12]):
        row = i // 6
        col = i % 6
        paste_cover(canvas, cover, 790 + col * 144, 58 + row * 228, 112, 156, 0, 0.98)
    table_positions = [
        (685, 700, 124, 92, -8),
        (875, 682, 124, 92, 3),
        (1085, 720, 124, 92, -3),
        (1300, 690, 124, 92, 6),
        (1485, 722, 110, 82, -7),
    ]
    for cover, (x, y, w, h, r) in zip(covers[8:], table_positions):
        paste_cover(canvas, cover, x, y, w, h, rotate=r, dim=0.98)
    draw_tokens(canvas, 34, 1.0)
    add_mobile_safe_vignette(canvas)
    return canvas.convert("RGB")


def main():
    spec = json.loads(SPEC_PATH.read_text())
    canvases = {entry["name"]: entry for entry in spec["canvases"]}
    outputs = {
        "a": option_a(canvases["a"]["covers"]),
        "b": option_b(canvases["b"]["covers"]),
        "c": option_c(canvases["c"]["covers"]),
    }
    for key, image in outputs.items():
        path = OUT_DIR / f"bgwb-real-covers-hall-of-fame-option-{key}.png"
        image.save(path, quality=95)
        print(path)


if __name__ == "__main__":
    main()
