// GPS recording.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;

  const tracker = (BH.tracker = {
    recording: false,
    last: null, // last accepted fix
    fix: null, // last fix of any accuracy
    sessionArea: 0,
    watchId: null,
  });

  let wakeLock = null;
  async function holdWake() {
    if (!tracker.recording || !BH.store.settings.keepAwake || !('wakeLock' in navigator)) return;
    if (wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  function dropWake() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') holdWake();
  });

  function onPosition(pos) {
    const c = pos.coords;
    const fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy || 9999, t: pos.timestamp || Date.now() };
    tracker.fix = fix;
    BH.emit('position', fix);
    if (!tracker.recording) return;
    if (fix.acc > BH.store.settings.accuracy) return;
    const before = BH.store.cells.size;
    let added = 0;
    const prev = tracker.last;
    if (prev && fix.t - prev.t < 3 * 60000) {
      const d = G.distKm(prev.lat, prev.lng, fix.lat, fix.lng);
      const hours = Math.max(1 / 3600, (fix.t - prev.t) / 3600000);
      if (d <= 3 && d / hours <= 250) {
        const buf = G.segmentCells(prev.lat, prev.lng, fix.lat, fix.lng, []);
        for (const k of buf) if (BH.store.add(k, BH.dayOf(fix.t))) added++;
      } else if (BH.store.add(G.cellOf(fix.lat, fix.lng), BH.dayOf(fix.t))) added++;
    } else if (BH.store.add(G.cellOf(fix.lat, fix.lng), BH.dayOf(fix.t))) added++;
    tracker.last = fix;
    if (added) {
      const [, iy] = G.keyXY(G.cellOf(fix.lat, fix.lng));
      tracker.sessionArea += added * G.cellAreaKm2(iy);
      BH.emit('session');
    }
    return BH.store.cells.size - before;
  }

  function onError(err) {
    BH.emit('gps-error', err);
  }

  function watch() {
    if (tracker.watchId != null || !navigator.geolocation) return;
    tracker.watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 30000,
    });
  }

  function unwatch() {
    if (tracker.watchId != null) navigator.geolocation.clearWatch(tracker.watchId);
    tracker.watchId = null;
  }

  tracker.start = () => {
    if (!navigator.geolocation) {
      BH.toast('This browser cannot read your location.');
      return false;
    }
    tracker.recording = true;
    tracker.last = null;
    tracker.sessionArea = 0;
    BH.store.setSetting('recording', true);
    watch();
    holdWake();
    BH.emit('recording', true);
    return true;
  };

  tracker.stop = () => {
    tracker.recording = false;
    tracker.last = null;
    BH.store.setSetting('recording', false);
    unwatch();
    dropWake();
    BH.store.save();
    BH.emit('recording', false);
  };

  // One-off location for the locate button.
  tracker.locateOnce = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    if (tracker.watchId != null && tracker.fix && Date.now() - tracker.fix.t < 15000) return resolve(tracker.fix);
    navigator.geolocation.getCurrentPosition((pos) => {
      onPosition(pos);
      resolve(tracker.fix);
    }, reject, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  });

  tracker.refreshWake = () => {
    if (BH.store.settings.keepAwake) holdWake();
    else dropWake();
  };

  // Exposed for testing in the browser console.
  tracker._feed = (lat, lng, t) => onPosition({ coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: t || Date.now() });
})();
