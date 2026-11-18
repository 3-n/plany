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

## Data

```
data/layers.json        plans: control points, transform, mask, display settings,
                        plus computed WGS84 corners for other tools
data/layers/<id>.jpg    rendered raster shown on the map
data/sources/<id>.pdf   original upload, kept for re-rendering
```

`layers.json` is plain JSON. Control points are stored as image pixels ↔ WGS84
lng/lat, so the transform is always recomputed from them.

## Publishing later

The folder is a static site. Upload it as-is to GitHub Pages, Netlify or any web
server. With no `server.py` behind it, the app detects that it can't write and turns
into a read-only viewer, with editing buttons hidden. The URL hash (`#zoom/lat/lng`)
makes views shareable. If the original PDFs shouldn't be public, leave out
`data/sources/`.

## When to reach for QGIS instead

QGIS is the heavy-duty route, for sub-centimetre work, many sheets or GIS output. Use
its Georeferencer (Layer → Georeferencer), export a GeoTIFF/COG, then build tiles with
`gdal2tiles.py`. This app is the quick-look path: no exports, no tiles, a link you can
send.
