/* =====================================================================
   DeathAnim.js — al llegar la vida a 0 se muestra la animación de
   muerte (game over) en vez de abrir de inmediato el menú "Perdiste".

   Orden (como en Friday Night Funkin'):
     firstDeath → (al terminar) deathLoop en bucle
     Enter / toque → deathConfirm y luego reiniciar
     Escape → salir al menú de "Perdiste" que ya tenía el juego

   Si el personaje del jugador (bf) tiene en su JSON/XML alguna
   animación cuyo nombre contiene "death", se usa esa. Si no, se usa
   la de Boyfriend por defecto (shared/characters/bf-death:
   firstDeath / deathLoop / deathConfirm).

   Las animaciones de muerte viven en otro atlas y el cargador de
   personajes no las incluye (NEEDED_ANIM). Aquí se cargan solo al
   morir, reutilizando loadGraphic / atlasBuscarAnimacion.
   ===================================================================== */
'use strict';

const DeathAnim = {
  active: false,
  allowOver: false,
  phase: 'off',          // off | loading | intro | loop | confirm
  char: null,
  attached: [],          // nombres de anims que inyectamos (para no pisar de más)
  _camOff0: null,
  _alphas: null,
  _gen: 0,

  /* Nombres canónicos y cualquier otro que traiga "death" en el nombre. */
  pickEntries(data) {
    const list = (data && Array.isArray(data.animations)) ? data.animations : [];
    const death = list.filter(a => a && /death/i.test(String(a.name || '')));
    const by = n => death.find(a => String(a.name).toLowerCase() === n) || null;
    const first = by('firstdeath') || death.find(a => /first|intro|dies|die/i.test(a.name)) || death[0] || null;
    const loop = by('deathloop') || death.find(a => /loop/i.test(a.name) && a !== first) || null;
    const confirm = by('deathconfirm') || death.find(a => /confirm|retry/i.test(a.name) && a !== first && a !== loop) || null;
    return { all: death, first, loop, confirm };
  },

  fallbackData() {
    if (typeof DEFAULT_DATA !== 'undefined' && DEFAULT_DATA.characters && DEFAULT_DATA.characters.bf) return DEFAULT_DATA.characters.bf;
    return {
      assetPath: 'shared:characters/bf-death',
      renderType: 'animateatlas',
      animations: [
        { assetPath: 'shared:characters/bf-death', name: 'firstDeath', prefix: 'Death Intro', offsets: [22, 15] },
        { assetPath: 'shared:characters/bf-death', name: 'deathLoop', prefix: 'Death Loop', looped: true, offsets: [22, 15] },
        { assetPath: 'shared:characters/bf-death', name: 'deathConfirm', prefix: 'Death Confirm', offsets: [22, 15] },
      ],
    };
  },

  async loadAnims(data) {
    const pick = this.pickEntries(data);
    const wanted = [pick.first, pick.loop, pick.confirm].filter(Boolean);
    if (!wanted.length) return new Map();
    const mainAp = data.assetPath || 'shared:characters/bf-death';
    const extra = {};
    const anims = new Map();
    for (const a of wanted) {
      let g = null;
      const ap = a.assetPath && a.assetPath !== mainAp ? a.assetPath : (a.assetPath || mainAp);
      if (!(ap in extra)) extra[ap] = await loadGraphic(parseAssetPath(ap), a.renderType || data.renderType || 'animateatlas');
      g = extra[ap];
      const base = { name: a.name, fps: +a.frameRate || 24, loop: !!a.looped, off: a.offsets || [0, 0], flipX: !!a.flipX };
      if (g && g.type === 'atlas') {
        const r = atlasBuscarAnimacion(g.model, { prefijo: a.prefix || '', indices: a.frameIndices || [], animType: a.animType });
        if (r && r.frames.length) anims.set(a.name, Object.assign(base, { type: 'atlas', model: g.model, timeline: r.timeline, frames: r.frames }));
      } else if (g) {
        const fr = sparrowFrames(g.atlas, a.prefix || '', a.frameIndices, g.img);
        if (fr.length) anims.set(a.name, Object.assign(base, { type: 'sparrow', frames: fr }));
      }
    }
    return anims;
  },

  attachTo(char, anims) {
    if (!char || !anims || !anims.size) return false;
    this.attached = [];
    for (const [n, a] of anims) {
      char.anims.set(n, a);
      if (char.animation && typeof char.animation.add === 'function') char.animation.add(n, a.frames.length, a.fps || 24, !!a.loop);
      this.attached.push(n);
    }
    return true;
  },

  async ensureSounds() {
    if (this._sfx) return;
    this._sfx = true;
    const loss = ['shared/sounds/fnf_loss_sfx', 'sounds/fnf_loss_sfx', 'shared/sounds/gameplay/gameover/fnf_loss_sfx', 'sounds/gameplay/fnf_loss_sfx'];
    const go = ['shared/music/gameOver/gameOver', 'music/gameOver/gameOver', 'shared/music/gameOver', 'music/gameOver'];
    const end = ['shared/music/gameOverEnd/gameOverEnd', 'music/gameOverEnd/gameOverEnd', 'shared/music/gameOverEnd', 'music/gameOverEnd'];
    if (typeof Sfx !== 'undefined') {
      await Promise.all([
        Sfx.has('deathLoss') ? null : Sfx.load('deathLoss', loss),
        Sfx.has('gameOver') ? null : Sfx.load('gameOver', go),
        Sfx.has('gameOverEnd') ? null : Sfx.load('gameOverEnd', end),
      ]);
    }
  },

  /* Punto de entrada: lo llama el gancho de openOverlay('over') / onHealthZero. */
  start() {
    if (this.active || this.phase === 'loading') return;
    if (typeof isBot === 'function' && isBot()) { this.bail(); return; }
    this.phase = 'loading';
    this.active = true;
    this.allowOver = false;
    this._gen++;
    const gen = this._gen;
    if (typeof G !== 'undefined') G.paused = true;
    if (typeof Music !== 'undefined') Music.pause();
    if (typeof Sfx !== 'undefined') Sfx.stopLoop();
    this._run(gen).catch(e => {
      console.warn('[DeathAnim]', e);
      if (gen === this._gen) this.bail();
    });
  },

  async _run(gen) {
    const bf = (typeof Scene !== 'undefined' && Scene.chars && Scene.chars.bf) || null;
    await this.ensureSounds();
    if (gen !== this._gen) return;

    let data = bf && bf.data ? bf.data : null;
    let anims = data ? await this.loadAnims(data) : new Map();
    if (gen !== this._gen) return;
    if (!anims.size) {
      data = this.fallbackData();
      anims = await this.loadAnims(data);
    }
    if (gen !== this._gen) return;
    if (!anims.size || !bf) { this.bail(); return; }

    this.char = bf;
    this.attachTo(bf, anims);
    bf.isDead = true;
    if (typeof bf.canPlayOtherAnims !== 'undefined') bf.canPlayOtherAnims = true;

    /* cámara: offsets de data.death si existen */
    const death = (bf.data && bf.data.death) || (data && data.death) || {};
    if (death.cameraOffsets) {
      this._camOff0 = bf.camOff;
      bf.camOff = death.cameraOffsets.slice();
    }
    if (typeof VS !== 'undefined' && VS.play && bf.cameraFocusPoint) {
      const fp = bf.cameraFocusPoint;
      VS.play.cameraFollowPoint.setPosition(fp.x, fp.y);
      if (death.cameraZoom && typeof VS.play.tweenCameraZoom === 'function') {
        VS.play.tweenCameraZoom(+death.cameraZoom, 0.5, true, null);
      }
    }

    /* atenuar al rival y a GF para que se lea la muerte */
    this._alphas = {};
    for (const r of ['dad', 'gf']) {
      const c = Scene.chars[r];
      if (c) { this._alphas[r] = c.alpha; c.alpha = 0.2; }
    }

    if (typeof Sfx !== 'undefined' && Sfx.has('deathLoss')) Sfx.play('deathLoss', 1);

    const pick = this.pickEntries({ animations: [...anims.keys()].map(n => ({ name: n, looped: !!(anims.get(n) && anims.get(n).loop) })) });
    this.names = {
      first: (pick.first && pick.first.name) || (anims.has('firstDeath') ? 'firstDeath' : [...anims.keys()][0]),
      loop: (pick.loop && pick.loop.name) || (anims.has('deathLoop') ? 'deathLoop' : null),
      confirm: (pick.confirm && pick.confirm.name) || (anims.has('deathConfirm') ? 'deathConfirm' : null),
    };

    this._play(this.names.first, false);
    this.phase = this.names.loop || !anims.get(this.names.first) || !anims.get(this.names.first).loop ? 'intro' : 'loop';
    if (this.phase === 'loop') this._startLoopMusic();
  },

  _play(name, loopFallback) {
    const c = this.char;
    if (!c || !name) return false;
    if (typeof c.canPlayOtherAnims !== 'undefined') c.canPlayOtherAnims = true;
    const a = c.anims.get(name);
    if (!a) return false;
    if (loopFallback && a.loop === false && /loop/i.test(name)) a.loop = true;
    if (c.animation && c.animation.anims && c.animation.anims.get(name)) c.animation.anims.get(name).looped = !!a.loop;
    if (typeof c.playAnimation === 'function') c.playAnimation(name, true, true);
    else if (typeof c.play === 'function') c.play(name, true, true);
    return true;
  },

  _startLoopMusic() {
    if (typeof Sfx !== 'undefined' && Sfx.has('gameOver')) Sfx.playLoop('gameOver', 0.6, 0.4);
  },

  _goLoop() {
    if (this.phase !== 'intro') return;
    if (this.names.loop && this._play(this.names.loop, true)) this.phase = 'loop';
    else this.phase = 'loop';   /* se queda en el último frame de firstDeath */
    this._startLoopMusic();
  },

  confirm() {
    if (!this.active || this.phase === 'loading' || this.phase === 'confirm') return;
    if (this.phase === 'intro') this._goLoop();
    this.phase = 'confirm';
    if (typeof Sfx !== 'undefined') {
      Sfx.stopLoop();
      if (Sfx.has('gameOverEnd')) Sfx.play('gameOverEnd', 1);
    }
    if (this.names.confirm) this._play(this.names.confirm, false);
    this.retry();
  },

  exit() {
    if (!this.active) return;
    this.allowOver = true;
    this.stop();
    if (typeof openOverlay === 'function') openOverlay('over');
  },

  retry() {
    const run = () => {
      this.stop();
      if (typeof restart === 'function') restart();
    };
    this._retryAt = performance.now() + (this.names.confirm ? 200 : 0);
    this._doRetry = run;
    if (!this.names.confirm) run();
  },

  bail() {
    this.allowOver = true;
    this.stop();
    if (typeof openOverlay === 'function') openOverlay('over');
  },

  stop() {
    this._gen++;
    const c = this.char;
    if (c) {
      c.isDead = false;
      if (this._camOff0) { c.camOff = this._camOff0; this._camOff0 = null; }
      if (typeof c.canPlayOtherAnims !== 'undefined') c.canPlayOtherAnims = true;
    }
    if (this._alphas && typeof Scene !== 'undefined') {
      for (const r of Object.keys(this._alphas)) {
        const ch = Scene.chars[r];
        if (ch) ch.alpha = this._alphas[r];
      }
    }
    this._alphas = null;
    this.char = null;
    this.attached = [];
    this.phase = 'off';
    this.active = false;
    this._doRetry = null;
    if (typeof Sfx !== 'undefined') Sfx.stopLoop();
  },

  update(dt) {
    if (!this.active || this.phase === 'loading') return;
    const el = Math.max(0, dt || 0) / 1000;
    const c = this.char;
    if (c && c.animation && typeof c.animation.update === 'function') c.animation.update(el);
    if (typeof VS !== 'undefined' && VS.play && VS.play.camera && typeof VS.play.camera.update === 'function') {
      VS.play.camera.update(el);
    }
    if (typeof G !== 'undefined') G.gameTime = (G.gameTime || 0) + (dt || 0);
    if (this.phase === 'intro' && c && typeof c.finished === 'function' && c.finished()) this._goLoop();
    if (this.phase === 'confirm') {
      const doneAnim = c && typeof c.finished === 'function' && c.finished();
      const doneWait = this._retryAt && performance.now() >= this._retryAt + 600;
      if ((doneAnim || doneWait) && this._doRetry) { const fn = this._doRetry; this._doRetry = null; fn(); }
    }
  },

  /* texto de ayuda encima del HUD oculto */
  overlay() {
    if (!this.active || this.phase === 'loading' || this.phase === 'confirm') return;
    if (typeof ctx === 'undefined' || typeof W === 'undefined') return;
    ctx.save();
    ctx.setTransform((typeof DPR === 'number' ? DPR : 1), 0, 0, (typeof DPR === 'number' ? DPR : 1), 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, Math.max(8, H * 0.08));
    ctx.fillRect(0, H * 0.92, W, H * 0.08);
    if (this.phase === 'loop' && typeof text === 'function') {
      const s = Math.max(16, Math.min(28, W / 32));
      text('ENTER / toque: Reintentar    ESC: Salir', W / 2, H * 0.96, s, '#fff', 'center', '800', '"Trebuchet MS", sans-serif', false);
    }
    ctx.restore();
  },

  _onKey(e) {
    if (!this.active || this.phase === 'loading') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); this.confirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.exit(); }
  },
  _onTap(e) {
    if (!this.active || this.phase === 'loading' || this.phase === 'confirm') return;
    if (e && e.target && e.target.closest && e.target.closest('#overlay, #pausePanel, button, a, select, input')) return;
    e.preventDefault();
    this.confirm();
  },

  install() {
    if (this._ok) return;
    this._ok = true;

    if (typeof openOverlay === 'function') {
      const prev = openOverlay;
      openOverlay = function (kind, menu) {
        if (DeathAnim.active) {
          if (kind === 'over' && !DeathAnim.allowOver) return;
          if (kind === 'pause' || kind === 'ready') return;
        } else if (kind === 'over' && !menu) {
          DeathAnim.start();
          return;
        }
        return prev(kind, menu);
      };
    }

    if (typeof restart === 'function') {
      const prevR = restart;
      restart = function (paused) { DeathAnim.stop(); return prevR(paused); };
    }

    if (typeof render === 'function') {
      const prevRender = render;
      render = function (dt) {
        if (DeathAnim.active) DeathAnim.update(dt);
        prevRender(dt);
        if (DeathAnim.active) DeathAnim.overlay();
      };
    }

    if (typeof drawHudLayer === 'function') {
      const prevHud = drawHudLayer;
      drawHudLayer = function () {
        if (DeathAnim.active && DeathAnim.phase !== 'off') return;
        return prevHud();
      };
    }

    window.addEventListener('keydown', e => DeathAnim._onKey(e), true);
    window.addEventListener('pointerdown', e => DeathAnim._onTap(e), true);
  },
};

DeathAnim.install();
