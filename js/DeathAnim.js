/* =====================================================================
   DeathAnim.js — game over al estilo del FNF original (V-Slice / base).

   1) Al morir: pantalla negra salvo el personaje. Se oye fnf_loss_sfx
      al instante (variante del personaje si existe, p. ej. pico).
      La cámara se queda donde estaba y, a partir del frame ~12 de
      firstDeath, hace un paneo/zoom suave (lerp 0.01) hacia el jugador.
   2) Al terminar firstDeath (o a los ~2.5 s si no acaba) suena
      gameOver en bucle y se reproduce deathLoop.
   3) Enter / toque: deathConfirm, se corta gameOver, suena gameOverEnd,
      espera ~0.7 s, fundido a negro ~2 s y se reinicia la canción.
   4) Escape / Atrás: se corta la música y se vuelve al menú (pantalla
      "Listo", lo más cercano a freeplay/story en esta web).
   5) El volumen usa el de SFX/música del motor (FlxG.sound.volume y
      Music.getVolume si existen).

   Rutas de audio (Sfx.load prueba .ogg y .mp3). El usuario debe tener
   al menos uno de cada grupo en el proyecto:

     pérdida:  shared/sounds/fnf_loss_sfx
               sounds/fnf_loss_sfx
               shared/sounds/gameplay/gameover/fnf_loss_sfx
               sounds/gameplay/gameover/fnf_loss_sfx
               (pico: …/fnf_loss_sfx-pico, …/pico_loss_sfx, weekend1/sounds/…)
     bucle:    shared/music/gameOver/gameOver
               music/gameOver/gameOver
               shared/music/gameOver
               music/gameOver
               music/gameplay/gameover/gameOver
     confirm:  shared/music/gameOverEnd/gameOverEnd
               music/gameOverEnd/gameOverEnd
               shared/music/gameOverEnd
               music/gameOverEnd
               music/gameplay/gameover/gameOverEnd
   ===================================================================== */
'use strict';

