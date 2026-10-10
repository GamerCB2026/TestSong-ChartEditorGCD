/* =====================================================================
   opciones.js — opciones de juego guardadas en localStorage:
   Middlescroll, Downscroll/Upscroll y Asignar Teclas (A S W D por defecto;
   las flechas siempre funcionan como segunda asignación).
   El menú (estilo FNF con la fuente "bold") está en ui.js.
   ===================================================================== */
'use strict';

const OPTS_KEY = 'testsong-gcd-opciones';
/* v3.6.0: Controles Móvil → Hitbox (por defecto) o Control V-Slice (flechas grandes abajo que se tocan; id interno 'toque') */
const VSLICE_MODES = ['hitbox', 'toque'];
const VSLICE_LABEL = { hitbox: 'Hitbox', toque: 'Control V-Slice' };
const Opts = {
  middlescroll: false,
  downscroll: null,          // null = automático (arriba; con "Flechas grandes" en táctil: abajo)
  // Controles Móvil (v3.6.0): hitbox = 4 carriles verticales de toda la pantalla (por defecto)
  // · toque = "Control V-Slice": receptores grandes abajo que se tocan directamente
  vslice: 'hitbox',
  keys: DEFAULT_KEYS.slice(),
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}');
      if (typeof d.middlescroll === 'boolean') this.middlescroll = d.middlescroll;
      if (typeof d.downscroll === 'boolean') this.downscroll = d.downscroll;
      // v3.6.0: Hitbox es el nuevo valor por defecto; lo elegido en esta versión se respeta
      if (VSLICE_MODES.includes(d.vslice) && d.ver >= 36) this.vslice = d.vslice;
      if (Array.isArray(d.keys) && d.keys.length === 4 && d.keys.every(k => typeof k === 'string' && k)) this.keys = d.keys.slice();
    } catch (e) { /* almacenamiento bloqueado o JSON roto: valores por defecto */ }
    // la URL manda (no se guarda): ?downscroll=1 / ?middlescroll=1
    if (params.has('downscroll')) this.downscroll = params.get('downscroll') !== '0';
    if (params.has('middlescroll')) this.middlescroll = params.get('middlescroll') !== '0';
    { const q = ({ vslice: 'toque', arrows: 'toque' })[params.get('vslice')] || params.get('vslice'); if (VSLICE_MODES.includes(q)) this.vslice = q; }
  },
  save() {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify({ ver: 36, middlescroll: this.middlescroll, downscroll: this.downscroll, keys: this.keys, vslice: this.vslice })); } catch (e) {}
  },
  isDown() { if (typeof G !== 'undefined' && G.mode === 'mobile' && this.vslice === 'toque') return true; return this.downscroll ?? false; },
  /* carril de una tecla: asignación del usuario o flechas */
  laneOf(key) {
    if (key in ARROW_KEYS) return ARROW_KEYS[key];
    const k = normKey(key), i = this.keys.indexOf(k);
    return i >= 0 ? i : undefined;
  },
  setKey(lane, key) {
    const k = normKey(key), other = this.keys.indexOf(k);
    if (other >= 0 && other !== lane) this.keys[other] = this.keys[lane];   // intercambio si ya estaba usada
    this.keys[lane] = k; this.save();
  },
  resetKeys() { this.keys = DEFAULT_KEYS.slice(); this.save(); },
};
const normKey = k => (k && k.length === 1) ? k.toLowerCase() : k;
const KEY_NAMES = { ' ': 'ESPACIO', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑', ArrowRight: '→', Shift: 'SHIFT', Control: 'CTRL', Alt: 'ALT',
  Backspace: 'BORRAR', Tab: 'TAB', CapsLock: 'MAYUS', Delete: 'SUPR', Home: 'INICIO', End: 'FIN', PageUp: 'REPAG', PageDown: 'AVPAG', Insert: 'INSERT' };
const keyName = k => KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k.toUpperCase());
const LANE_ES = ['Izquierda', 'Abajo', 'Arriba', 'Derecha'];
const RESERVED_KEYS = ['Escape', 'Enter', 'Tab'];

Opts.load();
