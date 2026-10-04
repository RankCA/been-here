// Towns, cities and districts you have passed through (GeoNames, 15,000+ people).
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;

  let loading = null;
  let places = null; // { name, cc, lat, lng, pop, kind, r }
  let buckets = null;
  const B = 0.5; // bucket size in degrees

  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      if (window.BH_CITY_DATA) return resolve();
      const s = document.createElement('script');
      s.src = 'js/data/cities.js';
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Could not load the list of cities'));
      };
      document.head.appendChild(s);
    }).then(parse);
    return loading;
  }

  function parse() {
    if (places) return;
    places = [];
    buckets = new Map();
    for (const line of window.BH_CITY_DATA.split('\n')) {
      const f = line.split('\t');
      if (f.length < 6) continue;
      const pop = +f[4];
      const kind = f[5] || '';
      const r = kind === 'd'
        ? Math.min(1.5, Math.max(0.7, 0.5 * Math.sqrt(pop / 1e4)))
        : Math.min(8, Math.max(0.8, 0.6 * Math.sqrt(pop / 1e4)));
      const p = { name: f[0], cc: f[1], lat: +f[2], lng: +f[3], pop, kind, r };
      places.push(p);
      const k = Math.floor((p.lat + 90) / B) * 1000 + Math.floor((p.lng + 180) / B);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    window.BH_CITY_DATA = null;
  }

  // blockDay: level-16 block -> earliest day, from countries.computeStats.
  function visited(blockDay) {
    if (!places) return null;
    const M = 2 ** 16;
    const found = new Map(); // place -> earliest day
    for (const [k16, day] of blockDay) {
      const ix = k16 % M, iy = (k16 - ix) / M;
      const lat = G.yToLat((iy + 0.5) / M), lng = G.xToLng((ix + 0.5) / M);
      const by = Math.floor((lat + 90) / B), bx = Math.floor((lng + 180) / B);
      const spanX = Math.min(6, Math.ceil(1 / Math.max(0.15, Math.cos((lat * Math.PI) / 180))));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -spanX; dx <= spanX; dx++) {
          const arr = buckets.get((by + dy) * 1000 + (bx + dx));
          if (!arr) continue;
          for (const p of arr) {
            if (Math.abs(p.lat - lat) > 0.1) continue;
            if (G.distKm(lat, lng, p.lat, p.lng) > p.r) continue;
            const prev = found.get(p);
            if (prev === undefined || (day && (!prev || day < prev))) found.set(p, day);
          }
        }
      }
    }
    const out = [];
    for (const [p, day] of found) out.push({ p, day });
    out.sort((a, b) => (b.day || 0) - (a.day || 0) || b.p.pop - a.p.pop);
    return {
      towns: out.filter((x) => x.p.kind !== 'd'),
      districts: out.filter((x) => x.p.kind === 'd'),
    };
  }

  BH.cities = { load, visited, isLoaded: () => !!places };
})();
