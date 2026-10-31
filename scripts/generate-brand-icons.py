#!/usr/bin/env python3
"""Generate validated raster brand assets from the source SVG."""
from pathlib import Path
from io import BytesIO
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "public" / "tsumu-mark.svg"

def render(size: int, destination: Path) -> None:
    png = cairosvg.svg2png(url=str(source), output_width=size, output_height=size)
    with Image.open(BytesIO(png)) as image:
        image.load()
        assert image.size == (size, size)
        assert image.mode == "RGBA"
        image.save(destination, format="PNG", optimize=True)
    with Image.open(destination) as image:
        image.verify()
    print(f"Generated and verified {destination.relative_to(ROOT)}")

render(512, ROOT / "public" / "tsumu-icon.png")
render(180, ROOT / "app" / "apple-icon.png")
