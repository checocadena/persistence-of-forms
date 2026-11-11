#!/usr/bin/env python3
"""
Build the press kit: writes the high-res JPEGs, fills proposal.html with
details.json, and prints the PDF with headless Chrome.

  python3 proposal/build.py

Same build as the Muse Port kit. The difference: these stills are real frames
of the piece (submission/), so they are converted or copied at their own size
instead of rendered. A still that is a media/*.html page is still rendered at
1920x1080, captured at 2x, as before. The look is the piece's own.
"""
import json
import os
import shutil
import subprocess
import tempfile
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

with open(os.path.join(HERE, "details.json")) as f:
    D = json.load(f)
F = D["fields"]


def chrome(*args):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", *args],
                   check=True, capture_output=True)


def to_jpeg(src, out):
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "95", src, "--out", out],
                   check=True, capture_output=True)


# 1. Stills, named "<title> - <artist> - <n>.jpg". Never upscaled.
images = []
for n, still in enumerate(D["stills"], 1):
    src = os.path.normpath(os.path.join(HERE, still["src"]))
    name = f'{D["title"]} - {F["ARTIST"]} - {n}.jpg'
    out = os.path.join(HERE, name)
    ext = os.path.splitext(src)[1].lower()
    if ext == ".html":
        with tempfile.TemporaryDirectory() as tmp:
            png = os.path.join(tmp, "still.png")
            chrome("--hide-scrollbars", "--window-size=1920,1080", "--force-device-scale-factor=2",
                   f"--screenshot={png}", "file://" + quote(src))
            to_jpeg(png, out)
    elif ext in (".jpg", ".jpeg"):
        shutil.copyfile(src, out)  # already a JPEG: copy it, no second compression
    else:
        to_jpeg(src, out)  # e.g. a PNG frame, converted at its own size
    images.append(name)
    print("wrote", name)

# 2. PDF
page = open(os.path.join(HERE, "proposal.html")).read()
fills = dict(F, **{f"IMG{n}": quote(name) for n, name in enumerate(images, 1)})
for key, value in fills.items():
    page = page.replace("{{" + key + "}}", value)
assert "{{" not in page, "unfilled field in proposal.html: " + page[page.index("{{"):][:40]

with tempfile.NamedTemporaryFile("w", suffix=".html", dir=HERE, delete=False) as tmp:
    tmp.write(page)
out = os.path.join(HERE, D["pdf"])
try:
    chrome("--no-pdf-header-footer", f"--print-to-pdf={out}", "file://" + quote(tmp.name))
finally:
    os.unlink(tmp.name)
print("wrote", out)
