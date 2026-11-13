/* =====================================================================
   GhostTapping.js — opción de Ghost Tapping en Ajustes (localStorage).

   ON  = pulsar una tecla sin nota que golpear no penaliza.
   OFF = esa pulsación cuenta como fallo (sonido y animación de miss,
         vida y puntuación), usando la lógica que ya tiene vslice.js
         (ghostNoteMiss / onNoteGhostMiss).

   No reescribe el motor: solo guarda la preferencia y la aplica a
   VS.play.ghostTappingFeature (antes iba fija: ON solo en móvil).
   ===================================================================== */
'use strict';

const GhostTapping = {
  /* null = automático (ON en móvil, OFF en teclado), como antes de esta opción */
  _auto() { return typeof G !== 'undefined' && G.mode === 'mobile'; },
  isOn() {
    if (typeof Opts === 'undefined') return this._auto();
    return typeof Opts.ghostTapping === 'boolean' ? !!Opts.ghostTapping : this._auto();
  },
  apply() {
    if (typeof VS !== 'undefined' && VS.play) VS.play.ghostTappingFeature = this.isOn();
  },
  toggle() {
    if (typeof Opts === 'undefined') return this.isOn();
    Opts.ghostTapping = !this.isOn();
    Opts.save();
    this.apply();
    return Opts.ghostTapping;
  },
  install() {
    if (this._ok || typeof Opts === 'undefined') return;
    this._ok = true;

    if (typeof Opts.ghostTapping === 'undefined') Opts.ghostTapping = null;
    try {
      const d = JSON.parse(localStorage.getItem(typeof OPTS_KEY === 'string' ? OPTS_KEY : 'testsong-gcd-opciones') || '{}');
      if (typeof d.ghostTapping === 'boolean') Opts.ghostTapping = d.ghostTapping;
    } catch (e) { /* almacenamiento bloqueado */ }

    const prevSave = Opts.save.bind(Opts);
    Opts.save = function () {
      prevSave();
      try {
        const key = typeof OPTS_KEY === 'string' ? OPTS_KEY : 'testsong-gcd-opciones';
        const d = JSON.parse(localStorage.getItem(key) || '{}');
        d.ghostTapping = Opts.ghostTapping;
        localStorage.setItem(key, JSON.stringify(d));
      } catch (e) { /* ignore */ }
    };

    if (typeof syncPlayMode === 'function') {
      const prev = syncPlayMode;
      syncPlayMode = function () { prev(); GhostTapping.apply(); };
    }
    this.apply();

    /* entrada en el menú Opciones, sin tocar el resto de ajustes */
    if (typeof menuItems === 'function') {
      const prevItems = menuItems;
      menuItems = function (menu) {
        const items = prevItems(menu);
        if (menu === 'options' && !items.some(it => it[0] === 'ghostTapping')) {
          const lab = 'Ghost Tapping: ' + (typeof onOff === 'function' ? onOff(GhostTapping.isOn()) : (GhostTapping.isOn() ? 'On' : 'Off'));
          const i = items.findIndex(it => it[0] === 'downscroll' || it[0] === 'keybinds');
          items.splice(i >= 0 ? (items[i][0] === 'downscroll' ? i + 1 : i) : Math.max(1, items.length - 1), 0, ['ghostTapping', lab]);
        }
        return items;
      };
    }
    if (typeof activate === 'function') {
      const prevAct = activate;
      activate = function (id) {
        if (id === 'ghostTapping') {
          const on = GhostTapping.toggle();
          if (typeof buildMenu === 'function') buildMenu('options', true);
          if (typeof Sfx !== 'undefined') Sfx.play('scrollMenu', 0.4);
          if (typeof toast === 'function') toast(on ? 'Ghost Tapping: On — pulsar sin nota no penaliza' : 'Ghost Tapping: Off — pulsar sin nota cuenta como fallo', 2800);
          return;
        }
        return prevAct(id);
      };
    }
  },
};

GhostTapping.install();
