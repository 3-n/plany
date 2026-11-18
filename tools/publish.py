#!/usr/bin/env python3
"""Publish one plan set to the GitHub Pages site.

    python3 tools/publish.py metro-minska            # build, upload, commit, push
    python3 tools/publish.py metro-minska --no-push  # build + upload + commit only
    python3 tools/publish.py metro-minska --local    # only build files for a local preview

What it does:
  1. For every georeferenced plan, renders two WebP images from the best source
     available (the original image if it is a raster, else the working raster),
     cropped to the plan's crop mask if it has one:
       <id>.web.webp     ≤ 8192 px, for desktops
       <id>.mobile.webp  ≤ 4096 px, for phones (memory and canvas limits)
  2. Uploads them, a link-preview image and the original files to the GitHub
     Release "set-<slug>". Releases are not part of git history, so the repo
     stays small; unchanged files are not uploaded again.
  3. Writes site/sets/<slug>.json (the published manifest, a few kB), commits
     it and pushes. The Pages workflow then builds and deploys the site.

Needs: cwebp (brew install webp), gh (logged in), git. macOS sips for the preview image.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SITE_SETS = os.path.join(ROOT, "site", "sets")
BUILD = os.path.join(ROOT, "build")
RASTER_EXT = {"png", "jpg", "jpeg", "tif", "tiff", "webp"}
VARIANTS = {"web": 8192, "mobile": 4096}
QUALITY = 75  # WebP q75: visually on par with JPEG q80 at ~40% less size on plan sheets
CACHE_VERSION = 1


def run(cmd, **kw):
    kw.setdefault("check", True)
    return subprocess.run(cmd, **kw)


def out(cmd):
    return run(cmd, capture_output=True, text=True).stdout.strip()


def ascii_name(name):
    """Release asset names must be plain ASCII; GitHub mangles anything else."""
    name = name.replace("ł", "l").replace("Ł", "L")
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")
    return name or "file"


def image_size(path):
    info = out(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path])
    return int(re.search(r"pixelWidth: (\d+)", info)[1]), int(re.search(r"pixelHeight: (\d+)", info)[1])


def georeferenced(layer):
    return sum(1 for p in layer.get("points") or [] if p.get("img") and p.get("world") and p.get("enabled", True)) >= 2


def crop_box(layer):
    """Bounding box of the crop mask in layer pixels, with a small margin."""
    mask = layer.get("mask")
    if not mask or len(mask) < 3:
        return None
    w, h = layer["width"], layer["height"]
    pad = 0.005 * max(w, h)
    xs, ys = [p[0] for p in mask], [p[1] for p in mask]
    box = [max(0, int(min(xs) - pad)), max(0, int(min(ys) - pad)), min(w, int(max(xs) + pad + 1)), min(h, int(max(ys) + pad + 1))]
    if (box[2] - box[0]) * (box[3] - box[1]) > 0.9 * w * h:
        return None  # not worth it
    return box


def pick_source(set_dir, layer):
    """The sharpest raster that matches the working raster's shape, and its scale to layer pixels."""
    candidates = []
    src = layer.get("source")
    if src and src.rsplit(".", 1)[-1].lower() in RASTER_EXT and not layer.get("sourcePage"):
        candidates.append(os.path.join(set_dir, src))
    candidates.append(os.path.join(set_dir, layer["image"]))
    for path in candidates:
        if not os.path.isfile(path):
            continue
        w, h = image_size(path)
        if abs(w / h - layer["width"] / layer["height"]) < 0.005:
            return path, w / layer["width"]
    sys.exit(f"No usable image for {layer['name']}")


def file_key(*parts):
    return hashlib.sha1(json.dumps(parts).encode()).hexdigest()[:16]


def render_variants(set_dir, layer, assets, cache):
    path, scale = pick_source(set_dir, layer)
    crop = crop_box(layer)
    x0, y0, x1, y1 = crop or [0, 0, layer["width"], layer["height"]]
    sx, sy, sw, sh = (round(v * scale) for v in (x0, y0, x1 - x0, y1 - y0))
    st = os.stat(path)
    names = {}
    for variant, max_px in VARIANTS.items():
        name = f"{layer['id']}.{variant}.webp"
        dest = os.path.join(assets, name)
        k = file_key(CACHE_VERSION, path, st.st_size, st.st_mtime, crop, QUALITY, max_px)
        if cache.get(name) != k or not os.path.exists(dest):
            f = min(1, max_px / max(sw, sh))
            cmd = ["cwebp", "-quiet", "-mt", "-q", str(QUALITY), "-m", "5"]
            if crop:
                cmd += ["-crop", str(sx), str(sy), str(sw), str(sh)]
            if f < 1:
                cmd += ["-resize", str(round(sw * f)), str(round(sh * f))]
            print(f"  {variant:6} {layer['name']}")
            run(cmd + [path, "-o", dest])
            cache[name] = k
        names[variant] = name
    return names, crop


