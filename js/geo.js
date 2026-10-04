// Grid maths. The world is split into Web Mercator cells at level 18
// (about 150 m at the equator, 95 m in London). A visited cell is a key:
// key = iy * 2^18 + ix.
(function () {
  'use strict';
  const BH = window.BH;

  const FINE = 18;
  const N = 2 ** FINE;
  const MIN_LEVEL = 6;
  const EARTH_C = 40075.016686; // km
  const R_KM = 6371.0088;
  const MAX_LAT = 85.05112878;
  const D2R = Math.PI / 180;

  const lngToX = (lng) => (lng + 180) / 360;
  const latToY = (lat) => {
    lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    const s = Math.sin(lat * D2R);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };
  const xToLng = (x) => x * 360 - 180;
  const yToLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R;

  const wrapIx = (ix) => ((ix % N) + N) % N;

  function cellOf(lat, lng) {
    const ix = wrapIx(Math.floor(lngToX(lng) * N));
    const iy = Math.min(N - 1, Math.max(0, Math.floor(latToY(lat) * N)));
    return iy * N + ix;
  }

  function keyXY(key) {
    const ix = key % N;
    return [ix, (key - ix) / N];
  }

  function cellCenter(key) {
    const [ix, iy] = keyXY(key);
    return { lat: yToLat((iy + 0.5) / N), lng: xToLng((ix + 0.5) / N) };
  }

  // Ground area of one cell in row iy. Cached per row.
  const rowArea = new Map();
  function cellAreaKm2(iy) {
    let a = rowArea.get(iy);
    if (a === undefined) {
      const side = (EARTH_C / N) * Math.cos(yToLat((iy + 0.5) / N) * D2R);
      a = side * side;
      rowArea.set(iy, a);
    }
    return a;
  }

  function parentKey(key, level) {
    const ix = key % N;
    const iy = (key - ix) / N;
    const s = FINE - level;
    return (iy >> s) * 2 ** level + (ix >> s);
  }

  function distKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * D2R;
    const dLng = (lng2 - lng1) * D2R;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Every cell a straight line passes through.
  function segmentCells(lat1, lng1, lat2, lng2, out) {
    const x1 = lngToX(lng1) * N, y1 = latToY(lat1) * N;
    let x2 = lngToX(lng2) * N;
    const y2 = latToY(lat2) * N;
    if (x2 - x1 > N / 2) x2 -= N;
    else if (x1 - x2 > N / 2) x2 += N;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ix = wrapIx(Math.floor(x1 + (x2 - x1) * t));
      const iy = Math.floor(y1 + (y2 - y1) * t);
      if (iy < 0 || iy >= N) continue;
      const k = iy * N + ix;
      if (k !== last) {
        out.push(k);
        last = k;
      }
    }
    return out;
  }

  // Cells whose centres sit within r cells of the fractional point (cx, cy).
  function discCells(cx, cy, r, out) {
    const R = Math.max(r, 0.5);
    const y0 = Math.floor(cy - R), y1 = Math.floor(cy + R);
    for (let iy = y0; iy <= y1; iy++) {
      if (iy < 0 || iy >= N) continue;
      const dy = iy + 0.5 - cy;
      const half = Math.sqrt(Math.max(0, R * R - dy * dy));
      const x0 = Math.floor(cx - half), x1 = Math.floor(cx + half);
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix + 0.5 - cx;
        if (dx * dx + dy * dy <= R * R || (ix === Math.floor(cx) && iy === Math.floor(cy))) out.push(iy * N + wrapIx(ix));
      }
    }
    return out;
  }

  // Scanline raster of polygon rings (flat [lng, lat, ...] arrays, even-odd fill).
  // Returns the cells inside as horizontal spans per row.
  function rasterize(rings) {
    let minY = Infinity, maxY = -Infinity;
    const conv = rings.map((ring) => {
      const a = new Float64Array(ring.length);
      for (let i = 0; i < ring.length; i += 2) {
        a[i] = lngToX(ring[i]) * N;
        const y = latToY(ring[i + 1]) * N;
        a[i + 1] = y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return a;
    });
    const iy0 = Math.max(0, Math.ceil(minY - 0.5));
    const iy1 = Math.min(N - 1, Math.ceil(maxY - 0.5) - 1);
    if (!(iy1 >= iy0)) return null;
    const rows = new Array(iy1 - iy0 + 1);
    for (const a of conv) {
      const n = a.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const xa = a[2 * i], ya = a[2 * i + 1], xb = a[2 * j], yb = a[2 * j + 1];
        if (ya === yb) continue;
        const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
        const r0 = Math.max(iy0, Math.ceil(lo - 0.5));
        const r1 = Math.min(iy1, Math.ceil(hi - 0.5) - 1);
        for (let r = r0; r <= r1; r++) {
          const x = xa + ((r + 0.5 - ya) * (xb - xa)) / (yb - ya);
          const row = rows[r - iy0] || (rows[r - iy0] = []);
          row.push(x);
        }
      }
    }
    let total = 0, area = 0;
    const spans = new Array(rows.length);
    for (let k = 0; k < rows.length; k++) {
      const xs = rows[k];
      if (!xs) continue;
      xs.sort((p, q) => p - q);
      const s = [];
      let count = 0;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a0 = Math.ceil(xs[i] - 0.5);
        const a1 = Math.ceil(xs[i + 1] - 0.5) - 1;
        if (a1 >= a0) {
          s.push(a0, a1);
          count += a1 - a0 + 1;
        }
      }
      if (count) {
        spans[k] = s;
        total += count;
        area += count * cellAreaKm2(iy0 + k);
      }
    }
    return { iy0, iy1, spans, total, area };
  }

  function rasterHas(r, ix, iy) {
    if (iy < r.iy0 || iy > r.iy1) return false;
    const s = r.spans[iy - r.iy0];
    if (!s) return false;
    let lo = 0, hi = s.length / 2 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ix < s[2 * mid]) hi = mid - 1;
      else if (ix > s[2 * mid + 1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  // Visited cells and area inside a raster.
  function rasterProgress(r, cells) {
    let count = 0, area = 0;
    for (const key of cells.keys()) {
      const ix = key % N;
      const iy = (key - ix) / N;
      if (iy < r.iy0 || iy > r.iy1) continue;
      if (rasterHas(r, ix, iy)) {
        count++;
        area += cellAreaKm2(iy);
      }
    }
    return { count, area, pct: r.total ? (count / r.total) * 100 : 0 };
  }

  // Share of cells explored within radiusKm of a point.
  function nearbyProgress(lat, lng, radiusKm, cells) {
    const cx = lngToX(lng) * N, cy = latToY(lat) * N;
    const side = (EARTH_C / N) * Math.cos(lat * D2R);
    const r = radiusKm / side;
    const keys = discCells(cx, cy, r, []);
    let hit = 0;
    for (const k of keys) if (cells.has(k)) hit++;
    return { total: keys.length, count: hit, pct: keys.length ? (hit / keys.length) * 100 : 0 };
  }

  BH.geo = {
    FINE, N, MIN_LEVEL, EARTH_C, MAX_LAT,
    lngToX, latToY, xToLng, yToLat, wrapIx,
    cellOf, keyXY, cellCenter, cellAreaKm2, parentKey, distKm,
    segmentCells, discCells, rasterize, rasterHas, rasterProgress, nearbyProgress,
  };
})();
