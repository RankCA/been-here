// Visited cells, settings and saved areas, kept in IndexedDB.
// Cells are saved in regional chunks so a save only rewrites what changed.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;
  const N = G.N;

  const DB_NAME = 'been-here';
  const KV = 'kv';
  const CHUNKS = 'chunks';
  const CHUNK_SHIFT = 10; // a chunk is a level-8 tile, about 156 km across at the equator

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
          if (!d.objectStoreNames.contains(CHUNKS)) d.createObjectStore(CHUNKS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const result = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const DEFAULTS = {
    mapStyle: 'streets',
    fog: 'night',
    fogDensity: 0.92,
    showCountries: true,
    keepAwake: true,
    accuracy: 60,
    recording: false,
    brush: 'm',
    lastBackup: 0,
    view: null,
    seenIntro: false,
  };

  const cells = new Map(); // fine key -> first day (0 = unknown)
  const levels = {}; // level -> Map(coarse key -> number of fine cells)
  for (let L = G.MIN_LEVEL; L < G.FINE; L++) levels[L] = new Map();

  const store = (BH.store = {
    cells,
    levels,
    settings: Object.assign({}, DEFAULTS),
    manual: new Set(), // country ids marked by hand
    areas: [], // saved areas
    rev: 0,
  });

  function chunkOf(key) {
    const ix = key % N;
    const iy = (key - ix) / N;
    return (iy >> CHUNK_SHIFT) * 256 + (ix >> CHUNK_SHIFT);
  }

  function bumpLevels(key, delta) {
    const ix = key % N;
    const iy = (key - ix) / N;
    for (let L = G.FINE - 1, s = 1; L >= G.MIN_LEVEL; L--, s++) {
      const k = (iy >> s) * 2 ** L + (ix >> s);
      const m = levels[L];
      const c = (m.get(k) || 0) + delta;
      if (c > 0) m.set(k, c);
      else m.delete(k);
    }
  }

  const dirtyChunks = new Set();
  let metaDirty = false, saveTimer = null, emitPending = false;

  function touch(key) {
    dirtyChunks.add(chunkOf(key));
    scheduleSave();
  }

  function changed(key) {
    store.rev++;
    touch(key);
    if (!emitPending) {
      emitPending = true;
      setTimeout(() => {
        emitPending = false;
        BH.emit('cells');
      }, 60);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(), 2500);
  }

  // Returns true when the cell is new.
  store.add = (key, day) => {
    const cur = cells.get(key);
    if (cur === undefined) {
      cells.set(key, day || 0);
      bumpLevels(key, 1);
      changed(key);
      return true;
    }
    if (day && (cur === 0 || day < cur)) {
      cells.set(key, day);
      touch(key);
    }
    return false;
  };

  store.remove = (key) => {
    if (!cells.has(key)) return false;
    cells.delete(key);
    bumpLevels(key, -1);
    changed(key);
    return true;
  };

  store.clearAll = async () => {
    cells.clear();
    for (const L in levels) levels[L].clear();
    store.manual.clear();
    store.areas = [];
    dirtyChunks.clear();
    store.rev++;
    const d = await db();
    const tx = d.transaction(CHUNKS, 'readwrite');
    tx.objectStore(CHUNKS).clear();
    await done(tx);
    metaDirty = true;
    await store.save();
    BH.emit('cells');
    BH.emit('meta');
  };

  store.saveMeta = () => {
    metaDirty = true;
    scheduleSave();
  };

  store.setSetting = (k, v) => {
    store.settings[k] = v;
    store.saveMeta();
  };

  async function writeChunks(ids) {
    const groups = new Map();
    for (const id of ids) groups.set(id, []);
    for (const [k, d] of cells) {
      const g = groups.get(chunkOf(k));
      if (g) g.push(k, d);
    }
    const dbh = await db();
    const tx = dbh.transaction(CHUNKS, 'readwrite');
    const os = tx.objectStore(CHUNKS);
    for (const [id, flat] of groups) {
      if (!flat.length) {
        os.delete(id);
        continue;
      }
      const n = flat.length / 2;
      const keys = new Float64Array(n);
      const days = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        keys[i] = flat[2 * i];
        days[i] = flat[2 * i + 1];
      }
      os.put({ keys, days }, id);
    }
    return done(tx);
  }

  async function writeMeta() {
    const dbh = await db();
    const tx = dbh.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(JSON.parse(JSON.stringify({ settings: store.settings, manual: Array.from(store.manual), areas: store.areas })), 'meta');
    return done(tx);
  }

  let saving = Promise.resolve();
  store.save = () => {
    clearTimeout(saveTimer);
    const ids = Array.from(dirtyChunks);
    dirtyChunks.clear();
    const meta = metaDirty;
    metaDirty = false;
    if (!ids.length && !meta) return saving;
    saving = saving
      .then(() => Promise.all([ids.length ? writeChunks(ids) : null, meta ? writeMeta() : null]))
      .catch((e) => {
        console.error(e);
        ids.forEach((id) => dirtyChunks.add(id));
        BH.toast('Could not save. Your phone may be low on space.');
      });
    return saving;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.save();
  });
  window.addEventListener('pagehide', () => store.save());

  store.load = async () => {
    try {
      const dbh = await db();
      const tx = dbh.transaction([CHUNKS, KV]);
      const chunkReq = result(tx.objectStore(CHUNKS).getAll());
      const metaReq = result(tx.objectStore(KV).get('meta'));
      const [chunks, m] = await Promise.all([chunkReq, metaReq]);
      for (const c of chunks || []) {
        for (let i = 0; i < c.keys.length; i++) {
          cells.set(c.keys[i], c.days[i]);
          bumpLevels(c.keys[i], 1);
        }
      }
      if (m) {
        Object.assign(store.settings, m.settings || {});
        (m.manual || []).forEach((id) => store.manual.add(id));
        store.areas = m.areas || [];
      }
    } catch (e) {
      console.error(e);
      BH.toast('Could not open your saved data.');
    }
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* not supported */ }
    store.rev++;
  };

  // Backups are plain JSON so they can be read anywhere.
  store.exportData = () => {
    const flat = new Array(cells.size * 2);
    let i = 0;
    for (const [k, d] of cells) {
      flat[i++] = k;
      flat[i++] = d;
    }
    return {
      app: 'been-here',
      version: 1,
      exported: new Date().toISOString(),
      grid: 'mercator-z18',
      cells: flat,
      manual: Array.from(store.manual),
      areas: store.areas,
    };
  };

  // Merge a backup into what is already here.
  store.importData = (obj) => {
    if (!obj || obj.app !== 'been-here' || !Array.isArray(obj.cells)) throw new Error('Not a Been Here backup');
    let added = 0;
    for (let i = 0; i + 1 < obj.cells.length; i += 2) {
      const k = obj.cells[i];
      if (typeof k !== 'number' || k < 0 || k >= N * N) continue;
      if (store.add(k, obj.cells[i + 1] || 0)) added++;
    }
    (obj.manual || []).forEach((id) => store.manual.add(id));
    const have = new Set(store.areas.map((a) => a.id));
    (obj.areas || []).forEach((a) => {
      if (a && a.id && !have.has(a.id)) store.areas.push(a);
    });
    store.saveMeta();
    BH.emit('meta');
    return added;
  };
})();
