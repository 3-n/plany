import { fitTransform, polishToLngLat, lngLatToPolish, distanceMeters } from './geo.js';
import { WarpedImage } from './overlay.js';

const L = window.L;
const proj4 = window.proj4;
const $ = (sel) => document.querySelector(sel);

// Published set pages define window.PLANY = { set, base } before loading the app.
const PUB = window.PLANY || null;
const SMALL_SCREEN = matchMedia('(max-width: 900px), (pointer: coarse)').matches;

const state = {
  editable: false,
  set: null, // slug of the plan set being shown
  sets: [], // all local sets (workshop only)
  meta: { title: '', description: '' },
  files: '', // base URL of the set's files
  layers: [],
  selectedId: null,
};
const runtime = new Map(); // layer id -> { fit, overlay, sourceKey, source }
const rt = (id) => runtime.get(id) || runtime.set(id, {}).get(id);
const byId = (id) => state.layers.find((l) => l.id === id);

const DISPLAY = {
  multiply: { label: 'Multiply (white = see-through)', blend: 'multiply' },
  normal: { label: 'Normal', blend: 'normal' },
  knockout: { label: 'White → transparent', blend: 'normal', knockout: true },
  'knockout-invert': { label: 'White → transparent, inverted', blend: 'normal', knockout: true, filter: 'invert(1) hue-rotate(180deg)' },
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- persistence

let saveTimer = null;
let dirty = false;

function setStatus(text, error = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function manifest() {
  for (const layer of state.layers) {
    const fit = rt(layer.id).fit;
    layer.corners = fit
      ? [[0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]]
        .map((c) => fit.imageToLngLat(c).map((x) => +x.toFixed(8)))
      : null;
  }
  return { version: 1, title: state.meta.title, description: state.meta.description, layers: state.layers };
}

function scheduleSave() {
  if (!state.editable) return;
  dirty = true;
  setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

async function flushSave(keepalive = false) {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    const r = await fetch(`api/manifest?set=${state.set}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manifest()), keepalive,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    setStatus('Saved');
  } catch (e) {
    dirty = true;
    setStatus(`Not saved: ${e.message}`, true);
  }
}

async function putFile(path, blob) {
  const r = await fetch(`api/file?set=${state.set}&path=${encodeURIComponent(path)}`, { method: 'PUT', body: blob });
  if (!r.ok) throw new Error(`Upload failed: ${(await r.json()).error || r.statusText}`);
}

async function deleteFile(path) {
  if (path) await fetch(`api/file?set=${state.set}&path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

async function loadState() {
  let status = null;
  if (!PUB) {
    try {
      const r = await fetch('api/status', { cache: 'no-store' });
      if (r.ok) status = await r.json();
    } catch { /* static hosting: read-only */ }
  }
  state.editable = status?.editable === true;
  state.sets = status?.sets || [];
  const asked = new URLSearchParams(location.search).get('set');
  state.set = PUB?.set || (state.sets.some((s) => s.slug === asked) ? asked : state.sets[0]?.slug) || asked;
  if (state.editable && state.set !== asked) {
    history.replaceState(null, '', `?set=${state.set}${location.hash}`);
  }
  document.body.classList.toggle('can-edit', state.editable);
  document.body.classList.toggle('published', !state.editable);
  setStatus(state.editable ? 'Saved' : '');
  if (!state.set) return;
  const base = PUB?.base || `data/${state.set}/`;
  try {
    const r = await fetch(`${base}layers.json`, { cache: 'no-cache' });
    if (r.ok) {
      const doc = await r.json();
      state.layers = doc.layers || [];
      state.meta = { title: doc.title || '', description: doc.description || '' };
      // A set's images may live on another site (e.g. an overflow Pages repo).
      state.files = doc.files ? new URL(doc.files, new URL(base, document.baseURI)).href : base;
    }
  } catch { /* no data yet */ }
}

window.addEventListener('pagehide', () => flushSave(true));

// ---------------------------------------------------------------- base map

// WMS in a projected CRS for services without EPSG:3857. Each Web Mercator tile asks
// for the enclosing box; fine where the CRS's grid is nearly aligned with north (PL-2000 zone 7 in Warsaw).
const ProjectedWMS = L.TileLayer.WMS.extend({
  getTileUrl(coords) {
    const b = this._tileCoordsToBounds(coords);
    const pts = [b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()]
      .map((ll) => proj4('EPSG:4326', this._crs.code, [ll.lng, ll.lat]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(',');
    const url = L.TileLayer.prototype.getTileUrl.call(this, coords);
    return url + L.Util.getParamString(this.wmsParams, url, this.options.uppercase) + (this.options.uppercase ? '&BBOX=' : '&bbox=') + bbox;
  },
});

const basemaps = {
  'Ortofotomapa – Geoportal (newest)': L.tileLayer.wms('https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution', {
    layers: 'Raster', format: 'image/jpeg', version: '1.3.0', crs: L.CRS.EPSG4326, tileSize: 512, maxZoom: 23,
    attribution: 'Ortofotomapa © <a href="https://www.geoportal.gov.pl" target="_blank">GUGiK</a>',
  }),
  'Warszawa – fotoplan 2021, 5 cm': new ProjectedWMS('https://wms.um.warszawa.pl/serwis', {
    layers: 'RASTER_FOTOPLAN_2021', format: 'image/jpeg', version: '1.1.1', crs: { code: 'EPSG:2178' }, tileSize: 512, maxZoom: 23,
    bounds: [[52.08, 20.82], [52.39, 21.30]],
    attribution: 'Fotoplan © <a href="https://mapa.um.warszawa.pl" target="_blank">m.st. Warszawa</a>',
  }),
  'Esri World Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 23, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  }),
  OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 23, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  }),
};

const map = L.map('map', { zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, maxZoom: 23, zoomControl: false });
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, maxWidth: 160 }).addTo(map);

map.createPane('cadastre').style.zIndex = 450;
map.createPane('measure').style.zIndex = 650;
const KIEG = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow';
const overlays = {
  'Działki (cadastral parcels)': L.tileLayer.wms(KIEG, {
    layers: 'dzialki,numery_dzialek', format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
    minZoom: 15, maxZoom: 23, pane: 'cadastre', attribution: 'KIEG © GUGiK',
  }),
  'Budynki (cadastral buildings)': L.tileLayer.wms(KIEG, {
    layers: 'budynki', format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
    minZoom: 15, maxZoom: 23, pane: 'cadastre', attribution: 'KIEG © GUGiK',
  }),
};

const baseName = store.get('basemap', 'Ortofotomapa – Geoportal (newest)');
(basemaps[baseName] || Object.values(basemaps)[0]).addTo(map);
for (const name of store.get('overlays', [])) overlays[name]?.addTo(map);
L.control.layers(basemaps, overlays, { position: 'topleft' }).addTo(map);
map.on('baselayerchange', (e) => store.set('basemap', e.name));
map.on('overlayadd overlayremove', () => store.set('overlays', Object.keys(overlays).filter((n) => map.hasLayer(overlays[n]))));

// The URL hash holds the view and, on published pages, any plan settings that differ
// from the set's defaults, so the address bar is always a shareable link:
//   #zoom/lat/lng&on=id,id&o=id:60&d=id:k
const MODE_CODES = { multiply: 'm', normal: 'n', knockout: 'k', 'knockout-invert': 'i' };
const CODE_MODES = Object.fromEntries(Object.entries(MODE_CODES).map(([k, v]) => [v, k]));
const layerDefaults = new Map(); // id -> { visible, opacity, display } as published

function readHash() {
  const [view = '', ...rest] = location.hash.slice(1).split('&');
  const m = view.match(/^(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  const p = new URLSearchParams(rest.join('&'));
  const pairs = (k) => (p.get(k) || '').split(',').filter(Boolean).map((x) => x.split(':'));
  return {
    view: m ? { zoom: +m[1], center: [+m[2], +m[3]] } : null,
    on: p.has('on') ? p.get('on').split(',').filter(Boolean) : null,
    opacity: pairs('o'),
    display: pairs('d'),
  };
}

function applyHashLayers(h) {
  if (h.on) for (const l of state.layers) l.visible = h.on.includes(l.id);
  for (const [id, pct] of h.opacity) {
    const l = byId(id);
    if (l && Number.isFinite(+pct)) l.opacity = Math.min(1, Math.max(0, +pct / 100));
  }
  for (const [id, code] of h.display) {
    const l = byId(id);
    if (l && CODE_MODES[code]) l.display = CODE_MODES[code];
  }
}

function hashString() {
  const c = map.getCenter();
  let h = `#${+map.getZoom().toFixed(1)}/${c.lat.toFixed(6)}/${c.lng.toFixed(6)}`;
  if (state.editable) return h; // in the workshop the saved set is the state
  const def = (l) => layerDefaults.get(l.id) || {};
  const on = state.layers.filter((l) => l.visible !== false).map((l) => l.id);
  const defOn = state.layers.filter((l) => def(l).visible !== false).map((l) => l.id);
  if (on.join() !== defOn.join()) h += `&on=${on.join(',')}`;
  const o = state.layers.filter((l) => (l.opacity ?? 0.7) !== (def(l).opacity ?? 0.7)).map((l) => `${l.id}:${Math.round((l.opacity ?? 0.7) * 100)}`);
  if (o.length) h += `&o=${o.join(',')}`;
  const d = state.layers.filter((l) => (l.display || 'multiply') !== (def(l).display || 'multiply')).map((l) => `${l.id}:${MODE_CODES[l.display]}`);
  if (d.length) h += `&d=${d.join(',')}`;
  return h;
}

let hashTimer = null;
function writeHash() {
  // Debounced: Safari throws after 100 history updates in 30 s (slider drags add up).
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', location.pathname + location.search + hashString()), 250);
}
map.on('moveend', writeHash);

// ---------------------------------------------------------------- measuring

const Measure = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const el = L.DomUtil.create('div', 'leaflet-bar measure-ctl');
    const a = (this._btn = L.DomUtil.create('a', '', el));
    a.href = '#';
    a.title = 'Measure distance (M)';
    a.setAttribute('role', 'button');
    a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>';
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); this.toggle(); });
    this._group = L.layerGroup().addTo(map);
    return el;
  },
  get active() { return !!this._on; },
  toggle(on = !this._on) {
    this._on = on;
    this._btn.classList.toggle('active', on);
    map.getContainer().classList.toggle('crosshair', on || document.body.classList.contains('editing'));
    if (on) {
      map.doubleClickZoom.disable();
      map.on('click', this._click, this).on('mousemove', this._move, this).on('dblclick', this._finish, this);
    } else {
      if (!document.body.classList.contains('editing')) map.doubleClickZoom.enable();
      map.off('click', this._click, this).off('mousemove', this._move, this).off('dblclick', this._finish, this);
      this.clear();
    }
  },
  clear() {
    this._group.clearLayers();
    this._pts = null;
  },
  _click(e) {
    if (!this._pts) { this.clear(); this._pts = []; this._line = L.polyline([], { pane: 'measure', color: '#ffcc00', weight: 3, interactive: false }).addTo(this._group); }
    this._pts.push(e.latlng);
    L.circleMarker(e.latlng, { pane: 'measure', radius: 4, color: '#000', weight: 1, fillColor: '#ffcc00', fillOpacity: 1, interactive: false }).addTo(this._group);
    this._draw();
  },
  _move(e) { if (this._pts?.length) this._draw(e.latlng); },
  _finish() { if (this._pts) { this._draw(); this._pts = null; } },
  _draw(cursor) {
    const pts = cursor ? [...this._pts, cursor] : this._pts;
    this._line.setLatLngs(pts);
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += distanceMeters([pts[i - 1].lng, pts[i - 1].lat], [pts[i].lng, pts[i].lat]);
    const text = d >= 1000 ? `${(d / 1000).toFixed(3)} km` : `${d.toFixed(2)} m`;
    this._line.unbindTooltip();
    if (pts.length > 1) this._line.bindTooltip(text, { permanent: true, direction: 'right', className: 'measure-label', offset: [8, 0] }).openTooltip(pts[pts.length - 1]);
  },
});
const measure = new Measure().addTo(map);

