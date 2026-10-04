// Country shapes, point lookups, and the stats that depend on them.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;
  const N = G.N;
  const RAW = window.BH_COUNTRY_DATA;

  const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'];

  // [id, name, iso2, continent, un, areaKm2, polygons]
  const list = RAW.list.map((r, i) => ({ i, id: r[0], name: r[1], iso: r[2], continent: r[3], un: r[4] === 1, area: r[5], enc: r[6] }));
  const byId = new Map(list.map((c) => [c.id, c]));

  let parts = null; // { ci, rings: [Float64Array], bbox }
  let gridIndex = null; // 10 degree buckets
  const GRID = 10;

  function decode() {
    if (parts) return;
    parts = [];
    const s = RAW.scale;
    for (const c of list) {
      c.polys = [];
      for (const poly of c.enc) {
        const rings = poly.map((enc) => {
          const out = new Float64Array(enc.length);
          let x = 0, y = 0;
          for (let i = 0; i < enc.length; i += 2) {
            x += enc[i];
            y += enc[i + 1];
            out[i] = x / s;
            out[i + 1] = y / s;
          }
          return out;
        });
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        const outer = rings[0];
        for (let i = 0; i < outer.length; i += 2) {
          if (outer[i] < minX) minX = outer[i];
          if (outer[i] > maxX) maxX = outer[i];
          if (outer[i + 1] < minY) minY = outer[i + 1];
          if (outer[i + 1] > maxY) maxY = outer[i + 1];
        }
        const p = { ci: c.i, rings, bbox: [minX, minY, maxX, maxY] };
        parts.push(p);
        c.polys.push(rings);
      }
    }
    gridIndex = new Map();
    parts.forEach((p, pi) => {
      const gx0 = Math.floor((p.bbox[0] + 180) / GRID), gx1 = Math.floor((p.bbox[2] + 180) / GRID);
      const gy0 = Math.floor((p.bbox[1] + 90) / GRID), gy1 = Math.floor((p.bbox[3] + 90) / GRID);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = gy * 100 + gx;
          if (!gridIndex.has(k)) gridIndex.set(k, []);
          gridIndex.get(k).push(pi);
        }
      }
    });
  }

  function inRings(rings, x, y) {
    let inside = false;
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const yi = r[i + 1], yj = r[j + 1];
        if ((yi > y) !== (yj > y) && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
      }
    }
    return inside;
  }

  function candidates(lng, lat, padDeg) {
    const out = new Set();
    const gx0 = Math.floor((lng - padDeg + 180) / GRID), gx1 = Math.floor((lng + padDeg + 180) / GRID);
    const gy0 = Math.floor((lat - padDeg + 90) / GRID), gy1 = Math.floor((lat + padDeg + 90) / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const arr = gridIndex.get(gy * 100 + gx);
        if (arr) arr.forEach((pi) => out.add(pi));
      }
    }
    return out;
  }

  function countryAt(lat, lng) {
    decode();
    for (const pi of candidates(lng, lat, 0)) {
      const p = parts[pi];
      const b = p.bbox;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      if (inRings(p.rings, lng, lat)) return p.ci;
    }
    return -1;
  }

  // Nearest country within maxKm, for coastlines the 1:50m shapes miss.
  function nearestCountry(lat, lng, maxKm) {
    decode();
    const padDeg = maxKm / 111 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const kx = Math.cos((lat * Math.PI) / 180);
    let best = Infinity, bestCi = -1;
    for (const pi of candidates(lng, lat, padDeg)) {
      const p = parts[pi];
      const b = p.bbox;
      if (lng < b[0] - padDeg || lng > b[2] + padDeg || lat < b[1] - padDeg || lat > b[3] + padDeg) continue;
      for (const r of p.rings) {
        for (let i = 0; i + 3 < r.length; i += 2) {
          const ax = (r[i] - lng) * kx, ay = r[i + 1] - lat;
          const bx = (r[i + 2] - lng) * kx, by = r[i + 3] - lat;
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy;
          let t = L2 ? -(ax * dx + ay * dy) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          const px = ax + t * dx, py = ay + t * dy;
          const d = px * px + py * py;
          if (d < best) {
            best = d;
            bestCi = p.ci;
          }
        }
      }
    }
    return Math.sqrt(best) * 111.2 <= maxKm ? bestCi : -1;
  }

  // Country for each level-16 block (about 4 x 4 cells), cached.
  const blockCache = new Map();
  function countryOfBlock(k16) {
    let v = blockCache.get(k16);
    if (v === undefined) {
      const M = 2 ** 16;
      const ix = k16 % M, iy = (k16 - ix) / M;
      const lat = G.yToLat((iy + 0.5) / M), lng = G.xToLng((ix + 0.5) / M);
      v = countryAt(lat, lng);
      if (v < 0) v = nearestCountry(lat, lng, 12);
      blockCache.set(k16, v);
    }
    return v;
  }

  // Everything the Stats screen needs, in one pass over the cells.
  function computeStats() {
    decode();
    const cells = BH.store.cells;
    const today = BH.today();
    const per = new Map(); // ci -> { area, cells, first, last }
    const blockDay = new Map(); // k16 -> earliest known day
    const days = new Set();
    let total = 0, land = 0, week = 0, month = 0, todayArea = 0;
    for (const [key, day] of cells) {
      const ix = key % N;
      const iy = (key - ix) / N;
      const a = G.cellAreaKm2(iy);
      total += a;
      const k16 = (iy >> 2) * 65536 + (ix >> 2);
      const ci = countryOfBlock(k16);
      if (ci >= 0) {
        land += a;
        let s = per.get(ci);
        if (!s) per.set(ci, (s = { area: 0, cells: 0, first: 0, last: 0 }));
        s.area += a;
        s.cells++;
        if (day) {
          if (!s.first || day < s.first) s.first = day;
          if (day > s.last) s.last = day;
        }
      }
      if (day) {
        days.add(day);
        const age = today - day;
        if (age < 1) todayArea += a;
        if (age < 7) week += a;
        if (age < 30) month += a;
        const bd = blockDay.get(k16);
        if (!bd || day < bd) blockDay.set(k16, day);
      } else if (!blockDay.has(k16)) {
        blockDay.set(k16, 0);
      }
    }

    const visited = [];
    const seen = new Set();
    for (const [ci, s] of per) {
      const c = list[ci];
      seen.add(ci);
      visited.push({ c, area: s.area, pct: c.area ? (s.area / c.area) * 100 : 0, first: s.first, last: s.last, manual: false });
    }
    for (const id of BH.store.manual) {
      const c = byId.get(id);
      if (c && !seen.has(c.i)) visited.push({ c, area: 0, pct: 0, first: 0, last: 0, manual: true });
    }
    visited.sort((a, b) => b.area - a.area || a.c.name.localeCompare(b.c.name));

    const cont = CONTINENTS.map((name) => ({ name, total: 0, visited: 0, any: false }));
    const contIdx = new Map(cont.map((c, i) => [c.name, i]));
    for (const c of list) if (c.un && contIdx.has(c.continent)) cont[contIdx.get(c.continent)].total++;
    for (const v of visited) {
      const i = contIdx.get(v.c.continent);
      if (i === undefined) continue;
      cont[i].any = true;
      if (v.c.un) cont[i].visited++;
    }

    return {
      total, land, week, month, today: todayArea,
      worldPct: (land / RAW.land) * 100,
      countries: visited,
      unCount: visited.filter((v) => v.c.un).length,
      territoryCount: visited.filter((v) => !v.c.un).length,
      continents: cont,
      continentCount: cont.filter((c) => c.any).length,
      daysExploring: days.size,
      blockDay,
    };
  }

  // Leaflet polygons ([lat, lng]) for a country.
  function latLngs(c) {
    decode();
    return c.polys.map((rings) => rings.map((r) => {
      const out = [];
      for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]);
      return out;
    }));
  }

  BH.countries = { list, byId, CONTINENTS, countryAt, nearestCountry, computeStats, latLngs, decode };
})();
