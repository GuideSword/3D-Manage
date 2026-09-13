import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "generate_xiaoli_icons", ROOT / "scripts" / "generate-xiaoli-icons.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GenerateXiaoliIconsTest(unittest.TestCase):
    def test_generates_opaque_legacy_and_safe_adaptive_icons(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory)
            source_path = output / "hero.png"
            legacy_path = output / "icon.png"
            adaptive_path = output / "adaptive-icon.png"
            source = Image.new("RGBA", (1199, 1312), (0, 0, 0, 0))
            draw = ImageDraw.Draw(source)
            draw.ellipse((180, 80, 1020, 900), fill=(120, 80, 240, 255))
            draw.rectangle((400, 250, 800, 650), fill=(245, 220, 255, 255))
            source.save(source_path, format="PNG")

            MODULE.generate_icons(
                source_path,
                legacy_path,
                adaptive_path,
            )

            with Image.open(legacy_path) as legacy:
                self.assertEqual(legacy.size, (1024, 1024))
                self.assertEqual(legacy.mode, "RGBA")
                self.assertEqual(legacy.getpixel((0, 0))[3], 255)
                self.assertNotEqual(legacy.getpixel((0, 0)), legacy.getpixel((1023, 1023)))

            with Image.open(adaptive_path) as adaptive:
                self.assertEqual(adaptive.size, (1024, 1024))
                self.assertEqual(adaptive.mode, "RGBA")
                self.assertEqual(adaptive.getpixel((0, 0))[3], 0)
                self.assertIsNotNone(adaptive.getbbox())
                left, top, right, bottom = adaptive.getbbox()
                self.assertGreaterEqual(left, 190)
                self.assertGreaterEqual(top, 190)
                self.assertLessEqual(right, 834)
                self.assertLessEqual(bottom, 834)

            first_legacy = legacy_path.read_bytes()
            first_adaptive = adaptive_path.read_bytes()
            MODULE.generate_icons(source_path, legacy_path, adaptive_path)
            self.assertEqual(first_legacy, legacy_path.read_bytes())
            self.assertEqual(first_adaptive, adaptive_path.read_bytes())


if __name__ == "__main__":
    unittest.main()
