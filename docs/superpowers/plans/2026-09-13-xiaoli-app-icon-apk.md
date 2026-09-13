# Xiaoli App Icon and Android Preview APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Expo/Android launcher art with the approved Xiaoli portrait and produce a verified, directly installable Android preview APK.

**Architecture:** A small Pillow-based generator deterministically crops the existing transparent Xiaoli hero art into a branded legacy icon and a safe-zone adaptive foreground. Expo remains the source of truth; `expo prebuild` synchronizes ignored Android resources, and the existing local Gradle release path produces the debug-signed internal APK.

**Tech Stack:** Expo 54, React Native 0.81, Python 3.10 + Pillow 12, Android Gradle, JDK 17, Android SDK build tools.

---

## File map

- Create `scripts/generate-xiaoli-icons.py`: deterministic icon composition and output validation.
- Create `tests/icons/test_generate_xiaoli_icons.py`: image dimensions, transparency, safe-zone, and background assertions.
- Modify `assets/icon.png`: generated 1024×1024 legacy launcher icon.
- Modify `assets/adaptive-icon.png`: generated 1024×1024 transparent adaptive foreground.
- Modify `app.json`: set the adaptive icon background color to the approved purple.
- Generate only (ignored): `android/app/src/main/res/mipmap-*/*ic_launcher*` and Gradle APK output.
- Create only as an ignored artifact: `output/releases/3D-Manage-xiaoli-icon-preview-v1.0.0.apk`.

### Task 1: Add a deterministic Xiaoli icon generator

**Files:**
- Create: `tests/icons/test_generate_xiaoli_icons.py`
- Create: `scripts/generate-xiaoli-icons.py`

- [ ] **Step 1: Write the failing generator test**

```python
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
```

- [ ] **Step 2: Run the test and confirm the missing generator fails**

Run:

```powershell
python -m unittest tests/icons/test_generate_xiaoli_icons.py -v
```

Expected: FAIL while loading `scripts/generate-xiaoli-icons.py` because the file does not exist.

- [ ] **Step 3: Implement the generator**

```python
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
```

- [ ] **Step 4: Run the generator test**

Run:

```powershell
python -m unittest tests/icons/test_generate_xiaoli_icons.py -v
```

Expected: one test passes.

- [ ] **Step 5: Commit the tested generator**

```powershell
git add -- scripts/generate-xiaoli-icons.py tests/icons/test_generate_xiaoli_icons.py
git commit -m "test: add reproducible Xiaoli icon generator"
```

### Task 2: Generate and configure the approved launcher art

**Files:**
- Modify: `assets/icon.png`
- Modify: `assets/adaptive-icon.png`
- Modify: `app.json`

- [ ] **Step 1: Generate the two icon assets**

Run:

```powershell
python scripts/generate-xiaoli-icons.py
```

Expected: both PNG files are replaced and remain 1024×1024.

- [ ] **Step 2: Inspect both generated assets visually**

Open `assets/icon.png` and `assets/adaptive-icon.png`. Expected: the legacy icon has a purple gradient behind the Xiaoli portrait; the adaptive foreground has transparent corners and keeps the portrait inside the central safe zone.

- [ ] **Step 3: Set the adaptive background color**

Change the existing Android adaptive configuration in `app.json` to:

```json
"adaptiveIcon": {
  "foregroundImage": "./assets/adaptive-icon.png",
  "backgroundColor": "#5B49B1"
}
```

- [ ] **Step 4: Re-run the focused checks**

Run:

```powershell
python -m unittest tests/icons/test_generate_xiaoli_icons.py -v
node -e "const c=require('./app.json').expo.android.adaptiveIcon;if(c.foregroundImage!=='./assets/adaptive-icon.png'||c.backgroundColor!=='#5B49B1')process.exit(1);console.log(c)"
```

Expected: the Python test passes and Node prints the adaptive icon object.

- [ ] **Step 5: Commit source-of-truth icon changes**

```powershell
git add -- assets/icon.png assets/adaptive-icon.png app.json
git commit -m "feat: use Xiaoli portrait for app icon"
```

### Task 3: Synchronize and verify generated Android launcher resources

**Files:**
- Generate only: `android/app/src/main/res/mipmap-*/*ic_launcher*`

- [ ] **Step 1: Synchronize Expo configuration without reinstalling packages**

Run:

