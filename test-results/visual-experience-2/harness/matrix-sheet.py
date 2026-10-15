# Visual Experience 2.0: per-surface contact sheets of the capture matrix for human visual review (22 themes each, default
# appearance). The individual PNGs are the evidence; the sheets only make side-by-side review possible.
# Usage: python matrix-sheet.py <evidence-root>
import sys
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(sys.argv[1]); out = root / "sheets"; out.mkdir(exist_ok=True)
ids = "clay cybercore brutalism scrapbook surreal y2k pixel synthwave glass neumorph bento editorial swiss minimal maximal luxury sketch ethereal bohemian victorian cyberpunk wabisabi".split()
dark = {"cybercore", "surreal", "pixel", "synthwave", "luxury", "victorian", "cyberpunk"}
def find(i, surface):
    if surface == "preview": return root / "previews" / f"{i}-preview.png"
    v = "dark" if i in dark else "light"
    return root / "matrix" / f"default-{v}" / f"{i}-{v}-{surface}.png"
for surface, cols, thumb in [("dashboard", 4, 480), ("studio", 4, 480), ("missions", 4, 480), ("settings", 4, 480), ("preview", 4, 480), ("phone", 8, 200)]:
    ims = []
    for i in ids:
        p = find(i, surface)
        if p.exists():
            im = Image.open(p).convert("RGB"); im.thumbnail((thumb, thumb * 2)); ims.append((i, im))
    w = max(im.width for _, im in ims) + 8; h = max(im.height for _, im in ims) + 22
    sheet = Image.new("RGB", (w * cols, h * ((len(ims) + cols - 1) // cols)), (90, 90, 90)); d = ImageDraw.Draw(sheet)
    for n, (i, im) in enumerate(ims):
        x, y = (n % cols) * w + 4, (n // cols) * h + 2
        d.text((x, y), i, fill=(255, 255, 255)); sheet.paste(im, (x, y + 16))
    sheet.save(out / f"sheet-{surface}.png"); print(surface, len(ims), sheet.size)
