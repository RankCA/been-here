// Screens and controls.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;
  const S = BH.store;
  const $ = BH.$, $$ = BH.$$, esc = BH.esc;

  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const STYLES = {
    streets: { base: 'World_Street_Map', max: 19 },
    satellite: { base: 'World_Imagery', ref: 'Reference/World_Boundaries_and_Places', max: 19 },
    dark: { base: 'Canvas/World_Dark_Gray_Base', ref: 'Canvas/World_Dark_Gray_Reference', max: 16 },
    light: { base: 'Canvas/World_Light_Gray_Base', ref: 'Canvas/World_Light_Gray_Reference', max: 16 },
  };
  const ACCENT = '#ff6a3d';
  const BRUSH = { s: 7, m: 14, l: 28 }; // radius in screen pixels

  let map, fog, countryLayer, areaLayer, meMarker, meCircle;
  let baseLayers = [];
  let stats = null;
  let activeTab = 'map';
  let follow = false, centeredOnce = false;

  // ---------- Map ----------
  function applyStyle() {
    baseLayers.forEach((l) => map.removeLayer(l));
    baseLayers = [];
    const s = STYLES[S.settings.mapStyle] || STYLES.streets;
    const opts = { maxNativeZoom: s.max, maxZoom: 19, crossOrigin: 'anonymous', keepBuffer: 3, attribution: 'Tiles &copy; Esri' };
    baseLayers.push(L.tileLayer(ESRI + s.base + '/MapServer/tile/{z}/{y}/{x}', opts).addTo(map));
    if (s.ref) baseLayers.push(L.tileLayer(ESRI + s.ref + '/MapServer/tile/{z}/{y}/{x}', Object.assign({}, opts, { attribution: '' })).addTo(map));
  }

  function initMap() {
    map = BH.map = L.map('map', {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 19,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90,
      worldCopyJump: true,
    });
    map.attributionControl.setPrefix(false);
    for (const [name, z] of [['fogPane', 380], ['countryPane', 390], ['areaPane', 395]]) {
      const p = map.createPane(name);
      p.style.zIndex = z;
      p.style.pointerEvents = 'none';
    }
    const v = S.settings.view;
    if (v && isFinite(v.lat)) map.setView([v.lat, v.lng], v.zoom);
    else map.setView([30, 10], 2);
    applyStyle();
    fog = BH.fog = new BH.FogLayer();
    map.addLayer(fog);
    countryLayer = L.layerGroup().addTo(map);
    areaLayer = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const c = map.getCenter().wrap();
      S.settings.view = { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: map.getZoom() };
      S.saveMeta();
    });
    map.on('dragstart', stopFollow);
    map.on('zoomend', updateCountryVisibility);
    map.on('click', () => { $('#layersPop').hidden = true; });
  }

  function stopFollow() {
    follow = false;
    $('#locateBtn').classList.remove('on');
  }

  function updateCountryVisibility() {
    map.getPane('countryPane').style.display = map.getZoom() >= 9 ? 'none' : '';
  }

  let countryKey = null;
  function updateCountryLayer() {
    if (!stats) return;
    const show = S.settings.showCountries;
    const key = show ? stats.countries.map((v) => v.c.id).sort().join(',') : '';
    if (key === countryKey) return;
    countryKey = key;
    countryLayer.clearLayers();
    if (!show) return;
    for (const v of stats.countries) {
      L.polygon(BH.countries.latLngs(v.c), {
        pane: 'countryPane', interactive: false,
        color: ACCENT, weight: 1.2, opacity: 0.75, fillColor: ACCENT, fillOpacity: 0.16,
      }).addTo(countryLayer);
    }
    updateCountryVisibility();
  }

  // ---------- Stats ----------
  function runStats() {
    stats = BH.stats = BH.countries.computeStats();
    // Town matching is the slow part, so only do it when the list is on screen.
    if (activeTab === 'stats' && BH.cities.isLoaded()) stats.places = BH.cities.visited(stats.blockDay);
    updatePill();
    updateCountryLayer();
    if (activeTab === 'stats') renderStats();
    if (activeTab === 'settings') renderDataInfo();
    if (activeTab === 'areas') { renderNearby(); renderSaved(); renderLookup(); }
  }
  const scheduleStats = BH.throttle(runStats, 2500);

  function updatePill() {
    $('#pillPct').textContent = BH.fmtPct(stats.worldPct);
    const n = stats.unCount;
    $('#pillSub').textContent = n ? `of the world, ${n} ${n === 1 ? 'country' : 'countries'}` : 'of the world explored';
  }

  function level(area) {
    let n = 1;
    while (n < 40 && area >= 0.25 * 2 ** n) n++;
    const prev = n === 1 ? 0 : 0.25 * 2 ** (n - 1);
    const next = 0.25 * 2 ** n;
    return { n, progress: (area - prev) / (next - prev), toNext: next - area };
  }

  const isoName = new Map();
  BH.countries.list.forEach((c) => { if (c.iso && (!isoName.has(c.iso) || c.un)) isoName.set(c.iso, c.name); });

  const showAll = { towns: false, districts: false, countries: false };

  function bar(pct, goal) {
    const w = Math.max(0, Math.min(100, pct));
    return `<div class="bar"><span style="width:${w}%"></span>${goal ? `<i style="left:${Math.min(100, goal)}%"></i>` : ''}</div>`;
  }

  function renderStats() {
    const s = stats;
    if (!s) return;
    const lv = level(s.total);
    const pl = s.places;
    const h = [];
    h.push(`<div class="card hero">
      <span class="hero-level">Level ${lv.n}</span>
      <div class="hero-big">${BH.fmtPct(s.worldPct)}</div>
      <div class="hero-sub">of the world explored</div>
      ${bar(lv.progress * 100)}
      <div class="area-meta">${BH.fmtArea(lv.toNext)} more to reach level ${lv.n + 1}</div>
    </div>`);
    const tiles = [
      [BH.fmtArea(s.total), 'explored in total'],
      [`${s.unCount} <small>of 195</small>`, 'countries'],
      [`${s.continentCount} <small>of 7</small>`, 'continents'],
      [pl ? BH.fmtNum(pl.towns.length) : '-', 'towns and cities'],
      [pl ? BH.fmtNum(pl.districts.length) : '-', 'city districts'],
      [BH.fmtNum(s.daysExploring), s.daysExploring === 1 ? 'day exploring' : 'days exploring'],
      [BH.fmtArea(s.week), 'new in the last 7 days'],
      [BH.fmtArea(s.month), 'new in the last 30 days'],
    ];
    h.push('<div class="tiles">' + tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><small>${l}</small></div>`).join('') + '</div>');

    h.push('<div class="section-head"><h2>Continents</h2></div><div class="rows">');
    for (const c of s.continents) {
      const sub = c.total ? `${c.visited} of ${c.total} countries` : (c.any ? 'Visited' : 'Not yet');
      const pct = c.total ? (c.visited / c.total) * 100 : (c.any ? 100 : 0);
      h.push(`<div class="row"><div class="grow"><div class="name">${c.name}</div><div class="sub">${sub}</div>${bar(pct)}</div></div>`);
    }
    h.push('</div>');

    const terr = s.territoryCount ? ` and ${s.territoryCount} ${s.territoryCount === 1 ? 'territory' : 'territories'}` : '';
    h.push(`<div class="section-head"><h2>${s.unCount} ${s.unCount === 1 ? 'country' : 'countries'}${terr}</h2><button class="btn small" id="editCountries">Add or remove</button></div>`);
    h.push('<div class="rows">');
    if (!s.countries.length) h.push('<div class="empty">No countries yet. Record a walk, draw an old trip, or tick countries you have been to.</div>');
    const clist = showAll.countries ? s.countries : s.countries.slice(0, 30);
    for (const v of clist) {
      const sub = v.manual ? 'Added by you' : `${BH.fmtArea(v.area)} explored${v.first ? ', first on ' + BH.fmtDay(v.first) : ''}`;
      h.push(`<div class="row"><div class="flag">${BH.flag(v.c.iso)}</div><div class="grow"><div class="name">${esc(v.c.name)}</div><div class="sub">${sub}</div></div><div class="val">${v.manual ? '' : BH.fmtPct(v.pct)}</div></div>`);
    }
    if (s.countries.length > clist.length) h.push(`<button class="more" data-more="countries">Show all ${s.countries.length}</button>`);
    h.push('</div>');

    const placeList = (key, title, items, none) => {
      h.push(`<div class="section-head"><h2>${title}</h2></div><div class="rows">`);
      if (!pl) h.push('<div class="empty">Loading places.</div>');
      else if (!items.length) h.push(`<div class="empty">${none}</div>`);
      else {
        const shown = showAll[key] ? items : items.slice(0, 25);
        for (const { p, day } of shown) {
          const sub = `${esc(isoName.get(p.cc) || p.cc)}${day ? ', ' + BH.fmtDay(day) : ''}`;
          h.push(`<div class="row"><div class="flag">${BH.flag(p.cc)}</div><div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${sub}</div></div><div class="val">${p.kind === 'c' ? 'Capital' : ''}</div></div>`);
        }
        if (items.length > shown.length) h.push(`<button class="more" data-more="${key}">Show all ${BH.fmtNum(items.length)}</button>`);
      }
      h.push('</div>');
    };
    placeList('towns', `Towns and cities${pl ? ' (' + BH.fmtNum(pl.towns.length) + ')' : ''}`, pl ? pl.towns : [], 'None yet. Places with 15,000 or more people count.');
    placeList('districts', `City districts${pl ? ' (' + BH.fmtNum(pl.districts.length) + ')' : ''}`, pl ? pl.districts : [], 'None yet.');

    const body = $('#statsBody');
    const top = body.parentElement.scrollTop;
    body.innerHTML = h.join('');
    body.parentElement.scrollTop = top;
  }

  // ---------- Recording ----------
  function updateRec() {
    const t = BH.tracker;
    const on = t.recording;
    const btn = $('#recBtn');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#recLabel').textContent = on ? 'Recording' : 'Start recording';
    let sub = 'Clears the fog as you move';
    if (on) {
      if (t.sessionArea > 0) sub = `${BH.fmtArea(t.sessionArea)} new ground. Tap to stop.`;
      else if (!t.fix) sub = 'Finding you';
      else if (t.fix.acc > S.settings.accuracy) sub = 'GPS signal is weak';
      else sub = 'Tap to stop';
    }
    $('#recSub').textContent = sub;
    const dot = meMarker && meMarker.getElement() && meMarker.getElement().firstChild;
    if (dot) dot.classList.toggle('rec', on);
  }

  function toggleRec() {
    if (BH.tracker.recording) {
      const a = BH.tracker.sessionArea;
      BH.tracker.stop();
      BH.toast(a > 0 ? `Stopped. You cleared ${BH.fmtArea(a)}.` : 'Recording stopped.');
    } else {
      centeredOnce = false;
      if (BH.tracker.start()) BH.toast('Recording. Keep Been Here open while you move.', 3500);
    }
    updateRec();
  }

  function onPosition(fix) {
    const ll = [fix.lat, fix.lng];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: fix.acc, interactive: false, color: '#2f7cf6', weight: 1, opacity: 0.4, fillOpacity: 0.08, pane: 'areaPane' }).addTo(map);
      meMarker = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false, keyboard: false, zIndexOffset: 1000,
      }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(Math.min(fix.acc, 5000));
    }
    if (BH.tracker.recording && !centeredOnce) {
      centeredOnce = true;
      follow = true;
      $('#locateBtn').classList.add('on');
      map.setView(ll, Math.max(map.getZoom(), 16));
    } else if (follow) {
      map.panTo(ll, { animate: true, duration: 0.5 });
    }
    updateRec();
    if (activeTab === 'areas') nearbySoon();
  }

  function gpsError(e) {
    if (e && e.code === 1) {
      BH.toast('Location is blocked. Allow it in iPhone Settings, Privacy and Security, Location Services, Safari Websites.', 7000);
      if (BH.tracker.recording) BH.tracker.stop();
      updateRec();
    } else if (!BH.tracker.recording) {
      BH.toast('Could not find your location yet. Try again outside.');
    }
  }

  async function locate() {
    if (follow && BH.tracker.fix) {
      stopFollow();
      return;
    }
    try {
      const fix = await BH.tracker.locateOnce();
      follow = true;
      $('#locateBtn').classList.add('on');
      map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 15));
    } catch (e) {
      gpsError(e);
    }
  }

  // ---------- Drawing past trips ----------
  const paint = { on: false, mode: 'draw', stroke: null, undo: [], pointers: new Set() };

  function setEdit(on) {
    paint.on = on;
    document.body.classList.toggle('painting', on);
    $('#editBar').hidden = !on;
    $('#dock').hidden = on;
    $('#editBtn').classList.toggle('on', on);
    if (on) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      stopFollow();
      BH.toast(map.getZoom() < 10 ? 'Zoom in on a place, then drag one finger to clear the fog.' : 'Drag one finger to clear the fog. Use two fingers to move the map.', 4500);
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      endStroke();
      S.save();
    }
    syncSegs();
  }

  function cellPoint(e) {
    const r = map.getContainer().getBoundingClientRect();
    const pt = L.point(e.clientX - r.left, e.clientY - r.top);
    const scale = 256 * Math.pow(2, map.getZoom());
    const w = map.containerPointToLayerPoint(pt).add(map.getPixelOrigin());
    const perPx = G.N / scale;
    return { x: w.x * perPx, y: w.y * perPx, perPx };
  }

  function stamp(p) {
    const s = paint.stroke;
    const R = BRUSH[S.settings.brush] * p.perPx;
    const keys = [];
    if (s.last) {
      const dx = p.x - s.last.x, dy = p.y - s.last.y;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.5, R * 0.5)));
      for (let i = 1; i <= n; i++) G.discCells(s.last.x + (dx * i) / n, s.last.y + (dy * i) / n, R, keys);
    } else {
      G.discCells(p.x, p.y, R, keys);
    }
    s.last = p;
    if (s.mode === 'draw') {
      for (const k of keys) if (S.add(k, 0)) s.keys.push(k);
    } else {
      for (const k of keys) {
        const d = S.cells.get(k);
        if (d !== undefined && S.remove(k)) {
          s.keys.push(k);
          s.days.push(d);
        }
      }
    }
  }

  function revert(s) {
    if (s.mode === 'draw') s.keys.forEach((k) => S.remove(k));
    else s.keys.forEach((k, i) => S.add(k, s.days[i]));
  }

  function endStroke() {
    const s = paint.stroke;
    paint.stroke = null;
    if (s && s.keys.length) paint.undo.push(s);
    if (paint.undo.length > 50) paint.undo.shift();
  }

  function initPaint() {
    const el = map.getContainer();
    el.addEventListener('pointerdown', (e) => {
      if (!paint.on) return;
      paint.pointers.add(e.pointerId);
      if (paint.pointers.size > 1) {
        // A second finger means the user wants to move the map.
        const s = paint.stroke;
        if (s && Date.now() - s.start < 300) revert(s);
        else endStroke();
        paint.stroke = null;
        return;
      }
      if (map.getZoom() < 10) {
        BH.toast('Zoom in closer to draw.');
        return;
      }
      paint.stroke = { id: e.pointerId, mode: paint.mode, keys: [], days: [], last: null, start: Date.now() };
      stamp(cellPoint(e));
    });
    el.addEventListener('pointermove', (e) => {
      const s = paint.stroke;
      if (!paint.on || !s || s.id !== e.pointerId || paint.pointers.size > 1) return;
      stamp(cellPoint(e));
    });
    const up = (e) => {
      paint.pointers.delete(e.pointerId);
      if (paint.stroke && paint.stroke.id === e.pointerId) endStroke();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') up(e); });
  }

  function undo() {
    const s = paint.undo.pop();
    if (!s) {
      BH.toast('Nothing to undo.');
      return;
    }
    revert(s);
  }

  // ---------- Places ----------
  let lookupFrom = 'me';
  let lookupResults = [];

  function nearbyPoint() {
    const fix = BH.tracker.fix;
    if (lookupFrom === 'me' && fix && Date.now() - fix.t < 10 * 60000) return { lat: fix.lat, lng: fix.lng, where: 'you' };
    const c = map.getCenter().wrap();
    return { lat: c.lat, lng: c.lng, where: 'the map centre' };
  }

  function renderNearby() {
    const p = nearbyPoint();
    $('#nearWhere').textContent = p.where;
    for (const [id, km] of [['near1', 1], ['near5', 5], ['near25', 25]]) {
      $('#' + id).textContent = BH.fmtPct(G.nearbyProgress(p.lat, p.lng, km, S.cells).pct);
    }
  }
  const nearbySoon = BH.throttle(renderNearby, 3000);

  function areaCard(area, isSaved) {
    const p = BH.areas.progress(area);
    const goal = isSaved ? area.goal || 0 : 0;
    const where = [area.kind, area.place].filter(Boolean).join(', ');
    let goalLine = '';
    if (goal) {
      goalLine = p.pct >= goal
        ? `<span class="goal-done">Goal of ${goal}% reached</span>`
        : `${BH.fmtPct(goal - p.pct)} to go for your ${goal}% goal`;
    }
    const opts = [0, 1, 5, 10, 25, 50, 75, 100].map((g) => `<option value="${g}"${g === goal ? ' selected' : ''}>${g ? 'Goal ' + g + '%' : 'No goal'}</option>`).join('');
    return `<div class="area-card" data-id="${esc(area.id)}">
      <div class="area-top"><div><div class="area-name">${esc(area.name)}</div><div class="area-kind">${esc(where)}</div></div><div class="area-pct">${BH.fmtPct(p.pct)}</div></div>
      ${bar(p.pct, goal)}
      <div class="area-meta">${BH.fmtArea(p.area)} of ${BH.fmtArea(p.totalArea)} explored${goalLine ? '. ' + goalLine : ''}</div>
      <div class="area-actions">
        <button class="btn small" data-act="show">Show on map</button>
        ${isSaved
          ? `<select data-act="goal" aria-label="Goal">${opts}</select><button class="btn small danger" data-act="remove">Remove</button>`
          : (BH.areas.saved(area.id) ? '<button class="btn small" disabled>Saved</button>' : '<button class="btn small" data-act="save">Save</button>')}
      </div>
    </div>`;
  }

  function renderLookup() {
    if (!lookupResults.length) return;
    $('#lookupList').innerHTML = lookupResults.map((a) => areaCard(a, false)).join('')
      + (BH.areas.isBusy() ? '<p class="muted small">Looking for larger areas.</p>' : '');
  }

  function renderSaved() {
    const list = S.areas;
    $('#savedList').innerHTML = list.length
      ? list.map((a) => areaCard(a, true)).join('')
      : '<p class="muted">Save an area to keep track of it here and set a goal.</p>';
  }

  async function doLookup() {
    let lat, lng;
    const btn = $('#lookupBtn');
    if (lookupFrom === 'me') {
      try {
        const f = await BH.tracker.locateOnce();
        lat = f.lat;
        lng = f.lng;
      } catch (e) {
        gpsError(e);
        return;
      }
    } else {
      const c = map.getCenter().wrap();
      lat = c.lat;
      lng = c.lng;
    }
    lookupResults = [];
    $('#lookupList').innerHTML = '<p class="muted">Finding areas around this spot.</p>';
    btn.disabled = true;
    try {
      const n = await BH.areas.lookup(lat, lng, (area) => {
        lookupResults.push(area);
        renderLookup();
      });
      if (!n) $('#lookupList').innerHTML = '<p class="muted">No areas with outlines were found here.</p>';
      else renderLookup();
    } catch (e) {
      $('#lookupList').innerHTML = '<p class="muted">Could not reach OpenStreetMap. Check your connection and try again.</p>';
    } finally {
      btn.disabled = false;
    }
    renderNearby();
  }

  function findArea(id) {
    return S.areas.find((a) => a.id === id) || lookupResults.find((a) => a.id === id);
  }

  function showArea(area) {
    areaLayer.clearLayers();
    const poly = L.polygon(BH.areas.latLngs(area), {
      pane: 'areaPane', interactive: false,
      color: ACCENT, weight: 2.5, dashArray: '7 6', fillColor: ACCENT, fillOpacity: 0.05,
    }).addTo(areaLayer);
    setTab('map');
    map.fitBounds(poly.getBounds(), { padding: [50, 50] });
    const p = BH.areas.progress(area);
    $('#areaChipText').textContent = `${area.name}: ${BH.fmtPct(p.pct)} explored`;
    $('#areaChip').hidden = false;
  }

  function onAreaAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.area-card');
    const area = findArea(card.dataset.id);
    if (!area) return;
    const act = btn.dataset.act;
    if (act === 'show') showArea(area);
    else if (act === 'save') {
      BH.areas.save(area);
      BH.toast(`${area.name} saved.`);
      renderLookup();
    } else if (act === 'remove') {
      BH.areas.unsave(area.id);
      renderLookup();
    }
  }

  // ---------- Country picker ----------
  function openCountries() {
    $('#countrySheet').hidden = false;
    $('#sheetBack').hidden = false;
    $('#countrySearch').value = '';
    renderCountryList();
  }

  function closeCountries() {
    $('#countrySheet').hidden = true;
    $('#sheetBack').hidden = true;
    runStats();
  }

  function renderCountryList() {
    const q = $('#countrySearch').value.trim().toLowerCase();
    const auto = new Set(stats ? stats.countries.filter((v) => !v.manual).map((v) => v.c.id) : []);
    const h = [];
    for (const cont of BH.countries.CONTINENTS) {
      const items = BH.countries.list.filter((c) => c.continent === cont && (!q || c.name.toLowerCase().includes(q)));
      if (!items.length) continue;
      h.push(`<div class="cont-head">${cont}</div>`);
      for (const c of items) {
        const a = auto.has(c.id);
        const m = S.manual.has(c.id);
        h.push(`<div class="row"><div class="flag">${BH.flag(c.iso)}</div><div class="grow"><div class="name">${esc(c.name)}</div>${c.un ? '' : '<div class="sub">Territory</div>'}${a ? '<div class="sub">Fog cleared here</div>' : ''}</div>
          <button class="tick${a ? ' auto' : m ? ' on' : ''}" data-id="${c.id}" aria-label="${esc(c.name)}" aria-pressed="${a || m}"><svg><use href="#i-check"/></svg></button></div>`);
      }
    }
    $('#countryList').innerHTML = h.join('') || '<div class="empty">No matches.</div>';
  }

  function onCountryTick(e) {
    const b = e.target.closest('.tick');
    if (!b) return;
    if (b.classList.contains('auto')) {
      BH.toast('You have cleared fog here, so it stays ticked.');
      return;
    }
    const id = b.dataset.id;
    if (S.manual.has(id)) S.manual.delete(id);
    else S.manual.add(id);
    b.classList.toggle('on', S.manual.has(id));
    b.setAttribute('aria-pressed', S.manual.has(id));
    S.saveMeta();
  }

  // ---------- Settings ----------
  function syncSegs() {
    $$('.seg[data-setting]').forEach((seg) => {
      const v = String(S.settings[seg.dataset.setting]);
      $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    });
    $$('#brushSize button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.settings.brush));
    $$('#editMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === paint.mode));
    $$('#lookupFrom button').forEach((b) => b.classList.toggle('on', b.dataset.v === lookupFrom));
    $('#fogDensity').value = S.settings.fogDensity;
    $('#showCountries').checked = !!S.settings.showCountries;
    $('#keepAwake').checked = !!S.settings.keepAwake;
  }

  function renderDataInfo() {
    const total = stats ? stats.total : 0;
    $('#dataInfo').textContent = S.cells.size
      ? `${BH.fmtArea(total)} explored, stored only on this device.`
      : 'Nothing recorded yet.';
    const lb = S.settings.lastBackup;
    $('#backupInfo').textContent = lb
      ? `Last backup saved on ${new Date(lb).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
      : 'You have not saved a backup yet.';
  }

  function renderSettings() {
    $('#installCard').hidden = BH.isStandalone();
    syncSegs();
    renderDataInfo();
  }

  async function onImport(input) {
    const files = input.files;
    if (!files || !files.length) return;
    const status = $('#importStatus');
    const before = BH.countries.computeStats().total;
    status.textContent = 'Reading files.';
    let res;
    try {
      res = await BH.importers.importFiles(files, (i, n) => { status.textContent = `Reading file ${i} of ${n}.`; });
    } finally {
      input.value = '';
    }
    runStats();
    const gained = stats.total - before;
    const msgs = [];
    if (res.backups) msgs.push(res.backups === 1 ? 'Backup restored.' : `${res.backups} backups restored.`);
    if (res.points || res.backups) msgs.push(gained > 0 ? `Cleared ${BH.fmtArea(gained)} of new ground.` : 'No new ground. You had been to all of it already.');
    if (res.photos) msgs.push(`${res.photosWithGps} of ${res.photos} photos had a location.`);
    if (res.failed.length) msgs.push(`Could not find any places in ${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? ' and others' : ''}.`);
    status.textContent = msgs.join(' ');
    BH.toast(msgs[0] || 'Nothing imported.', 4000);
  }

  // ---------- Tabs ----------
  function setTab(t) {
    activeTab = t;
    $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    for (const p of ['areas', 'stats', 'settings']) $('#panel-' + p).hidden = p !== t;
    $('#layersPop').hidden = true;
    if (t === 'stats') {
      runStats();
      if (!BH.cities.isLoaded()) BH.cities.load().then(runStats).catch(() => {});
    }
    if (t === 'areas') {
      renderNearby();
      renderSaved();
    }
    if (t === 'settings') renderSettings();
    if (t === 'map') map.invalidateSize();
  }

  // ---------- Wiring ----------
  function wire() {
    $$('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#statPill').addEventListener('click', () => setTab('stats'));
    $('#recBtn').addEventListener('click', toggleRec);
    $('#locateBtn').addEventListener('click', locate);
    $('#editBtn').addEventListener('click', () => setEdit(!paint.on));
    $('#editDone').addEventListener('click', () => setEdit(false));
    $('#undoBtn').addEventListener('click', undo);
    $('#layersBtn').addEventListener('click', () => {
      const p = $('#layersPop');
      p.hidden = !p.hidden;
      syncSegs();
    });
    $('#shareBtn').addEventListener('click', share);
    $('#statsShare').addEventListener('click', share);

    $$('.seg[data-setting]').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.setting;
      const v = /^\d+$/.test(b.dataset.v) ? +b.dataset.v : b.dataset.v;
      S.setSetting(key, v);
      if (key === 'mapStyle') applyStyle();
      if (key === 'fog') fog.redraw();
      syncSegs();
    }));
    $('#brushSize').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { S.setSetting('brush', b.dataset.v); syncSegs(); }
    });
    $('#editMode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { paint.mode = b.dataset.v; syncSegs(); }
    });
    $('#lookupFrom').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { lookupFrom = b.dataset.v; syncSegs(); renderNearby(); }
    });
    $('#fogDensity').addEventListener('input', (e) => {
      S.settings.fogDensity = +e.target.value;
      fog.redraw();
    });
    $('#fogDensity').addEventListener('change', () => S.saveMeta());
    $('#showCountries').addEventListener('change', (e) => {
      S.setSetting('showCountries', e.target.checked);
      updateCountryLayer();
    });
    $('#keepAwake').addEventListener('change', (e) => {
      S.setSetting('keepAwake', e.target.checked);
      BH.tracker.refreshWake();
    });
    $('#areaChipClose').addEventListener('click', () => {
      areaLayer.clearLayers();
      $('#areaChip').hidden = true;
    });

    $('#lookupBtn').addEventListener('click', doLookup);
    $('#lookupList').addEventListener('click', onAreaAction);
    $('#savedList').addEventListener('click', onAreaAction);
    $('#savedList').addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-act="goal"]');
      if (!sel) return;
      BH.areas.setGoal(sel.closest('.area-card').dataset.id, +sel.value);
      renderSaved();
    });

    $('#statsBody').addEventListener('click', (e) => {
      if (e.target.closest('#editCountries')) openCountries();
      const more = e.target.closest('[data-more]');
      if (more) {
        showAll[more.dataset.more] = true;
        renderStats();
      }
    });
    $('#countrySheetClose').addEventListener('click', closeCountries);
    $('#sheetBack').addEventListener('click', closeCountries);
    $('#countrySearch').addEventListener('input', renderCountryList);
    $('#countryList').addEventListener('click', onCountryTick);

    $('#importFiles').addEventListener('change', (e) => onImport(e.target));
    $('#importPhotos').addEventListener('change', (e) => onImport(e.target));
    $('#backupBtn').addEventListener('click', async () => {
      await BH.share.exportBackup();
      renderDataInfo();
    });
    $('#eraseBtn').addEventListener('click', async () => {
      if (!window.confirm('Erase your whole map, saved areas and ticked countries? This cannot be undone.')) return;
      await S.clearAll();
      paint.undo = [];
      runStats();
      BH.toast('Everything has been erased.');
    });

    $('#introGo').addEventListener('click', () => {
      $('#intro').hidden = true;
      S.setSetting('seenIntro', true);
    });

    BH.on('cells', () => {
      fog.redraw();
      scheduleStats();
    });
    BH.on('meta', scheduleStats);
    BH.on('position', onPosition);
    BH.on('recording', updateRec);
    BH.on('session', updateRec);
    BH.on('gps-error', gpsError);
  }

  async function share() {
    try {
      runStats();
      await BH.share.shareMap(stats);
    } catch (e) {
      console.error(e);
      BH.toast('Could not make the picture. Try again when the map has loaded.');
    }
  }

  async function start() {
    await S.load();
    initMap();
    initPaint();
    wire();
    syncSegs();
    runStats();
    updateRec();
    if (!S.settings.seenIntro) $('#intro').hidden = false;
    if (S.settings.recording) BH.tracker.start();
    setTimeout(() => BH.cities.load().then(runStats).catch(() => {}), 2500);
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('No offline support', e));
    }
  }

  start();
})();
