// The fog layer: a canvas over the map with holes cut where you have been.
(function () {
  'use strict';
  const BH = window.BH;
  const G = BH.geo;

  const FOGS = {
    night: { rgb: [13, 21, 40], tex: 'light' },
    cloud: { rgb: [226, 231, 238], tex: 'dark' },
    paper: { rgb: [232, 222, 200], tex: 'dark' },
  };
  BH.FOGS = FOGS;

  // Soft cloudy texture so the fog does not look flat.
  const textures = {};
  function texture(kind) {
    if (textures[kind]) return textures[kind];
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const grid = (n) => {
      const g = new Float32Array(n * n);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      return (x, y) => {
        const fx = (x / S) * n, fy = (y / S) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => g[((j % n) * n) + (i % n)];
        const a = at(x0, y0), b = at(x0 + 1, y0), cc = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
      };
    };
    const n1 = grid(4), n2 = grid(8), n3 = grid(16);
    const img = ctx.createImageData(S, S);
    const shade = kind === 'light' ? 255 : 40;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = shade;
        img.data[i + 3] = Math.max(0, Math.min(255, (v - 0.4) * (kind === 'light' ? 70 : 55)));
      }
    }
    ctx.putImageData(img, 0, 0);
    textures[kind] = c;
    return c;
  }

  BH.FogLayer = L.Renderer.extend({
    options: { padding: 0.6, pane: 'fogPane' },

    _initContainer() {
      const c = (this._container = document.createElement('canvas'));
      c.className = 'bh-fog';
      this._ctx = c.getContext('2d');
    },

    _destroyContainer() {
      L.DomUtil.remove(this._container);
      this._ctx = null;
    },

    getEvents() {
      const e = L.Renderer.prototype.getEvents.call(this);
      e.move = this._onMove;
      return e;
    },

    // Redraw early when a pan reaches the edge of the drawn area.
    _onMove() {
      const map = this._map;
      if (!map || map._animatingZoom || !this._bounds) return;
      if (Math.abs(map.getZoom() - this._zoom) > 1e-6) return;
      const size = map.getSize();
      const tl = map.containerPointToLayerPoint([0, 0]);
      const br = map.containerPointToLayerPoint([size.x, size.y]);
      const b = this._bounds;
      if (tl.x < b.min.x || tl.y < b.min.y || br.x > b.max.x || br.y > b.max.y) this._update();
    },

    _update() {
      if (this._map._animatingZoom && this._bounds) return;
      L.Renderer.prototype._update.call(this);
      const b = this._bounds;
      const size = b.getSize();
      const c = this._container;
      const m = Math.min(2, window.devicePixelRatio || 1);
      L.DomUtil.setPosition(c, b.min);
      c.width = Math.round(m * size.x);
      c.height = Math.round(m * size.y);
      c.style.width = size.x + 'px';
      c.style.height = size.y + 'px';
      this._scale = m;
      this._origin = this._map.getPixelOrigin();
      this.redraw();
    },

    redraw() {
      const ctx = this._ctx;
      const b = this._bounds;
      if (!ctx || !b || !this._origin) return;
      const st = BH.store.settings;
      const fog = FOGS[st.fog] || FOGS.night;
      const m = this._scale;
      const origin = this._origin;
      const z = this._zoom;
      const scale = 256 * Math.pow(2, z);
      const L0 = Math.max(G.MIN_LEVEL, Math.min(G.FINE, Math.floor(z) + 6));
      const NL = 2 ** L0;
      const cellPx = scale / NL;
      const r = Math.max(cellPx * 0.82, 2.4);
      const w = b.max.x - b.min.x, h = b.max.y - b.min.y;

      ctx.setTransform(m, 0, 0, m, -m * b.min.x, -m * b.min.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(b.min.x, b.min.y, w, h);
      ctx.fillStyle = `rgb(${fog.rgb.join(',')})`;
      ctx.globalAlpha = st.fogDensity;
      ctx.fillRect(b.min.x, b.min.y, w, h);

      // Texture, pinned to the world so it does not slide while panning.
      const pat = ctx.createPattern(texture(fog.tex), 'repeat');
      if (pat && pat.setTransform && window.DOMMatrix) {
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, -(origin.x % 256), -(origin.y % 256)]));
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = 1;
        ctx.fillStyle = pat;
        ctx.fillRect(b.min.x, b.min.y, w, h);
      }

      // Collect visible cell centres, repeating across world copies.
      const x0 = b.min.x + origin.x, x1 = b.max.x + origin.x;
      const y0 = b.min.y + origin.y, y1 = b.max.y + origin.y;
      const pad = r * 1.8;
      const iyMin = Math.max(0, Math.floor((y0 - pad) / cellPx));
      const iyMax = Math.min(NL - 1, Math.floor((y1 + pad) / cellPx));
      const kMin = Math.floor((x0 - pad) / scale), kMax = Math.floor((x1 + pad) / scale);
      const src = L0 === G.FINE ? BH.store.cells : BH.store.levels[L0];
      const pts = [];
      for (const key of src.keys()) {
        const ix = key % NL;
        const iy = (key - ix) / NL;
        if (iy < iyMin || iy > iyMax) continue;
        const cy = (iy + 0.5) * cellPx - origin.y;
        for (let k = kMin; k <= kMax; k++) {
          const wx = (ix + 0.5) * cellPx + k * scale;
          if (wx < x0 - pad || wx > x1 + pad) continue;
          pts.push(wx - origin.x, cy);
        }
      }
      if (!pts.length) return;

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      const pass = (radius, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          ctx.moveTo(pts[i] + radius, pts[i + 1]);
          ctx.arc(pts[i], pts[i + 1], radius, 0, Math.PI * 2);
        }
        ctx.fill();
      };
      if (cellPx >= 6) {
        // Feathered edge: a few wider, fainter rings under the main hole.
        pass(r * 1.75, 0.12);
        pass(r * 1.55, 0.16);
        pass(r * 1.35, 0.22);
        pass(r * 1.15, 0.3);
      }
      pass(r, 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  });
})();
