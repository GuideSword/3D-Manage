from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SOURCE_CROP = (100, 0, 1100, 1000)
PURPLE_TOP = (232, 226, 255, 255)
PURPLE_BOTTOM = (91, 73, 177, 255)


def vertical_gradient():
    image = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(image)
    for y in range(SIZE):
        ratio = y / (SIZE - 1)
        color = tuple(
            round(start + (end - start) * ratio)
            for start, end in zip(PURPLE_TOP, PURPLE_BOTTOM)
        )
        draw.line((0, y, SIZE, y), fill=color)
    return image


def cropped_portrait(source_path):
    with Image.open(source_path) as source:
        source = source.convert("RGBA")
        return source.crop(SOURCE_CROP)


def place_centered(canvas, portrait, rendered_size):
    rendered = portrait.resize((rendered_size, rendered_size), Image.Resampling.LANCZOS)
    offset = ((SIZE - rendered_size) // 2, (SIZE - rendered_size) // 2)
    canvas.alpha_composite(rendered, offset)


def generate_icons(source_path, legacy_path, adaptive_path):
    source_path = Path(source_path)
    legacy_path = Path(legacy_path)
    adaptive_path = Path(adaptive_path)
    portrait = cropped_portrait(source_path)

    legacy = vertical_gradient()
    place_centered(legacy, portrait, 960)

    adaptive = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    place_centered(adaptive, portrait, 700)

    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    adaptive_path.parent.mkdir(parents=True, exist_ok=True)
    legacy.save(legacy_path, format="PNG", optimize=True)
    adaptive.save(adaptive_path, format="PNG", optimize=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    generate_icons(
        root / "assets" / "xiaoli" / "hero.png",
        root / "assets" / "icon.png",
        root / "assets" / "adaptive-icon.png",
    )
