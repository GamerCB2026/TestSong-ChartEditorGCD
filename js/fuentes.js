/* =====================================================================
   fuentes.js — fuentes Alphabet del juego (images/fonts/bold.xml, default.xml,
   freeplay-clear.xml). Igual que AtlasText de V-Slice: letras animadas a 24 fps,
   alineadas abajo, espacio = 40 px. Si no están, se usa texto normal.
   ===================================================================== */
'use strict';

const Fonts = {
  sheets: {},   // nombre -> { atlas, img, chars: Map(char -> frames[]), maxHeight, caseAllowed }
  SPECIAL: { '&': '-andpersand-', "'": '-apostraphie-', '\\': '-back slash-', ',': '-comma-', '-': '-dash-', '↓': '-down arrow-',
    '”': '-end quote-', '"': '-start quote-', '“': '-start quote-', '!': '-exclamation point-', '/': '-forward slash-', '>': '-greater than-',
    '♥': '-heart-', '♡': '-heart-', '←': '-left arrow-', '<': '-less than-', '*': '-multiply x-', '×': '-multiply x-', '.': '-period-',
    '?': '-question mark-', '→': '-right arrow-', '↑': '-up arrow-', '😠': '-angry faic-' },

  async load() {
    await Promise.all(['bold', 'default', 'freeplay-clear'].map(async name => {
      const s = await loadSparrowSheet(ASSET_CFG.fontDirs.map(d => d + name));
      if (!s) { AssetLog.set('font-' + name, false, `fuente ${name}: falta ${ASSET_CFG.fontDirs[0]}${name}.xml/.png → texto normal`); return; }
      const chars = new Map(); let maxHeight = 0, up = false, low = false;
      for (const f of s.atlas.frames) {
        maxHeight = Math.max(maxHeight, f.fh);
        const key = f.nombre.replace(/\d{4}$/, '');
        if (!chars.has(key)) chars.set(key, []);
        chars.get(key).push(Object.assign({}, f, { img: s.img }));
        if (/^[A-Z]\d+$/.test(f.nombre)) up = true;
        if (/^[a-z]\d+$/.test(f.nombre)) low = true;
      }
      for (const arr of chars.values()) arr.sort((a, b) => a.num - b.num);
      this.sheets[name] = { chars, maxHeight, caseAllowed: up !== low ? (up ? 'upper' : 'lower') : 'both', where: s.where };
      AssetLog.set('font-' + name, true, `fuente ${name}: ${s.where}.xml (${chars.size} caracteres)`);
    }));
  },
  has(name) { return !!this.sheets[name]; },
  prep(name, text) {
    const f = this.sheets[name]; let t = String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¡¿]/g, '');
    if (f.caseAllowed === 'upper') t = t.toUpperCase(); else if (f.caseAllowed === 'lower') t = t.toLowerCase();
    return t;
  },
  glyph(f, ch) { return f.chars.get(this.SPECIAL[ch] || ch) || f.chars.get(ch) || null; },
  measure(name, text) {
    const f = this.sheets[name]; if (!f) return { w: 0, h: 0 };
    let w = 0;
    for (const ch of this.prep(name, text)) { if (ch === ' ') { w += 40; continue; } const g = this.glyph(f, ch); w += g ? g[0].fw : this.fbW(f); }
    return { w, h: f.maxHeight };
  },
  /* Dibuja en (x,y) = esquina superior izquierda. t = ms (animación 24 fps) */
  draw(ctx, name, text, x, y, scale = 1, t = 0) {
    const f = this.sheets[name]; if (!f) return false;
    let cx = 0; const fi = Math.floor(t / 1000 * 24);
    for (const ch of this.prep(name, text)) {
      if (ch === ' ') { cx += 40; continue; }
      const g = this.glyph(f, ch);
      if (!g) { this.fbDraw(ctx, f, ch, x + cx * scale, y, scale); cx += this.fbW(f); continue; }   // p. ej. números (bold no los trae)
      const fr = g[fi % g.length];
      drawSparrowFrame(ctx, fr, x + cx * scale, y + (f.maxHeight - fr.fh) * scale, scale);
      cx += g[0].fw;
    }
    return true;
  },
  fbW(f) { return f.maxHeight * 0.62; },
  fbDraw(ctx, f, ch, x, y, scale) {
    const h = f.maxHeight * scale;
    ctx.save(); ctx.font = `900 ${h * 0.82}px "Arial Black", "Trebuchet MS", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = h * 0.12; ctx.strokeStyle = '#000'; ctx.strokeText(ch, x + this.fbW(f) * scale / 2, y + h * 0.55);
    ctx.fillStyle = '#fff'; ctx.fillText(ch, x + this.fbW(f) * scale / 2, y + h * 0.55); ctx.restore();
  },
  /* Canvas con el texto (para la interfaz HTML). Devuelve null si la fuente no está */
  toCanvas(name, text, height, t = 0, canvas = null) {
    if (!this.has(name)) return null;
    const m = this.measure(name, text), sc = height / m.h, dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = canvas || document.createElement('canvas');
    const w = Math.max(1, Math.ceil(m.w * sc)), h = Math.ceil(m.h * sc);
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px'; }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    this.draw(x, name, text, 0, 0, sc, t);
    return c;
  },
};