const DeathAnim = {
  active: false,
  allowOver: false,
  phase: 'off',          // off | loading | intro | loop | confirm
  char: null,
  attached: [],
  _camOff0: null,
  _lerp0: null,
  _zoom0: null,
  _followOn: false,
  _fadeA: 0,
  _confirmAt: 0,
  _introAt: 0,
  _gen: 0,
  _loaded: {},           // key -> true (ya se pidió a Sfx.load)
  hideWorld: false,

  /* ---------- volumen (ajustes del motor; si no hay, 1) ---------- */
  sfxVol(mult) {
    let v = 1;
    try {
      const flx = typeof HOST !== 'undefined' && HOST.global && HOST.global('FlxG');
      if (flx && flx.sound && typeof flx.sound.volume === 'number') v *= flx.sound.volume;
    } catch (e) {}
    return Math.max(0, Math.min(1, v * (mult == null ? 1 : +mult)));
  },
  musicVol(mult) {
    let v = this.sfxVol(1);
    try {
      if (typeof Music !== 'undefined' && typeof Music.getVolume === 'function') {
        const inst = Music.getVolume('inst');
        if (typeof inst === 'number' && isFinite(inst)) v *= inst;
      }
    } catch (e) {}
    return Math.max(0, Math.min(1, v * (mult == null ? 1 : +mult)));
  },

  /* ---------- rutas candidatas ---------- */
  _strip(p) { return String(p || '').replace(/^assets\//i, '').replace(/\.(ogg|mp3|wav)$/i, ''); },
  _fromMod(kind, key) {
    if (typeof ModRes === 'undefined' || !ModRes.candidates) return [];
    const out = [];
    try {
      for (const lib of ['shared', null, 'preload', 'weekend1']) {
        for (const p of ModRes.candidates(kind, key, lib)) out.push(this._strip(p));
      }
    } catch (e) {}
    return out;
  },
  /* raíces típicas de este motor (countdown está en shared/sounds/gameplay/…,
     la música de pausa en music/<id>/<id> y shared/music/<id>/<id>). */
  _soundBases(name) {
    const n = String(name);
    return [
      ...this._fromMod('sound', n),
      'shared/sounds/' + n,
      'sounds/' + n,
      'shared/sounds/gameplay/gameover/' + n,
      'shared/sounds/gameplay/gameOver/' + n,
      'sounds/gameplay/gameover/' + n,
      'sounds/gameplay/gameOver/' + n,
      'shared/sounds/gameOver/' + n,
      'sounds/gameOver/' + n,
      'preload/sounds/' + n,
      'weekend1/sounds/' + n,
      'weekend1/sounds/gameplay/gameover/' + n,
    ];
  },
  _musicBases(name) {
    const n = String(name);
    return [
      ...this._fromMod('music', n),
      'shared/music/' + n + '/' + n,
      'music/' + n + '/' + n,
      'shared/music/' + n,
      'music/' + n,
      'shared/music/gameplay/gameover/' + n,
      'music/gameplay/gameover/' + n,
      'preload/music/' + n + '/' + n,
      'preload/music/' + n,
      'weekend1/music/' + n + '/' + n,
      'weekend1/music/' + n,
    ];
  },
  _uniq(list) {
    const out = [], seen = new Set();
    for (const x of list) {
      const k = this._strip(x);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(k);
    }
    return out;
  },
  /* "pico-playable" → ["pico-playable", "pico"] */
  charStems(id) {
    const raw = String(id || '').toLowerCase().trim();
    if (!raw || raw === 'bf') return [];
    const stems = [raw];
    const base = raw.replace(/-playable$/, '').replace(/-holding-.*$/, '').replace(/-(christmas|dark|pixel|car|blazin|dead)$/, '');
    if (base && base !== raw) stems.push(base);
    if (raw.indexOf('pico') === 0 && base !== 'pico') stems.push('pico');
    return stems;
  },
  soundPlan(charId) {
    const stems = this.charStems(charId);
    const lossKeys = [], goKeys = [], endKeys = [];
    for (const s of stems) {
      lossKeys.push(
        { key: 'deathLoss_' + s, bases: this._uniq(this._soundBases('fnf_loss_sfx-' + s).concat(this._soundBases(s + '_loss_sfx'), this._soundBases('fnf_loss_sfx_' + s))) }
      );
      goKeys.push({ key: 'gameOver_' + s, bases: this._uniq(this._musicBases('gameOver-' + s).concat(this._musicBases('gameOver' + s.charAt(0).toUpperCase() + s.slice(1)), this._musicBases('gameOver_' + s))) });
      endKeys.push({ key: 'gameOverEnd_' + s, bases: this._uniq(this._musicBases('gameOverEnd-' + s).concat(this._musicBases('gameOverEnd' + s.charAt(0).toUpperCase() + s.slice(1)), this._musicBases('gameOverEnd_' + s))) });
    }
    lossKeys.push({ key: 'deathLoss', bases: this._uniq(this._soundBases('fnf_loss_sfx')) });
    goKeys.push({ key: 'gameOver', bases: this._uniq(this._musicBases('gameOver')) });
    endKeys.push({ key: 'gameOverEnd', bases: this._uniq(this._musicBases('gameOverEnd')) });
    return { loss: lossKeys, loop: goKeys, end: endKeys };
  },

  async ensureSounds(charId) {
    if (typeof Sfx === 'undefined') return;
    const plan = this.soundPlan(charId);
    const tasks = [];
    for (const pack of [plan.loss, plan.loop, plan.end]) {
      for (const p of pack) {
        if (Sfx.has(p.key) || this._loaded[p.key]) continue;
        this._loaded[p.key] = true;
        tasks.push(Sfx.load(p.key, p.bases));
      }
    }
    if (tasks.length) await Promise.all(tasks);
  },
  _firstHas(keys) {
    if (typeof Sfx === 'undefined') return null;
    for (const k of keys) if (Sfx.has(k)) return k;
    return null;
  },
  playLoss(charId) {
    const keys = this.soundPlan(charId).loss.map(p => p.key);
    const k = this._firstHas(keys);
    if (k) Sfx.play(k, this.sfxVol(1));
  },
  playLoopMusic(charId) {
    if (typeof Sfx === 'undefined') return;
    Sfx.stopLoop();
    const keys = this.soundPlan(charId).loop.map(p => p.key);
    const k = this._firstHas(keys);
    if (k) Sfx.playLoop(k, this.musicVol(1), 0.05);
  },
  playEndMusic(charId) {
    const keys = this.soundPlan(charId).end.map(p => p.key);
    const k = this._firstHas(keys);
    if (k) Sfx.play(k, this.musicVol(1));
  },
  stopAudio() {
    if (typeof Sfx !== 'undefined') Sfx.stopLoop();
  },

  /* ---------- animaciones del personaje ---------- */
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
    const extra = {}, anims = new Map();
    for (const a of wanted) {
      const ap = a.assetPath && a.assetPath !== mainAp ? a.assetPath : (a.assetPath || mainAp);
      if (!(ap in extra)) extra[ap] = await loadGraphic(parseAssetPath(ap), a.renderType || data.renderType || 'animateatlas');
      const g = extra[ap];
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

  /* ---------- ciclo de vida ---------- */
  start() {
    if (this.active || this.phase === 'loading') return;
    if (typeof isBot === 'function' && isBot()) { this.bail(); return; }
    this.phase = 'loading';
    this.active = true;
    this.hideWorld = true;
    this.allowOver = false;
    this._fadeA = 0;
    this._followOn = false;
    this._gen++;
    const gen = this._gen;
    if (typeof G !== 'undefined') G.paused = true;
    if (typeof Music !== 'undefined') Music.pause();
    this.stopAudio();
    if (typeof Mods !== 'undefined' && Mods.hook) try { Mods.hook('onGameOver'); } catch (e) {}
    this._syncBackBtn();
    const id = (typeof Scene !== 'undefined' && Scene.chars && Scene.chars.bf && Scene.chars.bf.id) || 'bf';
    /* el sfx de muerte suena lo antes posible, sin esperar a las animaciones */
    this.ensureSounds(id).then(() => { if (this._gen === gen && this.active) this.playLoss(id); }).catch(() => {});
    this._run(gen).catch(e => {
      console.warn('[DeathAnim]', e);
      if (gen === this._gen) this.bail();
    });
  },

  async _run(gen) {
    const bf = (typeof Scene !== 'undefined' && Scene.chars && Scene.chars.bf) || null;
    const charId = (bf && bf.id) || 'bf';
    await this.ensureSounds(charId);
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
    this.charId = charId;
    this.attachTo(bf, anims);
    bf.isDead = true;
    if (typeof bf.canPlayOtherAnims !== 'undefined') bf.canPlayOtherAnims = true;

    const death = (bf.data && bf.data.death) || (data && data.death) || {};
    this.deathMeta = death;
    if (death.cameraOffsets) {
      this._camOff0 = bf.camOff;
      bf.camOff = death.cameraOffsets.slice();
    }
    /* la cámara se queda donde estaba hasta el frame 12 */
    if (typeof VS !== 'undefined' && VS.play && VS.play.camera) {
      this._lerp0 = VS.play.camera.followLerp;
      this._zoom0 = VS.play.camera.zoom;
      VS.play.camera.followActive = false;
    }

    const pick = this.pickEntries({ animations: [...anims.keys()].map(n => ({ name: n, looped: !!(anims.get(n) && anims.get(n).loop) })) });
    this.names = {
      first: (pick.first && pick.first.name) || (anims.has('firstDeath') ? 'firstDeath' : [...anims.keys()][0]),
      loop: (pick.loop && pick.loop.name) || (anims.has('deathLoop') ? 'deathLoop' : null),
      confirm: (pick.confirm && pick.confirm.name) || (anims.has('deathConfirm') ? 'deathConfirm' : null),
    };

    this._play(this.names.first, false);
    this._introAt = performance.now();
    this.phase = 'intro';
    this._syncBackBtn();
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

  /* paneo suave hacia el jugador (lerp 0.01, como GameOverSubState) */
  _startFollow() {
    if (this._followOn) return;
    this._followOn = true;
    const bf = this.char, P = typeof VS !== 'undefined' ? VS.play : null;
    if (!P || !P.camera || !bf) return;
    if (bf.cameraFocusPoint) P.cameraFollowPoint.setPosition(bf.cameraFocusPoint.x, bf.cameraFocusPoint.y);
    P.camera.followActive = true;
    P.camera.followLerp = 0.01;
    const z = this.deathMeta && this.deathMeta.cameraZoom != null ? +this.deathMeta.cameraZoom : null;
    if (z && typeof P.tweenCameraZoom === 'function') P.tweenCameraZoom(z, 0.8, true, null);
    else if (z) P.camera.zoom = (P.camera.zoom + z) / 2;
  },

  _curFrame() {
    const c = this.char;
    if (!c) return 0;
    if (typeof c.frameIdx === 'function') return c.frameIdx();
    const a = c.animation && c.animation.curAnim;
    return a ? (a.curFrame || 0) : 0;
  },
  _introLimit() {
    const c = this.char, a = c && c.anims && this.names && c.anims.get(this.names.first);
    const n = a && a.frames && a.frames.length, fps = (a && a.fps) || 24;
    if (n && fps) return Math.max(2500, (n / fps) * 1000 + 80);
    return 2500;
  },

  _goLoop() {
    if (this.phase !== 'intro') return;
    if (this.names.loop) this._play(this.names.loop, true);
    this.phase = 'loop';
    this.playLoopMusic(this.charId);
    if (!this._followOn) this._startFollow();
  },

  confirm() {
    if (!this.active || this.phase === 'loading' || this.phase === 'confirm') return;
    if (!this._followOn) this._startFollow();
    this.phase = 'confirm';
    this._confirmAt = performance.now();
    this._fadeA = 0;
    this.stopAudio();
    this.playEndMusic(this.charId);
    if (this.names.confirm) this._play(this.names.confirm, false);
    this._syncBackBtn();
  },

  exit() {
    if (!this.active || this.phase === 'confirm') return;
    this.stopAudio();
    this.stop();
    if (typeof restart === 'function') restart(true);
    if (typeof openOverlay === 'function') openOverlay('ready');
  },

  _finishRetry() {
    this.stopAudio();
    this.stop();
    if (typeof restart === 'function') restart();
  },

  bail() {
    this.allowOver = true;
    this.stopAudio();
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
    if (typeof VS !== 'undefined' && VS.play && VS.play.camera) {
      if (this._lerp0 != null) VS.play.camera.followLerp = this._lerp0;
      VS.play.camera.followActive = true;
    }
    this._lerp0 = this._zoom0 = null;
    this._followOn = false;
    this.char = null;
    this.attached = [];
    this.phase = 'off';
    this.active = false;
    this.hideWorld = false;
    this._fadeA = 0;
    this.stopAudio();
    this._syncBackBtn(true);
  },

  update(dt) {
    if (!this.active || this.phase === 'loading') return;
    const el = Math.max(0, dt || 0) / 1000;
    const c = this.char;
    if (c && c.animation && typeof c.animation.update === 'function') c.animation.update(el);
    if (this.phase === 'intro') {
      if (!this._followOn && this._curFrame() >= 12) this._startFollow();
      const finished = c && typeof c.finished === 'function' && c.finished();
      if (finished || (performance.now() - this._introAt) >= this._introLimit()) this._goLoop();
    }
    if (this._followOn && typeof VS !== 'undefined' && VS.play && VS.play.camera && typeof VS.play.camera.update === 'function') {
      const bf = this.char;
      if (bf && bf.cameraFocusPoint && VS.play.cameraFollowPoint) {
        VS.play.cameraFollowPoint.setPosition(bf.cameraFocusPoint.x, bf.cameraFocusPoint.y);
      }
      VS.play.camera.update(el);
      if (typeof VS.play.tweens !== 'undefined' && VS.play.tweens && VS.play.tweens.update) VS.play.tweens.update(el);
    }
    if (typeof G !== 'undefined') G.gameTime = (G.gameTime || 0) + (dt || 0);

    if (this.phase === 'confirm') {
      const t = performance.now() - this._confirmAt;
      if (t >= 700) this._fadeA = Math.max(0, Math.min(1, (t - 700) / 2000));
      if (t >= 700 + 2000) this._finishRetry();
    }
  },

  /* mundo: negro + solo el jugador */
  drawWorld(dt, bump, R) {
    const v = typeof worldView === 'function' ? worldView(dt) : { k: 1, vx: 0, vy: 0, zoom: 1 };
    const zoom = (v.zoom || 1) * (bump || 1);
    if (R && R.clear) R.clear();
    const c = this.char || (Scene && Scene.chars && Scene.chars.bf);
    if (c && typeof c.draw === 'function' && typeof worldMatrix === 'function') {
      if (typeof c.update === 'function') c.update();
      const M = this._m || (this._m = [1, 0, 0, 1, 0, 0]);
      const sfx = (c.scroll && c.scroll[0]) || 1, sfy = (c.scroll && c.scroll[1]) || 1;
      c.draw(worldMatrix(v, zoom, sfx, sfy, M), R);
    }
  },

  overlay() {
    if (!this.active) return;
    if (typeof ctx === 'undefined' || typeof W === 'undefined') return;
    if (this._fadeA > 0) {
      ctx.save();
      ctx.setTransform((typeof DPR === 'number' ? DPR : 1), 0, 0, (typeof DPR === 'number' ? DPR : 1), 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,' + this._fadeA + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  },

  /* botón Atrás en táctil (Escape en teclado) */
  _syncBackBtn(forceHide) {
    let b = document.getElementById('deathBack');
    const show = !forceHide && this.active && this.phase !== 'confirm' && this.phase !== 'off';
    const touch = typeof Movil !== 'undefined' ? Movil.isTouch() : ('ontouchstart' in window);
    if (!show || !touch) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement('button');
      b.id = 'deathBack';
      b.type = 'button';
      b.textContent = '← Atrás';
      b.setAttribute('aria-label', 'Volver al menú');
      b.style.cssText = 'position:fixed;z-index:40;left:max(12px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));min-width:112px;min-height:48px;padding:8px 16px;font:900 20px/1 "VCR","Trebuchet MS",sans-serif;color:#000;background:#ffd86b;border:3px solid #000;border-radius:12px;box-shadow:0 4px 0 #000;cursor:pointer;';
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); DeathAnim.exit(); });
      document.body.appendChild(b);
    }
    b.hidden = false;
  },

  _onKey(e) {
    if (!this.active || this.phase === 'loading') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); this.confirm(); }
    else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); this.exit(); }
  },
  _onTap(e) {
    if (!this.active || this.phase === 'loading' || this.phase === 'confirm') return;
    if (e && e.target && e.target.closest && e.target.closest('#overlay, #pausePanel, #deathBack, #iosA2hs, button, a, select, input')) return;
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
          if (kind === 'pause') return;
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

    if (typeof renderWorld === 'function') {
      const prevWorld = renderWorld;
      renderWorld = function (dt, bump, R) {
        if (DeathAnim.active && DeathAnim.hideWorld) return DeathAnim.drawWorld(dt, bump, R);
        return prevWorld(dt, bump, R);
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

    /* precarga en segundo plano para que el sfx suene al instante */
    setTimeout(() => { DeathAnim.ensureSounds('bf').catch(() => {}); }, 0);
  },
};

DeathAnim.install();