// ---------------------------------------------------------------- plan overlays

// Published layers carry two renditions; phones get the smaller one (memory, canvas limits).
function imageUrl(layer) {
  const file = layer.images ? (SMALL_SCREEN && layer.images.mobile) || layer.images.web : layer.image;
  return `${state.files}${file}?v=${layer.rev || 0}`;
}

// Published images may be cropped to the mask; map image pixels back to layer pixels.
function geometry(layer, fit) {
  const [x0, y0, x1, y1] = layer.crop || [0, 0, layer.width, layer.height];
  if (!x0 && !y0) return { w: x1, h: y1, toLngLat: fit.imageToLngLat, mask: layer.mask };
  return {
    w: x1 - x0,
    h: y1 - y0,
    toLngLat: ([u, v]) => fit.imageToLngLat([u + x0, v + y0]),
    mask: layer.mask && layer.mask.map(([u, v]) => [u - x0, v - y0]),
  };
}

// "Colour to alpha" against white: paper becomes transparent, colours stay as drawn.
// Near-white scan noise above `paper` is treated as white.
async function knockoutCanvas(url, paper = 232) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const stretch = 255 / paper;
  const rowsPerChunk = Math.max(1, Math.floor(4e6 / c.width));
  for (let y = 0; y < c.height; y += rowsPerChunk) {
    const h = Math.min(rowsPerChunk, c.height - y);
    const data = ctx.getImageData(0, y, c.width, h);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = Math.min(255, d[i] * stretch), g = Math.min(255, d[i + 1] * stretch), b = Math.min(255, d[i + 2] * stretch);
      const m = Math.min(r, g, b);
      const a = 255 - m;
      if (a <= 0) { d[i + 3] = 0; continue; }
      d[i] = ((r - m) * 255) / a;
      d[i + 1] = ((g - m) * 255) / a;
      d[i + 2] = ((b - m) * 255) / a;
      d[i + 3] = (a * d[i + 3]) / 255;
    }
    ctx.putImageData(data, 0, y);
  }
  return c;
}

