# Visual Experience 2.0: contact sheets of the native Notch captures (for review; the PNGs themselves are the evidence).
import sys
from pathlib import Path
from PIL import Image, ImageDraw
shots = Path(sys.argv[1]); out = Path(sys.argv[2])
ids = "clay cybercore brutalism scrapbook surreal y2k pixel synthwave glass neumorph bento editorial swiss minimal maximal luxury sketch ethereal bohemian victorian cyberpunk wabisabi".split()
def sheet(suffix, cols, name):
    ims = [(i, Image.open(shots / f"{i}-{suffix}.png").convert("RGB")) for i in ids if (shots / f"{i}-{suffix}.png").exists()]
    w = max(im.width for _, im in ims) + 20; h = max(im.height for _, im in ims) + 34
    rows = (len(ims) + cols - 1) // cols
    canvas = Image.new("RGB", (w * cols, h * rows), (128, 128, 128)); d = ImageDraw.Draw(canvas)
    for n, (i, im) in enumerate(ims):
        x, y = (n % cols) * w + 10, (n // cols) * h + 4
        d.text((x, y), f"{i}-{suffix}", fill=(255, 255, 255)); canvas.paste(im, (x, y + 22))
    canvas.save(out / name); print(name, canvas.size)
for suffix, cols in [("top", 2), ("bottom", 2), ("left", 11), ("right", 11), ("top-expanded", 4)]:
    sheet(suffix, cols, f"sheet-{suffix}.png")
