// Leaflet layer that shows an image warped by an arbitrary image->world transform.
// The four image corners are projected to layer pixels and the element gets the exact
// CSS homography through them, so similarity, affine and projective fits all render.
// The source is either an image URL or a ready <canvas> (used for processed images).

import { homography4, cssMatrix3d } from './geo.js';

const L = window.L;

export const WarpedImage = L.Layer.extend({
  options: {
    pane: 'tilePane', // same stacking context as the basemap, so mix-blend-mode can blend with it
    opacity: 1,
    blend: 'normal',
    filter: '',
    mask: null,
    zIndex: 100,
  },

  initialize(source, width, height, imageToLngLat, options) {
    L.setOptions(this, options);
    this._source = source;
    this._w = width;
    this._h = height;
    this.setTransform(imageToLngLat, false);
  },

  onAdd() {
    if (!this._el) this._initElement();
    this.getPane().appendChild(this._el);
    this._reset();
  },

  onRemove() {
    L.DomUtil.remove(this._el);
  },

  getEvents() {
    const events = { zoom: this._reset, viewreset: this._reset };
    if (this._zoomAnimated) events.zoomanim = this._animateZoom;
    return events;
  },

  getBounds() {
    return L.latLngBounds(this._latlngs);
  },

  setTransform(imageToLngLat, redraw = true) {
    const corners = [[0, 0], [this._w, 0], [this._w, this._h], [0, this._h]];
    this._latlngs = corners.map((c) => {
      const [lng, lat] = imageToLngLat(c);
      return L.latLng(lat, lng);
    });
    if (redraw && this._map) this._reset();
    return this;
  },

  setSource(source) {
    if (source === this._source) return this;
    this._source = source;
    if (!this._el) return this;
    const old = this._el;
    this._initElement();
    if (old.parentNode) {
      old.replaceWith(this._el);
      if (this._map) this._reset();
    }
    return this;
  },

  setOpacity(opacity) {
    this.options.opacity = opacity;
    if (this._el) this._el.style.opacity = opacity;
    return this;
  },

  setBlend(blend) {
    this.options.blend = blend;
    if (this._el) this._el.style.mixBlendMode = blend;
    return this;
  },

  setFilter(filter) {
    this.options.filter = filter;
    if (this._el) this._el.style.filter = filter || '';
    return this;
  },

  setMask(mask) {
    this.options.mask = mask;
    if (this._el) {
      const clip = mask && mask.length >= 3 ? `polygon(${mask.map(([u, v]) => `${u}px ${v}px`).join(',')})` : '';
      this._el.style.clipPath = clip;
      this._el.style.webkitClipPath = clip;
    }
    return this;
  },

  setZIndex(z) {
    this.options.zIndex = z;
    if (this._el) this._el.style.zIndex = z;
    return this;
  },

  _initElement() {
    const src = this._source;
    let el;
    if (typeof src === 'string') {
      el = document.createElement('img');
      el.alt = '';
      el.decoding = 'async';
      el.draggable = false;
      el.onload = () => this.fire('load');
      el.src = src;
    } else {
      el = src;
    }
    this._el = el;
    el.classList.add('warped-image');
    if (this._zoomAnimated) el.classList.add('leaflet-zoom-animated');
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0', width: `${this._w}px`, height: `${this._h}px`,
      transformOrigin: '0 0', pointerEvents: 'none', userSelect: 'none',
    });
    this.setOpacity(this.options.opacity);
    this.setBlend(this.options.blend);
    this.setFilter(this.options.filter);
    this.setMask(this.options.mask);
    this.setZIndex(this.options.zIndex);
  },

  _apply(points) {
    const src = [[0, 0], [this._w, 0], [this._w, this._h], [0, this._h]];
    const H = homography4(src, points.map((p) => [p.x, p.y]));
    if (H) this._el.style.transform = cssMatrix3d(H);
  },

  _reset() {
    this._apply(this._latlngs.map((ll) => this._map.latLngToLayerPoint(ll)));
  },

  _animateZoom(e) {
    this._apply(this._latlngs.map((ll) => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center)));
  },
});
