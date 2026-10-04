// Small shared helpers: events, DOM, formatting.
(function () {
  'use strict';
  const BH = (window.BH = window.BH || {});

  const listeners = {};
  BH.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  BH.emit = (ev, data) => {
    (listeners[ev] || []).forEach((fn) => {
      try { fn(data); } catch (e) { console.error(e); }
    });
  };

  BH.$ = (sel, root) => (root || document).querySelector(sel);
  BH.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  BH.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BH.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Days are counted in local time since 1 Jan 1970. Day 0 means "date unknown".
  BH.dayOf = (ms) => {
    const off = new Date(ms).getTimezoneOffset() * 60000;
    return Math.max(1, Math.floor((ms - off) / 86400000));
  };
  BH.today = () => BH.dayOf(Date.now());
  BH.fmtDay = (day) => {
    if (!day) return 'Date unknown';
    return new Date(day * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  BH.fmtArea = (km2) => {
    if (km2 <= 0) return '0 km²';
    if (km2 < 10) return km2.toFixed(2) + ' km²';
    if (km2 < 100) return km2.toFixed(1) + ' km²';
    return Math.round(km2).toLocaleString('en-GB') + ' km²';
  };

  // Percent with enough digits that tiny numbers still move.
  BH.fmtPct = (p) => {
    if (!p || p <= 0) return '0%';
    if (p >= 100) return '100%';
    if (p >= 10) return p.toFixed(1) + '%';
    if (p >= 1) return p.toFixed(2) + '%';
    const digits = Math.min(9, 1 - Math.floor(Math.log10(p)));
    return p.toFixed(digits) + '%';
  };

  BH.fmtNum = (n) => Math.round(n).toLocaleString('en-GB');

  BH.flag = (iso) => {
    if (!iso || iso.length !== 2) return '🏳️';
    return String.fromCodePoint(...iso.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)));
  };

  let toastTimer = null;
  BH.toast = (msg, ms) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  };

  BH.throttle = (fn, ms) => {
    let last = 0, timer = null;
    return function () {
      const now = Date.now();
      const wait = ms - (now - last);
      if (wait <= 0) {
        last = now;
        fn();
      } else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn(); }, wait);
      }
    };
  };

  BH.isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
})();