async function overlaySource(layer) {
  const r = rt(layer.id);
  const knock = !!DISPLAY[layer.display]?.knockout;
  const key = `${knock ? 'k' : 'n'}:${imageUrl(layer)}`;
  if (r.sourceKey !== key) {
    r.sourceKey = key;
    r.source = knock ? knockoutCanvas(imageUrl(layer)) : Promise.resolve(imageUrl(layer));
  }
  return r.source;
}

function layerZ(layer) {
  return 100 + state.layers.length - state.layers.indexOf(layer);
}

async function syncOverlay(layer) {
  const r = rt(layer.id);
  r.fit = fitTransform(layer.points || [], layer.method || 'auto');
  const show = layer.visible !== false && r.fit;
  if (!show) {
    if (r.overlay) map.removeLayer(r.overlay);
    return;
  }
  const disp = DISPLAY[layer.display] || DISPLAY.multiply;
  const token = (r.token = (r.token || 0) + 1);
  let source;
  try {
    source = await overlaySource(layer);
  } catch (e) {
    console.error(e);
    setStatus(`Could not load ${layer.image}`, true);
    return;
  }
  if (token !== r.token || !byId(layer.id)) return; // superseded by a newer call, or deleted
  const g = geometry(layer, r.fit);
  if (!r.overlay) {
    r.overlay = new WarpedImage(source, g.w, g.h, g.toLngLat);
  } else {
    r.overlay.setSource(source).setTransform(g.toLngLat);
  }
  r.overlay.setOpacity(layer.opacity ?? 0.7).setBlend(disp.blend).setFilter(disp.filter || '')
    .setMask(g.mask).setZIndex(layerZ(layer));
  if (!map.hasLayer(r.overlay)) r.overlay.addTo(map);
}

function syncAll() {
  return Promise.all(state.layers.map(syncOverlay));
}

function planBounds(layer) {
  const fit = rt(layer.id).fit;
  if (!fit) return null;
  return L.latLngBounds([[0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]]
    .map((c) => { const [lng, lat] = fit.imageToLngLat(c); return [lat, lng]; }));
}

// ---------------------------------------------------------------- plan list

function fitSummary(layer) {
  const fit = rt(layer.id).fit;
  const n = (layer.points || []).filter((p) => p.img && p.world).length;
  if (!fit) return n ? `${n} point${n > 1 ? 's' : ''}, needs at least 2` : 'Not georeferenced yet';
  const scale = layer.dpi ? ` · ≈ 1:${Math.round(fit.mPerPx / (0.0254 / layer.dpi))}` : '';
  return `${fit.n} points · ${fit.exact ? 'exact fit' : `RMS ${fmtM(fit.rms)}`}${scale}`;
}

