/* =====================================================================
   mods.js — imitación (creada desde 0) de la API del juego para los scripts
   .hxc: PlayState, FlxG, FlxCamera (flash/fade/shake/angle/alpha/zoom),
   FlxTween, FlxTimer, FlxEase, FlxColor, FunkinSound, Paths, FunkinSprite,
   FlxText, Conductor, ModuleHandler, Save/Preferences…
   + registro de eventos (SongEvent), note kinds (NoteKind) y módulos
   + note kinds del juego base (alt, hey, noAnimation, mom, ugh, Blazin…)
   + recursos que piden los scripts (Paths.image/sound/…) con IndexedDB.
   ===================================================================== */
'use strict';

const AVISO_IMITACION = 'Esto no indica que el juego base estos eventos funcionen perfectamente ya que solo es una imitación creada desde 0';

/* ---------- colores (FlxColor = ARGB de 32 bits) ---------- */
const argb = c => { c = Number(c) >>> 0; return { a: ((c >>> 24) & 255) / 255, r: (c >>> 16) & 255, g: (c >>> 8) & 255, b: c & 255 }; };
const cssColor = (c, alphaMul = 1) => { const k = argb(c); return `rgba(${k.r},${k.g},${k.b},${k.a * alphaMul})`; };
const rgbColor = c => { const k = argb(c); return `rgb(${k.r},${k.g},${k.b})`; };

/* ---------- efectos de cámara (camGame / camHUD) ---------- */
const CamFX = {
  game: null, hud: null, frameShake: { game: [0, 0], hud: [0, 0] },
  blank() { return { angle: 0, alpha: 1, visible: true, x: 0, y: 0, flash: null, fade: null, shake: null }; },
  reset() { this.game = this.blank(); this.hud = this.blank(); },
  active(w) { const s = this[w]; return s.angle !== 0 || s.alpha < 1 || !s.visible || s.x !== 0 || s.y !== 0 || !!s.shake; },
  /* una vez por frame: desplazamiento aleatorio del shake (FlxCamera.updateShake) */
  tick() {
    for (const w of ['game', 'hud']) {
      const s = this[w], sh = s.shake; this.frameShake[w] = [0, 0];
      if (!sh) continue;
      if (G.gameTime - sh.t0 >= sh.dur) { s.shake = null; if (sh.done) Mods.safe(sh.done); continue; }
      const amp = sh.i * 1280 * V.s, ax = sh.axes ?? 0x11;
      this.frameShake[w] = [(ax & 0x01) ? rand(-amp, amp) : 0, (ax & 0x10) ? rand(-amp, amp) * 720 / 1280 : 0];
    }
  },
  /* capa = canvas completo ya dibujado; se vuelve a pintar girada/movida/transparente */
  bufs: {},
  snapshot(name = 'game') {
    const b = this.bufs[name] || (this.bufs[name] = document.createElement('canvas')); if (b.width !== cv.width || b.height !== cv.height) { b.width = cv.width; b.height = cv.height; }
    const x = b.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, b.width, b.height); x.drawImage(cv, 0, 0);
    return b;
  },
  drawLayer(img, w) {
    const s = this[w], [sx, sy] = this.frameShake[w];
    if (!s.visible) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(s.alpha, 0, 1);
    ctx.translate(cv.width / 2 + (sx + s.x * V.s) * DPR, cv.height / 2 + (sy + s.y * V.s) * DPR);
    ctx.rotate(s.angle * Math.PI / 180);
    ctx.drawImage(img, -cv.width / 2, -cv.height / 2);
    ctx.restore();
  },
  applyGame() { if (!this.active('game')) return; const b = this.snapshot('game'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); this.drawLayer(b, 'game'); },
  /* flash / fade encima de la cámara */
  overlay(w) {
    const s = this[w], now = G.gameTime;
    ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (s.fade) {
      const f = s.fade, k = f.dur <= 0 ? 1 : clamp((now - f.t0) / f.dur, 0, 1);
      const a = f.fadeIn ? 1 - k : k;
      if (a > 0) { ctx.fillStyle = cssColor(f.color, a); ctx.fillRect(0, 0, W, H); }
      if (k >= 1 && !f.ended) { f.ended = true; if (f.done) Mods.safe(f.done); if (f.fadeIn) s.fade = null; }
    }
    if (s.flash) {
      const f = s.flash, k = f.dur <= 0 ? 1 : clamp((now - f.t0) / f.dur, 0, 1);
      if (k >= 1) { s.flash = null; if (f.done) Mods.safe(f.done); }
      else { ctx.fillStyle = cssColor(f.color, 1 - k); ctx.fillRect(0, 0, W, H); }
    }
    ctx.restore();
  },
};
CamFX.reset();

