"""Derive Bunny A T13 runtime character assets from the user-supplied composite.

Provenance tool, not a runtime dependency. Run with: python -I assets/t13/derive_assets.py
Inputs: assets/t13/source/bunny-a-showcase-original.png (byte-identical copy of the
user's "Bunny A Futuristic AI Interface Showcase.png", sha256 recorded in manifest).
Outputs (all derivatives of that one source; no other artwork is used):
  assets/t13/derived/<id>.png        opaque native-resolution crop ("well" form)
  assets/t13/derived/<id>.alpha.png  same crop with a background-unblended alpha matte
  public/bunny-a/characters/<id>.png runtime copy of the alpha form
  assets/t13/derived/manifest.json   rectangles, masks, processing, hashes
Processing is limited to: crop, rectangular exclusion of overlapping UI-chip text,
alpha estimation against the dark navy board background, and edge feathering.
No pixels are synthesized, repainted, upscaled or recoloured.
"""

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, "assets", "t13", "source", "bunny-a-showcase-original.png")
DERIVED = os.path.join(ROOT, "assets", "t13", "derived")
RUNTIME = os.path.join(ROOT, "public", "bunny-a", "characters")
EXPECTED_SOURCE_SHA256 = "e390442a70b8c6620f37d9b59b48260e864e051b838185bac5ef70cb631fc7fd"

# Crops whose board neighbourhood holds UI-chip fragments drop more of the dim haze so the
# excluded rectangles do not read as holes in the glow.
HAZE_FLOOR = {"spear.hero": 0.16, "sword.hero": 0.16}