const fmtM = (m) => (m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`);

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function renderList() {
  const list = $('#layer-list');
  list.replaceChildren();
  for (const layer of state.layers) {
    const r = rt(layer.id);
    const vis = el('input', {
      type: 'checkbox', checked: layer.visible !== false, title: 'Show/hide (T)',
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => { layer.visible = e.target.checked; syncOverlay(layer); layerChanged(); renderQuick(); },
    });
    const opacity = el('label', { class: 'field' }, 'Plan opacity', el('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value: layer.opacity ?? 0.7,
      oninput: (e) => { layer.opacity = +e.target.value; r.overlay?.setOpacity(layer.opacity); layerChanged(); renderQuick(); },
    }));
    const display = el('label', { class: 'field' }, 'Blending', el('select', {
      title: 'How the plan is drawn over the photo',
      onchange: (e) => { layer.display = e.target.value; syncOverlay(layer); layerChanged(); renderQuick(); },
    }, ...Object.entries(DISPLAY).map(([v, d]) => el('option', { value: v, selected: (layer.display || 'multiply') === v }, d.label))));
    const actions = el('div', { class: 'layer-actions' },
      el('button', { type: 'button', disabled: !r.fit, onclick: () => { const b = planBounds(layer); if (b) map.fitBounds(b); } }, 'Zoom to'),
      state.editable ? el('button', { type: 'button', onclick: () => openEditor(layer) }, 'Georeference') : null,
      state.editable ? el('button', { type: 'button', onclick: () => moveLayer(layer, -1), title: 'Draw above the plan before it' }, '↑') : null,
      state.editable ? el('button', { type: 'button', onclick: () => moveLayer(layer, 1), title: 'Draw below the plan after it' }, '↓') : null,
      state.editable ? el('button', { type: 'button', class: 'danger', onclick: () => removeLayer(layer) }, 'Delete') : null,
      downloadLink(layer),
    );
    const li = el('li', {
      class: `layer${state.selectedId === layer.id ? ' selected' : ''}`,
      onclick: (e) => { if (e.target.closest('button, input, select')) return; state.selectedId = layer.id; renderList(); },
    },
    el('div', { class: 'layer-top' }, vis, el('span', { class: 'layer-name', title: layer.name }, layer.name)),
    el('div', { class: 'layer-meta' }, fitSummary(layer)),
    el('div', { class: 'layer-controls' }, opacity, display),
    actions);
    list.append(li);
  }
  const hint = $('#empty-hint');
  hint.hidden = state.layers.length > 0;
  hint.textContent = state.editable
    ? 'No plans yet. Add a PDF or a scan, then match a few points between the plan and the aerial photo.'
    : 'No plans published here yet.';
  renderQuick();
}

function layerChanged() {
  scheduleSave();
  writeHash();
}

function downloadLink(layer) {
  const d = layer.download || (layer.source && { url: `${state.files}${layer.source}`, name: layer.sourceName });
  if (!d) return null;
  const ext = (d.name || d.url).split('.').pop().toUpperCase().slice(0, 4);
  const size = d.size ? `, ${(d.size / 1e6).toFixed(d.size < 1e7 ? 1 : 0)} MB` : '';
  return el('a', { class: 'download', href: d.url, download: d.name || '', title: d.name || '' }, `Original (${ext}${size}) ↓`);
}

// One slider and one blending picker for every visible plan: the quickest "before / after" on a phone.
function renderQuick() {
  const shown = state.layers.filter((l) => l.visible !== false && rt(l.id).fit);
  $('#quick').hidden = !state.layers.some((l) => rt(l.id).fit);
  const slider = $('#quick-opacity');
  slider.disabled = !shown.length;
  slider.value = shown.length ? Math.max(...shown.map((l) => l.opacity ?? 0.7)) : 0;
  const modes = new Set(shown.map((l) => l.display || 'multiply'));
  const select = $('#quick-display');
  select.disabled = !shown.length;
  select.replaceChildren(
    modes.size > 1 ? el('option', { value: '', disabled: true }, 'Mixed') : null,
    ...Object.entries(DISPLAY).map(([v, d]) => el('option', { value: v }, d.label)),
  );
  select.value = modes.size === 1 ? [...modes][0] : '';
}

$('#quick-opacity').addEventListener('input', (e) => {
  for (const l of state.layers) {
    if (l.visible === false) continue;
    l.opacity = +e.target.value;
    rt(l.id).overlay?.setOpacity(l.opacity);
  }
  layerChanged();
});
$('#quick-opacity').addEventListener('change', () => renderList());
$('#quick-display').addEventListener('change', (e) => {
  for (const l of state.layers) {
    if (l.visible === false) continue;
    l.display = e.target.value;
    syncOverlay(l);
  }
  layerChanged();
  renderList();
});

function moveLayer(layer, dir) {
  const i = state.layers.indexOf(layer), j = i + dir;
  if (j < 0 || j >= state.layers.length) return;
  [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
  state.layers.forEach((l) => rt(l.id).overlay?.setZIndex(layerZ(l)));
  renderList();
  scheduleSave();
}

async function removeLayer(layer) {
  if (!confirm(`Delete "${layer.name}" and its files?`)) return;
  const r = rt(layer.id);
  if (r.overlay) map.removeLayer(r.overlay);
  runtime.delete(layer.id);
  state.layers = state.layers.filter((l) => l !== layer);
  renderList();
  scheduleSave();
  await flushSave();
  await deleteFile(layer.image);
  await deleteFile(layer.source);
}

// ---------------------------------------------------------------- set header, sharing, set picker

function renderSetInfo() {
  const title = state.meta.title || (state.editable ? state.set : '') || 'Plan Overlay';
  $('#set-title-view').textContent = title;
  document.title = state.editable ? `${title} · Plan Overlay` : title;
  const desc = $('#set-desc-view');
  desc.textContent = state.meta.description;
  desc.hidden = state.editable || !state.meta.description;
  if (!state.editable) return;
  const pick = $('#set-select');
  pick.replaceChildren(...state.sets.map((s) => el('option', { value: s.slug, selected: s.slug === state.set }, `${s.title} (${s.count})`)));
  $('#set-title').value = state.meta.title;
  $('#set-desc').value = state.meta.description;
}

$('#set-select').addEventListener('change', async (e) => {
  await flushSave();
  location.href = `?set=${e.target.value}`;
});
$('#set-new').addEventListener('click', async () => {
  const slug = prompt('Short name for the new set, used in its link (lowercase, digits, dashes):', '');
  if (!slug) return;
  const r = await fetch('api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: slug.trim(), title: slug.trim() }) });
  const res = await r.json();
  if (!r.ok) return alert(res.error || r.statusText);
  await flushSave();
  location.href = `?set=${res.slug}`;
});
for (const [id, key] of [['#set-title', 'title'], ['#set-desc', 'description']]) {
  $(id).addEventListener('input', (e) => { state.meta[key] = e.target.value; scheduleSave(); });
}

function setPanelOpen(open) {
  document.body.classList.toggle('panel-collapsed', !open);
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
  $('#panel-toggle').textContent = open ? 'Hide plans ▾' : `Plans (${state.layers.length}) ▴`;
  setTimeout(() => map.invalidateSize(), 0);
}
$('#panel-toggle').addEventListener('click', () => setPanelOpen(document.body.classList.contains('panel-collapsed')));

$('#share-btn').addEventListener('click', async () => {
  clearTimeout(hashTimer);
  history.replaceState(null, '', location.pathname + location.search + hashString());
  const url = location.href;
  try {
    if (SMALL_SCREEN && navigator.share) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus('Link copied');
  } catch (e) {
    if (e.name !== 'AbortError') prompt('Copy this link:', url);
  }
  setTimeout(() => setStatus(state.editable ? 'Saved' : ''), 2000);
});

// ---------------------------------------------------------------- adding plans

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

const add = { file: null, pdf: null };

function resetAddDialog() {
  $('#add-form').reset();
  $('#add-pdf-opts').hidden = true;
  $('#add-info').textContent = '';
  $('#add-progress').textContent = '';
  const t = $('#add-thumb');
  t.width = 0;
  t.height = 0;
  add.file = null;
  add.pdf?.destroy();
  add.pdf = null;
  $('#add-go').disabled = false;
}

$('#add-btn').addEventListener('click', () => {
  resetAddDialog();
  $('#add-dialog').showModal();
});

$('#add-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  add.file = file;
  add.pdf?.destroy();
  add.pdf = null;
  if (!file) return;
  const base = file.name.replace(/\.[^.]+$/, '');
  $('#add-name').value = base;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  $('#add-pdf-opts').hidden = !isPdf;
  $('#add-format').value = isPdf ? 'image/jpeg' : (file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  try {
    if (isPdf) {
      $('#add-info').textContent = 'Reading PDF…';
      const lib = await loadPdfjs();
      add.pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const sel = $('#add-page');
      sel.replaceChildren(...Array.from({ length: add.pdf.numPages }, (_, i) => el('option', { value: i + 1 }, `${i + 1} of ${add.pdf.numPages}`)));
      if (add.pdf.numPages > 1) sel.append(el('option', { value: 'all' }, 'All pages (one plan each)'));
      await pdfPreview();
    } else {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      drawThumb(img, img.naturalWidth, img.naturalHeight);
      $('#add-info').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
      URL.revokeObjectURL(img.src);
    }
  } catch (err) {
    console.error(err);
    $('#add-info').textContent = `Can't open this file: ${err.message}`;
  }
});