def gh_release_assets(tag):
    r = run(["gh", "release", "view", tag, "--json", "assets"], capture_output=True, text=True, check=False)
    if r.returncode != 0:
        return None
    return {a["name"]: a["size"] for a in json.loads(r.stdout)["assets"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("set")
    ap.add_argument("--local", action="store_true", help="only build files, no upload/commit (for tools/build_site.py --assets local)")
    ap.add_argument("--no-push", action="store_true")
    args = ap.parse_args()

    set_dir = os.path.join(DATA, args.set)
    with open(os.path.join(set_dir, "layers.json"), encoding="utf-8") as f:
        doc = json.load(f)
    if not shutil.which("cwebp"):
        sys.exit("cwebp not found: brew install webp")

    repo = None
    if not args.local:
        repo = out(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    tag = f"set-{args.set}"
    assets = os.path.join(BUILD, args.set, "assets")
    os.makedirs(assets, exist_ok=True)
    cache_path = os.path.join(BUILD, args.set, "cache.json")
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}

    layers, uploads = [], []
    for layer in doc["layers"]:
        if not georeferenced(layer):
            print(f"skip (not georeferenced): {layer['name']}")
            continue
        names, crop = render_variants(set_dir, layer, assets, cache)
        uploads += [os.path.join(assets, n) for n in names.values()]
        with open(os.path.join(assets, names["web"]), "rb") as f:
            rev = hashlib.sha1(f.read()).hexdigest()[:8]
        pub = {
            "id": layer["id"], "name": layer["name"], "width": layer["width"], "height": layer["height"],
            "points": [{"img": p["img"], "world": p["world"]} for p in layer["points"]
                       if p.get("img") and p.get("world") and p.get("enabled", True)],
            "method": layer.get("method", "auto"), "mask": layer.get("mask"), "crop": crop,
            "opacity": layer.get("opacity", 0.7), "display": layer.get("display", "multiply"),
            "visible": layer.get("visible", True), "rev": rev, "images": names,
        }
        src = layer.get("source")
        if src and os.path.isfile(os.path.join(set_dir, src)):
            orig = os.path.join(set_dir, src)
            asset = f"{layer['id']}-{ascii_name(layer.get('sourceName') or os.path.basename(src))}"
            link = os.path.join(assets, asset)
            if os.path.exists(link):
                os.remove(link)
            os.link(orig, link)
            uploads.append(link)
            if repo:
                pub["download"] = {"url": f"https://github.com/{repo}/releases/download/{tag}/{asset}",
                                   "name": layer.get("sourceName") or asset, "size": os.path.getsize(orig)}
        layers.append(pub)
    if not layers:
        sys.exit("Nothing to publish: georeference at least one plan first.")

    # Link-preview image (Messenger, WhatsApp, Slack…): the first visible plan.
    first = next((l for l in layers if l["visible"]), layers[0])
    og = os.path.join(assets, "og.jpg")
    run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "1200",
         os.path.join(assets, first["images"]["mobile"]), "--out", og], capture_output=True)
    uploads.append(og)
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=1)

    manifest = {
        "version": 1, "slug": args.set, "title": doc.get("title") or args.set,
        "description": doc.get("description") or "", "og": "og.jpg", "layers": layers,
    }
    # A local preview must not touch site/sets/ (tracked by git = public on push).
    target = os.path.join(BUILD, args.set, "manifest.json") if args.local else os.path.join(SITE_SETS, f"{args.set}.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    old = json.load(open(target, encoding="utf-8")) if os.path.exists(target) else None
    if old and {k: v for k, v in old.items() if k != "updated"} == manifest:
        manifest["updated"] = old.get("updated")
    else:
        manifest["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")

    total = sum(os.path.getsize(p) for p in uploads if p.endswith(".webp"))
    print(f"{len(layers)} plan(s), {total / 1e6:.1f} MB of map images")
    if args.local:
        print("Built locally. Preview: python3 tools/build_site.py --assets local && python3 -m http.server -d _site")
        return

    # Upload to the set's release, skipping files that are already there unchanged.
    existing = gh_release_assets(tag)
    if existing is None:
        run(["gh", "release", "create", tag, "--title", f"Plan set: {manifest['title']}",
             "--notes", f"Files for the published plan set `{args.set}`: map images and original documents.",
             "--latest=false"])
        existing = {}
    wanted = {os.path.basename(p): p for p in uploads}
    changed = [p for n, p in wanted.items() if existing.get(n) != os.path.getsize(p) or n == "og.jpg"]
    if changed:
        print(f"Uploading {len(changed)} file(s), {sum(map(os.path.getsize, changed)) / 1e6:.1f} MB…")
        run(["gh", "release", "upload", tag, "--clobber", *changed])
    for stale in set(existing) - set(wanted):
        run(["gh", "release", "delete-asset", tag, stale, "--yes"])

    rel = os.path.relpath(target, ROOT)
    run(["git", "-C", ROOT, "add", rel])
    committed = run(["git", "-C", ROOT, "commit", "-m", f"Publish {args.set}", "--", rel], capture_output=True, check=False).returncode == 0
    if args.no_push:
        print("Committed; push to deploy." if committed else "Manifest unchanged.")
        return
    run(["git", "-C", ROOT, "push"])
    if not committed:
        run(["gh", "workflow", "run", "pages.yml"])  # files changed but the manifest didn't
    owner, name = repo.split("/")
    print(f"Deploying… live in a minute or two at https://{owner.lower()}.github.io/{name}/{args.set}/")


if __name__ == "__main__":
    main()