```powershell
npx expo prebuild --platform android --no-install
```

Expected: Expo completes successfully and updates Android launcher resources without deleting the project or reinstalling dependencies.

- [ ] **Step 2: Confirm every expected launcher family exists**

Run:

```powershell
$icons = Get-ChildItem android/app/src/main/res -Recurse -File | Where-Object Name -Match '^ic_launcher(_foreground|_round)?\.(png|webp|xml)$'
$icons | Select-Object FullName,Length
if (-not ($icons.Name -contains 'ic_launcher_foreground.webp')) { throw 'Adaptive foreground resource missing' }
if (-not ($icons.Name -contains 'ic_launcher.webp')) { throw 'Legacy launcher resource missing' }
```

Expected: legacy, round, foreground, and adaptive XML resources are listed; both assertions pass.

- [ ] **Step 3: Confirm Android remains ignored and no unrelated tracked file changed**

Run:

```powershell
git status --short
git check-ignore android/app/src/main/res/mipmap-hdpi/ic_launcher.webp
```

Expected: the Android path is reported as ignored and no unexpected tracked files were introduced by prebuild.

### Task 4: Run release checks and build the standalone APK

**Files:**
- Generate only: `.tmp/release-web/`
- Generate only: `android/app/build/outputs/apk/release/app-release.apk`

- [ ] **Step 1: Run the icon test and project release verification**

Run:

```powershell
python -m unittest tests/icons/test_generate_xiaoli_icons.py -v
npm run verify:release
```

Expected: icon test, client lifecycle test, backend/runtime checks, and Expo web export all pass.

- [ ] **Step 2: Configure the verified local Android toolchain for this process**

```powershell
$env:JAVA_HOME='D:\JDK\JDK17'
$env:ANDROID_HOME='D:\SDK\SDK'
$env:ANDROID_SDK_ROOT='D:\SDK\SDK'
$env:NODE_BINARY='C:\Program Files\nodejs\node.exe'
```

- [ ] **Step 3: Build the release APK**

Run:

```powershell
Set-Location android
.\gradlew.bat assembleRelease --no-daemon
Set-Location ..
```

Expected: Gradle ends with `BUILD SUCCESSFUL` and creates `android/app/build/outputs/apk/release/app-release.apk`.

### Task 5: Publish and verify the local preview artifact

**Files:**
- Create only as an ignored artifact: `output/releases/3D-Manage-xiaoli-icon-preview-v1.0.0.apk`

- [ ] **Step 1: Copy the exact build artifact to the release output directory**

Run:

```powershell
$source = (Resolve-Path 'android/app/build/outputs/apk/release/app-release.apk').Path
$destinationDirectory = (Resolve-Path 'output/releases').Path
$destination = Join-Path $destinationDirectory '3D-Manage-xiaoli-icon-preview-v1.0.0.apk'
Copy-Item -LiteralPath $source -Destination $destination -Force
```

Expected: the named APK exists under `output/releases/`.

- [ ] **Step 2: Verify APK v2/v3 signing**

Run:

```powershell
$apksigner = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Recurse -Filter apksigner.bat | Sort-Object FullName -Descending | Select-Object -First 1
& $apksigner.FullName verify --verbose --print-certs $destination
```

Expected: output includes `Verified using v2 scheme (APK Signature Scheme v2): true`.

- [ ] **Step 3: Record deterministic artifact details**

Run:

```powershell
$artifact = Get-Item -LiteralPath $destination
$hash = Get-FileHash -LiteralPath $destination -Algorithm SHA256
[PSCustomObject]@{
  Path = $artifact.FullName
  Bytes = $artifact.Length
  SHA256 = $hash.Hash
  BuiltAt = $artifact.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz')
} | Format-List
```

Expected: absolute path, non-zero byte count, SHA-256, and build time are printed for handoff.

- [ ] **Step 4: Check whether a device is available without mutating it**

Run:

```powershell
adb devices
```

Expected: if no authorized device is listed, report installation and launcher visual verification as pending. Do not claim a true-device pass.

- [ ] **Step 5: Confirm the APK is not staged for Git**

Run:

```powershell
git status --short
git check-ignore output/releases/3D-Manage-xiaoli-icon-preview-v1.0.0.apk
```

Expected: the APK is ignored and only intentional source changes or unrelated pre-existing user changes remain.
