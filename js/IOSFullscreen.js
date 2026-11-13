/* =====================================================================
   IOSFullscreen.js — pantalla completa en iPhone / iPad Safari.

   Safari iOS no permite requestFullscreen en nada que no sea un <video>
   (en iPhone). Este módulo, con el mismo botón #fsBtn / #rotarFs:

     1) Intenta la API estándar y webkitRequestFullscreen /
        webkitEnterFullscreen (sirve en iPad y en otros navegadores).
     2) Si no hay API, entra en "pseudo-fullscreen": canvas y página a
        pantalla completa (fixed, 100dvh, safe-area), oculta barras
        con un scroll, bloquea zoom/scroll, y se sale con el mismo botón.
     3) Si el juego se abrió desde "Agregar a pantalla de inicio"
        (navigator.standalone / display-mode), ya está a pantalla completa.

   No reescribe movil.js: envuelve Movil.fullscreen / isFs / syncFs.
   ===================================================================== */
'use strict';

const IOSFullscreen = {
  pseudo: false,
  LS_TIP: 'testsong-gcd-ios-a2hs',
  PATH_IN: 'M9 3v6H3M15 3v6h6M15 21v-6h6M9 21v-6H3',
  PATH_OUT: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',

  isIOS() {
    if (typeof Movil !== 'undefined' && Movil.isIOS) return Movil.isIOS();
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  isIPhone() { return /iPhone|iPod/.test(navigator.userAgent); },
  isStandalone() {
    if (navigator.standalone === true) return true;
    try { if (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches) return true; } catch (e) {}
    return false;
  },
  nativeOn() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
  isOn() { return this.nativeOn() || this.pseudo || this.isStandalone(); },

  /* --------- entrada / salida --------- */
  async toggle() {
    if (this.nativeOn() || this.pseudo) return this.exit();
    if (this.isStandalone()) { this.syncBtn(); return true; }
    return this.enter();
  },

  async enter() {
    const nodes = [document.documentElement, document.body, document.getElementById('game'), document.getElementById('gameGL')];
    for (const el of nodes) {
      if (await this._tryNative(el)) {
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* iOS no lo permite */ }
        setTimeout(() => { if (typeof resize === 'function') resize(); }, 250);
        this.syncBtn();
        return true;
      }
    }
    this.enterPseudo();
    return true;
  },

  async _tryNative(el) {
    if (!el) return false;
    try {
      if (typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen({ navigationUI: 'hide' });
        return this.nativeOn() || !!document.fullscreenElement;
      }
    } catch (e) { /* iPhone rechaza la promesa */ }
    try {
      if (typeof el.webkitRequestFullscreen === 'function') { el.webkitRequestFullscreen(); return true; }
    } catch (e) {}
    try {
      if (typeof el.webkitRequestFullScreen === 'function') { el.webkitRequestFullScreen(); return true; }
    } catch (e) {}
    try {
      if (typeof el.webkitEnterFullscreen === 'function') { el.webkitEnterFullscreen(); return true; }
    } catch (e) {}
    return false;
  },

  exit() {
    if (this.nativeOn()) {
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
      try { if (fn) fn.call(document); } catch (e) {}
    }
    if (this.pseudo) this.exitPseudo();
    this.syncBtn();
    if (typeof resize === 'function') setTimeout(resize, 120);
    return true;
  },

  enterPseudo() {
    if (this.pseudo) return;
    this.pseudo = true;
    document.documentElement.classList.add('ios-pseudo-fs');
    document.body.classList.add('ios-pseudo-fs');
    this._hideSafariBars();
    this.syncBtn();
    if (typeof resize === 'function') setTimeout(resize, 80);
    setTimeout(() => { if (typeof resize === 'function') resize(); }, 320);
  },

  exitPseudo() {
    if (!this.pseudo) return;
    this.pseudo = false;
    document.documentElement.classList.remove('ios-pseudo-fs');
    document.body.classList.remove('ios-pseudo-fs');
    document.documentElement.style.height = '';
    document.body.style.height = '';
  },

  /* Scroll corto para que Safari recoja la barra de herramientas. */
  _hideSafariBars() {
    const html = document.documentElement;
    const prev = html.style.height;
    html.style.height = 'calc(100dvh + 80px)';
    try { window.scrollTo(0, 1); } catch (e) {}
    setTimeout(() => {
      html.style.height = prev || '';
      try { window.scrollTo(0, 0); } catch (e) {}
      if (typeof resize === 'function') resize();
    }, 250);
  },

  /* --------- botón (visible en pseudo-fs para poder salir) --------- */
  syncBtn() {
    const b = typeof $ === 'function' ? $('fsBtn') : document.getElementById('fsBtn');
    if (!b) return;
    const movil = document.body.classList.contains('movil');
    const portrait = typeof Movil !== 'undefined' && Movil.portrait;
    const native = this.nativeOn();
    const alone = this.isStandalone();
    /* en nativo / "Añadir a inicio" las barras ya no están: se oculta el botón.
       en pseudo-fs se deja visible para desactivar con el mismo control. */
    b.hidden = !movil || portrait || native || alone;
    b.classList.toggle('fs-on', this.pseudo || native);
    const on = this.pseudo || native;
    b.title = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    b.setAttribute('aria-label', b.title);
    const path = b.querySelector('path');
    if (path) path.setAttribute('d', on ? this.PATH_IN : this.PATH_OUT);
  },

  /* --------- aviso único (iPhone Safari, no standalone) --------- */
  maybeTip() {
    if (!this.isIPhone() || this.isStandalone()) return;
    try { if (localStorage.getItem(this.LS_TIP) === '1') return; } catch (e) { return; }
    const box = document.createElement('div');
    box.id = 'iosA2hs';
    box.setAttribute('role', 'status');
    box.innerHTML = '<p>Para pantalla completa en iPhone: toca <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>. Abre el juego desde ese icono y se verá sin barras.</p><button type="button" id="iosA2hsOk">Entendido</button>';
    document.body.appendChild(box);
    const close = () => {
      box.classList.add('off');
      try { localStorage.setItem(this.LS_TIP, '1'); } catch (e) {}
      setTimeout(() => box.remove(), 280);
    };
    box.querySelector('#iosA2hsOk').addEventListener('click', e => { e.stopPropagation(); close(); });
    setTimeout(() => box.classList.add('show'), 1400);
  },

  _injectCss() {
    if (document.getElementById('iosFsCss')) return;
    const s = document.createElement('style');
    s.id = 'iosFsCss';
    s.textContent = `
html.ios-pseudo-fs, html.ios-pseudo-fs body {
  position: fixed; inset: 0; width: 100%; height: 100%; height: 100dvh; margin: 0;
  overflow: hidden; touch-action: none; overscroll-behavior: none;
  padding: 0;
}
html.ios-pseudo-fs #game, html.ios-pseudo-fs #gameGL {
  position: fixed !important; inset: 0 !important;
  width: 100% !important; height: 100% !important; height: 100dvh !important;
  touch-action: none;
}
#fsBtn.fs-on { opacity: 1; }
#iosA2hs {
  position: fixed; z-index: 80; left: 50%; bottom: max(16px, env(safe-area-inset-bottom));
  transform: translateX(-50%) translateY(12px);
  width: min(92vw, 520px); padding: 12px 14px; border-radius: 14px;
  background: rgba(20,10,36,.94); border: 2px solid #fff; box-shadow: 0 6px 0 #000;
  font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.4;
  color: #fff; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s;
  display: flex; gap: 10px; align-items: center;
}
#iosA2hs.show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
#iosA2hs.off { opacity: 0; pointer-events: none; }
#iosA2hs p { margin: 0; flex: 1; text-shadow: 1px 1px 0 #000; }
#iosA2hs b { color: #ffd86b; }
#iosA2hs button {
  flex: 0 0 auto; min-height: 40px; padding: 8px 12px; border-radius: 10px;
  border: 3px solid #000; background: #ffd86b; color: #000; font-weight: 900; cursor: pointer;
}
`;
    document.head.appendChild(s);
  },

  _blockGestures(e) { if (this.pseudo || this.isIOS()) e.preventDefault(); },
  _blockScroll(e) {
    if (!this.pseudo) return;
    const t = e.target;
    if (t && t.closest && t.closest('#pauseItems, #pausePanel, #modModal, #modBody, #optHint')) return;
    e.preventDefault();
  },

  install() {
    if (this._ok) return;
    this._ok = true;
    this._injectCss();

    if (typeof Movil !== 'undefined') {
      Movil.fullscreen = () => IOSFullscreen.toggle();
      Movil.isFs = () => IOSFullscreen.isOn();
      const prevSync = Movil.syncFs.bind(Movil);
      Movil.syncFs = function () { IOSFullscreen.syncBtn(); void prevSync; };
      this.syncBtn();
    }

    ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
      document.addEventListener(ev, e => IOSFullscreen._blockGestures(e), { passive: false });
    });
    document.addEventListener('touchmove', e => IOSFullscreen._blockScroll(e), { passive: false });

    if (window.visualViewport) {
      visualViewport.addEventListener('resize', () => {
        if (IOSFullscreen.pseudo && typeof resize === 'function') resize();
      });
    }
    document.addEventListener('fullscreenchange', () => this.syncBtn());
    document.addEventListener('webkitfullscreenchange', () => this.syncBtn());

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.maybeTip());
    else this.maybeTip();
  },
};

IOSFullscreen.install();
