#!/usr/bin/env python3
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "public/assets/brand/candidates/bgwb-real-covers-hall-of-fame-spec.json"
BASE_HERO = ROOT / "public/assets/brand/bgwb-collection-wall-1720.jpg"
OUT_DIR = ROOT / "public/assets/brand/candidates"
CANVAS = (1720, 917)

# Interior face areas of the existing boxes in bgwb-collection-wall-1720.jpg.
# These are deliberately slightly inset so the original box edges and shelf
# shadows remain visible.
BOX_RECTS = [
    (922, 96, 994, 202),
    (1048, 58, 1138, 202),
    (1168, 62, 1208, 202),
    (1228, 34, 1350, 202),
    (1366, 76, 1510, 202),
    (1528, 58, 1594, 202),
    (1610, 58, 1666, 202),
    (918, 276, 978, 404),
    (1002, 292, 1098, 404),
    (1118, 278, 1198, 404),
    (1216, 290, 1298, 402),
    (1348, 282, 1476, 404),
    (1490, 286, 1574, 404),
    (824, 466, 900, 610),
    (912, 468, 996, 610),
    (1012, 466, 1158, 610),
    (1188, 466, 1288, 610),
    (1310, 468, 1418, 610),
    (1438, 468, 1564, 610),
]


def open_rgb(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def cover_to_face(path, size, underlay):
    cover = open_rgb(path).resize(size, Image.Resampling.LANCZOS)
    cover = ImageEnhance.Brightness(cover).enhance(0.84)
    cover = ImageEnhance.Color(cover).enhance(0.76)
    cover = ImageEnhance.Contrast(cover).enhance(0.88)
    cover = cover.filter(ImageFilter.GaussianBlur(0.18))

    # Reuse the original box face luminance so the pasted cover inherits the
    # existing shelf lighting and does not float above the photograph.
    shade = underlay.convert("L").filter(ImageFilter.GaussianBlur(7))
    shade = shade.point(lambda p: max(116, min(242, int(128 + p * 0.38))))
    shaded = ImageChops.multiply(cover, Image.merge("RGB", (shade, shade, shade)))
    paper_texture = underlay.filter(ImageFilter.GaussianBlur(0.6))
    shaded = Image.blend(shaded, paper_texture, 0.08)
    return Image.blend(underlay, shaded, 0.78)


def feathered_rect_mask(size, radius=2):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(0.35))


def paste_on_box(canvas, cover_info, rect):
    x0, y0, x1, y1 = rect
    width = x1 - x0
    height = y1 - y0
    underlay = canvas.crop(rect).convert("RGB")
    face = cover_to_face(cover_info["path"], (width, height), underlay).convert("RGBA")
    mask = feathered_rect_mask((width, height))
    face.putalpha(mask)
    canvas.alpha_composite(face, (x0, y0))

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((x0 - 1, y0 - 1, x1, y1), outline=(18, 11, 7, 62), width=1)
    draw.line((x1 - 1, y0 + 3, x1 - 1, y1 - 3), fill=(0, 0, 0, 72), width=2)


def clean_left_side(canvas):
    overlay = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 690, CANVAS[1]), fill=(247, 238, 220, 28))
    draw.rectangle((0, CANVAS[1] - 120, CANVAS[0], CANVAS[1]), fill=(18, 12, 8, 22))
    canvas.alpha_composite(overlay)


def build(option_name, covers):
    canvas = open_rgb(BASE_HERO).resize(CANVAS, Image.Resampling.LANCZOS).convert("RGBA")
    for cover_info, rect in zip(covers, BOX_RECTS):
        paste_on_box(canvas, cover_info, rect)
    clean_left_side(canvas)
    out = OUT_DIR / f"bgwb-real-covers-on-boxes-option-{option_name}.png"
    canvas.convert("RGB").save(out, quality=95)
    return out


def main():
    spec = json.loads(SPEC_PATH.read_text())
    canvases = {entry["name"]: entry for entry in spec["canvases"]}
    outputs = [
        build("a", canvases["a"]["covers"]),
        build("b", canvases["b"]["covers"]),
        build("c", canvases["c"]["covers"]),
    ]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