/* ---------- tweens / timers (tiempo de juego: se congelan en la pausa) ---------- */
/* v3.6.0: textos del mod (.frag/.vert/.txt/.json) leídos al cargarlo → Assets.getText(Paths.frag("x")) síncrono */
const ModText = {
  map: new Map(),
  key(p) { return VFS.norm(String(p || '')).replace(/^(shared|preload|week\d+)\//, ''); },
  put(path, text) { this.map.set(this.key(path), text); },
  keyOf(text) { for (const [k, v] of this.map) if (v === text) return k.split('/').pop().replace(/\.\w+$/, ''); return null; },
  get(p) { const k = this.key(p); if (this.map.has(k)) return this.map.get(k); const b = k.split('/').pop(); for (const [kk, v] of this.map) if (kk.split('/').pop() === b) return v; HX.note(`Assets.getText("${p}"): no está en el mod`); return ''; },
};
const ModRT = { tweens: [], timers: [], sprites: [], sounds: [] };
function getPath(o, p) { const ks = p.split('.'); for (let i = 0; i < ks.length - 1; i++) o = o?.[ks[i]]; return [o, ks[ks.length - 1]]; }
class HxTween {
  constructor(target, props, dur, opts, fn) {
    opts = opts || {};
    Object.assign(this, { target, props: props || {}, dur: Math.max(0, +dur || 0) * 1000, opts, fn, t0: G.gameTime + (+opts.startDelay || 0) * 1000, started: false, active: true, finished: false, percent: 0, from: {}, backward: false, type: +opts.type || 8 });
    this.ease = typeof opts.ease === 'function' ? opts.ease : Ease.linear;
    this.__host = 'FlxTween';
    ModRT.tweens.push(this);
  }
  start() {
    this.started = true;
    if (this.fn) return;
    for (const k of Object.keys(this.props)) { const [o, f] = getPath(this.target, k); this.from[k] = o ? +o[f] || 0 : 0; }
    if (this.opts.onStart) Mods.safe(() => this.opts.onStart(this));
  }
  update() {
    if (!this.active) return true;
    if (G.gameTime < this.t0) return false;
    if (!this.started) this.start();
    let k = this.dur <= 0 ? 1 : clamp((G.gameTime - this.t0) / this.dur, 0, 1);
    this.percent = k;
    let e = this.ease(this.backward ? 1 - k : k);
    if (this.fn) this.fn(this.from0 + (this.to0 - this.from0) * e);
    else for (const [key, to] of Object.entries(this.props)) { const [o, f] = getPath(this.target, key); if (o) o[f] = this.from[key] + (to - this.from[key]) * e; }
    if (this.opts.onUpdate) Mods.safe(() => this.opts.onUpdate(this));
    if (k >= 1) {
      if (this.type & 2 || this.type & 4) { this.t0 = G.gameTime + (+this.opts.loopDelay || 0) * 1000; if (this.type & 4) this.backward = !this.backward; if (this.opts.onComplete) Mods.safe(() => this.opts.onComplete(this)); return false; }
      this.finished = true; this.active = false;
      if (this.opts.onComplete) Mods.safe(() => this.opts.onComplete(this));
      return true;
    }
    return false;
  }
  cancel() { this.active = false; }
  destroy() { this.active = false; }
}
class HxTimer {
  constructor() { this.active = false; this.finished = false; this.loops = 1; this.elapsedLoops = 0; this.time = 0; this.__host = 'FlxTimer'; this.__open = true; }
  start(time = 1, cb = null, loops = 1) {
    Object.assign(this, { time: +time || 0, cb, loops: +loops, elapsedLoops: 0, t0: G.gameTime, active: true, finished: false });
    if (!ModRT.timers.includes(this)) ModRT.timers.push(this);
    return this;
  }
  get timeLeft() { return Math.max(0, this.time - (G.gameTime - this.t0) / 1000); }
  get progress() { return this.time ? clamp((G.gameTime - this.t0) / 1000 / this.time, 0, 1) : 1; }
  update() {
    if (!this.active) return true;
    if ((G.gameTime - this.t0) / 1000 < this.time) return false;
    this.elapsedLoops++; this.t0 = G.gameTime;
    const done = this.loops > 0 && this.elapsedLoops >= this.loops;
    if (done) { this.active = false; this.finished = true; }
    if (typeof this.cb === 'function') Mods.safe(() => this.cb(this));
    return done;
  }
  cancel() { this.active = false; }
  reset(t) { this.t0 = G.gameTime; if (t !== undefined) this.time = t; this.active = true; }
  destroy() { this.active = false; }
}

/* ---------- recursos de los scripts (Paths.*) ---------- */
const ModRes = {
  cache: new Map(),   // clave -> { status: 'loading'|'ok'|'missing', val, from }
  DIRS: { image: ['images', '.png'], sparrow: ['images', '.xml'], sound: ['sounds', '.ogg'], music: ['music', '.ogg'], video: ['videos', '.mp4'], gif: ['images', '.gif'], frag: ['shaders', '.frag'], font: ['fonts', ''], json: ['data', '.json'], file: ['', ''], notestyle: ['data/notestyles', '.json'] },
  /* ruta que verá el usuario (como en el juego) */
  expected(kind, key, lib) {
    const [dir, ext] = this.DIRS[kind] || ['', ''];
    const k = String(key).replace(/^assets\//, '');
    const hasExt = /\.\w{2,4}$/.test(k) && kind !== 'image' && kind !== 'sparrow' ? true : /\.(png|astc|ktx2?|xml|ogg|mp3|mp4|webm|frag|ttf|otf|json)$/i.test(k);
    return (lib && lib !== 'preload' ? lib + '/' : '') + (dir ? dir + '/' : '') + k + (hasExt ? '' : ext);
  },
  candidates(kind, key, lib) {
    const e = this.expected(kind, key, lib), base = this.expected(kind, key, null);
    const out = [e, base, 'shared/' + base, 'preload/' + base];
    if (kind === 'music') { const k = String(key); out.push(`music/${k}/${k}.ogg`, `shared/music/${k}/${k}.ogg`); }
    if (kind === 'sound' || kind === 'music') out.push(...out.map(p => p.replace(/\.ogg$/, '.mp3')));
    if (kind === 'image') out.push(...out.map(p => p.replace(/\.png$/i, '.astc')));   // texturas ASTC de los ports móviles
    if (kind === 'video') out.push(...out.map(p => p.replace(/\.mp4$/i, '.webm')));    // v3.5.0: también .webm
    if (kind === 'gif') out.push(...out.map(p => p.replace(/^images\//, '')));
    return uniq(out);
  },
  /* "assets/shared/images/x.png" -> { kind, key, lib } */
  parsePath(p) {
    p = String(p ?? '');
    const m = /^(?:assets\/)?(?:([\w-]+)[:/])?(images|sounds|music|videos|shaders|fonts|data)\/(.+?)(\.(png|astc|ktx2?|xml|ogg|mp3|wav|mp4|webm|frag|ttf|otf|json))?$/i.exec(p);
    if (m) { const kind = { images: 'image', sounds: 'sound', music: 'music', videos: 'video', shaders: 'frag', fonts: 'font', data: 'json' }[m[2].toLowerCase()]; return { kind, key: m[3] + (kind === 'font' && m[4] ? m[4] : ''), lib: m[1] || null }; }
    return { kind: 'image', key: p.replace(/\.(png|astc|ktx2?)$/i, ''), lib: null };
  },
  keyOf(kind, key, lib) { return kind + '|' + (lib || '') + '|' + key; },
  findUser(kind, key, lib) {
    const cands = this.candidates(kind, key, lib);
    if (kind === 'image') cands.push(...cands.filter(p => /\.png$/i.test(p)).flatMap(p => [p.replace(/\.png$/i, '.ktx'), p.replace(/\.png$/i, '.ktx2')]));
    for (const c of cands) { const f = VFS.get(c); if (f) return f; }
    const e = this.expected(kind, key, lib).split('/').pop();
    if (kind === 'image') { for (const x of ['', '.astc', '.ktx', '.ktx2']) { const f = VFS.byBase(x ? e.replace(/\.png$/i, x) : e); if (f) return f; } return null; }
    if (kind === 'video') return VFS.byBase(e) || VFS.byBase(e.replace(/\.mp4$/i, '.webm'));
    return VFS.byBase(e);
  },
  get(kind, key, lib) { const r = this.cache.get(this.keyOf(kind, key, lib)); if (!r) { this.load(kind, key, lib); return null; } return r.status === 'ok' ? r.val : null; },
  status(kind, key, lib) { const r = this.cache.get(this.keyOf(kind, key, lib)); return r ? r.status : 'none'; },
  forget(kind, key, lib) { this.cache.delete(this.keyOf(kind, key, lib)); },
  load(kind, key, lib) {
    const k = this.keyOf(kind, key, lib);
    if (this.cache.has(k)) { const r = this.cache.get(k); return r.p || Promise.resolve(r.val); }
    const rec = { status: 'loading', val: null, from: null };
    rec.p = (async () => {
      const user = this.findUser(kind, key, lib);
      let blob = null, from = null;
      if (user) { blob = user.blob; from = 'archivo cargado: ' + user.name; }
      else if (location.protocol !== 'file:') {
        const r = await fetchFirstRaw(this.candidates(kind, key, lib), 'blob');
        if (r) { blob = r.data; from = r.path; }
      }
      if (!blob) { rec.status = 'missing'; return null; }
      try {
        rec.val = await this.decode(kind, key, blob, user);
        rec.status = rec.val ? 'ok' : 'missing'; rec.from = from;
      } catch (e) { console.warn('[hxc] recurso no válido', kind, key, e); rec.status = 'missing'; }
      return rec.val;
    })();
    this.cache.set(k, rec);
    return rec.p;
  },
  async decode(kind, key, blob, user) {
    if (kind === 'image') return await decodeImageBlob(blob, String(key));   // PNG/JPG/WebP o ASTC/KTX
    if (kind === 'sound' || kind === 'music') { const c = Sfx.ensureCtx(); if (!c) return null; const ab = await blob.arrayBuffer(); return await new Promise((ok, bad) => { const p = c.decodeAudioData(ab, ok, bad); if (p && p.then) p.then(ok, bad); }); }
    if (kind === 'video' || kind === 'gif') return URL.createObjectURL(blob);
    if (kind === 'font') { const fam = 'hxfont-' + String(key).replace(/\W+/g, '_'); const ff = new FontFace(fam, await blob.arrayBuffer()); await ff.load(); document.fonts.add(ff); return fam; }
    if (kind === 'json' || kind === 'notestyle') return JSON.parse(await blob.text());
    if (kind === 'sparrow') {
      const atlas = parseSparrow(await blob.text());
      const png = this.findUser('image', key, null);
      let img = null;
      if (png) img = await this.decode('image', key, png.blob);
      else { const r = await fetchFirstRaw(this.candidates('image', key, null), 'blob'); if (r) img = await this.decode('image', key, r.data); }
      return img ? { atlas, img } : null;
    }
    return await blob.text();
  },
};

/* ---------- objetos visibles de los scripts ---------- */
const FlxAxes = { X: 0x01, Y: 0x10, XY: 0x11, NONE: 0 };
class HxPoint { constructor(x = 0, y = 0) { this.x = x; this.y = y; this.__host = 'FlxPoint'; } set(x = 0, y = x) { this.x = x; this.y = y; return this; } add(x = 0, y = 0) { this.x += x; this.y += y; return this; } put() {} }
class HxSprite {
  constructor(x = 0, y = 0) {
    Object.assign(this, { x: +x || 0, y: +y || 0, alpha: 1, visible: true, alive: true, exists: true, angle: 0, zIndex: null, antialiasing: true, flipX: false, flipY: false, color: 0xFFFFFFFF, blend: null, img: null, solid: null, cameras: null, behind: false, frameW: 0, frameH: 0, __host: 'FunkinSprite', __open: true });
    this.scale = new HxPoint(1, 1); this.scrollFactor = new HxPoint(1, 1); this.offset = new HxPoint(0, 0); this.origin = new HxPoint(0, 0);
    this.animation = new HxAnim(this);
    this.velocity = new HxPoint(0, 0); this.active = true; this.repeatX = false; this.repeatY = false; this.spacing = new HxPoint(0, 0); this._lt = null;
  }
  loadTexture(key) { return this.loadGraphic(String(key).includes('/') ? key : 'images/' + key + '.png'); }
  /* v3.5.0: velocity de Flixel (coches, nubes, nieblas de FlxBackdrop) */
  tick() { const t = G.gameTime; if (this._lt !== null && this.active !== false) { const dt = Math.min(0.1, (t - this._lt) / 1000); this.x += this.velocity.x * dt; this.y += this.velocity.y * dt; } this._lt = t; }
  get glOk() { return !(this instanceof HxText) && this.blend !== 'add' && !(this.flipX || this.flipY || this.angle); }
  /* dibujo con el destino del render (WebGL o Canvas): imagen / frame Sparrow / color sólido, repetido si es FlxBackdrop */
  renderR(view, R) {
    this.tick();
    if (!this.visible || !this.exists || this.alpha <= 0) return;
    const M = worldMatrix(view.v, view.zoom, this.scrollFactor.x, this.scrollFactor.y, _hxM);
    const fr = this.animation.frame(), w = this.width, h = this.height;
    const c = this.color >>> 0, rgb = (c & 0xFFFFFF) === 0xFFFFFF ? null : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    const a = clamp(this.alpha, 0, 1), smooth = !!this.antialiasing && Optim.s.aa;
    const one = (x, y) => {
      mmul(_hxL2, M, mset(_hxL, 1, 0, 0, 1, x - this.offset.x, y - this.offset.y));
      if (fr) { mmul(_hxL2, _hxL2, mset(_hxL, this.scale.x, 0, 0, this.scale.y, fr.offX || 0, fr.offY || 0)); if (fr.rot) mmul(_hxL2, _hxL2, mset(_hxL, 0, -1, 1, 0, 0, fr.dh)); R.img(fr.img, fr.x, fr.y, fr.w, fr.h, _hxL2, a, smooth, false, rgb); }
      else if (this.img) { const nw = this.img.naturalWidth || this.img.width, nh = this.img.naturalHeight || this.img.height; mmul(_hxL2, _hxL2, mset(_hxL, w / nw, 0, 0, h / nh, 0, 0)); R.img(this.img, 0, 0, nw, nh, _hxL2, a, smooth, false, rgb); }
      else if (this.solid !== null) R.rect(cssColor(this.solid), _hxL2, w, h, a);
    };
    if (this.shader) R.setShader(this.shader);
    try {
      if ((this.repeatX || this.repeatY) && w > 1 && h > 1) {
        // FlxBackdrop: se repite por toda la pantalla visible (en píxeles del canvas)
        const cvs = R.cv || (R.c && R.c.canvas), cw = cvs ? cvs.width : 4096, ch = cvs ? cvs.height : 4096;
        const sx = M[0] || 1, sy = M[3] || 1, tw = w + this.spacing.x, th = h + this.spacing.y;
        const wx0 = (0 - M[4]) / sx, wx1 = (cw - M[4]) / sx, wy0 = (0 - M[5]) / sy, wy1 = (ch - M[5]) / sy;
        const xs = this.repeatX ? [Math.floor((wx0 - this.x) / tw), Math.ceil((wx1 - this.x) / tw)] : [0, 0];
        const ys = this.repeatY ? [Math.floor((wy0 - this.y) / th), Math.ceil((wy1 - this.y) / th)] : [0, 0];
        for (let j = ys[0]; j <= ys[1] && j - ys[0] < 40; j++) for (let i = xs[0]; i <= xs[1] && i - xs[0] < 40; i++) one(this.x + i * tw, this.y + j * th);
      } else one(this.x, this.y);
    } finally { if (this.shader) R.setShader(null); }
  }
  get camera() { return this.cameras ? this.cameras[0] : HOST.camGame; }
  set camera(c) { this.cameras = [c]; }
  get onHud() { return !!(this.cameras && this.cameras.some(c => c && c.__which === 'hud')); }
  get width() { return this.frameW * Math.abs(this.scale.x); }
  set width(v) { if (this.frameW) this.scale.x = v / this.frameW; }
  get height() { return this.frameH * Math.abs(this.scale.y); }
  set height(v) { if (this.frameH) this.scale.y = v / this.frameH; }
  loadGraphic(path) {
    const r = ModRes.parsePath(path); this.res = r;
    const set = img => { if (img) { this.img = img; if (!this.animation.cur) { this.frameW = img.naturalWidth; this.frameH = img.naturalHeight; } } };
    const v = ModRes.get('image', r.key, r.lib); if (v) set(v); else ModRes.load('image', r.key, r.lib).then(set);
    return this;
  }
  loadSparrow(key) { return this.loadFrames('sparrow', key); }
  loadFrames(kind, key) {
    const r = ModRes.parsePath(String(key).includes('/') ? key : 'images/' + key);
    const set = v => { if (v) { this.sheet = v; this.img = v.img; const f = v.atlas.frames[0]; this.frameW = f.fw; this.frameH = f.fh; this.animation.refresh(); } };
    const v = ModRes.get('sparrow', r.key, r.lib); if (v) set(v); else ModRes.load('sparrow', r.key, r.lib).then(set);
    return this;
  }
  set frames(v) { if (v && v.__sparrowKey) this.loadSparrow(v.__sparrowKey); }
  get frames() { return this.sheet || null; }
  makeGraphic(w, h, color = 0xFFFFFFFF) { this.solid = color; this.frameW = +w || 1; this.frameH = +h || 1; return this; }
  makeSolidColor(w, h, color = 0xFFFFFFFF) { return this.makeGraphic(w, h, color); }
  setGraphicSize(w = 0, h = 0) { if (!this.frameW) return; const sx = w > 0 ? w / this.frameW : 0, sy = h > 0 ? h / this.frameH : 0; this.scale.set(sx || sy || 1, sy || sx || 1); }
  updateHitbox() {}
  centerOffsets() {} centerOrigin() {}
  screenCenter(axes = 0x11) { if (axes & 0x01) this.x = (V.w - this.width) / 2; if (axes & 0x10) this.y = (V.h - this.height) / 2; return this; }
  setPosition(x = 0, y = 0) { this.x = x; this.y = y; }
  kill() { this.alive = this.exists = false; } revive() { this.alive = this.exists = true; }
  destroy() { this.kill(); const i = ModRT.sprites.indexOf(this); if (i >= 0) ModRT.sprites.splice(i, 1); }
  getMidpoint() { return new HxPoint(this.x + this.width / 2, this.y + this.height / 2); }
  draw2d() {
    const w = this.width, h = this.height;
    if (this.flipX || this.flipY || this.angle) { ctx.translate(this.x + w / 2, this.y + h / 2); ctx.rotate(this.angle * Math.PI / 180); ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1); ctx.translate(-w / 2, -h / 2); }
    else ctx.translate(this.x, this.y);
    ctx.translate(-this.offset.x, -this.offset.y);
    ctx.imageSmoothingEnabled = !!this.antialiasing;
    const fr = this.animation.frame();
    if (fr) { ctx.scale(this.scale.x, this.scale.y); drawSparrowFrame(ctx, fr, 0, 0); }
    else if (this.img) blitAll(ctx, this.img, 0, 0, w, h);
    else if (this.solid !== null) { ctx.fillStyle = cssColor(this.solid); ctx.fillRect(0, 0, w, h); }
  }
  render(view) {
    if (view) this.tick();
    if (!this.visible || !this.exists || this.alpha <= 0) return;
    ctx.save();
    if (view) { const M = worldMatrix(view.v, view.zoom, this.scrollFactor.x, this.scrollFactor.y); ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); }
    ctx.globalAlpha *= clamp(this.alpha, 0, 1);
    if (this.blend === 'add') ctx.globalCompositeOperation = 'lighter';
    this.draw2d();
    ctx.restore();
  }
}
const _hxM = [1, 0, 0, 1, 0, 0], _hxL = [1, 0, 0, 1, 0, 0], _hxL2 = [1, 0, 0, 1, 0, 0];
class HxAnim {
  constructor(spr) { this.spr = spr; this.anims = new Map(); this.cur = null; this.t0 = 0; this.__host = 'FlxAnimationController'; }
  addByPrefix(name, prefix, fps = 24, loop = true) { this.anims.set(name, { prefix, fps, loop, idx: null }); this.refresh(); }
  addByIndices(name, prefix, idx, post, fps = 24, loop = true) { this.anims.set(name, { prefix, fps, loop, idx }); this.refresh(); }
  add(name, frames, fps = 24, loop = true) { this.anims.set(name, { prefix: '', fps, loop, idx: frames }); }
  refresh() { const sh = this.spr.sheet; if (!sh) return; for (const a of this.anims.values()) a.frames = sparrowFrames(sh.atlas, a.prefix, a.idx, sh.img); }
  play(name, force) { if (!this.anims.has(name)) return; if (this.cur === name && !force && !this.finished) return; this.cur = name; this.t0 = G.gameTime; }
  exists(name) { return this.anims.has(name); }
  get name() { return this.cur; }
  get curAnim() { return this.cur ? { name: this.cur, finished: this.finished, curFrame: this.idx() } : null; }
  idx() { const a = this.anims.get(this.cur); if (!a || !a.frames || !a.frames.length) return 0; const i = Math.floor((G.gameTime - this.t0) / 1000 * a.fps); return a.loop ? i % a.frames.length : Math.min(i, a.frames.length - 1); }
  get finished() { const a = this.anims.get(this.cur); return !a || !a.frames || (!a.loop && (G.gameTime - this.t0) / 1000 * a.fps >= a.frames.length); }
  frame() {
    const sh = this.spr.sheet; if (!sh) return null;
    const a = this.anims.get(this.cur); if (a && a.frames && a.frames.length) return a.frames[this.idx()];
    return Object.assign({}, sh.atlas.frames[0], { img: sh.img });
  }
}
class HxText extends HxSprite {
  constructor(x = 0, y = 0, fieldWidth = 0, text = '', size = 8) {
    super(x, y);
    Object.assign(this, { text: String(text ?? ''), size: +size || 8, fieldWidth: +fieldWidth || 0, font: null, alignment: 'left', borderStyle: 0, borderColor: 0xFF000000, borderSize: 1, italic: false, bold: false, letterSpacing: 0, __host: 'FlxText' });
  }
  setFormat(font = null, size = 8, color = 0xFFFFFFFF, alignment = 'left', borderStyle = 0, borderColor = 0x00000000) {
    Object.assign(this, { font, size: +size || 8, color, alignment: String(alignment || 'left').toLowerCase(), borderStyle, borderColor }); return this;
  }
  setBorderStyle(style, color = 0xFF000000, size = 1) { Object.assign(this, { borderStyle: style, borderColor: color, borderSize: size }); return this; }
  family() {
    if (!this.font) return VCR_FONT;
    const r = ModRes.parsePath(this.font); const key = r.key.replace(/^fonts\//, '');
    if (/^vcr/i.test(key)) return VCR_FONT;
    const fam = ModRes.get('font', key, null); return fam ? `"${fam}", ${VCR_FONT}` : VCR_FONT;
  }
  fontCss() { return `${this.italic ? 'italic ' : ''}${this.bold ? 'bold ' : ''}${this.size}px ${this.family()}`; }
  lines() { return String(this.text).split('\n'); }
  measureW() { ctx.save(); ctx.font = this.fontCss(); const w = Math.max(...this.lines().map(l => ctx.measureText(l).width)); ctx.restore(); return w + 4; }
  get width() { return (this.fieldWidth || this.measureW()) * Math.abs(this.scale.x); }
  set width(v) { this.fieldWidth = v; }
  get height() { return (this.size * 1.2 * this.lines().length + 4) * Math.abs(this.scale.y); }
  set height(v) {}
  draw2d() {
    ctx.translate(this.x, this.y); ctx.scale(this.scale.x, this.scale.y);
    if (this.angle) { ctx.translate(this.width / 2, this.height / 2); ctx.rotate(this.angle * Math.PI / 180); ctx.translate(-this.width / 2, -this.height / 2); }
    ctx.font = this.fontCss(); ctx.textBaseline = 'top';
    const fw = this.fieldWidth || this.measureW(), al = this.alignment === 'center' ? 'center' : this.alignment === 'right' ? 'right' : 'left';
    ctx.textAlign = al; const tx = al === 'center' ? fw / 2 : al === 'right' ? fw - 2 : 2;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (this.letterSpacing || 0) + 'px';
    this.lines().forEach((l, i) => {
      const y = 2 + i * this.size * 1.2;
      if (this.borderStyle && this.borderSize > 0 && argb(this.borderColor).a > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = this.borderSize * 2; ctx.strokeStyle = cssColor(this.borderColor); ctx.strokeText(l, tx, y); }
      ctx.fillStyle = cssColor(this.color); ctx.fillText(l, tx, y);
    });
  }
}
class HxSound {
  constructor(res, volume = 1, looped = false) { Object.assign(this, { res, volume: +volume || 1, looped: !!looped, src: null, playing: false, __host: 'FunkinSound', __open: true }); }
  play(force = true, start = 0) {
    this.stop();
    const go = buf => { const c = Sfx.ctx; if (!buf || !c || c.state !== 'running') return; const src = c.createBufferSource(), g = c.createGain(); src.buffer = buf; src.loop = this.looped; g.gain.value = this.volume; src.connect(g).connect(c.destination); src.start(0, (+start || 0) / 1000); this.src = src; this.gain = g; this.playing = true; src.onended = () => { this.playing = false; }; };
    const r = this.res, v = ModRes.get(r.kind === 'music' ? 'music' : 'sound', r.key, r.lib);
    if (v) go(v); else ModRes.load(r.kind === 'music' ? 'music' : 'sound', r.key, r.lib).then(go);
    if (!ModRT.sounds.includes(this)) ModRT.sounds.push(this);
    return this;
  }
  stop() { if (this.src) { try { this.src.stop(); } catch (e) {} this.src = null; } this.playing = false; }
  pause() { this.stop(); } resume() { this.play(); } destroy() { this.stop(); }
  fadeIn(d, from = 0, to = 1) { this.volume = to; if (this.gain) this.gain.gain.value = to; }
  fadeOut() { this.stop(); }
}

/* ---------- personajes / strumlines vistos desde los scripts ---------- */
const SIGNAL_NOP = { __host: 'FlxSignal', add() {}, remove() {}, addOnce() {}, removeAll() {} };   // los shaders se actualizan solos cada frame
const rgbOf = v => { v = v >>> 0; return (v & 0xFFFFFF) === 0xFFFFFF ? null : [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
const CharW = {
  cache: {},
  get(role) {
    if (this.cache[role]) return this.cache[role];
    const real = () => Scene.chars[role];
    const w = {
      __host: 'BaseCharacter', __open: true, __role: role,
      playAnimation(name, restart = false, ignoreOther = false) {
        const c = real(); name = String(name);
        if (c) { if (c.playEvent(name, true)) return; if (name === 'idle' || name.startsWith('dance')) { c.singUntil = -1e9; c.dance(true); return; } HX.note(`animación "${name}" no existe en ${role} (${c.id})`); return; }
        if (role !== 'gf') { const lane = LANE_DIRS.findIndex(d => name.toUpperCase().includes(d)); if (lane >= 0) sing(role === 'bf' ? G.bf : G.dad, lane); }
      },
      playSingAnimation(dir, miss = false, suffix = '') { const lane = typeof dir === 'number' ? dir : LANE_DIRS.indexOf(String(dir).toUpperCase()); if (lane >= 0) sing(role === 'bf' ? G.bf : role === 'dad' ? G.dad : G.dad, lane, !!miss, 0, { suffix }); },
      dance(force) { const c = real(); if (c) { c.singUntil = -1e9; c.dance(true); } },
      hasAnimation(n) { const c = real(); return !!(c && c.anims.has(n)); },
      getCurrentAnimation() { const c = real(); return c ? c.curName : 'idle'; },
      isAnimationFinished() { const c = real(); return c ? c.finished() : true; },
      get characterId() { const c = real(); return c ? c.id : role; }, get characterName() { const c = real(); return c ? (c.data.name || c.id) : role; },
      get x() { const c = real(); return c ? c.bx : 0; }, set x(v) { const c = real(); if (c) c.bx = +v; },
      get y() { const c = real(); return c ? c.by : 0; }, set y(v) { const c = real(); if (c) c.by = +v; },
      get alpha() { const c = real(); return c ? c.alpha : 1; }, set alpha(v) { const c = real(); if (c) c.alpha = +v; },
      get visible() { const c = real(); return c ? c.visible !== false : true; }, set visible(v) { const c = real(); if (c) c.visible = !!v; },
      get holdTimer() { return 0; }, set holdTimer(v) {},
      get animation() { const c = real(); return { onFrameChange: SIGNAL_NOP, onFinish: SIGNAL_NOP, curAnim: c ? { name: c.curName, finished: c.finished() } : null, play: (n, f) => w.playAnimation(n, f), get finished() { return c ? c.finished() : true; }, getByName: n => (c && c.anims.has(n) ? { name: n } : null), exists: n => !!(c && c.anims.has(n)) }; },
      get cameraFocusPoint() { const p = focusPoint(role) || [0, 0]; return new HxPoint(p[0], p[1]); },
      // v3.5.0: shader del personaje (scripts de escenario) y lo que usan sus rim lights
      get shader() { const c = real(); return c ? c.shader || null : null; }, set shader(v) { const c = real(); if (c) c.shader = v || null; },
      get frame() { const c = real(); return c ? { angle: 0, __host: 'FlxFrame' } : null; },
      get color() { const c = real(); return c && c.rgbInt != null ? c.rgbInt : 0xFFFFFFFF; }, set color(v) { const c = real(); if (c) { c.rgbInt = v >>> 0; c.rgb = rgbOf(v); } },
    };
    return (this.cache[role] = w);
  },
};
const StrumState = { player: null, opponent: null, reset() { for (const s of ['player', 'opponent']) this[s] = { alpha: 1, visible: true, x: 0, y: 0, lane: [1, 1, 1, 1].map(a => ({ alpha: a, visible: true })) }; } };
StrumState.reset();
function strumlineW(side) {
  const st = () => StrumState[side];
  const members = [0, 1, 2, 3].map(i => ({ __host: 'StrumlineNote', __open: true, get alpha() { return st().lane[i].alpha; }, set alpha(v) { st().lane[i].alpha = +v; }, get visible() { return st().lane[i].visible; }, set visible(v) { st().lane[i].visible = !!v; }, get x() { return laneX(side, i); }, set x(v) {}, get y() { return strumCY(side); }, set y(v) {} }));
  return {
    __host: 'Strumline', __open: true,
    get alpha() { return st().alpha; }, set alpha(v) { st().alpha = +v; },
    get visible() { return st().visible; }, set visible(v) { st().visible = !!v; },
    get x() { return st().x; }, set x(v) { st().x = +v; }, get y() { return st().y; }, set y(v) { st().y = +v; },
    get scrollSpeed() { return G.speed; }, set scrollSpeed(v) { G.speed = +v; G.speedTween = null; if (G.speedSide) { G.speedSide.player = G.speedSide.opponent = +v; G.speedTweens = {}; } },
    strumlineNotes: { members, forEach: f => members.forEach(f) }, members,
    getByIndex: i => members[i], getByDirection: d => members[typeof d === 'number' ? d : LANE_DIRS.indexOf(String(d).toUpperCase())],
    forEach: f => members.forEach(f), get isPlayer() { return side === 'player'; },
    fadeInArrows() {}, enterMiniMode() {},
  };
}

/* ---------- cámaras imitadas ---------- */
function camObj(which) {
  const s = () => CamFX[which];
  const o = {
    __host: which === 'game' ? 'camGame' : 'camHUD', __which: which, __open: true,
    get zoom() { return which === 'game' ? Cam.zoom : G.hudZoom; },
    set zoom(v) { v = +v; if (!isFinite(v)) return; if (which === 'game') { Cam.zoomTween = null; Cam.zoom = v; } else G.hudZoom = v; },
    get angle() { return s().angle; }, set angle(v) { s().angle = +v || 0; },
    get scrollAngle() { return s().angle; }, set scrollAngle(v) { s().angle = +v || 0; },
    get alpha() { return s().alpha; }, set alpha(v) { s().alpha = +v; },
    get visible() { return s().visible; }, set visible(v) { s().visible = !!v; },
    get x() { return s().x; }, set x(v) { s().x = +v || 0; }, get y() { return s().y; }, set y(v) { s().y = +v || 0; },
    width: 1280, height: 720, bgColor: 0,
    flash(color = 0xFFFFFFFF, duration = 1, onComplete = null, force = false) { if (!force && s().flash) return; s().flash = { color, t0: G.gameTime, dur: (+duration || 0) * 1000, done: onComplete }; Mods.fx('flash', which); },
    fade(color = 0xFF000000, duration = 1, fadeIn = false, onComplete = null, force = false) { if (!force && s().fade && !s().fade.ended) return; s().fade = { color, t0: G.gameTime, dur: (+duration || 0) * 1000, fadeIn: !!fadeIn, done: onComplete }; Mods.fx('fade', which); },
    shake(intensity = 0.05, duration = 0.5, onComplete = null, force = true, axes = 0x11) { if (!force && s().shake) return; s().shake = { i: +intensity || 0, t0: G.gameTime, dur: (+duration || 0) * 1000, done: onComplete, axes: axes ?? 0x11 }; Mods.fx('shake', which); },
    stopFlash() { s().flash = null; }, stopFade() { s().fade = null; }, stopShake() { s().shake = null; }, stopFX() { s().flash = s().fade = s().shake = null; },
    setFilters(f) { o._filters = f || []; CamFilters.set('hxc:' + which, o._filters); }, set filters(f) { o.setFilters(f); }, get filters() { return o._filters || []; },
    follow() {}, focusOn() {}, snapToTarget() {},
  };
  return o;
}

/* ---------- HOST: lo que ven los scripts ---------- */
/* v3.5.0: prop del escenario visto desde un script (getNamedProp): alpha, x/y, scale.set, color, shader, animation.play */
function propW(p) {
  if (p.__w) return p.__w;
  const scale = { __host: 'FlxPoint', get x() { return p.scale[0]; }, set x(v) { p.scale = [+v, p.scale[1]]; }, get y() { return p.scale[1]; }, set y(v) { p.scale = [p.scale[0], +v]; },
    set(x = 0, y = x) { p.scale = [+x, +y]; } };
  const anim = { __host: 'FlxAnimationController', play: (n, force) => { if (!propPlay(p.name, String(n), !!force)) HX.note(`prop ${p.name}: animación "${n}" no existe`); }, get name() { return p.cur || null; }, exists: n => !!(p.anims && p.anims.has(n)), get curAnim() { return p.cur ? { name: p.cur, finished: p.frames ? propFinished(p) : true } : null; }, onFrameChange: SIGNAL_NOP, onFinish: SIGNAL_NOP };
  return (p.__w = { __host: 'StageProp', __open: true,
    get alpha() { return p.alpha; }, set alpha(v) { p.alpha = +v; }, get visible() { return p.visible !== false; }, set visible(v) { p.visible = !!v; },
    get x() { return p.pos[0]; }, set x(v) { p.pos = [+v, p.pos[1]]; }, get y() { return p.pos[1]; }, set y(v) { p.pos = [p.pos[0], +v]; },
    get zIndex() { return p.z; }, set zIndex(v) { p.z = +v || 0; }, get scale() { return scale; }, get animation() { return anim; },
    get color() { return p.rgbInt ?? 0xFFFFFFFF; }, set color(v) { p.rgbInt = v >>> 0; p.rgb = rgbOf(v); },
    get shader() { return p.shader || null; }, set shader(v) { p.shader = v || null; },
    get frame() { return { angle: 0 }; }, get name() { return p.name; },
    playAnimation(n, force) { anim.play(n, force); }, setPosition(x = 0, y = 0) { p.pos = [+x, +y]; },
  });
}
const HOST = (() => {
  const camGame = camObj('game'), camHUD = camObj('hud');
  const members = { indexOf: o => (o && o.__host === 'Strumline' ? 100 : -1), length: 0, __host: 'members' };
  const addSprite = (o, behind) => { if (o && (o instanceof HxSprite)) { o.behind = !!behind; if (!ModRT.sprites.includes(o)) ModRT.sprites.push(o); } else if (o && !HX.isStub(o)) HX.note('add() de un objeto no imitado'); return o; };
  const removeSprite = o => { const i = ModRT.sprites.indexOf(o); if (i >= 0) ModRT.sprites.splice(i, 1); return o; };
  const stage = {
    __host: 'currentStage', __open: true,
    getBoyfriend: () => CharW.get('bf'), getDad: () => CharW.get('dad'), getGirlfriend: () => CharW.get('gf'),
    getCharacter: id => (['bf', 'dad', 'gf'].find(r => Scene.chars[r] && Scene.chars[r].id === id) ? CharW.get(['bf', 'dad', 'gf'].find(r => Scene.chars[r] && Scene.chars[r].id === id)) : null),
    getNamedProp(name) {
      const p = Scene.stage && Scene.stage.props.find(p => p.name === name);
      if (!p) { HX.note(`getNamedProp("${name}"): no existe en el escenario cargado (se ignora)`); return propW({ name, alpha: 1, pos: [0, 0], scale: [1, 1], z: 0, ghost: true }); }   // en vez de romper el script
      return propW(p);
    },
    add: o => addSprite(o), remove: o => removeSprite(o), insert: (i, o) => addSprite(o), refresh() {},
    get camZoom() { return Cam.stageZoom; },
  };
  const ps = {
    __host: 'PlayState.instance',
    get currentStage() { return stage; }, get camGame() { return camGame; }, get camHUD() { return camHUD; }, get camCutscene() { return camHUD; }, get camOther() { return camHUD; },
    isMinimalMode: false, isPracticeMode: false, isChartingMode: false, playbackRate: 1, startingSong: false, isInCutscene: false, disableKeys: false,
    get isBotPlayMode() { return isBot(); },
    get health() { return G.health; }, set health(v) { v = +v; if (!isFinite(v)) return; G.health = clamp(v, 0, FNF.HEALTH_MAX); if (G.health <= 0 && !isBot()) Mods.pendingDeath = true; },
    get songScore() { return G.score; }, set songScore(v) { G.score = +v || 0; },
    get boyfriend() { return CharW.get('bf'); }, get dad() { return CharW.get('dad'); }, get gf() { return CharW.get('gf'); },
    get playerStrumline() { return strumlineW('player'); }, get opponentStrumline() { return strumlineW('opponent'); },
    get defaultCameraZoom() { return Cam.stageZoom; }, set defaultCameraZoom(v) { Cam.stageZoom = +v || 1; Cam.zoom = Cam.stageZoom; },
    get currentCameraZoom() { return Cam.zoom; }, set currentCameraZoom(v) { Cam.zoomTween = null; Cam.zoom = +v || 1; },
    get stageZoom() { return Cam.stageZoom; },
    get cameraZoomRate() { return Cam.zoomRate; }, set cameraZoomRate(v) { Cam.zoomRate = +v; },
    get cameraBopIntensity() { return Cam.bopIntensity; }, set cameraBopIntensity(v) { Cam.bopIntensity = +v; },
    get cameraBopMultiplier() { return Cam.bop; }, set cameraBopMultiplier(v) { Cam.bop = +v || 1; },
    get hudCameraZoomIntensity() { return Cam.hudIntensity; }, set hudCameraZoomIntensity(v) { Cam.hudIntensity = +v; },
    get cameraFollowPoint() { const o = { __host: 'cameraFollowPoint', get x() { return (Cam.follow || [Cam.x])[0]; }, set x(v) { Cam.followTo(+v, (Cam.follow || [0, Cam.y])[1]); }, get y() { return (Cam.follow || [0, Cam.y])[1]; }, set y(v) { Cam.followTo((Cam.follow || [Cam.x])[0], +v); }, setPosition(x, y) { Cam.followTo(+x, +y); }, set(x, y) { Cam.followTo(+x, +y); } }; return o; },
    get currentChart() { return { songName: G.chart.title, songArtist: G.chart.artist, difficulty: G.chart.difficulty, variation: G.variation || 'default', characters: { player: Scene.chars.bf?.id, opponent: Scene.chars.dad?.id, girlfriend: Scene.chars.gf?.id }, stage: Scene.stage?.id, __host: 'currentChart' }; },
    get currentDifficulty() { return G.chart.difficulty; }, get currentVariation() { return G.variation || 'default'; },
    get vocals() { return { __host: 'vocals', __open: true, volume: 1 }; },
    members, add: o => addSprite(o), insert: (i, o) => addSprite(o, i < 100), remove: o => removeSprite(o),
    get songEvents() { return G.chart.events; },
  };
  const conductor = {
    __host: 'Conductor.instance',
    get songPosition() { return G.songPos; }, get bpm() { return 60000 / Cond.crochet(G.songPos); }, get beatLengthMs() { return Cond.crochet(G.songPos); }, get stepLengthMs() { return Cond.stepMs(G.songPos); },
    get measureLengthMs() { return Cond.crochet(G.songPos) * 4; }, get currentBeat() { return Math.floor(Cond.beat(G.songPos)); }, get currentStep() { return Math.floor(Cond.step(G.songPos)); },
    get currentMeasure() { return Math.floor(Cond.beat(G.songPos) / 4); }, get currentBeatTime() { return Cond.beat(G.songPos); }, get currentStepTime() { return Cond.step(G.songPos); },
    get crochet() { return Cond.crochet(G.songPos); }, get stepCrochet() { return Cond.stepMs(G.songPos); },
  };
  const paths = {
    __host: 'Paths',
    image: (k, lib) => `assets/${lib && lib !== 'preload' ? lib + '/' : ''}images/${k}.png`,
    sound: (k, lib) => `assets/${lib && lib !== 'preload' ? lib + '/' : ''}sounds/${k}.ogg`,
    music: (k, lib) => `assets/${lib && lib !== 'preload' ? lib + '/' : ''}music/${k}.ogg`,
    video: k => `assets/videos/${k}.mp4`, frag: k => `assets/shaders/${k}.frag`, vert: k => `assets/shaders/${k}.vert`,
    font: k => `assets/fonts/${k}`, json: (k, lib) => `assets/data/${k}.json`, file: k => `assets/${k}`, txt: k => `assets/data/${k}.txt`,
    getSparrowAtlas: (k, lib) => ({ __sparrowKey: k, __host: 'FlxAtlasFrames' }), getPackerAtlas: k => ({ __sparrowKey: k, __host: 'FlxAtlasFrames' }),
    inst: () => 'assets/songs/Inst.ogg', voices: () => 'assets/songs/Voices.ogg',
  };
  const playRes = (path, volume = 1, looped = false) => { const r = typeof path === 'object' && path && path.__sound ? path.__sound : ModRes.parsePath(path); const s = new HxSound(r.kind === 'music' ? r : Object.assign({}, r, { kind: 'sound' }), volume, looped); return s; };
  const funkinSound = {
    __host: 'FunkinSound',
    playOnce: (path, volume = 1) => playRes(path, volume).play(),
    load: (path, volume = 1, looped = false, autoDestroy, autoPlay) => { const s = playRes(path, volume, looped); if (autoPlay) s.play(); return s; },
    playMusic: () => { HX.note('FunkinSound.playMusic no se imita'); return null; },
  };
  const rnd = { __host: 'FlxG.random', int: (a = 0, b = 2147483647) => randInt(a, b), float: (a = 0, b = 1) => rand(a, b), bool: (c = 50) => Math.random() * 100 < c, sign: () => (Math.random() < 0.5 ? -1 : 1), getObject: a => a[randInt(0, a.length - 1)] };
  const flxg = {
    __host: 'FlxG', get camera() { return camGame; }, set camera(v) {}, get width() { return V.w; }, get height() { return V.h; }, initialWidth: 1280, initialHeight: 720,
    get elapsed() { return Mods.elapsed; }, timeScale: 1, random: rnd,
    sound: { __host: 'FlxG.sound', __open: true, play: (p, v = 1, looped = false) => playRes(p, v, looped).play(), load: (p, v = 1, looped = false) => playRes(p, v, looped), playMusic: () => HX.note('FlxG.sound.playMusic no se imita'), get music() { return { __host: 'FlxG.sound.music', __open: true, volume: 1, time: G.songPos, playing: Music.playing }; }, volume: 1, muted: false },
    cameras: { __host: 'FlxG.cameras', add: c => c, remove() {}, list: [camGame, camHUD], reset() {} },
    keys: HX.stub('FlxG.keys', true), mouse: HX.stub('FlxG.mouse', true), signals: HX.stub('FlxG.signals', true), save: HX.stub('FlxG.save', true), state: HX.stub('FlxG.state', true),
    get game() { return HX.stub('FlxG.game'); },
  };
  const tween = {
    __host: 'FlxTween',
    tween: (t, props, dur = 1, opts) => (t == null ? null : new HxTween(t, props, dur, opts)),
    num: (from, to, dur = 1, opts, fn) => { const tw = new HxTween(null, {}, dur, opts, typeof fn === 'function' ? fn : () => {}); tw.from0 = +from; tw.to0 = +to; return tw; },
    angle: (t, from, to, dur = 1, opts) => { if (t) t.angle = from; return t ? new HxTween(t, { angle: to }, dur, opts) : null; },
    color: (t, dur = 1, c1, c2, opts) => { if (!t) return null; const a = argb(c1), b = argb(c2); const tw = new HxTween(null, {}, dur, opts, k => { const m = (x, y) => Math.round(x + (y - x) * k); t.color = ((Math.round((a.a + (b.a - a.a) * k) * 255) << 24) | (m(a.r, b.r) << 16) | (m(a.g, b.g) << 8) | m(a.b, b.b)) >>> 0; }); tw.from0 = 0; tw.to0 = 1; return tw; },
    cancelTweensOf: t => ModRT.tweens.forEach(tw => { if (tw.target === t) tw.cancel(); }),
    completeTweensOf: t => ModRT.tweens.forEach(tw => { if (tw.target === t) { tw.t0 = -1e12; tw.update(); } }),
    globalManager: { __host: 'FlxTween.globalManager', cancelTweensOf: t => tween.cancelTweensOf(t), completeTweensOf: t => tween.completeTweensOf(t), clear: () => ModRT.tweens.forEach(t => t.cancel()) },
    PERSIST: 1, LOOPING: 2, PINGPONG: 4, ONESHOT: 8, BACKWARD: 16,
  };
  const ease = Object.assign({ __host: 'FlxEase' }, Object.fromEntries(Object.entries(Ease).filter(([k, v]) => typeof v === 'function' && k !== 'get')));
  const COLORS = { WHITE: 0xFFFFFFFF, BLACK: 0xFF000000, RED: 0xFFFF0000, GREEN: 0xFF008000, LIME: 0xFF00FF00, BLUE: 0xFF0000FF, YELLOW: 0xFFFFFF00, CYAN: 0xFF00FFFF, MAGENTA: 0xFFFF00FF, ORANGE: 0xFFFFA500, PURPLE: 0xFF800080, PINK: 0xFFFFC0CB, GRAY: 0xFF808080, BROWN: 0xFF8B4513, TRANSPARENT: 0x00000000 };
  const flxColor = Object.assign({ __host: 'FlxColor' }, COLORS, {
    fromRGB: (r, g, b, a = 255) => (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0,
    fromRGBFloat: (r, g, b, a = 1) => flxColor.fromRGB(r * 255, g * 255, b * 255, a * 255),
    fromInt: v => v >>> 0,
    fromString: s => { s = String(s).trim(); const n = COLORS[s.toUpperCase()]; if (n !== undefined) return n; const h = s.replace(/^(#|0x)/i, ''); if (/^[0-9a-f]{6}$/i.test(h)) return (0xFF000000 | parseInt(h, 16)) >>> 0; if (/^[0-9a-f]{8}$/i.test(h)) return parseInt(h, 16) >>> 0; return null; },
    fromHSB: (h, s, b, a = 1) => { const f = n => { const k = (n + h / 60) % 6; return b - b * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return flxColor.fromRGBFloat(f(5), f(3), f(1), a); },
    interpolate: (c1, c2, f = 0.5) => { const a = argb(c1), b = argb(c2), m = (x, y) => Math.round(x + (y - x) * f); return flxColor.fromRGB(m(a.r, b.r), m(a.g, b.g), m(a.b, b.b), Math.round((a.a + (b.a - a.a) * f) * 255)); },
  });
  const save = HX.stub('Save', true);   // opciones de mods: se asumen activadas
  const prefs = { __host: 'Preferences', flashingLights: true, get downscroll() { return Opts.isDown(); }, naughtyness: true, zoomCamera: true, debugDisplay: false, subtitles: false, framerate: 60, autoPause: true, strumlineBackgroundOpacity: 0, get middlescroll() { return Opts.middlescroll; } };
  const moduleHandler = {
    __host: 'ModuleHandler',
    getModule: id => { const m = Mods.modules.get(String(id)); if (!m) { HX.note(`ModuleHandler.getModule("${id}"): no está cargado (sube su .hxc)`); return null; } return m.inst; },
    callEvent: () => null, getModuleIds: () => [...Mods.modules.keys()],
  };
  const reflect = {
    __host: 'Reflect',
    field: (o, f) => (o == null ? null : (o instanceof HX.HxMap ? o.get(f) : (o[f] ?? null))), getProperty: (o, f) => (o == null ? null : (o[f] ?? null)),
    setField: (o, f, v) => { if (o != null) o[f] = v; }, setProperty: (o, f, v) => { if (o != null) o[f] = v; },
    hasField: (o, f) => o != null && f in Object(o), fields: o => (o ? Object.keys(o) : []), isFunction: f => typeof f === 'function', callMethod: (o, f, a) => (typeof f === 'function' ? f(...(a || [])) : null),
    deleteField: (o, f) => o != null && delete o[f], copy: o => Object.assign({}, o), isObject: o => o !== null && typeof o === 'object',
  };
  const reflectUtil = { __host: 'ReflectUtil', getAnonymousField: (o, f) => reflect.field(o, f), setAnonymousField: (o, f, v) => reflect.setField(o, f, v), getClassFields: o => Object.keys(o || {}), getAnonymousFieldsOf: o => Object.keys(o || {}), callMethod: reflect.callMethod, getProperty: reflect.getProperty, setProperty: reflect.setProperty, hasAnonymousField: reflect.hasField };
  const std = {
    __host: 'Std', int: v => (v == null ? 0 : Math.trunc(+v)), parseInt: s => { const n = parseInt(s); return isNaN(n) ? null : n; }, parseFloat: s => parseFloat(s),
    string: v => (v === null || v === undefined ? 'null' : String(v)), isOfType: (v, t) => v !== null && v !== undefined, is: (v, t) => v !== null && v !== undefined, random: n => randInt(0, Math.max(0, (n | 0) - 1)), downcast: v => v,
  };
  const hxMath = Object.assign({ __host: 'Math' }, { PI: Math.PI, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, min: Math.min, max: Math.max, random: Math.random, fround: v => v, ffloor: Math.floor, fceil: Math.ceil, isNaN: isNaN, isFinite: isFinite });
  const flxMath = { __host: 'FlxMath', lerp: (a, b, t) => a + (b - a) * t, bound: (v, a, b) => clamp(v, a ?? -Infinity, b ?? Infinity), remapToRange: (v, a1, b1, a2, b2) => a2 + (v - a1) * (b2 - a2) / (b1 - a1), roundDecimal: (v, d) => Math.round(v * 10 ** d) / 10 ** d, maxInt: Math.max, minInt: Math.min, absInt: Math.abs, signOf: Math.sign, isEven: n => n % 2 === 0, isOdd: n => n % 2 !== 0 };
  const strTools = { __host: 'StringTools', replace: (s, a, b) => String(s).split(a).join(b), startsWith: (s, p) => String(s).startsWith(p), endsWith: (s, p) => String(s).endsWith(p), trim: s => String(s).trim(), ltrim: s => String(s).trimStart(), rtrim: s => String(s).trimEnd(), contains: (s, p) => String(s).includes(p), lpad: (s, c, l) => String(s).padStart(l, c), rpad: (s, c, l) => String(s).padEnd(l, c), hex: (n, d) => (n >>> 0).toString(16).toUpperCase().padStart(d || 0, '0'), isSpace: (s, i) => /\s/.test(String(s)[i] || ''), urlEncode: encodeURIComponent, urlDecode: decodeURIComponent, htmlEscape: escHtml };
  const lambda = { __host: 'Lambda', has: (a, x) => [...(a || [])].includes(x), exists: (a, f) => [...(a || [])].some(f), filter: (a, f) => [...(a || [])].filter(f), map: (a, f) => [...(a || [])].map(f), count: (a, f) => (f ? [...(a || [])].filter(f).length : [...(a || [])].length), array: a => [...(a || [])], find: (a, f) => [...(a || [])].find(f) ?? null, foreach: (a, f) => [...(a || [])].every(f), iter: (a, f) => [...(a || [])].forEach(f), indexOf: (a, x) => [...(a || [])].indexOf(x), empty: a => ![...(a || [])].length, fold: (a, f, first) => [...(a || [])].reduce((acc, x) => f(x, acc), first) };
  const songEvent = { __host: 'SongEvent', DEFAULT_EASE: 'linear', DEFAULT_EASE_DIR: 'In', EASE_TYPE_DIR_REGEX: new HX.EReg('(In|Out|InOut)$', '') };
  const alert = { __host: 'PolymodErrorHandler', showAlert: (t, m) => { HX.note(`alerta: ${t}: ${m}`); toast(`${t}: ${m}`, 4000); }, error: (t, m) => HX.note(`error: ${m || t}`) };
  const G_ = {
    PlayState: { __host: 'PlayState', get instance() { return G.chart ? ps : null; } },
    Conductor: { __host: 'Conductor', get instance() { return conductor; } },
    FlxG: flxg, FlxTween: tween, FlxEase: ease, FlxColor: flxColor, FlxAxes, FlxTimer: { __host: 'FlxTimer', wait: (t, cb) => new HxTimer().start(t, () => cb()), loop: (t, cb, n) => new HxTimer().start(t, tm => cb(tm.elapsedLoops), n), globalManager: { clear: () => ModRT.timers.forEach(t => t.cancel()) } },
    FlxTweenType: { PERSIST: 1, LOOPING: 2, PINGPONG: 4, ONESHOT: 8, BACKWARD: 16 },
    FlxTextBorderStyle: { NONE: 0, SHADOW: 1, OUTLINE: 2, OUTLINE_FAST: 3 }, FlxTextAlign: { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFY: 'left' },
    BlendMode: { ADD: 'add', NORMAL: null, MULTIPLY: 'multiply', SCREEN: 'screen' },
    FlxPoint: { __host: 'FlxPoint', get: (x, y) => new HxPoint(x, y), weak: (x, y) => new HxPoint(x, y) },
    FunkinSound: funkinSound, Paths: paths, ModuleHandler: moduleHandler, Save: { __host: 'Save', get instance() { return save; } }, Preferences: prefs,
    PolymodErrorHandler: alert, Reflect: reflect, ReflectUtil: reflectUtil, Std: std, Math: hxMath, FlxMath: flxMath, StringTools: strTools, Lambda: lambda, SongEvent: songEvent,
    FunkinSprite: { __host: 'FunkinSprite', create: (x = 0, y = 0, key = null) => { const s = new HxSprite(x, y); if (key) s.loadGraphic(String(key).includes('/') ? key : paths.image(key)); return s; }, createSparrow: (x, y, key) => new HxSprite(x, y).loadSparrow(key), createTextureAtlas: (x, y, key) => { HX.note('FunkinSprite.createTextureAtlas (Animate Atlas en scripts) no se imita'); return new HxSprite(x, y); } },
    FunkinMemory: HX.stub('FunkinMemory', true), Highscore: HX.stub('Highscore', true), Assets: { __host: 'Assets', exists: p => { const r = ModRes.parsePath(p); return ModRes.status(r.kind, r.key, r.lib) === 'ok' || !!ModRes.findUser(r.kind, r.key, r.lib); }, getText: p => ModText.get(p) }, OpenFlAssets: null,
    trace: (...a) => console.debug('[hxc trace]', ...a),
    Json: { __host: 'Json', parse: s => JSON.parse(s), stringify: (o, r, sp) => JSON.stringify(o, null, sp) },
    Type: { __host: 'Type', getClassName: c => c?.name || '', resolveClass: n => null, typeof: v => typeof v },
    NoteDirection: { LEFT: 0, DOWN: 1, UP: 2, RIGHT: 3 }, NoteKindParamType: { STRING: 'String', INT: 'Int', FLOAT: 'Float' },
    Constants: { __host: 'Constants', DEFAULT_CHARACTER: 'bf', DEFAULT_STAGE: 'mainStage', COLOR_HEALTH_BAR_RED: 0xFFFF0000, COLOR_HEALTH_BAR_GREEN: 0xFF66FF33, STRUMLINE_X_OFFSET: 48, STRUMLINE_Y_OFFSET: 24 },
    HealthIcon: HX.stub('HealthIcon'), VideoCutscene: { __host: 'VideoCutscene', play: p => { Mods.playVideo(p); }, isPlaying: () => false, finishVideo: () => {} },
  };
  G_.OpenFlAssets = G_.Assets;
  G_.CharacterType = { __host: 'CharacterType', BF: 'BF', DAD: 'DAD', GF: 'GF', OTHER: 'OTHER' };
  G_.HapticUtil = { __host: 'HapticUtil', vibrate() {}, increasingVibrate() {}, hapticsAvailable: false };
  const CTORS = {
    FlxTimer: () => new HxTimer(), FlxText: a => new HxText(...a), FunkinSprite: a => new HxSprite(...a), FlxSprite: a => new HxSprite(...a), FlxPoint: a => new HxPoint(...a),
    Map: () => new HX.HxMap(), StringMap: () => new HX.HxMap(), IntMap: () => new HX.HxMap(), ObjectMap: () => new HX.HxMap(), EReg: a => new HX.EReg(a[0], a[1]),
    FlxSound: () => new HxSound({ kind: 'sound', key: '' }), FlxTypedGroup: () => Mods.group(), FlxGroup: () => Mods.group(), FlxSpriteGroup: () => Mods.group(), FlxTypedSpriteGroup: () => Mods.group(),
    Date: () => new Date(), FlxObject: a => new HxSprite(...a),
    // v3.5.0: escenarios
    AdjustColorShader: () => new AdjustColorShaderJS(), DropShadowShader: () => new DropShadowShaderJS(),
    FlxRuntimeShader: a => { const sh = new SprShader(null, 'FlxRuntimeShader'); const src = String(a[0] ?? ''); if (/void\s+main/.test(src)) { sh.src = src; sh.fragKey = ModText.keyOf(src); } else if (src) sh.fromKey(src.split('/').pop().replace(/\.frag$/, '')); else sh.error = 'sin código (Assets.getText no encontró el .frag)'; return sh; },
    FlxBackdrop: a => { const s = new HxSprite(); const g = a[0]; if (g) s.loadGraphic(typeof g === 'string' ? g : (g.__path || '')); const ax = a[1] ?? 0x11; s.repeatX = !!(ax & 0x01); s.repeatY = !!(ax & 0x10); s.spacing.set(+a[2] || 0, +a[3] || 0); s.__host = 'FlxBackdrop'; return s; },
    Sequence: a => new HxSequence(a[0]),
    ShaderFilter: a => ({ __host: 'ShaderFilter', __open: true, shader: a[0] || null }),
  };
  for (const [cls, key] of Object.entries(SPR_CLASS_FRAG)) CTORS[cls] = () => new SprShader(null, cls).fromKey(key);
  return {
    camGame, camHUD, ps,
    global(n) { return n in G_ ? G_[n] : undefined; },
    construct(base, args, full) { if (CTORS[base]) return CTORS[base](args); HX.note(`new ${full}() no se imita`); return HX.stub('new ' + base); },
    findClass(n) { return Mods.classes.get(n) || null; },
    nativeSuper(base, obj, a) {
      if (/SongEvent$/.test(base)) { obj.id = a[0]; }
      else if (/NoteKind$/.test(base)) { obj.noteKind = a[0]; obj.description = a[1] ?? ''; obj.noteStyleId = a[2] ?? null; obj.params = a[3] ?? []; if (a.length > 4) obj.noAnim = !!a[4]; if (a.length > 5) obj.suffix = a[5] ?? ''; }
      else if (/Module$/.test(base)) { obj.moduleId = a[0]; obj.priority = a[1] ?? 1000; if (!('active' in obj)) obj.active = true; }
      else if (/Stage$/.test(base)) { obj.stageId = a[0]; }
      else if (/Sprite$|FlxText$/.test(base)) { const s = base === 'FlxText' ? new HxText(...a) : new HxSprite(...a); for (const k of Object.keys(s)) if (!(k in obj)) obj[k] = s[k]; }
    },
    nativeMember(base, obj, n) {
      if (n === 'scriptCall') return (name, args) => obj.__hxc.script.callMethod(obj, name, args || []) ?? null;
      if (n === 'scriptGet') return name => obj[name] ?? null;
      if (n === 'scriptSet') return (name, v) => { obj[name] = v; };
      if (/SongEvent$/.test(base)) { if (n === 'getTitle') return () => obj.id; if (n === 'getEventSchema') return () => []; if (n === 'handleEvent' || n === 'precacheEvent') return () => null; }
      if (/Stage$/.test(base)) { const v = StageRT.member(obj, n); if (v !== undefined) return v; }
      if (/^on[A-Z]/.test(n)) return () => null;
      return undefined;
    },
  };
})();

/* ---------- note kinds del juego base ---------- */
const BLAZIN = {
  punchhigh: [['punchHigh1', 'punchHigh2', 'punchHigh'], ['hitHigh']], punchhighdodged: [['punchHigh1', 'punchHigh2', 'punchHigh'], ['dodge']], punchhighblocked: [['punchHigh1', 'punchHigh2', 'punchHigh'], ['block']], punchhighspin: [['punchHigh1', 'punchHigh2', 'punchHigh'], ['hitSpin']],
  punchlow: [['punchLow1', 'punchLow2', 'punchLow'], ['hitLow']], punchlowdodged: [['punchLow1', 'punchLow2', 'punchLow'], ['dodge']], punchlowblocked: [['punchLow1', 'punchLow2', 'punchLow'], ['block']], punchlowspin: [['punchLow1', 'punchLow2', 'punchLow'], ['hitSpin']],
  blockhigh: [['block'], ['punchHigh1', 'punchHigh2', 'punchHigh']], blocklow: [['block'], ['punchLow1', 'punchLow2', 'punchLow']], blockspin: [['block'], ['punchHigh1', 'punchHigh2', 'punchHigh']],
  dodgelow: [['dodge'], ['punchLow1', 'punchLow2', 'punchLow']], dodgespin: [['dodge'], ['punchHigh1', 'punchHigh2', 'punchHigh']],
  hithigh: [['hitHigh'], ['punchHigh1', 'punchHigh2', 'punchHigh']], hitlow: [['hitLow'], ['punchLow1', 'punchLow2', 'punchLow']], hitspin: [['hitSpin'], ['punchHigh1', 'punchHigh2', 'punchHigh']],
  picouppercutprep: [['uppercutPrep'], ['idle']], picouppercut: [['uppercut'], ['uppercutHit']], darnelluppercutprep: [['idle'], ['uppercutPrep']], darnelluppercut: [['uppercutHit'], ['uppercut']],
  idle: [['idle'], ['idle']], fakeout: [['fakeout'], ['idle']], reversefakeout: [['idle'], ['fakeout']], taunt: [['taunt'], ['idle']], tauntforce: [['taunt'], ['idle']],
};
const NoteKinds = {
  /* id -> comportamiento del juego base (imitado) */
  builtin(k) {
    if (k === '' || k == null || k === 'normal' || k === 'default') return { id: '' };
    if (/^(alt|-alt|Alt Animation|altAnimation|mom)$/i.test(k)) return { id: k, suffix: '-alt' };
    if (/^(noAnimation|No Animation|noanim|no-animation)$/i.test(k)) return { id: k, noAnim: true };
    if (/^(hey|Hey!)$/i.test(k)) return { id: k, special: ['hey', 'cheer'] };
    if (k === 'hehPrettyGood') return { id: k, special: ['hehPrettyGood'] };
    if (k === 'ugh') return { id: k, special: ['ugh'] };
    if (k === 'censor') return { id: k, suffix: '-censor' };
    if (k === 'GF Sing' || k === 'gf') return { id: k, gf: true };
    if (/^(hurt|Hurt Note|hurtNote)$/i.test(k)) return { id: k, hurt: true, hitHealth: -0.3 };   // como Psych: tocarla quita vida, el bot la evita y dejarla pasar no es fallo
    const m = /^weekend-1-(\w+)$/.exec(k); if (m && BLAZIN[m[1]]) return { id: k, blazin: BLAZIN[m[1]], noAnim: true };
    return null;
  },
  known(k) { return !!(this.builtin(k) || Mods.kinds.has(k)); },
  isHurt(k) { const d = this.get(k); return !!(d && d.hurt); },
  get(k) { return Mods.kinds.get(k) || this.builtin(k); },
};

/* ---------- registro de scripts ---------- */
const Mods = {
  scripts: new Map(), events: new Map(), kinds: new Map(), modules: new Map(), stages: new Map(), classes: new Map(), elapsed: 0, pendingDeath: false, fxLog: [], db: null, ready: null,
  BUILTIN_EVENTS: ['FocusCamera', 'ZoomCamera', 'SetCameraBop', 'PlayAnimation', 'SetHealthIcon', 'ScrollSpeed'],
  safe(f) { try { return f(); } catch (e) { console.warn('[hxc] callback', e); HX.note('error en callback: ' + e.message); } },
  fx(kind, which) { this.fxLog.push(`${kind}:${which}@${Math.round(G.songPos)}`); if (this.fxLog.length > 40) this.fxLog.shift(); },
  group() { const members = []; return { __host: 'FlxGroup', __open: true, members, add: o => { members.push(o); HOST.ps.add(o); return o; }, remove: o => { const i = members.indexOf(o); if (i >= 0) members.splice(i, 1); HOST.ps.remove(o); return o; }, forEach: f => members.forEach(f), forEachAlive: f => members.filter(m => m.alive !== false).forEach(f), get length() { return members.length; }, clear: () => { members.forEach(m => HOST.ps.remove(m)); members.length = 0; }, kill() {}, destroy() {} }; },
  /* carga un .hxc: clases → eventos / note kinds / módulos */
  load(name, text) {
    const old = this.scripts.get(name);
    if (old) this.unregister(old);
    const script = new HX.Script(name, text, HOST);
    const rec = { name, text, script, events: [], kinds: [], modules: [], others: [], analysis: HX.analyze(text) };
    for (const c of script.classes.values()) { c.__hxcls = true; this.classes.set(c.name, c); }
    for (const c of script.classes.values()) {
      const base = script.nativeBase(c);
      const hasChildren = [...script.classes.values()].some(x => x !== c && (x.parent || '').split('.').pop() === c.name);
      if (/SongEvent$/.test(base)) {
        const inst = script.instantiate(c, []);
        if (!inst.id && hasChildren) continue;
        const id = String(inst.id || c.name);
        const title = script.callMethod(inst, 'getTitle', []) || id;
        let schema = null; try { schema = script.callMethod(inst, 'getEventSchema', []); } catch (e) {}
        this.events.set(id, { id, inst, script, cls: c, title, schema, file: name });
        rec.events.push(id);
      } else if (/NoteKind$/.test(base)) {
        const inst = script.instantiate(c, []);
        if (!inst.noteKind && hasChildren) continue;
        const id = String(inst.noteKind || c.name);
        const hitM = script.findMethod(c, 'onNoteHit'), src = hitM ? text.slice(0) : '';
        const hitBody = (() => { const m = new RegExp('function\\s+onNoteHit[\\s\\S]*?\\n\\s*}\\s*\\n', 'm').exec(text); return m ? m[0] : ''; })();
        const hurt = /hurt|mine|damage|death|kill/i.test(id) || /health\s*(-=|=\s*0\b)|healthChange\s*=\s*-|\.health\s*-=/.test(hitBody);
        this.kinds.set(id, { id, inst, script, cls: c, styleId: inst.noteStyleId || null, desc: inst.description || id, noAnim: !!inst.noAnim, suffix: inst.suffix || '', hurt, scripted: true, file: name });
        rec.kinds.push(id);
        void src;
        if (inst.noteStyleId) NoteStyles.request(inst.noteStyleId);
      } else if (/Module$/.test(base)) {
        const inst = script.instantiate(c, []);
        const id = String(inst.moduleId || c.name);
        this.modules.set(id, { id, inst, script, cls: c, file: name });
        rec.modules.push(id);
        if (script.findMethod(c, 'onCreate')) script.callMethod(inst, 'onCreate', [{}]);
      } else if (/Stage$/.test(base)) {
        // v3.5.0: script de escenario → se ejecuta solo con su escenario (StageRT)
        let id = c.name; try { const inst = script.instantiate(c, []); if (!inst.stageId && hasChildren) continue; id = String(inst.stageId || c.name); } catch (e) { console.warn('[hxc] escenario', e); }
        this.stages.set(id, { id, script, cls: c, file: name }); rec.stages = (rec.stages || []).concat(id); rec.modules.push('escenario ' + id);
        StageRT.key = null;
      } else rec.others.push(`${c.name}${c.parent ? ' extends ' + c.parent : ''}`);
    }
    this.scripts.set(name, rec);
    // precarga de recursos con nombre fijo
    for (const r of rec.analysis.res) ModRes.load(r.kind, r.key, r.lib);
    return rec;
  },
  unregister(rec) {
    for (const id of rec.events) this.events.delete(id);
    for (const id of rec.kinds) this.kinds.delete(id);
    for (const id of rec.modules) this.modules.delete(id);
    for (const id of rec.stages || []) { this.stages.delete(id); StageRT.key = null; }
    for (const c of rec.script.classes.keys()) this.classes.delete(c);
    this.scripts.delete(rec.name);
  },
  /* evento del chart → handleEvent(data) */
  fireEvent(ev) {
    const e = this.events.get(ev.e); if (!e) return false;
    const v = ev.v && typeof ev.v === 'object' ? ev.v : {};
    const get = (k, f) => { const x = v[k]; return x === undefined || x === null ? null : f(x); };
    const data = {
      __host: 'SongEventData', eventKind: ev.e, time: ev.t, value: ev.v ?? null, kind: ev.e,
      getFloat: k => get(k, x => { const n = parseFloat(x); return isNaN(n) ? null : n; }), getInt: k => get(k, x => { const n = parseInt(x); return isNaN(n) ? null : n; }),
      getBool: k => get(k, x => x === true || x === 'true' || x === 1), getString: k => get(k, x => String(x)), getDynamic: k => get(k, x => x),
      getArray: k => get(k, x => (Array.isArray(x) ? x : null)), getBoolArray: k => get(k, x => x), getStringArray: k => get(k, x => x), getIntArray: k => get(k, x => x), getFloatArray: k => get(k, x => x),
      getHandleEvent: () => true, valueAsStruct: () => v,
    };
    e.script.callMethod(e.inst, 'handleEvent', [data]);
    return true;
  },
  /* ganchos (onSongRetry, onBeatHit, onUpdate…) a módulos y eventos que los definen */
  hook(name, ev) {
    for (const coll of [this.modules, this.events]) for (const e of coll.values()) {
      if (e.inst.active === false && coll === this.modules) continue;
      if (e.script.findMethod(e.cls, name)) e.script.callMethod(e.inst, name, [ev || {}]);
    }
    StageRT.call(name, ev);
  },
  get hasHooks() { return this.modules.size > 0 || !!StageRT.cur; },
  update(dt) {
    this.elapsed = dt / 1000;
    ModRT.tweens = ModRT.tweens.filter(t => !t.update());
    ModRT.timers = ModRT.timers.filter(t => !t.update());
    StageRT.tick(); VideoSync.tick();
    if (this.hasHooks) this.hook('onUpdate', { elapsed: this.elapsed, __host: 'UpdateScriptEvent' });
    if (this.pendingDeath) { this.pendingDeath = false; if (G.health <= 0 && !isBot()) openOverlay('over'); }
  },
  /* reiniciar / buscar: se borra todo lo que crearon los scripts */
  resetRuntime(retry) {
    ModRT.tweens.length = 0; ModRT.timers.length = 0; ModRT.sprites.length = 0; StageRT.key = null; VideoSync.clear(); CamFilters.clear('hxc:');
    for (const s of ModRT.sounds) s.stop(); ModRT.sounds.length = 0;
    CamFX.reset(); StrumState.reset(); CharW.cache = {};
    for (const c of Object.values(Scene.chars)) if (c) { c.visible = true; }
    if (retry) this.hook('onSongRetry', {});
  },
  /* notas: ganchos del NoteKind */
  noteW(n) {
    if (n.__w) return n.__w;
    const p = Array.isArray(n.params) ? n.params : [];
    const par = k => { const x = p.find(q => q && (q.n === k || q.name === k)); return x ? (x.v ?? x.value) : null; };
    const nd = { __host: 'SongNoteData', __open: true, time: n.time, data: n.raw ?? n.lane, length: n.sustain, kind: n.kind || '', params: p,
      getDirection: () => n.lane, getMustHitNote: () => n.side === 'player', getFloat: k => { const v = par(k); return v === null ? null : +v; }, getInt: k => { const v = par(k); return v === null ? null : parseInt(v); }, getString: k => { const v = par(k); return v === null ? null : String(v); }, getBool: k => { const v = par(k); return v === null ? null : !!v; } };
    return (n.__w = { __host: 'NoteSprite', __open: true, noteData: nd, get kind() { return n.kind || ''; }, get direction() { return n.lane; }, get mustHit() { return n.side === 'player'; }, get hasBeenHit() { return !!n.hit; }, alpha: 1, visible: true, get strumTime() { return n.time; } });
  },
  noteEvent(type, n, extra) {
    let canceled = false;
    const ev = Object.assign({ __host: type, __open: true, type, note: this.noteW(n), eventCanceled: false, playSound: true, cancel() { canceled = true; ev.eventCanceled = true; }, cancelEvent() { canceled = true; ev.eventCanceled = true; }, stopPropagation() {} }, extra);
    const k = this.kinds.get(n.kind);
    const hookName = type === 'NOTE_HIT' ? 'onNoteHit' : 'onNoteMiss';
    if (k && k.script.findMethod(k.cls, hookName)) k.script.callMethod(k.inst, hookName, [ev]);
    if (this.modules.size) this.hook(hookName, ev);
    ev.canceled = canceled;
    return ev;
  },
  playVideo(p) {
    const r = ModRes.parsePath(p); const url = ModRes.get('video', r.key, r.lib);
    if (!url) { HX.note(`video ${r.key}: falta el archivo`); return; }
    VideoSync.play(url, r.key);
  },
  /* ---- IndexedDB: scripts y archivos que pidió cada script ---- */
  async openDB() {
    if (this.db || !window.indexedDB) return this.db;
    this.db = await new Promise(ok => { const r = indexedDB.open('testsong-gcd-mods', 1); r.onupgradeneeded = () => { r.result.createObjectStore('scripts'); r.result.createObjectStore('files'); }; r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }).catch(() => null);
    return this.db;
  },
  async tx(store, mode, fn) { const db = await this.openDB(); if (!db) return null; return new Promise(ok => { const t = db.transaction(store, mode), s = t.objectStore(store); const r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => ok(null); }); },
  saveScript(name, text) { return this.tx('scripts', 'readwrite', s => s.put(text, name)); },
  saveFile(path, blob, name) { return this.tx('files', 'readwrite', s => s.put({ blob, name }, VFS.norm(path))); },
  async clearSaved() { await this.tx('scripts', 'readwrite', s => s.clear()); await this.tx('files', 'readwrite', s => s.clear()); },
  async restore() {
    try {
      const db = await this.openDB(); if (!db) return;
      const all = store => new Promise(ok => { const out = []; const t = db.transaction(store, 'readonly'); const r = t.objectStore(store).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else ok(out); }; r.onerror = () => ok(out); });
      for (const [k, v] of await all('files')) if (v && v.blob) VFS.put(k, v.blob, v.name);
      for (const [k, v] of await all('scripts')) { try { this.load(k, v); } catch (e) { console.warn('[hxc] guardado no válido', k, e); } }
    } catch (e) { console.warn('[hxc] IndexedDB', e); }
  },
};

/* ---------- estilos de nota (noteStyle de un NoteKind) ---------- */
const NoteStyles = {
  map: new Map(),   // id -> { status, head: [frames x4], from }
  request(id) { if (!this.map.has(id)) { this.map.set(id, { status: 'loading', head: null }); this.load(id); } },
  async load(id) {
    const rec = this.map.get(id) || { status: 'loading' }; this.map.set(id, rec);
    ModRes.forget('notestyle', id, null);
    const json = await ModRes.load('notestyle', id, null);
    let ap = null, prefixes = null, scale = 1;
    if (json && json.assets && json.assets.note) {
      const n = json.assets.note; ap = n.assetPath ? parseAssetPath(n.assetPath) : null; scale = +n.scale || 1;
      const d = n.data || {}; prefixes = LANE_NAMES.map(l => (d[l] && d[l].prefix) || null);
    }
    const key = ap ? ap.path : id;
    ModRes.forget('sparrow', key, null);
    const sh = await ModRes.load('sparrow', key, null);
    rec.json = json; rec.sheetKey = key;
    if (!sh) { rec.status = json ? 'needs-sheet' : 'missing'; rec.head = null; return rec; }
    const guess = i => [prefixes && prefixes[i], 'note' + ['Left', 'Down', 'Up', 'Right'][i], ASSET_CFG.noteColors[i] + '0', ASSET_CFG.noteColors[i], LANE_NAMES[i]].filter(Boolean);
    rec.head = [0, 1, 2, 3].map(i => { for (const p of guess(i)) { const fr = sparrowFrames(sh.atlas, p, null, sh.img); if (fr.length) return fr; } return null; });
    rec.scale = scale; rec.status = rec.head.some(Boolean) ? 'ok' : 'needs-sheet';
    return rec;
  },
  headFor(kind) { const k = Mods.kinds.get(kind); if (!k || !k.styleId) return null; const r = this.map.get(k.styleId); return r && r.status === 'ok' ? r : null; },
};

/* =====================================================================
   v3.5.0 — StageRT: scripts .hxc de ESCENARIO (class X extends Stage).
   Se ejecutan SOLO cuando el escenario cargado tiene su mismo id:
   buildStage → onCreate → addCharacter(c, CharacterType) → onSongLoaded,
   y luego onUpdate / onStepHit / onBeatHit / onSongEvent / onGameOver.
   Si el id no coincide se avisa (estado + aviso) y no se aplica nada.
   ===================================================================== */
class HxSequence {
  constructor(list) { this.running = true; this.t = 0; this.items = (list || []).map(x => ({ time: +x.time || 0, cb: x.callback, done: false })); this.__host = 'Sequence'; StageRT.seqs.push(this); }
  update(dt) { if (!this.running) return; this.t += dt; for (const it of this.items) if (!it.done && this.t >= it.time) { it.done = true; Mods.safe(() => it.cb && it.cb()); } }
  clear() { this.items.length = 0; } destroy() { this.items.length = 0; }
}
const StageRT = {
  cur: null, key: null, chars: {}, seqs: [], sprites: [], mismatch: null, warned: new Set(),
  status() {
    const out = [];
    if (this.cur) out.push(`✔ script del escenario ${this.cur.id} (${this.cur.file}) activo · shaders: ${this.shaderInfo()}`);
    if (this.mismatch) out.push(`⚠ ${this.mismatch}`);
    return out;
  },
  shaderInfo() {
    const list = [];
    for (const r of ['bf', 'dad', 'gf']) { const c = Scene.chars[r]; if (c && c.shader) list.push(`${r}: ${c.shader.name}${c.shader.error ? ' (' + c.shader.error + ')' : ''}`); }
    for (const p of (Scene.stage ? Scene.stage.props : [])) if (p.shader) list.push(`${p.name}: ${p.shader.name}`);
    if (!list.length) return 'ninguno';
    return list.join(', ') + (Render.name && /canvas/i.test(Render.name()) ? ' — con Render Canvas solo se aproxima el ajuste de color (activa WebGL)' : '');
  },
  /* miembros nativos de la clase Stage del juego */
  member(obj, n, isSuper) {
    const S = HOST.ps.currentStage;
    switch (n) {
      case 'buildStage': return () => this.superBuild(obj);
      case 'addCharacter': return () => null;
      case 'fetchAssetPaths': return () => [];
      case 'getNamedProp': return name => S.getNamedProp(name);
      case 'getBoyfriend': return () => CharW.get('bf');
      case 'getDad': return () => CharW.get('dad');
      case 'getGirlfriend': return () => CharW.get('gf');
      case 'getCharacter': return id => S.getCharacter(id);
      case 'add': case 'insert': return (a, b) => { const o = b && typeof a === 'number' ? b : a; if (o instanceof HxSprite) this.sprites.push(o); return S.add(o); };
      case 'remove': return o => S.remove(o);
      case 'refresh': return () => null;
      case 'camZoom': return Cam.stageZoom;
      case 'id': case 'stageId': return obj.stageId;
    }
    return undefined;
  },
  /* super.buildStage(): si el script cambió _data (assetPath de props, posiciones) antes de llamarlo, se aplica */
  superBuild(obj) {
    const st = Scene.stage, d = obj._data; if (!st || !d) return null;
    (d.props || []).forEach((pd, i) => {
      const p = st.props[i]; if (!p || !pd) return;
      if (pd.assetPath && p.__ap0 !== undefined && pd.assetPath !== p.__ap0 && !String(pd.assetPath).startsWith('#')) this.swapProp(st, p, pd);
    });
    for (const r of ['bf', 'dad', 'gf']) { const c = Scene.chars[r], pos = d.characters && d.characters[r] && d.characters[r].position; if (c && Array.isArray(pos) && st.data.characters?.[r] && String(pos) !== String(st.data.characters[r].position)) { const old = st.data.characters[r].position; st.data.characters[r].position = pos; placeChar(c, r, st); st.data.characters[r].position = old; } }
    return null;
  },
  async swapProp(st, p, pd) {
    const pa = parseAssetPath(pd.assetPath);
    const cands = ASSET_CFG.stageImagePaths.map(t => fillT(t, { stage: st.id, path: pa.path, dir: st.data.directory || 'shared' }));
    const img = await loadImg(cands, { world: true }).catch(() => null);
    if (img && !p.anims) { p.img = img; p.path = img.assetPath; } else if (!img) HX.note(`buildStage: falta ${cands[0]}`);
  },
  /* cada frame: (re)arranca el script cuando cambia el escenario o se reinicia, y sigue a los cambios de personaje */
  tick() {
    const st = Scene.stage;
    const key = st ? st.id + '|' + Scene.token + '|' + Mods.stages.size + '|' + (SongImport.gen || 0) : null;
    if (key !== this.key) { this.key = key; this.start(); }
    if (!this.cur) return;
    for (const r of ['bf', 'dad', 'gf']) if (Scene.chars[r] && this.chars[r] !== Scene.chars[r]) this.addChar(r);
    const dt = Mods.elapsed; for (const s of this.seqs) s.update(dt);
  },
  start() {
    const st = Scene.stage;
    // se deshace lo del script anterior
    for (const c of Object.values(Scene.chars)) if (c) { c.shader = null; c.rgb = null; }
    if (st) for (const p of st.props) { if (!p.__orig) p.__orig = { alpha: p.alpha, pos: p.pos.slice(), scale: p.scale.slice(), visible: p.visible, z: p.z, ap: p.path }; else Object.assign(p, { alpha: p.__orig.alpha, pos: p.__orig.pos.slice(), scale: p.__orig.scale.slice(), visible: p.__orig.visible, z: p.__orig.z }); p.shader = null; p.rgb = null; p.rgbInt = null; }
    for (const o of this.sprites) { const i = ModRT.sprites.indexOf(o); if (i >= 0) ModRT.sprites.splice(i, 1); }
    this.cur = null; this.chars = {}; this.seqs = []; this.sprites = []; this.mismatch = null;
    try { EngineFX.apply(st); } catch (e) { console.warn('[EngineFX]', e); }
    if (!st || !Mods.stages.size) return;
    const rec = Mods.stages.get(st.id) || [...Mods.stages.values()].find(r => r.id.toLowerCase() === String(st.id).toLowerCase());
    if (!rec) {
      const ids = [...Mods.stages.keys()];
      this.mismatch = `el script de escenario (${ids.join(', ')}) no corresponde al escenario cargado "${st.id}": sus shaders y cambios no se aplican. Carga el JSON de ese escenario (data/stages/<id>.json) con el chart.`;
      if (!this.warned.has(this.mismatch)) { this.warned.add(this.mismatch); toast('⚠ ' + this.mismatch, 6000); }
      return;
    }
    (st.data.props || []).forEach((pd, i) => { if (st.props[i]) st.props[i].__ap0 = pd.assetPath; });
    const inst = rec.script.instantiate(rec.cls, []);
    inst._data = JSON.parse(JSON.stringify(st.data));
    this.cur = { id: rec.id, file: rec.file, inst, rec };
    const call = (n, ev) => { if (rec.script.findMethod(rec.cls, n)) { try { HX.R.cur = rec.file; rec.script.callMethod(inst, n, [ev || {}]); } catch (e) { console.warn('[hxc escenario]', n, e); HX.note(`${n}: ${e.message}`); } } };
    call('buildStage'); call('onCreate', { __host: 'ScriptEvent' });
    for (const r of ['bf', 'dad', 'gf']) if (Scene.chars[r]) this.addChar(r);
    call('onSongLoaded', { __host: 'ScriptEvent' });
  },
  addChar(r) {
    this.chars[r] = Scene.chars[r];
    const T = { bf: 'BF', dad: 'DAD', gf: 'GF' }[r];
    this.call('addCharacter', CharW.get(r), T, true);
  },
  call(n, ev, extra, raw) {
    const c = this.cur; if (!c || !c.rec.script.findMethod(c.rec.cls, n)) return;
    try { HX.R.cur = c.file; c.rec.script.callMethod(c.inst, n, raw ? [ev, extra] : [ev || {}]); }
    catch (e) { console.warn('[hxc escenario]', n, e); HX.note(`${n}: ${e.message}`); }
  },
  /* evento del chart → onSongEvent(event) */
  songEvent(ev) { if (this.cur) this.call('onSongEvent', { __host: 'SongEventScriptEvent', eventData: { __host: 'SongEventData', eventKind: ev.e, kind: ev.e, time: ev.t, value: ev.v ?? null } }); },
};

/* =====================================================================
   v3.5.0 — VideoSync: videos de eventos (mp4/webm) como capa HTML
   sincronizada con la canción: se pausa con la pausa, se corrige si se
   desfasa más de 0.25 s y desaparece al buscar/reiniciar o al terminar.
   ===================================================================== */
const VideoSync = {
  list: [],
  play(url, key, t0 = G.songPos, opts = {}) {
    const v = document.createElement(opts.gif ? 'img' : 'video');
    v.className = 'hx-video' + (opts.gif ? ' hx-gif' : ''); v.src = url; v.dataset.key = key;
    if (!opts.gif) { v.playsInline = true; v.preload = 'auto'; v.onended = () => this.remove(it); }
    v.onclick = () => this.remove(it);
    const it = { v, t0, key, gif: !!opts.gif, until: opts.ms ? t0 + opts.ms : null };
    document.body.appendChild(v); this.list.push(it);
    if (!opts.gif) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });   // sin gesto: arranca en silencio
    return it;
  },
  remove(it) { it.v.remove(); const i = this.list.indexOf(it); if (i >= 0) this.list.splice(i, 1); },
  clear() { for (const it of [...this.list]) this.remove(it); },
  tick() {
    for (const it of [...this.list]) {
      if (it.until !== null && G.songPos >= it.until) { this.remove(it); continue; }
      if (it.gif) continue;
      const v = it.v, want = (G.songPos - it.t0) / 1000;
      if (want < 0) { this.remove(it); continue; }
      if (G.paused) { if (!v.paused) v.pause(); continue; }
      if (v.paused && !v.ended) v.play().catch(() => {});
      if (isFinite(v.duration) && want > v.duration + 0.5) { this.remove(it); continue; }
      if (v.readyState >= 1 && Math.abs(v.currentTime - want) > 0.25) v.currentTime = Math.max(0, want);
    }
  },
  pauseAll() { for (const it of this.list) if (!it.gif && !it.v.paused) it.v.pause(); },
};
