// Neighbourhoods, districts, cities and regions from OpenStreetMap,
// with how much of each you have explored.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;

  // Nominatim reverse zoom levels, from small to large.
  const LEVELS = [
    { z: 14, tol: 0.00005 },
    { z: 12, tol: 0.0001 },
    { z: 10, tol: 0.0003 },
    { z: 8, tol: 0.0008 },
    { z: 5, tol: 0.002 },
  ];

  const KIND = {
    neighbourhood: 'Neighbourhood', quarter: 'Neighbourhood', suburb: 'Neighbourhood', residential: 'Neighbourhood',
    city_district: 'District', borough: 'District', district: 'District', municipality: 'Municipality',
    city: 'City', town: 'Town', village: 'Village', hamlet: 'Village',
    county: 'County', state_district: 'County',
    state: 'Region', region: 'Region', province: 'Region',
    country: 'Country',
  };

  const rasters = new Map(); // id -> raster

  function toRings(geojson) {
    const polys = geojson.type === 'Polygon' ? [geojson.coordinates] : geojson.coordinates;
    const rings = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const flat = [];
        for (const [lng, lat] of ring) flat.push(Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5);
        if (flat.length >= 8) rings.push(flat);
      }
    }
    return rings;
  }

  function raster(area) {
    let r = rasters.get(area.id);
    if (!r) {
      r = G.rasterize(area.rings);
      rasters.set(area.id, r);
    }
    return r;
  }

  function progress(area) {
    const r = raster(area);
    if (!r) return { count: 0, total: 0, area: 0, totalArea: 0, pct: 0 };
    const p = G.rasterProgress(r, BH.store.cells);
    return { count: p.count, total: r.total, area: p.area, totalArea: r.area, pct: p.pct };
  }

  let busy = false;
  async function lookup(lat, lng, onResult) {
    if (busy) return;
    busy = true;
    const seen = new Set();
    let found = 0;
    try {
      for (let i = 0; i < LEVELS.length; i++) {
        if (i) await BH.sleep(1100); // Nominatim asks for one request a second at most
        const { z, tol } = LEVELS[i];
        const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2'
          + `&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&zoom=${z}`
          + `&polygon_geojson=1&polygon_threshold=${tol}&accept-language=en`;
        let data;
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          data = await res.json();
        } catch (e) {
          if (i === 0) throw e;
          continue;
        }
        if (!data || !data.geojson || !/Polygon/.test(data.geojson.type)) continue;
        const id = (data.osm_type || 'x')[0] + data.osm_id;
        if (seen.has(id)) continue;
        seen.add(id);
        const rings = toRings(data.geojson);
        if (!rings.length) continue;
        const kindKey = data.addresstype || data.type;
        const area = {
          id,
          name: data.name || (data.display_name || '').split(',')[0] || 'Unnamed area',
          kind: KIND[kindKey] || (kindKey ? kindKey.charAt(0).toUpperCase() + kindKey.slice(1).replace(/_/g, ' ') : 'Area'),
          place: (data.display_name || '').split(',').slice(1, 3).join(',').trim(),
          rings,
        };
        found++;
        onResult(area);
      }
    } finally {
      busy = false;
    }
    return found;
  }

  function saved(id) {
    return BH.store.areas.find((a) => a.id === id);
  }

  function save(area) {
    if (saved(area.id)) return;
    BH.store.areas.unshift({ id: area.id, name: area.name, kind: area.kind, place: area.place, rings: area.rings, goal: 0, added: Date.now() });
    BH.store.saveMeta();
    BH.emit('meta');
  }

  function unsave(id) {
    BH.store.areas = BH.store.areas.filter((a) => a.id !== id);
    BH.store.saveMeta();
    BH.emit('meta');
  }

  function setGoal(id, goal) {
    const a = saved(id);
    if (!a) return;
    a.goal = goal;
    BH.store.saveMeta();
  }

  function latLngs(area) {
    return area.rings.map((r) => {
      const out = [];
      for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]);
      return out;
    });
  }

  BH.areas = { lookup, progress, save, unsave, saved, setGoal, latLngs, isBusy: () => busy };
})();