function drawThumb(source, w, h) {
  const t = $('#add-thumb');
  const s = Math.min(200 / w, 200 / h);
  t.width = Math.round(w * s);
  t.height = Math.round(h * s);
  const ctx = t.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, t.width, t.height);
  ctx.drawImage(source, 0, 0, t.width, t.height);
}

async function pdfPreview() {
  if (!add.pdf) return;
  const pageNo = $('#add-page').value === 'all' ? 1 : +$('#add-page').value;
  const page = await add.pdf.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const { width, height, dpi } = pdfRenderSize(vp1);
  const mm = (pt) => Math.round((pt / 72) * 25.4);
  $('#add-info').textContent = `Page ${mm(vp1.width)} × ${mm(vp1.height)} mm → ${width} × ${height} px (${Math.round(dpi)} dpi)`;
  const s = Math.min(200 / vp1.width, 200 / vp1.height);
  const vp = page.getViewport({ scale: s });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  drawThumb(c, c.width, c.height);
}

function pdfRenderSize(vp1) {
  const dpi = Math.min(+$('#add-dpi').value, (+$('#add-max').value / Math.max(vp1.width, vp1.height)) * 72);
  return { width: Math.floor((vp1.width * dpi) / 72), height: Math.floor((vp1.height * dpi) / 72), dpi };
}

$('#add-page').addEventListener('change', pdfPreview);
$('#add-dpi').addEventListener('change', pdfPreview);
$('#add-max').addEventListener('change', pdfPreview);

async function renderPdfPage(pageNo) {
  const page = await add.pdf.getPage(pageNo);
  const { dpi } = pdfRenderSize(page.getViewport({ scale: 1 }));
  const vp = page.getViewport({ scale: dpi / 72 });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { canvas: c, dpi };
}

async function rasterFromImage(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const max = +$('#add-max').value;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  // Keep the original bytes when they are already web-friendly and need no downscaling.
  const asIs = s === 1 && /^image\/(jpeg|png|webp)$/.test(file.type) ? file : null;
  return { canvas: c, asIs };
}

const toBlob = (canvas, type) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image too large for this browser; try a smaller max size'))), type, 0.9));
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

$('#add-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return; // Cancel closes the dialog
  e.preventDefault();
  if (!add.file) return;
  const progress = $('#add-progress');
  $('#add-go').disabled = true;
  try {
    const file = add.file;
    const ext = (file.name.match(/\.([A-Za-z0-9]{1,5})$/) || [, 'bin'])[1].toLowerCase();
    const format = $('#add-format').value;
    const imgExt = format === 'image/png' ? 'png' : 'jpg';
    const baseName = $('#add-name').value.trim() || file.name;
    const pages = add.pdf ? ($('#add-page').value === 'all' ? Array.from({ length: add.pdf.numPages }, (_, i) => i + 1) : [+$('#add-page').value]) : [null];
    const sourceId = newId();
    const source = `sources/${sourceId}.${ext}`;
    progress.textContent = 'Saving original file…';
    await putFile(source, file);
    const created = [];
    for (const pageNo of pages) {
      const id = pages.length > 1 ? `${sourceId}_${pageNo}` : sourceId;
      progress.textContent = pageNo ? `Rendering page ${pageNo}…` : 'Preparing image…';
      let canvas, dpi = null, blob, image;
      if (pageNo) {
        ({ canvas, dpi } = await renderPdfPage(pageNo));
        blob = await toBlob(canvas, format);
        image = `layers/${id}.${imgExt}`;
      } else {
        const r = await rasterFromImage(file);
        canvas = r.canvas;
        blob = r.asIs || (await toBlob(canvas, format));
        image = `layers/${id}.${r.asIs ? ext.replace('jpeg', 'jpg') : imgExt}`;
      }
      progress.textContent = `Saving ${(blob.size / 1e6).toFixed(1)} MB…`;
      await putFile(image, blob);
      const layer = {
        id, name: pages.length > 1 ? `${baseName} – p. ${pageNo}` : baseName,
        image, source, sourceName: file.name, sourcePage: pageNo, dpi: dpi ? Math.round(dpi * 10) / 10 : null,
        width: canvas.width, height: canvas.height,
        points: [], method: 'auto', mask: null, opacity: 0.7, display: 'multiply', visible: true,
        created: new Date().toISOString(), rev: 1,
      };
      canvas.width = canvas.height = 0; // free memory early (Safari keeps canvases around)
      state.layers.unshift(layer);
      created.push(layer);
    }
    scheduleSave();
    await flushSave();
    $('#add-dialog').close();
    state.selectedId = created[0].id;
    renderList();
    openEditor(created[0]);
  } catch (err) {
    console.error(err);
    progress.textContent = err.message;
    $('#add-go').disabled = false;
  }
});

// ---------------------------------------------------------------- georeferencing editor

const ed = {
  layer: null,
  imgMap: null,
  imgOverlay: null,
  group: null, // markers on the main map
  imgGroup: null, // markers on the plan
  pendingId: null,
  selectedId: null,
  mode: 'points',
  maskDraft: null,
  maskLayer: null,
  ghost: null,
};

const toImgLatLng = ([u, v]) => L.latLng(-v, u);
const fromImgLatLng = (ll) => [ll.lng, -ll.lat];

