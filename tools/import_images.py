#!/usr/bin/env python3
"""Add plan images (PNG, JPEG, TIFF) to a set from the command line.

    python3 tools/import_images.py metro-minska "E02 Mińska"/*.png --title "Metro M3 – stacja Mińska"

Each file is kept as the original (data/<set>/sources/) and gets a working raster
of at most 8192 px (data/<set>/layers/) for georeferencing in the app. PDFs are
better added in the app, which lets you pick pages and resolution.
Uses only macOS's built-in `sips`.
"""

import argparse
import json
import os
import random
import re
import shutil
import string
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def new_id():
    def base36(n):
        digits = string.digits + string.ascii_lowercase
        out = ""
        while n:
            n, r = divmod(n, 36)
            out = digits[r] + out
        return out or "0"
    return "p" + base36(int(time.time() * 1000)) + "".join(random.choices(string.digits + string.ascii_lowercase, k=4))


def image_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"pixelWidth: (\d+)", out)[1]), int(re.search(r"pixelHeight: (\d+)", out)[1])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("set", help="set slug, e.g. metro-minska (created if missing)")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--title", help="set title (for a new set, or to rename)")
    ap.add_argument("--max", type=int, default=8192, help="working raster size in px (default 8192)")
    args = ap.parse_args()

    if not re.match(r"^[a-z0-9][a-z0-9-]{0,47}$", args.set):
        sys.exit("Set slug: lowercase letters, digits and dashes.")
    set_dir = os.path.join(DATA, args.set)
    manifest = os.path.join(set_dir, "layers.json")
    for sub in ("layers", "sources"):
        os.makedirs(os.path.join(set_dir, sub), exist_ok=True)
    doc = {"version": 1, "title": args.title or args.set, "description": "", "layers": []}
    if os.path.exists(manifest):
        with open(manifest, encoding="utf-8") as f:
            doc = json.load(f)
        if args.title:
            doc["title"] = args.title

    for path in args.files:
        ext = os.path.splitext(path)[1].lower().lstrip(".")
        if ext not in ("png", "jpg", "jpeg", "tif", "tiff"):
            print(f"skip {path}: not an image (add PDFs in the app)")
            continue
        lid = new_id()
        source = f"sources/{lid}.{ext}"
        image = f"layers/{lid}.jpg"
        shutil.copy2(path, os.path.join(set_dir, source))
        subprocess.run(["sips", "-Z", str(args.max), "-s", "format", "jpeg", "-s", "formatOptions", "88",
                        path, "--out", os.path.join(set_dir, image)], capture_output=True, check=True)
        w, h = image_size(os.path.join(set_dir, image))
        name = os.path.splitext(os.path.basename(path))[0]
        doc["layers"].append({
            "id": lid, "name": name, "image": image, "source": source, "sourceName": os.path.basename(path),
            "sourcePage": None, "dpi": None, "width": w, "height": h, "points": [], "method": "auto",
            "mask": None, "opacity": 0.7, "display": "multiply", "visible": True,
            "created": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "rev": 1,
        })
        print(f"added {name}  ({w}×{h} working raster)")
        time.sleep(0.002)  # distinct ids

    tmp = manifest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    os.replace(tmp, manifest)
    print(f"Open http://localhost:8765/?set={args.set} to georeference.")


if __name__ == "__main__":
    main()
