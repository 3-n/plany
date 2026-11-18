# Plan Overlay

Put traffic-organisation plans (*stała organizacja ruchu*) and street designs on
current aerial photos. Plans can be PDFs, scans or photos. You can then check how
a plan fits the street as it is today.

Everything runs locally. The only network traffic is fetching the map imagery.

## Run

Double-click `start.command`, or run:

```sh
python3 server.py          # opens http://localhost:8765 in Safari
```

The only dependency is the macOS system Python, with no packages to install.
Leaflet, pdf.js and proj4 are vendored in `vendor/`.

## Workflow

1. **+ Add plan**: pick a PDF (choose page and resolution) or an image (JPG, PNG, TIFF).
   PDFs are rasterised in the browser. 200 dpi is a good default for scans, and
   "All pages" adds each sheet as its own plan.
2. **Georeference** (split screen: plan on the left, map on the right): click a sharp
   spot on the plan, then the same spot on the map. Repeat.
   - After 2 points the plan appears on the map. After that, clicking the plan pans the
     map to where the point should be, and a dashed ghost marker shows the guess.
   - Use 4–6 points spread towards the sheet corners. The **Error** column shows each
     point's residual. A red value usually means the point was misplaced, so drag the
     marker or untick it.
   - **Grid crosses**: if the plan has a coordinate grid (common on *mapa do celów
     projektowych*), click the cross and type its X/Y into the form. PL-2000
     (zone from Y's first digit) and PUWG-1992 are detected automatically. Polish
     notation is used: X = northing, Y = easting.
   - **Transform**: Auto picks *similarity* for 2–3 points and *affine* for 4+.
     Affine absorbs scanner stretch. Use *projective* only for a photo of a plan taken
     at an angle.
   - **Crop mask**: outline the drawing so title blocks and legends don't cover the map.
   - With a known dpi the panel shows the implied scale (e.g. ≈ 1:500), a quick
     sanity check.
3. **Compare**: use the opacity slider and the display mode. *Multiply* makes white
   paper see-through. *White → transparent, inverted* turns black lines white for dark
   photos. Press <kbd>T</kbd> to blink a plan on and off, and <kbd>M</kbd> to measure
   in metres.

Basemaps (top-left): Geoportal ortofotomapa (newest, all of Poland), Warsaw fotoplan
2021 at 5 cm, Esri World Imagery and OSM. You can add cadastral parcels and buildings
(KIEG) as overlays, which are good for checking alignment.

## Plan sets

Plans are grouped in sets, one per project, each published under its own link. Pick or
create a set at the top of the panel; the URL is `?set=<slug>`.

```
data/<slug>/layers.json     plans: control points, transform, mask, display settings
data/<slug>/layers/<id>.jpg working raster used for georeferencing
data/<slug>/sources/<id>.*  original upload (PDF, scan, PNG…)
```

`data/` is local and not in git. Several images at once (e.g. a folder of sheets):

```sh
python3 tools/import_images.py metro-minska "E02 Mińska"/*.png --title "Metro M3 – Mińska"
```

## Publishing (GitHub Pages)

```sh
python3 tools/publish.py metro-minska
```

→ `https://<user>.github.io/plany/metro-minska/`, and an index of all sets at
`https://<user>.github.io/plany/`.

- Only georeferenced plans are published. What is visible, the opacity and the display
  mode at publish time are what viewers see first.
- Each plan gets two WebP renditions (q75): ≤ 8192 px for desktops, ≤ 4096 px for phones
  (memory and canvas limits). With a crop mask, only the masked area is published.
- Images and original files go to the GitHub Release `set-<slug>`, not into git; the repo
  only gets `site/sets/<slug>.json` (a few kB). The Pages workflow
  (`.github/workflows/pages.yml`) downloads the images when it builds the site.
- Viewers can download each original. The address bar always holds the current view and
  plan settings (`#zoom/lat/lng&on=…&o=…&d=…`), so any link they copy opens exactly that.
- Needs `brew install webp` (for `cwebp`) and `gh auth login`.

Preview without uploading:

```sh
python3 tools/publish.py metro-minska --local
python3 tools/build_site.py --assets local && python3 -m http.server -d _site
```

Limits: a Pages site may be up to 1 GB and has a soft limit of 100 GB of traffic a
month. Release files have no total size or traffic limit. If the site gets full, a set's
manifest can point its images at another Pages repo of the same account with
`"files": "https://<user>.github.io/plany-2/data/<slug>/"`; links stay the same.

## When to reach for QGIS instead

QGIS is the heavy-duty route, for sub-centimetre work, many sheets or GIS output. Use
its Georeferencer (Layer → Georeferencer), export a GeoTIFF/COG, then build tiles with
`gdal2tiles.py`. This app is the quick-look path: no exports, no tiles, a link you can
send.