function cpIcon(p, extra = '') {
  return L.divIcon({ className: `cp ${extra}`, html: `<div class="ring"></div><div class="num">${p.id}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}

function ensureImgMap() {
  if (ed.imgMap) return;
  ed.imgMap = L.map('imgmap', { crs: L.CRS.Simple, minZoom: -8, maxZoom: 5, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, attributionControl: false, doubleClickZoom: false, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(ed.imgMap);
  ed.imgGroup = L.layerGroup().addTo(ed.imgMap);
  ed.imgMap.on('click', onImgClick);
}

function openEditor(layer) {
  if (ed.layer) closeEditor();
  if (measure.active) measure.toggle(false);
  ed.layer = layer;
  ed.pendingId = null;
  ed.selectedId = null;
  ed.maskDraft = null;
  layer.points ||= [];
  document.body.classList.add('editing');
  $('#list-view').hidden = true;
  $('#editor-view').hidden = false;
  map.getContainer().classList.add('crosshair');
  map.doubleClickZoom.disable();

  ensureImgMap();
  ed.imgMap.invalidateSize();
  map.invalidateSize();
  const bounds = L.latLngBounds([[-layer.height, 0], [0, layer.width]]);
  ed.imgOverlay = L.imageOverlay(imageUrl(layer), bounds).addTo(ed.imgMap);
  ed.imgMap.setMaxBounds(bounds.pad(0.5));
  ed.imgMap.fitBounds(bounds);
  ed.group = L.layerGroup().addTo(map);
  map.on('click', onMapClick);

  $('#ed-name').value = layer.name;
  $('#ed-method').value = layer.method || 'auto';
  $('#ed-opacity').value = layer.opacity ?? 0.7;
  setMode('points');
  layer.visible = true;
  syncOverlay(layer).then(() => {
    const b = planBounds(layer);
    if (b) map.fitBounds(b);
  });
  refreshEditor();
}

function closeEditor() {
  const layer = ed.layer;
  if (!layer) return;
  layer.points = layer.points.filter((p) => p.img && p.world);
  layer.points.forEach((p, i) => { p.id = i + 1; });
  map.off('click', onMapClick);
  ed.group.remove();
  ed.imgGroup.clearLayers();
  ed.imgOverlay.remove();
  ed.maskLayer = null;
  ed.ghost = null;
  ed.layer = null;
  document.body.classList.remove('editing');
  map.getContainer().classList.remove('crosshair');
  map.doubleClickZoom.enable();
  $('#list-view').hidden = false;
  $('#editor-view').hidden = true;
  map.invalidateSize();
  syncOverlay(layer);
  scheduleSave();
  renderList();
}

function setMode(mode) {
  ed.mode = mode;
  document.querySelector(`input[name="ed-mode"][value="${mode}"]`).checked = true;
  $('#ed-points-block').hidden = mode === 'mask';
  $('#ed-mask-block').hidden = mode !== 'mask';
  ed.imgMap.getContainer().classList.toggle('crosshair', mode !== 'pan');
  map.getContainer().classList.toggle('crosshair', mode === 'points');
  if (mode !== 'mask') ed.maskDraft = null;
  drawMask();
  refreshEditor();
}

document.querySelectorAll('input[name="ed-mode"]').forEach((r) => r.addEventListener('change', (e) => setMode(e.target.value)));

function pointById(id) {
  return ed.layer.points.find((p) => p.id === id);
}

function nextPointId() {
  return ed.layer.points.reduce((m, p) => Math.max(m, p.id), 0) + 1;
}

// Every change to the points goes through here: refit, redraw, save.
function pointsChanged({ save = true } = {}) {
  const layer = ed.layer;
  const r = rt(layer.id);
  r.fit = fitTransform(layer.points, layer.method);
  if (r.fit) {
    if (r.overlay && map.hasLayer(r.overlay)) r.overlay.setTransform(r.fit.imageToLngLat);
    else syncOverlay(layer);
  } else if (r.overlay) {
    map.removeLayer(r.overlay);
  }
  refreshEditor();
  if (save) scheduleSave();
}

function onImgClick(e) {
  if (ed.mode === 'mask') return addMaskVertex(e);
  if (ed.mode !== 'points') return;
  const uv = fromImgLatLng(e.latlng);
  if (uv[0] < 0 || uv[1] < 0 || uv[0] > ed.layer.width || uv[1] > ed.layer.height) return;
  let p = ed.pendingId ? pointById(ed.pendingId) : null;
  if (p && p.world && !p.img) {
    p.img = uv;
    ed.pendingId = null;
  } else if (p && p.img && !p.world) {
    p.img = uv; // re-click moves the half-placed point
  } else {
    p = { id: nextPointId(), img: uv, world: null, enabled: true };
    ed.layer.points.push(p);
    ed.pendingId = p.id;
    const fit = rt(ed.layer.id).fit;
    if (fit) {
      const [lng, lat] = fit.imageToLngLat(uv);
      map.setView([lat, lng], Math.max(map.getZoom(), 19));
    }
  }
  ed.selectedId = p.id;
  pointsChanged({ save: !ed.pendingId });
}

function onMapClick(e) {
  if (measure.active || ed.mode !== 'points') return;
  const ll = [e.latlng.lng, e.latlng.lat];
  let p = ed.pendingId ? pointById(ed.pendingId) : null;
  if (p && p.img && !p.world) {
    p.world = ll;
    ed.pendingId = null;
  } else if (p && p.world && !p.img) {
    p.world = ll;
  } else {
    p = { id: nextPointId(), img: null, world: ll, enabled: true };
    ed.layer.points.push(p);
    ed.pendingId = p.id;
    const fit = rt(ed.layer.id).fit;
    if (fit) ed.imgMap.panTo(toImgLatLng(fit.lngLatToImage(ll)));
  }
  ed.selectedId = p.id;
  pointsChanged({ save: !ed.pendingId });
}

function cancelPending() {
  if (!ed.pendingId) return false;
  ed.layer.points = ed.layer.points.filter((p) => p.id !== ed.pendingId);
  ed.pendingId = null;
  ed.selectedId = null;
  pointsChanged({ save: false });
  return true;
}

function deletePoint(id) {
  ed.layer.points = ed.layer.points.filter((p) => p.id !== id);
  if (ed.pendingId === id) ed.pendingId = null;
  if (ed.selectedId === id) ed.selectedId = null;
  pointsChanged();
}

function selectPoint(id, pan = true) {
  ed.selectedId = id;
  const p = pointById(id);
  if (pan && p) {
    if (p.img) ed.imgMap.panTo(toImgLatLng(p.img));
    if (p.world) map.panTo([p.world[1], p.world[0]]);
  }
  refreshEditor();
}

function drawMarkers() {
  ed.group.clearLayers();
  ed.imgGroup.clearLayers();
  if (ed.maskLayer) ed.imgGroup.addLayer(ed.maskLayer);
  const fit = rt(ed.layer.id).fit;
  for (const p of ed.layer.points) {
    const cls = [p.img && p.world ? 'done' : '', p.id === ed.selectedId ? 'selected' : '', p.enabled === false ? 'disabled' : ''].join(' ');
    if (p.img) ed.imgGroup.addLayer(makeMarker(p, 'img', toImgLatLng(p.img), cls));
    if (p.world) ed.group.addLayer(makeMarker(p, 'world', L.latLng(p.world[1], p.world[0]), cls));
    // Where the current fit expects the missing half of a pending point.
    if (fit && p.id === ed.pendingId) {
      if (p.img && !p.world) {
        const [lng, lat] = fit.imageToLngLat(p.img);
        ed.group.addLayer(L.marker([lat, lng], { icon: cpIcon(p, 'ghost'), interactive: false, keyboard: false }));
      } else if (p.world && !p.img) {
        ed.imgGroup.addLayer(L.marker(toImgLatLng(fit.lngLatToImage(p.world)), { icon: cpIcon(p, 'ghost'), interactive: false, keyboard: false }));
      }
    }
  }
  drawMaskDraft();
}

function makeMarker(p, side, latlng, cls) {
  const m = L.marker(latlng, { icon: cpIcon(p, cls), draggable: ed.mode !== 'mask', autoPan: true, keyboard: false, zIndexOffset: p.id === ed.selectedId ? 1000 : 0 });
  const update = () => {
    const ll = m.getLatLng();
    if (side === 'img') p.img = fromImgLatLng(ll);
    else { p.world = [ll.lng, ll.lat]; delete p.typed; }
  };
  m.on('click', () => selectPoint(p.id, false));
  m.on('dragstart', () => { ed.selectedId = p.id; });
  m.on('drag', () => {
    update();
    const r = rt(ed.layer.id);
    r.fit = fitTransform(ed.layer.points, ed.layer.method);
    if (r.fit && r.overlay) r.overlay.setTransform(r.fit.imageToLngLat);
  });
  m.on('dragend', () => { update(); pointsChanged({ save: !ed.pendingId }); });
  return m;
}

function resClass(m) {
  return m < 0.3 ? 'res-ok' : m < 1 ? 'res-warn' : 'res-bad';
}

function refreshEditor() {
  if (!ed.layer) return;
  const layer = ed.layer;
  const fit = rt(layer.id).fit;
  drawMarkers();

  const info = $('#ed-fit');
  if (fit) {
    const scale = layer.dpi ? ` · plan scale ≈ <b>1:${Math.round(fit.mPerPx / (0.0254 / layer.dpi))}</b>` : '';
    const acc = fit.exact ? 'exact fit, add a point to check the error' : `RMS error <b>${fmtM(fit.rms)}</b>`;
    info.innerHTML = `Using <b>${fit.method}</b> with ${fit.n} points · ${acc} · 1 px = ${fmtM(fit.mPerPx)}${scale}`;
  } else {
    info.textContent = 'Place at least 2 point pairs to see the plan on the map.';
  }

  const tbody = $('#ed-points');
  tbody.replaceChildren();
  for (const p of layer.points) {
    const res = fit?.residuals[p.id];
    const status = p.img && p.world ? (p.typed ? 'typed coords' : 'placed') : p.img ? 'needs map point' : 'needs plan point';
    const tr = el('tr', {
      class: [p.id === ed.selectedId ? 'selected' : '', p.enabled === false ? 'disabled' : ''].join(' '),
      onclick: (e) => { if (!e.target.closest('button, input')) selectPoint(p.id); },
    },
    el('td', { class: 'num' }, String(p.id)),
    el('td', {}, el('input', {
      type: 'checkbox', checked: p.enabled !== false, title: 'Use this point in the fit',
      onchange: (e) => { p.enabled = e.target.checked; pointsChanged(); },
    })),
    el('td', { class: res != null && !fit.exact ? resClass(res) : '' }, res != null && !fit.exact ? fmtM(res) : '–'),
    el('td', { class: 'muted' }, status),
    el('td', {}, el('button', { type: 'button', class: 'x', title: 'Delete point', onclick: () => deletePoint(p.id) }, '×')));
    tbody.append(tr);
  }

  const sel = ed.selectedId ? pointById(ed.selectedId) : null;
  const form = $('#ed-coords');
  form.hidden = !sel;
  if (sel) {
    $('#ed-coords-id').textContent = `#${sel.id}`;
    if (document.activeElement !== $('#ed-x') && document.activeElement !== $('#ed-y')) {
      if (sel.world) {
        const { X, Y, code } = lngLatToPolish(sel.world);
        $('#ed-x').value = X.toFixed(2);
        $('#ed-y').value = Y.toFixed(2);
        $('#ed-crs').textContent = `${code === 'EPSG:2180' ? 'PUWG-1992' : 'PL-2000'} (${code})`;
      } else {
        $('#ed-x').value = '';
        $('#ed-y').value = '';
        $('#ed-crs').textContent = 'PL-2000 (zone from Y) or PUWG-1992';
      }
    }
  }
  refreshHint();
}

function refreshHint() {
  if (!ed.layer) return;
  const hint = $('#ed-hint');
  const complete = ed.layer.points.filter((p) => p.img && p.world).length;
  const p = ed.pendingId ? pointById(ed.pendingId) : null;
  if (ed.mode === 'mask') hint.textContent = 'Crop mask: click on the plan (left) to outline the area to show. Title blocks and legends usually go.';
  else if (ed.mode === 'pan') hint.textContent = 'Pan only: clicks do nothing, so you can look around.';
  else if (p && p.img) hint.textContent = `Point ${p.id}: now click the same spot on the map (right), or type its coordinates below. Esc cancels.`;
  else if (p && p.world) hint.textContent = `Point ${p.id}: now click the same spot on the plan (left). Esc cancels.`;
  else if (complete < 2) hint.textContent = `Click a sharp spot on the plan (left), then the same spot on the map (right). Building corners, kerb corners, manholes or grid crosses work well. ${complete}/2 points so far.`;
  else if (complete < 4) hint.textContent = 'The plan is on the map. Add 1–2 more points far apart, ideally near the sheet corners, to measure the error. Drag markers to refine them.';
  else hint.textContent = 'Points with a red error are probably misplaced: drag them or untick them. Switch to Pan only to look around.';
}

$('#ed-coords').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = ed.selectedId ? pointById(ed.selectedId) : null;
  if (!p) return;
  const X = parseFloat($('#ed-x').value.replace(/\s/g, '').replace(',', '.'));
  const Y = parseFloat($('#ed-y').value.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return;
  const { lngLat, code } = polishToLngLat(X, Y);
  if (!(lngLat[1] > 48 && lngLat[1] < 56 && lngLat[0] > 13 && lngLat[0] < 25)) {
    alert(`These coordinates land outside Poland (${code}). In Polish notation X is the northing and Y the easting. Did you swap them?`);
    return;
  }
  p.world = lngLat;
  p.typed = true;
  if (ed.pendingId === p.id && p.img) ed.pendingId = null;
  map.panTo([lngLat[1], lngLat[0]]);
  document.activeElement.blur();
  pointsChanged({ save: !ed.pendingId });
});