# (id, (x0, y0, x1, y1) exclusive, exclusions[(x0, y0, x1, y1)], role, note)
CROPS = [
    ("bunny.idle", (1150, 765, 1231, 844), [], "bunny-state", "Companion States board: Idle"),
    ("bunny.listening", (1244, 765, 1325, 844), [], "bunny-state", "Companion States board: Listening"),
    ("bunny.speaking", (1337, 765, 1420, 844), [], "bunny-state", "Companion States board: Speaking"),
    ("bunny.thinking", (1432, 765, 1517, 844), [], "bunny-state", "Companion States board: Thinking"),
    ("bunny.interrupted", (1150, 878, 1231, 958), [], "bunny-state", "Companion States board: Interrupted"),
    ("bunny.happy", (1244, 878, 1325, 958), [], "bunny-state", "Companion States board: Happy"),
    ("bunny.sleeping", (1337, 878, 1420, 958), [], "bunny-state", "Companion States board: Sleeping"),
    ("bunny.processing", (1432, 878, 1517, 958), [], "bunny-state", "Companion States board: Processing"),
    ("bunny.hero", (1143, 124, 1262, 250), [], "bunny-hero", "Mobile home screen hero"),
    ("gada.hero", (38, 809, 280, 944), [], "weapon-hero", "Gada panel hero"),
    ("gada.portrait", (1345, 118, 1510, 245), [], "weapon-portrait", "Mobile Agent Details hero"),
    ("gada.pose1", (30, 947, 87, 996), [], "weapon-pose", "Gada pose tile 1"),
    ("gada.pose2", (95, 947, 136, 996), [], "weapon-pose", "Gada pose tile 2"),
    ("gada.pose3", (143, 947, 185, 996), [], "weapon-pose", "Gada pose tile 3"),
    ("gada.pose4", (192, 947, 235, 996), [], "weapon-pose", "Gada pose tile 4"),
    ("gada.pose5", (242, 947, 294, 996), [], "weapon-pose", "Gada pose tile 5"),
    ("gada.compact", (1118, 288, 1152, 350), [], "weapon-compact", "Mobile home agent row"),
    ("spear.hero", (461, 766, 516, 934), [(461, 786, 475, 815), (500, 786, 516, 815)], "weapon-hero",
     "Spear panel faced hero; Testing/Complete chip fragments excluded"),
    ("spear.alt", (344, 808, 400, 936), [], "weapon-alt", "Spear panel second hero (no face)"),
    ("spear.pose1", (317, 937, 363, 996), [], "weapon-pose", "Spear pose tile 1"),
    ("spear.pose2", (369, 937, 413, 996), [], "weapon-pose", "Spear pose tile 2"),
    ("spear.pose3", (427, 937, 466, 996), [], "weapon-pose", "Spear pose tile 3"),
    ("spear.pose4", (472, 937, 509, 996), [], "weapon-pose", "Spear pose tile 4"),
    ("spear.pose5", (515, 937, 557, 996), [], "weapon-pose", "Spear pose tile 5"),
    ("spear.compact", (1162, 288, 1191, 350), [], "weapon-compact", "Mobile home agent row"),
    ("chakra.hero", (586, 834, 702, 931), [], "weapon-hero", "Vishnu Chakra panel hero (unobstructed)"),
    ("chakra.pose1", (580, 935, 631, 996), [], "weapon-pose", "Chakra pose tile 1"),
    ("chakra.pose2", (637, 935, 696, 996), [], "weapon-pose", "Chakra pose tile 2"),
    ("chakra.pose3", (704, 935, 766, 996), [], "weapon-pose", "Chakra pose tile 3"),
    ("chakra.pose4", (772, 935, 835, 996), [], "weapon-pose", "Chakra pose tile 4"),
    ("chakra.compact", (1198, 293, 1247, 347), [], "weapon-compact", "Mobile home agent row"),
    ("sword.hero", (1014, 767, 1092, 934), [(1014, 784, 1037, 816), (1068, 784, 1092, 816)], "weapon-hero",
     "Sword panel faced hero; Testing/Complete chip fragments excluded"),
    ("sword.alt1", (866, 836, 914, 934), [], "weapon-alt", "Sword panel hero 1"),
    ("sword.alt2", (938, 836, 986, 934), [], "weapon-alt", "Sword panel hero 2"),
    ("sword.pose1", (859, 937, 916, 995), [], "weapon-pose", "Sword pose tile 1"),
    ("sword.pose2", (923, 937, 985, 995), [], "weapon-pose", "Sword pose tile 2"),
    ("sword.pose3", (992, 937, 1043, 995), [], "weapon-pose", "Sword pose tile 3"),
    ("sword.pose4", (1050, 937, 1110, 995), [], "weapon-pose", "Sword pose tile 4"),
    ("sword.compact", (1254, 288, 1282, 350), [], "weapon-compact", "Mobile home agent row"),
]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def feather(h, w, px):
    ys = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
    xs = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
    d = np.minimum(ys, xs).astype(np.float64)
    return np.clip(d / px, 0.0, 1.0)


def soften(mask, r):
    """Separable box blur so excluded rectangles fade instead of leaving hard holes."""
    k = np.ones(2 * r + 1) / (2 * r + 1)
    m = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, "valid"), 0, mask)
    m = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), k, "valid"), 1, m)
    return np.minimum(m, mask + (1 - mask) * m)


