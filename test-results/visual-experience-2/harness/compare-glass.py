# Visual Experience 2.0: automated screenshot comparison of the default theme (Glassmorphism) against the T13.3 baseline
# captured at 0eb58e6 (baseline/shots/current-<variant>-<surface>.png) with the same harness, fixture Host and viewport.
# For each surface: the share of pixels whose max channel difference exceeds 24/255, the bounding box of the changed area,
# and a diff image (changed pixels in magenta over a dimmed copy of the new frame). Live data (clock, "updated" times,
# fixture ids) differs between runs, so the result is a measured difference, not a pass/fail by itself.
# Usage: python compare-glass.py <baseline-shots> <matrix-root> <out-dir>
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

base, matrix, out = (Path(p) for p in sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
SURFACES = ["dashboard", "missions", "studio", "settings", "approvals", "activity", "files", "projects", "models", "devices", "phone"]
rows = []
for variant, folder in (("light", "default-light"), ("dark", "alt-dark")):
    for surface in SURFACES:
        old_path = base / f"current-{variant}-{surface}.png"
        new_path = matrix / folder / f"glass-{variant}-{surface}.png"
        if not (old_path.exists() and new_path.exists()):
            continue
        old = Image.open(old_path).convert("RGB")
        new = Image.open(new_path).convert("RGB")
        if old.size != new.size:
            rows.append({"variant": variant, "surface": surface, "sizeMismatch": [old.size, new.size]})
            continue
        diff = ImageChops.difference(old, new)
        mask = diff.convert("L").point(lambda v: 255 if v > 24 else 0)
        changed = sum(1 for v in mask.getdata() if v)
        total = old.size[0] * old.size[1]
        overlay = Image.blend(new, Image.new("RGB", new.size, (0, 0, 0)), 0.55)
        overlay.paste(Image.new("RGB", new.size, (255, 0, 255)), mask=mask)
        overlay.save(out / f"diff-glass-{variant}-{surface}.png")
        rows.append({"variant": variant, "surface": surface, "changedPercent": round(100 * changed / total, 3), "changedBox": mask.getbbox()})
        print(f"{variant:5} {surface:10} {rows[-1]['changedPercent']:7.3f}%  box={rows[-1]['changedBox']}")
(out / "compare-glass.json").write_text(json.dumps({"threshold": 24, "baseline": str(base), "rows": rows}, indent=2))
