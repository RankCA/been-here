// Import past trips: GPX, KML, GeoJSON, Google Maps Timeline, photos, backups.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;

  // Streams points into the store, joining close ones into lines.
  function joiner(opts) {
    const o = Object.assign({ maxJoinKm: 3, maxJoinKmUntimed: 2, maxSpeedKmh: 200, maxGapMin: 30, join: true }, opts);
    const buf = [];
    let prev = null;
    const j = { added: 0, points: 0 };
    j.push = (lat, lng, t) => {
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return;
      if (lat === 0 && lng === 0) return;
      j.points++;
      const day = t ? BH.dayOf(t) : 0; // 0 = date unknown
      buf.length = 0;
      let join = false;
      if (o.join && prev) {
        const d = G.distKm(prev.lat, prev.lng, lat, lng);
        if (t && prev.t) {
          const hours = Math.abs(t - prev.t) / 3600000;
          join = d <= o.maxJoinKm && hours * 60 <= o.maxGapMin && (hours === 0 ? d < 0.5 : d / hours <= o.maxSpeedKmh);
        } else {
          join = d <= o.maxJoinKmUntimed;
        }
      }
      if (join) G.segmentCells(prev.lat, prev.lng, lat, lng, buf);
      else buf.push(G.cellOf(lat, lng));
      for (const k of buf) if (BH.store.add(k, day)) j.added++;
      prev = { lat, lng, t };
    };
    j.cut = () => { prev = null; };
    return j;
  }

  function parseTime(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
    if (/^\d+$/.test(v)) return +v > 1e11 ? +v : +v * 1000;
    const ms = Date.parse(v);
    return isNaN(ms) ? 0 : ms;
  }

  // ---------- XML formats ----------
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read this file');
    return doc;
  }

  function importGpx(text, j) {
    const doc = parseXml(text);
    const segs = Array.from(doc.getElementsByTagName('trkseg'));
    const rtes = Array.from(doc.getElementsByTagName('rte'));
    const timeOf = (el) => {
      const t = el.getElementsByTagName('time')[0];
      return t ? parseTime(t.textContent.trim()) : 0;
    };
    const run = (els) => {
      j.cut();
      for (const p of els) j.push(+p.getAttribute('lat'), +p.getAttribute('lon'), timeOf(p));
    };
    segs.forEach((s) => run(s.getElementsByTagName('trkpt')));
    rtes.forEach((r) => run(r.getElementsByTagName('rtept')));
    for (const w of Array.from(doc.getElementsByTagName('wpt'))) {
      j.cut();
      j.push(+w.getAttribute('lat'), +w.getAttribute('lon'), timeOf(w));
    }
    j.cut();
  }

  function importKml(text, j) {
    const doc = parseXml(text);
    for (const c of Array.from(doc.getElementsByTagName('coordinates'))) {
      j.cut();
      for (const tok of c.textContent.trim().split(/\s+/)) {
        const [lng, lat] = tok.split(',').map(Number);
        j.push(lat, lng, 0);
      }
    }
    const coords = doc.getElementsByTagNameNS('*', 'coord');
    if (coords.length) {
      j.cut();
      const whens = doc.getElementsByTagName('when');
      Array.from(coords).forEach((c, i) => {
        const [lng, lat] = c.textContent.trim().split(/\s+/).map(Number);
        j.push(lat, lng, whens[i] ? parseTime(whens[i].textContent.trim()) : 0);
      });
    }
    j.cut();
  }

  // ---------- JSON formats ----------
  function importGeoJson(obj, j) {
    const geom = (g) => {
      if (!g) return;
      const line = (cs) => { j.cut(); cs.forEach((c) => j.push(c[1], c[0], 0)); j.cut(); };
      switch (g.type) {
        case 'Point': j.cut(); j.push(g.coordinates[1], g.coordinates[0], 0); break;
        case 'MultiPoint': g.coordinates.forEach((c) => { j.cut(); j.push(c[1], c[0], 0); }); break;
        case 'LineString': line(g.coordinates); break;
        case 'MultiLineString': g.coordinates.forEach(line); break;
        case 'Polygon': g.coordinates.forEach(line); break;
        case 'MultiPolygon': g.coordinates.forEach((p) => p.forEach(line)); break;
        case 'GeometryCollection': g.geometries.forEach(geom); break;
        default: break;
      }
    };
    if (obj.type === 'FeatureCollection') obj.features.forEach((f) => geom(f.geometry));
    else if (obj.type === 'Feature') geom(obj.geometry);
    else geom(obj);
  }

  const GEO_URI = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
  const DEG_PAIR = /^(-?\d+(?:\.\d+)?)°,\s*(-?\d+(?:\.\d+)?)°$/;

  // Google Maps Timeline exports come in several shapes (phone export,
  // Takeout Records.json, Semantic Location History). Walk the whole tree and
  // pick up anything that looks like a position, keeping the latest time seen.
  function importGoogle(root, j) {
    let curT = 0, segStart = 0;
    const visit = (v) => {
      if (Array.isArray(v)) {
        for (const x of v) visit(x);
        return;
      }
      if (!v || typeof v !== 'object') return;
      if (v.startTime) {
        segStart = parseTime(v.startTime);
        curT = segStart;
        j.cut();
      }
      const t = v.timestamp || v.time || v.timestampMs || v.startTimestamp;
      if (t) curT = parseTime(t) || curT;
      if (v.durationMinutesOffsetFromStartTime != null && segStart) curT = segStart + +v.durationMinutesOffsetFromStartTime * 60000;
      const poor = (v.accuracy > 250) || (v.accuracyMeters > 250);
      const latE7 = v.latitudeE7 != null ? v.latitudeE7 : v.latE7;
      const lngE7 = v.longitudeE7 != null ? v.longitudeE7 : v.lngE7;
      if (typeof latE7 === 'number' && typeof lngE7 === 'number') {
        if (!poor) j.push(latE7 / 1e7, (lngE7 > 1800000000 ? lngE7 - 4294967296 : lngE7) / 1e7, curT);
      } else if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
        if (!poor) j.push(v.latitude, v.longitude, curT);
      } else if (typeof v.lat === 'number' && typeof (v.lng != null ? v.lng : v.lon) === 'number') {
        if (!poor) j.push(v.lat, v.lng != null ? v.lng : v.lon, curT);
      }
      for (const k in v) {
        const x = v[k];
        if (typeof x === 'string') {
          if (poor) continue;
          const m = GEO_URI.exec(x) || DEG_PAIR.exec(x);
          if (m) j.push(+m[1], +m[2], curT);
        } else if (x && typeof x === 'object') {
          visit(x);
        }
      }
    };
    visit(root);
    j.cut();
  }

  // ---------- Photos ----------
  function readTiff(b, t) {
    const le = b[t] === 0x49 && b[t + 1] === 0x49;
    const be = b[t] === 0x4d && b[t + 1] === 0x4d;
    if (!le && !be) return null;
    const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const u32 = (o) => (le
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
      : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
    if (u16(t + 2) !== 42) return null;
    const entries = (ifd) => {
      const out = {};
      if (!(ifd > 0 && ifd + 2 < b.length)) return out;
      const cnt = u16(ifd);
      for (let i = 0; i < cnt && i < 400; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) break;
        out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
      }
      return out;
    };
    const e0 = entries(t + u32(t + 4));
    if (!e0[0x8825]) return null;
    const g = entries(t + u32(e0[0x8825].at));
    if (!g[2] || !g[4]) return null;
    const dms = (ent) => {
      const o = t + u32(ent.at);
      const r = (k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1);
      return r(0) + r(1) / 60 + r(2) / 3600;
    };
    let lat = dms(g[2]), lng = dms(g[4]);
    if (g[1] && String.fromCharCode(b[g[1].at]) === 'S') lat = -lat;
    if (g[3] && String.fromCharCode(b[g[3].at]) === 'W') lng = -lng;
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
    let time = 0;
    if (e0[0x8769]) {
      const ex = entries(t + u32(e0[0x8769].at));
      const dt = ex[0x9003] || ex[0x9004];
      if (dt) {
        const o = t + u32(dt.at);
        let s = '';
        for (let i = 0; i < 19; i++) s += String.fromCharCode(b[o + i]);
        const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s);
        if (m) time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      }
    }
    return { lat, lng, time };
  }

  function findGps(b) {
    for (let i = 0; i + 14 < b.length; i++) {
      if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
        try {
          const r = readTiff(b, i + 6);
          if (r) return r;
        } catch (e) { /* keep looking */ }
      }
    }
    // Some HEIC files store the TIFF block without the Exif marker.
    for (let i = 0; i + 8 < b.length; i++) {
      const mm = b[i] === 0x4d && b[i + 1] === 0x4d && b[i + 2] === 0 && b[i + 3] === 42;
      const ii = b[i] === 0x49 && b[i + 1] === 0x49 && b[i + 2] === 42 && b[i + 3] === 0;
      if (mm || ii) {
        try {
          const r = readTiff(b, i);
          if (r) return r;
        } catch (e) { /* keep looking */ }
      }
    }
    return null;
  }

  async function photoGps(file) {
    const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
    let r = findGps(head);
    if (!r && file.size > head.length && file.size < 60e6) r = findGps(new Uint8Array(await file.arrayBuffer()));
    return r;
  }

  // ---------- Entry point ----------
  // Returns { added, points, photos, photosWithGps, backups, failed: [names] }
  async function importFiles(files, onProgress) {
    const res = { added: 0, points: 0, photos: 0, photosWithGps: 0, backups: 0, failed: [] };
    const list = Array.from(files);
    const photoFixes = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (onProgress) onProgress(i + 1, list.length, f.name);
      const name = (f.name || '').toLowerCase();
      try {
        if (/\.(jpe?g|heic|heif|tiff?|dng|png)$/.test(name) || /^image\//.test(f.type)) {
          res.photos++;
          const g = await photoGps(f);
          if (g) {
            res.photosWithGps++;
            photoFixes.push(g);
          }
          continue;
        }
        const text = await f.text();
        const j = joiner();
        const head = text.slice(0, 2000);
        if (/\.gpx$/.test(name) || /<gpx[\s>]/.test(head)) importGpx(text, j);
        else if (/\.kml$/.test(name) || /<kml[\s>]/.test(head)) importKml(text, j);
        else {
          const obj = JSON.parse(text);
          if (obj && obj.app === 'been-here') {
            res.added += BH.store.importData(obj);
            res.backups++;
            continue;
          }
          if (obj && /^(FeatureCollection|Feature|Point|LineString|Polygon|Multi\w+|GeometryCollection)$/.test(obj.type)) importGeoJson(obj, j);
          else importGoogle(obj, j);
        }
        res.added += j.added;
        res.points += j.points;
        if (!j.points) res.failed.push(f.name);
      } catch (e) {
        console.error(e);
        res.failed.push(f.name);
      }
      await BH.sleep(0);
    }
    if (photoFixes.length) {
      const j = joiner({ join: false });
      photoFixes.sort((a, b) => a.time - b.time).forEach((g) => j.push(g.lat, g.lng, g.time));
      res.added += j.added;
      res.points += j.points;
    }
    BH.store.save();
    return res;
  }

  BH.importers = { importFiles, joiner, findGps };
})();
