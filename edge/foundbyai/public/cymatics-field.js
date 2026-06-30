/**
 * <cymatics-field color="#86AD94"></cymatics-field>
 * A full-bleed canvas of interference-pattern dots that react to the pointer.
 * Adapted for Found by AI — Nordic palette on dark background.
 */
class CymaticsField extends HTMLElement {
  static get observedAttributes() { return ['color','speed']; }

  connectedCallback() {
    this.style.display = 'block';
    this.style.position = 'absolute';
    this.style.inset = '0';
    this.style.overflow = 'hidden';

    const c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    c.setAttribute('aria-hidden', 'true');
    this.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');

    this._parseColor(this.getAttribute('color') || '#86AD94');
    this._speed = parseFloat(this.getAttribute('speed')) || 0.5;

    this.t = 0;
    this.mx = -9999; this.my = -9999;
    this.mAmp = 0; this.mTarget = 0;

    this.sources = [
      { nx: 0.28, ny: 0.40, w: 0.012, p: 0,   a: 1.0  },
      { nx: 0.74, ny: 0.62, w: 0.010, p: 2.1, a: 0.88 },
      { nx: 0.54, ny: 0.22, w: 0.015, p: 4.0, a: 0.65 }
    ];

    this._onMove = (e) => {
      const r = this.getBoundingClientRect();
      this.mx = e.clientX - r.left;
      this.my = e.clientY - r.top;
      this.mTarget = 1.3;
    };
    this._onLeave = () => { this.mTarget = 0; };

    this.addEventListener('pointermove', this._onMove);
    this.addEventListener('pointerleave', this._onLeave);
    this.addEventListener('pointercancel', this._onLeave);

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(c);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.t = 60; this._draw();
    } else {
      this._running = true; this._loop();
    }
  }

  attributeChangedCallback(n, o, v) {
    if (n === 'color' && v) this._parseColor(v);
    if (n === 'speed' && v) this._speed = parseFloat(v) || 0.5;
  }

  _parseColor(hex) {
    this._r = parseInt(hex.slice(1, 3), 16);
    this._g = parseInt(hex.slice(3, 5), 16);
    this._b = parseInt(hex.slice(5, 7), 16);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(r.width * dpr);
    this.canvas.height = Math.floor(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = r.width; this._h = r.height;
    this._sp = this._w < 640 ? 26 : 18;
    this._buildGrid();
  }

  _buildGrid() {
    const g = []; const sp = this._sp;
    for (let y = sp * 0.5; y < this._h; y += sp)
      for (let x = sp * 0.5; x < this._w; x += sp) g.push(x, y);
    this._grid = new Float32Array(g);
    this._len = g.length >> 1;
  }

  _draw() {
    const ctx = this.ctx;
    const { _w: w, _h: h, _grid: g, _len: len, sources, _r: dr, _g: dg, _b: db } = this;
    ctx.clearRect(0, 0, w, h);

    const K = 0.036, FALL = 0.0018, t = this.t;
    this.mAmp += (this.mTarget - this.mAmp) * 0.055;

    let sumA = this.mAmp;
    for (let j = 0; j < sources.length; j++) sumA += sources[j].a;
    const norm = sumA * 0.34 || 1;

    for (let i = 0; i < len; i++) {
      const px = g[i * 2], py = g[i * 2 + 1];
      let v = 0;

      for (let j = 0; j < sources.length; j++) {
        const s = sources[j];
        const dx = px - s.nx * w, dy = py - s.ny * h;
        const d = Math.sqrt(dx * dx + dy * dy);
        v += s.a * Math.sin(d * K - t * s.w * this._speed + s.p) / (1 + d * FALL);
      }

      if (this.mAmp > 0.01) {
        const dx = px - this.mx, dy = py - this.my;
        const d = Math.sqrt(dx * dx + dy * dy);
        v += this.mAmp * Math.sin(d * K - t * 0.020 * this._speed) / (1 + d * FALL);
      }

      const b = Math.max(0, Math.min(1, 0.5 + 0.5 * v / norm));
      const bb = b * b;
      const alpha = 0.025 + bb * 0.78;
      const sz = 0.7 + bb * 2.4;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${dr},${dg},${db})`;
      ctx.beginPath();
      ctx.arc(px, py, sz * 0.5, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _loop() {
    if (!this._running) return;
    this.t++;
    this._draw();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  disconnectedCallback() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    this.removeEventListener('pointermove', this._onMove);
    this.removeEventListener('pointerleave', this._onLeave);
    this.removeEventListener('pointercancel', this._onLeave);
  }
}
customElements.define('cymatics-field', CymaticsField);
