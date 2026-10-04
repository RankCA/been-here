// Sharing a picture of the map, and saving files.
(function () {
  'use strict';
  const BH = window.BH;

  // Uses the share sheet on iPhone, a download elsewhere.
  async function shareFile(file, title) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function mapImage(stats) {
    const map = BH.map;
    const el = map.getContainer();
    const box = el.getBoundingClientRect();
    const W = Math.round(box.width), H = Math.round(box.height);
    const m = 2;
    const c = document.createElement('canvas');
    c.width = W * m;
    c.height = H * m;
    const ctx = c.getContext('2d');
    ctx.scale(m, m);
    ctx.fillStyle = '#d9dde3';
    ctx.fillRect(0, 0, W, H);

    const draw = (img) => {
      const r = img.getBoundingClientRect();
      if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) return;
      try { ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height); } catch (e) { /* tile blocked */ }
    };
    el.querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded').forEach(draw);
    const fog = el.querySelector('canvas.bh-fog');
    if (fog) draw(fog);

    // Stats card
    const pad = 16;
    const cardH = 92;
    const y = H - cardH - pad - 8;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 18;
    roundRect(ctx, pad, y, W - pad * 2, cardH, 18);
    ctx.fillStyle = 'rgba(14, 20, 36, 0.92)';
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ff8a5c';
    ctx.font = '600 13px -apple-system, system-ui, sans-serif';
    ctx.fillText('BEEN HERE', pad + 18, y + 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 26px -apple-system, system-ui, sans-serif';
    ctx.fillText(BH.fmtPct(stats.worldPct) + ' of the world', pad + 18, y + 60);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 14px -apple-system, system-ui, sans-serif';
    const n = stats.unCount;
    ctx.fillText(`${BH.fmtArea(stats.total)} explored, ${n} ${n === 1 ? 'country' : 'countries'}`, pad + 18, y + 80);

    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not make the picture');
    return new File([blob], 'been-here-map.png', { type: 'image/png' });
  }

  async function shareMap(stats) {
    const file = await mapImage(stats);
    return shareFile(file, 'My Been Here map');
  }

  async function exportBackup() {
    const data = JSON.stringify(BH.store.exportData());
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const file = new File([data], `been-here-backup-${stamp}.json`, { type: 'application/json' });
    const ok = await shareFile(file, 'Been Here backup');
    if (ok) BH.store.setSetting('lastBackup', Date.now());
    return ok;
  }

  BH.share = { shareMap, exportBackup, shareFile, mapImage };
})();