def matte(rgb, exclusions_local, floor=0.02):
    """Alpha from luminance above the local dark background, then unblend colour."""
    f = rgb.astype(np.float64) / 255.0
    h, w, _ = f.shape
    border = np.concatenate([f[0, :], f[-1, :], f[:, 0], f[:, -1]])
    bg = np.percentile(border, 20, axis=0)  # dark navy board colour near this crop
    lum = f.max(axis=2)
    bg_l = float(bg.max())
    alpha = np.clip((lum - bg_l - floor) / 0.30, 0.0, 1.0) ** 0.85
    alpha *= feather(h, w, 4.0)
    if exclusions_local:
        keep = np.ones((h, w))
        for (x0, y0, x1, y1) in exclusions_local:
            keep[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0.0
        alpha *= soften(keep, 2)
    a = np.maximum(alpha, 1e-4)[..., None]
    col = np.clip(bg + (f - bg) / a, 0.0, 1.0)
    col = np.where(alpha[..., None] > 1e-3, col, 0.0)
    out = np.dstack([col, alpha])
    return (out * 255.0 + 0.5).astype(np.uint8)


def main():
    src_hash = sha256_file(SOURCE)
    if src_hash != EXPECTED_SOURCE_SHA256:
        sys.exit(f"source hash mismatch: {src_hash}")
    os.makedirs(DERIVED, exist_ok=True)
    os.makedirs(RUNTIME, exist_ok=True)
    im = Image.open(SOURCE).convert("RGB")
    entries = []
    for cid, (x0, y0, x1, y1), excl, role, note in CROPS:
        crop = im.crop((x0, y0, x1, y1))
        opaque = np.asarray(crop).copy()
        local = [(ex0 - x0, ey0 - y0, ex1 - x0, ey1 - y0) for (ex0, ey0, ex1, ey1) in excl]
        for (lx0, ly0, lx1, ly1) in local:
            # Exclusions in the opaque form are filled with the crop's own darkest border tone.
            border = np.concatenate([opaque[0], opaque[-1], opaque[:, 0], opaque[:, -1]])
            fill = np.percentile(border, 10, axis=0).astype(np.uint8)
            opaque[max(0, ly0):ly1, max(0, lx0):lx1] = fill
        rgba = matte(np.asarray(crop), local, HAZE_FLOOR.get(cid, 0.02))
        p_opaque = os.path.join(DERIVED, f"{cid}.png")
        p_alpha = os.path.join(DERIVED, f"{cid}.alpha.png")
        p_runtime = os.path.join(RUNTIME, f"{cid}.png")
        Image.fromarray(opaque, "RGB").save(p_opaque, optimize=True)
        Image.fromarray(rgba, "RGBA").save(p_alpha, optimize=True)
        Image.fromarray(rgba, "RGBA").save(p_runtime, optimize=True)
        entries.append({
            "id": cid,
            "role": role,
            "note": note,
            "sourceRect": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
            "exclusions": [{"x": a, "y": b, "width": c - a, "height": d - b} for (a, b, c, d) in excl],
            "opaque": {"path": os.path.relpath(p_opaque, ROOT).replace(os.sep, "/"), "sha256": sha256_file(p_opaque)},
            "alpha": {"path": os.path.relpath(p_alpha, ROOT).replace(os.sep, "/"), "sha256": sha256_file(p_alpha)},
            "runtime": {"path": os.path.relpath(p_runtime, ROOT).replace(os.sep, "/"), "sha256": sha256_file(p_runtime)},
        })
    manifest = {
        "schema": "bunny-a.t13.character-assets.v1",
        "source": {
            "path": "assets/t13/source/bunny-a-showcase-original.png",
            "originalName": "Bunny A Futuristic AI Interface Showcase.png",
            "suppliedBy": "user (local Downloads, 2026-10-12)",
            "width": im.width,
            "height": im.height,
            "sha256": src_hash,
        },
        "tooling": {"python": sys.version.split()[0], "pillow": Image.__version__, "numpy": np.__version__},
        "processing": [
            "crop at native resolution (no resampling)",
            "rectangular exclusion of overlapping board UI-chip fragments where listed",
            "alpha = clip((max(R,G,B) - bg - floor) / 0.30)^0.85, bg = 20th percentile of crop border, floor 0.02 (0.16 for spear.hero/sword.hero)",
            "colour unblended against bg where alpha > 0; 4 px edge feather; exclusions box-blurred 2 px",
            "usage rule: dark visors/faces key toward transparent, so art is always composited on a dark character well",
        ],
        "assets": entries,
    }
    with open(os.path.join(DERIVED, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"derived {len(entries)} assets from {src_hash[:12]}")


if __name__ == "__main__":
    main()
