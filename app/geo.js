// Projections and control-point transforms. Pure functions, no DOM.
// Conventions: image points are [u, v] in pixels (v grows downwards),
// world points are [lng, lat] in WGS84 (GeoJSON order).

const proj4 = window.proj4;

// PL-2000 zones (EPSG:2176..2179) keyed by the leading digit of the easting (Y).
export const PL2000 = { 5: 'EPSG:2176', 6: 'EPSG:2177', 7: 'EPSG:2178', 8: 'EPSG:2179' };

proj4.defs('EPSG:2180', '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
for (const [zone, code] of Object.entries(PL2000)) {
  proj4.defs(code, `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=0.999923 +x_0=${zone}500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`);
}

// Polish surveying convention: X = northing, Y = easting.
// Y with 7 digits starting 5..8 is PL-2000 (zone = first digit), otherwise PUWG-1992.
export function polishCrsFor(Y) {
  if (Y >= 5e6 && Y < 9e6) return PL2000[Math.floor(Y / 1e6)];
  return 'EPSG:2180';
}

export function polishToLngLat(X, Y) {
  const code = polishCrsFor(Y);
  return { code, lngLat: proj4(code, 'EPSG:4326', [Y, X]) };
}

export function lngLatToPolish([lng, lat]) {
  const zone = Math.min(8, Math.max(5, Math.round(lng / 3)));
  const code = PL2000[zone];
  const [Y, X] = proj4('EPSG:4326', code, [lng, lat]);
  return { code, X, Y };
}

// Local conformal projection with unit scale, so distances come out in true metres.
export function localProjection(lng0, lat0) {
  return proj4('EPSG:4326', `+proj=tmerc +lat_0=${lat0} +lon_0=${lng0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`);
}

export function distanceMeters(a, b) {
  const p = localProjection((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  const [x1, y1] = p.forward(a), [x2, y2] = p.forward(b);
  return Math.hypot(x2 - x1, y2 - y1);
}

// ---------- linear algebra ----------

// Solves the square system M x = r with partial pivoting; returns null when singular.
function solve(M, r) {
  const n = r.length;
  const A = M.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c] / A[c][c];
      for (let j = c; j <= n; j++) A[i][j] -= f * A[c][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

// Least squares via normal equations; rows are [coefficients..., rhs].
function leastSquares(rows, k) {
  const N = Array.from({ length: k }, () => new Array(k).fill(0));
  const r = new Array(k).fill(0);
  for (const row of rows) {
    for (let i = 0; i < k; i++) {
      r[i] += row[i] * row[k];
      for (let j = 0; j < k; j++) N[i][j] += row[i] * row[j];
    }
  }
  return solve(N, r);
}

const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export function apply3(H, [x, y]) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

// Centres the points and scales them to unit mean distance (Hartley normalisation).
function normaliser(pts, flipY = false) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1;
  const sy = flipY ? -1 : 1;
  return {
    T: [[1 / d, 0, -cx / d], [0, sy / d, -sy * cy / d], [0, 0, 1]],
    Tinv: [[d, 0, cx], [0, sy * d, cy], [0, 0, 1]],
  };
}

const MIN_POINTS = { similarity: 2, affine: 3, projective: 4 };

// Fits src -> dst. Image v is flipped during normalisation so "similarity" means
// rotation + uniform scale without mirroring between a top-down image and a map.
function fitMatrix(src, dst, method) {
  const ns = normaliser(src, true), nd = normaliser(dst);
  const s = src.map((p) => apply3(ns.T, p)), d = dst.map((p) => apply3(nd.T, p));
  let Hn;
  if (method === 'similarity') {
    const rows = [];
    s.forEach(([x, y], i) => {
      rows.push([x, -y, 1, 0, d[i][0]]);
      rows.push([y, x, 0, 1, d[i][1]]);
    });
    const p = leastSquares(rows, 4);
    if (!p) return null;
    Hn = [[p[0], -p[1], p[2]], [p[1], p[0], p[3]], [0, 0, 1]];
  } else if (method === 'affine') {
    const rows = [];
    s.forEach(([x, y], i) => {
      rows.push([x, y, 1, 0, 0, 0, d[i][0]]);
      rows.push([0, 0, 0, x, y, 1, d[i][1]]);
    });
    const p = leastSquares(rows, 6);
    if (!p) return null;
    Hn = [[p[0], p[1], p[2]], [p[3], p[4], p[5]], [0, 0, 1]];
  } else {
    const rows = [];
    s.forEach(([x, y], i) => {
      const [X, Y] = d[i];
      rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
      rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
    });
    const p = leastSquares(rows, 8);
    if (!p) return null;
    Hn = [[p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], 1]];
  }
  const H = mul(nd.Tinv, mul(Hn, ns.T));
  return H.every((row) => row.every(Number.isFinite)) ? H : null;
}

// Exact homography through 4 point pairs (used to build the CSS matrix3d).
export function homography4(src, dst) {
  return fitMatrix(src, dst, 'projective');
}

export function cssMatrix3d(H) {
  const k = 1 / H[2][2];
  const h = H.map((row) => row.map((v) => v * k));
  return `matrix3d(${h[0][0]},${h[1][0]},0,${h[2][0]},${h[0][1]},${h[1][1]},0,${h[2][1]},0,0,1,0,${h[0][2]},${h[1][2]},0,${h[2][2]})`;
}

// Fits image -> world from control points.
// method: 'auto' | 'similarity' | 'affine' | 'projective'. Degrades to what the point count allows.
export function fitTransform(points, method = 'auto') {
  const used = points.filter((p) => p.enabled !== false && p.img && p.world);
  const n = used.length;
  if (n < 2) return null;
  let m = method === 'auto' ? (n >= 4 ? 'affine' : 'similarity') : method;
  while (n < MIN_POINTS[m]) m = m === 'projective' ? 'affine' : 'similarity';

  const lng0 = used.reduce((s, p) => s + p.world[0], 0) / n;
  const lat0 = used.reduce((s, p) => s + p.world[1], 0) / n;
  const proj = localProjection(lng0, lat0);
  const H = fitMatrix(used.map((p) => p.img), used.map((p) => proj.forward(p.world)), m);
  if (!H) return null;
  const Hinv = invert3(H);
  if (!Hinv) return null;

  const imageToLngLat = (uv) => proj.inverse(apply3(H, uv));
  const lngLatToImage = (ll) => apply3(Hinv, proj.forward(ll));

  const residuals = {};
  for (const p of points) {
    if (!p.img || !p.world) continue;
    const [x, y] = apply3(H, p.img), [X, Y] = proj.forward(p.world);
    residuals[p.id] = Math.hypot(x - X, y - Y);
  }
  const rms = Math.sqrt(used.reduce((s, p) => s + residuals[p.id] ** 2, 0) / n);
  // Average ground size of one image pixel at the centroid of the used points.
  const cu = used.reduce((s, p) => s + p.img[0], 0) / n, cv = used.reduce((s, p) => s + p.img[1], 0) / n;
  const o = apply3(H, [cu, cv]), ex = apply3(H, [cu + 1, cv]), ey = apply3(H, [cu, cv + 1]);
  const mPerPx = Math.sqrt(Math.abs((ex[0] - o[0]) * (ey[1] - o[1]) - (ex[1] - o[1]) * (ey[0] - o[0])));

  return { method: m, requested: method, n, rms, residuals, mPerPx, imageToLngLat, lngLatToImage, exact: n === MIN_POINTS[m] };
}