$('#ed-method').addEventListener('change', (e) => { ed.layer.method = e.target.value; pointsChanged(); });
$('#ed-name').addEventListener('input', (e) => { ed.layer.name = e.target.value; scheduleSave(); });
$('#ed-opacity').addEventListener('input', (e) => { ed.layer.opacity = +e.target.value; rt(ed.layer.id).overlay?.setOpacity(ed.layer.opacity); scheduleSave(); });
$('#ed-done').addEventListener('click', closeEditor);
$('#ed-zoom').addEventListener('click', () => {
  const b = planBounds(ed.layer);
  if (b) map.fitBounds(b);
  ed.imgMap.fitBounds([[-ed.layer.height, 0], [0, ed.layer.width]]);
});

// ---- crop mask

function addMaskVertex(e) {
  const uv = fromImgLatLng(e.latlng).map((x) => Math.round(x));
  ed.maskDraft ||= [];
  if (ed.maskDraft.length >= 3) {
    const first = ed.imgMap.latLngToContainerPoint(toImgLatLng(ed.maskDraft[0]));
    if (first.distanceTo(e.containerPoint) < 12) return finishMask();
  }
  ed.maskDraft.push(uv);
  drawMaskDraft();
}

function finishMask() {
  if (!ed.maskDraft || ed.maskDraft.length < 3) return;
  ed.layer.mask = ed.maskDraft;
  ed.maskDraft = null;
  rt(ed.layer.id).overlay?.setMask(ed.layer.mask);
  drawMask();
  scheduleSave();
}

