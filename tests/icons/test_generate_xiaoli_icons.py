import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image

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
            legacy_path = output / "icon.png"
            adaptive_path = output / "adaptive-icon.png"

            MODULE.generate_icons(
                ROOT / "assets" / "xiaoli" / "hero.png",
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
                self.assertGreaterEqual(left, 150)
                self.assertGreaterEqual(top, 150)
                self.assertLessEqual(right, 874)
                self.assertLessEqual(bottom, 874)


if __name__ == "__main__":
    unittest.main()
