#!/usr/bin/env python3
"""Assemble the static site from the app and the published sets.

    python3 tools/build_site.py --assets release   # in GitHub Actions: images from Releases
    python3 tools/build_site.py --assets local     # preview, after tools/publish.py --local
    python3 -m http.server -d _site                 # then open http://localhost:8000/

Output (_site/):
    index.html                 list of sets
    <slug>/index.html          the viewer for one set, with link-preview tags
    data/<slug>/layers.json    published manifest (from site/sets/<slug>.json)
    data/<slug>/*.webp, og.jpg images (from the "set-<slug>" release)
    app/, vendor/              the app itself
"""

import argparse
import glob
import html
import json
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def esc(s):
    return html.escape(str(s or ""), quote=True)


def plans_pl(n):
    """1 plan, 2–4 plany, 5+ planów (12–14 planów)."""
    if n == 1:
        return "1 plan"
    few = 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14
    return f"{n} {'plany' if few else 'planów'}"


def set_page(app_html, m, base_url):
    slug = m["slug"]
    title = m.get("title") or slug
    desc = m.get("description") or f"{plans_pl(len(m['layers']))} na tle zdjęć lotniczych"
    page_url = f"{base_url}{slug}/" if base_url else ""
    og_image = f"{base_url}data/{slug}/{m['og']}" if base_url and m.get("og") else ""
    meta = [
        '<base href="../">',
        '<meta name="robots" content="noindex">',
        f'<meta name="description" content="{esc(desc)}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:url" content="{esc(page_url)}">' if page_url else "",
        f'<meta property="og:image" content="{esc(og_image)}">' if og_image else "",
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    config = json.dumps({"set": slug, "base": f"data/{slug}/"})
    out = app_html.replace("<title>Plan Overlay</title>", f"<title>{esc(title)}</title>", 1)
    out = out.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + "\n  ".join(x for x in meta if x), 1)
    out = out.replace('<script type="module"', f"<script>window.PLANY = {config};</script>\n  <script type=\"module\"", 1)
    return out


def index_page(sets):
    cards = "\n".join(
        f'''<li><a href="{esc(m['slug'])}/"><b>{esc(m.get('title') or m['slug'])}</b>
      <span>{esc(m.get('description'))}</span>
      <small>{plans_pl(len(m['layers']))} · aktualizacja {esc(m.get('updated'))}</small></a></li>'''
        for m in sets)
    return f'''<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Plany</title>
  <style>
    :root {{ --bg: #f6f6f4; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: #dcdcd8; --accent: #0a66d8; color-scheme: light dark; }}
    @media (prefers-color-scheme: dark) {{ :root {{ --bg: #1c1c1e; --card: #232325; --text: #f2f2f7; --muted: #a1a1a6; --line: #3a3a3c; --accent: #4c9bff; }} }}
    body {{ margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    main {{ max-width: 720px; margin: 0 auto; padding: 32px 16px; }}
    h1 {{ font-size: 22px; margin: 0 0 4px; }}
    p {{ color: var(--muted); margin: 0 0 20px; }}
    ul {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }}
    a {{ display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px;
         background: var(--card); color: inherit; text-decoration: none; }}
    a:hover {{ border-color: var(--accent); }}
    span {{ color: var(--muted); }}
    small {{ color: var(--muted); }}
  </style>
</head>
<body>
<main>
  <h1>Plany</h1>
  <p>Plany i projekty nałożone na aktualne zdjęcia lotnicze.</p>
  <ul>
{cards}
  </ul>
</main>
</body>
</html>
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "_site"))
    ap.add_argument("--assets", choices=["release", "local", "none"], default="release")
    ap.add_argument("--base-url", default="", help="absolute site URL, for link previews")
    args = ap.parse_args()
    base_url = args.base_url.rstrip("/") + "/" if args.base_url else ""

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    os.makedirs(args.out)
    shutil.copytree(os.path.join(ROOT, "app"), os.path.join(args.out, "app"))
    # pdf.js is only needed for adding plans, which the published viewer can't do.
    shutil.copytree(os.path.join(ROOT, "vendor"), os.path.join(args.out, "vendor"), ignore=shutil.ignore_patterns("pdfjs"))
    open(os.path.join(args.out, ".nojekyll"), "w").close()
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        app_html = f.read()

    manifests = {os.path.basename(p)[:-5]: p for p in glob.glob(os.path.join(ROOT, "site", "sets", "*.json"))}
    if args.assets == "local":  # local previews (tools/publish.py --local) win
        manifests.update({os.path.basename(os.path.dirname(p)): p for p in glob.glob(os.path.join(ROOT, "build", "*", "manifest.json"))})

    sets = []
    for path in sorted(manifests.values()):
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        slug = m["slug"]
        data = os.path.join(args.out, "data", slug)
        os.makedirs(data)
        shutil.copy(path, os.path.join(data, "layers.json"))
        if not m.get("files"):  # images hosted here, not on an overflow site
            if args.assets == "release":
                subprocess.run(["gh", "release", "download", f"set-{slug}", "--dir", data,
                                "--pattern", "*.webp", "--pattern", "og.jpg"], check=True)
            elif args.assets == "local":
                src = os.path.join(ROOT, "build", slug, "assets")
                for f in glob.glob(os.path.join(src, "*.webp")) + glob.glob(os.path.join(src, "og.jpg")):
                    shutil.copy(f, data)
        os.makedirs(os.path.join(args.out, slug))
        with open(os.path.join(args.out, slug, "index.html"), "w", encoding="utf-8") as f:
            f.write(set_page(app_html, m, base_url))
        sets.append(m)
        print(f"set {slug}: {len(m['layers'])} plan(s)")

    sets.sort(key=lambda m: m.get("updated") or "", reverse=True)
    with open(os.path.join(args.out, "index.html"), "w", encoding="utf-8") as f:
        f.write(index_page(sets))
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(args.out) for f in fs)
    print(f"site: {size / 1e6:.1f} MB in {args.out}")


if __name__ == "__main__":
    main()