function drawMask() {
  if (ed.maskLayer) ed.imgGroup.removeLayer(ed.maskLayer);
  ed.maskLayer = null;
  const mask = ed.layer?.mask;
  if (mask && mask.length >= 3) {
    // Dim everything outside the mask: outer ring = whole image, hole = mask.
    const w = ed.layer.width, h = ed.layer.height;
    const outer = [[-h * 2, -w], [-h * 2, w * 2], [h, w * 2], [h, -w]];
    ed.maskLayer = L.polygon([outer, mask.map(toImgLatLng)], { color: '#00d1ff', weight: 2, dashArray: '6 4', fillColor: '#000', fillOpacity: 0.45, interactive: false });
    ed.imgGroup.addLayer(ed.maskLayer);
  }
  drawMaskDraft();
}

function drawMaskDraft() {
  if (ed.draftLayer) ed.imgGroup.removeLayer(ed.draftLayer);
  ed.draftLayer = null;
  if (!ed.maskDraft?.length) return;
  const g = L.layerGroup([L.polyline(ed.maskDraft.map(toImgLatLng), { color: '#00d1ff', weight: 2, interactive: false })]);
  ed.maskDraft.forEach((uv, i) => g.addLayer(L.circleMarker(toImgLatLng(uv), { radius: i === 0 ? 6 : 4, color: '#003845', weight: 1, fillColor: '#00d1ff', fillOpacity: 1, interactive: false })));
  ed.draftLayer = g;
  ed.imgGroup.addLayer(g);
}

$('#ed-mask-finish').addEventListener('click', finishMask);
$('#ed-mask-clear').addEventListener('click', () => {
  ed.layer.mask = null;
  ed.maskDraft = null;
  rt(ed.layer.id).overlay?.setMask(null);
  drawMask();
  scheduleSave();
});

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('#add-dialog').open) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') {
    if (measure.active) return measure.toggle(false);
    if (ed.layer) {
      if (ed.maskDraft) { ed.maskDraft = null; drawMaskDraft(); return; }
      if (!cancelPending()) { ed.selectedId = null; refreshEditor(); }
    }
  } else if (key === 'enter' && ed.layer && ed.mode === 'mask') {
    finishMask();
  } else if ((key === 'delete' || key === 'backspace') && ed.layer && ed.selectedId) {
    e.preventDefault();
    deletePoint(ed.selectedId);
  } else if (key === 'm') {
    measure.toggle();
  } else if (key === 't') {
    const targets = ed.layer ? [ed.layer] : state.selectedId ? [byId(state.selectedId)] : state.layers;
    const on = !targets.some((l) => l.visible !== false);
    targets.forEach((l) => { l.visible = on; syncOverlay(l); });
    if (!ed.layer) { renderList(); writeHash(); }
  }
});

// ---------------------------------------------------------------- start

await loadState();
for (const layer of state.layers) {
  rt(layer.id).fit = fitTransform(layer.points || [], layer.method || 'auto');
  layerDefaults.set(layer.id, { visible: layer.visible, opacity: layer.opacity, display: layer.display });
}
renderSetInfo();
const initial = readHash();
if (!state.editable) applyHashLayers(initial);
const shown = state.layers.filter((l) => l.visible !== false).map(planBounds).filter(Boolean);
const all = shown.length ? shown : state.layers.map(planBounds).filter(Boolean);
if (initial.view) map.setView(initial.view.center, initial.view.zoom);
else if (all.length) map.fitBounds(all.reduce((a, b) => a.extend(b), L.latLngBounds(all[0].getSouthWest(), all[0].getNorthEast())));
else map.setView([52.2297, 21.0122], 13);
if (SMALL_SCREEN && !state.editable) setPanelOpen(false);
renderList();
await syncAll();
renderList();

// Pasting a different link into the same tab.
window.addEventListener('hashchange', () => {
  const h = readHash();
  if (h.view) map.setView(h.view.center, h.view.zoom);
  if (!state.editable) {
    for (const l of state.layers) Object.assign(l, layerDefaults.get(l.id));
    applyHashLayers(h);
    syncAll();
    renderList();
  }
});

// Handy from the browser console.
window.planOverlay = { state, ed, map, runtime };
