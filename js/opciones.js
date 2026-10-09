/* =====================================================================
   opciones.js — opciones de juego guardadas en localStorage:
   Middlescroll, Downscroll/Upscroll y Asignar Teclas (A S W D por defecto;
   las flechas siempre funcionan como segunda asignación).
   El menú (estilo FNF con la fuente "bold") está en ui.js.
   ===================================================================== */
'use strict';

const OPTS_KEY = 'testsong-gcd-opciones';
const Opts = {
  middlescroll: false,
  downscroll: null,          // null = automático (celular vertical: abajo; PC: arriba)
  keys: DEFAULT_KEYS.slice(),
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}');
      if (typeof d.middlescroll === 'boolean') this.middlescroll = d.middlescroll;
      if (typeof d.downscroll === 'boolean') this.downscroll = d.downscroll;
      if (Array.isArray(d.keys) && d.keys.length === 4 && d.keys.every(k => typeof k === 'string' && k)) this.keys = d.keys.slice();
    } catch (e) { /* almacenamiento bloqueado o JSON roto: valores por defecto */ }
    // la URL manda (no se guarda): ?downscroll=1 / ?middlescroll=1
    if (params.has('downscroll')) this.downscroll = params.get('downscroll') !== '0';
    if (params.has('middlescroll')) this.middlescroll = params.get('middlescroll') !== '0';
  },
  save() {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify({ middlescroll: this.middlescroll, downscroll: this.downscroll, keys: this.keys })); } catch (e) {}
  },
  isDown() { return this.downscroll ?? !!V.portrait; },
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
